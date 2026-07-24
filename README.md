# Governance Layer for Financial Agents

A real-time authorization gateway that sits in front of autonomous financial agents, enforcing per-agent permissions, spend caps, instant revocation, fleet-wide emergency stops, and a complete audit trail.

## Architecture

```
┌──────────────┐     ┌──────────────────────────┐     ┌──────────┐
│  Agent Alpha │────▶│                          │────▶│   OPA    │
│  Agent Beta  │────▶│   FastAPI Gateway (:8000)│────▶│  (:8181) │
│  Agent Rogue │────▶│                          │────▶│          │
└──────────────┘     └─────┬────────────┬───────┘     └──────────┘
                           │            │
                     ┌─────▼──┐   ┌─────▼──────┐
                     │ Redis  │   │ PostgreSQL  │
                     │ (:6379)│   │  (:5432)    │
                     └────────┘   └─────────────┘
                           │
                     ┌─────▼──────────────────┐
                     │  React Dashboard       │
                     │  (:5173)               │
                     └────────────────────────┘
```

## Quick Start

### Deploy to Render (onrender.com) — Native Web Services (No Docker)

You can deploy directly to Render as native **Web Services** (Python + Static Site) using the included `render.yaml` blueprint:

1. Push this repository to GitHub.
2. Go to **Render Dashboard** → **New** → **Blueprint**.
3. Connect your GitHub repository `viraj-pradhan/Governance`.
4. Render will automatically detect `render.yaml` and create 2 services:
   - **`governance-gateway`**: Python Web Service running FastAPI with MongoDB Atlas (`pip install -r gateway/requirements.txt`, `uvicorn gateway.main:app --host 0.0.0.0 --port $PORT`).
   - **`governance-dashboard`**: React Static Site (`npm install && npm run build`).

**Manual Setup on Render (if not using Blueprint):**
- **Backend (Python Web Service)**:
  - Build Command: `pip install -r gateway/requirements.txt`
  - Start Command: `uvicorn gateway.main:app --host 0.0.0.0 --port $PORT`
  - Environment Variable: `MONGODB_URL` = `mongodb+srv://Governance:viraj@governance.xnzioql.mongodb.net/governance?retryWrites=true&w=majority`
- **Frontend (Static Site)**:
  - Build Command: `cd dashboard && npm install && npm run build`
  - Publish Directory: `dashboard/dist`
  - Environment Variable: `VITE_API_BASE_URL` = `https://<your-gateway-backend-url>.onrender.com`

---

### With Docker (Optional)

```bash
cd governance-layer
docker-compose up --build
```

### Without Docker (local dev)

**1. Start services** (install Postgres, Redis, OPA separately)

**2. Gateway:**
```bash
cd gateway
pip install -r requirements.txt
uvicorn gateway.main:app --reload --port 8000
```

**3. Dashboard:**
```bash
cd dashboard
npm install
npm run dev
```

### Run Mock Agents

```bash
# First, create agents + policies
python mock_agents/setup_agents.py

# Start normal agents
python mock_agents/agent_normal.py alpha &
python mock_agents/agent_normal.py beta &

# Run the rogue agent
python mock_agents/agent_rogue.py
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/authorize` | Core decision endpoint |
| `GET` | `/agents` | List all agents |
| `POST` | `/agents` | Create agent |
| `PATCH` | `/agents/{id}` | Update agent |
| `POST` | `/agents/{id}/revoke` | Revoke agent |
| `POST` | `/agents/{id}/reinstate` | Reinstate agent |
| `POST` | `/fleet/halt` | Emergency stop |
| `POST` | `/fleet/resume` | Resume fleet |
| `GET` | `/fleet/status` | Fleet status |
| `POST` | `/policies` | Create policy |
| `GET` | `/policies` | List policies |
| `GET` | `/audit-log` | Filterable audit log |
| `GET` | `/metrics/latency` | p50/p95/p99 latency |
| `GET` | `/live` | SSE real-time feed |

## Authorization Flow

```
POST /authorize { agent_id, action, resource, amount, context }

1. Fleet halted?     → DENY (Redis-cached)
2. Agent revoked?    → DENY (Redis-cached)
3. OPA policy check  → DENY if policy rejects
4. Spend cap check   → DENY if budget exceeded (atomic Redis Lua)
5. Audit log write   → async (fire-and-forget)
6. Return            → { decision, reason, request_id, latency_ms }
```

## Demo Script

1. **Normal operations** — 3 agents making legitimate requests, dashboard shows live ALLOWs
2. **Policy violation** — Rogue agent tries disallowed action → DENY with reason
3. **Budget exceeded** — Rogue agent exhausts spend cap → DENY "budget exceeded"
4. **Agent revocation** — Operator revokes rogue agent → instant DENY on next request
5. **Emergency stop** — Operator halts fleet → all agents denied immediately
6. **Audit trail** — Filter audit log by DENY, full reconstruction with policy versions
7. **Latency proof** — Metrics dashboard shows p95 < 50ms

## Tech Stack

- **Backend**: FastAPI (Python 3.12), async
- **Policy Engine**: Open Policy Agent (OPA), Rego
- **Spend Caps**: Redis (atomic Lua scripts)
- **Database**: PostgreSQL (asyncpg)
- **Dashboard**: React (Vite)
- **Live Feed**: Server-Sent Events (SSE)
