# Frameworks & Libraries Specification — Governance Gateway

## Overview
This document provides a comprehensive technical breakdown of every framework, engine, and core library utilized in the **Autonomous AI Financial Agent Governance Gateway**. It details their architectural roles, integration mechanics, fail-closed mechanisms, and performance implications.

---

## 1. Backend & Server Frameworks

### 1.1 FastAPI (v0.115+)
- **Role**: Primary HTTP ASGI web framework.
- **Key Features Used**:
  - `APIRouter` module isolation (`authorize.py`, `agents.py`, `policies.py`, `review.py`, `explanations.py`, `admin.py`, `graph.py`, `audit.py`, `metrics.py`, `live.py`, `estop.py`).
  - Declarative dependency injection & request lifecycle hooks (`lifespan` context manager).
  - Native OpenAPI/Swagger specification generation at `/docs`.
  - Asynchronous endpoint routing for high-throughput I/O bound authorization requests.

### 1.2 Uvicorn (v0.30+)
- **Role**: Lightning-fast ASGI web server implementation.
- **Key Features Used**:
  - Event-driven non-blocking I/O using Python's `asyncio` event loop.
  - Multi-process worker clustering support for production deployment (`uvicorn gateway.main:app`).

### 1.3 Pydantic (v2.8+)
- **Role**: Data validation, serialization, and settings management.
- **Key Features Used**:
  - `BaseModel` definitions (`ActionRequest`, `ActionResponse`, `AgentCreate`, `PolicyCreate`).
  - Strict type checking for financial attributes (`Decimal` for precision, `UUID` for trace correlation).
  - `pydantic-settings` for `.env` loading and runtime configuration management.

---

## 2. Policy & Compliance Engines

### 2.1 Open Policy Agent (OPA) & Rego v1
- **Role**: Offloads fine-grained policy evaluation to a declarative policy engine.
- **Integration**: `httpx.AsyncClient` queries the OPA REST API (`POST http://localhost:8181/v1/data/governance`).
- **Policy Rules**: Evaluates agent permissions, transaction caps, and allowed counterparty lists.
- **In-Process Fallback**: When OPA is unreachable or during simulated outages (`SIMULATE_OPA_OUTAGE=True`), a fail-closed Python rule evaluator automatically executes in `opa_client.py`.

### 2.2 NetworkX (v3.3+)
- **Role**: Graph analytics engine for real-time mule network detection.
- **Key Algorithms**:
  - **1-Hop BFS Proximity**: Checks if a target beneficiary is directly connected to a flagged mule node (+40 risk score penalty).
  - **Dynamic Node Bumping**: On confirmed fraud (`POST /review/{trace_id}/reject`), neighbor nodes receive an automated +15 risk bump (`risk_bump` attribute).
  - **Graph Export**: Serializes node attributes and edge connections for canvas rendering via `GET /graph`.

---

## 3. Data & Storage Libraries

### 3.1 Motor / PyMongo (v3.5+)
- **Role**: Async MongoDB driver for Atlas / Document store operations.
- **Usage**: Manages indexes (`agent_id`, `trace_id`, `status`, `account_id`) and executes async CRUD queries for audit trails and fleet state.

### 3.2 Redis-py (v5.0+) & Lua Scripts
- **Role**: In-memory data store for atomic spend caps, E-stop flags, and idempotency caching.
- **Lua Script Execution**: Atomic spend validation and decrement via script execution (`_SPEND_CHECK_SCRIPT`), eliminating race conditions in high-concurrency environments.
- **In-Memory Fallback**: Thread-safe dict fallback (`_mem_store`) automatically activates if Redis connection fails or during simulated outages.

### 3.3 SQLite3 (Standard Library)
- **Role**: Zero-dependency embedded database fallback.
- **SQL Translator**: Custom `db.py` layer parses SQL statements into MongoDB queries or executes directly against local `governance_fallback.db` when MongoDB is unavailable.

---

## 4. Frontend Frameworks & Libraries

### 4.1 React (v18.3+)
- **Role**: Core User Interface library.
- **Key Concepts Used**:
  - Functional components with React Hooks (`useState`, `useEffect`, `useRef`, `useCallback`).
  - Controlled forms for policy creation and dry-run simulations.
  - Custom SSE stream listeners (`EventSource`) for real-time live feed updates.

### 4.2 Vite (v6.0+)
- **Role**: Modern frontend toolchain and development server.
- **Features**: Ultra-fast Hot Module Replacement (HMR), optimized Rollup bundle production, environment variable injection (`import.meta.env`).

### 4.3 React Router DOM (v6.26+)
- **Role**: Declarative client-side routing across all 9 dashboard pages.
- **Navigation Layout**: Glassmorphic sidebar with active state highlights and dynamic page title headers.

### 4.4 HTML5 Canvas API (Native Browser API)
- **Role**: Hardware-accelerated 2D graphic rendering for the Mule Network Graph.
- **Implementation**: Custom physics force-directed layout simulation (Coulomb repulsion + Spring attraction + Center gravity) rendered at 60 FPS using `requestAnimationFrame`.

---

## 5. Summary Matrix of Framework Roles

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                            FRONTEND LAYER                               │
 │   React 18  │  Vite  │  React Router v6  │  Canvas API  │  SSE Client   │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │ HTTP / SSE (Port 8000)
 ┌────────────────────────────────────▼────────────────────────────────────┐
 │                           GATEWAY CORE (ASGI)                           │
 │   FastAPI 0.115+  │  Uvicorn  │  Pydantic v2  │  Asyncio Event Loop   │
 └──────┬──────────────────────┬──────────────────────┬────────────────────┘
        │                      │                      │
 ┌──────▼─────────────┐ ┌──────▼─────────────┐ ┌──────▼─────────────┐
 │   POLICY ENGINE    │ │   GRAPH ANALYTICS   │ │   STORAGE & CACHE   │
 │ OPA / Rego v1      │ │ NetworkX 3.3+       │ │ Mongo / Redis / Lua │
 │ (In-Process Fall)  │ │ (Mule Topology)     │ │ (SQLite Fallback)   │
 └────────────────────┘ └─────────────────────┘ └─────────────────────┘
```
