#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""长屏拼接的重叠检测算法测试（纯离线，用合成图）。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from client.envfix import repair_environment  # noqa: E402

repair_environment()

import random  # noqa: E402

from PIL import Image, ImageDraw  # noqa: E402

from client.capture.long_shot import _vertical_overlap, stitch  # noqa: E402

W, H = 400, 800
FAILED = []


def check(name, cond, detail=""):
    if cond:
        print(f"[PASS] {name}")
    else:
        print(f"[FAIL] {name}  {detail}")
        FAILED.append(name)


def make_page(h=H, seed=0):
    """造一张有结构的"页面"图（每行有唯一特征，便于验证对齐）。"""
    rnd = random.Random(seed)
    img = Image.new("RGB", (W, h), (250, 250, 250))
    d = ImageDraw.Draw(img)
    for y in range(0, h, 7):
        shade = rnd.randint(180, 255)
        d.rectangle([0, y, W, y + 6], fill=(shade, 250 - shade % 40, 200))
    d.rectangle([10, 10, W - 10, 60], fill=(20, 90, 200))     # 固定色块
    d.text((20, 30), f"header-{seed}", fill=(255, 255, 255))
    return img


def scroll(img, d_px):
    """把页面向上滚 d_px，返回新的一屏。"""
    canvas = Image.new("RGB", (W, H), (250, 250, 250))
    canvas.paste(img.crop((0, d_px, W, min(H, img.height))), (0, 0))
    if img.height > H:
        canvas.paste(img.crop((0, 0, W, img.height - H)), (0, H - (img.height - H)))
    return canvas


print("=== 重叠检测 ===")
page = make_page(H * 2, seed=1)

for d_px, expect in ((200, H - 200), (400, H - 400), (600, H - 600)):
    s1 = page.crop((0, 0, W, H))
    s2 = page.crop((0, d_px, W, d_px + H))
    got = _vertical_overlap(s1, s2)
    check(f"滚动 {d_px}px → 重叠 ≈ {expect}", abs(got - expect) <= 12,
          f"got={got} expect={expect}")

# 不滚动
s1 = page.crop((0, 0, W, H))
s2 = page.crop((0, 0, W, H))
got = _vertical_overlap(s1, s2)
check("未滚动 → 重叠 = 屏高", abs(got - H) <= 12, f"got={got} expect={H}")

# 完全无关的两张图 → 0
other = make_page(H * 2, seed=99)
got = _vertical_overlap(page.crop((0, 0, W, H)), other.crop((0, 0, W, H)))
check("无关图 → 重叠 0", got == 0, f"got={got}")

print()
print("=== 拼接 ===")
shots = []
import tempfile

tmp = tempfile.mkdtemp()
offsets = [0, 300, 600, 900]
for i, off in enumerate(offsets):
    p = os.path.join(tmp, f"s{i}.png")
    page.crop((0, off, W, off + H)).save(p)
    from client.capture.long_shot import ScrollShot

    shots.append(ScrollShot(index=i, path=p, width=W, height=H, overlap=0))

for i in range(1, len(shots)):
    a = Image.open(shots[i - 1].path)
    b = Image.open(shots[i].path)
    shots[i].overlap = _vertical_overlap(a, b)

out = os.path.join(tmp, "stitched.png")
cw, ch = stitch(shots, out)
# 每屏滚动 300px → 长图总高 = H + 300 × (屏数-1)
expect_h = H + 300 * (len(offsets) - 1)
check(f"拼接高度 ≈ {expect_h}", abs(ch - expect_h) <= 30, f"got={ch}")

print()
if FAILED:
    print(f"{len(FAILED)} 项失败：{FAILED}")
    sys.exit(1)
print("全部通过")
