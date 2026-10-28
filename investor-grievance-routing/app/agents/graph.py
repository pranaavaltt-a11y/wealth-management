"""Multi-agent reasoning layer, built with LangGraph (A1, A2, A3, F3-F7).

Topology:

    guard_input --> intake --> research <-> tools
                                  |
                                  v
                               verify --(fail, attempts left)--> research (new strategy)
                                  |  \\--(fail, no attempts left / verifier down)--> escalate
                                  v
                              finalize (output filter) --> END

* Intake agent      classifies the domain (F3) and establishes product, provider and signals. Hand-off: a
                    `facts` JSON object.
* Research agent    a tool-using loop. The model chooses search_corpus / get_clause / find_modifying_provisions /
                    get_request_field, or returns a draft determination. Hand-off: draft + the evidence retrieved.
* Verifier agent    a separate service (app.verifier). It checks every citation against the retrieved text and
                    returns pass/fail with a suggested strategy. Hand-off back: failure reasons + strategy.

Failure mid-run: if the intake or research model is unavailable, the fallback planner finishes the run but the
result is forced to escalate_to_human and marked degraded. If the verifier is unavailable, the run escalates;
an unverified answer is never returned. If the worker process dies, the queue lease expires and the run is
redelivered once (app.common.store).
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import time
from typing import Any, TypedDict

import httpx
from langgraph.graph import END, StateGraph

from app.agents import guardrails, prompts, tools
from app.common import metrics, store
from app.common.config import get_settings
from app.common.observability import carrier, log, span
from app.llm import policy
from app.llm.client import LLMClient, LLMUnavailable
from app.retrieval.index import get_index
from app.verifier.checks import verify as verify_inprocess

logger = logging.getLogger("agents")


class RunState(TypedDict, total=False):
    run_id: str
    request: dict
    variant: str
    demo_fault: bool
    complaint_payload: dict
    facts: dict
    observations: list
    evidence: dict
    draft: dict | None
    verification: dict | None
    attempt: int
    strategy: str | None
    steps: int
    tool_calls: int
    started_at: float
    degraded: bool
    final: dict | None
    status: str
    escalation_reason: str | None
    guard: dict
    usage: dict
    prompt_refs: dict
    next: str
    pending_action: dict
    drafts: list


class Recorder:
    """Writes every step to the run's event log so the run can be reconstructed from its id (D5)."""

    def __init__(self, run_id: str):
        self.run_id = run_id

    def __call__(self, **event: Any) -> None:
        store.append_event(self.run_id, event)


def _add_usage(state: RunState, agent: str, res) -> None:
    usage = state.setdefault("usage", {})
    entry = usage.setdefault(agent, {"prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0, "calls": 0})
    entry["prompt_tokens"] += res.prompt_tokens
    entry["completion_tokens"] += res.completion_tokens
    entry["cost_usd"] += res.cost_usd
    entry["calls"] += 1


def _complaint_payload(request: dict, guard: dict) -> dict:
    text = request["complaint_text"]
    if guard.get("toxicity", 0) >= 0.35:
        text = guardrails.mask_toxic(text)
    return {"text": guardrails.spotlight(text),
            "entity_name": guardrails.spotlight(request.get("entity_name") or "")[11:-12] or None,
            "entity_type_claimed": request.get("entity_type_claimed"), "product": request.get("product"),
            "incident_date": str(request.get("incident_date")), "first_approached_entity": request.get("first_approached_entity"),
            "today": dt.date.today().isoformat()}


def _dedupe(citations: list[dict]) -> list[dict]:
    seen, out = set(), []
    for c in citations:
        key = (c.get("clause_id"), c.get("quote"))
        if key not in seen:
            seen.add(key)
            out.append(c)
    return out


def build_graph(llm: LLMClient):
    settings = get_settings()

    def guard_input(state: RunState) -> RunState:
        rec = Recorder(state["run_id"])
        req = state["request"]
        fields = {"complaint_text": req.get("complaint_text", ""), "entity_name": req.get("entity_name") or "",
                  "complainant.name": (req.get("complainant") or {}).get("name", "")}
        inj = {k: guardrails.injection_score(v) for k, v in fields.items()}
        worst_field, (worst, hits) = max(inj.items(), key=lambda kv: kv[1][0])
        tox, tox_hits = guardrails.toxicity(req.get("complaint_text", ""))
        guard = {"injection_score": worst, "injection_field": worst_field, "injection_hits": hits,
                 "toxicity": tox, "toxicity_hits": tox_hits}
        rec(type="guard", agent="guard", step="input", **guard)
        if tox >= 0.35:
            metrics.GUARDRAIL.labels("toxicity_input", "masked").inc()
        state["guard"] = guard
        state["complaint_payload"] = _complaint_payload(req, guard)
        if worst >= guardrails.INJECTION_THRESHOLD_BLOCK:
            metrics.GUARDRAIL.labels("injection", "blocked").inc()
            state["escalation_reason"] = "prompt_injection_suspected"
            state["next"] = "escalate"
        else:
            if worst >= guardrails.INJECTION_THRESHOLD_FLAG:
                metrics.GUARDRAIL.labels("injection", "flagged").inc()
            state["next"] = "intake"
        return state

    def intake(state: RunState) -> RunState:
        rec = Recorder(state["run_id"])
        prompt = prompts.load("triage", state["variant"])
        state.setdefault("prompt_refs", {})["triage"] = prompt.ref
        messages = [{"role": "system", "content": prompt.text},
                    {"role": "user", "content": json.dumps({"complaint": state["complaint_payload"]})}]
        started = time.time()
        with span("agent.intake", run_id=state["run_id"], prompt=prompt.ref):
            try:
                res = llm.chat("intake", messages)
                facts = json.loads(res.content)
                _add_usage(state, "intake", res)
                rec(type="llm", agent="intake", step="classify", prompt=prompt.ref, latency_ms=round(res.latency_s * 1000),
                    prompt_tokens=res.prompt_tokens, completion_tokens=res.completion_tokens, cost_usd=res.cost_usd,
                    attempts=res.attempts, output=facts)
            except (LLMUnavailable, json.JSONDecodeError) as exc:
                facts = policy.triage(state["complaint_payload"], provider_first=True)
                state["degraded"] = True
                rec(type="fallback", agent="intake", step="classify", reason=str(exc), output=facts)
        state["facts"] = facts
        state["steps"] = state.get("steps", 0) + 1
        metrics.STEP_LATENCY.labels("intake", "classify").observe(time.time() - started)
        metrics.AGENT_TASKS.labels("intake", "ok").inc()
        return state

    def research(state: RunState) -> RunState:
        rec = Recorder(state["run_id"])
        elapsed = time.time() - state["started_at"]
        if state.get("steps", 0) >= settings.max_steps or state.get("tool_calls", 0) >= settings.max_tool_calls \
                or elapsed >= settings.max_wall_s:
            state["escalation_reason"] = "loop_budget_exhausted"
            rec(type="budget", agent="research", steps=state.get("steps"), tool_calls=state.get("tool_calls"),
                elapsed_s=round(elapsed, 2))
            state["next"] = "escalate"
            return state
        prompt = prompts.load("research", state["variant"])
        state.setdefault("prompt_refs", {})["research"] = prompt.ref
        payload = {"complaint": state["complaint_payload"], "facts": state["facts"],
                   "observations": state.get("observations", []), "strategy": state.get("strategy"),
                   "attempt": state.get("attempt", 1), "demo_fault": state.get("demo_fault", False),
                   "budget": {"steps_left": settings.max_steps - state.get("steps", 0),
                              "tool_calls_left": settings.max_tool_calls - state.get("tool_calls", 0)}}
        if state.get("verification") and not state["verification"]["verified"]:
            payload["verifier_feedback"] = state["verification"]["failure_reasons"]
        messages = [{"role": "system", "content": prompt.text}, {"role": "user", "content": json.dumps(payload)}]
        started = time.time()
        with span("agent.research.step", run_id=state["run_id"], step=state.get("steps", 0), prompt=prompt.ref):
            try:
                res = llm.chat("research", messages)
                action = json.loads(res.content)
                _add_usage(state, "research", res)
                rec(type="llm", agent="research", step=f"plan-{state.get('steps', 0)}", prompt=prompt.ref,
                    latency_ms=round(res.latency_s * 1000), prompt_tokens=res.prompt_tokens,
                    completion_tokens=res.completion_tokens, cost_usd=res.cost_usd, attempts=res.attempts,
                    action=action.get("action"), args=action.get("args"))
            except (LLMUnavailable, json.JSONDecodeError) as exc:
                action = policy.research(payload, check_modifiers=True)
                state["degraded"] = True
                rec(type="fallback", agent="research", step=f"plan-{state.get('steps', 0)}", reason=str(exc),
                    action=action.get("action"), args=action.get("args"))
        state["steps"] = state.get("steps", 0) + 1
        metrics.STEP_LATENCY.labels("research", "plan").observe(time.time() - started)
        if action.get("action") == "final":
            state["draft"] = action.get("determination") or {}
            state["next"] = "verify"
        elif action.get("action") in ("search_corpus", "get_clause", "find_modifying_provisions", "get_request_field"):
            state["pending_action"] = action
            state["next"] = "tools"
        else:
            state.setdefault("observations", []).append({"tool": "invalid", "args": action,
                                                         "result": {"error": "unknown action"}})
            state["next"] = "research"
        return state

    def run_tools(state: RunState) -> RunState:
        rec = Recorder(state["run_id"])
        action = state.pop("pending_action")
        name, args = action["action"], action.get("args") or {}
        fns = {"search_corpus": tools.search_corpus, "get_clause": tools.get_clause,
               "find_modifying_provisions": tools.find_modifying_provisions,
               "get_request_field": tools.make_request_field_tool(state["request"])}
        result, status, latency = tools.run_tool("research", name, fns[name], args)
        state["tool_calls"] = state.get("tool_calls", 0) + 1
        passages = result if isinstance(result, list) else ([result] if isinstance(result, dict) and "clause_id" in result else [])
        evidence = state.setdefault("evidence", {})
        for p in passages:
            evidence.setdefault(p["clause_id"], p)
        state.setdefault("observations", []).append({"tool": name, "args": args, "result": result})
        rec(type="tool", agent="research", tool=name, args=args, status=status, latency_ms=round(latency * 1000),
            passages=[{"clause_id": p["clause_id"], "regulator": p["regulator"], "score": p.get("score"),
                       "text": p["text"]} for p in passages], error=None if status == "ok" else result)
        metrics.STEP_LATENCY.labels("research", f"tool:{name}").observe(latency)
        return state

    def verify(state: RunState) -> RunState:
        rec = Recorder(state["run_id"])
        evidence = list(state.get("evidence", {}).values())
        started = time.time()
        body = {"run_id": state["run_id"], "draft": state["draft"], "evidence": evidence, "facts": state["facts"],
                "complaint_text": state["request"]["complaint_text"]}
        with span("agent.verify.handoff", run_id=state["run_id"], attempt=state.get("attempt", 1)):
            try:
                if settings.verifier_url:
                    resp = httpx.post(settings.verifier_url.rstrip("/") + "/v1/verify", json=body, headers=carrier(),
                                      timeout=settings.verifier_timeout_s)
                    resp.raise_for_status()
                    result = resp.json()
                else:
                    result = verify_inprocess(state["draft"], evidence, state["facts"], state["request"]["complaint_text"])
            except httpx.HTTPError as exc:
                result = {"verified": False, "unavailable": True, "failure_reasons": [f"verifier unavailable: {exc!r}"],
                          "checks": [], "suggested_strategy": None}
        state["steps"] = state.get("steps", 0) + 1
        metrics.STEP_LATENCY.labels("verifier", "handoff").observe(time.time() - started)
        rec(type="verify", agent="verifier", attempt=state.get("attempt", 1), draft=state["draft"], **result,
            latency_ms=round((time.time() - started) * 1000))
        state["verification"] = result
        state.setdefault("drafts", []).append({"attempt": state.get("attempt", 1), "draft": state["draft"],
                                               "verified": result["verified"]})
        if result["verified"]:
            state["next"] = "finalize"
        elif result.get("unavailable"):
            state["escalation_reason"] = "verifier_unavailable"
            state["next"] = "escalate"
        elif state.get("attempt", 1) < settings.max_verify_attempts:
            state["attempt"] = state.get("attempt", 1) + 1
            state["strategy"] = result.get("suggested_strategy") or "requery"
            rec(type="retry", agent="research", attempt=state["attempt"], strategy=state["strategy"])
            state["next"] = "research"
        else:
            state["escalation_reason"] = "verification_failed"
            state["next"] = "escalate"
        return state

    def finalize(state: RunState) -> RunState:
        rec = Recorder(state["run_id"])
        draft = dict(state["draft"])
        violations = guardrails.filter_output(draft)
        if violations:
            metrics.GUARDRAIL.labels("output_filter", "blocked").inc()
            state["escalation_reason"] = "output_filter: " + "; ".join(violations)
            rec(type="guard", agent="guard", step="output", violations=violations)
            return escalate(state)
        if state.get("degraded"):
            state["escalation_reason"] = "degraded_mode_provider_unavailable"
            return escalate(state)
        evidence = state.get("evidence", {})
        draft["citations"] = _dedupe(draft.get("citations", []))
        for c in draft.get("citations", []):
            p = evidence.get(c["clause_id"])
            if p:
                c["document"], c["reference"] = p["document"], p["reference"]
        state["final"] = draft
        state["status"] = "escalated" if draft.get("route") == "escalate_to_human" else "completed"
        rec(type="final", agent="router", route=draft.get("route"), regulator=draft.get("regulator"))
        return state

    def escalate(state: RunState) -> RunState:
        rec = Recorder(state["run_id"])
        reason = state.get("escalation_reason") or "unspecified"
        provisional = state.get("draft")
        verified = bool(state.get("verification", {}) and state["verification"].get("verified"))
        determination = {
            "route": "escalate_to_human",
            "regulator": None,
            "basis": "The system could not produce a verified determination, so a grievance officer must decide.",
            "reason": reason,
            "citations": _dedupe((provisional or {}).get("citations", [])) if verified else [],
            "escalation_path": "Queue for grievance officer review with the full run trace attached.",
            "provisional_determination": provisional if verified else None,
        }
        state["final"] = determination
        state["status"] = "escalated"
        rec(type="final", agent="router", route="escalate_to_human", reason=reason)
        return state

    graph = StateGraph(RunState)
    for name, fn in [("guard_input", guard_input), ("intake", intake), ("research", research), ("tools", run_tools),
                     ("verify", verify), ("finalize", finalize), ("escalate", escalate)]:
        graph.add_node(name, fn)
    graph.set_entry_point("guard_input")
    graph.add_conditional_edges("guard_input", lambda s: s["next"], {"intake": "intake", "escalate": "escalate"})
    graph.add_edge("intake", "research")
    graph.add_conditional_edges("research", lambda s: s["next"],
                                {"tools": "tools", "verify": "verify", "escalate": "escalate", "research": "research"})
    graph.add_edge("tools", "research")
    graph.add_conditional_edges("verify", lambda s: s["next"],
                                {"finalize": "finalize", "research": "research", "escalate": "escalate"})
    graph.add_edge("finalize", END)
    graph.add_edge("escalate", END)
    return graph.compile()


_graph = None
_llm = None


def run_agents(run_id: str, request: dict) -> dict:
    """Execute one run end to end and return the stored result."""
    global _graph, _llm
    if _graph is None:
        _llm = LLMClient()
        _graph = build_graph(_llm)
    settings = get_settings()
    options = request.get("options") or {}
    state: RunState = {
        "run_id": run_id, "request": request, "variant": options.get("prompt_variant") or settings.prompt_variant,
        "demo_fault": bool(options.get("demo_fault")) and settings.demo_faults_enabled,
        "observations": [], "evidence": {}, "attempt": 1, "steps": 0, "tool_calls": 0,
        "started_at": time.time(), "degraded": False, "usage": {},
    }
    with span("run", run_id=run_id):
        final_state = _graph.invoke(state, {"recursion_limit": 4 * settings.max_steps + 10})
    usage = final_state.get("usage", {})
    cost = sum(v["cost_usd"] for v in usage.values())
    result = {
        "status": final_state["status"],
        "determination": final_state["final"],
        "verified": bool(final_state.get("verification") and final_state["verification"].get("verified")),
        "degraded": final_state.get("degraded", False),
        "prompt_versions": final_state.get("prompt_refs", {}),
        "index_version": get_index().version,
        "facts": final_state.get("facts"),
        "guard": final_state.get("guard"),
        "usage": usage,
        "cost_usd": round(cost, 8),
        "tokens": sum(v["prompt_tokens"] + v["completion_tokens"] for v in usage.values()),
        "steps": final_state.get("steps", 0),
        "tool_calls": final_state.get("tool_calls", 0),
        "attempts": final_state.get("attempt", 1),
        "drafts": final_state.get("drafts", []),
        "evidence": list(final_state.get("evidence", {}).values()),
        "verification": final_state.get("verification"),
    }
    metrics.AGENT_STEPS.labels("research").observe(result["steps"])
    metrics.AGENT_TOOL_CALLS.labels("research").observe(result["tool_calls"])
    metrics.AGENT_TASKS.labels("research", "verified" if result["verified"] else "unverified").inc()
    log(logger, "run finished", run_id=run_id, status=result["status"], route=result["determination"]["route"],
        verified=result["verified"], degraded=result["degraded"], steps=result["steps"], cost_usd=result["cost_usd"])
    return result
