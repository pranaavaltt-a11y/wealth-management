"""Agent worker: takes runs off the queue and executes the multi-agent graph.

Scale with `docker compose up --scale agent-worker=3`. Each worker processes one run at a time;
WORKER_CONCURRENCY threads per container raise that if the provider allows it.
"""
from __future__ import annotations

import logging
import os
import random
import signal
import threading
import time

import httpx
from prometheus_client import start_http_server

from app.agents import lexicon as lx
from app.agents.graph import run_agents
from app.common import metrics, store
from app.common.config import get_settings
from app.common.observability import context_from, correlation_id, log, setup, tracer
from app.eval import scoring
from app.retrieval.index import get_index

setup("agent-worker")
logger = logging.getLogger("worker")
_stop = threading.Event()


def _heartbeat(run_id: str, done: threading.Event) -> None:
    while not done.wait(20):
        store.renew_lease(run_id)


def process(job: dict) -> None:
    run_id = job["run_id"]
    correlation_id.set(job.get("correlation_id", run_id))
    run = store.get_run(run_id) or {}
    request = job["request"]
    started = time.time()
    metrics.QUEUE_WAIT.observe(max(0.0, started - run.get("submitted_at", started)))
    store.update_run(run_id, status="running", started_at=started, worker=os.getenv("HOSTNAME", "worker"))
    store.append_event(run_id, {"type": "dequeued", "agent": "worker", "worker": os.getenv("HOSTNAME"),
                                "queue_wait_s": round(started - run.get("submitted_at", started), 3)})
    metrics.RUNS_STARTED.inc()
    done = threading.Event()
    threading.Thread(target=_heartbeat, args=(run_id, done), daemon=True).start()
    try:
        with tracer.start_as_current_span("worker.run", context=context_from(job.get("trace", {}))) as s:
            s.set_attribute("run_id", run_id)
            result = run_agents(run_id, request)
    except Exception as exc:  # a crash must never surface as a confident answer
        logger.exception("run crashed")
        result = {"status": "failed", "determination": {
            "route": "escalate_to_human", "basis": "The run did not complete; a grievance officer must decide.",
            "reason": f"run_error: {type(exc).__name__}", "citations": []}, "verified": False, "degraded": True}
    finally:
        done.set()
    finished = time.time()
    total = finished - run.get("submitted_at", started)
    result.update(status=result["status"], finished_at=finished, latency_s=round(total, 3))
    store.update_run(run_id, **result)
    det = result["determination"]
    metrics.RUN_LATENCY.observe(total)
    metrics.RUNS_FINISHED.labels(result["status"], det["route"], str(result.get("degraded", False)).lower()).inc()
    if job.get("cache_key") and result.get("verified") and not result.get("degraded"):
        store.cache_set(job["cache_key"], {"run_id": run_id}, get_settings().run_cache_ttl_s)
    _online_score(run_id, result)
    _callback(job, run_id, result)


def _online_score(run_id: str, result: dict) -> None:
    """Score a sample of live runs automatically (L6)."""
    if random.random() >= get_settings().online_eval_sample_rate or "evidence" not in result:
        return
    facts = result.get("facts") or {}
    key_terms = [facts.get("product", "")] + lx.synonyms_for(facts.get("primary_entity") or "")[:3]
    scores = scoring.score_run(result["determination"], result.get("evidence", []), key_terms)
    for name, value in scores.items():
        metrics.ONLINE_QUALITY.labels(name).observe(value)
    store.add_quality_sample({"run_id": run_id, "ts": time.time(), "prompt_versions": result.get("prompt_versions"),
                              **scores})


def _callback(job: dict, run_id: str, result: dict) -> None:
    url = job.get("callback_url")
    if not url:
        return
    body = {"run_id": run_id, "status": result["status"], "route": result["determination"]["route"]}
    for attempt in range(3):
        try:
            httpx.post(url, json=body, timeout=5).raise_for_status()
            return
        except httpx.HTTPError:
            time.sleep(2 ** attempt)
    log(logger, "callback failed", logging.WARNING, run_id=run_id, url=url)


def _reaper() -> None:
    while not _stop.wait(15):
        try:
            for run_id in store.reap_expired():
                log(logger, "requeued run from a dead worker", logging.WARNING, run_id=run_id)
        except Exception:
            logger.exception("reaper failed")


def _loop() -> None:
    while not _stop.is_set():
        try:
            job = store.dequeue(timeout_s=5)
        except Exception:
            logger.exception("queue unavailable")
            time.sleep(2)
            continue
        if job is None:
            continue
        try:
            process(job)
        finally:
            store.ack(job)


def main() -> None:
    settings = get_settings()
    start_http_server(settings.worker_metrics_port)
    get_index()  # fail fast if the index is missing; also publishes freshness metrics
    signal.signal(signal.SIGTERM, lambda *_: _stop.set())
    threading.Thread(target=_reaper, daemon=True).start()
    threads = [threading.Thread(target=_loop, daemon=True) for _ in range(int(os.getenv("WORKER_CONCURRENCY", "1")))]
    for t in threads:
        t.start()
    log(logger, "worker ready", concurrency=len(threads))
    while not _stop.is_set():
        _stop.wait(5)
        try:
            metrics.QUEUE_DEPTH.set(store.queue_depth())
        except Exception:
            pass


if __name__ == "__main__":
    main()
