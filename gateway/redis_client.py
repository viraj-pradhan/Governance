"""Redis client with in-memory dict fallback for spend caps & flags."""

from __future__ import annotations

from decimal import Decimal
from typing import Optional, Dict

import redis.asyncio as aioredis
from gateway.config import settings

_redis: Optional[aioredis.Redis] = None
_use_memory: bool = False
_mem_store: Dict[str, str] = {}
_spend_sha: Optional[str] = None

_SPEND_CHECK_SCRIPT = """
local current = tonumber(redis.call('GET', KEYS[1]) or "0")
local limit   = tonumber(ARGV[2])
local amount  = tonumber(ARGV[1])
if current + amount > limit then
    return 0
else
    redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
    return 1
end
"""


async def init_redis() -> None:
    global _redis, _spend_sha, _use_memory
    try:
        _redis = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            max_connections=20,
            socket_timeout=2.0,
        )
        await _redis.ping()
        _spend_sha = await _redis.script_load(_SPEND_CHECK_SCRIPT)
        _use_memory = False
        print("Connected to Redis server.")
    except Exception as e:
        print(f"Redis connection failed ({e}). Falling back to In-Memory Redis emulation...")
        _use_memory = True
        _redis = None


async def close_redis() -> None:
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None


# ── Spend cap operations ─────────────────────────────────────

def _spend_key(agent_id: str) -> str:
    return f"spend:daily:{agent_id}"


async def check_and_increment_spend(
    agent_id: str, amount: Decimal, daily_limit: Decimal
) -> bool:
    key = _spend_key(agent_id)
    if _use_memory:
        current = Decimal(_mem_store.get(key, "0"))
        if current + amount > daily_limit:
            return False
        _mem_store[key] = str(current + amount)
        return True

    result = await _redis.evalsha(
        _spend_sha, 1, key, str(float(amount)), str(float(daily_limit))
    )
    return int(result) == 1


async def get_current_spend(agent_id: str) -> Decimal:
    key = _spend_key(agent_id)
    if _use_memory:
        val = _mem_store.get(key)
    else:
        val = await _redis.get(key)
    return Decimal(val) if val else Decimal("0")


# ── Global & Per-Agent E-Stop ─────────────────────────────────

_GLOBAL_ESTOP_KEY = "global_estop:active"

def _agent_estop_key(agent_id: str) -> str:
    return f"estop:{agent_id}"

async def is_global_estop_active() -> bool:
    if _use_memory:
        return _mem_store.get(_GLOBAL_ESTOP_KEY) == "1"
    val = await _redis.get(_GLOBAL_ESTOP_KEY)
    return val == "1"

async def set_global_estop(active: bool) -> None:
    val = "1" if active else "0"
    if _use_memory:
        _mem_store[_GLOBAL_ESTOP_KEY] = val
        return
    await _redis.set(_GLOBAL_ESTOP_KEY, val)

async def is_agent_estop_active(agent_id: str) -> bool:
    key = _agent_estop_key(agent_id)
    if _use_memory:
        return _mem_store.get(key) == "1"
    val = await _redis.get(key)
    return val == "1"

async def set_agent_estop(agent_id: str, active: bool) -> None:
    key = _agent_estop_key(agent_id)
    val = "1" if active else "0"
    if _use_memory:
        _mem_store[key] = val
        return
    await _redis.set(key, val)

async def get_all_agent_estops() -> dict[str, bool]:
    result = {}
    if _use_memory:
        for k, v in _mem_store.items():
            if k.startswith("estop:"):
                result[k.split("estop:", 1)[1]] = (v == "1")
        return result

    cursor = "0"
    while cursor:
        cursor, keys = await _redis.scan(cursor=cursor, match="estop:*", count=100)
        for k in keys:
            val = await _redis.get(k)
            result[k.split("estop:", 1)[1]] = (val == "1")
    return result


# ── Fleet halt cache ─────────────────────────────────────────

_FLEET_HALTED_KEY = "fleet:halted"

async def is_fleet_halted() -> bool:
    if _use_memory:
        return _mem_store.get(_FLEET_HALTED_KEY) == "1"
    val = await _redis.get(_FLEET_HALTED_KEY)
    return val == "1"

async def set_fleet_halted(halted: bool) -> None:
    val = "1" if halted else "0"
    if _use_memory:
        _mem_store[_FLEET_HALTED_KEY] = val
        return
    await _redis.set(_FLEET_HALTED_KEY, val)


# ── Agent revocation cache ───────────────────────────────────

async def is_agent_revoked(agent_id: str, version: str | None = None) -> bool:
    if version:
        key = f"agent_status:{agent_id}:{version}"
        if _use_memory:
            val = _mem_store.get(key)
        else:
            val = await _redis.get(key)
        if val is not None:
            return val != "active"
    key = f"agent:revoked:{agent_id}"
    if _use_memory:
        return _mem_store.get(key) == "1"
    val = await _redis.get(key)
    return val == "1"


async def set_agent_revoked(agent_id: str, revoked: bool, version: str | None = None) -> None:
    val = "1" if revoked else "0"
    if version:
        v_key = f"agent_status:{agent_id}:{version}"
        v_val = "revoked" if revoked else "active"
        if _use_memory:
            _mem_store[v_key] = v_val
        else:
            await _redis.set(v_key, v_val)
    key = f"agent:revoked:{agent_id}"
    if _use_memory:
        _mem_store[key] = val
        return
    await _redis.set(key, val)


# ── Daily spend limit cache ──────────────────────────────────

def _limit_key(agent_id: str) -> str:
    return f"spend:limit:{agent_id}"

async def set_daily_limit(agent_id: str, limit: Decimal) -> None:
    key = _limit_key(agent_id)
    val = str(float(limit))
    if _use_memory:
        _mem_store[key] = val
        return
    await _redis.set(key, val)

async def get_daily_limit(agent_id: str) -> Optional[Decimal]:
    key = _limit_key(agent_id)
    if _use_memory or _is_simulating_outage():
        val = _mem_store.get(key)
    else:
        val = await _redis.get(key)
    return Decimal(val) if val else None


# ── Idempotency key cache ────────────────────────────────────

def _idempotency_key(key: str) -> str:
    return f"idempotency:{key}"


async def get_idempotency(key: str) -> Optional[str]:
    """Look up a cached idempotency response."""
    k = _idempotency_key(key)
    if _use_memory or _is_simulating_outage():
        return _mem_store.get(k)
    try:
        return await _redis.get(k)
    except Exception:
        return _mem_store.get(k)


async def set_idempotency(key: str, response_json: str, ttl: int = 300) -> None:
    """Cache an idempotency response with TTL (seconds)."""
    k = _idempotency_key(key)
    if _use_memory or _is_simulating_outage():
        _mem_store[k] = response_json
        return
    try:
        await _redis.set(k, response_json, ex=ttl)
    except Exception:
        _mem_store[k] = response_json


# ── Simulation flag support ──────────────────────────────────

def _is_simulating_outage() -> bool:
    """Check if Redis outage simulation is active."""
    try:
        return settings.simulate_redis_outage
    except Exception:
        return False
