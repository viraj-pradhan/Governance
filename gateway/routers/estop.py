"""Fragment 1 — Admin E-Stop endpoints & Redis helpers."""

from __future__ import annotations

from typing import Dict, Any
from fastapi import APIRouter, HTTPException
from gateway import redis_client

router = APIRouter(prefix="/admin/estop", tags=["admin-estop"])


@router.post("/global")
async def set_global_estop() -> Dict[str, Any]:
    """Set global E-stop active."""
    await redis_client.set_global_estop(True)
    return {"status": "ok", "global_estop": True}


@router.post("/global/clear")
async def clear_global_estop() -> Dict[str, Any]:
    """Clear global E-stop."""
    await redis_client.set_global_estop(False)
    return {"status": "ok", "global_estop": False}


@router.post("/agent/{agent_id}")
async def toggle_agent_estop(agent_id: str, active: bool = True) -> Dict[str, Any]:
    """Set or clear per-agent E-stop."""
    await redis_client.set_agent_estop(agent_id, active)
    return {"status": "ok", "agent_id": agent_id, "estop_active": active}


@router.get("/status")
async def get_estop_status() -> Dict[str, Any]:
    """Get current global + per-agent estop status."""
    global_active = await redis_client.is_global_estop_active()
    agent_estops = await redis_client.get_all_agent_estops()
    return {
        "global_estop_active": global_active,
        "agent_estops": agent_estops
    }
