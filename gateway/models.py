"""Pydantic schemas for the governance gateway API."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Action Request / Response ───────────────────────────────

class ActionRequest(BaseModel):
    agent_id: str
    version: Optional[str] = "1.0.0"
    action: str
    amount: Optional[Decimal] = None
    beneficiary: Optional[str] = None
    context: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: Optional[str] = None


class ActionResponse(BaseModel):
    trace_id: str
    outcome: str  # ALLOW | DENY | ESCALATE | REJECT | BLOCKED | HOLD
    reason_code: str
    explanation: Optional[str] = None
    risk_score: Optional[int] = None
    risk_factors: Optional[list[str]] = None
    latency_ms: float


# Legacy / router models
class AuthorizeRequest(BaseModel):
    agent_id: str
    action: str
    resource: Optional[str] = None
    amount: Optional[Decimal] = None
    context: dict[str, Any] = Field(default_factory=dict)


class AuthorizeResponse(BaseModel):
    decision: str  # ALLOW | DENY
    reason: Optional[str] = None
    request_id: str
    latency_ms: float


# ── Agents ───────────────────────────────────────────────────

class AgentCreate(BaseModel):
    agent_id: str
    version: str = "1.0.0"
    name: str
    agent_type: str
    allowed_action_types: list[str] = Field(default_factory=list)


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    agent_type: Optional[str] = None
    status: Optional[str] = None
    allowed_action_types: Optional[list[str]] = None


class AgentResponse(BaseModel):
    id: Optional[uuid.UUID] = None
    agent_id: str
    version: str
    name: str
    agent_type: str
    status: str
    created_at: Any
    current_spend: Optional[Decimal] = None
    daily_limit: Optional[Decimal] = None



# ── Policies ─────────────────────────────────────────────────

class PolicyCreate(BaseModel):
    agent_id: str
    rego_body: str
    daily_spend_limit: Optional[Decimal] = Decimal("50000")


class PolicyResponse(BaseModel):
    id: uuid.UUID
    agent_id: str
    version: int
    rego_body: str
    daily_spend_limit: Optional[Decimal]
    active: bool
    created_at: datetime


# ── Audit ────────────────────────────────────────────────────

class AuditLogEntry(BaseModel):
    id: int
    trace_id: uuid.UUID
    timestamp: datetime
    agent_id: Optional[str]
    action: str
    node_name: str
    reason_code: str
    outcome: str
    details: Optional[dict[str, Any]] = None


class AuditLogQuery(BaseModel):
    trace_id: Optional[uuid.UUID] = None
    agent_id: Optional[str] = None
    outcome: Optional[str] = None
    from_date: Optional[datetime] = None
    to_date: Optional[datetime] = None
    limit: int = 100
    offset: int = 0


# ── Fleet ────────────────────────────────────────────────────

class FleetStatus(BaseModel):
    halted: bool
    halted_at: Optional[datetime] = None
    halted_by: Optional[str] = None


class FleetHaltRequest(BaseModel):
    halted_by: str = "operator"


# ── Metrics ──────────────────────────────────────────────────

class LatencyMetrics(BaseModel):
    p50_ms: float
    p95_ms: float
    p99_ms: float
    total_requests: int
    allow_count: int
    deny_count: int

