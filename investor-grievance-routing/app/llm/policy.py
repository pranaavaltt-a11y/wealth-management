"""Scripted stand-in for a language model.

This module plays two roles:

1. **The stub LLM provider** (`app.llm.stub_server`). D6 asks for load testing against a stub that returns
   fixed responses after a realistic delay. Our stub speaks the OpenAI chat-completions protocol and,
   instead of a canned string, computes the response with the procedure below, so the whole agent loop
   (tool choice, verification, retries) still runs end to end.
2. **The degraded fallback planner** used when the provider circuit breaker is open (A5). The result of
   a degraded run is never returned as confident: it is always escalated to a human.

It emulates an instruction-following model. It reads the `PROCEDURE:` lines of the system prompt and
follows only the steps the prompt asks for. That is how prompt variants v1 and v2 behave differently
under the stub. Results measured with the stub describe the system, not a real model; re-run
`python -m app.eval.run_eval` against a real provider for model-quality numbers.
"""
from __future__ import annotations

import datetime as dt
import json
import re

from app.agents import lexicon as lx

PRIORITY = ["bank", "nbfc", "insurer", "pension_fund", "crypto_exchange", "chit_fund", "mutual_fund", "registrar",
            "depository_participant", "listed_company", "investment_adviser", "broker"]
CLAIMED_TO_ENTITY = {"broker": "broker", "mutual_fund": "mutual_fund", "registrar": "registrar",
                     "listed_company": "listed_company", "depository_participant": "depository_participant",
                     "depository": "depository_participant", "bank": "bank", "nbfc": "nbfc", "insurer": "insurer"}
PRODUCT_TO_ENTITY = {"fixed_deposit": "bank", "savings_account": "bank", "loan": "bank", "insurance_policy": "insurer",
                     "pension": "pension_fund", "mutual_fund_units": "mutual_fund", "equity_shares": "broker",
                     "derivatives": "broker"}


LABEL = {"mutual_fund": "asset management company of a mutual fund", "broker": "stock broker",
         "depository_participant": "depository participant", "listed_company": "listed company",
         "registrar": "registrar and share transfer agent", "investment_adviser": "investment adviser", "bank": "bank",
         "nbfc": "non-banking financial company"}


OTHER_REGULATOR_TERMS = {"IRDAI": ["insurance", "Insurance Regulatory"], "PFRDA": ["pension", "Pension Fund"],
                         "UNREGULATED": ["crypto", "not regulated by SEBI"], "STATE_GOVT": ["chit", "not regulated by SEBI"]}


def respond(messages: list[dict]) -> str:
    system = messages[0]["content"]
    payload = json.loads(messages[-1]["content"])
    task = re.search(r"TASK:\s*(\w+)", system).group(1)
    if task == "triage":
        return json.dumps(triage(payload["complaint"], "IDENTIFY_PROVIDER" in system))
    if task == "research":
        return json.dumps(research(payload, "CHECK_MODIFIERS" in system))
    if task == "judge":
        return json.dumps({"claims": [{"claim": c, "supported": True} for c in payload.get("claims", [])]})
    raise ValueError(f"unknown task {task}")


# --- triage ----------------------------------------------------------------------------------------

def _strip(text: str) -> str:
    return re.sub(r"</?complaint>", "", text)


def triage(complaint: dict, provider_first: bool) -> dict:
    text = _strip(complaint["text"])
    mentions = lx.entity_mentions(text)
    stated = lx.grievance_entities(text) or mentions
    claimed = CLAIMED_TO_ENTITY.get(complaint.get("entity_type_claimed") or "")
    from_product = PRODUCT_TO_ENTITY.get(complaint.get("product") or "")
    for hint in (from_product, claimed):
        if hint and hint not in stated:
            stated[hint] = [f"declared:{hint}"]
    # "bank" alone, when a SEBI entity is the subject, is usually only the payment rail.
    if set(stated) & {"bank"} and len(stated) > 1 and not _bank_is_subject(text):
        stated.pop("bank", None)
    entities = sorted(stated, key=lambda e: PRIORITY.index(e) if e in PRIORITY else 99)
    if not provider_first:
        # v1: classify by the investment vocabulary. A complaint that names SEBI is assumed to be a SEBI matter.
        sebi = [e for e in entities if lx.regulator_of(e) == "SEBI"]
        if "sebi" in text.lower() and sebi:
            entities = sebi + [e for e in entities if e not in sebi]
    primary = entities[0] if entities else None
    regulators = sorted({lx.regulator_of(e) for e in entities})
    incident = complaint.get("incident_date")
    today = dt.date.fromisoformat(complaint.get("today") or dt.date.today().isoformat())
    years = round((today - dt.date.fromisoformat(incident)).days / 365.25, 2) if incident else None
    low = text.lower()
    signals = {
        "sub_judice": bool(re.search(r"\b(court|tribunal|arbitrat\w*|consumer forum|case is pending|filed a case)\b", low)),
        "query_only": bool(re.search(r"^(what|how|can|is|which|could|please (tell|explain))\b", low.strip()))
                      and not lx.GRIEVANCE_CUES.search(low),
        "unlisted_company": bool(re.search(r"\b(unlisted|delisted|not listed)\b", low)),
        "years_since_incident": years,
        "outside_corpus": next((lx.regulator_of(e) for e in entities if lx.regulator_of(e) not in lx.CORPUS_REGULATORS), None),
        "first_approached_entity": complaint.get("first_approached_entity"),
    }
    product = (complaint.get("product") if complaint.get("product") not in (None, "unknown") else None) or \
        (stated.get(primary, ["unspecified"])[0] if primary else "unspecified")
    return {
        "domain": lx.domain_of(primary) if primary else "out_of_jurisdiction",
        "primary_entity": primary,
        "product": product.replace("declared:", ""),
        "entity_types": entities,
        "regulators_in_scope": regulators,
        "regulator_mentioned": [r for r in ("SEBI", "RBI", "IRDAI", "PFRDA") if r.lower() in low],
        "signals": signals,
        "search_hint": f"{product.replace('declared:', '')} {primary or ''} complaint".strip(),
    }


def _bank_is_subject(text: str) -> bool:
    low = text.lower()
    return bool(re.search(r"\bbank(?:'s)?\s+(has|have|did|didn'?t|failed|refused|debited|charged|deducted|credited|"
                          r"wrongly|is not|has not|not)\b", low)) or \
        any(lx.find_terms(text, ["fixed deposit", "term deposit", "savings account", "loan emi", "home loan", "credit card"]))


# --- research --------------------------------------------------------------------------------------

def _evidence(observations: list[dict]) -> list[dict]:
    seen, out = set(), []
    for obs in observations:
        result = obs.get("result")
        items = result if isinstance(result, list) else ([result] if isinstance(result, dict) and "clause_id" in result else [])
        for p in items:
            if p and p.get("clause_id") and p["clause_id"] not in seen:
                seen.add(p["clause_id"])
                out.append(p)
    return out


def _calls(observations: list[dict], tool: str) -> list[dict]:
    return [o for o in observations if o["tool"] == tool]


def quote_for(passage: dict, terms: list[str]) -> str:
    """Pick the sentence of the passage that mentions most of `terms`, verbatim."""
    sentences = [s.strip() for s in re.split(r"(?<=[.;])\s+", passage["text"]) if len(s.strip()) > 20]
    if not sentences:
        return passage["text"][:200]
    scored = sorted(sentences, key=lambda s: -sum(1 for t in terms if t.lower() in s.lower()))
    return scored[0]


def research(payload: dict, check_modifiers: bool) -> dict:
    complaint, facts = payload["complaint"], payload["facts"]
    obs = payload.get("observations", [])
    strategy = payload.get("strategy")
    follow_procedure = check_modifiers or strategy is not None
    searches = _calls(obs, "search_corpus")

    if not searches:
        return {"action": "search_corpus", "args": {"query": _strip(complaint["text"])[:500]}}

    if payload.get("demo_fault") and payload.get("attempt", 1) == 1:
        return {"action": "final", "determination": _naive(obs, facts, fabricate=True)}

    if not follow_procedure:
        return {"action": "final", "determination": _naive(obs, facts)}

    primary = searches[0]["result"][0] if searches[0]["result"] else None
    if primary and not _calls(obs, "find_modifying_provisions"):
        return {"action": "find_modifying_provisions", "args": {"clause_id": primary["clause_id"]}}

    entity = facts.get("primary_entity")
    derived = f"{facts.get('product')} {lx.ENTITY_CLAUSE_HINT.get(entity, entity or '')}"
    if strategy == "exclusion_search":
        derived = f"{facts.get('product')} provided by {entity}: which regulator covers it, exclusions and other regulators"
    if not any(s["args"].get("query") == derived for s in searches):
        return {"action": "search_corpus", "args": {"query": derived}}

    regulators = facts.get("regulators_in_scope", [])
    route_reg = lx.regulator_of(entity) if entity else None
    ev = _evidence(obs)
    if route_reg == "SEBI" and len(regulators) == 1 and not facts["signals"].get("sub_judice") and \
            not any(p["kind"] == "timeline" and "SCORES" in p["clause_id"] for p in ev):
        return {"action": "search_corpus", "args": {"query": "timeline for the entity to resolve the complaint received on SCORES",
                                                    "regulator": "SEBI"}}
    years = facts["signals"].get("years_since_incident")
    if route_reg == "SEBI" and years is not None and years > 3 and \
            not any("limitation" in s["args"].get("query", "") for s in searches):
        return {"action": "search_corpus", "args": {"query": "limitation: time within which a complaint may be lodged "
                                                             "from the date of the cause of action", "regulator": "SEBI"}}
    if route_reg == "RBI" and not any(p["clause_id"].endswith("Cl-10") for p in ev):
        return {"action": "get_clause", "args": {"clause_id": "RBI-IOS/Cl-10"}}
    if route_reg == "RBI" and not any(p["clause_id"].endswith("Cl-8") for p in ev):
        return {"action": "get_clause", "args": {"clause_id": "RBI-IOS/Cl-8"}}
    return {"action": "final", "determination": decide(facts, ev, complaint)}


def _naive(obs: list[dict], facts: dict, fabricate: bool = False) -> dict:
    """Single-pass answer: route by the framework of the top retrieved passage."""
    top = obs[0]["result"][0]
    terms = ["complaint", "SCORES", "invest"]
    determination = {
        "route": "assign_to_entity" if top["regulator"] == "SEBI" else "refer_to_other_regulator",
        "regulator": top["regulator"],
        "entity_type": facts.get("primary_entity"),
        "timeline": "21 calendar days" if top["regulator"] == "SEBI" else None,
        "basis": f"The complaint falls under {top['document']}.",
        "citations": [{"clause_id": top["clause_id"], "quote": quote_for(top, terms)}],
    }
    if fabricate:
        determination["citations"].append({"clause_id": "SEBI-SCORES/4",
                                           "quote": "SEBI shall ensure the investor receives the promised interest within 21 days."})
    return determination


def _cite(p: dict, terms: list[str]) -> dict:
    return {"clause_id": p["clause_id"], "quote": quote_for(p, terms)}


def _find(ev: list[dict], regulator: str | None = None, kind: str | None = None, covers: list[str] | None = None,
          clause_suffix: str | None = None) -> dict | None:
    for p in ev:
        if regulator and p["regulator"] != regulator:
            continue
        if kind and p.get("kind") != kind:
            continue
        if clause_suffix and not p["clause_id"].endswith(clause_suffix):
            continue
        if covers and not set(c.lower() for c in covers) & set(c.lower() for c in p.get("covers", [])):
            continue
        return p
    return None


def decide(facts: dict, ev: list[dict], complaint: dict) -> dict:
    entity = facts.get("primary_entity")
    signals = facts["signals"]
    product = facts.get("product", "")
    regulators = facts.get("regulators_in_scope", [])
    exclusion = _find(ev, regulator="SEBI", kind="exclusion")

    if not entity:
        return {"route": "escalate_to_human", "basis": "The entity complained against could not be identified from the complaint.",
                "reason": "entity_unidentified", "citations": [],
                "escalation_path": "Grievance officer to contact the complainant for the name and type of entity."}

    if signals.get("outside_corpus"):
        other = signals["outside_corpus"]
        cites = [_cite(exclusion, OTHER_REGULATOR_TERMS.get(other, []) + ["other regulators"])] if exclusion else []
        return {"route": "escalate_to_human", "regulator": other, "entity_type": entity,
                "basis": f"The complaint is about {product}, provided by an entity of type {entity}, which falls under "
                         f"{other}. Matters under the purview of other regulators are not dealt with on SCORES. "
                         f"The corpus does not contain the {other} framework, so jurisdiction cannot be verified.",
                "reason": "entity_type_outside_corpus", "citations": cites,
                "escalation_path": f"Grievance officer to confirm the {other} channel and advise the complainant."}

    if len(regulators) > 1:
        cites = []
        for reg in regulators:
            p = _find(ev, regulator=reg, kind="scope")
            if p:
                cites.append(_cite(p, [product, "complaint"]))
        return {"route": "escalate_to_human", "entity_type": ", ".join(facts["entity_types"]),
                "basis": "The complaint states grievances against entities regulated by "
                         + " and ".join(regulators) + ". Each regulator's framework covers only its own regulated entities.",
                "reason": "split_across_regulators", "citations": cites,
                "escalation_path": "Grievance officer to split the complaint and route each part to its regulator."}

    reg = lx.regulator_of(entity)
    if reg == "SEBI":
        if signals.get("sub_judice") and exclusion:
            return {"route": "not_maintainable", "regulator": "SEBI", "entity_type": entity,
                    "basis": "The matter is pending before a court or forum. Sub judice matters are not dealt with as complaints on SCORES.",
                    "reason": "sub_judice", "citations": [_cite(exclusion, ["sub judice", "court"])],
                    "escalation_path": "Complainant to pursue the matter before the forum where it is pending."}
        if signals.get("unlisted_company") and exclusion:
            return {"route": "not_maintainable", "regulator": "SEBI", "entity_type": entity,
                    "basis": "The company is not listed. Complaints against companies which are not listed are not dealt with on SCORES.",
                    "reason": "unlisted_company", "citations": [_cite(exclusion, ["not listed", "delisted"])],
                    "escalation_path": "Complainant may approach the Ministry of Corporate Affairs / Registrar of Companies."}
        if signals.get("query_only") and exclusion:
            return {"route": "not_maintainable", "regulator": "SEBI", "entity_type": entity,
                    "basis": "The submission is a query, not a grievance. Queries and requests for information are not grievances.",
                    "reason": "query_not_grievance", "citations": [_cite(exclusion, ["queries", "suggestions"])],
                    "escalation_path": "Answer through investor education channels."}
        approach = _find(ev, clause_suffix="SCORES/3")
        years = signals.get("years_since_incident")
        if years is not None and years > 3 and approach:
            return {"route": "not_maintainable", "regulator": "SEBI", "entity_type": entity,
                    "basis": f"The cause of action is more than three years old ({years:.1f} years). " + quote_for(approach, ["three years"]),
                    "reason": "time_barred", "citations": [_cite(approach, ["three years"])],
                    "escalation_path": "Grievance officer to confirm the date of the cause of action."}
        obligation = _find(ev, regulator="SEBI", covers=lx.synonyms_for(entity) + [entity.replace("_", " ")]) or \
            _find(ev, regulator="SEBI", kind="obligation")
        timeline = next((p for p in ev if p.get("kind") == "timeline" and "SCORES" in p["clause_id"]), None)
        cites = []
        if obligation:
            cites.append(_cite(obligation, [LABEL.get(entity, entity), "complaint", "responsible", "redress"]))
        if timeline:
            cites.append(_cite(timeline, ["21 calendar days"]))
        return {"route": "assign_to_entity", "regulator": "SEBI", "entity_type": entity,
                "entity_name": complaint.get("entity_name"), "designated_body": lx.DESIGNATED_BODY.get(entity),
                "timeline": "21 calendar days from receipt of the complaint" if timeline else None,
                "basis": " ".join([f"The complaint is against a {LABEL.get(entity, entity)}."] + [c["quote"] for c in cites]),
                "reason": None, "citations": cites,
                "escalation_path": "If unresolved: first review by the Designated Body, then SEBI; thereafter Online Dispute Resolution."}

    # RBI
    scope = _find(ev, regulator="RBI", kind="scope", covers=[product, "fixed deposit", "bank", "nbfc"])
    ground = _find(ev, clause_suffix="Cl-8")
    precondition = _find(ev, clause_suffix="Cl-10")
    cites = []
    if exclusion:
        cites.append(_cite(exclusion, ["banks", "fixed deposits", "Reserve Bank"]))
    if scope:
        cites.append(_cite(scope, [product, "deposit", "bank", "Ombudsman"]))
    if ground:
        cites.append(_cite(ground, ["interest", "deposit", "rate agreed"]))
    if precondition:
        cites.append(_cite(precondition, ["first made a written complaint", "thirty days"]))
    first = complaint.get("first_approached_entity")
    return {"route": "refer_to_other_regulator", "regulator": "RBI", "entity_type": entity,
            "entity_name": complaint.get("entity_name"),
            "timeline": "Bank to be given thirty days to reply before the RBI Ombudsman can take the complaint",
            "basis": " ".join([f"The complaint is against a {LABEL.get(entity, entity)} about a {product}."] + [c["quote"] for c in cites]),
            "reason": "jurisdiction_rbi" + ("" if first else "_bank_not_yet_approached"),
            "citations": cites,
            "escalation_path": ("Complainant first complains in writing to the bank; if no reply within thirty days or the reply "
                                "is unsatisfactory, lodge with the RBI Ombudsman under the Integrated Ombudsman Scheme.")}
