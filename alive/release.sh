#!/usr/bin/env sh
# release.sh — 构建 & 发布本项目的全平台产物（由 woohkit 管理，勿手改；
# 更新用 kit 的 tools/sync.sh）。项目自己的信息与钩子写在 scripts/project.sh、
# 身份/端口在根目录 woohkit.json，契约见 alive/woohkit/CONTRACT.md。
#
# 目录约定：alive/ 里的一切都是 kit 的（alive.sh、release.sh、woohkit/ 快照）；
# scripts/ 里是你自己的。

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
KIT_DIR="$ROOT_DIR/alive/woohkit"
export ROOT_DIR KIT_DIR

if [ ! -f "$ROOT_DIR/scripts/project.sh" ]; then
  echo "[release] missing scripts/project.sh — 这是项目自己的钩子文件，见 alive/woohkit/CONTRACT.md" >&2
  exit 1
fi
if [ ! -f "$ROOT_DIR/woohkit.json" ]; then
  echo "[release] missing woohkit.json — 项目身份与默认端口写在项目根目录（{name, id, defaultPort}），见 alive/woohkit/CONTRACT.md" >&2
  exit 1
fi
if [ ! -f "$KIT_DIR/core/release-core.sh" ]; then
  echo "[release] missing $KIT_DIR — 先跑一次 kit 的 tools/sync.sh 把框架同步进来" >&2
  exit 1
fi

. "$ROOT_DIR/scripts/project.sh"
. "$KIT_DIR/core/kit-lib.sh"
. "$KIT_DIR/core/release-core.sh"

release_main "$@"
