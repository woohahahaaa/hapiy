#!/usr/bin/env sh
# alive.sh — bring the hapiy stack up, rebuilding every time.
#
# One install location for every mode: a prod build is written to
# ~/.hapiy/app/hapiy with the frontend dist synced next to it as
# ~/.hapiy/app/webdist — the same path install.sh (curl) and the in-app
# one-click upgrade use. So alive.sh / curl install / auto-upgrade overwrite
# each other in place. Runtime state (hapiy.db, encryption.key, logs) lives in
# ~/.hapiy.
#
# If the autostart service is installed (`hapiy service install`), every run
# pauses it first so the local stack owns the port; the unit stays and the
# service returns at next login (restore now: `hapiy service start`).
#
# Usage:
#   ./alive.sh              build frontend + backend, start PROD stack
#   ./alive.sh dev          build backend, restart DEV stack, ensure Vite
#   ./alive.sh --status     show backend state + last log lines
#   ./alive.sh --stop       stop the supervisor, then the backend
#
# The port is HAPIY_PORT (default 8080 for dev, 18009 for prod); the state dir
# is ~/.hapiy (up.pid / serve.pid / port / log/hapiy.log).

set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

WEB_DIR="$ROOT_DIR/project/web"
BACKEND_DIR="$ROOT_DIR/project/backend"
STATE_DIR="${HAPIY_STATE_DIR:-$HOME/.hapiy}"
APP_DIR="${HAPIY_HOME:-$STATE_DIR}/app"
BIN="$APP_DIR/hapiy"
DEV_BIN="$BACKEND_DIR/hapiy"
WEB_PORT="${WEB_PORT:-18009}"
API_PORT="${API_PORT:-8080}"

msg() { printf '[alive] %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "[alive] missing tool: $1" >&2; exit 1; }; }

build_backend_to() {
  need go
  msg "building backend -> $1"
  (cd "$BACKEND_DIR" && go build -o "$1" ./cmd/hapiy)
}

# seed_state_db copies the repo database (and its encryption key) into the
# state dir on first run, so moving to the installed layout doesn't strand the
# live providers/tokens config.
seed_state_db() {
  if [ ! -f "$STATE_DIR/hapiy.db" ] && [ -f "$BACKEND_DIR/hapiy.db" ]; then
    msg "seeding state db from repo -> $STATE_DIR/hapiy.db"
    mkdir -p "$STATE_DIR"
    cp "$BACKEND_DIR/hapiy.db" "$STATE_DIR/hapiy.db"
    [ -f "$BACKEND_DIR/encryption.key" ] && cp "$BACKEND_DIR/encryption.key" "$STATE_DIR/encryption.key"
  fi
}

do_up_dev() {
  need node; need pnpm

  # Build first so the running stack keeps serving while we compile.
  build_backend_to "$DEV_BIN"

  # Stop the running stack before Vite claims the port. dev.sh kills only the
  # listener, and a live supervisor respawns serve within a second, so Vite
  # (strictPort) loses the race and dies; `down` stops the supervisor first.
  # The dev backend shares prod's state (db/key/logs) so it serves live data.
  [ -x "$BIN" ] && "$BIN" service stop --quiet 2>/dev/null || true
  HAPIY_ENV=development HAPIY_HOST=0.0.0.0 HAPIY_PORT="$API_PORT" \
    HAPIY_STATE_DIR="$STATE_DIR" HAPIY_DB_PATH="$STATE_DIR/hapiy.db" HAPIY_LOG_DIR="$STATE_DIR/logs" \
    "$DEV_BIN" down || true

  msg "restarting backend (dev, port $API_PORT)..."
  HAPIY_ENV=development HAPIY_HOST=0.0.0.0 HAPIY_PORT="$API_PORT" \
    HAPIY_STATE_DIR="$STATE_DIR" HAPIY_DB_PATH="$STATE_DIR/hapiy.db" HAPIY_LOG_DIR="$STATE_DIR/logs" \
    "$DEV_BIN" up

  # Vite last: the backend is already healthy, so 18009 is dark only
  # between `down` above and this start, instead of erroring on every /v1.
  msg "ensuring frontend (Vite dev server)..."
  (cd "$WEB_DIR" && ./scripts/dev.sh)

  LAN_IF=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  LAN=$(ipconfig getifaddr "$LAN_IF" 2>/dev/null || true)
  msg "dev ready: http://127.0.0.1:$WEB_PORT  (hot reload)"
  [ -n "$LAN" ] && msg "LAN access: http://$LAN:$WEB_PORT"
}

do_up_prod() {
  need node; need pnpm
  msg "building frontend (production bundle)..."
  (cd "$WEB_DIR" && pnpm build)

  mkdir -p "$APP_DIR"
  rm -f "$BIN.new"
  build_backend_to "$BIN.new"
  mv -f "$BIN.new" "$BIN"
  chmod +x "$BIN"

  msg "syncing webdist -> $APP_DIR/webdist"
  rsync -a --delete "$WEB_DIR/dist/" "$APP_DIR/webdist/"
  seed_state_db

  # Let the autostart service yield before the local stack takes the port.
  [ -x "$BIN" ] && "$BIN" service stop --quiet 2>/dev/null || true

  # The dev frontend (Vite) also binds $WEB_PORT; it must release before serve.
  (cd "$WEB_DIR" && ./scripts/dev.sh --stop) || true

  msg "firewall allow-list..."
  firewall_mode_arg=""
  [ "${HAPIY_FIREWALL:-global}" = "per-binary" ] || firewall_mode_arg="--global"
  "$BACKEND_DIR/scripts/firewall-allow.sh" $firewall_mode_arg "$BIN" || {
    echo "[alive] firewall allow-list setup failed; aborting so we don't start a server nobody can reach." >&2
    exit 1
  }

  msg "restarting backend (prod, port $WEB_PORT, serving $APP_DIR/webdist)..."
  HAPIY_ENV=production HAPIY_HOST=0.0.0.0 HAPIY_PORT="$WEB_PORT" HAPIY_WEB_DIST="$APP_DIR/webdist" \
    HAPIY_STATE_DIR="$STATE_DIR" HAPIY_DB_PATH="$STATE_DIR/hapiy.db" HAPIY_LOG_DIR="$STATE_DIR/logs" \
    "$BIN" down || true
  HAPIY_ENV=production HAPIY_HOST=0.0.0.0 HAPIY_PORT="$WEB_PORT" HAPIY_WEB_DIST="$APP_DIR/webdist" \
    HAPIY_STATE_DIR="$STATE_DIR" HAPIY_DB_PATH="$STATE_DIR/hapiy.db" HAPIY_LOG_DIR="$STATE_DIR/logs" \
    "$BIN" up

  LAN_IF=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  LAN=$(ipconfig getifaddr "$LAN_IF" 2>/dev/null || true)
  msg "prod ready: http://127.0.0.1:$WEB_PORT"
  [ -n "$LAN" ] && msg "LAN access: http://$LAN:$WEB_PORT"
}

do_status() {
  if [ -x "$BIN" ]; then
    "$BIN" status || true
  else
    (cd "$BACKEND_DIR" && "$DEV_BIN" status) || true
  fi
  (cd "$WEB_DIR" && ./scripts/dev.sh --status) || true
}

do_stop() {
  if [ -x "$BIN" ]; then
    "$BIN" down || true
  else
    (cd "$BACKEND_DIR" && "$DEV_BIN" down) || true
  fi
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
