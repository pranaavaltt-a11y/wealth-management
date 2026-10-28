"""Generate the Grafana dashboard JSON (python ops/build_dashboard.py)."""
import json
from pathlib import Path

PANELS = [
    # (title, unit, [(expr, legend)], width)
    ("Complete run latency p50 / p95 (submission to result)", "s", [
        ("histogram_quantile(0.50, sum(rate(igr_run_seconds_bucket[1m])) by (le))", "p50"),
        ("histogram_quantile(0.95, sum(rate(igr_run_seconds_bucket[1m])) by (le))", "p95"),
        ("20", "SLO p95 target")], 12),
    ("Throughput (finished runs / s)", "reqps", [("sum(rate(igr_runs_finished_total[1m]))", "runs/s"),
                                                 ("sum(rate(igr_runs_submitted_total[1m]))", "submitted/s")], 12),
    ("Error rate", "percentunit", [
        ("sum(rate(igr_runs_finished_total{outcome=\"failed\"}[5m])) / clamp_min(sum(rate(igr_runs_finished_total[5m])), 1e-9)", "failed runs"),
        ("sum(rate(igr_http_requests_total{status=~\"5..\"}[5m])) / clamp_min(sum(rate(igr_http_requests_total[5m])), 1e-9)", "HTTP 5xx")], 8),
    ("Availability (targets up)", "percentunit", [("avg by (job) (up)", "{{job}}")], 8),
    ("Queue depth", "short", [("max(igr_queue_depth)", "waiting runs")], 8),
    ("CPU per container", "percentunit", [("sum by (name) (rate(container_cpu_usage_seconds_total{name=~\".+\"}[1m]))", "{{name}}")], 12),
    ("Memory per container", "bytes", [("sum by (name) (container_memory_working_set_bytes{name=~\".+\"})", "{{name}}")], 12),
    ("Task success rate per agent", "percentunit", [
        ("sum by (agent) (rate(igr_agent_tasks_total{outcome=~\"ok|verified|pass\"}[5m])) / sum by (agent) (rate(igr_agent_tasks_total[5m]))", "{{agent}}")], 8),
    ("Steps and tool calls per run", "short", [
        ("sum(rate(igr_agent_steps_per_run_sum[5m])) / sum(rate(igr_agent_steps_per_run_count[5m]))", "steps/run"),
        ("sum(rate(igr_agent_tool_calls_per_run_sum[5m])) / sum(rate(igr_agent_tool_calls_per_run_count[5m]))", "tool calls/run")], 8),
    ("Model retry rate per agent", "percentunit", [
        ("sum by (agent) (rate(igr_llm_retries_total[5m])) / clamp_min(sum by (agent) (rate(igr_llm_calls_total[5m])), 1e-9)", "{{agent}}")], 8),
    ("Per-step latency p95", "s", [
        ("histogram_quantile(0.95, sum by (le, agent, step) (rate(igr_agent_step_seconds_bucket[5m])))", "{{agent}} {{step}}")], 12),
    ("Container / process uptime", "s", [("time() - process_start_time_seconds", "{{job}} {{instance}}")], 12),
    ("Circuit breaker open", "short", [("max by (instance) (igr_circuit_breaker_open)", "{{instance}}")], 6),
    ("Cost per run (USD)", "currencyUSD", [
        ("sum(rate(igr_llm_cost_usd_total[5m])) / clamp_min(sum(rate(igr_runs_finished_total[5m])), 1e-9)", "cost/run")], 6),
    ("Tokens / s by agent", "short", [("sum by (agent, kind) (rate(igr_llm_tokens_total[5m]))", "{{agent}} {{kind}}")], 6),
    ("Cache hit ratio", "percentunit", [
        ("sum by (cache) (rate(igr_cache_total{result=\"hit\"}[5m])) / sum by (cache) (rate(igr_cache_total[5m]))", "{{cache}}")], 6),
    ("Online quality of sampled live runs", "short", [
        ("sum by (metric) (rate(igr_online_quality_sum[15m])) / sum by (metric) (rate(igr_online_quality_count[15m]))", "{{metric}}")], 12),
    ("Guardrails, quarantine and rate limiting", "short", [
        ("sum by (guard, action) (increase(igr_guardrail_events_total[15m]))", "{{guard}} {{action}}"),
        ("sum(increase(igr_quarantined_total[15m]))", "quarantined"),
        ("sum(increase(igr_rate_limited_total[15m]))", "rate limited")], 12),
    ("Index freshness (age) and size", "s", [("time() - max(igr_index_built_timestamp_seconds)", "index age"),
                                             ("max(igr_index_chunks)", "chunks")], 12),
    ("Run outcomes", "short", [("sum by (outcome, route, degraded) (increase(igr_runs_finished_total[15m]))",
                                "{{outcome}} {{route}} degraded={{degraded}}")], 12),
]

panels, x, y, row_h = [], 0, 0, 8
for i, (title, unit, targets, w) in enumerate(PANELS):
    if x + w > 24:
        x, y = 0, y + row_h
    panels.append({
        "id": i + 1, "type": "timeseries", "title": title, "datasource": {"type": "prometheus", "uid": "prometheus"},
        "gridPos": {"x": x, "y": y, "w": w, "h": row_h},
        "fieldConfig": {"defaults": {"unit": unit}, "overrides": []},
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}},
        "targets": [{"refId": chr(65 + j), "expr": e, "legendFormat": l} for j, (e, l) in enumerate(targets)],
    })
    x += w

dashboard = {"uid": "igr-main", "title": "Grievance Routing — service and agents", "schemaVersion": 39, "version": 1,
             "refresh": "5s", "time": {"from": "now-30m", "to": "now"}, "panels": panels, "tags": ["igr"]}
out = Path(__file__).parent / "grafana" / "dashboards" / "igr.json"
out.write_text(json.dumps(dashboard, indent=1))
print("wrote", out)
