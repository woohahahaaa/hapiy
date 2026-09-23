#!/usr/bin/env sh
# alive.sh — keep the hapiy stack alive, restarting the SAME mode
# (production "start.sh" or dev "start-dev.sh") that was originally launched.
#
# Usage:
#   ./alive.sh                      supervise PROD stack (start.sh) — default
#   ./alive.sh dev [--foreground]   supervise DEV stack (start-dev.sh)
#   ./alive.sh --status             show supervisor state + last log
#   ./alive.sh --stop               stop the supervisor (stack stays up)
#
# The chosen mode is recorded in /tmp/alive.mode. When a health check
# fails repeatedly, it kills stale processes (HAPIY_AUTO_KILL=1) and re-runs the
# same start script. Runs detached by default (nohup + pidfile + disown).

set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

MODE_FILE="${HAPIY_KEEPALIVE_MODE_FILE:-/tmp/alive.mode}"
PID_FILE="${HAPIY_KEEPALIVE_PID_FILE:-/tmp/alive.pid}"
LOG_FILE="${HAPIY_KEEPALIVE_LOG_FILE:-/tmp/alive.log}"
INTERVAL="${HAPIY_KEEPALIVE_INTERVAL:-10}"
MAX_FAIL="${HAPIY_KEEPALIVE_MAX_FAIL:-3}"
BOOT_WAIT="${HAPIY_KEEPALIVE_BOOT_WAIT:-15}"
API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-18009}"

log() { printf '%s  %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE"; }

read_mode() {
  if [ -f "$MODE_FILE" ]; then cat "$MODE_FILE"; fi
}

is_running() {
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

web_ok() {
  lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1
}

health() {
  curl -sf -m 5 "$1" >/dev/null 2>&1
}

stack_up() {
  case "$1" in
    prod) health "http://127.0.0.1:$WEB_PORT/health" ;;
    dev)  web_ok && health "http://127.0.0.1:$API_PORT/health" ;;
  esac
}

start_stack() {
  log "mode=$1 not healthy after ${MAX_FAIL}x, restarting with HAPIY_AUTO_KILL=1..."
  if [ "$1" = "prod" ]; then
    HAPIY_AUTO_KILL=1 "$ROOT_DIR/start.sh" >>"$LOG_FILE" 2>&1
  else
    HAPIY_AUTO_KILL=1 "$ROOT_DIR/start-dev.sh" >>"$LOG_FILE" 2>&1
  fi
}

supervise() {
  mode="$1"
  printf '%s' "$mode" >"$MODE_FILE"
  log "supervise mode=$mode (interval=${INTERVAL}s max_fail=${MAX_FAIL})"
  # Bring the stack up right away if it isn't already healthy (idempotent:
  # a foreground start may have just brought it up), then monitor and
  # auto-restart on failure.
  if ! stack_up "$mode"; then
    start_stack "$mode" || log "initial start attempt failed (supervisor will retry)"
  fi
  fail=0
  while :; do
    if stack_up "$mode"; then
      [ "$fail" -ne 0 ] && log "recovered (fail streak cleared)"
      fail=0
    else
      fail=$((fail + 1))
      log "health fail ($fail/${MAX_FAIL}) mode=$mode"
      if [ "$fail" -ge "$MAX_FAIL" ]; then
        start_stack "$mode" || log "restart attempt failed (will retry)"
        fail=0
        sleep "$BOOT_WAIT"
        continue
      fi
    fi
    sleep "$INTERVAL"
  done
}

show_status() {
  echo "[keepalive] pidfile: $PID_FILE  modemap: $MODE_FILE  log: $LOG_FILE"
  if is_running; then
    echo "[keepalive] pid: $(cat "$PID_FILE") (running, mode: $(read_mode))"
  else
    echo "[keepalive] supervisor not running (mode on record: $(read_mode))"
  fi
  echo "---- last keepalive log lines ----"
  tail -n 15 "$LOG_FILE" 2>/dev/null || echo "(no log yet)"
}

stop_supervisor() {
  if is_running; then
    pid=$(cat "$PID_FILE")
    kill "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "[keepalive] stopped supervisor pid $pid (hapiy stack keeps running)"
  else
    echo "[keepalive] supervisor not running"
  fi
}

start_supervised() {
  mode="$1"
  self="$ROOT_DIR/$(basename "$0")"
  if is_running; then
    old_mode=$(read_mode)
    echo "[keepalive] supervisor already running (mode=$old_mode); forcing restart in mode=$mode ..."
    stop_supervisor >/dev/null 2>&1 || true
    if [ "$old_mode" != "$mode" ]; then
      echo "[keepalive] mode switch: stopping old stack ($old_mode)..."
      if [ "$old_mode" = "dev" ]; then
        HAPIY_AUTO_KILL=1 "$ROOT_DIR/start-dev.sh" --stop >>"$LOG_FILE" 2>&1 || true
      else
        HAPIY_AUTO_KILL=1 "$ROOT_DIR/start.sh" --stop >>"$LOG_FILE" 2>&1 || true
      fi
      sleep 2
    fi
  fi

  # Fresh start: stop whatever is running in the target mode, then bring the
  # stack up in the FOREGROUND so build/start output streams to the terminal
  # and we only hand off to the background supervisor once /health is good.
  if [ "$mode" = "dev" ]; then
    HAPIY_AUTO_KILL=1 "$ROOT_DIR/start-dev.sh" --stop >>"$LOG_FILE" 2>&1 || true
  else
    HAPIY_AUTO_KILL=1 "$ROOT_DIR/start.sh" --stop >>"$LOG_FILE" 2>&1 || true
  fi
  sleep 1

  if [ "$mode" = "dev" ]; then
    HAPIY_AUTO_KILL=1 "$ROOT_DIR/start-dev.sh"
  else
    HAPIY_AUTO_KILL=1 "$ROOT_DIR/start.sh"
  fi

  # Wait for the stack to actually pass health before handing off to the
  # background supervisor, so the user sees it come up to ready.
  printf '[keepalive] waiting for %s health' "$mode"
  ok=0
  i=0
  while [ "$i" -lt 60 ]; do
    if stack_up "$mode"; then ok=1; break; fi
    printf '.'
    sleep 1
    i=$((i + 1))
  done
  echo ""
  if [ "$ok" != 1 ]; then
    echo "[keepalive] warning: $mode did not become healthy within 60s; supervisor will keep trying" >&2
  fi

  rm -f "$PID_FILE"
  nohup "$self" supervise "$mode" >>"$LOG_FILE" 2>&1 </dev/null &
  echo $! >"$PID_FILE"
  disown || true
  sleep 1
  echo "[keepalive] supervisor pid $(cat "$PID_FILE") monitoring mode=$mode; log: $LOG_FILE"
  show_status
}

case "${1:-}" in
  supervise)
    supervise "${2:?supervise requires a mode}"
    ;;
  dev|prod|"")
    mode="${1:-prod}"
    case "$mode" in prod|"") mode="prod" ;; esac
    fg=0
    [ "$#" -ge 2 ] && [ "${2:-}" = "--foreground" ] && fg=1
    if [ "$fg" = 1 ]; then
      printf '%s' "$mode" >"$MODE_FILE"
      supervise "$mode"
    else
      start_supervised "$mode"
    fi
    ;;
  --status|status)
    show_status
    ;;
  --stop|stop)
    stop_supervisor
    ;;
  *)
    echo "Usage: $0 [dev] [--foreground] | --status | --stop   (no arg = prod)" >&2
    exit 2
    ;;
esac