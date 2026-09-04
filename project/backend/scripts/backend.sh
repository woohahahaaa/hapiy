#!/usr/bin/env sh
# scripts/backend.sh — Build (if needed) + start the Go backend as a detached
# background process, and provide --status / --stop subcommands.
#
# Usage:
#   ./scripts/backend.sh            # build (if needed) + start detached
#   ./scripts/backend.sh --status   # show pid / port / log
#   ./scripts/backend.sh --stop     # stop the running backend
#
# Designed for use outside an interactive agent session so the binary keeps
# running after the session ends.

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

PORT="${PORT:-8080}"
LOG_FILE="${LOG_FILE:-/tmp/hapiy-backend.log}"
PID_FILE="${PID_FILE:-/tmp/hapiy-backend.pid}"
BINARY="${BINARY:-./hapiy}"
HOST="${HOST:-0.0.0.0}"

is_listening() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

read_pid() {
  [ -f "$PID_FILE" ] && cat "$PID_FILE"
}

show_status() {
  echo "[backend] log:    $LOG_FILE"
  echo "[backend] pidfile: $PID_FILE"
  if pid=$(read_pid) && [ -n "$pid" ]; then
    if kill -0 "$pid" 2>/dev/null; then
      echo "[backend] pid:    $pid (running)"
    else
      echo "[backend] pid:    $pid (stale, removing)"
      rm -f "$PID_FILE"
    fi
  fi
  if is_listening; then
    echo "[backend] port:   $PORT (listening)"
  else
    echo "[backend] port:   $PORT (no listener)"
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
      echo "[backend] stopped pid $pid"
    fi
    rm -f "$PID_FILE"
  fi
  if is_listening; then
    echo "[backend] listener still present on $PORT; another process may hold it." >&2
  fi
}

build_if_needed() {
  if [ ! -x "$BINARY" ] || [ -n "${FORCE_REBUILD:-}" ]; then
    echo "[backend] building $(basename "$BINARY")..."
    go build -o "$BINARY" ./cmd/hapiy
  fi
}

# kill_occupant: ask the user whether to kill whoever holds $PORT; abort if no.
kill_occupant() {
  echo "[backend] port $PORT is ALREADY IN USE."
  echo "[backend] Occupied by:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  printf "[backend] Kill it and start a fresh backend? [y/N] "
  read answer || true
  case "$answer" in
    y|Y|yes|YES)
      echo "[backend] killing old process..."
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
      echo "[backend] abort; not starting."
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
    build_if_needed
    : > "$LOG_FILE"

    firewall_mode_arg=""
    [ "${HAPIY_FIREWALL:-global}" = "per-binary" ] || firewall_mode_arg="--global"
    "$ROOT_DIR/scripts/firewall-allow.sh" $firewall_mode_arg "$BINARY" || {
      echo "[backend] firewall allow-list setup failed; aborting so we don't start a server nobody can reach." >&2
      exit 1
    }

    HAPIY_HOST="$HOST" nohup "$BINARY" >>"$LOG_FILE" 2>&1 </dev/null &
    echo $! > "$PID_FILE"
    disown || true
    sleep 2
    echo "[backend] launched; log: $LOG_FILE, pid: $(cat "$PID_FILE")"
    show_status
    ;;
  *)
    echo "Usage: $0 [start|--status|--stop]" >&2
    exit 2
    ;;
esac