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

# ours_on_port: some listener on $PORT runs with this project as cwd — our own
# dev server (detached spawns outlive their launcher), so replacing it is
# expected and needs no prompt.
ours_on_port() {
  for p in $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null); do
    cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
    [ "$cwd" = "$ROOT_DIR" ] && return 0
  done
  return 1
}

kill_listeners() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | while read -r p; do
    kill "$p" 2>/dev/null || true
  done
  sleep 1
  for p in $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null); do
    kill -9 "$p" 2>/dev/null || true
  done
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
    if ours_on_port; then
      echo "[dev] killing leftover listener(s) on $PORT..."
      kill_listeners
    else
      echo "[dev] listener still present on $PORT; another process may hold it." >&2
    fi
  fi
}

# kill_occupant: ask the user whether to kill whoever holds $PORT; abort if no.
kill_occupant() {
  echo "[dev] port $PORT is ALREADY IN USE."
  echo "[dev] Occupied by:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  if [ "${HAPIY_AUTO_KILL:-}" = "1" ] || ours_on_port; then
    answer="y"
  else
    printf "[dev] Kill it and start a fresh dev server? [y/N] "
    read answer || true
  fi
  case "$answer" in
    y|Y|yes|YES)
      echo "[dev] killing old process..."
      kill_listeners
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
    [ -f "$LOG_FILE" ] && mv -f "$LOG_FILE" "$LOG_FILE.prev" 2>/dev/null || true
    : > "$LOG_FILE"
    # Launch Vite in a new session detached from this process group (Node's
    # detached spawn = setsid). Plain nohup+& stays in the caller's group: an
    # agent/session shell that kills its group when the command ends takes Vite
    # down seconds later, leaving the port dark (502 at the reverse proxy)
    # until the next prod run.
    node -e '
      const { spawn } = require("node:child_process");
      const fs = require("node:fs");
      const [, log, pidFile] = process.argv;
      const out = fs.openSync(log, "a");
      const child = spawn("pnpm", ["dev"], {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", out, out],
        env: process.env,
      });
      fs.writeFileSync(pidFile, String(child.pid));
      child.unref();
    ' "$LOG_FILE" "$PID_FILE"
    sleep 2
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "[dev] dev server exited during startup; last log lines:" >&2
      tail -n 20 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      exit 1
    fi
    # "launched" must mean the port actually serves: callers open the page the
    # moment this returns, and a reverse proxy hitting the gap gets a 502.
    n=0
    while [ "$n" -lt 15 ] && ! is_listening; do
      sleep 1
      n=$((n+1))
    done
    if ! is_listening; then
      echo "[dev] port $PORT not listening after $((n+2))s; last log lines:" >&2
      tail -n 20 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      exit 1
    fi
    echo "[dev] launched; log: $LOG_FILE, pid: $(cat "$PID_FILE")"
    show_status
    ;;
  *)
    echo "Usage: $0 [start|--status|--stop]" >&2
    exit 2
    ;;
esac