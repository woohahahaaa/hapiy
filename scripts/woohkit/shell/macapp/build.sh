#!/bin/sh
# build.sh — 编译 macOS 极简外壳（WKWebView，只打开本机控制台）。
#
# 用法：
#   shell/macapp/build.sh <项目根目录> <输出目录>   # 产出 <输出目录>/<APP_NAME>.app
#
# 应用名 / 端口 / 主题色等来自项目 scripts/project.sh：
#   APP_NAME（必填）、APP_ID（必填）、DEFAULT_PORT（必填）
#   SHELL_THEME       主题色 #rrggbb，默认 #0a0202
#   SHELL_BUNDLE_ID   bundle id，默认 dev.<APP_ID>.app
#   SHELL_ICON        图标源 png，默认 <web|public>/public/icon-512.png
#
# 依赖 swiftc（Xcode Command Line Tools）、lipo、sips、iconutil；产物为
# arm64 + x86_64 通用二进制，末尾自动 ad-hoc 签名（本机运行无需开发者证书）。
set -eu

ROOT="${1:?usage: build.sh <project-root> <out-dir>}"
OUT="${2:?usage: build.sh <project-root> <out-dir>}"
KIT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

. "$ROOT/scripts/project.sh"
: "${APP_NAME:?scripts/project.sh 必须设置 APP_NAME}"
: "${APP_ID:?scripts/project.sh 必须设置 APP_ID}"
: "${DEFAULT_PORT:?scripts/project.sh 必须设置 DEFAULT_PORT}"

THEME="${SHELL_THEME:-#0a0202}"
BUNDLE_ID="${SHELL_BUNDLE_ID:-dev.$APP_ID.app}"

ICON=""
for c in "${SHELL_ICON:-}" "$ROOT/web/public/icon-512.png" "$ROOT/public/icon-512.png"; do
  if [ -n "$c" ] && [ -f "$c" ]; then
    ICON="$c"
    break
  fi
done

command -v swiftc >/dev/null 2>&1 || {
  echo "[macapp] swiftc not found — install Xcode Command Line Tools first" >&2
  exit 1
}

# #rrggbb -> 三个十进制分量（0x 十六进制在 POSIX 算术里是标准写法）。
hex="${THEME#\#}"
R=$((0x$(printf '%s' "$hex" | cut -c1-2)))
G=$((0x$(printf '%s' "$hex" | cut -c3-4)))
B=$((0x$(printf '%s' "$hex" | cut -c5-6)))

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 生成的配置（顶层 let；Shell.swift 复制为 main.swift 编译）。
cat > "$WORK/Config.swift" <<EOF
// 由 woohkit shell/macapp/build.sh 生成，勿手改。
let kAppName = "$APP_NAME"
let kDefaultPort = $DEFAULT_PORT
let kPortRelPath = ".$APP_ID/port"
let kThemeRed = $R
let kThemeGreen = $G
let kThemeBlue = $B
EOF
cp "$KIT_DIR/shell/macapp/Shell.swift" "$WORK/main.swift"

echo "[macapp] compiling $APP_NAME (arm64 + x86_64) ..."
swiftc -O -target arm64-apple-macos12.0 -o "$WORK/app-arm64" "$WORK/main.swift" "$WORK/Config.swift"
swiftc -O -target x86_64-apple-macos12.0 -o "$WORK/app-x64" "$WORK/main.swift" "$WORK/Config.swift"
lipo -create "$WORK/app-arm64" "$WORK/app-x64" -output "$WORK/app"

APP="$OUT/$APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$WORK/app" "$APP/Contents/MacOS/$APP_NAME"
chmod +x "$APP/Contents/MacOS/$APP_NAME"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

if [ -n "$ICON" ] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  mkdir -p "$WORK/icon.iconset"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s" "$ICON" --out "$WORK/icon.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z "$((s * 2))" "$((s * 2))" "$ICON" --out "$WORK/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$WORK/icon.iconset" -o "$APP/Contents/Resources/icon.icns"
else
  echo "[macapp] warn: no icon source (SHELL_ICON or web/public/icon-512.png) — default icon" >&2
fi

codesign --force -s - "$APP" >/dev/null 2>&1 || true
echo "[macapp] built: $APP"
