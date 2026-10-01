#!/usr/bin/env sh
# alive.sh — bring the hapiy stack up, rebuilding the backend every time.
#
# Backend startup and supervision (respawn 1s after a crash, stdout/stderr —
# panics included — into ~/.hapiy/log/hapiy.log) now live in `hapiy up`, so
# this script is a thin shim: build the binary, prepare the frontend, then
# delegate. The keepalive loop that used to live here is retired.
#
# Usage:
#   ./alive.sh              build frontend + backend, start PROD stack
#   ./alive.sh dev          ensure Vite dev server, then start DEV backend
#   ./alive.sh --status     show backend state + last log lines
#   ./alive.sh --stop       stop the supervisor, then the backend (no listener left)
#
# The port is HAPIY_PORT (default 8080 for dev, 18009 for prod); the state dir
# is ~/.hapiy (up.pid / serve.pid / log/hapiy.log).

set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

WEB_DIR="$ROOT_DIR/project/web"
BACKEND_DIR="$ROOT_DIR/project/backend"
BIN="$BACKEND_DIR/hapiy"
WEB_PORT="${WEB_PORT:-18009}"
API_PORT="${API_PORT:-8080}"

msg() { printf '[alive] %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "[alive] missing tool: $1" >&2; exit 1; }; }

# backend_cmd runs the binary from the backend dir so ./hapiy.db resolves there.
backend_cmd() { (cd "$BACKEND_DIR" && "$@"); }

build_backend() {
  need go
  msg "building backend (go build ./cmd/hapiy)"
  (cd "$BACKEND_DIR" && go build -o hapiy ./cmd/hapiy)
}

do_up_dev() {
  need node; need pnpm
  msg "ensuring frontend (Vite dev server)..."
  (cd "$WEB_DIR" && ./scripts/dev.sh)
  build_backend
  msg "restarting backend (dev, port $API_PORT)..."
  # down first so a rebuilt binary always takes effect.
  HAPIY_ENV=development HAPIY_HOST=0.0.0.0 HAPIY_PORT="$API_PORT" backend_cmd "$BIN" down || true
  HAPIY_ENV=development HAPIY_HOST=0.0.0.0 HAPIY_PORT="$API_PORT" backend_cmd "$BIN" up

  LAN_IF=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  LAN=$(ipconfig getifaddr "$LAN_IF" 2>/dev/null || true)
  msg "dev ready: http://127.0.0.1:$WEB_PORT  (hot reload)"
  [ -n "$LAN" ] && msg "LAN access: http://$LAN:$WEB_PORT"
}

do_up_prod() {
  need node; need pnpm
  msg "building frontend (production bundle)..."
  (cd "$WEB_DIR" && pnpm build)
  build_backend

  msg "firewall allow-list..."
  firewall_mode_arg=""
  [ "${HAPIY_FIREWALL:-global}" = "per-binary" ] || firewall_mode_arg="--global"
  "$BACKEND_DIR/scripts/firewall-allow.sh" $firewall_mode_arg "$BIN" || {
    echo "[alive] firewall allow-list setup failed; aborting so we don't start a server nobody can reach." >&2
    exit 1
  }

  msg "restarting backend (prod, port $WEB_PORT, serving web/dist)..."
  HAPIY_ENV=production HAPIY_HOST=0.0.0.0 HAPIY_PORT="$WEB_PORT" HAPIY_WEB_DIST="$WEB_DIR/dist" \
    backend_cmd "$BIN" down || true
  HAPIY_ENV=production HAPIY_HOST=0.0.0.0 HAPIY_PORT="$WEB_PORT" HAPIY_WEB_DIST="$WEB_DIR/dist" \
    backend_cmd "$BIN" up

  LAN_IF=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  LAN=$(ipconfig getifaddr "$LAN_IF" 2>/dev/null || true)
  msg "prod ready: http://127.0.0.1:$WEB_PORT"
  [ -n "$LAN" ] && msg "LAN access: http://$LAN:$WEB_PORT"
}

do_status() {
  backend_cmd "$BIN" status || true
  (cd "$WEB_DIR" && ./scripts/dev.sh --status) || true
}

do_stop() {
  # One "down" is enough: it stops the supervisor and backend regardless of mode.
  backend_cmd "$BIN" down || true
  (cd "$WEB_DIR" && ./scripts/dev.sh --stop) || true
}

case "${1:-}" in
  dev)             do_up_dev ;;
  prod|"")         do_up_prod ;;
  --status|status) do_status ;;
  --stop|stop)     do_stop ;;
  *)
    echo "Usage: $0 [dev|prod] | --status | --stop   (no arg = prod)" >&2
    exit 2
    ;;
esac