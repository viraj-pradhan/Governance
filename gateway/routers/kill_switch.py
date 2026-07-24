"""Kill switch endpoints — agent revocation and fleet halt/resume."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from gateway import db, redis_client
from gateway.models import FleetStatus, FleetHaltRequest

router = APIRouter(tags=["kill-switch"])


# ── Single agent revocation ──────────────────────────────────

@router.post("/agents/{agent_id}/revoke")
async def revoke_agent(agent_id: uuid.UUID):
    agent = await db.fetch_one("SELECT id, status FROM agents WHERE id = $1", agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent["status"] == "revoked":
        return {"message": "Agent already revoked", "agent_id": str(agent_id)}

    await db.execute(
        "UPDATE agents SET status = 'revoked' WHERE id = $1", agent_id
    )
    await redis_client.set_agent_revoked(str(agent_id), True)

    return {"message": "Agent revoked", "agent_id": str(agent_id)}


@router.post("/agents/{agent_id}/reinstate")
async def reinstate_agent(agent_id: uuid.UUID):
    agent = await db.fetch_one("SELECT id, status FROM agents WHERE id = $1", agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    await db.execute(
        "UPDATE agents SET status = 'active' WHERE id = $1", agent_id
    )
    await redis_client.set_agent_revoked(str(agent_id), False)

    return {"message": "Agent reinstated", "agent_id": str(agent_id)}


# ── Fleet-wide halt / resume ────────────────────────────────

@router.post("/fleet/halt")
async def halt_fleet(body: FleetHaltRequest):
    now = datetime.now(timezone.utc)
    await db.execute(
        """UPDATE fleet_status
           SET halted = true, halted_at = $1, halted_by = $2
           WHERE id = 1""",
        now,
        body.halted_by,
    )
    await redis_client.set_fleet_halted(True)
    return {"message": "Fleet halted", "halted_at": now.isoformat(), "halted_by": body.halted_by}


@router.post("/fleet/resume")
async def resume_fleet():
    await db.execute(
        "UPDATE fleet_status SET halted = false, halted_at = NULL, halted_by = NULL WHERE id = 1"
    )
    await redis_client.set_fleet_halted(False)
    return {"message": "Fleet resumed"}


@router.get("/fleet/status", response_model=FleetStatus)
async def fleet_status():
    r = await db.fetch_one("SELECT halted, halted_at, halted_by FROM fleet_status WHERE id = 1")
    if not r:
        return FleetStatus(halted=False)
    return FleetStatus(
        halted=r["halted"],
        halted_at=r["halted_at"],
        halted_by=r["halted_by"],
    )
