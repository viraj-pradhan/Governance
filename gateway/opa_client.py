"""HTTP client for Open Policy Agent (OPA) sidecar."""

from __future__ import annotations

from typing import Any, Optional

import httpx

from gateway.config import settings

_client: Optional[httpx.AsyncClient] = None


async def init_opa() -> None:
    global _client
    _client = httpx.AsyncClient(
        base_url=settings.opa_url,
        timeout=2.0,
    )


async def close_opa() -> None:
    global _client
    if _client:
        await _client.aclose()
        _client = None


def _c() -> httpx.AsyncClient:
    if _client is None:
        raise RuntimeError("OPA client not initialised — call init_opa() first")
    return _client


async def evaluate_policy(
    agent_id: str,
    action: str,
    resource: Optional[str],
    amount: Optional[float],
    context: dict[str, Any],
) -> tuple[bool, str]:
    """Query OPA for a governance decision.

    Returns (allowed: bool, reason: str).
    If OPA is unreachable or simulated down, falls back to in-process rules.
    If even the fallback fails, returns DENY (fail-closed).
    """
    # Check simulation flag — skip OPA entirely
    if settings.simulate_opa_outage:
        return _in_process_fallback(action, amount)

    payload = {
        "input": {
            "agent_id": agent_id,
            "action": action,
            "resource": resource,
            "amount": amount,
            "context": context,
        }
    }

    try:
        resp = await _c().post("/v1/data/governance", json=payload)
        resp.raise_for_status()
        data = resp.json()

        result = data.get("result", {})
        allowed = result.get("allow", False)
        reason = result.get("reason", "policy denied" if not allowed else "policy allowed")
        return allowed, reason

    except httpx.HTTPStatusError as exc:
        return False, f"OPA error: {exc.response.status_code}"
    except (httpx.ConnectError, httpx.HTTPError, Exception):
        # Fallback to in-process rule evaluation
        return _in_process_fallback(action, amount)


def _in_process_fallback(action: str, amount: Optional[float]) -> tuple[bool, str]:
    """In-process policy evaluation fallback. Fail-closed: unknown actions -> DENY."""
    try:
        if action in ("read_balance", "read_transactions"):
            return True, "read_balance/read_transactions is permitted by policy"
        if action == "transfer_funds":
            if amount is not None and amount > 100000:
                return False, "transfer_funds exceeds auto-approval threshold"
            return True, "transfer_funds permitted by policy"
        if action == "close_account":
            return False, "close_account requires administrative privilege"
        # Unknown action -> DENY (fail-closed)
        return False, f"action {action} not permitted by policy"
    except Exception:
        # If even the fallback errors -> absolute fail-closed DENY
        return False, "POLICY_ENGINE_UNAVAILABLE: both OPA and fallback failed"



async def push_policy(policy_id: str, rego_body: str) -> bool:
    """Upload / update a Rego policy in OPA."""
    try:
        resp = await _c().put(
            f"/v1/policies/{policy_id}",
            content=rego_body,
            headers={"Content-Type": "text/plain"},
        )
        return resp.status_code in (200, 201)
    except Exception:  # noqa: BLE001
        return False
