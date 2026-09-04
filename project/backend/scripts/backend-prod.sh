#!/usr/bin/env sh
# scripts/backend-prod.sh — Build + start the Go backend in PRODUCTION mode.
#
# Production mode differences vs scripts/backend.sh:
#   - forces a rebuild so the binary always matches current source
#   - sets HAPIY_ENV=production (Gin release mode)
#   - serves the built frontend (web/dist) from the same origin
#
# Usage:
#   ./scripts/backend-prod.sh          # build + start detached
#   ./scripts/backend-prod.sh --status # show pid / port / log
#   ./scripts/backend-prod.sh --stop   # stop the running backend
#
# The frontend must already be built (pnpm build) — see ../.. of start.sh.

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

PORT="${PORT:-8080}"
LOG_FILE="${LOG_FILE:-/tmp/hapiy-backend-prod.log}"
PID_FILE="${PID_FILE:-/tmp/hapiy-backend-prod.pid}"
BINARY="${BINARY:-./hapiy}"
HOST="${HOST:-0.0.0.0}"
WEB_DIST="${WEB_DIST:-$ROOT_DIR/../web/dist}"

is_listening() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

read_pid() {
  [ -f "$PID_FILE" ] && cat "$PID_FILE"
}

show_status() {
  echo "[backend-prod] log:    $LOG_FILE"
  echo "[backend-prod] pidfile: $PID_FILE"
  if pid=$(read_pid) && [ -n "$pid" ]; then
    if kill -0 "$pid" 2>/dev/null; then
      echo "[backend-prod] pid:    $pid (running)"
    else
      echo "[backend-prod] pid:    $pid (stale, removing)"
      rm -f "$PID_FILE"
    fi
  fi
  if is_listening; then
    echo "[backend-prod] port:   $PORT (listening)"
  else
    echo "[backend-prod] port:   $PORT (no listener)"
  fi
  if [ -f "$LOG_FILE" ]; then
    echo "---- last log lines ----"
    tail -n 20 "$LOG_FILE"
  fi
}

stop_server() {
  if pid=$(read_pid) && [ -n "$pid" ]; then
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
      echo "[backend-prod] stopped pid $pid"
    fi
    rm -f "$PID_FILE"
  fi
  if is_listening; then
    echo "[backend-prod] listener still present on $PORT; another process may hold it." >&2
  fi
}

build() {
  echo "[backend-prod] building $(basename "$BINARY")..."
  go build -o "$BINARY" ./cmd/hapiy
}

# kill_occupant: ask the user whether to kill whoever holds $PORT; abort if no.
kill_occupant() {
  echo "[backend-prod] port $PORT is ALREADY IN USE."
  echo "[backend-prod] Occupied by:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  printf "[backend-prod] Kill it and start a fresh instance? [y/N] "
  read answer || true
  case "$answer" in
    y|Y|yes|YES)
      echo "[backend-prod] killing old process..."
      lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | while read -r p; do
        kill "$p" 2>/dev/null || true
      done
      sleep 1
      running=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
      for p in $running; do
        kill -9 "$p" 2>/dev/null || true
      done
      rm -f "$PID_FILE"
      ;;
    *)
      echo "[backend-prod] abort; not starting."
      exit 1
      ;;
  esac
}

case "${1:-start}" in
  --status|status)
    show_status
    exit 0
    ;;
  --stop|stop)
    stop_server
    exit 0
    ;;
  start|"")
    if is_listening; then
      kill_occupant || exit 1
    fi
    build
    : > "$LOG_FILE"

    firewall_mode_arg=""
    [ "${HAPIY_FIREWALL:-global}" = "per-binary" ] || firewall_mode_arg="--global"
    "$ROOT_DIR/scripts/firewall-allow.sh" $firewall_mode_arg "$BINARY" || {
      echo "[backend-prod] firewall allow-list setup failed; aborting so we don't start a server nobody can reach." >&2
      exit 1
    }

    HAPIY_ENV=production \
    HAPIY_HOST="$HOST" \
    HAPIY_PORT="$PORT" \
    HAPIY_WEB_DIST="$WEB_DIST" \
      nohup "$BINARY" >>"$LOG_FILE" 2>&1 </dev/null &
    echo $! > "$PID_FILE"
    disown || true
    sleep 2
    echo "[backend-prod] launched (prod, dist=$WEB_DIST); log: $LOG_FILE, pid: $(cat "$PID_FILE")"
    show_status
    ;;
  *)
    echo "Usage: $0 [start|--status|--stop]" >&2
    exit 2
    ;;
esac