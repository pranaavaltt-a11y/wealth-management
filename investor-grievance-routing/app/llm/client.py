"""Provider-agnostic model client (A5, L5).

The model sits behind this interface, so the provider is chosen by configuration only:
LLM_BASE_URL points at any OpenAI-compatible chat-completions endpoint (the bundled stub, Groq, Gemini's
OpenAI endpoint, a local Ollama server ...). Every call has a timeout, retries with exponential backoff
and jitter, and goes through a circuit breaker. Tokens and cost are recorded at the time of the call.
"""
from __future__ import annotations

import random
import threading
import time
from dataclasses import dataclass

import httpx

from app.common import metrics
from app.common.config import get_settings
from app.common.observability import carrier, span


class LLMUnavailable(Exception):
    """The provider could not produce an answer (retries exhausted or circuit open)."""


class CircuitOpen(LLMUnavailable):
    pass


class CircuitBreaker:
    """closed -> open after N consecutive failures -> half-open after a cool-down -> closed on success."""

    def __init__(self, threshold: int, reset_after_s: float):
        self.threshold, self.reset_after_s = threshold, reset_after_s
        self.failures, self.opened_at, self.state = 0, 0.0, "closed"
        self._lock = threading.Lock()

    def before_call(self) -> None:
        with self._lock:
            if self.state == "open":
                if time.time() - self.opened_at >= self.reset_after_s:
                    self.state = "half_open"
                else:
                    raise CircuitOpen(f"circuit open for another {self.reset_after_s - (time.time() - self.opened_at):.0f}s")

    def success(self) -> None:
        with self._lock:
            self.failures, self.state = 0, "closed"
            metrics.CIRCUIT_STATE.set(0)

    def failure(self) -> None:
        with self._lock:
            self.failures += 1
            if self.state == "half_open" or self.failures >= self.threshold:
                self.state, self.opened_at = "open", time.time()
                metrics.CIRCUIT_STATE.set(1)

    def snapshot(self) -> dict:
        return {"state": self.state, "consecutive_failures": self.failures, "opened_at": self.opened_at or None}


@dataclass
class LLMResult:
    content: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    latency_s: float
    attempts: int


_breaker: CircuitBreaker | None = None


def breaker() -> CircuitBreaker:
    global _breaker
    if _breaker is None:
        s = get_settings()
        _breaker = CircuitBreaker(s.cb_failure_threshold, s.cb_reset_after_s)
    return _breaker


def _cost(prompt_tokens: int, completion_tokens: int) -> float:
    s = get_settings()
    return prompt_tokens * s.price_in_per_mtok / 1e6 + completion_tokens * s.price_out_per_mtok / 1e6


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


class LLMClient:
    def __init__(self):
        self.settings = get_settings()
        self._http = httpx.Client(timeout=self.settings.llm_timeout_s) if self.settings.llm_mode == "http" else None

    def chat(self, agent: str, messages: list[dict], temperature: float = 0.0) -> LLMResult:
        s = self.settings
        cb = breaker()
        cb.before_call()
        started = time.time()
        last_error: Exception | None = None
        for attempt in range(1, s.llm_max_retries + 1):
            try:
                with span("llm.call", agent=agent, attempt=attempt, mode=s.llm_mode):
                    content, usage = self._once(messages, temperature)
                cb.success()
                pt = usage.get("prompt_tokens") or _estimate_tokens("".join(m["content"] for m in messages))
                ct = usage.get("completion_tokens") or _estimate_tokens(content)
                cost = _cost(pt, ct)
                latency = time.time() - started
                metrics.LLM_CALLS.labels(agent, "ok").inc()
                metrics.LLM_LATENCY.labels(agent).observe(latency)
                metrics.LLM_TOKENS.labels(agent, "prompt").inc(pt)
                metrics.LLM_TOKENS.labels(agent, "completion").inc(ct)
                metrics.LLM_COST.labels(agent).inc(cost)
                return LLMResult(content, pt, ct, cost, latency, attempt)
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                last_error = exc
                metrics.LLM_CALLS.labels(agent, "error").inc()
                retryable = not (isinstance(exc, httpx.HTTPStatusError) and 400 <= exc.response.status_code < 500
                                 and exc.response.status_code != 429)
                if not retryable or attempt == s.llm_max_retries:
                    break
                metrics.LLM_RETRIES.labels(agent).inc()
                time.sleep(s.llm_backoff_base_s * (2 ** (attempt - 1)) * (0.5 + random.random()))
        cb.failure()
        raise LLMUnavailable(f"model call failed after retries: {last_error!r}")

    def _once(self, messages: list[dict], temperature: float) -> tuple[str, dict]:
        s = self.settings
        if s.llm_mode == "inprocess":
            from app.llm import policy

            return policy.respond(messages), {}
        if not s.llm_base_url:
            raise LLMUnavailable("LLM_BASE_URL is not configured")
        headers = carrier()
        if s.llm_api_key:
            headers["Authorization"] = f"Bearer {s.llm_api_key}"
        body = {"model": s.llm_model, "messages": messages, "temperature": temperature,
                "response_format": {"type": "json_object"}}
        resp = self._http.post(s.llm_base_url.rstrip("/") + "/chat/completions", json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"], data.get("usage") or {}
