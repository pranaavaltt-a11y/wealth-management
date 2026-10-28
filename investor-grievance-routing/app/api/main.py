"""Public REST API (F1, F2, F8, A4, A8, D1, D7, L6).

Runs take several seconds to tens of seconds, so submission is asynchronous: POST returns a run id at once
(202) and the run goes onto the Redis queue. The caller polls GET /v1/runs/{id}, or passes `callback_url`
to be called when the run finishes. We chose polling as the default because the web client and Locust can
use it without exposing an inbound endpoint. The callback is there for system-to-system callers.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import ValidationError

from app.common import metrics, store
from app.common.config import get_settings
from app.common.contracts import CONTRACT_VERSION, ComplaintRequest, Feedback, field_errors
from app.common.observability import carrier, correlation_id, log, setup, tracer

setup("api")
logger = logging.getLogger("api")
STARTED = time.time()
STATIC = Path(__file__).parent / "static"
CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"

app = FastAPI(title="Securities Investor Grievance Routing Service", version=CONTRACT_VERSION,
              description="Advisory routing of investor complaints with cited justification. A grievance officer decides.")


@app.middleware("http")
async def observe(request: Request, call_next):
    cid = request.headers.get("X-Correlation-ID") or f"req_{int(time.time() * 1000) % 10**10}"
    correlation_id.set(cid)
    started = time.time()
    response = await call_next(request)
    route = request.scope.get("route")
    path = route.path if route is not None else "unmatched"
    metrics.REQUESTS.labels(path, request.method, str(response.status_code)).inc()
    metrics.REQUEST_LATENCY.labels(path).observe(time.time() - started)
    response.headers["X-Correlation-ID"] = correlation_id.get()
    return response


def _client_id(request: Request) -> str:
    return request.headers.get("X-Client-Id") or (request.client.host if request.client else "anonymous")


@app.post("/v1/complaints", status_code=202)
async def submit(request: Request):
    settings = get_settings()
    client_id = _client_id(request)
    limited, retry_after = store.rate_limited(client_id, settings.rate_limit_per_min)
    if limited:
        metrics.RATE_LIMITED.inc()
        return JSONResponse({"error": "rate_limited", "detail": f"limit {settings.rate_limit_per_min} runs/minute per client"},
                            status_code=429, headers={"Retry-After": str(retry_after)})
    try:
        raw = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        body = (await request.body()).decode("utf-8", "replace")[:5000]
        qid = store.quarantine(body, [{"field": "<body>", "type": "json_invalid", "message": "body is not valid JSON"}],
                               client_id, "malformed_json")
        metrics.QUARANTINED.labels("malformed_json").inc()
        return JSONResponse({"error": "invalid_request", "quarantine_id": qid, "run_started": False,
                             "errors": [{"field": "<body>", "message": "body is not valid JSON"}]}, status_code=422)
    try:
        complaint = ComplaintRequest.model_validate(raw)
        if complaint.options.demo_fault and not settings.demo_faults_enabled:
            raise HTTPException(403, "demo faults are disabled")
    except ValidationError as exc:
        errors = field_errors(exc)
        qid = store.quarantine(raw, errors, client_id, "contract_violation")
        metrics.QUARANTINED.labels("contract_violation").inc()
        log(logger, "request quarantined", quarantine_id=qid, errors=errors)
        return JSONResponse({"error": "invalid_request", "quarantine_id": qid, "run_started": False, "errors": errors},
                            status_code=422)

    req = complaint.model_dump(mode="json")
    run_id = store.new_run_id()
    correlation_id.set(run_id)
    now = time.time()
    cache_key = None
    if settings.run_cache_enabled and not complaint.options.demo_fault:
        from app.retrieval.index import get_index

        cache_key = store.cache_key("run", get_index().version, settings.prompt_variant,
                                    {k: v for k, v in req.items() if k not in ("callback_url", "client_reference", "complainant")})
        hit = store.cache_get(cache_key)
        cached = store.get_run(hit["run_id"]) if hit else None
        if cached and cached.get("status") in ("completed", "escalated"):
            metrics.CACHE.labels("run", "hit").inc()
            copy = {**cached, "run_id": run_id, "submitted_at": now, "finished_at": now, "latency_s": 0.0,
                    "cache_hit": True, "cached_from": hit["run_id"], "client_id": client_id, "cost_usd": 0.0}
            store.save_run(copy)
            store.append_event(run_id, {"type": "cache_hit", "agent": "api", "cached_from": hit["run_id"]})
            store.remember_run(run_id)
            metrics.RUN_LATENCY.observe(0.0)
            return JSONResponse({"run_id": run_id, "status": "completed", "status_url": f"/v1/runs/{run_id}",
                                 "cache_hit": True, "contract_version": CONTRACT_VERSION}, status_code=200)
        metrics.CACHE.labels("run", "miss").inc()

    with tracer.start_as_current_span("api.submit") as s:
        s.set_attribute("run_id", run_id)
        store.save_run({"run_id": run_id, "status": "queued", "submitted_at": now, "client_id": client_id,
                        "request": req, "contract_version": CONTRACT_VERSION})
        store.append_event(run_id, {"type": "submitted", "agent": "api", "client_id": client_id})
        store.enqueue({"run_id": run_id, "request": req, "trace": carrier(), "correlation_id": run_id,
                       "callback_url": req.get("callback_url"), "cache_key": cache_key, "deliveries": 1})
        store.remember_run(run_id)
    metrics.RUNS_SUBMITTED.inc()
    log(logger, "run submitted", run_id=run_id, client_id=client_id)
    return {"run_id": run_id, "status": "queued", "status_url": f"/v1/runs/{run_id}", "cache_hit": False,
            "contract_version": CONTRACT_VERSION}


PUBLIC_FIELDS = ("run_id", "status", "determination", "verified", "degraded", "prompt_versions", "index_version",
                 "cost_usd", "tokens", "latency_s", "steps", "tool_calls", "attempts", "cache_hit", "submitted_at",
                 "finished_at", "error", "facts")


@app.get("/v1/runs/{run_id}")
def get_run(run_id: str):
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(404, "unknown run id")
    out = {k: run.get(k) for k in PUBLIC_FIELDS if k in run}
    out["notice"] = "Advisory routing determination only. A grievance officer decides; the system never disposes of a complaint."
    if run.get("status") in ("completed", "escalated"):
        out["evidence"] = [{"clause_id": p["clause_id"], "document": p["document"], "reference": p["reference"],
                            "text": p["text"]} for p in run.get("evidence", [])]
    return out


@app.get("/v1/runs/{run_id}/trace")
def get_trace(run_id: str):
    """Everything needed to reconstruct a run: every tool call, query, passage, prompt version, per-step
    latency and cost, and the verification outcome."""
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(404, "unknown run id")
    return {"run": run, "events": store.get_events(run_id)}


@app.post("/v1/runs/{run_id}/feedback")
async def feedback(run_id: str, request: Request):
    if not store.get_run(run_id):
        raise HTTPException(404, "unknown run id")
    try:
        fb = Feedback.model_validate(await request.json())
    except ValidationError as exc:
        return JSONResponse({"error": "invalid_request", "errors": field_errors(exc)}, status_code=422)
    record = store.add_feedback(run_id, fb.satisfactory, fb.reason, _client_id(request))
    metrics.FEEDBACK.labels(str(fb.satisfactory).lower()).inc()
    return record


@app.get("/v1/feedback/summary")
def feedback_summary():
    return store.feedback_summary()


@app.get("/v1/quality")
def quality(limit: int = 200):
    return {"samples": store.quality_timeline(limit)}


@app.get("/v1/quarantine")
def quarantine(limit: int = 20):
    return {"records": store.list_quarantine(limit)}


@app.get("/v1/runs")
def recent_runs(limit: int = 20):
    out = []
    for rid in store.recent_run_ids(limit):
        run = store.get_run(rid) or {}
        out.append({"run_id": rid, "status": run.get("status"), "route": (run.get("determination") or {}).get("route"),
                    "latency_s": run.get("latency_s")})
    return {"runs": out}


@app.get("/contracts/{name}")
def contract(name: str):
    path = CONTRACTS / name
    if path.suffix != ".json" or not path.exists() or path.parent != CONTRACTS:
        raise HTTPException(404, "unknown contract")
    return FileResponse(path, media_type="application/schema+json")


@app.get("/health")
def health():
    checks = {}
    try:
        store.client().ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"
    try:
        from app.retrieval.index import get_index

        idx = get_index()
        checks["index"] = {"version": idx.version, "built_at": idx.manifest["built_at_iso"],
                           "chunks": idx.manifest["chunks_total"], "embedder": idx.manifest["embedder"]}
    except Exception as exc:
        checks["index"] = f"error: {exc}"
    healthy = checks["redis"] == "ok" and isinstance(checks["index"], dict)
    return JSONResponse({"status": "ok" if healthy else "degraded", "uptime_s": round(time.time() - STARTED, 1),
                         "queue_depth": store.queue_depth() if checks["redis"] == "ok" else None, "checks": checks},
                        status_code=200 if healthy else 503)


@app.get("/metrics")
def prometheus_metrics():
    try:
        metrics.QUEUE_DEPTH.set(store.queue_depth())
    except Exception:
        pass
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/")
def web_client():
    return FileResponse(STATIC / "index.html")
