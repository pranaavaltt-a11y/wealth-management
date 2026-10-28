"""Verifier agent logic (A3). Every answer is checked against the passages actually retrieved in the run.

The verifier is independent of the research agent: it receives the draft, the evidence the run retrieved,
and the facts established by the intake agent. It never sees the research agent's reasoning, so it cannot
be talked into accepting a draft.
"""
from __future__ import annotations

import re

from app.agents import guardrails, lexicon as lx
from app.eval import scoring

NUMBER_WORDS = {"three": "3", "seven": "7", "ten": "10", "fifteen": "15", "twenty-one": "21", "thirty": "30"}


def _numbers(text: str) -> set[str]:
    low = (text or "").lower()
    found = set(re.findall(r"\d+", low))
    for word, digit in NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", low):
            found.add(digit)
    return found


def verify(draft: dict, evidence: list[dict], facts: dict, complaint_text: str = "") -> dict:
    checks: list[dict] = []

    def check(name: str, passed: bool, detail: str = "") -> None:
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    route = draft.get("route")
    citations = draft.get("citations") or []
    violations = guardrails.filter_output(draft)
    check("output_filter", not violations, "; ".join(violations))

    needs_citations = route in ("assign_to_entity", "refer_to_other_regulator", "not_maintainable")
    check("citations_present", bool(citations) or not needs_citations,
          "" if citations or not needs_citations else f"{route} must cite at least one provision")

    unresolved = [c.get("clause_id") for c in citations if scoring.resolve(c, evidence) is None]
    check("citations_resolve", not unresolved,
          f"not found verbatim in retrieved text: {', '.join(map(str, unresolved))}" if unresolved else "")

    cited = scoring.cited_passages(draft, evidence)
    cited_regs = {p["regulator"] for p in cited}
    if route in ("assign_to_entity", "refer_to_other_regulator", "not_maintainable"):
        reg = draft.get("regulator")
        check("regulator_supported", reg in cited_regs,
              "" if reg in cited_regs else f"no cited passage belongs to {reg}; cited: {sorted(cited_regs)}")

    # Does any retrieved exclusion clause take this complaint out of the regulator the draft routes to?
    entity = facts.get("primary_entity")
    fact_terms = [facts.get("product", "")] + ([entity.replace("_", " ")] if entity else []) + lx.synonyms_for(entity or "")
    conflict = None
    if route == "assign_to_entity":
        for p in evidence:
            if p.get("kind") == "exclusion" and p["regulator"] == draft.get("regulator"):
                hit = [t for t in p.get("excludes", []) if any(t.lower() == f.lower() for f in fact_terms if f)]
                if hit:
                    conflict = (p["clause_id"], hit)
                    break
    check("no_exclusion_conflict", conflict is None,
          f"{conflict[0]} excludes {conflict[1]} from this framework" if conflict else "")

    if route in ("assign_to_entity", "refer_to_other_regulator") and entity:
        cited_text = " ".join(p["text"] + " " + " ".join(p.get("covers", [])) for p in cited).lower()
        covered = [t for t in fact_terms if t and t.lower() in cited_text]
        check("facts_covered", bool(covered),
              "" if covered else f"cited passages never mention the product or entity ({facts.get('product')}, {entity})")

    if draft.get("timeline") and route == "assign_to_entity":
        need = _numbers(draft["timeline"])
        have = _numbers(" ".join(p["text"] for p in cited))
        check("timeline_supported", need <= have, "" if need <= have else f"timeline {sorted(need)} not in cited text")

    g, per_claim = scoring.groundedness(draft, evidence)
    if route != "escalate_to_human":  # an escalation makes no determination, so it has no claims to ground
        weak = [round(s, 2) for s in per_claim if s < scoring.SUPPORT_HALLUCINATED]
        check("claims_grounded", g >= 0.6 and not weak, f"groundedness={g:.2f}; unsupported claims={len(weak)}")

    failed = [c for c in checks if not c["passed"]]
    strategy = None
    if failed:
        names = {c["name"] for c in failed}
        strategy = "exclusion_search" if names & {"no_exclusion_conflict", "facts_covered", "regulator_supported"} else "requery"
    return {"verified": not failed, "checks": checks, "failure_reasons": [f"{c['name']}: {c['detail']}" for c in failed],
            "suggested_strategy": strategy, "groundedness": round(g, 3)}
