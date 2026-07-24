"""Normal agent — sends legitimate requests to the governance gateway."""

import json
import random
import time
import requests
import sys
import os

BASE = "http://localhost:8000"
COUNTERPARTIES = ["acme-corp", "globex-inc", "initech", "umbrella-bank"]
ACTIONS = [
    ("read_balance", None, None),
    ("read_transactions", None, None),
    ("transfer_funds", 500, "acme-corp"),
    ("transfer_funds", 1200, "globex-inc"),
    ("transfer_funds", 3000, "initech"),
    ("transfer_funds", 750, "umbrella-bank"),
    ("read_balance", None, None),
    ("transfer_funds", 2000, "acme-corp"),
]


def load_agent_id(name: str) -> str:
    """Load agent ID from the setup-generated JSON."""
    ids_path = os.path.join(os.path.dirname(__file__), "agent_ids.json")
    if os.path.exists(ids_path):
        with open(ids_path) as f:
            ids = json.load(f)
            return ids.get(name, "")
    return ""


def run(agent_name: str, interval: float = 2.0):
    agent_id = load_agent_id(agent_name)
    if not agent_id:
        print(f"ERROR: No agent ID found for '{agent_name}'. Run setup_agents.py first.")
        sys.exit(1)

    print(f"[{agent_name.upper()}] Starting normal operations (ID: {agent_id})")
    print(f"[{agent_name.upper()}] Sending requests every {interval}s\n")

    cycle = 0
    while True:
        action, amount, counterparty = random.choice(ACTIONS)

        payload = {
            "agent_id": agent_id,
            "version": "1.0.0",
            "action": action,
            "amount": amount,
            "beneficiary": counterparty,
            "context": {},
        }

        try:
            resp = requests.post(f"{BASE}/action", json=payload, timeout=5)
            data = resp.json()
            outcome = data.get("outcome", "???")
            reason_code = data.get("reason_code", "")
            trace_id = data.get("trace_id", "")
            latency = data.get("latency_ms", 0)

            symbol = "✓" if outcome == "ALLOW" else "✗"
            amount_str = f" ${amount}" if amount else ""
            cp_str = f" → {counterparty}" if counterparty else ""

            print(
                f"  {symbol} [{outcome}] {action}{amount_str}{cp_str} "
                f"[{trace_id[:8]}] ({latency:.1f}ms) — {reason_code}"
            )
        except requests.ConnectionError:
            print(f"  ⚠ Gateway unreachable")
        except Exception as e:
            print(f"  ⚠ Error: {e}")

        cycle += 1
        time.sleep(interval + random.uniform(-0.5, 0.5))


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "alpha"
    interval = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
    run(name, interval)

