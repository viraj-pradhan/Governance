"""Rogue agent — deliberately exceeds spend caps and tries disallowed actions."""

import json
import time
import requests
import sys
import os

BASE = "http://localhost:8000"


def load_agent_id() -> str:
    ids_path = os.path.join(os.path.dirname(__file__), "agent_ids.json")
    if os.path.exists(ids_path):
        with open(ids_path) as f:
            ids = json.load(f)
            return ids.get("rogue", "")
    return ""


def run(interval: float = 1.5):
    agent_id = load_agent_id()
    if not agent_id:
        print("ERROR: No rogue agent ID found. Run setup_agents.py first.")
        sys.exit(1)

    print(f"[ROGUE] Starting rogue operations (ID: {agent_id})")
    print(f"[ROGUE] Will attempt policy violations and budget exhaustion\n")

    rogue_actions = [
        # Phase 1: Normal requests to build up spend
        {"action": "transfer_funds", "amount": 3000, "context": {"counterparty": "acme-corp"},
         "desc": "Normal transfer $3,000"},
        {"action": "transfer_funds", "amount": 4000, "context": {"counterparty": "acme-corp"},
         "desc": "Normal transfer $4,000"},
        {"action": "transfer_funds", "amount": 5000, "context": {"counterparty": "acme-corp"},
         "desc": "Normal transfer $5,000"},

        # Phase 2: Try to exceed single-transaction limit
        {"action": "transfer_funds", "amount": 15000, "context": {"counterparty": "acme-corp"},
         "desc": "VIOLATION: Transfer $15,000 (exceeds $10K single-tx limit)"},

        # Phase 3: Try disallowed counterparty
        {"action": "transfer_funds", "amount": 1000, "context": {"counterparty": "shady-offshore-llc"},
         "desc": "VIOLATION: Transfer to non-allowlisted counterparty"},

        # Phase 4: Try disallowed action
        {"action": "delete_account", "amount": None, "context": {},
         "desc": "VIOLATION: Disallowed action 'delete_account'"},
        {"action": "modify_limits", "amount": None, "context": {},
         "desc": "VIOLATION: Disallowed action 'modify_limits'"},

        # Phase 5: Rapid-fire to exhaust daily budget
        {"action": "transfer_funds", "amount": 5000, "context": {"counterparty": "acme-corp"},
         "desc": "Budget drain $5,000"},
        {"action": "transfer_funds", "amount": 5000, "context": {"counterparty": "acme-corp"},
         "desc": "Budget drain $5,000 (should exceed $15K daily limit)"},

        # Phase 6: Keep trying after budget is exhausted
        {"action": "transfer_funds", "amount": 100, "context": {"counterparty": "acme-corp"},
         "desc": "Post-budget: Even $100 should be denied"},
        {"action": "read_balance", "amount": None, "context": {},
         "desc": "Read-only: should still work even after budget exhaustion"},
    ]

    for i, entry in enumerate(rogue_actions):
        payload = {
            "agent_id": agent_id,
            "action": entry["action"],
            "resource": "checking-account-001",
            "context": entry["context"],
        }
        if entry["amount"] is not None:
            payload["amount"] = entry["amount"]

        print(f"  Step {i+1}/{len(rogue_actions)}: {entry['desc']}")

        try:
            resp = requests.post(f"{BASE}/authorize", json=payload, timeout=5)
            data = resp.json()
            decision = data.get("decision", "???")
            reason = data.get("reason", "")
            latency = data.get("latency_ms", 0)

            symbol = "✓" if decision == "ALLOW" else "✗"
            print(f"    {symbol} [{decision}] ({latency:.1f}ms) — {reason}\n")
        except requests.ConnectionError:
            print("    ⚠ Gateway unreachable\n")
        except Exception as e:
            print(f"    ⚠ Error: {e}\n")

        time.sleep(interval)

    print("[ROGUE] All rogue actions completed.")
    print("[ROGUE] Check the dashboard audit log for the full trail.")


if __name__ == "__main__":
    interval = float(sys.argv[1]) if len(sys.argv) > 1 else 1.5
    run(interval)
