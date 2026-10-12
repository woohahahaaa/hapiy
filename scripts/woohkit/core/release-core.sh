#!/usr/bin/env sh
# release-core.sh — 通用「构建 + 打包 + 发 GitHub Release + 渲染安装器」流水线
# （kit 拥有的文件，勿手改）。
#
# 由项目 scripts/release.sh（entry/release.sh 同步而来）引用；项目自己的
# 信息与钩子写在 scripts/project.sh，契约见 CONTRACT.md。
#
# 用法：
#   ./scripts/release.sh              # 用 proj_version 的版本（存在 proj_bump_version 时先 +1）
#   ./scripts/release.sh 1.2.0        # 显式指定版本
#   ./scripts/release.sh --dry-run    # 只构建/打包/渲染安装器，不 gh release create
#   ./scripts/release.sh --render-only  # 同上，且保留临时产物目录并打印路径
#
# 产物名固定不带版本号，配合 releases/latest/download 实现「一条命令装最新」：
#   <asset>（proj_asset 决定，如 openboss-darwin-universal.tar.gz）
#   SHA256SUMS / version.txt
# 发布后按 INSTALL_MIRROR 决定是否把 install.sh / install.ps1（和 README.md）
# 同步到镜像仓库 main 分支。

release_usage() {
  cat >&2 <<EOF
Usage: ./scripts/release.sh [版本号] [--dry-run] [--render-only]

  无版本号   存在 proj_bump_version 时先自增，再取 proj_version
  --dry-run  构建、打包、渲染安装器，但不发布
  --render-only  同 --dry-run，且保留临时产物目录、打印路径
EOF
  exit "${1:-2}"
}

release_init() {
  : "${APP_NAME:?scripts/project.sh 必须设置 APP_NAME}"
  : "${APP_ID:?scripts/project.sh 必须设置 APP_ID}"
  : "${DEFAULT_PORT:?scripts/project.sh 必须设置 DEFAULT_PORT}"
  : "${RELEASE_REPO:?scripts/project.sh 必须设置 RELEASE_REPO}"
  : "${ROOT_DIR:?内部错误：ROOT_DIR 未导出}"
  : "${KIT_DIR:?内部错误：KIT_DIR 未导出}"
  : "${RELEASE_PLATFORMS:=darwin-universal windows-amd64 linux-amd64 linux-arm64}"
  : "${RELEASE_PLATFORM_NOTE:=macOS universal / Windows x64 / Linux x64+arm64}"
  hook_exists proj_stage || die "scripts/project.sh 必须实现 proj_stage（见 CONTRACT.md）"
  hook_exists proj_asset || die "scripts/project.sh 必须实现 proj_asset（见 CONTRACT.md）"
  hook_exists proj_version || die "scripts/project.sh 必须实现 proj_version（见 CONTRACT.md）"
}

# release_notes — 标准发布说明（安装命令自动生成）+ 项目附加段。
release_notes() {
  printf '%s %s — %s.\n\n' "$APP_NAME" "$VERSION" "$RELEASE_PLATFORM_NOTE"
  printf 'Install (macOS / Linux):\n'
  printf '  curl -fsSL https://raw.githubusercontent.com/%s/main/install.sh | sh\n\n' "$RELEASE_REPO"
  printf 'Install (Windows, PowerShell):\n'
  printf '  irm https://raw.githubusercontent.com/%s/main/install.ps1 | iex\n\n' "$RELEASE_REPO"
  printf 'Upgrade: %s upgrade — 或在控制台里一键升级。\n' "$APP_ID"
  if hook_exists proj_release_notes_extra; then
    printf '\n'
    proj_release_notes_extra
  fi
}

# release_asset_for <平台> — 平台不在矩阵里输出空串，否则调 proj_asset。
release_asset_for() {
  for p in $RELEASE_PLATFORMS; do
    if [ "$p" = "$1" ]; then
      proj_asset "$1"
      return 0
    fi
  done
  return 0
}

# release_render_installers — 把 kit 里的安装器模板按本项目配置渲染成
# 自包含的 install.sh / install.ps1，写回项目根目录（发布后即最新文档）。
release_render_installers() {
  vars="$WORK/installer-vars"
  : >"$vars"
  add() { printf '%s=%s\n' "$1" "$2" >>"$vars"; }

  ENV_PREFIX=$(printf '%s' "$APP_ID" | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9_' '_')
  add APP_NAME "$APP_NAME"
  add APP_ID "$APP_ID"
  add ENV "$ENV_PREFIX"
  add BIN "${INSTALL_BIN_NAME:-$APP_ID}"
  add REPO "$RELEASE_REPO"
  add DEFAULT_PORT "$DEFAULT_PORT"
  add ASSET_DARWIN "$(release_asset_for darwin-universal)"
  add ASSET_LINUX_AMD64 "$(release_asset_for linux-amd64)"
  add ASSET_LINUX_ARM64 "$(release_asset_for linux-arm64)"
  add ASSET_WINDOWS "$(release_asset_for windows-amd64)"
  add EXTRA_DIR "${INSTALL_EXTRA_DIR:-}"
  add DESKTOP "${INSTALL_DESKTOP:-0}"
  add SHELL_DESC "${INSTALL_SHELL_DESC:-$APP_NAME 控制台}"
  add HEALTH_PATH "${INSTALL_HEALTH_PATH:-/}"
  add EXPORT_PORT_ENV "${INSTALL_EXPORT_PORT_ENV:-0}"
  add PIN_PORT_SUBCMD "${INSTALL_PIN_PORT_SUBCMD:-0}"

  kit_render_template "$KIT_DIR/installers/install.sh" "$ROOT_DIR/install.sh" "$vars"
  chmod +x "$ROOT_DIR/install.sh"
  kit_render_template "$KIT_DIR/installers/install.ps1" "$ROOT_DIR/install.ps1" "$vars"
  msg "installers rendered: $ROOT_DIR/install.sh · $ROOT_DIR/install.ps1"
}

# release_sync_installers — INSTALL_MIRROR 仓库 main 分支同步安装器/README。
release_sync_installers() {
  msg "syncing installers to $INSTALL_MIRROR ..."
  pub="$WORK/pub"
  gh repo clone "$INSTALL_MIRROR" "$pub" -- --depth 1 >/dev/null 2>&1 \
    || die "cannot clone $INSTALL_MIRROR"
  cp "$ROOT_DIR/install.sh" "$ROOT_DIR/install.ps1" "$pub/"
  [ -f "$ROOT_DIR/README.md" ] && cp "$ROOT_DIR/README.md" "$pub/"
  (
    cd "$pub" || exit 1
    git add -A
    if git diff --cached --quiet; then
      msg "installers already up to date"
    else
      git commit -m "sync installers for $VERSION" >/dev/null
      git push >/dev/null 2>&1 || die "cannot push to $INSTALL_MIRROR"
      msg "installers pushed to $INSTALL_MIRROR"
    fi
  )
}

release_main() {
  VERSION_ARG=""
  DRY=0
  RENDER_ONLY=0
  for arg in "$@"; do
    case "$arg" in
      --render-only) RENDER_ONLY=1 ;;
      --dry-run)     DRY=1 ;;
      --help|-h)     release_usage 0 ;;
      "")            ;;
      -*)            die "unknown flag: $arg" ;;
      *)             VERSION_ARG="$arg" ;;
    esac
  done
  [ "$RENDER_ONLY" = 1 ] && DRY=1

  release_init

  # 版本：显式参数 > （可选自增后）proj_version。
  if [ -n "$VERSION_ARG" ]; then
    VERSION="$VERSION_ARG"
  else
    if hook_exists proj_bump_version; then
      proj_bump_version
    fi
    VERSION="$(proj_version)"
  fi
  [ -n "$VERSION" ] || die "cannot determine version（显式传一个，或实现 proj_version）"
  TAG="v$VERSION"

  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT INT TERM
  STAGE="$WORK/stage"
  DIST="$WORK/dist"
  mkdir -p "$STAGE" "$DIST"

  # 1) 前端（可选；须在编二进制之前——wogo 这类把 web 编译进二进制）。
  if hook_exists proj_build_web; then
    msg "building web ($VERSION) ..."
    proj_build_web
  fi

  # 2) 逐平台 staging + 打包（stage 目录里是什么，归档里就是什么）。
  ASSETS=""
  for platform in $RELEASE_PLATFORMS; do
    d="$STAGE/$platform"
    mkdir -p "$d"
    msg "staging $platform ..."
    proj_stage "$platform" "$d"
    [ -n "$(ls -A "$d" 2>/dev/null)" ] || die "proj_stage $platform 什么也没产出（$d）"
    asset="$(proj_asset "$platform")"
    [ -n "$asset" ] || die "proj_asset $platform 返回为空"
    case "$asset" in
      *.zip) (cd "$d" && zip -qr "$DIST/$asset" *) ;;
      *)     (cd "$d" && tar -czf "$DIST/$asset" *) ;;
    esac
    ASSETS="$ASSETS $asset"
  done

  printf '%s\n' "$VERSION" >"$DIST/version.txt"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$DIST" && sha256sum $ASSETS > SHA256SUMS)
  else
    (cd "$DIST" && shasum -a 256 $ASSETS > SHA256SUMS)
  fi

  # 3) 渲染安装器（写回项目根目录）。
  release_render_installers
  ls -lh "$DIST"

  if [ "$RENDER_ONLY" = 1 ]; then
    trap - 0
    msg "render-only done; 产物保留在: $DIST"
    return 0
  fi
  if [ "$DRY" = 1 ]; then
    msg "dry-run：跳过 gh release create（$RELEASE_REPO $TAG）"
    return 0
  fi

  # 4) 发布。
  command -v gh >/dev/null 2>&1 || die "gh not found"
  if gh release view "$TAG" --repo "$RELEASE_REPO" >/dev/null 2>&1; then
    die "release $TAG already exists on $RELEASE_REPO; 换个版本号或先删掉它"
  fi
  msg "publishing $TAG to $RELEASE_REPO"
  gh release create "$TAG" --repo "$RELEASE_REPO" \
    --title "$APP_NAME $VERSION" \
    --notes "$(release_notes)" \
    "$DIST"/*

  # 5) 安装器镜像仓库（可选）。
  if [ -n "${INSTALL_MIRROR:-}" ]; then
    release_sync_installers
  fi

  msg "done: $TAG published; 用户通过 install.sh / install.ps1 / $APP_ID upgrade 拿到"
}
