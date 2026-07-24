-- ============================================================
-- Governance Layer — Database Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    name TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    public_key TEXT,
    allowed_action_types TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (agent_id, version)
);

CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    rego_body TEXT NOT NULL,
    daily_spend_limit NUMERIC DEFAULT 50000,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    trace_id UUID NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT now(),
    agent_id TEXT,
    action TEXT NOT NULL,
    node_name TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    outcome TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS review_queue (
    trace_id UUID PRIMARY KEY,
    agent_id TEXT NOT NULL,
    version TEXT NOT NULL,
    action TEXT NOT NULL,
    amount NUMERIC,
    beneficiary TEXT,
    risk_score NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flagged_mules (
    account_id TEXT PRIMARY KEY,
    added_at TIMESTAMPTZ DEFAULT now(),
    reason TEXT
);

CREATE TABLE IF NOT EXISTS ledger (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id UUID NOT NULL REFERENCES review_queue(trace_id) ON DELETE SET NULL,
    agent_id TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    beneficiary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'EXECUTED',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fleet_status (
    id INT PRIMARY KEY DEFAULT 1,
    halted BOOLEAN DEFAULT false,
    halted_at TIMESTAMPTZ,
    halted_by TEXT
);

-- Seed fleet_status so the row always exists
INSERT INTO fleet_status (id, halted) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- Indices for audit_log queries
CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_log (trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log (agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_outcome ON audit_log (outcome);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (timestamp DESC);

