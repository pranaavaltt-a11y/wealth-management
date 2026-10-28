"""Quality metrics, shared by the verifier, the batch evaluation (L3) and online scoring of live runs (L6).

All are reference-free, so they can be computed on live traffic:

* groundedness       share of claim sentences in `basis` whose content words are covered (recall >= 0.5)
                     by the passages the determination cites.
* context relevance  mean, over the passages retrieved in the run, of the share of the complaint's
                     key terms (product, entity type) the passage mentions, blended 50/50 with the
                     passage's normalised retrieval score.
* faithfulness       share of citations that resolve verbatim to retrieved text AND belong to the regulator
                     the determination routes to (or to an exclusion that supports the referral).
* hallucination      1 if any citation fails to resolve to retrieved text, or any claim sentence has support
                     below 0.25, else 0. The rate is the mean over runs.

For an escalation (route escalate_to_human) no determination is made, so groundedness and hallucination
only consider whether its citations resolve; the explanatory text is not scored.
"""
from __future__ import annotations

import re

from app.retrieval.embeddings import _stem, tokens

SUPPORT_OK = 0.5
SUPPORT_HALLUCINATED = 0.25


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text or "") if len(tokens(s)) >= 3]


def support(claim: str, passages: list[str]) -> float:
    claim_terms = {_stem(t) for t in tokens(claim)}
    if not claim_terms:
        return 1.0
    pool = {_stem(t) for p in passages for t in tokens(p)}
    return len(claim_terms & pool) / len(claim_terms)


def resolve(citation: dict, evidence: list[dict]) -> dict | None:
    quote = norm(citation.get("quote", ""))
    if len(quote) < 15:
        return None
    for p in evidence:
        if p["clause_id"] == citation.get("clause_id") and quote in norm(p["text"]):
            return p
    return None


def cited_passages(determination: dict, evidence: list[dict]) -> list[dict]:
    out = []
    for c in determination.get("citations", []):
        p = resolve(c, evidence)
        if p:
            out.append(p)
    return out


def groundedness(determination: dict, evidence: list[dict]) -> tuple[float, list[float]]:
    if determination.get("route") == "escalate_to_human":
        # An escalation makes no determination; only its citations (if any) must resolve.
        cites = determination.get("citations", [])
        return (sum(resolve(c, evidence) is not None for c in cites) / len(cites) if cites else 1.0), []
    texts = [p["text"] for p in cited_passages(determination, evidence)]
    claims = sentences(determination.get("basis", ""))
    if not claims:
        return 1.0, []
    scores = [support(c, texts) for c in claims]
    return sum(s >= SUPPORT_OK for s in scores) / len(scores), scores


def context_relevance(key_terms: list[str], evidence: list[dict]) -> float:
    if not evidence:
        return 0.0
    terms = [t.lower() for t in key_terms if t]
    top = max((p.get("score") or 0) for p in evidence) or 1.0
    vals = []
    for p in evidence:
        text = p["text"].lower() + " " + " ".join(p.get("covers", []))
        lexical = sum(1 for t in terms if t in text) / len(terms) if terms else 0.0
        vals.append(0.5 * lexical + 0.5 * (p.get("score") or 0) / top)
    return sum(vals) / len(vals)


def faithfulness(determination: dict, evidence: list[dict]) -> float:
    citations = determination.get("citations", [])
    if not citations:
        return 1.0 if determination.get("route") == "escalate_to_human" else 0.0
    ok = 0
    for c in citations:
        p = resolve(c, evidence)
        if not p:
            continue
        reg = determination.get("regulator")
        if reg in (None, p["regulator"]) or p.get("kind") == "exclusion" or determination.get("route") == "escalate_to_human":
            ok += 1
    return ok / len(citations)


def hallucinated(determination: dict, evidence: list[dict]) -> bool:
    if any(resolve(c, evidence) is None for c in determination.get("citations", [])):
        return True
    _, scores = groundedness(determination, evidence)
    return any(s < SUPPORT_HALLUCINATED for s in scores)


def score_run(determination: dict, evidence: list[dict], key_terms: list[str]) -> dict:
    g, _ = groundedness(determination, evidence)
    return {"groundedness": round(g, 3), "context_relevance": round(context_relevance(key_terms, evidence), 3),
            "faithfulness": round(faithfulness(determination, evidence), 3),
            "hallucination": 1.0 if hallucinated(determination, evidence) else 0.0}
