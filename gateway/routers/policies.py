"""Policy CRUD endpoints + OPA push."""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException

from gateway import db, redis_client, opa_client
from gateway.models import PolicyCreate, PolicyResponse

router = APIRouter(prefix="/policies", tags=["policies"])


@router.get("", response_model=list[PolicyResponse])
async def list_policies(agent_id: Optional[str] = None):
    if agent_id:
        rows = await db.fetch_all(
            """SELECT id, agent_id, version, rego_body, daily_spend_limit, active, created_at
               FROM policies WHERE agent_id = $1 ORDER BY version DESC""",
            agent_id,
        )
    else:
        rows = await db.fetch_all(
            """SELECT id, agent_id, version, rego_body, daily_spend_limit, active, created_at
               FROM policies ORDER BY created_at DESC"""
        )
    results = []
    for r in rows:
        d = dict(r)
        d["id"] = uuid.UUID(d["id"]) if isinstance(d["id"], str) else d["id"]
        results.append(PolicyResponse(**d))
    return results


@router.post("", response_model=PolicyResponse, status_code=201)
async def create_policy(body: PolicyCreate):
    # Check agent exists
    agent = await db.fetch_one("SELECT id FROM agents WHERE agent_id = $1", body.agent_id)
    if not agent:
        # Auto-create if bootstrapping
        await db.execute(
            """INSERT INTO agents (id, agent_id, version, name, agent_type)
               VALUES ($1, $2, '1.0.0', $3, 'generic-agent')
               ON CONFLICT(agent_id, version) DO NOTHING""",
            str(uuid.uuid4()), body.agent_id, f"Agent {body.agent_id}"
        )

    # Deactivate previous versions
    await db.execute(
        "UPDATE policies SET active = false WHERE agent_id = $1 AND active = true",
        body.agent_id,
    )

    # Determine next version number
    last = await db.fetch_one(
        "SELECT MAX(version) as max_v FROM policies WHERE agent_id = $1",
        body.agent_id,
    )
    next_version = (last["max_v"] or 0) + 1 if last and last.get("max_v") else 1

    policy_pk = str(uuid.uuid4())
    await db.execute(
        """INSERT INTO policies (id, agent_id, version, rego_body, daily_spend_limit)
           VALUES ($1, $2, $3, $4, $5)""",
        policy_pk,
        body.agent_id,
        next_version,
        body.rego_body,
        body.daily_spend_limit,
    )
    r = await db.fetch_one(
        "SELECT id, agent_id, version, rego_body, daily_spend_limit, active, created_at FROM policies WHERE id = $1",
        policy_pk
    )

    # Push Rego to OPA
    pushed = await opa_client.push_policy(policy_pk, body.rego_body)

    # Update Redis spend limit cache
    if body.daily_spend_limit:
        await redis_client.set_daily_limit(
            str(body.agent_id), body.daily_spend_limit
        )

    d = dict(r)
    d["id"] = uuid.UUID(d["id"]) if isinstance(d["id"], str) else d["id"]
    return PolicyResponse(**d)

