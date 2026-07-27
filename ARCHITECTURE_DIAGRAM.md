# Architecture Diagrams — Antigravity Governance Gateway

## Overview
This document presents the complete architectural design of the **Autonomous AI Financial Agent Governance Gateway**. It covers system components, pipeline orchestration sequence, multi-signal risk engine calculations, feedback loop dynamics, and fail-closed redundancy mechanisms using GitHub-flavored Mermaid diagrams.

---

## 1. System High-Level Architecture Diagram

```mermaid
flowchart TB
    subgraph ClientLayer["Autonomous Agent Fleet & Operators"]
        AgentA["Agent Alpha (Compliant)"]
        AgentB["Agent Beta (High-Volume)"]
        AgentR["Agent Rogue (Malicious)"]
        Dashboard["React Dashboard (Port 5173)"]
    end

    subgraph GatewayCore["Governance Gateway (FastAPI - Port 8000)"]
        API["POST /action Entrypoint"]
        SimAPI["POST /action/simulate (Dry-Run)"]
        IdemCache["Idempotency Cache Check"]
        
        subgraph Pipeline["6-Stage Authorization Pipeline"]
            F1["Stage 1: E-Stop Check"]
            F2["Stage 2: Agent Auth & Version"]
            F3["Stage 3: Governance & Spend Cap"]
            F4["Stage 3.5: Parallel Risk & Compliance"]
            F5["Stage 4: Decision & Review Routing"]
            F6["Stage 5: Core Banking Execution"]
        end

        SSE["SSE Broadcast Engine (/live)"]
        Audit["Fail-Safe Audit Logger"]
    end

    subgraph ExternalEngine["Compliance & Policy Engines"]
        OPA["Open Policy Agent (Rego Sidecar :8181)"]
        NetworkX["NetworkX Mule Graph (In-Memory)"]
        SanctionsDB["Sanctions & AML Watchlist"]
    end

    subgraph PersistenceLayer["Multi-Tier Storage"]
        Redis["Redis (Lua Spend Cap & E-Stops)"]
        Mongo["MongoDB Atlas (Audit, Review, Agents)"]
        SQLite["SQLite Fallback (governance_fallback.db)"]
    end

    AgentA -->|POST /action| API
    AgentB -->|POST /action| API
    AgentR -->|POST /action| API
    Dashboard -->|POST /action/simulate| SimAPI
    Dashboard -->|GET /live (SSE)| SSE

    API --> IdemCache
    IdemCache -->|Cache Miss| Pipeline
    IdemCache -->|Cache Hit| Dashboard

    F1 --> Redis
    F2 --> Mongo
    F3 --> OPA
    F3 --> Redis
    F4 --> NetworkX
    F4 --> SanctionsDB
    F5 -->|Score 30-70| Mongo
    F6 --> Audit
    Audit --> Mongo
    Audit --> SQLite
    Pipeline --> SSE
```

---

## 2. 6-Stage Authorization Pipeline Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Agent as Autonomous Agent
    participant GW as Governance Gateway
    participant Redis as Redis / Lua Engine
    participant OPA as Policy Engine (OPA)
    participant Risk as Risk & Compliance Engine
    participant Review as Review Queue (MongoDB)
    participant Ledger as Ledger & Core Banking

    Agent->>GW: POST /action (AgentID, Action, Amount, Beneficiary, IdempotencyKey)
    
    rect rgb(240, 240, 255)
        note over GW, Redis: Stage 1: E-Stop Check
        GW->>Redis: Check Global & Per-Agent E-Stop Flags
        alt E-Stop Active
            Redis-->>GW: E-Stop Active = True
            GW-->>Agent: 403 BLOCKED (ESTOP_ACTIVE)
        end
    end

    rect rgb(240, 255, 240)
        note over GW, OPA: Stage 2 & 3: Auth & Policy Gates
        GW->>GW: Validate Agent ID & Version Status
        GW->>OPA: Evaluate Rego Policy (Action, Amount, Resource)
        OPA-->>GW: Policy Decision (Allow/Deny, Reason)
        GW->>Redis: Atomic Spend Check (Lua Script: INCRBYFLOAT <= DailyLimit)
        Redis-->>GW: Budget Check Pass
    end

    rect rgb(255, 245, 230)
        note over GW, Risk: Stage 3.5: Parallel Risk & Compliance Evaluation
        par Risk Score Calculation
            GW->>Risk: _calc_risk_score() (Mule Hit + BFS 1-Hop + Velocity + Behavioral)
            Risk-->>GW: Risk Score (0-100), Factors List
        and Sanctions Watchlist
            GW->>Risk: _check_sanctions() (Exact Mule Hit + Fuzzy Sanctions Match)
            Risk-->>GW: Sanctions Match Result
        end
    end

    rect rgb(255, 230, 230)
        note over GW, Review: Stage 4: Decision & Review Routing
        alt Sanctions Match == True OR Risk Score > 70
            GW->>Redis: Rollback Spend Reservation
            GW-->>Agent: 403 DENY (SANCTIONS_MATCH / RISK_SCORE_HIGH)
        else Risk Score between 30 and 70
            GW->>Review: Insert into review_queue (Status: PENDING)
            GW-->>Agent: 202 HOLD (NEEDS_HUMAN_REVIEW)
        end
    end

    rect rgb(230, 255, 255)
        note over GW, Ledger: Stage 5: Execution & Ledger
        GW->>Ledger: Execute Core Banking & Insert Ledger Record
        GW->>GW: Write Audit Trail & Broadcast SSE Event
        GW-->>Agent: 200 ALLOW (ALL_CHECKS_PASS)
    end
```

---

## 3. Risk Engine & Feedback Loop Dynamics

```mermaid
graph TD
    subgraph SignalInputs["Risk Signal Aggregator"]
        S1["Signal 1: Direct Mule Hit (+80)"]
        S2["Signal 2: 1-Hop BFS Proximity (+40)"]
        S3["Signal 2b: Feedback Risk Bump (+N)"]
        S4["Signal 3: Velocity Spike (>5 req/min) (+16)"]
        S5["Signal 4: Behavioral Anomaly (>3x Avg) (+12)"]
    end

    subgraph Evaluator["Risk Engine Score Aggregator"]
        Calc["Risk Score = min(Sum(Signals), 100)"]
    end

    subgraph DecisionBands["Decision Routing"]
        Low["0 - 29 Risk: ALLOW"]
        Med["30 - 70 Risk: HOLD (Review Queue)"]
        High["71 - 100 Risk: DENY"]
    end

    subgraph FeedbackLoop["Human-in-the-Loop Feedback Loop"]
        Operator["Operator Review"]
        Approve["Approve -> ALLOW & Execute Ledger"]
        Reject["Reject -> Confirm Fraud (DENY)"]
        UpdateMule["Add Beneficiary to Flagged Mules"]
        BumpNeighbors["Bump 1-Hop Neighbors Risk (+15)"]
        AuditMule["Log MULE_SET_UPDATED Audit Event"]
    end

    S1 --> Calc
    S2 --> Calc
    S3 --> Calc
    S4 --> Calc
    S5 --> Calc

    Calc --> Low
    Calc --> Med
    Calc --> High

    Med --> Operator
    Operator -->|Approve| Approve
    Operator -->|Reject Fraud| Reject

    Reject --> UpdateMule
    UpdateMule --> BumpNeighbors
    BumpNeighbors --> AuditMule
    BumpNeighbors -->|Persist to Graph| S3
```

---

## 4. Fail-Closed Resilience & Outage Simulation Tree

```mermaid
stateDiagram-v2
    [*] --> RequestReceived

    state PolicyEvaluation {
        [*] --> CheckOPAOutageFlag
        CheckOPAOutageFlag --> OPALive: Flag = False
        CheckOPAOutageFlag --> OPAOutage: Flag = True (Simulated Outage)
        
        OPALive --> OPAResponse: HTTP 200 Success
        OPALive --> OPAOutage: Network Error / Timeout

        OPAOutage --> InProcessFallback: Trigger Python Rule Evaluator
        InProcessFallback --> AllowPolicy: Known Permitted Action
        InProcessFallback --> DenyFailClosed: Unknown Action (Fail-Closed)
    }

    state RedisEvaluation {
        [*] --> CheckRedisOutageFlag
        CheckRedisOutageFlag --> RedisLive: Flag = False
        CheckRedisOutageFlag --> RedisOutage: Flag = True (Simulated Outage)

        RedisLive --> LuaExecution: Execute Atomic Script
        RedisLive --> RedisOutage: Connection Refused

        RedisOutage --> MemStoreFallback: Use Thread-Safe Dict Store
        MemStoreFallback --> DenySafe: Fallback Exception -> DENY (Fail-Closed)
    }

    RequestReceived --> PolicyEvaluation
    PolicyEvaluation --> RedisEvaluation
    RedisEvaluation --> DecisionOutcome
```
