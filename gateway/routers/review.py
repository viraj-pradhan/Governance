"""Fragment 5 — Human Review Queue & Feedback Loop Router."""

from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from gateway import db
from gateway.routers.authorize import get_mule_graph, REASON_EXPLANATIONS

router = APIRouter(prefix="/review", tags=["review"])


@router.get("/queue")
async def get_review_queue() -> List[Dict[str, Any]]:
    """List all held transactions awaiting human review, with risk factors."""
    rows = await db.fetch_all(
        "SELECT * FROM review_queue WHERE status = 'PENDING' ORDER BY created_at DESC"
    )
    results = []
    for r in rows:
        d = dict(r) if not isinstance(r, dict) else r
        # Enrich with explanation
        d["explanation"] = REASON_EXPLANATIONS.get("NEEDS_HUMAN_REVIEW", "")
        # Try to fetch risk factors from the audit log for this trace
        try:
            audit_row = await db.fetch_one(
                "SELECT details FROM audit_log WHERE trace_id = $1 AND node_name = 'FRAGMENT_4_RISK_COMPLIANCE'",
                d.get("trace_id")
            )
            if audit_row:
                details = audit_row.get("details", "{}")
                if isinstance(details, str):
                    details = json.loads(details)
                d["risk_factors"] = details.get("risk_factors", [])
            else:
                d["risk_factors"] = []
        except Exception:
            d["risk_factors"] = []
        results.append(d)
    return results


@router.post("/{trace_id}/approve")
async def approve_transaction(trace_id: uuid.UUID) -> Dict[str, Any]:
    """Reviewer approves held transaction -> execute Core Banking & Ledger."""
    tx = await db.fetch_one(
        "SELECT * FROM review_queue WHERE trace_id = $1 AND status = 'PENDING'",
        trace_id
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Held transaction not found or already processed")

    # Update review queue status
    await db.execute(
        "UPDATE review_queue SET status = 'APPROVED' WHERE trace_id = $1",
        trace_id
    )

    # Insert into ledger
    await db.execute(
        """INSERT INTO ledger (entry_id, trace_id, agent_id, amount, beneficiary, status)
           VALUES ($1, $2, $3, $4, $5, 'EXECUTED')""",
        uuid.uuid4(), trace_id, tx["agent_id"], tx["amount"], tx["beneficiary"] or "N/A"
    )

    # Audit log
    await db.execute(
        """INSERT INTO audit_log (trace_id, agent_id, action, node_name, reason_code, outcome, details)
           VALUES ($1, $2, $3, 'HUMAN_REVIEW', 'HUMAN_APPROVED', 'ALLOW', $4)""",
        trace_id, tx["agent_id"], tx["action"],
        json.dumps({"reviewed_by": "operator", "original_risk_score": tx.get("risk_score")})
    )

    return {
        "status": "ok",
        "trace_id": str(trace_id),
        "outcome": "ALLOW",
        "explanation": REASON_EXPLANATIONS.get("HUMAN_APPROVED", ""),
    }


@router.post("/{trace_id}/reject")
async def reject_transaction(trace_id: uuid.UUID) -> Dict[str, Any]:
    """
    Reviewer confirms fraud -> DENY, add beneficiary to flagged-mule set,
    bump 1-hop neighbors risk by +15, and log MULE_SET_UPDATED audit entry.
    """
    tx = await db.fetch_one(
        "SELECT * FROM review_queue WHERE trace_id = $1 AND status = 'PENDING'",
        trace_id
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Held transaction not found or already processed")

    beneficiary = tx["beneficiary"]

    # Update review queue status
    await db.execute(
        "UPDATE review_queue SET status = 'REJECTED_CONFIRMED_FRAUD' WHERE trace_id = $1",
        trace_id
    )

    neighbors_affected = []

    # Feedback loop: add beneficiary to flagged_mules collection
    if beneficiary:
        await db.execute(
            """INSERT INTO flagged_mules (account_id, reason)
               VALUES ($1, 'Confirmed fraud via human review')
               ON CONFLICT (account_id) DO NOTHING""",
            beneficiary
        )

        # Feedback loop: update in-memory NetworkX graph
        g = get_mule_graph()
        g.add_node(beneficiary, is_mule=True, risk_bump=0)

        # Bump 1-hop neighbors by +15
        for neighbor in list(g.neighbors(beneficiary)):
            current_bump = g.nodes[neighbor].get("risk_bump", 0)
            g.nodes[neighbor]["risk_bump"] = current_bump + 15
            neighbors_affected.append(neighbor)

    # Audit log — CONFIRMED_FRAUD
    await db.execute(
        """INSERT INTO audit_log (trace_id, agent_id, action, node_name, reason_code, outcome, details)
           VALUES ($1, $2, $3, 'HUMAN_REVIEW', 'CONFIRMED_FRAUD', 'DENY', $4)""",
        trace_id, tx["agent_id"], tx["action"],
        json.dumps({"beneficiary": beneficiary, "confirmed_by": "operator"})
    )

    # Audit log — MULE_SET_UPDATED (separate entry for graph learning visibility)
    if beneficiary:
        await db.execute(
            """INSERT INTO audit_log (trace_id, agent_id, action, node_name, reason_code, outcome, details)
               VALUES ($1, $2, $3, 'FEEDBACK_LOOP', 'MULE_SET_UPDATED', 'INFO', $4)""",
            trace_id, tx["agent_id"], tx["action"],
            json.dumps({
                "beneficiary": beneficiary,
                "neighbors_affected": neighbors_affected,
                "bump_amount": 15,
                "message": f"Added {beneficiary} to mule set. {len(neighbors_affected)} neighbors risk-bumped by +15."
            })
        )

    return {
        "status": "ok",
        "trace_id": str(trace_id),
        "outcome": "DENY",
        "explanation": REASON_EXPLANATIONS.get("CONFIRMED_FRAUD", ""),
        "feedback_loop_updated": True,
        "neighbors_affected": neighbors_affected,
    }


# Alias: POST /{trace_id}/deny -> same as reject
@router.post("/{trace_id}/deny")
async def deny_transaction(trace_id: uuid.UUID) -> Dict[str, Any]:
    """Alias for reject_transaction — confirms fraud."""
    return await reject_transaction(trace_id)
