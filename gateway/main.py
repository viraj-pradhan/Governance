"""Governance Gateway — FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from gateway import db, redis_client, opa_client
from gateway.routers import authorize, agents, policies, kill_switch, audit, metrics, live, estop, review


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    # ── Startup ──────────────────────────────────────────────
    await db.init_db()
    await redis_client.init_redis()
    await opa_client.init_opa()
    yield
    # ── Shutdown ─────────────────────────────────────────────
    await opa_client.close_opa()
    await redis_client.close_redis()
    await db.close_db()


app = FastAPI(
    title="Governance Gateway",
    description="Authorization gateway for autonomous financial agents",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS (allow dashboard) ───────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register routers ─────────────────────────────────────────
app.include_router(authorize.router)
app.include_router(agents.router)
app.include_router(policies.router)
app.include_router(kill_switch.router)
app.include_router(audit.router)
app.include_router(metrics.router)
app.include_router(live.router)
app.include_router(estop.router)
app.include_router(review.router)


@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return {
        "service": "Governance Gateway",
        "status": "online",
        "database": "MongoDB Atlas",
        "docs": "/docs",
        "health": "/health",
    }


@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok"}

