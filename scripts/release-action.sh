#!/bin/sh
# release-action.sh — OpenChamber 的「release」一键动作：发版 hapiy（非交互）。
#
#   1) 工作区有改动 → 先按项目惯例提交并推送（等价于「commit all」，消息用 v）
#   2) ./alive/release.sh "$@"  （不带参数 = 版本自动 +1，例如 1.1.2 → 1.2.0）
#   3) release 会改 version.go 并重渲染 install.sh / install.ps1 → 一并提交推送
#   4) 打印版本号和 release 链接
#
# 需要指定版本或干跑时，用聊天命令 /release 1.3.0 / /release --dry-run。
set -eu

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

git_commit_all() {
  msg="$1"
  git add -A
  if git diff --cached --quiet; then return 0; fi
  git -c user.name="${GIT_AUTHOR_NAME:-wooh}" -c user.email="${GIT_AUTHOR_EMAIL:-wooh@local}" \
    commit -q -m "$msg"
}

echo "[release] 工作目录: $ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "[release] 有未提交改动，先提交推送（消息：v）"
  git_commit_all "v"
  git push origin HEAD 2>/dev/null || git push
fi

echo "[release] 开始发版 …"
./alive/release.sh "$@"

VER=$(grep -o 'Version = "[^"]*"' project/backend/internal/version/version.go | head -1 | sed 's/Version = "//;s/"//')
if [ -n "$(git status --porcelain)" ]; then
  echo "[release] 提交发版改动（版本号 / 安装器）"
  git_commit_all "v$VER：发版"
  git push origin HEAD 2>/dev/null || git push
fi

echo ""
echo "[release] 完成：v$VER"
echo "[release] https://github.com/woohahahaaa/hapiy/releases/tag/v$VER"
