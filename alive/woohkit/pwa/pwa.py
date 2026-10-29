#!/usr/bin/env python3
# pwa.py — woohkit PWA 资产生成器（kit 拥有，勿手改；随 tools/sync.sh 更新）。
#
# 入口是项目的 alive/pwa.sh（薄壳），本文件读：
#   alive/woohkit.json  身份（name / id）
#   alive/pwa.json      本工具的配置（logo / 圆角 / 标题 / 主题色 / 静态目录）
# 把图标、manifest.webmanifest、sw.js 生成到项目的静态目录——favicon 例外：
# 项目里有 app/favicon.ico / src/app/favicon.ico（框架直接服务它的约定位置）
# 就覆盖那个文件，不然浏览器里换不掉。
#
# 边界：只写 alive/pwa.json、静态目录里的生成物，以及上面那个 favicon；绝不改
# index.html 与 app/manifest.ts 这类代码；已存在的 sw.js 不覆盖。契约见
# CONTRACT.md 第六节。

import argparse
import io
import json
import os
import re
import sys
import zipfile

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

# any 图标的默认圆角：苹果 macOS 大图标的比例（185.4 / 824 ≈ 22.5%，iOS 是
# 22.37%）。正圆弧逼近——苹果真机是"连续圆角"，差别在几个像素；0 = 直角。
DEFAULT_ROUND = 22.5

STATIC_CANDIDATES = ("web/public", "public", "app/public", "frontend/public", "static")

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")

# manifest 由框架代码生成时的常见位置（存在就默认不重复生成，pwa.json 里
# 显式写 true/false 可覆盖）。favicon 不算：它只是静态图标，Next 这类框架把
# app/favicon.ico 直接当站点图标服务——写别处会被它盖住，所以存在就覆盖它。
FRAMEWORK_FILES = {
    "manifest": ("app/manifest.ts", "app/manifest.js",
                 "src/app/manifest.ts", "src/app/manifest.js"),
}

FAVICON_LOCATIONS = ("app/favicon.ico", "src/app/favicon.ico")

# 文件式矢量图标（Next 约定，自动进 <head>）：Chrome / Firefox 会优先拿它当
# 标签页图标——项目里还留着旧品牌的那张，favicon.ico 就永远轮不到。
SVG_ICON_LOCATIONS = ("app/icon.svg", "src/app/icon.svg")


def msg(text):
    sys.stdout.write("[pwa] %s\n" % text)


def die(text):
    sys.stderr.write("[pwa] %s\n" % text)
    sys.exit(1)


def warn(text):
    sys.stderr.write("[pwa] %s\n" % text)


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


def framework_generated(root, kind):
    """这类 manifest/favicon 是不是由框架代码生成的（存在则返回那个相对路径）。"""
    for rel_path in FRAMEWORK_FILES[kind]:
        if os.path.isfile(os.path.join(root, rel_path)):
            return rel_path
    return None


def favicon_target(root, directory):
    """favicon 写哪：框架约定的站点图标位置（app/favicon.ico）优先——在那儿
    写才生效；没有就写静态目录。directory 为空时返回 None。"""
    for rel_path in FAVICON_LOCATIONS:
        path = os.path.join(root, rel_path)
        if os.path.isfile(path):
            return path
    return os.path.join(directory, "favicon.ico") if directory else None


def install_logo(root, given):
    """把 <图片> 落成项目里可复现的源图：zip 先解出里面的图，项目外的图拷进
    assets/logo.png；返回写进 pwa.json 的路径（相对项目根）。"""
    given_abs = given if os.path.isabs(given) else os.path.abspath(given)
    if not os.path.exists(given_abs):
        die("找不到文件：%s" % given)

    data = None
    if given_abs.lower().endswith(".zip"):
        try:
            with zipfile.ZipFile(given_abs) as z:
                for info in z.infolist():
                    if not info.is_dir() and info.filename.lower().endswith(IMAGE_EXTS):
                        msg("从 zip 里取出 %s" % info.filename)
                        data = z.read(info)
                        break
        except zipfile.BadZipFile as exc:
            die("zip 打不开：%s（%s）" % (given, exc))
        if data is None:
            die("zip 里没找到图片：%s" % given)

    if data is None and given_abs.startswith(root + os.sep):
        return rel(root, given_abs)

    if data is None:
        with open(given_abs, "rb") as f:
            data = f.read()
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as exc:
        die("这不是能打开的图片：%s（%s）" % (given, exc))
    if min(im.size) < 512:
        warn("源图偏小（%dx%d），切出来的图标可能会糊" % im.size)

    dest_dir = os.path.join(root, "assets")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, "logo.png")
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA")
    im.save(dest)
    msg("源图拷进项目 assets/logo.png（以后 gen 用这张；要换位置改 alive/pwa.json 的 logo）")
    return "assets/logo.png"


def effective(root, cfg):
    name, app_id = load_identity(root)
    theme = norm_hex(cfg.get("theme") or os.environ.get("SHELL_THEME") or "#000000")
    title = cfg.get("title") or name
    directory = find_dir(root, cfg)
    # manifest 默认生成，检测到由代码生成的实现（app/manifest.ts）时跳过；
    # favicon 总是生成（有 app/favicon.ico 就覆盖它），只有显式 false 才不生成。
    auto_off = {}
    if "manifest" in cfg:
        manifest_on = bool(cfg["manifest"])
    else:
        who = framework_generated(root, "manifest")
        manifest_on = who is None
        if who:
            auto_off["manifest"] = who
    return {
        "app_id": app_id,
        "dir": directory,
        "logo": cfg.get("logo"),
        "round": float(cfg["round"]) if "round" in cfg else DEFAULT_ROUND,
        "title": title,
        "short": cfg.get("short") or title,
        "desc": cfg.get("desc") or "",
        "theme": theme,
        "background": norm_hex(cfg.get("background") or theme),
        "manifest": manifest_on,
        "favicon": bool(cfg["favicon"]) if "favicon" in cfg else True,
        "favicon_path": favicon_target(root, directory),
        "svg_icons": [p for p in SVG_ICON_LOCATIONS
                      if os.path.isfile(os.path.join(root, p))],
        "auto_off": auto_off,
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
    if eff["favicon"]:
        rounded(src, FAVICON_SRC, eff["round"]).save(
            eff["favicon_path"],
            format="ICO",
            sizes=[(s, s) for s in FAVICON_SIZES],
        )
    flat(src, APPLE_SIZE, eff["background"]).save(
        os.path.join(directory, "apple-touch-icon.png")
    )
    # maskable：整幅不透明的图（照片/插画）直接满幅；带透明通道的图形标缩进
    # 80% 安全区、居中放在背景色上（形状由系统裁）。
    target = os.path.join(directory, "icon-maskable-512.png")
    if src.getchannel("A").getextrema()[0] >= 255:
        src.resize((MASKABLE_SIZE, MASKABLE_SIZE), Image.LANCZOS).save(target)
    else:
        maskable(src, eff["background"]).save(target)


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

USAGE = """\
用法：./alive/pwa.sh <命令>（不加参数就是这份帮助）

  换图标    logo <图片> [--round 22.5]
            从这张图切全套尺寸（192 / 512 / maskable-512 / apple-touch-180 /
            favicon.ico）；圆角是“边长百分比”（0-50，只切 any 图标），默认 22.5%
            —— 苹果 macOS / iOS 图标的比例，0 = 直角。
            zip 也行；项目外的图会自动拷进项目的 assets/logo.png 当源图。
  换标题    title <名字> [--short <短名>]
            manifest 的 name / short_name（短名默认同标题）。
  换描述    desc <一句话>
            manifest 的 description（安装提示 / 应用列表上显示的那句话）。
  换主题色  theme <#rrggbb> [--bg <#rrggbb>]
            theme_color；背景色默认同主题色。
  换目录    dir <静态目录>
            输出目录（默认自动探测 web/public > public > app/public …）。
  重新生成  gen
  看现状    show          当前配置 + 会生成哪些文件 + <head> 片段

例：
  ./alive/pwa.sh logo web/logo.png --round 10%
  ./alive/pwa.sh title "我的应用" --short 短名
  ./alive/pwa.sh desc "一句话描述"

配置记在 alive/pwa.json（也可以直接手改）；每条设置命令都会立即重生成。
manifest 默认生成；检测到 Next 的 app/manifest.ts 这类“由代码生成”的实现时自动
跳过（pwa.json 里显式写 true/false 可覆盖）。favicon 总是生成：项目里有
app/favicon.ico / src/app/favicon.ico（框架直接服务它）就覆盖那个文件，否则写
静态目录；不想让工具管就写 "favicon": false。
maskable：整幅不透明的图（插画/照片）直接满幅；带透明通道的图形标缩进 80% 安全区。
生成物写进静态目录：icon-192.png、icon-512.png、icon-maskable-512.png、
apple-touch-icon.png、favicon.ico、manifest.webmanifest、首次的 sw.js。
依赖 python3 + Pillow。
"""


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
    if eff["manifest"]:
        with open(os.path.join(directory, MANIFEST_PATH), "w", encoding="utf-8") as f:
            json.dump(build_manifest(eff), f, ensure_ascii=False, indent=2)
            f.write("\n")
    sw_written = write_sw(kit_dir, directory, eff["app_id"])

    made = ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]
    if eff["favicon"]:
        made.append("favicon.ico")
    if eff["manifest"]:
        made.append("manifest.webmanifest")
    msg("静态目录 %s" % rel(root, directory))
    msg("logo %s（圆角 %s）" % (logo, fmt_round(eff["round"])))
    msg("生成 " + " ".join(made) + (" sw.js" if sw_written else "（sw.js 已存在，未覆盖）"))
    if eff["favicon"] and os.path.abspath(eff["favicon_path"]) != os.path.abspath(
            os.path.join(directory, "favicon.ico")):
        msg("favicon.ico 写进 %s（框架直接服务它；不想让工具管就在 pwa.json 写 \"favicon\": false）"
            % rel(root, eff["favicon_path"]))
    for who in eff["svg_icons"]:
        warn("%s 还在：Chrome / Firefox 优先用它当标签页图标，favicon.ico 轮不到——"
             "旧品牌就删掉它，新品牌就换成新的" % who)
    for kind in ("manifest", "favicon"):
        if eff[kind]:
            continue
        who = eff["auto_off"].get(kind)
        if who:
            msg("%s 由 %s 生成，跳过（要工具生成就在 pwa.json 里写 \"%s\": true）" % (kind, who, kind))
        else:
            msg("%s 按 pwa.json 的 %s=false 跳过" % (kind, kind))
    if eff["manifest"]:
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
    for kind in ("manifest", "favicon"):
        if eff[kind]:
            continue
        who = eff["auto_off"].get(kind)
        why = ("由 %s 生成" % who) if who else ("pwa.json 的 %s=false" % kind)
        print("[pwa]      %-10s跳过（%s）" % (kind, why))
    if eff["favicon"] and eff["dir"] and os.path.abspath(eff["favicon_path"]) != os.path.abspath(
            os.path.join(eff["dir"], "favicon.ico")):
        print("[pwa]      favicon   写进 %s（框架直接服务它）" % rel(root, eff["favicon_path"]))
    for who in eff["svg_icons"]:
        print("[pwa]      %s 还在——Chrome / Firefox 优先用它当标签页图标，"
              "favicon.ico 轮不到" % who)
    if eff["dir"]:
        files = ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]
        if eff["favicon"]:
            files.append("favicon.ico")
        if eff["manifest"]:
            files.append("manifest.webmanifest")
        files.append("sw.js(首次)")
        print("[pwa] 将生成    " + " ".join(files))
    if eff["manifest"]:
        print("[pwa] index.html <head> 片段：")
        print(head_snippet(eff))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="pwa",
        add_help=False,
        description="从一张 logo 生成 PWA 资产（图标 / manifest / sw.js）。",
    )
    parser.add_argument("-h", "--help", action="store_true", help="显示帮助")
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

    if args.cmd is None or args.help:
        sys.stdout.write(USAGE)
        return 0
    if args.cmd == "show":
        return cmd_show(root, cfg)
    if args.cmd == "gen":
        return cmd_gen(root, kit_dir, cfg)

    if args.cmd == "logo":
        cfg["logo"] = install_logo(root, args.path)
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
