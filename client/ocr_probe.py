# -*- coding: utf-8 -*-
"""用真实 iPhone 截图跑一遍 OCR，量化识别质量。

用法：
    python ocr_probe.py                      # 用最新一张采集图
    python ocr_probe.py path/to/screen.png   # 指定图
    python ocr_probe.py --shots             # 对所有已采集截图跑，统计整体表现
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from client.envfix import repair_environment  # noqa: E402

repair_environment()

from PIL import Image  # noqa: E402

from client.ocr.engine import run_ocr  # noqa: E402

CAPTURES = Path(__file__).parent / "data" / "captures"
LOW_CONF = 0.80


def _ypos(box) -> float:
    ys = [float(p[1]) for p in box]
    return min(ys)


def report(p: Path) -> dict:
    t0 = time.perf_counter()
    items = run_ocr(str(p))
    ms = (time.perf_counter() - t0) * 1000
    with Image.open(p) as im:
        w, h = im.size

    items.sort(key=lambda it: _ypos(it[0]))
    print(f"\n{'=' * 64}")
    print(f"图片：{p.name}   {w}×{h}   {p.stat().st_size / 1024:.1f} KB")
    print(f"识别 {len(items)} 条，耗时 {ms:.0f} ms")
    print("=" * 64)
    low = 0
    for box, text, score in items:
        xs = [float(q[0]) for q in box]
        ys = [float(q[1]) for q in box]
        flag = ""
        if score < LOW_CONF:
            low += 1
            flag = "  ⚠ 低置信"
        print(f"  ({int(min(xs)):4d},{int(min(ys)):4d})  {score:.3f}  {text!r}{flag}")
    if items:
        avg = sum(it[2] for it in items) / len(items)
        print(f"\n平均置信度 {avg:.3f}；低置信（<{LOW_CONF}）{low} 条")
    return {"n": len(items), "ms": ms, "low": low, "w": w, "h": h}


def main() -> int:
    shots = sorted(CAPTURES.glob("*.png"))
    if "--shots" in sys.argv:
        if not shots:
            print(f"没有截图，先采集：{CAPTURES}")
            return 1
        t0 = time.perf_counter()
        total = 0
        for p in shots:
            items = run_ocr(str(p))
            n = len(items)
            total += n
            print(f"  {p.name:30s} {p.stat().st_size / 1024:8.1f} KB  →  {n:3d} 行")
        print(f"\n合计 {len(shots)} 张 / {total} 行 / "
              f"{(time.perf_counter() - t0) * 1000:.0f} ms")
        return 0

    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        target = Path(sys.argv[1])
    else:
        if not shots:
            print(f"没有截图，先采集：{CAPTURES}")
            return 1
        target = shots[-1]
    report(target)
    return 0


if __name__ == "__main__":
    sys.exit(main())