#!/usr/bin/env sh
# start-dev.sh — Launch hapiy in DEVELOPMENT mode (hot reload).
#
# Starts the Vite dev server (HMR on the web app) plus the Go backend (forced
# rebuild so it matches current source). Written by start.sh originally; run
# this when iterating on code.
#
# Usage:
#   ./start-dev.sh          # start both dev servers, wait for ports + /health
#   ./start-dev.sh --status # show pid / port / logs for both servers
#   ./start-dev.sh --stop   # stop both servers
#
# Thin wrapper around project/web/scripts/dev.sh and
# project/backend/scripts/backend.sh.

set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

WEB_DIR="$ROOT_DIR/project/web"
BACKEND_DIR="$ROOT_DIR/project/backend"
WEB_PORT="${WEB_PORT:-28001}"
API_PORT="${API_PORT:-8080}"
API_HOST="http://127.0.0.1:$API_PORT"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[start-dev] missing tool: $1 (see AGENT_README.md dependencies)" >&2
    exit 1
  }
}

wait_port() {
  i=0
  while [ "$i" -lt "$2" ]; do
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    i=$((i + 1))
    sleep 1
  done
  return 1
}

do_start() {
  need go
  need node
  need pnpm
  need lsof
  need curl

  echo "[start-dev] launching backend (forced rebuild -> current source)..."
  (cd "$BACKEND_DIR" && FORCE_REBUILD=1 ./scripts/backend.sh)

  echo "[start-dev] launching frontend (Vite dev server, hot reload)..."
  (cd "$WEB_DIR" && ./scripts/dev.sh)

  wait_port "$API_PORT" 30 || {
    echo "[start-dev] backend not listening on $API_PORT; see /tmp/hapiy-backend.log" >&2
    exit 1
  }
  wait_port "$WEB_PORT" 30 || {
    echo "[start-dev] frontend not listening on $WEB_PORT; see /tmp/hapiy-web-dev.log" >&2
    exit 1
  }

  health=$(curl -sS "$API_HOST/health" 2>/dev/null || echo unreachable)
  echo "[start-dev] backend health: $health"

  LAN_IF=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  LAN=$(ipconfig getifaddr "$LAN_IF" 2>/dev/null || true)
  echo "[start-dev] hapiy dev ready: http://127.0.0.1:$WEB_PORT  (hot reload)"
  [ -n "$LAN" ] && echo "[start-dev] LAN access:  http://$LAN:$WEB_PORT"
}

do_status() {
  (cd "$WEB_DIR" && ./scripts/dev.sh --status)
  (cd "$BACKEND_DIR" && ./scripts/backend.sh --status)
}

do_stop() {
  (cd "$WEB_DIR" && ./scripts/dev.sh --stop)
  (cd "$BACKEND_DIR" && ./scripts/backend.sh --stop)
}

case "${1:-start}" in
  --status|status) do_status ;;
  --stop|stop)     do_stop ;;
  start|"")        do_start ;;
  *)
    echo "Usage: $0 [start|--status|--stop]" >&2
    exit 2
    ;;
esac
