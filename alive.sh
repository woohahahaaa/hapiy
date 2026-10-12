#!/usr/bin/env sh
# alive.sh — 构建 & 启动本项目的栈（由 woohkit 管理，勿手改；更新用 kit 的
# tools/sync.sh）。项目自己的信息与钩子写在 scripts/project.sh，契约见
# scripts/woohkit/CONTRACT.md。

set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
KIT_DIR="$ROOT_DIR/scripts/woohkit"
export ROOT_DIR KIT_DIR

if [ ! -f "$ROOT_DIR/scripts/project.sh" ]; then
  echo "[alive] missing scripts/project.sh — 这是项目自己的钩子文件，见 scripts/woohkit/CONTRACT.md" >&2
  exit 1
fi
if [ ! -f "$KIT_DIR/core/alive-core.sh" ]; then
  echo "[alive] missing $KIT_DIR — 先跑一次 kit 的 tools/sync.sh 把框架同步进来" >&2
  exit 1
fi

. "$ROOT_DIR/scripts/project.sh"
. "$KIT_DIR/core/kit-lib.sh"
. "$KIT_DIR/core/alive-core.sh"

alive_main "$@"
