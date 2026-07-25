#!/bin/bash
# One-click start for prototype React dev server.
# Run from anywhere -- script auto-cds to its own directory.
# Kills any existing server on port 28001 before starting.
set -e
cd "$(dirname "$0")"

# Kill existing server on port 28001 if any
OLD_PID=$(lsof -ti :28001 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
    echo "Killing old server (PID $OLD_PID)..."
    kill $OLD_PID 2>/dev/null || true
    sleep 0.5
fi

echo "Starting React dev server on http://0.0.0.0:28001..."
cd app
npm run dev
