"""Prometheus metrics shared by the API, the agent workers and the verifier (A6, D2, D5, L5, L6)."""
from prometheus_client import Counter, Gauge, Histogram

LATENCY_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120)

# Ingestion boundary
REQUESTS = Counter("igr_http_requests_total", "HTTP requests", ["route", "method", "status"])
REQUEST_LATENCY = Histogram("igr_http_request_seconds", "HTTP request latency", ["route"], buckets=LATENCY_BUCKETS)
QUARANTINED = Counter("igr_quarantined_total", "Requests rejected at the ingestion boundary", ["reason"])
RUNS_SUBMITTED = Counter("igr_runs_submitted_total", "Runs accepted and enqueued")
RUNS_STARTED = Counter("igr_runs_started_total", "Agent runs started by a worker")
RATE_LIMITED = Counter("igr_rate_limited_total", "Requests rejected by the per-client rate limit")
CACHE = Counter("igr_cache_total", "Cache lookups", ["cache", "result"])
QUEUE_DEPTH = Gauge("igr_queue_depth", "Jobs waiting in the run queue")

# Whole runs
RUNS_FINISHED = Counter("igr_runs_finished_total", "Finished runs", ["outcome", "route", "degraded"])
RUN_LATENCY = Histogram("igr_run_seconds", "Complete run latency, submission to final result", buckets=LATENCY_BUCKETS)
QUEUE_WAIT = Histogram("igr_queue_wait_seconds", "Time a run waited in the queue", buckets=LATENCY_BUCKETS)

# Per agent (A6)
AGENT_TASKS = Counter("igr_agent_tasks_total", "Agent task outcomes", ["agent", "outcome"])
AGENT_STEPS = Histogram("igr_agent_steps_per_run", "Steps per run", ["agent"], buckets=(1, 2, 3, 4, 5, 6, 8, 10, 12, 16))
AGENT_TOOL_CALLS = Histogram("igr_agent_tool_calls_per_run", "Tool calls per run", ["agent"], buckets=(0, 1, 2, 3, 4, 5, 6, 8, 10))
STEP_LATENCY = Histogram("igr_agent_step_seconds", "Latency of one agent step", ["agent", "step"], buckets=LATENCY_BUCKETS)
TOOL_CALLS = Counter("igr_tool_calls_total", "Tool calls", ["agent", "tool", "status"])
VERIFICATIONS = Counter("igr_verifications_total", "Verification outcomes", ["result"])

# Model provider (A5, L5)
LLM_CALLS = Counter("igr_llm_calls_total", "Model calls", ["agent", "status"])
LLM_RETRIES = Counter("igr_llm_retries_total", "Model call retries", ["agent"])
LLM_LATENCY = Histogram("igr_llm_call_seconds", "Model call latency", ["agent"], buckets=LATENCY_BUCKETS)
LLM_TOKENS = Counter("igr_llm_tokens_total", "Model tokens", ["agent", "kind"])
LLM_COST = Counter("igr_llm_cost_usd_total", "Model cost in USD", ["agent"])
CIRCUIT_STATE = Gauge("igr_circuit_breaker_open", "1 when the provider circuit breaker is open")

# Index freshness (D2)
INDEX_BUILT_AT = Gauge("igr_index_built_timestamp_seconds", "Unix time the index was built")
INDEX_CHUNKS = Gauge("igr_index_chunks", "Chunks in the index")
INDEX_DOCS = Gauge("igr_index_documents", "Documents in the index")
INGEST_THROUGHPUT = Gauge("igr_ingest_chunks_per_second", "Throughput of the last ingestion run")

# Online quality (L6)
ONLINE_QUALITY = Histogram("igr_online_quality", "Automatic quality score of sampled live runs", ["metric"],
                           buckets=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0))
FEEDBACK = Counter("igr_feedback_total", "Caller feedback", ["satisfactory"])
GUARDRAIL = Counter("igr_guardrail_events_total", "Guardrail events", ["guard", "action"])
