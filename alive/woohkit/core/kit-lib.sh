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

# kit_load_project_json <项目根目录> — 读项目的 alive/woohkit.json（项目自己声明
# 的身份、默认端口与桌面壳外观：name / id / defaultPort / shell{glass, frameless}），
# 导出 APP_NAME / APP_ID / DEFAULT_PORT / SHELL_GLASS / SHELL_FRAMELESS。
# 端口只认项目自己的值：--port 只当次生效（见 alive-core），kit 不记忆、不覆盖。
# shell 块两个开关都给默认 true（无边框 + 毛玻璃）。
kit_load_project_json() {
  _kit_json="$1/alive/woohkit.json"
  [ -f "$_kit_json" ] || die "missing alive/woohkit.json（需要 {name, id, defaultPort}，见 alive/woohkit/CONTRACT.md）"
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

# 桌面壳外观（都可选，默认都开）：glass=毛玻璃背景，frameless=无边框顶部。
# url 填了就打开这个网址（http/https/file 开头），留空=打开本机 http://127.0.0.1:<端口>/。
shell = cfg.get("shell")
if shell is None:
    shell = {}
if not isinstance(shell, dict):
    errs.append("shell（可选对象：{glass: 布尔, frameless: 布尔, url: 字符串}）")
    shell = {}
glass = shell.get("glass", True)
frameless = shell.get("frameless", True)
url = shell.get("url", "")
if not isinstance(glass, bool):
    errs.append("shell.glass（布尔：true=毛玻璃背景，false=不透明主题色）")
if not isinstance(frameless, bool):
    errs.append("shell.frameless（布尔：true=无边框顶部，false=系统原生标题栏）")
if not isinstance(url, str):
    errs.append("shell.url（字符串：外壳打开的地址，留空=本机服务）")
elif url and not re.match(r"^(https?|file)://\S+$", url):
    errs.append("shell.url（要 http(s):// 或 file:// 开头的完整地址）")

if errs:
    sys.stderr.write("woohkit.json 无效字段: %s\n" % "；".join(errs))
    sys.exit(1)

def q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"

print("APP_NAME=%s" % q(name))
print("APP_ID=%s" % q(pid))
print("DEFAULT_PORT=%d" % port)
print("SHELL_GLASS=%d" % (1 if glass else 0))
print("SHELL_FRAMELESS=%d" % (1 if frameless else 0))
print("SHELL_URL=%s" % q(url))
PY
)" || die "woohkit.json 无效（$_kit_json）"
  eval "$_kit_out"
  export APP_NAME APP_ID DEFAULT_PORT SHELL_GLASS SHELL_FRAMELESS SHELL_URL
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

# pid_cwd <pid> — 进程的工作目录（Linux 读 /proc，其余走 lsof）。取不到输出空。
pid_cwd() {
  if [ -e "/proc/$1/cwd" ]; then
    readlink "/proc/$1/cwd" 2>/dev/null || true
  else
    lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
  fi
}

# path_join <基准目录> <路径> — 把（可能是相对的）路径按基准目录还原成绝对路径
# 并规范化（…/x/../y 交给 cd）。输出物理路径（pwd -P，符号链接解析掉）——lsof
# 和 /proc 给的 cwd 都是物理路径，不统一就永远比不相等。文件本身不必存在，只要
# 所在目录存在；否则输出空。
path_join() {
  case "$2" in
    /*) _pj="$2" ;;
    *)  _pj="$1/$2" ;;
  esac
  _dir="$(cd "$(dirname "$_pj")" 2>/dev/null && pwd -P)" || return 0
  printf '%s/%s\n' "$_dir" "$(basename "$_pj")"
}

# kit_stray_pids <子入口名> — 列出「属于本项目这套 kit」的再入口进程
# （_supervise / _sidecar）pid：命令行里有 alive.sh <子入口名>，且把命令行里的
# 脚本路径按该进程自己的 cwd 还原后，正好是本项目的 alive.sh（$ALIVE_SELF）。
# 只认自己的项目——别的项目同名进程不会被误收。
#
# 为什么绕这一圈：手工起的守护常把脚本写成相对路径（sh ./alive/alive.sh
# _supervise dev），命令行里没有绝对路径，`pkill -f "$ALIVE_SELF _supervise"`
# 匹配不到，又没有 pidfile 记录，停栈就收不干净。也不能放宽成 `alive.sh
# _supervise`——pkill 是全量匹配，那样会连别的项目的守护一起杀。
kit_stray_pids() {
  sub="${1:?kit_stray_pids 需要子入口名}"
  # 自己这边也走物理路径，跟 lsof / /proc 给的 cwd 同一口径。
  self="$(path_join / "$ALIVE_SELF")"
  ps -axww -o pid=,command= 2>/dev/null | while read -r pid cmd; do
    case "$cmd" in *alive.sh*) ;; *) continue ;; esac
    script="$(printf '%s\n' "$cmd" |
      awk -v s="$sub" '{ for (i = 2; i <= NF; i++) if ($i == s) { print $(i-1); exit } }')"
    [ -n "$script" ] || continue
    cwd="$(pid_cwd "$pid")"
    [ -n "$cwd" ] || continue
    abs="$(path_join "$cwd" "$script")"
    [ -n "$abs" ] || continue
    if [ "$abs" = "$ALIVE_SELF" ] || [ "$abs" = "$self" ]; then
      printf '%s\n' "$pid"
    fi
  done
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
# 变量都带 _gu_ 前缀：kit_go_build 用的是同名全局（pkgdir/out/pkg），不隔离会被它
# 覆盖，lipo 就会写进临时目录、随后被删掉（hapiy 归档里丢过二进制，就是这毛病）。
kit_go_universal() {
  _gu_pkgdir="$1"
  _gu_out="$2"
  _gu_pkg="${3:-.}"
  _gu_tmpd=$(mktemp -d)
  kit_go_build "$_gu_pkgdir" darwin amd64 "$_gu_tmpd/amd64" "$_gu_pkg"
  kit_go_build "$_gu_pkgdir" darwin arm64 "$_gu_tmpd/arm64" "$_gu_pkg"
  msg "lipo -create -> $_gu_out"
  lipo -create "$_gu_tmpd/amd64" "$_gu_tmpd/arm64" -output "$_gu_out"
  rm -rf "$_gu_tmpd"
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
