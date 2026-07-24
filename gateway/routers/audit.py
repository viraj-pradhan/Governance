"""Filterable unified audit log endpoint."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Query

from gateway import db

router = APIRouter(tags=["audit"])


@router.get("/audit-log")
async def get_audit_log(
    trace_id: Optional[uuid.UUID] = Query(None),
    agent_id: Optional[str] = Query(None),
    outcome: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
) -> List[Dict[str, Any]]:
    conditions = []
    values = []
    idx = 1

    if trace_id:
        conditions.append(f"trace_id = ${idx}")
        values.append(trace_id)
        idx += 1
    if agent_id:
        conditions.append(f"agent_id = ${idx}")
        values.append(agent_id)
        idx += 1
    if outcome:
        conditions.append(f"outcome = ${idx}")
        values.append(outcome.upper())
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    values.append(limit)
    values.append(offset)

    query = f"""
        SELECT id, trace_id, timestamp, agent_id, action, node_name,
               reason_code, outcome, details
        FROM audit_log
        {where}
        ORDER BY timestamp DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """

    rows = await db.fetch_all(query, *values)
    results = []
    for r in rows:
        d = dict(r) if not isinstance(r, dict) else r
        if "trace_id" in d:
            d["trace_id"] = str(d["trace_id"])
        if isinstance(d.get("details"), str):
            try:
                d["details"] = json.loads(d["details"])
            except Exception:
                pass
        results.append(d)
    return results

