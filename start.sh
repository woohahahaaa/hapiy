#!/usr/bin/env sh
# start.sh — One-shot hapiy launcher: frontend + backend.
#
# Usage:
#   ./start.sh          # start both servers, wait for ports + /health
#   ./start.sh --status # show pid / port / logs for both servers
#   ./start.sh --stop   # stop both servers
#
# Thin wrapper around project/web/scripts/dev.sh and
# project/backend/scripts/backend.sh; see AGENT_README.md.

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
    echo "[start] missing tool: $1 (see AGENT_README.md dependencies)" >&2
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

  echo "[start] launching backend (forced rebuild -> current source)..."
  (cd "$BACKEND_DIR" && FORCE_REBUILD=1 ./scripts/backend.sh)

  echo "[start] launching frontend..."
  (cd "$WEB_DIR" && ./scripts/dev.sh)

  wait_port "$API_PORT" 30 || {
    echo "[start] backend not listening on $API_PORT; see /tmp/hapiy-backend.log" >&2
    exit 1
  }
  wait_port "$WEB_PORT" 30 || {
    echo "[start] frontend not listening on $WEB_PORT; see /tmp/hapiy-web-dev.log" >&2
    exit 1
  }

  health=$(curl -sS "$API_HOST/health" 2>/dev/null || echo unreachable)
  echo "[start] backend health: $health"

  LAN_IF=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  LAN=$(ipconfig getifaddr "$LAN_IF" 2>/dev/null || true)
  echo "[start] hapiy ready: http://127.0.0.1:$WEB_PORT"
  [ -n "$LAN" ] && echo "[start] LAN access:  http://$LAN:$WEB_PORT"
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
