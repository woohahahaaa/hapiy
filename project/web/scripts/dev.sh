#!/usr/bin/env sh
# scripts/dev.sh — Start the Vite dev server as a detached background process.
#
# Usage:
#   ./scripts/dev.sh          # build (if missing) + start, write log to /tmp
#   ./scripts/dev.sh --status # show listener + last log lines
#   ./scripts/dev.sh --stop   # stop the running dev server
#
# Designed for use outside an interactive agent session, including via a
# reverse proxy that points at this machine's LAN address on port 18009.

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

PORT="${PORT:-18009}"
LOG_FILE="${LOG_FILE:-/tmp/hapiy-web-dev.log}"
PID_FILE="${PID_FILE:-/tmp/hapiy-web-dev.pid}"

is_listening() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

read_pid() {
  [ -f "$PID_FILE" ] && cat "$PID_FILE"
}

show_status() {
  echo "[dev] log:    $LOG_FILE"
  echo "[dev] pidfile: $PID_FILE"
  if pid=$(read_pid) && [ -n "$pid" ]; then
    if kill -0 "$pid" 2>/dev/null; then
      echo "[dev] pid:    $pid (running)"
    else
      echo "[dev] pid:    $pid (stale, removing)"
      rm -f "$PID_FILE"
    fi
  fi
  if is_listening; then
    echo "[dev] port:   $PORT (listening)"
  else
    echo "[dev] port:   $PORT (no listener)"
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
      echo "[dev] stopped pid $pid"
    fi
    rm -f "$PID_FILE"
  fi
  if is_listening; then
    echo "[dev] listener still present on $PORT; another process may hold it." >&2
  fi
}

# kill_occupant: ask the user whether to kill whoever holds $PORT; abort if no.
kill_occupant() {
  echo "[dev] port $PORT is ALREADY IN USE."
  echo "[dev] Occupied by:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  printf "[dev] Kill it and start a fresh dev server? [y/N] "
  read answer || true
  case "$answer" in
    y|Y|yes|YES)
      echo "[dev] killing old process..."
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
      echo "[dev] abort; not starting."
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
    if [ ! -d node_modules ]; then
      echo "[dev] installing dependencies..."
      pnpm install --frozen-lockfile
    fi
    if [ ! -d dist ]; then
      echo "[dev] running initial production build..."
      pnpm run build
    fi
    : > "$LOG_FILE"
    nohup pnpm dev >>"$LOG_FILE" 2>&1 </dev/null &
    echo $! > "$PID_FILE"
    disown || true
    sleep 2
    echo "[dev] launched; log: $LOG_FILE, pid: $(cat "$PID_FILE")"
    show_status
    ;;
  *)
    echo "Usage: $0 [start|--status|--stop]" >&2
    exit 2
    ;;
esac