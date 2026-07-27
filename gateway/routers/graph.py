"""Graph endpoint — serializes the in-memory mule network for visualization."""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter

from gateway.routers.authorize import get_mule_graph

router = APIRouter(tags=["graph"])


@router.get("/graph")
async def get_graph() -> Dict[str, Any]:
    """Return the mule network graph as nodes + edges JSON for frontend rendering."""
    g = get_mule_graph()

    nodes: List[Dict[str, Any]] = []
    for node_id, attrs in g.nodes(data=True):
        nodes.append({
            "id": str(node_id),
            "is_mule": attrs.get("is_mule", False),
            "risk_bump": attrs.get("risk_bump", 0),
            "neighbors_count": len(list(g.neighbors(node_id))),
        })

    edges: List[Dict[str, str]] = []
    for src, tgt in g.edges():
        edges.append({
            "source": str(src),
            "target": str(tgt),
        })

    return {
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": nodes,
        "edges": edges,
    }
