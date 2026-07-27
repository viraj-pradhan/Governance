"""Grouped decisions endpoint — one object per trace_id, newest first."""

from __future__ import annotations

import json
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query

from gateway import db

router = APIRouter(tags=["decisions"])


async def _fetch_recent_audit_rows(agent_id: Optional[str], batch: int) -> List[Dict]:
    """
    Fetch audit_log rows ordered newest-first.
    Uses native MongoDB _id sort (always monotone) when available,
    falls back to timestamp DESC for SQLite.
    """
    if db._use_sqlite:
        # SQLite: order by rowid which is always monotone
        conds = []
        vals: list = []
        if agent_id:
            conds.append("agent_id = ?")
            vals.append(agent_id)
        where = f"WHERE {' AND '.join(conds)}" if conds else ""
        vals += [batch, 0]
        query = f"""
            SELECT rowid AS _rowid, trace_id, timestamp, agent_id, action,
                   node_name, reason_code, outcome, details
            FROM audit_log {where}
            ORDER BY rowid DESC
            LIMIT ? OFFSET ?
        """
        rows = db._sqlite_conn.cursor().execute(query, vals).fetchall()
        return [dict(r) for r in rows]

    else:
        # MongoDB native: sort by _id descending (monotone insertion order)
        filt: Dict[str, Any] = {}
        if agent_id:
            filt["agent_id"] = agent_id
        cursor = db._mongo_db.audit_log.find(
            filt,
            {"_id": 1, "trace_id": 1, "timestamp": 1, "agent_id": 1,
             "action": 1, "node_name": 1, "reason_code": 1, "outcome": 1, "details": 1}
        ).sort("_id", -1).limit(batch)
        results = []
        async for doc in cursor:
            doc["trace_id"] = str(doc.get("trace_id", ""))
            doc.pop("_id", None)
            # Normalise details
            det = doc.get("details", {})
            if isinstance(det, str):
                try:
                    det = json.loads(det)
                except Exception:
                    det = {}
            doc["details"] = det
            results.append(doc)
        return results


@router.get("/decisions/recent")
async def get_recent_decisions(
    agent_id: Optional[str] = Query(None),
    verdict: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(30, le=200),
    offset: int = Query(0, ge=0),
) -> List[Dict[str, Any]]:
    """
    Return grouped decisions — one object per trace_id, newest first.
    Groups all audit_log rows sharing a trace_id into a single decision
    with an embedded stages[] array and a waterfall-ready latency per stage.
    """
    # Fetch generously — up to 8 rows per decision
    batch = (limit + offset) * 8

    rows = await _fetch_recent_audit_rows(agent_id, batch)

    # Group by trace_id preserving insertion order (newest first)
    traces: OrderedDict[str, Dict[str, Any]] = OrderedDict()

    for r in rows:
        tid = str(r.get("trace_id", ""))
        if not tid or tid == "None":
            continue

        # Details already normalised
        details = r.get("details", {})
        if not isinstance(details, dict):
            try:
                details = json.loads(details)
            except Exception:
                details = {}

        stage_entry = {
            "stage": r.get("node_name", ""),
            "reason_code": r.get("reason_code", ""),
            "outcome": r.get("outcome", ""),
            "latency_ms": details.get("latency_ms"),
        }

        if tid not in traces:
            # First row seen (newest in this trace = final stage)
            traces[tid] = {
                "trace_id": tid,
                "agent_id": r.get("agent_id", ""),
                "action": r.get("action", ""),
                "amount": details.get("amount"),
                "beneficiary": details.get("beneficiary"),
                "final_verdict": r.get("outcome", ""),
                "final_reason": r.get("reason_code", ""),
                "total_latency_ms": details.get("latency_ms"),
                "risk_score": details.get("risk_score"),
                "risk_factors": details.get("risk_factors", []),
                "timestamp": str(r.get("timestamp", "")),
                "stages": [stage_entry],
            }
        else:
            # Subsequent rows — earlier stages (DESC order means earlier = later appended)
            traces[tid]["stages"].append(stage_entry)
            # Accumulate amount/risk from earlier-stage details if final row missed it
            if traces[tid]["amount"] is None and details.get("amount") is not None:
                traces[tid]["amount"] = details.get("amount")
            if traces[tid]["risk_score"] is None and details.get("risk_score") is not None:
                traces[tid]["risk_score"] = details.get("risk_score")
            if not traces[tid]["risk_factors"] and details.get("risk_factors"):
                traces[tid]["risk_factors"] = details.get("risk_factors", [])

    # Post-process
    results = []
    for decision in traces.values():
        # Reverse stages so they appear in chronological order (FRAGMENT_1 → FRAGMENT_6)
        decision["stages"] = list(reversed(decision["stages"]))

        # Compute total latency from the largest stage latency value
        stage_latencies = [s["latency_ms"] for s in decision["stages"] if s.get("latency_ms") is not None]
        if stage_latencies:
            decision["total_latency_ms"] = max(stage_latencies)

        # If final_verdict is a mid-pipeline code, try to find the real final verdict
        real_outcome = next(
            (s["outcome"] for s in reversed(decision["stages"])
             if s["outcome"] in ("ALLOW", "DENY", "HOLD", "ESCALATE", "BLOCKED", "REJECT")),
            decision["final_verdict"]
        )
        if real_outcome:
            decision["final_verdict"] = real_outcome

        results.append(decision)

    # Apply verdict filter
    if verdict:
        v_upper = verdict.upper()
        results = [r for r in results if r.get("final_verdict", "").upper() == v_upper]

    # Apply text search
    if search:
        s_lower = search.lower()
        results = [r for r in results if
                   s_lower in (r.get("agent_id") or "").lower() or
                   s_lower in (r.get("final_reason") or "").lower() or
                   s_lower in (r.get("action") or "").lower()]

    return results[offset: offset + limit]
