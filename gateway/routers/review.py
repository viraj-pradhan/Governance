"""Fragment 5 — Human Review Queue & Feedback Loop Router."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from gateway import db
from gateway.routers.authorize import get_mule_graph

router = APIRouter(prefix="/review", tags=["review"])


@router.get("/queue")
async def get_review_queue() -> List[Dict[str, Any]]:
    """List all held transactions awaiting human review."""
    rows = await db.fetch_all(
        "SELECT * FROM review_queue WHERE status = 'PENDING' ORDER BY created_at DESC"
    )
    return [dict(r) for r in rows]


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
        """INSERT INTO ledger (trace_id, agent_id, amount, beneficiary, status)
           VALUES ($1, $2, $3, $4, 'EXECUTED')""",
        trace_id, tx["agent_id"], tx["amount"], tx["beneficiary"] or "N/A"
    )

    # Audit log
    await db.execute(
        """INSERT INTO audit_log (trace_id, agent_id, action, node_name, reason_code, outcome)
           VALUES ($1, $2, $3, 'HUMAN_REVIEW', 'HUMAN_APPROVED', 'ALLOW')""",
        trace_id, tx["agent_id"], tx["action"]
    )

    return {"status": "ok", "trace_id": str(trace_id), "outcome": "ALLOW"}


@router.post("/{trace_id}/reject")
async def reject_transaction(trace_id: uuid.UUID) -> Dict[str, Any]:
    """
    Reviewer confirms fraud -> DENY, add beneficiary to flagged-mule set,
    and bump risk score of 1-hop neighbors in NetworkX graph feedback loop.
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

    # Feedback loop: add beneficiary to Postgres flagged_mules
    if beneficiary:
        await db.execute(
            """INSERT INTO flagged_mules (account_id, reason)
               VALUES ($1, 'Confirmed fraud via human review')
               ON CONFLICT (account_id) DO NOTHING""",
            beneficiary
        )

        # Feedback loop: update in-memory NetworkX graph
        g = get_mule_graph()
        g.add_node(beneficiary, is_mule=True)
        for neighbor in list(g.neighbors(beneficiary)):
            g.nodes[neighbor]["risk_weight"] = g.nodes[neighbor].get("risk_weight", 0) + 40

    # Audit log
    await db.execute(
        """INSERT INTO audit_log (trace_id, agent_id, action, node_name, reason_code, outcome)
           VALUES ($1, $2, $3, 'HUMAN_REVIEW', 'CONFIRMED_FRAUD', 'DENY')""",
        trace_id, tx["agent_id"], tx["action"]
    )

    return {"status": "ok", "trace_id": str(trace_id), "outcome": "DENY", "feedback_loop_updated": True}
