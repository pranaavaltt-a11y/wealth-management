from fastapi.testclient import TestClient

from app.agents.worker import process
from app.api.main import app
from app.common import metrics, store
from tests.conftest import DIFFICULT, complaint

client = TestClient(app)


def _value(counter):
    return counter._value.get()


def test_malformed_request_is_quarantined_and_starts_no_run():
    before_depth, before_started = store.queue_depth(), _value(metrics.RUNS_STARTED)
    resp = client.post("/v1/complaints", json=complaint("short", incident_date="2099-01-01"))
    assert resp.status_code == 422
    body = resp.json()
    assert body["run_started"] is False and body["quarantine_id"].startswith("q_")
    fields = {e["field"] for e in body["errors"]}
    assert {"complaint_text", "incident_date"} <= fields
    assert store.queue_depth() == before_depth and _value(metrics.RUNS_STARTED) == before_started
    assert client.get("/v1/quarantine").json()["records"][0]["quarantine_id"] == body["quarantine_id"]


def test_invalid_json_is_quarantined():
    resp = client.post("/v1/complaints", content=b"{not json", headers={"Content-Type": "application/json"})
    assert resp.status_code == 422 and resp.json()["run_started"] is False


def test_submit_process_poll_trace_feedback_and_cache():
    resp = client.post("/v1/complaints", json=complaint(DIFFICULT + " Case A1."))
    assert resp.status_code == 202
    run_id = resp.json()["run_id"]
    assert client.get(f"/v1/runs/{run_id}").json()["status"] == "queued"
    job = store.dequeue(timeout_s=1)
    process(job)
    store.ack(job)
    run = client.get(f"/v1/runs/{run_id}").json()
    assert run["status"] == "completed" and run["determination"]["regulator"] == "RBI"
    assert run["prompt_versions"]["research"].startswith("research@v2#")
    trace = client.get(f"/v1/runs/{run_id}/trace").json()
    kinds = {e["type"] for e in trace["events"]}
    assert {"submitted", "dequeued", "llm", "tool", "verify", "final"} <= kinds
    fb = client.post(f"/v1/runs/{run_id}/feedback", json={"satisfactory": False, "reason": "wrong timeline"})
    assert fb.status_code == 200
    assert client.get("/v1/feedback/summary").json()["unsatisfactory"] >= 1
    again = client.post("/v1/complaints", json=complaint(DIFFICULT + " Case A1."))
    assert again.status_code == 200 and again.json()["cache_hit"] is True


def test_rate_limit(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MIN", "2")
    codes = [client.post("/v1/complaints", json=complaint(DIFFICULT + f" n{i}"), headers={"X-Client-Id": "greedy"}).status_code
             for i in range(3)]
    assert codes[:2] == [202, 202] and codes[2] == 429


def test_health_and_metrics():
    assert client.get("/health").json()["status"] == "ok"
    assert "igr_runs_submitted_total" in client.get("/metrics").text
