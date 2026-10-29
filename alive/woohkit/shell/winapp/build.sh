#!/bin/sh
# build.sh — 构建 Windows 外壳（WinForms + WebView2），交叉编译可在 macOS 上跑。
#
# 用法：
#   shell/winapp/build.sh <项目根目录> <输出目录>
#   产物：<输出目录>/<APP_NAME>.exe + Microsoft.Web.WebView2.Core.dll /
#   Microsoft.Web.WebView2.WinForms.dll / WebView2Loader.dll
#
# 应用名 / 端口 / 主题色等来自项目 scripts/project.sh（与 shell/macapp/build.sh
# 同一套配置：APP_NAME、APP_ID、DEFAULT_PORT、SHELL_THEME、SHELL_ICON）。
# 桌面壳外观（毛玻璃背景 / 无边框顶部 / 预设地址）看项目 alive/woohkit.json
# 的 shell 块（都可选，默认都 true / 空）：
#   "shell": { "glass": true, "frameless": true, "url": "" }
# glass=true 时 Win11 22H2+ 出 DWM Acrylic，老系统自动退回主题色纯色；
# url 填了（http(s):// 或 file://）就直接打开它，留空=打开本机服务。
#
# 依赖：.NET SDK（dotnet，或 ~/.dotnet/dotnet）、python3 + Pillow（生成 icon.ico）。
# net48（.NET Framework 4.8，Win10/11 自带）交叉编译，引用程序集由
# Microsoft.NETFramework.ReferenceAssemblies 提供。
set -eu

ROOT="${1:?usage: build.sh <project-root> <out-dir>}"
OUT="${2:?usage: build.sh <project-root> <out-dir>}"
KIT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT_DIR="$ROOT"
export ROOT_DIR KIT_DIR

. "$ROOT/scripts/project.sh"
. "$KIT_DIR/core/kit-lib.sh"
kit_load_project_json "$ROOT"

THEME="${SHELL_THEME:-#0a0202}"
# 外观两个开关：来自 woohkit.json 的 shell 块（kit_load_project_json 导出 1/0）
case "$SHELL_GLASS" in 1) GLASS=true ;; *) GLASS=false ;; esac
case "$SHELL_FRAMELESS" in 1) FRAMELESS=true ;; *) FRAMELESS=false ;; esac
# 预设地址（shell.url，留空=本机服务）；转义进 C# 字符串字面量
APP_URL_ESC=$(printf '%s' "$SHELL_URL" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

ICON=""
for c in "${SHELL_ICON:-}" "$ROOT/web/public/icon-512.png" "$ROOT/public/icon-512.png"; do
  if [ -n "$c" ] && [ -f "$c" ]; then
    ICON="$c"
    break
  fi
done

DOTNET="$(command -v dotnet || true)"
if [ -z "$DOTNET" ] && [ -x "$HOME/.dotnet/dotnet" ]; then
  DOTNET="$HOME/.dotnet/dotnet"
fi
[ -n "$DOTNET" ] || {
  echo "[winapp] dotnet SDK not found — install .NET SDK (or ~/.dotnet) first" >&2
  exit 1
}
[ -n "$ICON" ] || {
  echo "[winapp] no icon source (SHELL_ICON or web/public/icon-512.png)" >&2
  exit 1
}

hex="${THEME#\#}"
R=$((0x$(printf '%s' "$hex" | cut -c1-2)))
G=$((0x$(printf '%s' "$hex" | cut -c3-4)))
B=$((0x$(printf '%s' "$hex" | cut -c5-6)))

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp "$KIT_DIR/shell/winapp/MainForm.cs" "$KIT_DIR/shell/winapp/Program.cs" \
   "$KIT_DIR/shell/winapp/Shell.csproj" "$KIT_DIR/shell/winapp/app.manifest" "$WORK/"

# 生成的配置（应用名/端口/主题色；PortRelPath 用 Windows 分隔符）。
cat > "$WORK/ShellConfig.cs" <<EOF
// 由 woohkit shell/winapp/build.sh 生成，勿手改。
namespace KitShell
{
    internal static class ShellConfig
    {
        public const string AppName = "$APP_NAME";
        public const int DefaultPort = $DEFAULT_PORT;
        public const string PortRelPath = @".$APP_ID\\port";
        public const int ThemeR = $R;
        public const int ThemeG = $G;
        public const int ThemeB = $B;
        public static readonly bool Glass = $GLASS;
        public static readonly bool Frameless = $FRAMELESS;
        public const string AppUrl = "$APP_URL_ESC";
    }
}
EOF

echo "[winapp] generating icon.ico ..."
python3 - "$ICON" "$WORK/icon.ico" <<'PY'
import struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
sizes = [16, 24, 32, 48, 64, 128, 256]
images = []
for s in sizes:
    im = Image.open(src).convert("RGBA").resize((s, s), Image.LANCZOS)
    images.append((s, im))

# ICO 容器 + PNG 负载（Vista 以后支持，Win10/11 直接可读）
entries, blobs, offset = [], [], 6 + 16 * len(images)
for s, im in images:
    import io
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    data = buf.getvalue()
    entries.append(struct.pack("<BBBBHHII", s if s < 256 else 0, s if s < 256 else 0,
                               0, 0, 1, 32, len(data), offset))
    blobs.append(data)
    offset += len(data)

with open(dst, "wb") as f:
    f.write(struct.pack("<HHH", 0, 1, len(images)))
    for e in entries:
        f.write(e)
    for b in blobs:
        f.write(b)
print("[winapp] icon.ico written:", dst)
PY

echo "[winapp] building $APP_NAME.exe ..."
"$DOTNET" build "$WORK/Shell.csproj" -c Release -v quiet -nologo \
  -p:AssemblyName="$APP_NAME" \
  -p:AssemblyTitle="$APP_NAME" \
  -p:Product="$APP_NAME" \
  -p:Company="$APP_NAME"

BIN="$WORK/bin/Release/net48"
mkdir -p "$OUT"
rm -f "$OUT/$APP_NAME.exe"
cp "$BIN/$APP_NAME.exe" "$OUT/"
for f in Microsoft.Web.WebView2.Core.dll Microsoft.Web.WebView2.WinForms.dll; do
  cp "$BIN/$f" "$OUT/"
done
LOADER="$BIN/runtimes/win-x64/native/WebView2Loader.dll"
[ -f "$LOADER" ] || LOADER="$BIN/WebView2Loader.dll"
cp "$LOADER" "$OUT/"

echo "[winapp] built: $OUT/$APP_NAME.exe"
ls -l "$OUT"
