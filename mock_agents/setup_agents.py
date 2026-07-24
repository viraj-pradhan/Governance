"""Bootstrap mock agents and policies via the gateway API."""

import requests
import json
import sys

BASE = "http://localhost:8000"


def main():
    print("=== Setting up mock agents and policies ===\n")

    # ── Create agents ────────────────────────────────────────
    agents_data = [
        {"agent_id": "alpha-agent-001", "version": "1.0.0", "name": "Agent Alpha", "agent_type": "retail-transfer-bot", "allowed_action_types": ["read_balance", "read_transactions", "transfer_funds"]},
        {"agent_id": "beta-agent-002", "version": "1.0.0", "name": "Agent Beta", "agent_type": "balance-monitor", "allowed_action_types": ["read_balance", "read_transactions", "transfer_funds"]},
        {"agent_id": "rogue-agent-666", "version": "1.0.0", "name": "Agent Rogue", "agent_type": "high-value-trader", "allowed_action_types": ["read_balance", "read_transactions", "transfer_funds", "close_account"]},
    ]

    agent_ids = []
    for agent in agents_data:
        resp = requests.post(f"{BASE}/agents", json=agent)
        if resp.status_code == 201:
            data = resp.json()
            agent_ids.append(data["agent_id"])
            print(f"  ✓ Created {agent['name']} → {data['agent_id']}")
        else:
            print(f"  ✗ Failed to create {agent['name']}: {resp.text}")
            sys.exit(1)


    # ── Create policies ──────────────────────────────────────
    rego_template = """package governance

import rego.v1

default allow := false
default reason := "action not permitted by policy"

allow if {{
    input.action == "transfer_funds"
    input.amount <= 10000
    input.context.counterparty in data.allowlists[input.agent_id]
}}

reason := "transfer allowed" if {{
    input.action == "transfer_funds"
    input.amount <= 10000
    input.context.counterparty in data.allowlists[input.agent_id]
}}

allow if {{
    input.action == "read_balance"
}}

reason := "read_balance is always permitted" if {{
    input.action == "read_balance"
}}

allow if {{
    input.action == "read_transactions"
}}

reason := "read_transactions is always permitted" if {{
    input.action == "read_transactions"
}}
"""

    policies_data = [
        {"agent_id": agent_ids[0], "daily_spend_limit": 50000, "rego_body": rego_template},
        {"agent_id": agent_ids[1], "daily_spend_limit": 25000, "rego_body": rego_template},
        {"agent_id": agent_ids[2], "daily_spend_limit": 15000, "rego_body": rego_template},
    ]

    for i, policy in enumerate(policies_data):
        resp = requests.post(f"{BASE}/policies", json=policy)
        if resp.status_code == 201:
            print(f"  ✓ Policy for {agents_data[i]['name']} (limit: ${policy['daily_spend_limit']:,})")
        else:
            print(f"  ✗ Failed to create policy: {resp.text}")

    # ── Update OPA allowlists with real agent IDs ────────────
    allowlists = {
        agent_ids[0]: ["acme-corp", "globex-inc", "initech", "umbrella-bank"],
        agent_ids[1]: ["acme-corp", "globex-inc", "wayne-enterprises"],
        agent_ids[2]: ["acme-corp"],
    }

    # Push updated data.json to OPA
    try:
        resp = requests.put(
            "http://localhost:8181/v1/data/allowlists",
            json=allowlists,
            headers={"Content-Type": "application/json"},
        )
        if resp.status_code in (200, 201, 204):
            print("  ✓ OPA allowlists updated with real agent IDs")
        else:
            print(f"  ⚠ OPA allowlist update returned {resp.status_code}")
    except requests.ConnectionError:
        print("  ⚠ Could not connect to OPA — allowlists not updated")

    print(f"\n=== Setup complete ===")
    print(f"  Agent Alpha:  {agent_ids[0]}")
    print(f"  Agent Beta:   {agent_ids[1]}")
    print(f"  Agent Rogue:  {agent_ids[2]}")
    print(f"\nSave these IDs for running the agent scripts.")

    # Write agent IDs to a file for the other scripts
    with open("mock_agents/agent_ids.json", "w") as f:
        json.dump({
            "alpha": agent_ids[0],
            "beta": agent_ids[1],
            "rogue": agent_ids[2],
        }, f, indent=2)
    print("  → Agent IDs saved to mock_agents/agent_ids.json")


if __name__ == "__main__":
    main()
