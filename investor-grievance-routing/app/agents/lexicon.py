"""Domain vocabulary: product and entity terms, and which regulator's framework covers each.

Used by the scripted stub model (to emulate an instruction-following LLM), by the degraded fallback
planner, and by the verifier's fact-coverage check.
"""
from __future__ import annotations

import re

# entity type -> (regulator, F3 domain, terms that identify it)
ENTITIES: dict[str, tuple[str, str, list[str]]] = {
    "bank": ("RBI", "out_of_jurisdiction", [
        "fixed deposit", "term deposit", "recurring deposit", "fd", "savings account", "bank account", "upi",
        "neft", "imps", "rtgs", "net banking", "netbanking", "debit card", "credit card", "atm", "cheque",
        "home loan", "personal loan", "loan emi", "bank's app", "bank app", "mobile banking", "bank branch"]),
    "nbfc": ("RBI", "out_of_jurisdiction", ["nbfc", "non-banking financial", "gold loan", "consumer loan"]),
    "broker": ("SEBI", "broker", [
        "stock broker", "stockbroker", "broker", "trading account", "contract note", "margin", "intraday",
        "futures", "options", "f&o", "square off", "squared off", "unauthorised trade", "unauthorized trade",
        "trading platform", "payout"]),
    "mutual_fund": ("SEBI", "mutual_fund", [
        "mutual fund", "sip", "nav", "redemption", "redeem", "units", "folio", "idcw", "amc",
        "asset management", "fund house", "scheme", "elss", "distributor"]),
    "depository_participant": ("SEBI", "depository", [
        "depository participant", "demat", "cdsl", "nsdl", "dematerialisation", "dematerialization", "pledge",
        "dp "]),
    "listed_company": ("SEBI", "listed_company", [
        "dividend", "bonus shares", "rights issue", "annual report", "buyback", "buy-back", "listed company",
        "agm", "shareholder"]),
    "registrar": ("SEBI", "registrar", [
        "registrar", "rta", "transfer agent", "transmission", "duplicate share certificate",
        "duplicate certificate", "physical shares", "share certificate"]),
    "investment_adviser": ("SEBI", "other_sebi_intermediary", [
        "investment adviser", "investment advisor", "research analyst", "advisory fee", "stock tips"]),
    # Outside the corpus: the framework that governs these is not indexed, so the system escalates.
    "insurer": ("IRDAI", "out_of_jurisdiction", [
        "insurance", "insurer", "policy premium", "premium", "ulip", "claim settlement", "life cover"]),
    "pension_fund": ("PFRDA", "out_of_jurisdiction", ["nps", "national pension", "pension fund", "atal pension"]),
    "crypto_exchange": ("UNREGULATED", "out_of_jurisdiction", ["crypto", "bitcoin", "cryptocurrency", "token"]),
    "chit_fund": ("STATE_GOVT", "out_of_jurisdiction", ["chit fund", "chit"]),
}

CORPUS_REGULATORS = {"SEBI", "RBI"}

DESIGNATED_BODY = {
    "broker": "Stock exchange of which the broker is a member",
    "depository_participant": "Depository (NSDL or CDSL) with which the participant is registered",
    "listed_company": "Stock exchange where the securities are listed",
    "registrar": "Stock exchange where the company's securities are listed",
    "mutual_fund": "Asset management company (trustees oversee redressal)",
    "investment_adviser": "SEBI (via SCORES)",
}

ENTITY_CLAUSE_HINT = {
    "broker": "stock broker resolve complaints of clients unauthorised trades contract notes",
    "mutual_fund": "asset management company responsible for servicing unit holders mutual fund complaints",
    "depository_participant": "depository participant redress complaints demat accounts",
    "listed_company": "listed entity redressal of investor complaints dividend",
    "registrar": "registrar and share transfer agent investor service requests transmission",
    "investment_adviser": "investment adviser shall not promise assured return",
    "bank": "bank deposit banking service complaint RBI Ombudsman Integrated Ombudsman Scheme",
    "nbfc": "non-banking financial company regulated entity Integrated Ombudsman Scheme",
}

GRIEVANCE_CUES = re.compile(
    r"\b(not|never|no|failed|fail|didn'?t|did not|hasn'?t|has not|refus\w*|delay\w*|lower|less|wrong\w*|"
    r"unauthori[sz]ed|without|stuck|pending|deducted|debited|mis-?sold|cheat\w*|promised)\b", re.I)


def find_terms(text: str, terms: list[str]) -> list[str]:
    low = f" {text.lower()} "
    hits = []
    for term in terms:
        pattern = r"(?<![a-z])" + re.escape(term.strip()) + r"(?![a-z])"
        if re.search(pattern, low):
            hits.append(term.strip())
    return hits


def entity_mentions(text: str) -> dict[str, list[str]]:
    out = {}
    for entity, (_, _, terms) in ENTITIES.items():
        hits = find_terms(text, terms)
        if hits:
            out[entity] = hits
    # "bank" alone is weak evidence: a bank account is often only the payment rail in a broker or
    # mutual fund complaint. Keep it only when a banking product term or "bank's" ownership is present.
    return out


def grievance_entities(text: str) -> dict[str, list[str]]:
    """Entities named in sentences that actually state a grievance (not merely mentioned)."""
    out: dict[str, list[str]] = {}
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if not GRIEVANCE_CUES.search(sentence):
            continue
        for entity, hits in entity_mentions(sentence).items():
            out.setdefault(entity, []).extend(h for h in hits if h not in out.get(entity, []))
    return out


def regulator_of(entity: str) -> str:
    return ENTITIES[entity][0]


def domain_of(entity: str) -> str:
    return ENTITIES[entity][1]


def synonyms_for(entity: str) -> list[str]:
    return ENTITIES.get(entity, (None, None, []))[2]
