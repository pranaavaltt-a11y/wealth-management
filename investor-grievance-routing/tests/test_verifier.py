from app.retrieval.index import get_index
from app.verifier.checks import verify


def _evidence(*ids):
    idx = get_index()
    return [idx.clause(i) for i in ids]


FACTS_FD = {"primary_entity": "bank", "product": "fixed deposit", "entity_types": ["bank"]}


def test_citation_must_resolve_to_retrieved_text():
    ev = _evidence("RBI-IOS/Cl-3")
    draft = {"route": "refer_to_other_regulator", "regulator": "RBI", "basis": "The bank is a regulated entity.",
             "citations": [{"clause_id": "RBI-IOS/Cl-3", "quote": "This sentence does not appear in the scheme at all."}]}
    result = verify(draft, ev, FACTS_FD)
    assert not result["verified"]
    assert any(r.startswith("citations_resolve") for r in result["failure_reasons"])


def test_exclusion_conflict_is_caught():
    ev = _evidence("SEBI-SCORES/2", "SEBI-SCORES/Annex-A")
    quote = "This framework applies to complaints lodged by investors against listed companies, registered intermediaries and market infrastructure institutions in the securities market."
    draft = {"route": "assign_to_entity", "regulator": "SEBI", "basis": quote,
             "citations": [{"clause_id": "SEBI-SCORES/2", "quote": quote}]}
    result = verify(draft, ev, FACTS_FD)
    assert not result["verified"]
    assert result["suggested_strategy"] == "exclusion_search"
    assert any("no_exclusion_conflict" in r for r in result["failure_reasons"])


def test_supported_referral_passes():
    ev = _evidence("RBI-IOS/Cl-3", "SEBI-SCORES/Annex-A")
    q = "A complaint against a bank about any banking service, including deposit accounts such as savings and fixed deposits, loans, cards and digital payments, falls within the Scheme."
    draft = {"route": "refer_to_other_regulator", "regulator": "RBI",
             "basis": "The complaint is against a bank about a fixed deposit. " + q,
             "citations": [{"clause_id": "RBI-IOS/Cl-3", "quote": q}]}
    assert verify(draft, ev, FACTS_FD)["verified"]
