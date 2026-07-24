"""In-memory latency & decision metrics with percentile computation."""

from __future__ import annotations

import bisect
import threading
from collections import deque

from fastapi import APIRouter
from gateway.models import LatencyMetrics

router = APIRouter(tags=["metrics"])

_MAX_SAMPLES = 10_000
_lock = threading.Lock()
_latencies: deque[float] = deque(maxlen=_MAX_SAMPLES)
_sorted_latencies: list[float] = []
_allow_count = 0
_deny_count = 0


def record_latency(ms: float) -> None:
    global _sorted_latencies
    with _lock:
        if len(_latencies) >= _MAX_SAMPLES:
            old = _latencies[0]
            idx = bisect.bisect_left(_sorted_latencies, old)
            if idx < len(_sorted_latencies) and _sorted_latencies[idx] == old:
                _sorted_latencies.pop(idx)
        _latencies.append(ms)
        bisect.insort(_sorted_latencies, ms)


def record_decision(decision: str) -> None:
    global _allow_count, _deny_count
    with _lock:
        if decision == "ALLOW":
            _allow_count += 1
        else:
            _deny_count += 1


def _percentile_unlocked(pct: float) -> float:
    """Return percentile — caller MUST hold _lock."""
    n = len(_sorted_latencies)
    if n == 0:
        return 0.0
    idx = int(pct / 100.0 * (n - 1))
    return round(_sorted_latencies[idx], 2)


def _percentile(pct: float) -> float:
    with _lock:
        return _percentile_unlocked(pct)


@router.get("/metrics/latency", response_model=LatencyMetrics)
async def latency_metrics() -> LatencyMetrics:
    with _lock:
        total = _allow_count + _deny_count
        return LatencyMetrics(
            p50_ms=_percentile_unlocked(50),
            p95_ms=_percentile_unlocked(95),
            p99_ms=_percentile_unlocked(99),
            total_requests=total,
            allow_count=_allow_count,
            deny_count=_deny_count,
        )
