#!/bin/sh
# hapiy installer for macOS / Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/woohahahaaa/hapiy/main/install.sh | sh
#
# 安装脚本做四件事：下载最新发行版、校验 SHA256、装到固定目录并链接到 PATH、
# 注册登录自启（launchd / systemd --user）。重复执行即为升级。
#
# 环境变量：
#   HAPIY_HOME           安装根目录（默认 ~/.hapiy）
#   HAPIY_BIN_DIR        命令链接目录（默认 ~/.local/bin）
#   HAPIY_NO_SERVICE=1   跳过自启服务注册
set -eu

BASE="https://github.com/woohahahaaa/hapiy/releases/latest/download"
APP_DIR="${HAPIY_HOME:-$HOME/.hapiy}/app"
BIN_DIR="${HAPIY_BIN_DIR:-$HOME/.local/bin}"
# The installed backend is the prod stack, which serves on 18009 (dev uses 8080).
export HAPIY_PORT="${HAPIY_PORT:-18009}"

say() { printf '[hapiy] %s\n' "$*"; }
die() { printf '[hapiy] %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl not found"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  *) die "unsupported OS: $(uname -s) — on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=amd64 ;;
  *) die "unsupported arch: $(uname -m)" ;;
esac
case "$os-$arch" in
  darwin-arm64|darwin-amd64) asset="hapiy-darwin-universal.tar.gz" ;;
  linux-amd64) asset="hapiy-linux-amd64.tar.gz" ;;
  linux-arm64) asset="hapiy-linux-arm64.tar.gz" ;;
  *) die "no hapiy build for $os-$arch" ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say "downloading $asset ..."
curl -fsSL -o "$WORK/$asset" "$BASE/$asset" || die "download failed"
curl -fsSL -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS" || die "checksum manifest download failed"

say "verifying checksum ..."
expect="$(awk -v n="$asset" 'NF==2 && $2==n {print $1}' "$WORK/SHA256SUMS")"
[ -n "$expect" ] || die "$asset is not listed in SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$WORK/$asset" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$WORK/$asset" | awk '{print $1}')"
fi
[ "$actual" = "$expect" ] || die "checksum mismatch (got $actual)"

say "installing to $APP_DIR ..."
mkdir -p "$WORK/extract"
tar -xzf "$WORK/$asset" -C "$WORK/extract"
[ -f "$WORK/extract/hapiy" ] || die "archive is missing the hapiy binary"
mkdir -p "$APP_DIR"
cp "$WORK/extract/hapiy" "$APP_DIR/hapiy.new"
chmod +x "$APP_DIR/hapiy.new"
mv -f "$APP_DIR/hapiy.new" "$APP_DIR/hapiy"
if [ -d "$WORK/extract/webdist" ]; then
  rm -rf "$APP_DIR/webdist.new" "$APP_DIR/webdist.old"
  cp -R "$WORK/extract/webdist" "$APP_DIR/webdist.new"
  if [ -d "$APP_DIR/webdist" ]; then
    mv "$APP_DIR/webdist" "$APP_DIR/webdist.old"
  fi
  mv "$APP_DIR/webdist.new" "$APP_DIR/webdist"
  rm -rf "$APP_DIR/webdist.old"
fi

mkdir -p "$BIN_DIR"
ln -sf "$APP_DIR/hapiy" "$BIN_DIR/hapiy"
say "linked $BIN_DIR/hapiy"

# PATH: 只在用户的第一个 shell 配置里加一次（带标记，不重复写）。
if ! printf '%s' ":${PATH:-}:" | grep -q ":$BIN_DIR:"; then
  rc="$HOME/.zshrc"
  case "${SHELL:-}" in
    *bash*) rc="$HOME/.bashrc" ;;
    "") rc="$HOME/.profile" ;;
  esac
  if ! grep -qs 'hapiy PATH' "$rc" 2>/dev/null; then
    printf '\n# hapiy PATH\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$rc"
    say "added $BIN_DIR to PATH in $rc (open a new terminal to use it)"
  fi
fi

if [ "${HAPIY_NO_SERVICE:-0}" != "1" ]; then
  say "registering autostart service ..."
  "$APP_DIR/hapiy" service install || true
  # 以退出码为准判断自启到底装上没有：macOS 在无 GUI 会话（如 SSH）里
  # bootstrap 会失败，但单元已经写好，下次登录 launchd 仍会自动加载——
  # 那是 4（已安装、当前暂停），仍算成功。
  #   0 = 已安装且正在运行   4 = 已安装但当前暂停   3 = 未安装
  svc_rc=0
  "$APP_DIR/hapiy" service status >/dev/null 2>&1 || svc_rc=$?
  case "$svc_rc" in
    0)
      say "autostart ready — backend starts automatically after login"
      ;;
    4)
      say "autostart registered — unit is in place, starts at next login"
      say "start it now with: $APP_DIR/hapiy service start"
      ;;
    *)
      say "ERROR: autostart was NOT registered (service status exit $svc_rc)." >&2
      say "       fix the error above, then run: $APP_DIR/hapiy service install" >&2
      exit 1
      ;;
  esac
fi

say "done: hapiy $("$APP_DIR/hapiy" version)"
say "web console: http://127.0.0.1:$(cat "${HAPIY_HOME:-$HOME/.hapiy}/port" 2>/dev/null || echo 18009)"
