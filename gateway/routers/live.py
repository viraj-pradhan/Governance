"""SSE live activity stream — broadcasts authorization decisions in real time."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

router = APIRouter(tags=["live"])

# In-memory set of subscriber queues
_subscribers: set[asyncio.Queue] = set()


async def broadcast_event(event: dict[str, Any]) -> None:
    """Push an event to every connected SSE subscriber."""
    dead: list[asyncio.Queue] = []
    for q in _subscribers:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subscribers.discard(q)


async def _event_generator(q: asyncio.Queue):
    """Yield SSE events from a subscriber queue."""
    try:
        while True:
            event = await q.get()
            yield {
                "event": "decision",
                "data": json.dumps(event),
            }
    except asyncio.CancelledError:
        pass
    finally:
        _subscribers.discard(q)


@router.get("/live")
async def live_stream():
    """SSE endpoint — clients connect here for real-time decision feed."""
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _subscribers.add(q)
    return EventSourceResponse(_event_generator(q))
