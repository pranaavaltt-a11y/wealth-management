"""Runtime configuration. Everything environment-specific comes from environment variables (D4).

Nothing here names a provider endpoint, a credential or a model identifier. Defaults are only for
values that are safe to hard-code (limits, local file paths inside the container).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def _int(name: str, default: int) -> int:
    return int(_env(name, str(default)))


def _float(name: str, default: float) -> float:
    return float(_env(name, str(default)))


def _bool(name: str, default: bool) -> bool:
    return str(_env(name, str(default))).lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    service_name: str = field(default_factory=lambda: _env("SERVICE_NAME", "igr"))
    redis_url: str | None = field(default_factory=lambda: _env("REDIS_URL"))

    # LLM provider (OpenAI-compatible chat completions). "inprocess" uses the scripted stub without HTTP.
    llm_base_url: str | None = field(default_factory=lambda: _env("LLM_BASE_URL"))
    llm_api_key: str | None = field(default_factory=lambda: _env("LLM_API_KEY"))
    llm_model: str | None = field(default_factory=lambda: _env("LLM_MODEL"))
    llm_mode: str = field(default_factory=lambda: _env("LLM_MODE", "http"))  # http | inprocess
    llm_timeout_s: float = field(default_factory=lambda: _float("LLM_TIMEOUT_S", 20.0))
    llm_max_retries: int = field(default_factory=lambda: _int("LLM_MAX_RETRIES", 3))
    llm_backoff_base_s: float = field(default_factory=lambda: _float("LLM_BACKOFF_BASE_S", 0.5))
    cb_failure_threshold: int = field(default_factory=lambda: _int("CB_FAILURE_THRESHOLD", 4))
    cb_reset_after_s: float = field(default_factory=lambda: _float("CB_RESET_AFTER_S", 30.0))
    price_in_per_mtok: float = field(default_factory=lambda: _float("LLM_PRICE_INPUT_PER_MTOK_USD", 0.0))
    price_out_per_mtok: float = field(default_factory=lambda: _float("LLM_PRICE_OUTPUT_PER_MTOK_USD", 0.0))

    # Retrieval
    index_dir: str = field(default_factory=lambda: _env("INDEX_DIR", "/data/index"))
    corpus_dir: str = field(default_factory=lambda: _env("CORPUS_DIR", "/app/corpus"))
    embedding_backend: str = field(default_factory=lambda: _env("EMBEDDING_BACKEND", "hash"))
    embedding_model: str | None = field(default_factory=lambda: _env("EMBEDDING_MODEL"))
    chunking: str = field(default_factory=lambda: _env("CHUNKING", "clause"))  # clause | fixed

    # Agent loop bounds (A1)
    max_steps: int = field(default_factory=lambda: _int("AGENT_MAX_STEPS", 12))
    max_tool_calls: int = field(default_factory=lambda: _int("AGENT_MAX_TOOL_CALLS", 8))
    max_wall_s: float = field(default_factory=lambda: _float("AGENT_MAX_WALL_S", 90.0))
    tool_timeout_s: float = field(default_factory=lambda: _float("TOOL_TIMEOUT_S", 5.0))
    max_verify_attempts: int = field(default_factory=lambda: _int("MAX_VERIFY_ATTEMPTS", 2))
    prompt_variant: str = field(default_factory=lambda: _env("PROMPT_VARIANT", "v2"))

    # Verifier agent service; empty means run the verifier in-process (tests, batch eval)
    verifier_url: str | None = field(default_factory=lambda: _env("VERIFIER_URL"))
    verifier_timeout_s: float = field(default_factory=lambda: _float("VERIFIER_TIMEOUT_S", 10.0))

    # API
    rate_limit_per_min: int = field(default_factory=lambda: _int("RATE_LIMIT_PER_MIN", 30))
    run_cache_ttl_s: int = field(default_factory=lambda: _int("RUN_CACHE_TTL_S", 86400))
    run_cache_enabled: bool = field(default_factory=lambda: _bool("RUN_CACHE_ENABLED", True))
    retrieval_cache_enabled: bool = field(default_factory=lambda: _bool("RETRIEVAL_CACHE_ENABLED", True))
    demo_faults_enabled: bool = field(default_factory=lambda: _bool("DEMO_FAULTS_ENABLED", False))
    online_eval_sample_rate: float = field(default_factory=lambda: _float("ONLINE_EVAL_SAMPLE_RATE", 0.2))

    # Observability
    otlp_endpoint: str | None = field(default_factory=lambda: _env("OTEL_EXPORTER_OTLP_ENDPOINT"))
    log_level: str = field(default_factory=lambda: _env("LOG_LEVEL", "INFO"))
    worker_metrics_port: int = field(default_factory=lambda: _int("WORKER_METRICS_PORT", 9100))


def get_settings() -> Settings:
    return Settings()
