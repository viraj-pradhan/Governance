"""Admin endpoints — simulation toggles for fail-closed demo and automated traffic generation."""

from __future__ import annotations

import asyncio
import random
import logging
from typing import Dict, Any, Optional

from fastapi import APIRouter

from gateway.config import settings
from gateway.models import ActionRequest
from gateway.routers.authorize import process_action

router = APIRouter(prefix="/admin/simulate", tags=["admin-simulate"])

# Traffic simulation state
_traffic_task: Optional[asyncio.Task] = None
_traffic_count: int = 0
logger = logging.getLogger("gateway.simulation")


@router.post("/opa-outage")
async def toggle_opa_outage() -> Dict[str, Any]:
    """Toggle OPA outage simulation on/off."""
    settings.simulate_opa_outage = not settings.simulate_opa_outage
    return {
        "status": "ok",
        "simulate_opa_outage": settings.simulate_opa_outage,
        "message": "OPA outage simulation " + ("ENABLED — using in-process fallback" if settings.simulate_opa_outage else "DISABLED — using live OPA"),
    }


@router.post("/redis-outage")
async def toggle_redis_outage() -> Dict[str, Any]:
    """Toggle Redis outage simulation on/off."""
    settings.simulate_redis_outage = not settings.simulate_redis_outage
    return {
        "status": "ok",
        "simulate_redis_outage": settings.simulate_redis_outage,
        "message": "Redis outage simulation " + ("ENABLED — using in-memory fallback" if settings.simulate_redis_outage else "DISABLED — using live Redis"),
    }


@router.get("/status")
async def get_simulation_status() -> Dict[str, Any]:
    """Get current state of all simulation toggles."""
    return {
        "simulate_opa_outage": settings.simulate_opa_outage,
        "simulate_redis_outage": settings.simulate_redis_outage,
        "traffic_running": _traffic_task is not None and not _traffic_task.done(),
        "traffic_tx_count": _traffic_count,
    }


# ── Automated Agent Traffic Generator (Dashboard Start Button) ───────

async def _traffic_loop():
    """Background task generating continuous realistic agent traffic."""
    global _traffic_count
    
    scenarios = [
        # Legitimate Alpha actions -> ALLOW
        {"agent_id": "alpha-agent-001", "version": "1.0.0", "action": "read_balance"},
        {"agent_id": "alpha-agent-001", "version": "1.0.0", "action": "transfer_funds", "amount": 1500, "beneficiary": "trusted-vendor-1"},
        {"agent_id": "alpha-agent-001", "version": "1.0.0", "action": "transfer_funds", "amount": 4200, "beneficiary": "payroll-corp"},
        
        # Suspicious Beta actions -> HOLD / ELEVATED RISK
        {"agent_id": "beta-agent-002", "version": "1.0.0", "action": "transfer_funds", "amount": 12500, "beneficiary": "suspicious-acct-88"},
        {"agent_id": "beta-agent-002", "version": "1.0.0", "action": "transfer_funds", "amount": 18000, "beneficiary": "offshore-holdings"},
        
        # Rogue actions -> DENY / SANCTIONS / OVER LIMIT
        {"agent_id": "rogue-agent-666", "version": "1.0.0", "action": "close_account"},
        {"agent_id": "alpha-agent-001", "version": "1.0.0", "action": "transfer_funds", "amount": 500, "beneficiary": "sanctioned-entity-001"},
        {"agent_id": "rogue-agent-666", "version": "1.0.0", "action": "transfer_funds", "amount": 150000, "beneficiary": "shadow-bank"},
    ]

    while True:
        try:
            scenario = random.choice(scenarios).copy()
            # Add dynamic variation
            if "amount" in scenario:
                scenario["amount"] = scenario["amount"] + random.randint(-200, 500)
            
            req = ActionRequest(**scenario)
            await process_action(req)
            _traffic_count += 1
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Traffic simulation error: {e}")
        
        await asyncio.sleep(random.uniform(1.2, 2.5))


@router.post("/traffic/start")
async def start_traffic_simulation() -> Dict[str, Any]:
    """Start automated mock agent traffic simulation."""
    global _traffic_task
    if _traffic_task and not _traffic_task.done():
        return {"status": "ok", "message": "Traffic simulation is already running", "running": True}
    
    _traffic_task = asyncio.create_task(_traffic_loop())
    return {"status": "ok", "message": "Automated Agent Traffic Simulation STARTED", "running": True}


@router.post("/traffic/stop")
async def stop_traffic_simulation() -> Dict[str, Any]:
    """Stop automated mock agent traffic simulation."""
    global _traffic_task
    if _traffic_task and not _traffic_task.done():
        _traffic_task.cancel()
        _traffic_task = None
        return {"status": "ok", "message": "Automated Agent Traffic Simulation STOPPED", "running": False}
    
    return {"status": "ok", "message": "Traffic simulation was not running", "running": False}
