# Governance Gateway for Autonomous Financial AI Agents

A high-performance, fail-closed authorization gateway designed for autonomous financial AI agents. The gateway enforces real-time per-agent permissions, daily spend caps, sanctions and AML compliance, NetworkX mule network detection, instant fleet revocation, emergency stops, policy dry-run simulation, and a real-time audit trail.

---

## Quick Start — One-Click Launcher

To launch the complete gateway environment (FastAPI Backend, React Dashboard, and Mock Agent initialization) with a single command:

```bash
./start.sh
```

Once started:
- Web Dashboard UI: [http://localhost:5173](http://localhost:5173)
- Backend API Service: [http://localhost:8000](http://localhost:8000)
- Interactive API Documentation: [http://localhost:8000/docs](http://localhost:8000/docs)

### Starting the Agent Traffic Generator from Web UI
1. Open [http://localhost:5173](http://localhost:5173).
2. Click the "Start Agent Fleet Simulation" button in the header.
3. Transactions will stream live through the 6-stage authorization pipeline, populating real-time latency graphs, review queues, audit trails, and mule network visualizations.

---

## System Architecture

```
                               ┌──────────────────────────────────┐
                               │  React Dashboard (Port 5173)     │
                               │  - Overview / Live Feed          │
                               │  - Mule Graph / Reason Codes     │
                               └────────────────┬─────────────────┘
                                                │ HTTP / SSE Stream
┌────────────────┐             ┌────────────────▼─────────────────┐     ┌────────────────┐
│  Agent Alpha   │────────────▶│                                  │────▶│   OPA Sidecar  │
│  Agent Beta    │────────────▶│  FastAPI Gateway Core (Port 8000)│────▶│   (Port 8181)  │
│  Agent Rogue   │────────────▶│  - 6-Stage Auth Pipeline         │     └────────────────┘
└────────────────┘             └────────┬───────────────┬─────────┘
                                        │               │
                                  ┌─────▼────┐    ┌─────▼────────┐
                                  │ Redis    │    │ MongoDB      │
                                  │ (Lua)    │    │ Atlas        │
                                  └──────────┘    └──────────────┘
```

---

## Technical Documentation

- [Tech Stack Specifications](TECH_STACK.md) — Complete inventory of technologies, versions, and runtime configurations
- [Frameworks & Libraries Spec](FRAMEWORKS.md) — Technical breakdown of FastAPI, React, OPA/Rego, NetworkX, and Redis Lua scripts
- [Architecture Diagrams](ARCHITECTURE_DIAGRAM.md) — Sequence diagrams, flowcharts, risk engine, and fail-closed state trees
- [UI Wireframes & Specs](WIREFRAMES.md) — Screen wireframes, design tokens, and glassmorphic UI specs

---

## Core Features

- **6-Stage Authorization Pipeline**: E-Stop check -> Agent Auth -> Governance Gates -> Parallel Risk & Compliance -> Decision & Review Routing -> Core Banking Execution.
- **4-Signal Risk Engine**: Direct mule hit (+80), 1-hop BFS proximity (+40), velocity spikes (+16), and behavioral anomalies (+12).
- **Human-in-the-Loop Feedback Loop**: Confirming fraud bumps 1-hop neighbor risk (+15) and updates NetworkX mule graph dynamically.
- **Fail-Closed Simulation Toggles**: Interactive switches on Emergency Stop page to simulate OPA or Redis outages and prove fail-closed security.
- **Policy Dry-Run Simulator**: Test proposed agent transactions without writing audit logs or charging spend limits.
- **Mule Network Graph**: Hardware-accelerated 2D force-directed graph renderer showing flagged mules and high-risk neighbors.
- **Reason Code Reference**: Centralized mapping of 24 reason codes to human-understandable explanations.
