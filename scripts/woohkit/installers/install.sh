#!/bin/sh
# @@APP_NAME@@ installer for macOS / Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/@@REPO@@/main/install.sh | sh
#
# 安装脚本做这些事：下载最新发行版、校验 SHA256、装到固定目录并链接到
# PATH、注册登录自启（launchd / systemd --user）@@#DESKTOP@@；macOS 还会把
# 发行包里的原生外壳 @@APP_NAME@@.app 装到桌面（老包没有时退回 Chrome 启动器）@@/DESKTOP@@。
# 重复执行即为升级。
#
# 环境变量：
#   @@ENV@@_HOME          安装根目录（默认 ~/.@@APP_ID@@）
#   @@ENV@@_BIN_DIR       命令链接目录（默认 ~/.local/bin）
#   @@ENV@@_NO_SERVICE=1  跳过自启服务注册
@@#DESKTOP@@
#   @@ENV@@_NO_DESKTOP=1  macOS：跳过桌面启动器生成
@@/DESKTOP@@
#
# 本文件由 woohkit 在 release 时按项目配置渲染生成，勿手改。
set -eu

BASE="https://github.com/@@REPO@@/releases/latest/download"
APP_DIR="${@@ENV@@_HOME:-$HOME/.@@APP_ID@@}/app"
BIN_DIR="${@@ENV@@_BIN_DIR:-$HOME/.local/bin}"
@@#EXPORT_PORT_ENV@@
# 安装的是 prod 栈（dev 用另一个端口）。
export @@ENV@@_PORT="${@@ENV@@_PORT:-@@DEFAULT_PORT@@}"
@@/EXPORT_PORT_ENV@@

say() { printf '[@@APP_ID@@] %s\n' "$*"; }
die() { printf '[@@APP_ID@@] %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl not found"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  *) die "unsupported OS: $(uname -s) — on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=amd64 ;;
  *) die "unsupported arch: $(uname -m)" ;;
esac
case "$os-$arch" in
  darwin-arm64|darwin-amd64) asset="@@ASSET_DARWIN@@" ;;
  linux-amd64) asset="@@ASSET_LINUX_AMD64@@" ;;
  linux-arm64) asset="@@ASSET_LINUX_ARM64@@" ;;
  *) die "no @@APP_NAME@@ build for $os-$arch" ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say "downloading $asset ..."
curl -fsSL -o "$WORK/$asset" "$BASE/$asset" || die "download failed"
curl -fsSL -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS" || die "checksum manifest download failed"

say "verifying checksum ..."
expect="$(awk -v n="$asset" 'NF==2 && $2==n {print $1}' "$WORK/SHA256SUMS")"
[ -n "$expect" ] || die "$asset is not listed in SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$WORK/$asset" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$WORK/$asset" | awk '{print $1}')"
fi
[ "$actual" = "$expect" ] || die "checksum mismatch (got $actual)"

say "installing to $APP_DIR ..."
mkdir -p "$WORK/extract"
tar -xzf "$WORK/$asset" -C "$WORK/extract"
[ -f "$WORK/extract/@@BIN@@" ] || die "archive is missing the @@BIN@@ binary"
mkdir -p "$APP_DIR"
cp "$WORK/extract/@@BIN@@" "$APP_DIR/@@BIN@@.new"
chmod +x "$APP_DIR/@@BIN@@.new"
mv -f "$APP_DIR/@@BIN@@.new" "$APP_DIR/@@BIN@@"
@@#EXTRA_DIR@@
if [ -d "$WORK/extract/@@EXTRA_DIR@@" ]; then
  rm -rf "$APP_DIR/@@EXTRA_DIR@@.new" "$APP_DIR/@@EXTRA_DIR@@.old"
  cp -R "$WORK/extract/@@EXTRA_DIR@@" "$APP_DIR/@@EXTRA_DIR@@.new"
  if [ -d "$APP_DIR/@@EXTRA_DIR@@" ]; then
    mv "$APP_DIR/@@EXTRA_DIR@@" "$APP_DIR/@@EXTRA_DIR@@.old"
  fi
  mv "$APP_DIR/@@EXTRA_DIR@@.new" "$APP_DIR/@@EXTRA_DIR@@"
  rm -rf "$APP_DIR/@@EXTRA_DIR@@.old"
fi
@@/EXTRA_DIR@@

mkdir -p "$BIN_DIR"
ln -sf "$APP_DIR/@@BIN@@" "$BIN_DIR/@@BIN@@"
say "linked $BIN_DIR/@@BIN@@"
@@#PIN_PORT_SUBCMD@@

# @@ENV@@_PORT：打包/创建时用参数固定首选端口；写进配置后，launchd/systemd
# 自启的 serve 也会一直用它。
if [ -n "${@@ENV@@_PORT:-}" ]; then
  say "setting preferred port $@@ENV@@_PORT ..."
  "$APP_DIR/@@BIN@@" port "$@@ENV@@_PORT"
fi
@@/PIN_PORT_SUBCMD@@

# PATH: 只在用户的第一个 shell 配置里加一次（带标记，不重复写）。
if ! printf '%s' ":${PATH:-}:" | grep -q ":$BIN_DIR:"; then
  rc="$HOME/.zshrc"
  case "${SHELL:-}" in
    *bash*) rc="$HOME/.bashrc" ;;
    "") rc="$HOME/.profile" ;;
  esac
  if ! grep -qs '@@APP_ID@@ PATH' "$rc" 2>/dev/null; then
    printf '\n# @@APP_ID@@ PATH\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$rc"
    say "added $BIN_DIR to PATH in $rc (open a new terminal to use it)"
  fi
fi

if [ "${@@ENV@@_NO_SERVICE:-0}" != "1" ]; then
  say "registering autostart service ..."
  "$APP_DIR/@@BIN@@" service install || true
  # 以退出码为准判断自启到底装上没有，别只看 install 的返回值：macOS 在无
  # GUI 会话（如 SSH）里 bootstrap 会失败，但单元已经写好，下次登录 launchd
  # 仍会自动加载——那是 4（已安装、当前暂停），仍算成功。
  #   0 = 已安装且正在运行   4 = 已安装但当前暂停   3 = 未安装
  svc_rc=0
  "$APP_DIR/@@BIN@@" service status >/dev/null 2>&1 || svc_rc=$?
  case "$svc_rc" in
    0)
      say "autostart ready — backend starts automatically after login"
      ;;
    4)
      say "autostart registered — unit is in place, starts at next login"
      say "start it now with: $APP_DIR/@@BIN@@ service start"
      ;;
    *)
      say "ERROR: autostart was NOT registered (service status exit $svc_rc)." >&2
      say "       fix the error above, then run: $APP_DIR/@@BIN@@ service install" >&2
      exit 1
      ;;
  esac
fi
@@#DESKTOP@@

# macOS：桌面生成 @@APP_NAME@@.app。发行包里带原生外壳（基于系统 WebKit 的
# 小浏览器，窗口无工具栏、程序坞就是 @@APP_NAME@@ 图标）就直接装它；老发行
# 包没有就退回 Chrome 启动器（完整窗口，方便点地址栏的「安装」装成 PWA）。
if [ "$os" = darwin ] && [ "${@@ENV@@_NO_DESKTOP:-0}" != "1" ]; then
  APP="$HOME/Desktop/@@APP_NAME@@.app"
  if [ -d "$WORK/extract/@@APP_NAME@@.app" ]; then
    say "installing desktop app ..."
    rm -rf "$APP"
    cp -R "$WORK/extract/@@APP_NAME@@.app" "$APP"
    # 浏览器/中转下载可能带隔离属性：清掉并重签一次（失败无妨）。
    xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
    codesign --force -s - "$APP" >/dev/null 2>&1 || true
  else
    say "creating desktop launcher ..."
    BUILD="$WORK/@@APP_NAME@@.app"
    mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources"

    cat > "$BUILD/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>@@APP_NAME@@</string>
  <key>CFBundleDisplayName</key><string>@@APP_NAME@@</string>
  <key>CFBundleIdentifier</key><string>dev.@@APP_ID@@.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>@@APP_NAME@@</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
</dict>
</plist>
PLIST

    cat > "$BUILD/Contents/MacOS/@@APP_NAME@@" <<'LAUNCHER'
#!/bin/sh
# @@APP_NAME@@ 启动器：用完整 Chrome 窗口打开控制台（有地址栏，方便点「安装」
# 把控制台装成 PWA，装完程序坞图标才是 @@APP_NAME@@ 自己的）。
# 端口从 ~/.@@APP_ID@@/port 读取，读不到退回 @@DEFAULT_PORT@@。
set -u

PORT="$(cat "$HOME/.@@APP_ID@@/port" 2>/dev/null || true)"
case "$PORT" in
  ''|*[!0-9]*) PORT=@@DEFAULT_PORT@@ ;;
esac
URL="http://127.0.0.1:$PORT"

for app in "Google Chrome" "Google Chrome Canary" "Microsoft Edge" "Brave Browser" "Chromium"; do
  bin="/Applications/$app.app/Contents/MacOS/$app"
  if [ -x "$bin" ]; then
    exec "$bin" --new-window "$URL"
  fi
done

# 没装 Chromium 系浏览器就交给默认浏览器打开
exec open "$URL"
LAUNCHER
    chmod +x "$BUILD/Contents/MacOS/@@APP_NAME@@"

    # 图标从本机后端取（本地服务是唯一现成的来源；服务没跑就退化成默认图标，
    # 不算失败）。
    rm -f "$BUILD/Contents/Resources/icon.icns"
    PORT_NOW="$(cat "$HOME/.@@APP_ID@@/port" 2>/dev/null || true)"
    case "$PORT_NOW" in ''|*[!0-9]*) PORT_NOW=@@DEFAULT_PORT@@ ;; esac
    if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1 \
       && curl -fsSL -o "$WORK/icon-512.png" "http://127.0.0.1:$PORT_NOW/icon-512.png"; then
      mkdir -p "$WORK/icon.iconset"
      for s in 16 32 128 256 512; do
        sips -z "$s" "$s" "$WORK/icon-512.png" --out "$WORK/icon.iconset/icon_${s}x${s}.png" >/dev/null 2>&1 || true
        sips -z "$((s * 2))" "$((s * 2))" "$WORK/icon-512.png" --out "$WORK/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
      done
      iconutil -c icns "$WORK/icon.iconset" -o "$BUILD/Contents/Resources/icon.icns" >/dev/null 2>&1 || true
    fi

    rm -rf "$APP"
    mv "$BUILD" "$APP"
  fi

  # 让 Finder / LaunchServices 立刻认识这个包（失败无妨，稍后自会刷新）。
  lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  if [ -x "$lsregister" ]; then
    "$lsregister" -f "$APP" >/dev/null 2>&1 || true
  fi
  say "desktop app: $APP"
fi
@@/DESKTOP@@

say "done: @@APP_ID@@ $("$APP_DIR/@@BIN@@" version)"
say "web console: http://127.0.0.1:$(cat "${@@ENV@@_HOME:-$HOME/.@@APP_ID@@}/port" 2>/dev/null || echo @@DEFAULT_PORT@@)"
