#!/usr/bin/env python3
"""bump-version.py — hapiy 版本号自增（写回 project/backend/internal/version/version.go）。

规则跟 OpenBoss 的 bump-center-version.mjs 一致：

  --release（发布用）  中间位 +1、末位归零：1.1.1 -> 1.2.0
  （默认，构建用）     末位 +1：1.1.1 -> 1.1.2
  --show               只打印当前版本

major 由维护者手动升（手动升那次记得自己把 y、z 归零）。
被 scripts/project.sh 的 proj_bump_version 调用：`./alive/release.sh` 不带版本号时，
kit 先调它自增，再取 proj_version 发布。
"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
path = root / "project/backend/internal/version/version.go"
src = path.read_text(encoding="utf-8")

m = re.search(r'(const\s+Version\s*=\s*")(\d+)\.(\d+)\.(\d+)(")', src)
if not m:
    sys.exit("bump-version: Version constant not found in %s" % path)

pre, major, minor, patch, post = m.groups()
cur = "%s.%s.%s" % (major, minor, patch)

if "--show" in sys.argv:
    print(cur)
    sys.exit(0)

if "--release" in sys.argv:
    nxt = "%s.%d.0" % (major, int(minor) + 1)
else:
    nxt = "%s.%s.%d" % (major, minor, int(patch) + 1)

path.write_text(src[:m.start()] + pre + nxt + post + src[m.end():], encoding="utf-8")
print("%s -> %s" % (cur, nxt))
