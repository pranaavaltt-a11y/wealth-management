"""Structured JSON logging with a correlation id, and OpenTelemetry tracing (D5)."""
from __future__ import annotations

import contextvars
import json
import logging
import sys
import time
from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.propagate import extract, inject
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app.common.config import get_settings

correlation_id: contextvars.ContextVar[str] = contextvars.ContextVar("correlation_id", default="-")
_configured = False


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        span = trace.get_current_span().get_span_context()
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "service": get_settings().service_name,
            "logger": record.name,
            "msg": record.getMessage(),
            "correlation_id": correlation_id.get(),
            "trace_id": format(span.trace_id, "032x") if span.is_valid else None,
        }
        extra = getattr(record, "fields", None)
        if extra:
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def setup(service_name: str) -> None:
    """Configure logging and tracing once per process."""
    global _configured
    if _configured:
        return
    _configured = True
    settings = get_settings()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level)
    for noisy in ("httpx", "httpcore", "urllib3", "faiss"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    if settings.otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.otlp_endpoint.rstrip("/") + "/v1/traces"))
        )
    trace.set_tracer_provider(provider)


def log(logger: logging.Logger, msg: str, level: int = logging.INFO, **fields) -> None:
    logger.log(level, msg, extra={"fields": fields})


tracer = trace.get_tracer("igr")


@contextmanager
def span(name: str, **attributes):
    with tracer.start_as_current_span(name) as s:
        for key, value in attributes.items():
            if value is not None:
                s.set_attribute(key, value if isinstance(value, (str, int, float, bool)) else str(value))
        yield s


def carrier() -> dict:
    """W3C trace context for propagation through the queue and HTTP calls."""
    headers: dict = {}
    inject(headers)
    headers["X-Correlation-ID"] = correlation_id.get()
    return headers


def context_from(headers: dict):
    return extract(headers or {})
