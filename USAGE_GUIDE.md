# USAGE GUIDE — Governance Dashboard

A step-by-step guide for first-time users, demo-day observers, or anyone who needs
to understand what this system does without reading a single line of code.

---

## 1. What This System Does

This dashboard lets you monitor and control AI agents that are authorised to take
financial actions — things like transferring money, reading balances, or executing
payments on behalf of a business.

Every request an agent makes goes through a six-stage governance pipeline before
anything actually happens. The pipeline checks: Is this agent who it claims to be?
Does it have permission? Does it have budget? Is the counterparty flagged as a money
mule? Only when all checks pass does the action execute.

You can watch every decision happen in real time, see exactly why something was
allowed or blocked, pause or stop any agent instantly, and flag suspicious accounts
so the system automatically becomes more cautious about their neighbours.

---

## 2. Starting the System

You need two terminals — one for the backend API, one for the frontend dashboard.

### Terminal 1 — Backend (API Gateway)

```
cd App/governance-layer
python3 -m uvicorn gateway.main:app --host 0.0.0.0 --port 8000 --reload
```

**Success looks like:**
```
Connected to MongoDB Atlas (db: governance).
INFO: Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### Terminal 2 — Frontend (Dashboard)

```
cd App/governance-layer/dashboard
npm run dev -- --host 0.0.0.0 --port 5173
```

**Success looks like:**
```
VITE v8.1.5  ready in 205 ms
➜  Local:   http://localhost:5173/
```

Now open **http://localhost:5173** in your browser.

### If something goes wrong

| Problem | Fix |
|---------|-----|
| "Port 8000 already in use" | Run `kill $(lsof -ti:8000)` then retry |
| "Port 5173 already in use" | Run `kill $(lsof -ti:5173)` then retry |
| "MongoDB connection failed" | Backend falls back to local SQLite automatically — everything still works |
| Dashboard shows blank page | Open browser console (F12) and check for errors; usually a wrong API URL |

---

## 3. First Look at the Dashboard

The main page shows four KPI cards at the top:

| Card | What it means |
|------|---------------|
| **Total Agents** | How many AI agents are registered in the system |
| **Decisions Today** | Total number of complete requests processed (one per transaction, not one per pipeline stage) |
| **Allowed** | Requests that passed all checks and executed |
| **Denied / Blocked** | Requests that failed at least one check |

**The pulsing green dot** (top-right of the decisions table, labelled "LIVE") means
the dashboard is connected to a live data stream. New decisions will appear
automatically without you refreshing the page. If it shows as grey and says
"OFFLINE", the backend SSE connection dropped — refreshing the page reconnects it.

---

## 4. Watching Requests Happen — The Simulation

The easiest way to see the system in action is to send test transactions.

You can do this from a terminal:

```bash
curl -X POST http://localhost:8000/action \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"alpha-agent-001","version":"1.0.0","action":"transfer_funds","amount":500,"beneficiary":"ACC-TEST"}'
```

Or use the **Policy Dry-Run panel** on the Dashboard page (see Section 9).

**What you'll see:**
- Within a second, a new row appears at the top of the "Recent Decisions" table
- The row shows: the agent ID, what action it tried, the amount, and a green ALLOW
  or red DENY/BLOCKED badge
- The latency column shows how many milliseconds the entire pipeline took

---

## 5. Reading the Decisions Table

Each row in the "Recent Decisions" table represents one complete request — not one
pipeline stage. Click the **chevron arrow (▶)** on the left of any row to expand it.

When expanded, you'll see the stage-by-stage waterfall:

| Stage | What it checked |
|-------|-----------------|
| FRAGMENT_1_ESTOP | Is the global or agent-level emergency stop active? |
| FRAGMENT_2_AUTH | Is this agent registered and not revoked? Does it have permission for this action? |
| FRAGMENT_3_GATES | Does it have budget? Does the policy allow this amount? |
| FRAGMENT_4_RISK_COMPLIANCE | Is the beneficiary on a sanctions list? Near a mule network? Behaving unusually? |
| FRAGMENT_6_EXECUTION | All checks passed — execute the transaction and record it |

The horizontal bars show how much time was spent at each stage. A long bar at
FRAGMENT_3_GATES might mean your policy engine is slow. A long bar at FRAGMENT_4
might indicate a complex network traversal.

You can also click the **"Details"** button on any row to open a slide-over panel with
the full trace, raw JSON, and all field values.

---

## 6. Filtering and Searching

Above the decisions table is a filter bar with three controls:

- **Agent dropdown** — select a specific agent to show only its decisions
- **Verdict dropdown** — filter by ALLOW, DENY, BLOCKED, or HOLD
- **Search box** — type any text to match against agent ID, action, or reason code

All filtering happens instantly on the already-loaded data — no page reload needed.

**Example:** To see all blocked requests from a specific agent, select the agent in
the dropdown and select "BLOCKED" in the verdict filter.

---

## 7. Controlling Agents

Click **"Agents"** in the left navigation sidebar.

Each agent card shows:
- Its current status: green = Active, amber = Paused, red = Revoked
- Its daily spend bar: how much of its budget has been used today
- Its agent type and ID

### Pause an Agent

Click the **"Pause"** button on an agent card. This activates a per-agent emergency
stop. From that moment, every request from that agent is instantly denied with reason
"AGENT_ESTOP_ACTIVE" — without going through the rest of the pipeline.

The agent card turns amber and shows "Paused".

### Resume an Agent

Click **"Resume"** on a paused agent. The per-agent stop is cleared and the agent
can make requests again.

### Adjust Daily Budget

Click **"Edit"** next to the daily spend amount. Type a new limit and click "Save".
The new limit applies to the next request — there is no restart required. If an
agent has already exceeded the new lower limit today, it will be denied on its next
attempt.

### Revoke an Agent

Click **"Revoke"** to permanently disable an agent version. Unlike Pause, revocation
also removes the agent from the registered list. You can reinstate a revoked agent
by clicking "Reinstate", but this is a deliberate administrative action.

---

## 8. Emergency Stop — The Most Important Button

At the top of the Dashboard page there is a large red button labelled **"E-STOP"**.
This is the global emergency stop.

**Where to find it:** Top-right of the Dashboard page header — it is always visible
and never hidden in a sub-menu.

**Clicking it shows a confirmation dialog:**
> "This will halt ALL agents immediately. Every financial request will be denied
> until you clear the E-Stop. Continue?"

You must click Confirm to activate it.

**What happens immediately after confirming:**
- A red banner appears across the top of every page reading "GLOBAL E-STOP ACTIVE"
- Every subsequent request from every agent is denied at Fragment 1 with reason
  "ESTOP_ACTIVE" — no further pipeline stages run
- The button changes to green and shows "Clear E-Stop"

**Clearing it:** Click the now-green "Clear E-Stop" button. Same confirmation dialog.
Once cleared, agents can make requests again (subject to their individual statuses).

---

## 9. Policy Dry-Run — Test Without Consequences

The Dashboard page has a "Policy Dry-Run" panel (scroll down below the decisions
table, or look for the "Simulate" section).

Fill in:
- **Agent ID** — an agent ID registered in the system
- **Action** — e.g. `transfer_funds`, `read_balance`
- **Amount** — the transaction amount in your currency

Click **Simulate**.

The system runs the full governance pipeline but writes nothing — no audit log entry,
no spend increment, no ledger record.

The result panel shows a green "ALLOW" or red "DENY" badge plus the reason code and
a plain-language explanation of why.

**Worked example:** Enter an amount larger than the agent's daily budget. You should
see a DENY with reason `BUDGET_EXCEEDED` — confirming the budget cap works before
you let a real transaction through.

The panel is clearly marked "SIMULATION — no action taken" so it cannot be confused
with a live request.

---

## 10. Investigating Suspicious Accounts — The Mule Graph

Click **"Mule Graph"** in the left navigation sidebar.

The graph shows all accounts that have been involved in transactions processed by
the gateway. Each account is a circle (node). Lines between circles mean the two
accounts have transacted with each other.

**Reading the colours:**
- **Green circles** — low risk account (risk score 0–30)
- **Amber circles** — elevated risk, either medium score or adjacent to a flagged account
- **Red circles with an X** — confirmed mule account, flagged by a human reviewer
- **Bright orange circles** — one hop away from a confirmed mule (the system has
  already bumped their risk score automatically)

**Drag any node** to reposition it on the canvas. **Click any node** to select it
and see its risk score, connections count, and risk bump amount in the side panel.

### Centering on a Specific Account

If you know an account ID (e.g. from the decisions table), type it in the search box
above the graph and click "Center". The graph zooms to show that account and its
neighbours within 2 hops (configurable to 1 or 3 hops via the dropdown).

### Confirming Fraud — The Feedback Loop

When you click a node and it is not yet flagged:

1. A red **"Confirm Fraud"** button appears in the side panel
2. Clicking it calls the feedback endpoint immediately
3. The node is marked as a confirmed mule (turns red with X)
4. All its direct neighbours automatically receive a +15 risk score bump
5. The graph reloads within a second — watch the neighbour circles shift from green
   toward orange or red as their scores update
6. An audit event `GRAPH_UPDATED` is recorded — every flag action is traceable

**This is the live demo moment:** flag a node, then watch its neighbours' colours
visibly change on screen. The system literally gets smarter in real time.

The confirmed mule list in the side panel grows with each flagged node — you can
click any mule name to centre the graph on it.

---

## 11. Reading the Full Audit Log

Click **"Audit Log"** in the left navigation sidebar.

This is the raw, ungrouped log of every pipeline stage across every request. Each
row is one stage, not one request. This is useful when you want to investigate
exactly what happened at a specific millisecond.

The reason code column uses short codes. Here is a plain-language translation of the
most common ones:

| Reason Code | Plain-language meaning |
|-------------|------------------------|
| ESTOP_CLEAR | E-Stop was checked and not active — pipeline continued |
| AUTH_OK | Agent identity confirmed and permissions validated |
| GATES_CLEAR | Budget check and policy check both passed |
| RISK_SCORE_0 | Risk engine scored this transaction at zero risk |
| RISK_SCORE_HIGH | Risk score exceeded threshold — transaction denied or escalated |
| LEDGER_UPDATED | Transaction executed and recorded in the ledger |
| ALL_CHECKS_PASS | All six fragments passed — ALLOW issued |
| BUDGET_EXCEEDED | Agent has hit its daily spend cap |
| SANCTIONS_MATCH | Beneficiary matched a name on the watchlist |
| GRAPH_PROXIMITY_1HOP | Beneficiary is directly connected to a confirmed mule |
| NEEDS_HUMAN_REVIEW | Risk score in the manual-review band — awaiting operator decision |
| HUMAN_APPROVED | A reviewer approved a held transaction |
| CONFIRMED_FRAUD | A reviewer rejected a held transaction as fraudulent |
| GRAPH_UPDATED | Fraud confirmed — mule node flagged and neighbours re-scored |

---

## Quick Reference

| Task | Where |
|------|-------|
| See live decisions | Dashboard → Recent Decisions table |
| Expand a request's stage trace | Click the ▶ chevron on any row |
| Filter by agent or verdict | Filter bar above the decisions table |
| Pause/resume an agent | Agents page → agent card buttons |
| Adjust agent budget | Agents page → Edit next to spend amount |
| Global emergency stop | Dashboard → red E-STOP button (top right) |
| Run a simulation | Dashboard → Policy Dry-Run panel |
| View mule network | Mule Graph page |
| Confirm fraud on an account | Mule Graph → click node → Confirm Fraud |
| See raw audit log | Audit Log page |
