#!/usr/bin/env sh
# update.sh — 把本项目的 kit 更新到最新版（项目自己的文件不动）。
# 由 woohkit 管理，勿手改；更新用 kit 的 tools/sync.sh。契约见
# alive/woohkit/CONTRACT.md 第七节。
#
# 用法：
#   ./alive/update.sh            # 更新 kit 缓存（~/.woohkit）→ 整文件覆盖同步
#   ./alive/update.sh --check    # 只对比：项目是否已是最新（不写任何文件）
#
# 凭据和首次获取一致（见 kit 的 tools/bootstrap.sh）：gh 已登录、GITHUB_TOKEN
# 或 git 自身凭据，任选其一。
#
# 目录约定：alive/ 里除了 woohkit.json 和 pwa.json（你自己的）之外都是 kit 的；
# scripts/ 里是你自己的。

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
KIT_DIR="$ROOT_DIR/alive/woohkit"
export ROOT_DIR KIT_DIR

if [ ! -f "$KIT_DIR/tools/bootstrap.sh" ]; then
  echo "[update] missing $KIT_DIR/tools/bootstrap.sh — 先用 kit 的 tools/bootstrap.sh sync 把框架同步进来" >&2
  exit 1
fi

echo "[update] 当前 kit v$(cat "$KIT_DIR/VERSION" 2>/dev/null || echo '?')（$ROOT_DIR）"
exec sh "$KIT_DIR/tools/bootstrap.sh" sync "$ROOT_DIR" "$@"
