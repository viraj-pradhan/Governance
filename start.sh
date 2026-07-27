#!/usr/bin/env bash
# ==============================================================================
#  Governance Gateway — Project Launcher
# ==============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "================================================================"
echo " Launching Autonomous Financial Agent Governance Gateway"
echo "================================================================"

# Step 1: Cleanup existing processes
echo "Checking for existing processes on ports 8000 & 5173..."
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
sleep 1

# Step 2: Seed Agents & Policies
echo "Initializing mock agents and governance policies..."
python3 mock_agents/setup_agents.py 2>&1 || echo "Setup warning — proceeding..."

# Step 3: Launch FastAPI Gateway Backend
echo "Starting FastAPI Gateway Backend on http://0.0.0.0:8000..."
python3 -m uvicorn gateway.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Step 4: Launch React Dashboard Frontend
echo "Starting React Dashboard Frontend on http://0.0.0.0:5173..."
cd "$SCRIPT_DIR/dashboard"
npm run dev -- --host 0.0.0.0 --port 5173 &
FRONTEND_PID=$!

# Step 5: Wait for startup
sleep 3

echo ""
echo "================================================================"
echo " GATEWAY IS RUNNING AND READY!"
echo "================================================================"
echo " Web Dashboard UI:  http://localhost:5173"
echo " Backend API Docs:  http://localhost:8000/docs"
echo " Health Check:      http://localhost:8000/"
echo "================================================================"
echo " Click 'Start Agent Fleet Simulation' in the dashboard UI"
echo " to stream real-time financial transactions."
echo "================================================================"
echo " Press Ctrl+C to stop all services."
echo ""

cleanup() {
    echo ""
    echo "Shutting down services..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    fuser -k 8000/tcp 2>/dev/null || true
    fuser -k 5173/tcp 2>/dev/null || true
    echo "Shutdown complete."
    exit 0
}

trap cleanup SIGINT SIGTERM

wait
