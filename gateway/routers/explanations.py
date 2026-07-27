"""Explanation service — publishes the reason code reference table."""

from __future__ import annotations

from typing import Dict

from fastapi import APIRouter

from gateway.routers.authorize import REASON_EXPLANATIONS

router = APIRouter(tags=["explanations"])


@router.get("/explanations")
async def get_explanations() -> Dict[str, str]:
    """Return the full reason code -> explanation mapping as JSON."""
    return REASON_EXPLANATIONS
