from app.agents.graph import build_graph
from app.llm import client as llm_client
from app.llm.client import CircuitBreaker, CircuitOpen, LLMClient
from tests.conftest import DIFFICULT, complaint


def test_circuit_breaker_opens_and_half_opens():
    cb = CircuitBreaker(threshold=2, reset_after_s=0.05)
    cb.failure(); cb.failure()
    try:
        cb.before_call()
        raise AssertionError("expected open circuit")
    except CircuitOpen:
        pass
    import time
    time.sleep(0.06)
    cb.before_call()
    assert cb.state == "half_open"
    cb.success()
    assert cb.state == "closed"


def test_provider_down_degrades_to_escalation(monkeypatch):
    monkeypatch.setenv("LLM_MODE", "http")
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9/v1")  # nothing listens here
    monkeypatch.setenv("LLM_MAX_RETRIES", "2")
    monkeypatch.setenv("CB_FAILURE_THRESHOLD", "2")
    monkeypatch.setattr(llm_client, "_breaker", None)
    graph = build_graph(LLMClient())
    import time
    state = {"run_id": "t-down", "request": complaint(DIFFICULT), "variant": "v2", "demo_fault": False,
             "observations": [], "evidence": {}, "attempt": 1, "steps": 0, "tool_calls": 0,
             "started_at": time.time(), "degraded": False, "usage": {}}
    final = graph.invoke(state, {"recursion_limit": 60})
    assert final["degraded"] is True
    assert final["final"]["route"] == "escalate_to_human"
    assert final["final"]["reason"] == "degraded_mode_provider_unavailable"
    # the fallback planner still produced a verified provisional answer for the officer
    assert final["final"]["provisional_determination"]["regulator"] == "RBI"
    assert llm_client.breaker().state == "open"
    monkeypatch.setattr(llm_client, "_breaker", None)
