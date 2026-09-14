#!/usr/bin/env sh
# start.sh — Launch hapiy in PRODUCTION mode.
#
# Builds the frontend (web/dist) and starts the Go backend, which serves the
# built UI and the API from a single origin (no Vite dev server / hot reload).
# Run ./start-dev.sh instead when iterating on code.
#
# Usage:
#   ./start.sh          # build frontend + start prod backend, wait for health
#   ./start.sh --status # show pid / port / logs
#   ./start.sh --stop   # stop the prod backend
#
# The prod backend is managed by project/backend/scripts/backend-prod.sh.

set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

WEB_DIR="$ROOT_DIR/project/web"
BACKEND_DIR="$ROOT_DIR/project/backend"
WEB_PORT="${WEB_PORT:-18009}"
API_PORT="${API_PORT:-8080}"

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

  if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[start] port $API_PORT is occupied (likely a leftover dev backend sharing the DB)."
    echo "[start] Occupied by:"
    lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >&2 || true
    if [ "${HAPIY_AUTO_KILL:-}" = "1" ]; then
      answer="y"
    else
      printf "[start] Kill it before starting production? [y/N] "
      read answer || true
    fi
    case "$answer" in
      y|Y|yes|YES)
        echo "[start] killing old process..."
        lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t 2>/dev/null | while read -r p; do
          kill "$p" 2>/dev/null || true
        done
        sleep 1
        running=$(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t 2>/dev/null || true)
        for p in $running; do
          kill -9 "$p" 2>/dev/null || true
        done
        ;;
      *)
        echo "[start] keeping it; continuing (be aware two backends share the DB)."
        ;;
    esac
  fi

  echo "[start] building frontend (production bundle)..."
  (cd "$WEB_DIR" && pnpm build)

  echo "[start] launching production backend (serves UI + API)..."
  (cd "$BACKEND_DIR" && PORT="$WEB_PORT" ./scripts/backend-prod.sh)

  wait_port "$WEB_PORT" 45 || {
    echo "[start] frontend/backend not listening on $WEB_PORT; see /tmp/hapiy-backend-prod.log" >&2
    exit 1
  }

  health=$(curl -sS "http://127.0.0.1:$WEB_PORT/health" 2>/dev/null || echo unreachable)
  echo "[start] backend health: $health"

  LAN_IF=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  LAN=$(ipconfig getifaddr "$LAN_IF" 2>/dev/null || true)
  echo "[start] hapiy ready (production): http://127.0.0.1:$WEB_PORT"
  [ -n "$LAN" ] && echo "[start] LAN access:  http://$LAN:$WEB_PORT"
}

do_status() {
  (cd "$BACKEND_DIR" && ./scripts/backend-prod.sh --status)
}

do_stop() {
  (cd "$BACKEND_DIR" && ./scripts/backend-prod.sh --stop)
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
