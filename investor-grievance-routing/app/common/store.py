"""Redis-backed run store, work queue, quarantine, feedback, caches and rate limiter.

The queue sits between submission (API) and execution (agent workers) as A4 requires. It is a
reliable queue: a worker atomically moves a job from `q:runs` to `q:processing` and holds a lease;
a reaper puts back jobs whose lease expired because a worker died mid-run.
"""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Any

import redis

from app.common.config import get_settings

QUEUE = "q:runs"
PROCESSING = "q:processing"
LEASE_S = 120
MAX_DELIVERIES = 2

_client: redis.Redis | None = None


def client() -> redis.Redis:
    global _client
    if _client is None:
        url = get_settings().redis_url
        if url:
            _client = redis.Redis.from_url(url, decode_responses=True, socket_timeout=10, health_check_interval=30)
        else:  # tests and batch evaluation run without a Redis server
            import fakeredis

            _client = fakeredis.FakeRedis(decode_responses=True)
    return _client


def new_run_id() -> str:
    return "run_" + uuid.uuid4().hex[:16]


# --- runs -----------------------------------------------------------------------------------------

def save_run(run: dict) -> None:
    client().set(f"run:{run['run_id']}", json.dumps(run, default=str))


def get_run(run_id: str) -> dict | None:
    raw = client().get(f"run:{run_id}")
    return json.loads(raw) if raw else None


def update_run(run_id: str, **fields) -> dict:
    run = get_run(run_id) or {"run_id": run_id}
    run.update(fields)
    save_run(run)
    return run


def append_event(run_id: str, event: dict) -> None:
    event.setdefault("ts", time.time())
    client().rpush(f"run:{run_id}:events", json.dumps(event, default=str))


def get_events(run_id: str) -> list[dict]:
    return [json.loads(e) for e in client().lrange(f"run:{run_id}:events", 0, -1)]


def recent_run_ids(limit: int = 50) -> list[str]:
    return client().lrange("runs:recent", 0, limit - 1)


def remember_run(run_id: str) -> None:
    pipe = client().pipeline()
    pipe.lpush("runs:recent", run_id)
    pipe.ltrim("runs:recent", 0, 999)
    pipe.execute()


# --- queue ----------------------------------------------------------------------------------------

def enqueue(job: dict) -> None:
    client().lpush(QUEUE, json.dumps(job))


def queue_depth() -> int:
    return client().llen(QUEUE)


def dequeue(timeout_s: int = 5) -> dict | None:
    raw = client().blmove(QUEUE, PROCESSING, timeout_s, "RIGHT", "LEFT")
    if not raw:
        return None
    job = json.loads(raw)
    job["_raw"] = raw
    client().set(f"lease:{job['run_id']}", "1", ex=LEASE_S)
    return job


def renew_lease(run_id: str) -> None:
    client().set(f"lease:{run_id}", "1", ex=LEASE_S)


def ack(job: dict) -> None:
    client().lrem(PROCESSING, 1, job["_raw"])
    client().delete(f"lease:{job['run_id']}")


def reap_expired() -> list[str]:
    """Requeue jobs whose worker died; give up after MAX_DELIVERIES. Returns the run ids touched."""
    touched = []
    for raw in client().lrange(PROCESSING, 0, -1):
        job = json.loads(raw)
        if client().exists(f"lease:{job['run_id']}"):
            continue
        if client().lrem(PROCESSING, 1, raw) == 0:
            continue  # another reaper got it
        job["deliveries"] = job.get("deliveries", 1) + 1
        if job["deliveries"] > MAX_DELIVERIES:
            update_run(job["run_id"], status="failed", error="worker died twice during this run; escalate manually",
                       finished_at=time.time())
        else:
            client().lpush(QUEUE, json.dumps(job))
        touched.append(job["run_id"])
    return touched


# --- quarantine, feedback ---------------------------------------------------------------------------

def quarantine(raw_body: Any, errors: list[dict], client_id: str, reason: str) -> str:
    qid = "q_" + uuid.uuid4().hex[:12]
    record = {"quarantine_id": qid, "received_at": time.time(), "client_id": client_id, "reason": reason,
              "errors": errors, "payload": raw_body}
    pipe = client().pipeline()
    pipe.lpush("quarantine", json.dumps(record, default=str))
    pipe.ltrim("quarantine", 0, 9999)
    pipe.execute()
    return qid


def list_quarantine(limit: int = 50) -> list[dict]:
    return [json.loads(r) for r in client().lrange("quarantine", 0, limit - 1)]


def add_feedback(run_id: str, satisfactory: bool, reason: str, client_id: str) -> dict:
    record = {"run_id": run_id, "satisfactory": satisfactory, "reason": reason, "client_id": client_id,
              "ts": time.time()}
    pipe = client().pipeline()
    pipe.rpush("feedback", json.dumps(record))
    pipe.hincrby("feedback:agg", "satisfactory" if satisfactory else "unsatisfactory", 1)
    pipe.execute()
    return record


def feedback_summary() -> dict:
    agg = client().hgetall("feedback:agg")
    good, bad = int(agg.get("satisfactory", 0)), int(agg.get("unsatisfactory", 0))
    reasons: dict[str, int] = {}
    for raw in client().lrange("feedback", -500, -1):
        rec = json.loads(raw)
        if not rec["satisfactory"]:
            key = (rec.get("reason") or "unspecified").strip().lower()[:60]
            reasons[key] = reasons.get(key, 0) + 1
    total = good + bad
    return {"total": total, "satisfactory": good, "unsatisfactory": bad,
            "satisfaction_rate": round(good / total, 3) if total else None,
            "top_unsatisfactory_reasons": sorted(reasons.items(), key=lambda kv: -kv[1])[:5]}


def add_quality_sample(sample: dict) -> None:
    pipe = client().pipeline()
    pipe.rpush("quality:timeline", json.dumps(sample))
    pipe.ltrim("quality:timeline", -2000, -1)
    pipe.execute()


def quality_timeline(limit: int = 500) -> list[dict]:
    return [json.loads(r) for r in client().lrange("quality:timeline", -limit, -1)]


# --- caches and rate limit ------------------------------------------------------------------------

def cache_key(namespace: str, *parts: Any) -> str:
    digest = hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:32]
    return f"cache:{namespace}:{digest}"


def cache_get(key: str) -> Any | None:
    raw = client().get(key)
    return json.loads(raw) if raw else None


def cache_set(key: str, value: Any, ttl_s: int) -> None:
    client().set(key, json.dumps(value, default=str), ex=ttl_s)


def rate_limited(client_id: str, limit_per_min: int) -> tuple[bool, int]:
    """Fixed one-minute window per client. Returns (limited, seconds until the window resets)."""
    window = int(time.time() // 60)
    key = f"rl:{client_id}:{window}"
    pipe = client().pipeline()
    pipe.incr(key)
    pipe.expire(key, 65)
    count, _ = pipe.execute()
    return count > limit_per_min, 60 - int(time.time() % 60)
