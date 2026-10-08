#!/usr/bin/env bash
# release.sh — 构建并发布全平台产物到 GitHub Releases（curl/irm 安装路线）。
#
# 用法：
#   scripts/release.sh            # 版本取 backend/internal/version/version.go
#   scripts/release.sh 1.2.0      # 显式指定版本
#
# 产物名固定不带版本号，配合 releases/latest/download 实现"一条命令装最新"：
#   hapiy-darwin-universal.tar.gz   （hapiy + webdist/）
#   hapiy-windows-amd64.zip         （hapiy.exe + webdist/）
#   hapiy-linux-amd64.tar.gz
#   hapiy-linux-arm64.tar.gz
#   SHA256SUMS                       自升级校验清单
#   version.txt                      版本检查（/update 与版本弹窗用）
#
# 发行资产直接挂在 hapiy 仓库的 Releases 下；install.sh / install.ps1 就在
# 仓库根目录，raw 安装地址（/main/install.sh）随代码一起更新。
#
# 依赖：node/npm（或 pnpm）、go、lipo（macOS）、gh（已登录）、git、shasum。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RELEASE_REPO="woohahahaaa/hapiy"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(grep -o 'Version = "[^"]*"' project/backend/internal/version/version.go | head -1 | sed 's/Version = "//;s/"//')"
fi
[ -n "$VERSION" ] || { echo "[release] cannot determine version (pass it as \$1)" >&2; exit 1; }

TAG="v$VERSION"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DIST="$WORK/dist"
STAGE="$WORK/stage"
mkdir -p "$DIST" "$STAGE"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "building web ($VERSION)"
(cd project/web && pnpm build)

say "building binaries"
mkdir -p "$STAGE/darwin" "$STAGE/win" "$STAGE/linux-amd64" "$STAGE/linux-arm64"
(cd project/backend && GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -o "$WORK/hapiy-darwin-amd64" ./cmd/hapiy)
(cd project/backend && GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build -o "$WORK/hapiy-darwin-arm64" ./cmd/hapiy)
lipo -create "$WORK/hapiy-darwin-amd64" "$WORK/hapiy-darwin-arm64" -output "$STAGE/darwin/hapiy"
(cd project/backend && GOOS=windows GOARCH=amd64 go build -o "$STAGE/win/hapiy.exe" ./cmd/hapiy)
(cd project/backend && GOOS=linux GOARCH=amd64 go build -o "$STAGE/linux-amd64/hapiy" ./cmd/hapiy)
(cd project/backend && GOOS=linux GOARCH=arm64 go build -o "$STAGE/linux-arm64/hapiy" ./cmd/hapiy)

say "staging webdist"
for dir in "$STAGE/darwin" "$STAGE/win" "$STAGE/linux-amd64" "$STAGE/linux-arm64"; do
  cp -R project/web/dist "$dir/webdist"
done

say "packaging"
tar -czf "$DIST/hapiy-darwin-universal.tar.gz" -C "$STAGE/darwin" hapiy webdist
(cd "$STAGE/win" && zip -qr "$DIST/hapiy-windows-amd64.zip" hapiy.exe webdist)
tar -czf "$DIST/hapiy-linux-amd64.tar.gz" -C "$STAGE/linux-amd64" hapiy webdist
tar -czf "$DIST/hapiy-linux-arm64.tar.gz" -C "$STAGE/linux-arm64" hapiy webdist
printf '%s\n' "$VERSION" > "$DIST/version.txt"
(cd "$DIST" && shasum -a 256 \
  hapiy-darwin-universal.tar.gz \
  hapiy-windows-amd64.zip \
  hapiy-linux-amd64.tar.gz \
  hapiy-linux-arm64.tar.gz > SHA256SUMS)
ls -lh "$DIST"

say "publishing $TAG to $RELEASE_REPO"
if gh release view "$TAG" --repo "$RELEASE_REPO" >/dev/null 2>&1; then
  echo "[release] release $TAG already exists on $RELEASE_REPO; bump the version or delete it first" >&2
  exit 1
fi
gh release create "$TAG" --repo "$RELEASE_REPO" \
  --title "hapiy $VERSION" \
  --notes "hapiy $VERSION — macOS universal / Windows x64 / Linux x64+arm64.

Install (macOS / Linux):
  curl -fsSL https://raw.githubusercontent.com/$RELEASE_REPO/main/install.sh | sh

Install (Windows, PowerShell):
  irm https://raw.githubusercontent.com/$RELEASE_REPO/main/install.ps1 | iex

Upgrade: hapiy upgrade — or use the version dialog in the sidebar." \
  "$DIST"/*

say "done: $TAG published; users get it via install.sh / install.ps1 / hapiy upgrade"
