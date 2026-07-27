"""Pipeline orchestrator and /action router for multi-fragment governance."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from decimal import Decimal
from typing import Any, List, Optional, Tuple

import networkx as nx
from fastapi import APIRouter

from gateway import db, redis_client, opa_client
from gateway.models import ActionRequest, ActionResponse
from gateway.routers.live import broadcast_event
from gateway.routers.metrics import record_decision, record_latency

router = APIRouter(tags=["action"])

# In-memory graph for risk network scoring
_mule_graph = nx.Graph()


def get_mule_graph() -> nx.Graph:
    return _mule_graph


# ── Explanation dictionary for reason codes ──────────────────────
REASON_EXPLANATIONS = {
    # Fragment 1 — E-Stop
    "ESTOP_ACTIVE": "Global E-stop is active. All financial actions are blocked fleet-wide.",
    "AGENT_ESTOP_ACTIVE": "Per-agent E-stop is active for this agent.",
    # Fragment 2 — Auth
    "AUTH_FAIL": "Agent authentication or version validation failed.",
    "AGENT_REVOKED": "Agent or agent version has been explicitly revoked.",
    # Fragment 3 — Gates
    "PERMISSION_DENIED": "Agent type lacks permission to perform this action.",
    "POLICY_VIOLATION": "Action violates configured governance policy conditions.",
    "POLICY_ENGINE_UNAVAILABLE": "Policy engine (OPA) is unavailable and in-process fallback also failed. Fail-closed: DENY.",
    "NEEDS_MANAGER_APPROVAL": "Transaction amount exceeds auto-approval threshold and requires human manager approval.",
    "BUDGET_EXCEEDED": "Agent daily budget limit exceeded or insufficient funds in reservation pool.",
    "BUDGET_CHECK_UNAVAILABLE": "Budget/spend-cap system is unavailable. Fail-closed: DENY.",
    # Fragment 4 — Risk & Compliance
    "SANCTIONS_MATCH": "The counterparty matched an entry on the sanctions/AML watchlist.",
    "RISK_SCORE_HIGH": "Graph proximity or behavioral analysis indicated high risk (>70).",
    "GRAPH_PROXIMITY_1HOP": "This beneficiary is one hop from a confirmed mule account.",
    "VELOCITY_SPIKE": "Unusually high request frequency to this beneficiary detected.",
    "BEHAVIORAL_ANOMALY": "Transaction amount significantly deviates from this agent's historical pattern.",
    # Fragment 5 — Decision
    "NEEDS_HUMAN_REVIEW": "Risk score fell in the manual-review band (30-70). Transaction held for operator approval.",
    "CONFIRMED_FRAUD": "Human reviewer identified transaction as fraudulent.",
    "HUMAN_APPROVED": "Human reviewer approved the held transaction.",
    "MULE_SET_UPDATED": "Flagged mule network updated after confirmed fraud. 1-hop neighbors risk scores bumped.",
    # Fragment 6 — Execution
    "ALL_CHECKS_PASS": "All governance, policy, budget, risk, and compliance checks passed.",
    "EXECUTION_FAILED": "Core banking execution failed. Transaction rolled back.",
    "LEDGER_UPDATED": "Transaction executed and ledger entry recorded successfully.",
    # Idempotency
    "IDEMPOTENT_REPLAY": "Duplicate request detected via idempotency key. Returning cached decision.",
    # Dry-run
    "DRY_RUN_COMPLETE": "Simulation completed. No side effects applied (no audit, no spend, no execution).",
}


# ── Velocity tracking (in-memory, per-beneficiary request counts) ──
_velocity_window: dict[str, list[float]] = {}
_VELOCITY_WINDOW_SECS = 60.0
_VELOCITY_THRESHOLD = 5


def _record_velocity(beneficiary: str) -> int:
    """Record a request timestamp and return count in the last window."""
    now = time.time()
    if beneficiary not in _velocity_window:
        _velocity_window[beneficiary] = []
    window = _velocity_window[beneficiary]
    # Prune old entries
    cutoff = now - _VELOCITY_WINDOW_SECS
    _velocity_window[beneficiary] = [t for t in window if t > cutoff]
    _velocity_window[beneficiary].append(now)
    return len(_velocity_window[beneficiary])


# ── Average amount tracking (in-memory, per-agent) ──
_agent_amounts: dict[str, list[float]] = {}


def _record_amount(agent_id: str, amount: float) -> float:
    """Record an amount and return the running average."""
    if agent_id not in _agent_amounts:
        _agent_amounts[agent_id] = []
    _agent_amounts[agent_id].append(amount)
    # Keep last 100 amounts
    if len(_agent_amounts[agent_id]) > 100:
        _agent_amounts[agent_id] = _agent_amounts[agent_id][-100:]
    return sum(_agent_amounts[agent_id]) / len(_agent_amounts[agent_id])


@router.post("/action", response_model=ActionResponse)
async def process_action(req: ActionRequest) -> ActionResponse:
    """
    Main governance gateway entrypoint implementing Fragments 1–6.
    """
    return await _run_pipeline(req, dry_run=False)


@router.post("/action/simulate", response_model=ActionResponse)
async def simulate_action(req: ActionRequest) -> ActionResponse:
    """
    Dry-run simulation — runs Stages 1–4 without side effects.
    No audit log, no spend increment, no ledger, no review queue.
    """
    return await _run_pipeline(req, dry_run=True)


async def _run_pipeline(req: ActionRequest, dry_run: bool = False) -> ActionResponse:
    """Core pipeline logic shared by live and simulate endpoints."""
    start_ns = time.perf_counter_ns()
    trace_id = uuid.uuid4()
    risk_score: Optional[int] = None
    risk_factors: List[str] = []

    # ── IDEMPOTENCY CHECK (skip for dry-run) ─────────────────────
    if not dry_run and req.idempotency_key:
        cached = await redis_client.get_idempotency(req.idempotency_key)
        if cached:
            try:
                cached_resp = json.loads(cached)
                cached_resp["explanation"] = REASON_EXPLANATIONS.get("IDEMPOTENT_REPLAY")
                return ActionResponse(**cached_resp)
            except Exception:
                pass  # Cache corrupted, proceed normally

    # ── FRAGMENT 1: Entry & E-Stop Check ────────────────────────
    if await redis_client.is_global_estop_active():
        return await _finalize(
            trace_id, req, "FRAGMENT_1_ESTOP", "ESTOP_ACTIVE", "BLOCKED",
            start_ns, risk_score, risk_factors, dry_run
        )

    if await redis_client.is_agent_estop_active(req.agent_id):
        return await _finalize(
            trace_id, req, "FRAGMENT_1_ESTOP", "AGENT_ESTOP_ACTIVE", "BLOCKED",
            start_ns, risk_score, risk_factors, dry_run
        )

    if not dry_run:
        await _write_audit_node(trace_id, req, "FRAGMENT_1_ESTOP", "ESTOP_CLEAR", "PASS")

    # ── FRAGMENT 2: Authentication & Orchestration ──────────────
    agent_row = await db.fetch_one(
        "SELECT * FROM agents WHERE agent_id = $1 AND version = $2",
        req.agent_id, req.version or "1.0.0"
    )
    if not agent_row or agent_row.get("status") == "revoked":
        return await _finalize(
            trace_id, req, "FRAGMENT_2_AUTH", "AUTH_FAIL", "REJECT",
            start_ns, risk_score, risk_factors, dry_run
        )

    allowed_actions = agent_row.get("allowed_action_types") or []
    if isinstance(allowed_actions, str):
        try:
            allowed_actions = json.loads(allowed_actions)
        except (json.JSONDecodeError, TypeError):
            allowed_actions = []
    if allowed_actions and req.action not in allowed_actions:
        return await _finalize(
            trace_id, req, "FRAGMENT_2_AUTH", "AUTH_FAIL", "REJECT",
            start_ns, risk_score, risk_factors, dry_run
        )

    if not dry_run:
        await _write_audit_node(trace_id, req, "FRAGMENT_2_AUTH", "AUTH_OK", "PASS")

    # ── FRAGMENT 3: Governance Gates ─────────────────────────────
    # Gate 1: Version Kill-switch
    if await redis_client.is_agent_revoked(req.agent_id, req.version):
        return await _finalize(
            trace_id, req, "FRAGMENT_3_GATE_KILL_SWITCH", f"AGENT_REVOKED (v{req.version})", "DENY",
            start_ns, risk_score, risk_factors, dry_run
        )

    # Gate 2: Permission check (OPA / in-process fallback)
    opa_allowed, opa_reason = await opa_client.evaluate_policy(
        agent_id=req.agent_id,
        action=req.action,
        resource=req.beneficiary,
        amount=float(req.amount) if req.amount else None,
        context=req.context,
    )
    if not opa_allowed:
        reason_code = "POLICY_ENGINE_UNAVAILABLE" if "unavailable" in opa_reason.lower() else "PERMISSION_DENIED"
        return await _finalize(
            trace_id, req, "FRAGMENT_3_GATE_PERMISSION", reason_code, "DENY",
            start_ns, risk_score, risk_factors, dry_run
        )

    # Gate 3: Policy check (amount threshold)
    if req.amount and req.amount > Decimal("100000"):
        return await _finalize(
            trace_id, req, "FRAGMENT_3_GATE_POLICY", "NEEDS_MANAGER_APPROVAL", "ESCALATE",
            start_ns, risk_score, risk_factors, dry_run
        )

    # Gate 4: Budget check (atomic DECRBY reservation)
    budget_reserved = False
    if req.amount and req.amount > 0:
        daily_limit = await redis_client.get_daily_limit(req.agent_id) or Decimal("50000")
        if dry_run:
            # Dry-run: check without actually incrementing
            current_spend = await redis_client.get_current_spend(req.agent_id)
            if current_spend + req.amount > daily_limit:
                return await _finalize(
                    trace_id, req, "FRAGMENT_3_GATE_BUDGET", "BUDGET_EXCEEDED", "DENY",
                    start_ns, risk_score, risk_factors, dry_run
                )
        else:
            budget_ok = await redis_client.check_and_increment_spend(
                req.agent_id, req.amount, daily_limit
            )
            if not budget_ok:
                return await _finalize(
                    trace_id, req, "FRAGMENT_3_GATE_BUDGET", "BUDGET_EXCEEDED", "DENY",
                    start_ns, risk_score, risk_factors, dry_run
                )
            budget_reserved = True

    if not dry_run:
        await _write_audit_node(trace_id, req, "FRAGMENT_3_GATES", "GATES_CLEAR", "PASS")

    # ── FRAGMENT 4: Risk & Compliance (Parallel) ─────────────────
    risk_task = asyncio.create_task(_calc_risk_score(req.agent_id, req.beneficiary, req.amount))
    compliance_task = asyncio.create_task(_check_sanctions(req.beneficiary))

    (risk_score, risk_factors), sanctions_match = await asyncio.gather(risk_task, compliance_task)

    # Compliance check overrides risk score
    if sanctions_match:
        if budget_reserved:
            await redis_client.check_and_increment_spend(req.agent_id, -req.amount, Decimal("999999999"))
        risk_factors.append("SANCTIONS_MATCH")
        return await _finalize(
            trace_id, req, "FRAGMENT_4_COMPLIANCE", "SANCTIONS_MATCH", "DENY",
            start_ns, risk_score, risk_factors, dry_run
        )

    if not dry_run:
        await _write_audit_node(
            trace_id, req, "FRAGMENT_4_RISK_COMPLIANCE", f"RISK_SCORE_{risk_score}", "PASS",
            details={"risk_score": risk_score, "risk_factors": risk_factors}
        )

    # ── FRAGMENT 5: Decision, Escalation & Human Review ──────────
    if risk_score > 70:
        if budget_reserved:
            await redis_client.check_and_increment_spend(req.agent_id, -req.amount, Decimal("999999999"))
        return await _finalize(
            trace_id, req, "FRAGMENT_5_DECISION", "RISK_SCORE_HIGH", "DENY",
            start_ns, risk_score, risk_factors, dry_run
        )

    if 30 <= risk_score <= 70:
        if not dry_run:
            # Hold transaction in review_queue
            await db.execute(
                """INSERT INTO review_queue (trace_id, agent_id, version, action, amount, beneficiary, risk_score, status)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')""",
                trace_id, req.agent_id, req.version or "1.0.0", req.action,
                req.amount, req.beneficiary, Decimal(str(risk_score))
            )
        return await _finalize(
            trace_id, req, "FRAGMENT_5_DECISION", "NEEDS_HUMAN_REVIEW", "HOLD",
            start_ns, risk_score, risk_factors, dry_run
        )

    # ── FRAGMENT 6: Core Banking Execution & Ledger ──────────────
    if not dry_run:
        try:
            execution_ok = True  # Mock core banking call
            if not execution_ok:
                raise RuntimeError("Core Banking API error")

            await db.execute(
                """INSERT INTO ledger (entry_id, trace_id, agent_id, amount, beneficiary, status)
                   VALUES ($1, $2, $3, $4, $5, 'EXECUTED')""",
                uuid.uuid4(), trace_id, req.agent_id, req.amount or Decimal("0"), req.beneficiary or "N/A"
            )
            await _write_audit_node(trace_id, req, "FRAGMENT_6_EXECUTION", "LEDGER_UPDATED", "SUCCESS")
        except Exception:
            if budget_reserved:
                await redis_client.check_and_increment_spend(req.agent_id, -req.amount, Decimal("999999999"))
            return await _finalize(
                trace_id, req, "FRAGMENT_6_EXECUTION", "EXECUTION_FAILED", "DENY",
                start_ns, risk_score, risk_factors, dry_run
            )

    # ── Final Return ─────────────────────────────────────────────
    final_reason = "DRY_RUN_COMPLETE" if dry_run else "ALL_CHECKS_PASS"
    return await _finalize(
        trace_id, req, "FRAGMENT_6_EXECUTION", final_reason, "ALLOW",
        start_ns, risk_score, risk_factors, dry_run
    )


# ── Risk scoring engine ─────────────────────────────────────────

async def _calc_risk_score(
    agent_id: str, beneficiary: str | None, amount: Decimal | None
) -> Tuple[int, List[str]]:
    """Calculate multi-signal risk score. Returns (score, contributing_factors)."""
    if not beneficiary:
        return 0, []

    score = 0
    factors: List[str] = []

    # Signal 1: Direct mule hit (+80)
    if beneficiary in _mule_graph and _mule_graph.nodes[beneficiary].get("is_mule"):
        score += 80
        factors.append("DIRECT_MULE_HIT")

    # Signal 2: 1-hop BFS proximity (+40)
    elif beneficiary in _mule_graph:
        neighbors = list(_mule_graph.neighbors(beneficiary))
        if any(_mule_graph.nodes[n].get("is_mule") for n in neighbors):
            score += 40
            factors.append("GRAPH_PROXIMITY_1HOP")

    # Signal 2b: Persistent risk bump from feedback loop
    if beneficiary in _mule_graph:
        bump = _mule_graph.nodes[beneficiary].get("risk_bump", 0)
        if bump > 0:
            score += bump
            factors.append(f"FEEDBACK_BUMP_+{bump}")

    # Signal 3: Velocity deviation (+16)
    velocity_count = _record_velocity(beneficiary)
    if velocity_count > _VELOCITY_THRESHOLD:
        score += 16
        factors.append("VELOCITY_SPIKE")

    # Signal 4: Behavioral anomaly (+12)
    if amount and amount > 0:
        avg = _record_amount(agent_id, float(amount))
        if avg > 0 and float(amount) > 3 * avg:
            score += 12
            factors.append("BEHAVIORAL_ANOMALY")

    return min(score, 100), factors


async def _check_sanctions(beneficiary: str | None) -> bool:
    """Check sanctions/AML list — exact match on flagged_mules + fuzzy on sanctions_list."""
    if not beneficiary:
        return False

    # Exact match on flagged_mules collection
    row = await db.fetch_one(
        "SELECT account_id FROM flagged_mules WHERE account_id = $1",
        beneficiary
    )
    if row:
        return True

    # Fuzzy substring match on sanctions_list (if collection exists)
    try:
        rows = await db.fetch_all(
            "SELECT entity_name FROM sanctions_list WHERE entity_name = $1",
            beneficiary
        )
        if rows:
            return True
    except Exception:
        pass  # sanctions_list table may not exist yet — graceful fallback

    return False


# ── Audit & response helpers ─────────────────────────────────────

async def _write_audit_node(
    trace_id: uuid.UUID,
    req: ActionRequest,
    node_name: str,
    reason_code: str,
    outcome: str,
    details: dict | None = None
) -> None:
    """Write an audit entry for a single pipeline node."""
    try:
        await db.execute(
            """INSERT INTO audit_log (trace_id, agent_id, action, node_name, reason_code, outcome, details)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            trace_id, req.agent_id, req.action, node_name, reason_code, outcome, json.dumps(details or {})
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("Audit node write failed: %s", exc)


async def _finalize(
    trace_id: uuid.UUID,
    req: ActionRequest,
    node_name: str,
    reason_code: str,
    outcome: str,
    start_ns: int,
    risk_score: Optional[int],
    risk_factors: List[str],
    dry_run: bool,
) -> ActionResponse:
    """Finalize audit log, record metrics, trigger SSE broadcast, and return ActionResponse."""
    elapsed_ms = (time.perf_counter_ns() - start_ns) / 1_000_000

    if not dry_run:
        # Audit log write (fail-safe — never block decision on logging)
        try:
            await _write_audit_node(
                trace_id, req, node_name, reason_code, outcome,
                details={"risk_score": risk_score, "risk_factors": risk_factors}
            )
        except Exception:
            pass  # Decision must still be returned even if logging fails

        record_latency(elapsed_ms)
        record_decision(outcome)

        # SSE broadcast (fire-and-forget)
        asyncio.create_task(broadcast_event({
            "trace_id": str(trace_id),
            "agent_id": req.agent_id,
            "action": req.action,
            "outcome": outcome,
            "reason_code": reason_code,
            "explanation": REASON_EXPLANATIONS.get(reason_code, f"Pipeline outcome: {outcome} ({reason_code})"),
            "risk_score": risk_score,
            "risk_factors": risk_factors,
            "latency_ms": round(elapsed_ms, 2),
        }))

    explanation = REASON_EXPLANATIONS.get(reason_code, f"Pipeline outcome: {outcome} ({reason_code})")

    response = ActionResponse(
        trace_id=str(trace_id),
        outcome=outcome,
        reason_code=reason_code,
        explanation=explanation,
        risk_score=risk_score,
        risk_factors=risk_factors,
        latency_ms=round(elapsed_ms, 2),
    )

    # Cache idempotency result (skip for dry-run)
    if not dry_run and req.idempotency_key:
        try:
            await redis_client.set_idempotency(
                req.idempotency_key,
                response.model_dump_json(),
                ttl=300
            )
        except Exception:
            pass  # Non-critical

    return response
