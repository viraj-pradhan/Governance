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
        spend = await redis_client.get_current_spend(r["agent_id"])
        limit = await redis_client.get_daily_limit(r["agent_id"])
        results.append(AgentResponse(
            id=r["id"],
            agent_id=r["agent_id"],
            version=r["version"],
            name=r["name"],
            agent_type=r["agent_type"],
            status=r["status"],
            created_at=r["created_at"],
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
        id=uuid.UUID(r["id"]) if isinstance(r["id"], str) else r["id"],
        agent_id=r["agent_id"],
        version=r["version"],
        name=r["name"],
        agent_type=r["agent_type"],
        status=r["status"],
        created_at=r["created_at"],
    )


