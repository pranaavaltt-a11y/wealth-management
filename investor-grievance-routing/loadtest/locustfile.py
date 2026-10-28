"""Load test (D6). Each Locust user submits a complaint, polls until the run is final, and records the
complete-run latency as a `full_run` sample, so percentiles measure submission -> final result.

    docker compose --profile loadtest run --rm locust --headless -u 6 -r 1 -t 3m --csv /mnt/results/w3_u6

Set UNIQUE=1 (default) to defeat the run cache. UNIQUE=0 resubmits identical complaints to measure the
effect of the run cache.
"""
import os
import random
import time
import uuid

from locust import HttpUser, between, events, task

COMPLAINTS = [
    "I invested in a fixed deposit through my bank's app. The interest credited is lower than what I was promised. I want to complain to SEBI.",
    "My stock broker executed unauthorised trades in my trading account and has not issued contract notes for them.",
    "I submitted a redemption request for my mutual fund units ten days ago and the AMC has still not credited the redemption amount.",
    "Shares were debited from my demat account without my instruction and the depository participant has not explained it.",
    "I have not received the final dividend declared by the listed company although I was a shareholder on the record date.",
    "My ULIP insurance policy premium was deducted twice and the insurer refuses to refund the extra premium amount.",
]
UNIQUE = os.getenv("UNIQUE", "1") == "1"
POLL_S = 0.5
TIMEOUT_S = 180


class Investor(HttpUser):
    wait_time = between(1, 3)

    @task
    def submit_and_wait(self):
        text = random.choice(COMPLAINTS)
        if UNIQUE:
            text += f" Reference {uuid.uuid4().hex[:8]}."
        body = {"complaint_text": text, "complainant": {"name": "Load Test", "state": "Karnataka"},
                "incident_date": "2026-08-01", "first_approached_entity": False}
        started = time.time()
        with self.client.post("/v1/complaints", json=body, headers={"X-Client-Id": f"locust-{uuid.uuid4().hex[:6]}"},
                              catch_response=True, name="submit") as resp:
            if resp.status_code not in (200, 202):
                resp.failure(f"submit {resp.status_code}")
                return
            run_id = resp.json()["run_id"]
        status = "queued"
        while time.time() - started < TIMEOUT_S:
            r = self.client.get(f"/v1/runs/{run_id}", name="poll")
            status = r.json().get("status") if r.ok else "error"
            if status in ("completed", "escalated", "failed"):
                break
            time.sleep(POLL_S)
        elapsed_ms = (time.time() - started) * 1000
        events.request.fire(request_type="RUN", name="full_run", response_time=elapsed_ms, response_length=0,
                            exception=None if status in ("completed", "escalated") else Exception(f"run {status}"),
                            context={})
