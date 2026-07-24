"""Policy CRUD endpoints + OPA push."""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException

from gateway import db, redis_client, opa_client
from gateway.models import PolicyCreate, PolicyResponse

from datetime import datetime, timezone

router = APIRouter(prefix="/policies", tags=["policies"])


def _parse_policy_id(val: Any) -> uuid.UUID:
    if isinstance(val, uuid.UUID):
        return val
    try:
        return uuid.UUID(str(val))
    except Exception:
        return uuid.uuid4()


def _parse_datetime(val: Any) -> datetime:
    if isinstance(val, datetime):
        return val
    if isinstance(val, str) and val:
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except Exception:
            pass
    return datetime.now(timezone.utc)


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
        d = dict(r) if not isinstance(r, dict) else r
        results.append(PolicyResponse(
            id=_parse_policy_id(d.get("id")),
            agent_id=d.get("agent_id", ""),
            version=d.get("version", 1),
            rego_body=d.get("rego_body", ""),
            daily_spend_limit=d.get("daily_spend_limit", 50000),
            active=d.get("active", True),
            created_at=_parse_datetime(d.get("created_at")),
        ))
    return results


@router.post("", response_model=PolicyResponse, status_code=201)
async def create_policy(body: PolicyCreate):
    # Check agent exists
    agent = await db.fetch_one("SELECT id FROM agents WHERE agent_id = $1", body.agent_id)
    if not agent:
        # Auto-create if bootstrapping
        await db.execute(
            """INSERT INTO agents (id, agent_id, version, name, agent_type)
               VALUES ($1, $2, $3, $4, $5)""",
            str(uuid.uuid4()), body.agent_id, "1.0.0", f"Agent {body.agent_id}", "generic-agent"
        )

    # Deactivate previous versions
    await db.execute(
        "UPDATE policies SET active = $1 WHERE agent_id = $2 AND active = $3",
        False, body.agent_id, True,
    )

    # Determine next version number by counting existing policies
    existing = await db.fetch_all(
        "SELECT version FROM policies WHERE agent_id = $1",
        body.agent_id,
    )
    next_version = max((r.get("version", 0) for r in existing), default=0) + 1

    policy_pk = uuid.uuid4()
    now = datetime.now(timezone.utc)
    await db.execute(
        """INSERT INTO policies (id, agent_id, version, rego_body, daily_spend_limit, active)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        str(policy_pk),
        body.agent_id,
        next_version,
        body.rego_body,
        body.daily_spend_limit,
        True,
    )

    # Push Rego to OPA
    pushed = await opa_client.push_policy(str(policy_pk), body.rego_body)

    # Update Redis spend limit cache
    if body.daily_spend_limit:
        await redis_client.set_daily_limit(
            str(body.agent_id), body.daily_spend_limit
        )

    return PolicyResponse(
        id=policy_pk,
        agent_id=body.agent_id,
        version=next_version,
        rego_body=body.rego_body,
        daily_spend_limit=body.daily_spend_limit,
        active=True,
        created_at=now,
    )
