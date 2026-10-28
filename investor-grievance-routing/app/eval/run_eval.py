"""Batch evaluation over the fixed scenario set (L2, L3).

    python -m app.eval.run_eval --variant v2 --out docs/results/eval_v2.json
    python -m app.eval.run_eval --variant v1 --out docs/results/eval_v1.json
    python -m app.eval.run_eval --index /data/index_fixed --label fixed-chunking   # before/after a change

By default the model is the in-process scripted stub (LLM_MODE=inprocess) and the verifier runs in-process,
so the batch needs no running services. Set LLM_MODE=http and LLM_BASE_URL/LLM_MODEL to evaluate a real
provider. Metric definitions are in app/eval/scoring.py.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenarios", default=str(ROOT / "eval" / "scenarios.jsonl"))
    parser.add_argument("--variant", default="v2", choices=["v1", "v2"])
    parser.add_argument("--index", default=None, help="index directory (default INDEX_DIR)")
    parser.add_argument("--label", default=None)
    parser.add_argument("--out", default=None)
    parser.add_argument("--price-in", type=float, default=None, help="USD per million input tokens, for cost reporting")
    parser.add_argument("--price-out", type=float, default=None)
    args = parser.parse_args()

    os.environ.setdefault("LLM_MODE", "inprocess")
    os.environ.setdefault("RETRIEVAL_CACHE_ENABLED", "false")
    if args.index:
        os.environ["INDEX_DIR"] = args.index
    if args.price_in is not None:
        os.environ["LLM_PRICE_INPUT_PER_MTOK_USD"] = str(args.price_in)
    if args.price_out is not None:
        os.environ["LLM_PRICE_OUTPUT_PER_MTOK_USD"] = str(args.price_out)
    os.environ.pop("VERIFIER_URL", None)
    logging_off()

    from app.agents.graph import run_agents
    from app.eval import scoring
    from app.agents import lexicon as lx

    scenarios = [json.loads(line) for line in Path(args.scenarios).read_text().splitlines() if line.strip()]
    rows = []
    for sc in scenarios:
        req = dict(sc["request"])
        req["options"] = {"prompt_variant": args.variant}
        started = time.time()
        result = run_agents(f"eval_{sc['id']}_{args.variant}", req)
        latency = time.time() - started
        exp, det = sc["expected"], result["determination"]
        evidence = result["evidence"]
        facts = result.get("facts") or {}
        key_terms = [facts.get("product", "")] + lx.synonyms_for(facts.get("primary_entity") or "")[:3]
        final_scores = scoring.score_run(det, evidence, key_terms)
        first_draft = (result["drafts"] or [{}])[0].get("draft")
        draft_scores = scoring.score_run(first_draft, evidence, key_terms) if first_draft else None
        retrieved = {p["clause_id"] for p in evidence}
        cited = {c["clause_id"] for c in det.get("citations", [])}
        row = {
            "id": sc["id"], "tags": sc.get("tags", []),
            "expected_route": exp["route"], "route": det["route"],
            "route_correct": det["route"] == exp["route"],
            "regulator_correct": exp["route"] == "escalate_to_human" or det.get("regulator") == exp["regulator"],
            "first_draft_route": (first_draft or {}).get("route"),
            "first_draft_correct": (first_draft or {}).get("route") == exp["route"] if first_draft else None,
            "expected_passage_retrieved": (not exp["supporting_clauses"]) or bool(retrieved & set(exp["supporting_clauses"])),
            "expected_passage_cited": (not exp["supporting_clauses"]) or exp["route"] == "escalate_to_human"
                                      or bool(cited & set(exp["supporting_clauses"])),
            "verified": result["verified"], "attempts": result["attempts"], "steps": result["steps"],
            "tool_calls": result["tool_calls"], "tokens": result["tokens"], "cost_usd": result["cost_usd"],
            "usage": result["usage"], "latency_s": round(latency, 3), "reason": det.get("reason"),
            "final": final_scores, "first_draft": draft_scores,
            "citations": [c["clause_id"] for c in det.get("citations", [])],
        }
        rows.append(row)

    def mean(key, sub="final"):
        vals = [r[sub][key] for r in rows if r.get(sub)]
        return round(statistics.mean(vals), 3) if vals else None

    def rate(key):
        vals = [r[key] for r in rows if r[key] is not None]
        return round(sum(vals) / len(vals), 3)

    escalate_expected = [r for r in rows if r["expected_route"] == "escalate_to_human"]
    escalated = [r for r in rows if r["route"] == "escalate_to_human"]
    summary = {
        "label": args.label or f"prompt-{args.variant}", "variant": args.variant, "scenarios": len(rows),
        "index": json.loads((Path(os.environ.get("INDEX_DIR", "/data/index")) / "manifest.json").read_text())["index_version"],
        "route_accuracy": rate("route_correct"), "regulator_accuracy": rate("regulator_correct"),
        "first_draft_route_accuracy": rate("first_draft_correct"),
        "expected_passage_recall": rate("expected_passage_retrieved"), "expected_passage_cited": rate("expected_passage_cited"),
        "groundedness": mean("groundedness"), "context_relevance": mean("context_relevance"),
        "faithfulness": mean("faithfulness"), "hallucination_rate": mean("hallucination"),
        "first_draft_faithfulness": mean("faithfulness", "first_draft"),
        "first_draft_hallucination_rate": mean("hallucination", "first_draft"),
        "escalation_precision": round(sum(r["expected_route"] == "escalate_to_human" for r in escalated) / len(escalated), 3) if escalated else None,
        "escalation_recall": round(sum(r["route"] == "escalate_to_human" for r in escalate_expected) / len(escalate_expected), 3) if escalate_expected else None,
        "verification_retry_rate": round(sum(r["attempts"] > 1 for r in rows) / len(rows), 3),
        "mean_steps": round(statistics.mean(r["steps"] for r in rows), 2),
        "mean_tool_calls": round(statistics.mean(r["tool_calls"] for r in rows), 2),
        "mean_tokens": round(statistics.mean(r["tokens"] for r in rows), 1),
        "cost_per_100_runs_usd": round(100 * statistics.mean(r["cost_usd"] for r in rows), 4),
    }
    by_agent: dict = {}
    for r in rows:
        for agent, u in r["usage"].items():
            a = by_agent.setdefault(agent, {"prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0, "calls": 0})
            for k in a:
                a[k] += u[k]
    summary["tokens_by_agent"] = by_agent
    print(json.dumps(summary, indent=2))
    print("\n{:<24} {:<26} {:<26} {:>4} {:>4} {:>5}".format("scenario", "expected", "got", "ok", "att", "steps"))
    for r in rows:
        print("{:<24} {:<26} {:<26} {:>4} {:>4} {:>5}".format(r["id"], r["expected_route"], r["route"],
                                                              "Y" if r["route_correct"] else "N", r["attempts"], r["steps"]))
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))


def logging_off() -> None:
    import logging

    logging.disable(logging.INFO)
    sys.stderr = open(os.devnull, "w") if os.getenv("EVAL_QUIET") else sys.stderr


if __name__ == "__main__":
    main()
