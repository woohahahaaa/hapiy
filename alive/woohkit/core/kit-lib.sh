#!/usr/bin/env sh
# kit-lib.sh — woohkit 公共工具层（kit 拥有的文件，勿手改；同步时整文件覆盖）。
#
# 被 core/alive-core.sh 与 core/release-core.sh 引用。项目自己写的东西只在
# scripts/project.sh，契约见 CONTRACT.md。

kit_version() {
  if [ -f "$KIT_DIR/VERSION" ]; then cat "$KIT_DIR/VERSION"; else printf 'unknown'; fi
}

msg()  { printf '[%s] %s\n' "${APP_ID:-woohkit}" "$*"; }
warn() { printf '[%s] %s\n' "${APP_ID:-woohkit}" "$*" >&2; }
die()  { printf '[%s] %s\n' "${APP_ID:-woohkit}" "$*" >&2; exit 1; }

# hook_exists <函数名> — 项目钩子是否实现了这个函数。
hook_exists() { command -v "$1" >/dev/null 2>&1; }

# kit_load_project_json <项目根目录> — 读项目根目录 woohkit.json（项目自己声明
# 的身份与默认端口：name / id / defaultPort），导出 APP_NAME / APP_ID /
# DEFAULT_PORT。端口只认项目自己的值：--port 只当次生效（见 alive-core），
# kit 不记忆、不覆盖。
kit_load_project_json() {
  _kit_json="$1/woohkit.json"
  [ -f "$_kit_json" ] || die "missing woohkit.json（项目根目录需要 {name, id, defaultPort}，见 CONTRACT.md）"
  _kit_out="$(python3 - "$_kit_json" <<'PY'
import json, re, sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
except Exception as e:
    sys.stderr.write("woohkit.json 解析失败: %s\n" % e)
    sys.exit(1)

errs = []
name = cfg.get("name")
pid = cfg.get("id")
if not isinstance(name, str) or not name.strip():
    errs.append("name（显示名，非空字符串）")
if not isinstance(pid, str) or not re.match(r"^[a-z0-9][a-z0-9_-]*$", pid or ""):
    errs.append("id（小写字母/数字/_- 开头，用作 ~/.<id> 等）")
try:
    port = int(cfg.get("defaultPort"))
    if not (1 <= port <= 65535):
        raise ValueError
except (TypeError, ValueError):
    errs.append("defaultPort（1-65535 的整数）")
if errs:
    sys.stderr.write("woohkit.json 无效字段: %s\n" % "；".join(errs))
    sys.exit(1)

def q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"

print("APP_NAME=%s" % q(name))
print("APP_ID=%s" % q(pid))
print("DEFAULT_PORT=%d" % port)
PY
)" || die "woohkit.json 无效（$_kit_json）"
  eval "$_kit_out"
  export APP_NAME APP_ID DEFAULT_PORT
}

# ---------------------------------------------------------------------------
# pid / 进程
# ---------------------------------------------------------------------------

read_pidfile() {
  if [ -f "$1" ]; then head -n 1 "$1" | tr -dc '0-9'; fi
}

pid_alive() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$1" 2>/dev/null
}

# stop_pid_group <pid> <label> — 停「进程组」：SIGTERM → 10s 宽限 → SIGKILL。
# 守护者是 setsid 出来的组首领，组杀能连它当前守护的孩子（服务器）一起收掉，
# 不会留孤儿。
# kill_to <信号名> <目标> — 兼容各 POSIX 壳的负 pid（整组）写法，失败交给
# 调用方兜底。
kill_to() {
  kill -s "$1" -- "$2" 2>/dev/null && return 0
  kill "-$1" "$2" 2>/dev/null && return 0
  return 1
}

stop_pid_group() {
  pid="$1"
  label="$2"
  if ! pid_alive "$pid"; then
    msg "$label pid ${pid:-none} not running（陈旧记录）"
    return 0
  fi
  kill_to TERM "-$pid" || kill_to TERM "$pid" || true
  n=0
  while pid_alive "$pid" && [ "$n" -lt 50 ]; do
    sleep 0.2
    n=$((n + 1))
  done
  if pid_alive "$pid"; then
    kill_to KILL "-$pid" || kill_to KILL "$pid" || true
  fi
  msg "stopped $label pid $pid"
}

# ---------------------------------------------------------------------------
# 网络
# ---------------------------------------------------------------------------

# lan_ip — 局域网地址（macOS：默认路由接口 → en0；Linux：hostname -I）。
# 取不到就输出空串，调用方自己判断。
lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
    if [ -n "$iface" ]; then
      ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
      [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
    fi
    ip=$(ipconfig getifaddr en0 2>/dev/null || true)
    [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
  fi
  if command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
  fi
  return 0
}

listen_pids() {
  lsof -tnPiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
}

# kill_port_listeners <port> — 收掉端口上残留的监听者（上一代手工进程等）。
kill_port_listeners() {
  pids=$(listen_pids "$1")
  [ -n "$pids" ] || return 0
  kill $pids 2>/dev/null || true
  n=0
  while [ -n "$(listen_pids "$1")" ] && [ "$n" -lt 20 ]; do
    sleep 0.5
    n=$((n + 1))
  done
  pids=$(listen_pids "$1")
  if [ -n "$pids" ]; then kill -9 $pids 2>/dev/null || true; fi
  return 0
}

# ---------------------------------------------------------------------------
# 后台化
# ---------------------------------------------------------------------------

# detach CMD... — 换会话首领（setsid）后 exec，脱离调用者：关终端、进程树被
# 清理都不影响它。macOS 没有 setsid(1)，用 python3 顶。
detach() {
  exec python3 -c 'import os, sys
try:
    os.setsid()
except OSError:
    pass
os.execvp(sys.argv[1], sys.argv[1:])' "$@"
}

# ---------------------------------------------------------------------------
# 边车（sidecar）— alive 托管的辅助常驻进程（dev 里的前端 dev server 这类）
# ---------------------------------------------------------------------------
#
# kit_sidecar <名字> <命令> — 确保名为 <名字> 的边车在跑：死了自动重拉
# （1s），已在跑则复用。日志 <state>/log/<名字>.log，pid <state>/<名字>.pid。
# 只在 alive-core 环境里可用（依赖 STATE_DIR / LOG_DIR / SUP_LOG / ALIVE_SELF）。
kit_sidecar() {
  name="$1"
  cmd="$2"
  pidf="$STATE_DIR/$name.pid"
  if pid_alive "$(read_pidfile "$pidf")"; then
    msg "sidecar $name already running (pid $(read_pidfile "$pidf")) — reusing"
    return 0
  fi
  rm -f "$pidf"
  msg "sidecar $name starting (log: $LOG_DIR/$name.log)"
  (
    detach /bin/sh "$ALIVE_SELF" _sidecar "$name" "$cmd" >>"$SUP_LOG" 2>&1 </dev/null &
    echo $! >"$pidf"
  )
}

# 边车守护循环（alive.sh _sidecar <名字> <命令> 再入口）：长驻，退出即重拉。
sidecar_loop() {
  name="$1"
  cmd="$2"
  log="$LOG_DIR/$name.log"
  while :; do
    # `|| true` 是保命的：本文件跑在 set -e 下，命令退出会连循环一起带走。
    /bin/sh -c "$cmd" >>"$log" 2>&1 || true
    printf '%s  [sidecar:%s] exited; restarting in 1s\n' \
      "$(date '+%Y-%m-%d %H:%M:%S')" "$name"
    sleep 1
  done
}

# 停掉全部边车（supervisor.pid 除外——它由 alive-core 单独管）。
kit_stop_sidecars() {
  for f in "$STATE_DIR"/*.pid; do
    [ -f "$f" ] || continue
    case "$f" in */supervisor.pid) continue ;; esac
    name=$(basename "$f" .pid)
    stop_pid_group "$(read_pidfile "$f")" "sidecar $name"
    rm -f "$f"
  done
  return 0
}

# ---------------------------------------------------------------------------
# Go 构建助手（alive / release 共用）
# ---------------------------------------------------------------------------

# kit_go_build <包目录> <goos> <goarch> <输出> [包路径=.]
# 可选变量 GO_CGO_ENV（例 CGO_ENABLED=1）：仅 darwin 目标时生效（跨编到
# arm64/amd64 用本机 clang，hapiy 这类带 cgo 的项目需要）。
kit_go_build() {
  pkgdir="$1"
  goos="$2"
  goarch="$3"
  out="$4"
  pkg="${5:-.}"
  msg "go build $goos/$goarch -> $out"
  if [ "$goos" = darwin ] && [ -n "${GO_CGO_ENV:-}" ]; then
    (cd "$pkgdir" && env GOOS="$goos" GOARCH="$goarch" $GO_CGO_ENV go build -o "$out" "$pkg")
  else
    (cd "$pkgdir" && GOOS="$goos" GOARCH="$goarch" go build -o "$out" "$pkg")
  fi
}

# kit_go_universal <包目录> <输出> [包路径=.] — darwin amd64+arm64 lipo 通用二进制。
kit_go_universal() {
  pkgdir="$1"
  out="$2"
  pkg="${3:-.}"
  tmpd=$(mktemp -d)
  kit_go_build "$pkgdir" darwin amd64 "$tmpd/amd64" "$pkg"
  kit_go_build "$pkgdir" darwin arm64 "$tmpd/arm64" "$pkg"
  msg "lipo -create -> $out"
  lipo -create "$tmpd/amd64" "$tmpd/arm64" -output "$out"
  rm -rf "$tmpd"
}

# ---------------------------------------------------------------------------
# 模板渲染（安装器）
# ---------------------------------------------------------------------------
#
# kit_render_template <模板> <输出> <变量文件>
#   变量文件是 KEY=value 行；
#   模板里 @@KEY@@ 是标量替换，@@#KEY@@ ... @@/KEY@@ 是区块（KEY 值为空则
#   整块删除，非空则保留原样，不嵌套）。
kit_render_template() {
  python3 - "$1" "$2" "$3" <<'PY'
import re, sys

tpl_path, out_path, var_path = sys.argv[1], sys.argv[2], sys.argv[3]

vals = {}
with open(var_path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.rstrip("\n")
        if "=" in line:
            k, v = line.split("=", 1)
            vals[k] = v

with open(tpl_path, "r", encoding="utf-8") as f:
    text = f.read()

# 区块：@@#KEY@@ ... @@/KEY@@（可整行，也可行内）；KEY 值为空 / "0" / "false"
# 视为假，整块删除。标记后紧跟的一个换行 + 标记前的一个行尾空白会被吃掉，
# 避免删除/保留时留下多余空行。
def _truthy(v):
    return v not in (None, "", "0", "false")

def section(m):
    key, body = m.group(1), m.group(2)
    return body if _truthy(vals.get(key)) else ""

prev = None
while prev != text:
    prev = text
    text = re.sub(r"@@#([A-Z0-9_]+)@@[ \t]*\n?(.*?)@@/\1@@[ \t]*\n?", section, text, flags=re.S)

# 标量：@@KEY@@（未知 KEY 报错，防拼写错误静默渲染成空）
def scalar(m):
    key = m.group(1)
    if key not in vals:
        sys.stderr.write("woohkit render: unknown placeholder @@%s@@\n" % key)
        sys.exit(1)
    return vals[key]

text = re.sub(r"@@([A-Z0-9_]+)@@", scalar, text)

with open(out_path, "w", encoding="utf-8") as f:
    f.write(text)
PY
}
