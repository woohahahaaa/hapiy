#!/usr/bin/env sh
# pwa.sh — 从一张 logo 生成本项目的 PWA 资产（图标 / manifest / sw.js）。
# 由 woohkit 管理，勿手改；更新用 kit 的 tools/sync.sh。契约见
# alive/woohkit/CONTRACT.md 第六节。
#
# 用法：
#   ./alive/pwa.sh logo web/logo.png --round 10%
#   ./alive/pwa.sh title "我的应用" --short 短名
#   ./alive/pwa.sh desc "一句话描述"
#   ./alive/pwa.sh theme "#0a0202"
#   ./alive/pwa.sh dir web/public
#   ./alive/pwa.sh gen | show          # 无参数 = show
#
# 配置写在 alive/pwa.json（项目自己的文件，由本工具更新，也可手改）。
# 依赖 python3 + Pillow。
#
# 目录约定：alive/ 里除了 woohkit.json 和 pwa.json（你自己的）之外都是 kit 的；
# scripts/ 里是你自己的。

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
KIT_DIR="$ROOT_DIR/alive/woohkit"
export ROOT_DIR KIT_DIR

if [ ! -f "$ROOT_DIR/alive/woohkit.json" ]; then
  echo "[pwa] missing alive/woohkit.json — 项目身份与默认端口写在这里（{name, id, defaultPort}），见 alive/woohkit/CONTRACT.md" >&2
  exit 1
fi
if [ ! -f "$KIT_DIR/pwa/pwa.py" ]; then
  echo "[pwa] missing $KIT_DIR — 先跑一次 kit 的 tools/sync.sh 把框架同步进来" >&2
  exit 1
fi

# project.sh 只赋值/定义函数，source 是安全的（和 alive.sh/release.sh 一样）；
# 这里只为读 SHELL_THEME 当主题色默认值（所以它缺失也不算错）。
if [ -f "$ROOT_DIR/scripts/project.sh" ]; then
  . "$ROOT_DIR/scripts/project.sh"
fi
export SHELL_THEME="${SHELL_THEME:-}"

exec python3 "$KIT_DIR/pwa/pwa.py" --root "$ROOT_DIR" "$@"
