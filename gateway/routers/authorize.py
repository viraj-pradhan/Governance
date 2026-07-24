"""Pipeline orchestrator and /action router for multi-fragment governance."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from decimal import Decimal
from typing import Any, Tuple

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


# Explanation dictionary for reason codes
REASON_EXPLANATIONS = {
    "ESTOP_ACTIVE": "Global E-stop is active. All financial actions are blocked fleet-wide.",
    "AGENT_ESTOP_ACTIVE": "Per-agent E-stop is active for this agent.",
    "AUTH_FAIL": "Agent authentication or version validation failed.",
    "AGENT_REVOKED": "Agent or agent version has been explicitly revoked.",
    "PERMISSION_DENIED": "Agent type lacks permission to perform this action.",
    "POLICY_VIOLATION": "Action violates configured governance policy conditions.",
    "NEEDS_MANAGER_APPROVAL": "Transaction amount exceeds threshold and requires human manager approval.",
    "BUDGET_EXCEEDED": "Agent daily budget limit exceeded or insufficient funds in reservation pool.",
    "SANCTIONS_MATCH": "Beneficiary matched static AML / Sanctions watchlist.",
    "RISK_SCORE_HIGH": "Graph proximity or behavioral analysis indicated high risk (>70).",
    "CONFIRMED_FRAUD": "Human reviewer identified transaction as fraudulent.",
    "ALL_CHECKS_PASS": "All governance, policy, budget, risk, and compliance checks passed.",
}


@router.post("/action", response_model=ActionResponse)
async def process_action(req: ActionRequest) -> ActionResponse:
    """
    Main governance gateway entrypoint implementing Fragments 1–6.
    """
    start_ns = time.perf_counter_ns()
    trace_id = uuid.uuid4()
    trace_id_str = str(trace_id)

    # ── FRAGMENT 1: Entry & E-Stop Check ────────────────────────
    if await redis_client.is_global_estop_active():
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_1_ESTOP", "ESTOP_ACTIVE", "BLOCKED", start_ns
        )

    if await redis_client.is_agent_estop_active(req.agent_id):
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_1_ESTOP", "AGENT_ESTOP_ACTIVE", "BLOCKED", start_ns
        )

    # Log Fragment 1 pass
    await _write_audit_node(trace_id, req, "FRAGMENT_1_ESTOP", "ESTOP_CLEAR", "PASS")

    # ── FRAGMENT 2: Authentication & Orchestration ──────────────
    # Check agent registry in database or cache
    agent_row = await db.fetch_one(
        "SELECT * FROM agents WHERE agent_id = $1 AND version = $2",
        req.agent_id, req.version or "1.0.0"
    )
    if not agent_row or agent_row.get("status") == "revoked":
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_2_AUTH", "AUTH_FAIL", "REJECT", start_ns
        )

    allowed_actions = agent_row.get("allowed_action_types") or []
    if isinstance(allowed_actions, str):
        try:
            allowed_actions = json.loads(allowed_actions)
        except (json.JSONDecodeError, TypeError):
            allowed_actions = []
    if allowed_actions and req.action not in allowed_actions:
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_2_AUTH", "AUTH_FAIL", "REJECT", start_ns
        )

    await _write_audit_node(trace_id, req, "FRAGMENT_2_AUTH", "AUTH_OK", "PASS")

    # ── FRAGMENT 3: Governance Gates ─────────────────────────────
    # Gate 1: Version Kill-switch
    if await redis_client.is_agent_revoked(req.agent_id, req.version):
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_3_GATE_KILL_SWITCH", f"AGENT_REVOKED (v{req.version})", "DENY", start_ns
        )

    # Gate 2: Permission check
    opa_allowed, opa_reason = await opa_client.evaluate_policy(
        agent_id=req.agent_id,
        action=req.action,
        resource=req.beneficiary,
        amount=float(req.amount) if req.amount else None,
        context=req.context,
    )
    if not opa_allowed:
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_3_GATE_PERMISSION", "PERMISSION_DENIED", "DENY", start_ns
        )

    # Gate 3: Policy check
    if req.amount and req.amount > Decimal("100000"):
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_3_GATE_POLICY", "NEEDS_MANAGER_APPROVAL", "ESCALATE", start_ns
        )

    # Gate 4: Budget check (atomic DECRBY reservation)
    budget_reserved = False
    if req.amount and req.amount > 0:
        daily_limit = await redis_client.get_daily_limit(req.agent_id) or Decimal("50000")
        budget_ok = await redis_client.check_and_increment_spend(
            req.agent_id, req.amount, daily_limit
        )
        if not budget_ok:
            return await _audit_and_respond(
                trace_id, req, "FRAGMENT_3_GATE_BUDGET", "BUDGET_EXCEEDED", "DENY", start_ns
            )
        budget_reserved = True

    await _write_audit_node(trace_id, req, "FRAGMENT_3_GATES", "GATES_CLEAR", "PASS")

    # ── FRAGMENT 4: Risk & Compliance (Parallel) ─────────────────
    risk_task = asyncio.create_task(_calc_risk_score(req.beneficiary))
    compliance_task = asyncio.create_task(_check_sanctions(req.beneficiary))

    risk_score, sanctions_match = await asyncio.gather(risk_task, compliance_task)

    # Compliance check overrides risk score
    if sanctions_match:
        if budget_reserved:
            # Release provisionally reserved budget
            await redis_client.check_and_increment_spend(req.agent_id, -req.amount, Decimal("999999999"))
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_4_COMPLIANCE", "SANCTIONS_MATCH", "DENY", start_ns
        )

    await _write_audit_node(trace_id, req, "FRAGMENT_4_RISK_COMPLIANCE", f"RISK_SCORE_{risk_score}", "PASS")

    # ── FRAGMENT 5: Decision, Escalation & Human Review ──────────
    if risk_score > 70:
        if budget_reserved:
            await redis_client.check_and_increment_spend(req.agent_id, -req.amount, Decimal("999999999"))
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_5_DECISION", "RISK_SCORE_HIGH", "DENY", start_ns
        )

    if 30 <= risk_score <= 70:
        # Hold transaction in PostgreSQL review_queue
        await db.execute(
            """INSERT INTO review_queue (trace_id, agent_id, version, action, amount, beneficiary, risk_score, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')""",
            trace_id, req.agent_id, req.version or "1.0.0", req.action, req.amount, req.beneficiary, Decimal(str(risk_score))
        )
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_5_DECISION", "NEEDS_HUMAN_REVIEW", "ESCALATE", start_ns
        )

    # ── FRAGMENT 6: Core Banking Execution & Ledger ──────────────
    try:
        # Core banking API execution stub
        execution_ok = True  # Mock core banking call
        if not execution_ok:
            raise RuntimeError("Core Banking API error")

        # Record ledger entry
        await db.execute(
            """INSERT INTO ledger (trace_id, agent_id, amount, beneficiary, status)
               VALUES ($1, $2, $3, $4, 'EXECUTED')""",
            trace_id, req.agent_id, req.amount or Decimal("0"), req.beneficiary or "N/A"
        )
        await _write_audit_node(trace_id, req, "FRAGMENT_6_EXECUTION", "LEDGER_UPDATED", "SUCCESS")
    except Exception as exc:
        if budget_reserved:
            await redis_client.check_and_increment_spend(req.agent_id, -req.amount, Decimal("999999999"))
        return await _audit_and_respond(
            trace_id, req, "FRAGMENT_6_EXECUTION", "EXECUTION_FAILED", "DENY", start_ns
        )

    # ── Final ALLOW Return ───────────────────────────────────────
    return await _audit_and_respond(
        trace_id, req, "FRAGMENT_6_EXECUTION", "ALL_CHECKS_PASS", "ALLOW", start_ns
    )


async def _calc_risk_score(beneficiary: str | None) -> int:
    """Calculate NetworkX BFS graph proximity and behavioral risk score."""
    if not beneficiary:
        return 0

    score = 0
    # Graph 1-hop proximity check (+40)
    if beneficiary in _mule_graph:
        neighbors = list(_mule_graph.neighbors(beneficiary))
        if any(_mule_graph.nodes[n].get("is_mule") for n in neighbors):
            score += 40
        if _mule_graph.nodes[beneficiary].get("is_mule"):
            score += 80

    return min(score, 100)


async def _check_sanctions(beneficiary: str | None) -> bool:
    """Check static sanctions/AML list in Postgres."""
    if not beneficiary:
        return False
    row = await db.fetch_one(
        "SELECT account_id FROM flagged_mules WHERE account_id = $1",
        beneficiary
    )
    return row is not None


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


async def _audit_and_respond(
    trace_id: uuid.UUID,
    req: ActionRequest,
    node_name: str,
    reason_code: str,
    outcome: str,
    start_ns: int,
) -> ActionResponse:
    """Finalize audit log, record metrics, trigger SSE broadcast, and return ActionResponse."""
    elapsed_ms = (time.perf_counter_ns() - start_ns) / 1_000_000

    await _write_audit_node(trace_id, req, node_name, reason_code, outcome)

    record_latency(elapsed_ms)
    record_decision(outcome)

    asyncio.create_task(broadcast_event({
        "trace_id": str(trace_id),
        "agent_id": req.agent_id,
        "action": req.action,
        "outcome": outcome,
        "reason_code": reason_code,
        "latency_ms": round(elapsed_ms, 2),
    }))

    explanation = REASON_EXPLANATIONS.get(reason_code, f"Pipeline outcome: {outcome} ({reason_code})")

    return ActionResponse(
        trace_id=str(trace_id),
        outcome=outcome,
        reason_code=reason_code,
        explanation=explanation,
        latency_ms=round(elapsed_ms, 2),
    )
