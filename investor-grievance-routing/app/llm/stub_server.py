"""Stub LLM provider (D6). OpenAI-compatible `/v1/chat/completions` with a realistic, configurable delay.

Fault injection for the demonstration (A5): `POST /admin/fault {"mode": "down"}` makes every call fail with
503 so the circuit breaker opens; `{"mode": "slow"}` exceeds the client timeout; `{"mode": "ok"}` restores.
"""
from __future__ import annotations

import asyncio
import os
import random
import time

from fastapi import FastAPI, HTTPException
from prometheus_client import Counter, Histogram, make_asgi_app
from pydantic import BaseModel

from app.llm import policy

DELAY_MEAN_MS = float(os.getenv("STUB_DELAY_MEAN_MS", "900"))
DELAY_JITTER_MS = float(os.getenv("STUB_DELAY_JITTER_MS", "300"))
app = FastAPI(title="LLM stub provider")
app.mount("/metrics", make_asgi_app())
CALLS = Counter("igr_stub_calls_total", "Stub calls", ["status"])
DELAY = Histogram("igr_stub_delay_seconds", "Injected delay")
state = {"mode": os.getenv("STUB_FAULT_MODE", "ok"), "since": time.time()}


class Fault(BaseModel):
    mode: str  # ok | down | slow | flaky


@app.get("/health")
def health():
    return {"status": "ok", "fault_mode": state["mode"]}


@app.post("/admin/fault")
def set_fault(fault: Fault):
    if fault.mode not in ("ok", "down", "slow", "flaky"):
        raise HTTPException(422, "mode must be ok, down, slow or flaky")
    state.update(mode=fault.mode, since=time.time())
    return state


@app.post("/v1/chat/completions")
async def chat(body: dict):
    mode = state["mode"]
    if mode == "down" or (mode == "flaky" and random.random() < 0.5):
        CALLS.labels("injected_503").inc()
        raise HTTPException(503, "provider unavailable (injected)")
    delay = max(0.05, random.gauss(DELAY_MEAN_MS, DELAY_JITTER_MS) / 1000)
    if mode == "slow":
        delay = 60
    DELAY.observe(delay)
    await asyncio.sleep(delay)
    messages = body["messages"]
    content = policy.respond(messages)
    CALLS.labels("ok").inc()
    prompt_tokens = sum(len(m["content"]) for m in messages) // 4
    return {"id": f"stub-{random.getrandbits(32):x}", "object": "chat.completion", "model": body.get("model") or "stub",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": len(content) // 4,
                      "total_tokens": prompt_tokens + len(content) // 4}}
