#!/usr/bin/env sh
# alive-core.sh — 通用「构建 + 单入口重启栈」框架（kit 拥有的文件，勿手改）。
#
# 由项目的 alive/alive.sh（entry/alive.sh 同步而来）引用；项目自己的信息与
# 钩子写在 scripts/project.sh，契约见 CONTRACT.md。
#
# 模型：
#   - prod：proj_build 构建 → 停旧栈 → proj_run 作为唯一前台命令，由本框架
#     detach 出来的 supervisor 守护（退出 2s 重拉）；
#   - dev：proj_dev_build/proj_dev_run（缺省回退 proj_run），额外的前端 dev
#     server 用 kit_sidecar 挂成边车（同生命周期、死了自动重拉、停栈一起收）；
#   - 端口：--port（仅当次）> woohkit.json 的 defaultPort；<state>/port 只是
#     写给桌面壳/外部读的握手输出，不参与决策；
#   - 状态：<state>/mode、<state>/supervisor.pid、<state>/*.pid（边车）、
#     <state>/log/<LOG_STEM>.log（主日志）、<state>/log/supervisor.log。
#
# 用法（详见 alive_usage）：
#   ./alive/alive.sh [prod|dev] [--port N] [--no-build]
#   ./alive/alive.sh --status | --stop | --version | --help

alive_usage() {
  cat >&2 <<EOF
Usage: ./alive/alive.sh [prod|dev] [--port N] [--no-build]
       ./alive/alive.sh --status | --stop | --version | --help

  (no arg)      构建并启动 prod 栈
  dev           构建（proj_dev_build）并启动 dev 栈
  --port N      本次运行改用 N（不记忆；不带参数永远用 woohkit.json 的 defaultPort）
  --no-build    跳过构建，只重启
EOF
  exit "${1:-2}"
}

# --- 内部再入口（detach 出来的子进程），必须在参数解析之前判断 -------------
alive_entry_point() {
  case "${1:-}" in
    _supervise)
      shift
      alive_init
      supervise "${1:-prod}"
      exit 0
      ;;
    _sidecar)
      shift
      alive_init
      sidecar_loop "$@"
      exit 0
      ;;
  esac
}

# alive_init — 解析默认值/端口/状态路径。子进程（_supervise/_sidecar）里
# PORT 等已在环境里，直接继承。
alive_init() {
  : "${ROOT_DIR:?内部错误：ROOT_DIR 未导出，请从 alive/alive.sh 运行}"
  : "${KIT_DIR:?内部错误：KIT_DIR 未导出，请从 alive/alive.sh 运行}"

  # 项目身份与默认端口来自项目根目录的 woohkit.json（项目自己定，kit 只读）。
  kit_load_project_json "$ROOT_DIR"

  : "${STATE_DIR:=$HOME/.$APP_ID}"
  : "${BIN:=$STATE_DIR/app/$APP_ID}"
  : "${LOG_STEM:=$APP_ID}"
  : "${HEALTH_WAIT:=60}"
  : "${DEV_HEALTH_WAIT:=120}"
  : "${EXTRA_PORTS:=}"
  : "${GO_CGO_ENV:=}"

  MODE_FILE="$STATE_DIR/mode"
  PORT_FILE="$STATE_DIR/port"
  SUP_PID_FILE="$STATE_DIR/supervisor.pid"
  LOG_DIR="$STATE_DIR/log"
  MAIN_LOG="$LOG_DIR/$LOG_STEM.log"
  SUP_LOG="$LOG_DIR/supervisor.log"
  ALIVE_SELF="${ALIVE_SELF:-$ROOT_DIR/alive/alive.sh}"
  KIT_VERSION="$(kit_version)"

  # 端口只由「项目默认 + 本次参数」决定：--port（仅当次）> WOOHKIT_PORT
  # （detach 子进程继承）> woohkit.json 的 defaultPort。没有"记忆"一说。
  if [ -n "${PORT_ARG:-}" ]; then
    PORT="$PORT_ARG"
  elif [ -n "${WOOHKIT_PORT:-}" ]; then
    PORT="$WOOHKIT_PORT"
  else
    PORT="$DEFAULT_PORT"
  fi
  case "$PORT" in
    ''|*[!0-9]*) die "invalid port: $PORT" ;;
  esac
  WOOHKIT_PORT="$PORT"

  export PORT WOOHKIT_PORT MODE STATE_DIR LOG_DIR ROOT_DIR KIT_DIR
}

# ---------------------------------------------------------------------------
# 守护循环
# ---------------------------------------------------------------------------

# supervise <mode> — 长驻守护：跑前台命令，退出就 2s 后重拉。子进程包一层
# 子 shell，即使某个钩子手滑 exec 了也不会把循环带走。
supervise() {
  mode="$1"
  mkdir -p "$LOG_DIR"
  while :; do
    if [ "$mode" = dev ] && hook_exists proj_dev_run; then
      ( proj_dev_run ) >>"$MAIN_LOG" 2>&1 || true
    else
      ( proj_run ) >>"$MAIN_LOG" 2>&1 || true
    fi
    printf '%s  [supervisor] %s exited; restarting in 2s\n' \
      "$(date '+%Y-%m-%d %H:%M:%S')" "$mode" >>"$SUP_LOG"
    sleep 2
  done
}

start_supervisor() {
  mode="$1"
  sup="$(read_pidfile "$SUP_PID_FILE")"
  if pid_alive "$sup"; then
    msg "supervisor already running (pid $sup) — reusing"
    return 0
  fi
  rm -f "$SUP_PID_FILE"
  msg "starting stack ($mode, port $PORT, log: $MAIN_LOG)"
  (
    detach /bin/sh "$ALIVE_SELF" _supervise "$mode" >>"$SUP_LOG" 2>&1 </dev/null &
    echo $! >"$SUP_PID_FILE"
  )
}

# ---------------------------------------------------------------------------
# 健康等待
# ---------------------------------------------------------------------------

health_probe() {
  mode="$1"
  if [ "$mode" = dev ] && hook_exists proj_dev_health; then
    proj_dev_health
  else
    proj_health
  fi
}

wait_health() {
  mode="$1"
  limit="$HEALTH_WAIT"
  [ "$mode" = dev ] && limit="$DEV_HEALTH_WAIT"
  n=0
  while [ "$n" -lt "$limit" ]; do
    if health_probe "$mode"; then
      return 0
    fi
    sleep 1
    n=$((n + 1))
  done
  warn "health check failed after ${limit}s — last log lines ($MAIN_LOG):"
  tail -n 15 "$MAIN_LOG" 2>/dev/null >&2 || true
  die "not healthy on :$PORT；supervisor 仍在跑，看 ./alive/alive.sh --status"
}

# ---------------------------------------------------------------------------
# 停栈
# ---------------------------------------------------------------------------

alive_stop_stack() {
  # 0) 上一代守望者/历史遗留（项目自己的清理），必须最先做。
  if hook_exists proj_stop_first; then proj_stop_first || true; fi

  # 1) 系统自启服务先停：否则它的管理器（launchd/systemd/计划任务）会把我们
  #    刚杀掉的进程再拉起来抢端口。项目没实现这个钩子就是 no-op。
  if hook_exists proj_service_pause; then proj_service_pause || true; fi

  # 2) 守护者最先停（否则它马上把主进程再拉起来）。
  sup="$(read_pidfile "$SUP_PID_FILE")"
  if [ -n "$sup" ]; then stop_pid_group "$sup" "supervisor"; fi
  rm -f "$SUP_PID_FILE"
  pkill -f "$ALIVE_SELF _supervise" 2>/dev/null || true

  # 3) 边车。
  kit_stop_sidecars

  # 4) 端口上残留的监听者（手工起的 dev server 等）。
  for p in $PORT ${EXTRA_PORTS:-}; do
    [ -n "$p" ] || continue
    kill_port_listeners "$p"
  done

  # 5) 项目自定义清理。
  if hook_exists proj_stop_extra; then proj_stop_extra || true; fi
  return 0
}

# ---------------------------------------------------------------------------
# 动作
# ---------------------------------------------------------------------------

alive_up() {
  mode="$1"
  MODE="$mode"
  export MODE

  hook_exists proj_run || die "scripts/project.sh 必须实现 proj_run（见 CONTRACT.md）"
  hook_exists proj_health || die "scripts/project.sh 必须实现 proj_health（见 CONTRACT.md）"

  mkdir -p "$STATE_DIR" "$LOG_DIR"
  # 握手输出：给桌面壳/外部读者看本次实际端口；不参与端口决策。
  printf '%s\n' "$PORT" >"$PORT_FILE"

  if [ "$mode" = prod ]; then
    hook_exists proj_build || die "scripts/project.sh 必须实现 proj_build（见 CONTRACT.md）"
    if [ "$NO_BUILD" = 1 ]; then
      msg "skipping build (--no-build)"
    else
      msg "building (prod)…"
      proj_build
    fi
  else
    if hook_exists proj_dev_build; then
      msg "building (dev)…"
      proj_dev_build
    fi
  fi

  msg "stopping previous stack…"
  alive_stop_stack

  if hook_exists proj_pre_start; then proj_pre_start; fi

  printf '%s\n' "$mode" >"$MODE_FILE"
  start_supervisor "$mode"
  wait_health "$mode"

  msg "$mode ready: UI http://127.0.0.1:$PORT/ · log: $MAIN_LOG"
  LAN_IP="$(lan_ip || true)"
  [ -n "$LAN_IP" ] && msg "LAN access: http://$LAN_IP:$PORT/"
  if hook_exists proj_ready; then proj_ready; fi
}

alive_status() {
  msg "kit: woohkit v$KIT_VERSION"
  msg "mode: $(cat "$MODE_FILE" 2>/dev/null || echo unknown)"
  if [ -x "$BIN" ]; then
    msg "binary: $BIN ($("$BIN" version 2>/dev/null || echo '?'))"
  else
    msg "binary: $BIN (missing — run ./alive/alive.sh to build)"
  fi
  msg "port :$PORT listeners: $(listen_pids "$PORT" | tr '\n' ' ')"
  for p in ${EXTRA_PORTS:-}; do
    [ -n "$p" ] || continue
    msg "port :$p listeners: $(listen_pids "$p" | tr '\n' ' ')"
  done
  sup="$(read_pidfile "$SUP_PID_FILE")"
  if pid_alive "$sup"; then
    msg "supervisor: pid $sup (running, log: $SUP_LOG)"
  else
    msg "supervisor: not running"
  fi
  for f in "$STATE_DIR"/*.pid; do
    [ -f "$f" ] || continue
    case "$f" in */supervisor.pid) continue ;; esac
    name=$(basename "$f" .pid)
    spid="$(read_pidfile "$f")"
    if pid_alive "$spid"; then
      msg "sidecar $name: pid $spid (running, log: $LOG_DIR/$name.log)"
    else
      msg "sidecar $name: not running (stale pid $spid)"
    fi
  done
  mode_now="$(cat "$MODE_FILE" 2>/dev/null || echo prod)"
  if health_probe "$mode_now"; then
    msg "app: healthy on 127.0.0.1:$PORT"
  else
    msg "app: not answering on :$PORT"
  fi
  printf -- '---- last lines of %s ----\n' "$MAIN_LOG"
  tail -n 10 "$MAIN_LOG" 2>/dev/null || echo "(no log yet)"
}

alive_stop() {
  alive_stop_stack
  left=""
  for p in $PORT ${EXTRA_PORTS:-}; do
    [ -n "$p" ] || continue
    [ -n "$(listen_pids "$p")" ] && left="$left $p"
  done
  if [ -n "$left" ]; then
    warn "something still answers on:$left"
    exit 1
  fi
  msg "stopped; no listener answers on :$PORT"
}

# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

alive_main() {
  alive_entry_point "$@"

  ACTION=""
  PORT_ARG=""
  NO_BUILD=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --port|-p)
        [ $# -ge 2 ] || die "--port needs a value"
        PORT_ARG="$2"
        shift 2
        ;;
      --port=*)
        PORT_ARG="${1#--port=}"
        shift
        ;;
      --no-build)
        NO_BUILD=1
        shift
        ;;
      --version)
        printf 'woohkit v%s\n' "$(kit_version)"
        exit 0
        ;;
      --help|-h)
        alive_usage 0
        ;;
      "")
        shift
        ;;
      *)
        if [ -z "$ACTION" ]; then
          ACTION="$1"
          shift
        else
          alive_usage 2
        fi
        ;;
    esac
  done

  alive_init

  case "$ACTION" in
    ""|prod)          alive_up prod ;;
    dev|--dev)        alive_up dev ;;
    --status|status)  alive_status ;;
    --stop|stop)      alive_stop ;;
    *)                alive_usage 2 ;;
  esac
}
