# User Interface Wireframes & Component Specs — Governance Dashboard

## Overview
This document specifies the UI layout hierarchy, visual design system, glassmorphic styling guidelines, and structural wireframes for the **Governance Gateway Command Dashboard**. The interface follows Apple macOS Human Interface Guidelines (SF typography, high-contrast dark/light theme switching, soft depth shadows, and interactive state transitions).

---

## Design System Specifications

| Token | Light Theme Value | Dark Theme Value | Usage |
|:---|:---|:---|:---|
| `--bg-primary` | `#f5f5f7` | `#0a0c10` | Full page background |
| `--bg-card` | `rgba(255, 255, 255, 0.82)` | `rgba(22, 27, 34, 0.75)` | Glassmorphic card containers |
| `--accent-blue` | `#0071e3` | `#2997ff` | Primary action buttons, active navigation indicators |
| `--accent-emerald` | `#34c759` | `#30d158` | ALLOW verdicts, active status badges, positive metrics |
| `--accent-crimson` | `#ff3b30` | `#ff453a` | DENY/BLOCKED verdicts, E-Stop buttons, mule highlights |
| `--accent-amber` | `#ff9500` | `#ff9500` | HOLD verdicts, 1-hop warning badges, elevated risk indicators |
| `--font-sans` | `Inter, -apple-system` | `Inter, -apple-system` | Primary UI typography |
| `--font-mono` | `JetBrains Mono, monospace` | `JetBrains Mono, monospace` | Trace IDs, JSON payloads, Rego code blocks |

---

## Page Wireframes

### 1. Main Navigation Layout (`App.jsx`)

```
+---------------------------------------------------------------------------------------------------+
|  [G] Governance Gateway   Overview Dashboard               [🌙 Dark Mode]  [ (A) Administrator ] |
+------------------------+--------------------------------------------------------------------------+
|  OVERVIEW              |                                                                          |
|  [📊] Dashboard        |  ( Dynamic Page Body Content Rendered Here )                             |
|  [⚡] Live Activity    |                                                                          |
|                        |                                                                          |
|  MANAGEMENT            |                                                                          |
|  [🤖] Agents           |                                                                          |
|  [📋] Policies         |                                                                          |
|                        |                                                                          |
|  OPERATIONS            |                                                                          |
|  [⚖️] Review Queue      |                                                                          |
|  [📜] Audit Log        |                                                                          |
|  [🚨] Emergency Stop   |                                                                          |
|                        |                                                                          |
|  INTELLIGENCE          |                                                                          |
|  [🕸️] Mule Network     |                                                                          |
|  [📖] Reason Codes     |                                                                          |
|                        |                                                                          |
|  --------------------  |                                                                          |
|  Gateway v2.0 • Mongo  |                                                                          |
+------------------------+--------------------------------------------------------------------------+
```

---

### 2. Overview Dashboard (`/`)

```
+---------------------------------------------------------------------------------------------------+
|  System Overview Metrics                                                                          |
|  +------------------+  +------------------+  +------------------+  +------------------+           |
|  | TOTAL AGENTS     |  | ACTIVE POLICIES  |  | LATENCY P50      |  | FLEET STATUS     |           |
|  | 3 Active         |  | 3 Rego Rules     |  | 83.2 ms          |  | 🟢 OPERATIONAL   |           |
|  +------------------+  +------------------+  +------------------+  +------------------+           |
|                                                                                                   |
|  Recent Activity Feed                                                                             |
|  +---------------------------------------------------------------------------------------------+  |
|  | TIME     | AGENT           | ACTION         | AMOUNT   | OUTCOME   | REASON                 |  |
|  | 14:45:12 | alpha-agent-001 | transfer_funds | $5,000   | [ALLOW]   | ALL_CHECKS_PASS        |  |
|  | 14:45:15 | alpha-agent-001 | transfer_funds | $1,000   | [DENY]    | SANCTIONS_MATCH        |  |
|  | 14:45:20 | beta-agent-002  | transfer_funds | $12,500  | [HOLD]    | NEEDS_HUMAN_REVIEW     |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

---

### 3. Mule Network Graph (`/mule-graph`)

```
+---------------------------------------------------------------------------------------------------+
|  Mule Network Graph                                                  [ ↻ Refresh ] 4 nodes · 3 edges|
|  +---------------------------------------------------------------------------------------------+  |
|  | 🔴 Confirmed Mule    🟧 1-Hop Neighbor (+15 Risk Bump)    ⚪ Other Entity                     |  |
|  +---------------------------------------------------------------------------------------------+  |
|  +---------------------------------------------------------------------------------------------+  |
|  |                                                                                             |  |
|  |                  ( +15 )                                                                    |  |
|  |               🟧 vendor-45                                                                  |  |
|  |              /                                                                              |  |
|  |             /                                                                               |  |
|  |  🔴 mule-acct-990 ----- 🟧 vendor-88                                                       |  |
|  |             \                                    +---------------------------------------+  |
|  |              \                                   | SELECTED NODE DETAILS                 |  |
|  |               ⚪ normal-user-12                  | ID: mule-acct-990                     |  |
|  |                                                  | Mule: 🔴 Yes                          |  |
|  |                                                  | Risk Bump: +0                         |  |
|  |                                                  | Connections: 3                        |  |
|  |                                                  +---------------------------------------+  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

---

### 4. Governance & Rego Policies (`/policies`) + Dry-Run Simulator Modal

```
+---------------------------------------------------------------------------------------------------+
|  Policies                                                [ + New Policy ]  [ 🧪 Simulate Action ] |
|  Filter by Agent: [ All Agents ▾ ]                                                                |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | Agent Alpha (alpha-agent-001)   v1.0  [Active]                        [ ▼ Show Rego ]       |  |
|  | Limit: $50,000/day • Created: 2026-07-27                                                    |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                                                                   |
|  ============================== SIMULATE ACTION (DRY-RUN) MODAL =================================  |
|  +---------------------------------------------------------------------------------------------+  |
|  | 🧪 Simulate Action (Dry-Run)                                                            [×] |  |
|  | Test an action through governance pipeline without audit/spend side effects.                |  |
|  |                                                                                             |  |
|  | Agent: [ Alpha (alpha-agent-001) ▾ ]    Action: [ transfer_funds ▾ ]                           |  |
|  | Amount ($): [ 5000       ]             Beneficiary: [ vendor-45     ]                         |  |
|  |                                                                                             |  |
|  | +-----------------------------------------------------------------------------------------+ |  |
|  | | ✅ ALLOW   ALL_CHECKS_PASS                                                              | |  |
|  | | All governance, policy, budget, risk, and compliance checks passed.                     | |  |
|  | | Risk Score: 0  |  Latency: 30.1ms  |  Trace: 81f78689...                                   | |  |
|  | +-----------------------------------------------------------------------------------------+ |  |
|  |                                                                                             |  |
|  |                                                                [ Close ]  [ ▶ Run Simulation]|  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

---

### 5. Emergency Stop & Fail-Closed Simulation (`/emergency`)

```
+---------------------------------------------------------------------------------------------------+
|                                       Global Emergency Stop                                       |
|                                                                                                   |
|                                     +-----------------------+                                     |
|                                     | 🟢 FLEET OPERATIONAL  |                                     |
|                                     +-----------------------+                                     |
|                                                                                                   |
|                                    /-------------------------\                                    |
|                                   |     HALT ALL AGENTS       |                                   |
|                                    \-------------------------/                                    |
|                                                                                                   |
|  ============================== FAIL-CLOSED SIMULATION TOGGLES ==================================  |
|  Simulate infrastructure outages to demonstrate fail-closed fallback behavior.                    |
|                                                                                                   |
|  +-----------------------------------------+   +-----------------------------------------+        |
|  | 🛡️ OPA Policy Engine                    |   | 🗄️ Redis Cache                          |        |
|  | ✅ CONNECTED                             |   | ✅ CONNECTED                             |        |
|  | Live OPA sidecar evaluating Rego rules. |   | Live Redis tracking atomic spend caps.  |        |
|  |                                         |   |                                         |        |
|  | [ Simulate OPA Outage ]                 |   | [ Simulate Redis Outage ]               |        |
|  +-----------------------------------------+   +-----------------------------------------+        |
+---------------------------------------------------------------------------------------------------+
```

---

### 6. Human Review Queue (`/review`)

```
+---------------------------------------------------------------------------------------------------+
|  Human Review Queue                                                                               |
|  Transactions held in the 30–70 risk score band requiring step-up operator approval.              |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | Action: transfer_funds ($12,500)                                                           |  |
|  | Trace ID: e2b4f910-8b21... | Agent: beta-agent-002 (v1.0.0)                                |  |
|  | Beneficiary: suspicious-vendor-1 | Risk Score: 46                                            |  |
|  | [ GRAPH_PROXIMITY_1HOP ]  [ VELOCITY_SPIKE ]                                                |  |
|  | "Risk score fell in manual-review band (30-70). Transaction held for operator approval."     |  |
|  |                                                                                             |  |
|  |                                                [ ✓ Approve (ALLOW) ]  [ ✕ Confirm Fraud (DENY) ]|  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

---

### 7. Reason Code Reference (`/reason-codes`)

```
+---------------------------------------------------------------------------------------------------+
|  Reason Code Reference                                                                            |
|  Search: [ Search reason codes...          ]                              24 reason codes registered|
|                                                                                                   |
|  🛡️ Risk & Compliance                                                                             |
|  +---------------------------------------------------------------------------------------------+  |
|  | SANCTIONS_MATCH           | The counterparty matched an entry on the sanctions/AML watchlist. |  |
|  | RISK_SCORE_HIGH           | Graph proximity or behavioral analysis indicated high risk (>70).|  |
|  | GRAPH_PROXIMITY_1HOP      | This beneficiary is one hop from a confirmed mule account.       |  |
|  | VELOCITY_SPIKE            | Unusually high request frequency to this beneficiary detected.    |  |
|  | BEHAVIORAL_ANOMALY        | Transaction amount deviates from historical agent pattern.        |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                                                                   |
|  ⚖️ Human Review                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | NEEDS_HUMAN_REVIEW        | Risk score fell in 30-70 band. Transaction held for approval.    |  |
|  | CONFIRMED_FRAUD           | Human reviewer identified transaction as fraudulent.             |  |
|  | MULE_SET_UPDATED          | Flagged mule network updated. 1-hop neighbors risk-bumped.       |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```
