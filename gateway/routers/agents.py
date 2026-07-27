"""Agent CRUD endpoints."""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException

from gateway import db, redis_client
from gateway.models import AgentCreate, AgentUpdate, AgentResponse

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentResponse])
async def list_agents():
    rows = await db.fetch_all(
        "SELECT id, agent_id, version, name, agent_type, status, created_at FROM agents ORDER BY created_at DESC"
    )
    results = []
    for r in rows:
        spend = await redis_client.get_current_spend(r.get("agent_id", ""))
        limit = await redis_client.get_daily_limit(r.get("agent_id", ""))
        results.append(AgentResponse(
            id=r.get("id", ""),
            agent_id=r.get("agent_id", ""),
            version=r.get("version", "1.0.0"),
            name=r.get("name", "Unknown"),
            agent_type=r.get("agent_type", "unknown"),
            status=r.get("status", "active"),
            created_at=r.get("created_at", ""),
            current_spend=spend,
            daily_limit=limit,
        ))
    return results


@router.post("", response_model=AgentResponse, status_code=201)
async def create_agent(body: AgentCreate):
    agent_pk = str(uuid.uuid4())
    await db.execute(
        """INSERT INTO agents (id, agent_id, version, name, agent_type, allowed_action_types)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT(agent_id, version) DO UPDATE SET name=EXCLUDED.name""",
        agent_pk,
        body.agent_id,
        body.version,
        body.name,
        body.agent_type,
        body.allowed_action_types,
    )
    r = await db.fetch_one(
        "SELECT id, agent_id, version, name, agent_type, status, created_at FROM agents WHERE agent_id = $1 AND version = $2",
        body.agent_id, body.version
    )
    return AgentResponse(
        id=r.get("id", agent_pk),
        agent_id=r.get("agent_id", body.agent_id),
        version=r.get("version", body.version),
        name=r.get("name", body.name),
        agent_type=r.get("agent_type", body.agent_type),
        status=r.get("status", "active"),
        created_at=r.get("created_at", ""),
    )


@router.post("/{agent_id}/revoke")
async def revoke_agent(agent_id: str):
    """Revoke an agent — all future requests will be denied."""
    await db.execute(
        "UPDATE agents SET status = 'revoked' WHERE agent_id = $1",
        agent_id
    )
    return {"status": "ok", "agent_id": agent_id, "new_status": "revoked"}


@router.post("/{agent_id}/reinstate")
async def reinstate_agent(agent_id: str):
    """Reinstate a revoked agent to active status."""
    await db.execute(
        "UPDATE agents SET status = 'active' WHERE agent_id = $1",
        agent_id
    )
    return {"status": "ok", "agent_id": agent_id, "new_status": "active"}


@router.post("/{agent_id}/estop")
async def pause_agent(agent_id: str):
    """Per-agent emergency stop — pause this agent without revoking."""
    await redis_client.set_agent_estop(agent_id, True)
    return {"status": "ok", "agent_id": agent_id, "paused": True}


@router.post("/{agent_id}/resume")
async def resume_agent(agent_id: str):
    """Clear per-agent emergency stop — resume processing."""
    await redis_client.set_agent_estop(agent_id, False)
    return {"status": "ok", "agent_id": agent_id, "paused": False}


@router.patch("/{agent_id}/budget")
async def update_agent_budget(agent_id: str, daily_limit: float):
    """Update an agent's daily spend limit."""
    await redis_client.set_daily_limit(agent_id, daily_limit)
    return {"status": "ok", "agent_id": agent_id, "daily_limit": daily_limit}
