#!/usr/bin/env sh
# bootstrap.sh — woohkit 一键接入/更新入口（自带 kit 缓存管理，可在任意目录运行）。
#
#   bootstrap.sh init <项目目录>   首次接入：同步框架 + 生成 scripts/project.sh 骨架
#   bootstrap.sh sync <项目目录>   更新框架：整文件覆盖 kit 文件（项目文件不动）
#   bootstrap.sh update            只把缓存的 kit 拉到最新
#
# 已接入的项目不用记这份脚本的路径：项目里 `./alive/update.sh` 就是
# `bootstrap.sh sync <项目根>`（它的快照里带着本脚本的副本），`--check` 只对比。
#
# kit 缓存在 ~/.woohkit（WOOHKIT_CACHE 可覆盖）。仓库是私有的，需要以下任一凭据：
#   - gh 已登录（优先）
#   - 环境变量 GITHUB_TOKEN
#   - git 自身已有凭据（credential helper）
#
# 真·一条命令（连这个脚本都还没拿到时，gh 已登录）：
#   bash <(gh api repos/woohahahaaa/aliveAndPWA/contents/tools/bootstrap.sh \
#          -H "Accept: application/vnd.github.raw") init .
set -eu

REPO="woohahahaaa/aliveAndPWA"
CACHE="${WOOHKIT_CACHE:-$HOME/.woohkit}"

say() { printf '[bootstrap] %s\n' "$*"; }
die() { printf '[bootstrap] %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
Usage: bootstrap.sh init <project-dir>   # 首次接入：sync + 生成 project.sh 骨架
       bootstrap.sh sync <project-dir>   # 更新框架（kit 文件整文件覆盖）
       bootstrap.sh update               # 只更新 kit 缓存
EOF
  exit 2
}

update_cache() {
  if [ -d "$CACHE/.git" ]; then
    say "updating kit cache: $CACHE"
    git -C "$CACHE" pull --ff-only --quiet || die "更新 $CACHE 失败（缓存里有本地改动或冲突？）"
  elif [ -e "$CACHE" ]; then
    die "$CACHE 已存在但不是 git 仓库，先移走它再跑"
  else
    say "cloning $REPO -> $CACHE"
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      gh repo clone "$REPO" "$CACHE" -- --depth 1 || die "gh repo clone 失败（gh auth 状态？）"
    else
      url="https://github.com/$REPO.git"
      if [ -n "${GITHUB_TOKEN:-}" ]; then
        url="https://x-access-token:$GITHUB_TOKEN@github.com/$REPO.git"
      fi
      git clone --depth 1 "$url" "$CACHE" \
        || die "git clone 失败（私有仓库：gh 登录 或 GITHUB_TOKEN=xxx）"
    fi
  fi
  say "kit v$(cat "$CACHE/VERSION" 2>/dev/null || echo '?') ready at $CACHE"
}

ACTION="${1:-}"
case "$ACTION" in
  update)
    update_cache
    ;;
  init|sync)
    TARGET="${2:?usage: bootstrap.sh $ACTION <project-dir>}"
    [ -d "$TARGET" ] || die "not a directory: $TARGET"
    update_cache
    # 第三个参数透传（sync.sh 认 --check：只对比不写）。
    exec "$CACHE/tools/$ACTION.sh" "$TARGET" "${3:-}"
    ;;
  *)
    usage
    ;;
esac
