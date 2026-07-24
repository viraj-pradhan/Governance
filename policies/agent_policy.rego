package governance

import rego.v1

# ── Default deny ─────────────────────────────────────────────
default allow := false
default reason := "action not permitted by policy"

# ── Rule: transfer_funds ─────────────────────────────────────
allow if {
    input.action == "transfer_funds"
    input.amount <= 10000
    input.context.counterparty in data.allowlists[input.agent_id]
}

reason := "transfer allowed: amount within limit and counterparty approved" if {
    input.action == "transfer_funds"
    input.amount <= 10000
    input.context.counterparty in data.allowlists[input.agent_id]
}

# ── Deny reason: transfer too large ──────────────────────────
reason := "transfer denied: single transaction exceeds $10,000 limit" if {
    input.action == "transfer_funds"
    input.amount > 10000
}

# ── Deny reason: counterparty not in allowlist ───────────────
reason := "transfer denied: counterparty not in allowlist" if {
    input.action == "transfer_funds"
    input.amount <= 10000
    not input.context.counterparty in data.allowlists[input.agent_id]
}

# ── Rule: read-only actions always allowed ───────────────────
allow if {
    input.action == "read_balance"
}

reason := "read_balance is always permitted" if {
    input.action == "read_balance"
}

allow if {
    input.action == "read_transactions"
}

reason := "read_transactions is always permitted" if {
    input.action == "read_transactions"
}
