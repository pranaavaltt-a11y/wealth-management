"""Verifier agent service. Deployed in its own container so that it fails, scales and is released
independently of the research agents, and so the research agent cannot influence it."""
from __future__ import annotations

import time

from fastapi import FastAPI, Request
from prometheus_client import make_asgi_app
from pydantic import BaseModel

from app.common import metrics
from app.common.observability import context_from, correlation_id, log, setup, tracer
from app.verifier.checks import verify

setup("verifier")
import logging  # noqa: E402

logger = logging.getLogger("verifier")
app = FastAPI(title="Verifier agent")
app.mount("/metrics", make_asgi_app())
STARTED = time.time()


class VerifyRequest(BaseModel):
    run_id: str
    draft: dict
    evidence: list[dict]
    facts: dict
    complaint_text: str = ""


@app.get("/health")
def health():
    return {"status": "ok", "uptime_s": round(time.time() - STARTED, 1)}


@app.post("/v1/verify")
def do_verify(req: VerifyRequest, request: Request):
    correlation_id.set(request.headers.get("X-Correlation-ID", req.run_id))
    started = time.time()
    with tracer.start_as_current_span("verifier.verify", context=context_from(dict(request.headers))) as s:
        result = verify(req.draft, req.evidence, req.facts, req.complaint_text)
        s.set_attribute("verified", result["verified"])
    metrics.VERIFICATIONS.labels("pass" if result["verified"] else "fail").inc()
    metrics.AGENT_TASKS.labels("verifier", "pass" if result["verified"] else "fail").inc()
    metrics.STEP_LATENCY.labels("verifier", "verify").observe(time.time() - started)
    log(logger, "verification", run_id=req.run_id, verified=result["verified"], failures=result["failure_reasons"])
    return result
