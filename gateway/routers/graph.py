"""Graph endpoints — mule network visualization and fraud feedback loop."""

from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from gateway import db
from gateway.routers.authorize import get_mule_graph, REASON_EXPLANATIONS

router = APIRouter(tags=["graph"])


def _graph_node_payload(g, node_id) -> Dict[str, Any]:
    attrs = g.nodes[node_id]
    return {
        "id": str(node_id),
        "is_mule": attrs.get("is_mule", False),
        "risk_bump": attrs.get("risk_bump", 0),
        "risk_score": attrs.get("risk_score", 0),
        "neighbors_count": len(list(g.neighbors(node_id))),
        "neighbors": [str(n) for n in g.neighbors(node_id)],
    }


@router.get("/graph")
async def get_graph() -> Dict[str, Any]:
    """Return the full mule network graph as nodes + edges JSON."""
    g = get_mule_graph()

    # Determine 1-hop neighbors of mule nodes for risk coloring
    mule_ids = {n for n, d in g.nodes(data=True) if d.get("is_mule")}
    one_hop_ids = set()
    for m in mule_ids:
        for neighbor in g.neighbors(m):
            if neighbor not in mule_ids:
                one_hop_ids.add(neighbor)

    nodes: List[Dict[str, Any]] = []
    for node_id, attrs in g.nodes(data=True):
        is_mule = attrs.get("is_mule", False)
        is_one_hop = not is_mule and node_id in one_hop_ids
        nodes.append({
            "id": str(node_id),
            "is_mule": is_mule,
            "is_one_hop": is_one_hop,
            "risk_bump": attrs.get("risk_bump", 0),
            "risk_score": attrs.get("risk_score", 0),
            "neighbors_count": len(list(g.neighbors(node_id))),
        })

    edges: List[Dict[str, Any]] = []
    for src, tgt, edge_data in g.edges(data=True):
        edges.append({
            "source": str(src),
            "target": str(tgt),
            "weight": edge_data.get("weight", 1),
            "amount": edge_data.get("amount", 0),
        })

    return {
        "node_count": len(nodes),
        "edge_count": len(edges),
        "mule_count": len(mule_ids),
        "nodes": nodes,
        "edges": edges,
    }


@router.get("/graph/subgraph/{node_id}")
async def get_subgraph(node_id: str, hops: int = 2) -> Dict[str, Any]:
    """
    Return nodes and edges within N hops of a given account.
    Used for click-to-center in the frontend.
    """
    g = get_mule_graph()

    if node_id not in g.nodes:
        # Return empty subgraph — node may not be in graph yet
        return {"node_count": 0, "edge_count": 0, "center": node_id, "nodes": [], "edges": []}

    # BFS up to `hops` levels
    hops = min(hops, 3)  # cap at 3 for performance
    visited = {node_id}
    frontier = {node_id}
    for _ in range(hops):
        next_frontier = set()
        for n in frontier:
            for neighbor in g.neighbors(n):
                if neighbor not in visited:
                    next_frontier.add(neighbor)
                    visited.add(neighbor)
        frontier = next_frontier

    mule_ids = {n for n in visited if g.nodes[n].get("is_mule")}
    one_hop_ids = set()
    for m in mule_ids:
        for nb in g.neighbors(m):
            if nb in visited and nb not in mule_ids:
                one_hop_ids.add(nb)

    nodes = []
    for n in visited:
        attrs = g.nodes[n]
        is_mule = attrs.get("is_mule", False)
        nodes.append({
            "id": str(n),
            "is_mule": is_mule,
            "is_one_hop": not is_mule and n in one_hop_ids,
            "risk_bump": attrs.get("risk_bump", 0),
            "risk_score": attrs.get("risk_score", 0),
            "neighbors_count": len(list(g.neighbors(n))),
            "is_center": n == node_id,
        })

    edges = []
    for src, tgt, edge_data in g.edges(data=True):
        if src in visited and tgt in visited:
            edges.append({
                "source": str(src),
                "target": str(tgt),
                "weight": edge_data.get("weight", 1),
            })

    return {
        "node_count": len(nodes),
        "edge_count": len(edges),
        "center": node_id,
        "nodes": nodes,
        "edges": edges,
    }


@router.post("/graph/confirm-fraud/{node_id}")
async def confirm_fraud(node_id: str) -> Dict[str, Any]:
    """
    Fraud feedback loop:
    1. Mark node as confirmed mule (is_mule = True)
    2. Bump 1-hop neighbors risk_bump by +15
    3. Persist to flagged_mules table
    4. Write GRAPH_UPDATED audit entry
    Returns the updated node + affected neighbors list.
    """
    g = get_mule_graph()

    # Add node if it doesn't exist yet
    if node_id not in g.nodes:
        g.add_node(node_id, is_mule=False, risk_bump=0, risk_score=0)

    # Mark as confirmed mule
    g.nodes[node_id]["is_mule"] = True

    # Persist to DB
    try:
        await db.execute(
            """INSERT INTO flagged_mules (account_id, reason)
               VALUES ($1, 'Confirmed fraud via dashboard action')
               ON CONFLICT (account_id) DO NOTHING""",
            node_id
        )
    except Exception:
        pass  # flagged_mules table might not exist in all DB modes

    # Bump 1-hop neighbors
    neighbors_affected = []
    for neighbor in list(g.neighbors(node_id)):
        current_bump = g.nodes[neighbor].get("risk_bump", 0)
        current_score = g.nodes[neighbor].get("risk_score", 0)
        g.nodes[neighbor]["risk_bump"] = current_bump + 15
        g.nodes[neighbor]["risk_score"] = min(100, current_score + 15)
        neighbors_affected.append({
            "id": str(neighbor),
            "new_risk_bump": current_bump + 15,
            "new_risk_score": min(100, current_score + 15),
        })

    # Write audit event
    trace_id = uuid.uuid4()
    try:
        await db.execute(
            """INSERT INTO audit_log (trace_id, agent_id, action, node_name, reason_code, outcome, details)
               VALUES ($1, $2, $3, 'FEEDBACK_LOOP', 'GRAPH_UPDATED', 'INFO', $4)""",
            trace_id,
            "dashboard-operator",
            f"confirm_fraud:{node_id}",
            json.dumps({
                "node_flagged": node_id,
                "neighbors_affected": [n["id"] for n in neighbors_affected],
                "bump_amount": 15,
                "message": f"Node {node_id} confirmed as mule. {len(neighbors_affected)} neighbors risk-bumped by +15.",
            })
        )
    except Exception:
        pass

    return {
        "status": "ok",
        "node_id": node_id,
        "is_mule": True,
        "neighbors_affected": neighbors_affected,
        "explanation": REASON_EXPLANATIONS.get("MULE_SET_UPDATED", ""),
    }
