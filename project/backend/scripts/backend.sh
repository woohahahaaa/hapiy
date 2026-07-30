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
      echo "[backend] port $PORT already in use; nothing to do."
      show_status
      exit 0
    fi
    build_if_needed
    : > "$LOG_FILE"
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