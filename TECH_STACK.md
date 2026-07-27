# Technical Stack Specifications — Antigravity Governance Gateway

## Overview
The **Antigravity Autonomous AI Financial Agent Governance Gateway** is a ultra-low-latency, fail-closed financial authorization system. It enforces real-time spend limits, policy rules (OPA/Rego), sanctions/AML compliance checks, NetworkX-driven mule network detection, and human-in-the-loop step-up reviews for autonomous agent transactions.

---

## 1. Core Runtime & Backend Stack

| Layer | Technology | Version / Spec | Purpose & Details |
|:---|:---|:---|:---|
| **Language** | Python | 3.10+ | Core async backend runtime supporting high-concurrency event loops |
| **API Framework** | FastAPI | 0.115+ | High-performance ASGI framework with automated OpenAPI validation |
| **ASGI Server** | Uvicorn | 0.30+ | Lightning-fast async server implementation running on `uvloop` / `asyncio` |
| **Data Validation** | Pydantic | v2 (2.8+) | Type enforcement, request/response schema parsing, environment configuration (`pydantic-settings`) |
| **Graph Processing** | NetworkX | 3.3+ | In-memory graph analytics for mule network topology, 1-hop BFS proximity analysis, and feedback loop risk propagation |
| **HTTP Client** | HTTPX | 0.27+ | Async HTTP client used for Open Policy Agent (OPA) REST sidecar evaluation |

---

## 2. Persistence & Caching Tier

| Database / Store | Type | Role & Deployment | Fallback / Redundancy |
|:---|:---|:---|:---|
| **MongoDB Atlas** | Document DB | Primary persistent storage for `agents`, `policies`, `audit_log`, `review_queue`, `flagged_mules`, `sanctions_list`, and `ledger` | In-memory SQLite (`governance_fallback.db`) with SQL-to-Mongo translator abstraction in `db.py` |
| **Redis** | In-Memory K/V | Atomic daily spend cap tracking (Lua scripts), global/agent E-stop flags, idempotency key caching with TTL | Dict-backed in-memory thread-safe store (`_mem_store`) in `redis_client.py` |
| **SQLite3** | Embedded Relational | Lightweight zero-config SQL fallback database initialized on MongoDB connection failure | Primary SQLite tables created dynamically via DDL scripts |

---

## 3. Policy & Governance Engine

| Component | Technology | Description & Policy Rules |
|:---|:---|:---|
| **Policy Engine** | Open Policy Agent (OPA) | Declarative Rego policy sidecar running on port `8181` |
| **In-Process Fallback** | Python Rule Evaluator | Fail-closed policy evaluator built directly into `opa_client.py` executing when OPA is unreachable or during simulated outages |
| **Policy Language** | Rego v1 | Declarative rules specifying allowed action types, max transaction thresholds, and counterparty allowlists |

---

## 4. Frontend & Dashboard Stack

| Layer | Technology | Purpose & Details |
|:---|:---|:---|
| **UI Framework** | React 18 | Declarative component architecture for live dashboard and fleet control |
| **Build Tool / Bundler** | Vite 5/6 | Lightning-fast HMR dev server and optimized production bundler |
| **Routing** | React Router DOM v6 | Client-side SPA routing (`/`, `/live`, `/agents`, `/policies`, `/review`, `/audit`, `/emergency`, `/mule-graph`, `/reason-codes`) |
| **Styling** | Custom Vanilla CSS3 | Modern macOS glassmorphic design system using CSS variables, HSL color tokens, dark mode toggle (`data-theme`), and responsive flex/grid layouts |
| **Visualization** | HTML5 Canvas API | Pure JavaScript physics-based force-directed graph renderer for Mule Network topology visualization |
| **Real-Time Streaming** | Server-Sent Events (SSE) | Native browser `EventSource` listening to `/live` stream for zero-polling decision telemetry |

---

## 5. Mock Agent Simulation & Testing Suite

| Component | Language / Script | Purpose |
|:---|:---|:---|
| **Setup Script** | `mock_agents/setup_agents.py` | Idempotent registration of test agents (`Alpha`, `Beta`, `Rogue`) and initial Rego policies |
| **Compliant Agent** | `mock_agents/run_agent_alpha.py` | Simulates high-frequency legitimate transfer and read actions |
| **Suspicious Agent** | `mock_agents/run_agent_beta.py` | Generates transactions near thresholds and velocity spikes to trigger step-up review |
| **Malicious Agent** | `mock_agents/run_agent_rogue.py` | Attempts policy violations, sanctions hits, and mule transfers to trigger immediate DENY verdicts |

---

## 6. Environment & Configuration Variables

| Variable | Default Value | Description |
|:---|:---|:---|
| `MONGODB_URL` | `""` (Fallback to SQLite) | MongoDB Atlas connection string |
| `REDIS_URL` | `"redis://localhost:6379/0"` | Redis cache connection string |
| `OPA_URL` | `"http://localhost:8181"` | OPA sidecar REST endpoint |
| `HOST` | `"0.0.0.0"` | Gateway binding interface |
| `PORT` | `8000` | Gateway listening port |
| `SIMULATE_OPA_OUTAGE` | `False` | Runtime toggle for OPA failure simulation |
| `SIMULATE_REDIS_OUTAGE` | `False` | Runtime toggle for Redis failure simulation |
