"""Tools the research agent may choose to call (A1). All are read-only, and each runs under a timeout."""
from __future__ import annotations

import concurrent.futures as cf
import time

from app.common import metrics, store
from app.common.config import get_settings
from app.common.observability import span
from app.retrieval.index import get_index

REQUEST_FIELDS = {"entity_name", "entity_type_claimed", "product", "amount_involved_inr", "incident_date",
                  "first_approached_entity", "entity_response_date"}
_pool = cf.ThreadPoolExecutor(max_workers=8, thread_name_prefix="tool")


class ToolError(Exception):
    pass


def search_corpus(query: str, regulator: str | None = None, k: int = 5) -> list[dict]:
    index = get_index()
    k = max(1, min(int(k), 8))
    key = store.cache_key("retrieval", index.version, query, regulator, k)
    if get_settings().retrieval_cache_enabled:
        cached = store.cache_get(key)
        if cached is not None:
            metrics.CACHE.labels("retrieval", "hit").inc()
            return cached
        metrics.CACHE.labels("retrieval", "miss").inc()
    results = index.search(query, k=k, regulator=regulator)
    if get_settings().retrieval_cache_enabled:
        store.cache_set(key, results, 3600)
    return results


def get_clause(clause_id: str) -> dict:
    clause = get_index().clause(clause_id)
    if clause is None:
        raise ToolError(f"no clause with id {clause_id!r}")
    return clause


def find_modifying_provisions(clause_id: str) -> list[dict]:
    return get_index().modifiers(clause_id)


def make_request_field_tool(request: dict):
    def get_request_field(name: str):
        if name not in REQUEST_FIELDS:
            raise ToolError(f"field {name!r} is not available; allowed: {sorted(REQUEST_FIELDS)}")
        return {name: request.get(name)}
    return get_request_field


def run_tool(agent: str, name: str, fn, args: dict):
    started = time.time()
    with span(f"tool.{name}", agent=agent, args=str(args)[:300]):
        future = _pool.submit(fn, **args)
        try:
            result = future.result(timeout=get_settings().tool_timeout_s)
            status = "ok"
        except cf.TimeoutError:
            result, status = {"error": f"tool {name} timed out"}, "timeout"
        except (ToolError, TypeError, ValueError) as exc:
            result, status = {"error": str(exc)}, "error"
    metrics.TOOL_CALLS.labels(agent, name, status).inc()
    return result, status, time.time() - started
