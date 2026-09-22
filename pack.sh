#!/usr/bin/env bash
# pack.sh — 打包 Hapiy（纯 PWA 方案），模式参考隔壁 wogo/pack.sh
#
# 用法：
#   ./pack.sh          # macOS universal（Intel + Apple Silicon 通用）
#   ./pack.sh mac      # 同上
#   ./pack.sh win      # Windows amd64（需 mingw-w64 交叉工具链）
#   ./pack.sh all      # 两个平台一起打
#
# 产物：
#   macOS:   build/Hapiy.app + build/Hapiy-<版本>-<时间戳>.dmg
#   Windows: build/Hapiy-win-x64-<时间戳>.zip（解压双击 Hapiy.exe）
#
# Windows 编译 hapiy 后端依赖 CGO（mattn/go-sqlite3），需要先装 mingw-w64：
#   brew install mingw-w64

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
TARGET="${1:-mac}"
STAMP="$(date +%Y%m%d-%H%M)"
VERSION="$(grep -o '"version": *"[^"]*"' project/web/package.json | head -1 | sed 's/"version": *"//;s/"//')"

need() { command -v "$1" >/dev/null 2>&1 || { echo "[pack] 缺少工具: $1" >&2; exit 1; }; }
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

need node; need go; need pnpm; need swiftc; need rsync

# ---------------------------------------------------------------------------
# 1. 构建前端
# ---------------------------------------------------------------------------
say "构建 web 前端 (pnpm build)"
(cd project/web && pnpm build)

# ---------------------------------------------------------------------------
# 2. 按 platform 打包
# ---------------------------------------------------------------------------
case "$TARGET" in
  all|both)
    say "打包全部平台 (mac + win)"
    sh "$0" mac
    sh "$0" win
    ;;

  mac|universal)
    say "构建 hapiy 后端: darwin universal (arm64 + amd64)"
    (cd project/backend && GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -o /tmp/_hapiy-amd64 ./cmd/hapiy)
    (cd project/backend && GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build -o /tmp/_hapiy-arm64 ./cmd/hapiy)
    lipo -create /tmp/_hapiy-amd64 /tmp/_hapiy-arm64 -output /tmp/_hapiy-universal
    rm -f /tmp/_hapiy-amd64 /tmp/_hapiy-arm64

    say "组装 Hapiy.app"
    APP="build/Hapiy.app"
    rm -rf "$APP"
    mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

    # 后端二进制（壳按 <exe目录>/.../Resources/hapiy-server 启动）
    cp /tmp/_hapiy-universal "$APP/Contents/Resources/hapiy-server"
    chmod +x "$APP/Contents/Resources/hapiy-server"

    # 前端 dist（后端按 HAPIY_WEB_DIST env 从磁盘 serve）
    say "拷贝 web dist 到 app Resources/webdist"
    rsync -a --delete project/web/dist/ "$APP/Contents/Resources/webdist/"

    say "编译 macOS 壳 (Swift WKWebView)"
    swiftc shell/macos/Hapiy.swift -O -target x86_64-apple-macos10.15 -o /tmp/_shell-x86
    swiftc shell/macos/Hapiy.swift -O -target arm64-apple-macos10.15 -o /tmp/_shell-arm64
    lipo -create /tmp/_shell-x86 /tmp/_shell-arm64 -output "$APP/Contents/MacOS/Hapiy"
    rm -f /tmp/_shell-x86 /tmp/_shell-arm64
    chmod +x "$APP/Contents/MacOS/Hapiy"

    # Info.plist
    cat > "$APP/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Hapiy</string>
  <key>CFBundleIdentifier</key><string>com.hapiy.app</string>
  <key>CFBundleName</key><string>Hapiy</string>
  <key>CFBundleDisplayName</key><string>Hapiy</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleIconFile</key><string>iconfile.icns</string>
</dict>
</plist>
PLIST

    # 图标（从 PWA logo 生成）
    if [ -f project/web/public/icon-512.png ]; then
      ICONSET="$APP/Contents/Resources/icon.iconset"
      mkdir -p "$ICONSET"
      for s in 16 32 128 256 512; do
        sips -z $s $s project/web/public/icon-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
        sips -z $((s*2)) $((s*2)) project/web/public/icon-512.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
      done
      iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/iconfile.icns" 2>/dev/null || true
      rm -rf "$ICONSET"
    fi

    # 签名：优先用 Developer ID 正式签名（HAPIY_SIGN=1 且找到证书），否则 ad-hoc。
    # Gatekeeper 每次拦截是因为 ad-hoc 未公证；正式签名 + notarytool 公证后不再拦。
    SIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | grep -i "Developer ID Application" | head -1 | sed 's/^ *[0-9]* *//;s/ *"*$//' || true)"
    if [ "${HAPIY_SIGN:-0}" = "1" ] && [ -n "$SIGN_IDENTITY" ]; then
      say "Developer ID 签名: $SIGN_IDENTITY"
      codesign --force --deep --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
    else
      codesign --force --deep --sign - "$APP" 2>/dev/null || true
    fi

    echo
    echo "  ✅ macOS: $APP"
    echo "     双击打开 → 自动启动后端 (127.0.0.1:18099) + 独立 WKWebView 窗口"
    echo "     后端常驻，关窗口不影响；再次双击直接开窗"
    echo "     数据目录: ~/.hapiy/ (hapiy.db + logs)"

    # DMG
    if command -v hdiutil >/dev/null 2>&1; then
      DMG="build/Hapiy-${VERSION}-${STAMP}.dmg"
      say "生成 dmg: $DMG"
      DMGDIR="build/_dmg"
      rm -rf "$DMGDIR" && mkdir -p "$DMGDIR"
      cp -R "$APP" "$DMGDIR/"
      ln -s /Applications "$DMGDIR/Applications"
      RAW="build/_raw.dmg"
      rm -f "$DMG" "$RAW"
      hdiutil create -volname Hapiy -srcfolder "$DMGDIR" -ov -format UDRW "$RAW" >/dev/null
      hdiutil convert -format UDZO -o "$DMG" "$RAW" >/dev/null
      rm -f "$RAW"
      rm -rf "$DMGDIR"
      echo "  ✅ DMG: $DMG"
      # 公证（仅正式签名时；需要 APPLE_ID / APPLE_TEAM_ID / APPLE_APP_PASSWORD 环境变量）
      if [ "${HAPIY_SIGN:-0}" = "1" ] && [ -n "$SIGN_IDENTITY" ] && \
         [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ]; then
        say "notarytool 公证 $DMG ..."
        xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait 2>&1 | grep -Ei "status|id" | head -5
        xcrun stapler staple "$DMG" 2>/dev/null && echo "  ✅ stapled: $DMG"
      else
        echo "  (未公证：ad-hoc 或被各机器 Gatekeeper 拦。正式发布请设 HAPIY_SIGN=1 + Apple 凭据)"
      fi
    fi
    ;;

  win|windows)
    if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
      echo "[pack] win 需要 mingw-w64 交叉编译器，先安装: brew install mingw-w64" >&2
      exit 1
    fi

    say "构建 hapiy 后端: windows amd64 (CGO + sqlite)"
    WINDIR="build/Hapiy-win"
    rm -rf "$WINDIR" && mkdir -p "$WINDIR"
    (cd project/backend && \
      GOOS=windows GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-w64-mingw32-gcc \
      go build -trimpath -ldflags "-s -w -H windowsgui" -o "$ROOT/$WINDIR/hapiy-server.exe" ./cmd/hapiy)

    say "构建 Windows 壳 (WebView2)"
    (cd shell/win && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o "$ROOT/$WINDIR/Hapiy.exe" .)

    say "拷贝 web dist"
    rsync -a project/web/dist/ "$WINDIR/webdist/"

    (cd build && zip -q -r "Hapiy-win-x64-${STAMP}.zip" "Hapiy-win")
    rm -rf "$WINDIR"

    echo
    echo "  ✅ Windows: build/Hapiy-win-x64-${STAMP}.zip"
    echo "     解压后双击 Hapiy.exe → 内启后端 (127.0.0.1:18099) + 独立 WebView2 窗口"
    echo "     数据目录: %USERPROFILE%\\.hapiy\\ (hapiy.db + logs)"
    ;;

  *)
    echo "用法: $0 [mac|win]" >&2
    exit 2
    ;;
esac