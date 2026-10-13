#!/usr/bin/env python3
# pwa.py — woohkit PWA 资产生成器（kit 拥有，勿手改；随 tools/sync.sh 更新）。
#
# 入口是项目的 alive/pwa.sh（薄壳），本文件读：
#   alive/woohkit.json  身份（name / id）
#   alive/pwa.json      本工具的配置（logo / 圆角 / 标题 / 主题色 / 静态目录）
# 把图标、manifest.webmanifest、sw.js 生成到项目的静态目录。
#
# 边界：只写 alive/pwa.json 与静态目录里的生成物；绝不改 index.html；
# 已存在的 sw.js 不覆盖。契约见 CONTRACT.md 第六节。

import argparse
import json
import os
import re
import sys

try:
    from PIL import Image, ImageChops, ImageDraw
except ImportError:
    sys.stderr.write("[pwa] 需要 Pillow：python3 -m pip install Pillow\n")
    sys.exit(1)

CFG_PATH = "alive/pwa.json"
MANIFEST_PATH = "manifest.webmanifest"
SW_PATH = "sw.js"

ICON_SIZES = (192, 512)
APPLE_SIZE = 180
FAVICON_SIZES = (16, 32, 48)
FAVICON_SRC = 256
MASKABLE_SIZE = 512
MASKABLE_SAFE = 0.8  # 内容占边长比例（形状由系统按安全区裁）

STATIC_CANDIDATES = ("web/public", "public", "app/public", "frontend/public", "static")


def msg(text):
    sys.stdout.write("[pwa] %s\n" % text)


def die(text):
    sys.stderr.write("[pwa] %s\n" % text)
    sys.exit(1)


def rel(root, path):
    try:
        return os.path.relpath(path, root)
    except ValueError:
        return path


# --- 配置 ------------------------------------------------------------------


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_cfg(root):
    path = os.path.join(root, CFG_PATH)
    if not os.path.exists(path):
        return {}
    try:
        return load_json(path)
    except Exception as exc:
        die("%s 解析失败：%s" % (CFG_PATH, exc))


def save_cfg(root, cfg):
    path = os.path.join(root, CFG_PATH)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_identity(root):
    path = os.path.join(root, "alive/woohkit.json")
    if not os.path.exists(path):
        die("缺少 alive/woohkit.json（{name, id, defaultPort}），见 CONTRACT.md")
    try:
        cfg = load_json(path)
    except Exception as exc:
        die("alive/woohkit.json 解析失败：%s" % exc)
    return (cfg.get("name") or "App"), (cfg.get("id") or "app")


def norm_hex(value):
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(value or "").strip())
    if not m:
        die("颜色要写成 #rrggbb：%s" % value)
    return "#" + m.group(1).lower()


def parse_round(value):
    text = str(value).strip().rstrip("%")
    try:
        num = float(text)
    except ValueError:
        die("圆角要写成 10%% 或 10（边长百分比）：%s" % value)
    if not 0 <= num <= 50:
        die("圆角范围 0-50%%：%s" % value)
    return num


def find_dir(root, cfg):
    configured = cfg.get("dir")
    if configured:
        return configured if os.path.isabs(configured) else os.path.join(root, configured)
    for cand in STATIC_CANDIDATES:
        path = os.path.join(root, cand)
        if os.path.isdir(path):
            return path
    return None


def effective(root, cfg):
    name, app_id = load_identity(root)
    theme = norm_hex(cfg.get("theme") or os.environ.get("SHELL_THEME") or "#000000")
    title = cfg.get("title") or name
    return {
        "app_id": app_id,
        "dir": find_dir(root, cfg),
        "logo": cfg.get("logo"),
        "round": float(cfg.get("round") or 0),
        "title": title,
        "short": cfg.get("short") or title,
        "desc": cfg.get("desc") or "",
        "theme": theme,
        "background": norm_hex(cfg.get("background") or theme),
    }


# --- 图像 ------------------------------------------------------------------


def _rgba(hex_color):
    h = norm_hex(hex_color).lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def square_logo(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    if w == h:
        return im
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def rounded(src, size, pct):
    im = src.resize((size, size), Image.LANCZOS)
    if pct <= 0:
        return im
    radius = min(size / 2.0, size * pct / 100.0)
    ss = 4  # 超采样后缩小，边缘更干净
    mask = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * ss - 1, size * ss - 1), radius=radius * ss, fill=255
    )
    mask = mask.resize((size, size), Image.LANCZOS)
    im.putalpha(ImageChops.multiply(im.getchannel("A"), mask))
    return im


def flat(src, size, bg_hex):
    """满幅方图，透明处填背景色（apple-touch-icon 不接受透明）。"""
    canvas = Image.new("RGBA", (size, size), _rgba(bg_hex))
    canvas.alpha_composite(src.resize((size, size), Image.LANCZOS))
    return canvas


def maskable(src, bg_hex):
    """满幅背景 + logo 缩进到 80% 安全区居中（形状由系统裁）。"""
    canvas = Image.new("RGBA", (MASKABLE_SIZE, MASKABLE_SIZE), _rgba(bg_hex))
    inner = int(MASKABLE_SIZE * MASKABLE_SAFE)
    offset = (MASKABLE_SIZE - inner) // 2
    canvas.alpha_composite(src.resize((inner, inner), Image.LANCZOS), (offset, offset))
    return canvas


def write_icons(src, directory, eff):
    for size in ICON_SIZES:
        rounded(src, size, eff["round"]).save(os.path.join(directory, "icon-%d.png" % size))
    rounded(src, FAVICON_SRC, eff["round"]).save(
        os.path.join(directory, "favicon.ico"),
        format="ICO",
        sizes=[(s, s) for s in FAVICON_SIZES],
    )
    flat(src, APPLE_SIZE, eff["background"]).save(
        os.path.join(directory, "apple-touch-icon.png")
    )
    maskable(src, eff["background"]).save(
        os.path.join(directory, "icon-maskable-512.png")
    )


def build_manifest(eff):
    manifest = {"name": eff["title"], "short_name": eff["short"]}
    if eff["desc"]:
        manifest["description"] = eff["desc"]
    manifest.update(
        {
            "lang": "zh-CN",
            "start_url": "/",
            "scope": "/",
            "display": "standalone",
            "orientation": "any",
            "background_color": eff["background"],
            "theme_color": eff["theme"],
            "icons": [
                {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
            ],
        }
    )
    return manifest


def write_sw(kit_dir, directory, app_id):
    """sw.js 只在缺失时生成一次（之后由项目自己维护，不覆盖）。"""
    dst = os.path.join(directory, SW_PATH)
    if os.path.exists(dst):
        return False
    template = os.path.join(kit_dir, "pwa", SW_PATH)
    if not os.path.exists(template):
        die("缺少模板 %s —— 跑一次 kit 的 tools/sync.sh" % template)
    with open(template, encoding="utf-8") as f:
        text = f.read()
    with open(dst, "w", encoding="utf-8") as f:
        f.write(text.replace("APP_ID_CACHE_PLACEHOLDER", app_id))
    return True


def head_snippet(eff):
    return "\n".join(
        (
            '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
            '<link rel="icon" href="/favicon.ico" sizes="any" />',
            '<link rel="manifest" href="/manifest.webmanifest" />',
            '<meta name="theme-color" content="%s" />' % eff["theme"],
            '<meta name="apple-mobile-web-app-title" content="%s" />' % eff["short"],
        )
    )


def fmt_round(pct):
    return ("%g%%" % pct) if pct else "无"


# --- 命令 ------------------------------------------------------------------


def cmd_gen(root, kit_dir, cfg):
    eff = effective(root, cfg)
    if not eff["logo"]:
        die("还没设 logo：./alive/pwa.sh logo <图片.png> [--round 10%]")
    logo = eff["logo"]
    logo_path = logo if os.path.isabs(logo) else os.path.join(root, logo)
    if not os.path.exists(logo_path):
        die("logo 不存在（路径相对项目根）：%s" % logo)
    directory = eff["dir"]
    if not directory:
        die("找不到前端静态目录（web/public / public / app/public …）；"
            "用 ./alive/pwa.sh dir <目录> 指定")

    try:
        src = square_logo(logo_path)
    except Exception as exc:
        die("logo 打不开：%s（%s）" % (logo, exc))

    os.makedirs(directory, exist_ok=True)
    write_icons(src, directory, eff)
    with open(os.path.join(directory, MANIFEST_PATH), "w", encoding="utf-8") as f:
        json.dump(build_manifest(eff), f, ensure_ascii=False, indent=2)
        f.write("\n")
    sw_written = write_sw(kit_dir, directory, eff["app_id"])

    msg("静态目录 %s" % rel(root, directory))
    msg("logo %s（圆角 %s）" % (logo, fmt_round(eff["round"])))
    msg("生成 icon-192.png icon-512.png icon-maskable-512.png "
        "apple-touch-icon.png favicon.ico manifest.webmanifest%s"
        % (" sw.js" if sw_written else "（sw.js 已存在，未覆盖）"))
    sys.stdout.write("贴进 index.html <head>：\n%s\n" % head_snippet(eff))
    return 0


def cmd_show(root, cfg):
    eff = effective(root, cfg)
    print("[pwa] 配置 alive/pwa.json（改它或重跑命令；`gen` 按此重生成）")
    if eff["dir"]:
        marker = "" if cfg.get("dir") else "（自动探测）"
        print("[pwa]      静态目录  %s%s" % (rel(root, eff["dir"]), marker))
    else:
        print("[pwa]      静态目录  （未找到，用 ./alive/pwa.sh dir <目录> 指定）")
    print("[pwa]      logo      %s" % (eff["logo"] or "（未设置）"))
    print("[pwa]      圆角      %s" % fmt_round(eff["round"]))
    print("[pwa]      标题      %s（短名 %s）" % (eff["title"], eff["short"]))
    print("[pwa]      描述      %s" % (eff["desc"] or "（未设置）"))
    print("[pwa]      主题色    %s（背景 %s）" % (eff["theme"], eff["background"]))
    if eff["dir"]:
        print("[pwa] 将生成    icon-192.png icon-512.png icon-maskable-512.png "
              "apple-touch-icon.png favicon.ico manifest.webmanifest sw.js(首次)")
    print("[pwa] index.html <head> 片段：")
    print(head_snippet(eff))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="pwa",
        description="从一张 logo 生成 PWA 资产（图标 / manifest / sw.js）。",
    )
    parser.add_argument("--root", default=os.getcwd(), help="项目根目录（默认当前目录）")
    sub = parser.add_subparsers(dest="cmd", metavar="<命令>")

    p = sub.add_parser("logo", help="设 logo（+圆角），立即重生成")
    p.add_argument("path", help="图片路径（相对项目根）")
    p.add_argument("--round", default=None, metavar="N%", help="圆角，边长百分比 0-50（默认沿用/0）")

    p = sub.add_parser("title", help="设 manifest 标题")
    p.add_argument("name")
    p.add_argument("--short", default=None, help="短名（默认同标题）")

    p = sub.add_parser("desc", help="设一句话描述")
    p.add_argument("text")

    p = sub.add_parser("theme", help="设主题色")
    p.add_argument("color")
    p.add_argument("--bg", default=None, help="背景色（默认同主题色）")

    p = sub.add_parser("dir", help="设静态目录（默认自动探测）")
    p.add_argument("path")

    sub.add_parser("gen", help="按配置重生成")
    sub.add_parser("show", help="查看配置与将生成的文件")

    return parser


def main(argv):
    args = build_parser().parse_args(argv)
    root = os.path.abspath(args.root)
    kit_dir = os.environ.get("KIT_DIR") or os.path.join(root, "alive/woohkit")
    cfg = load_cfg(root)

    if args.cmd in (None, "show"):
        return cmd_show(root, cfg)
    if args.cmd == "gen":
        return cmd_gen(root, kit_dir, cfg)

    if args.cmd == "logo":
        cfg["logo"] = args.path
        if args.round is not None:
            cfg["round"] = parse_round(args.round)
    elif args.cmd == "title":
        cfg["title"] = args.name
        if args.short is not None:
            cfg["short"] = args.short
    elif args.cmd == "desc":
        cfg["desc"] = args.text
    elif args.cmd == "theme":
        theme = norm_hex(args.color)
        cfg["theme"] = theme
        cfg["background"] = norm_hex(args.bg) if args.bg is not None else theme
    elif args.cmd == "dir":
        cfg["dir"] = args.path

    save_cfg(root, cfg)
    return cmd_gen(root, kit_dir, cfg)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
