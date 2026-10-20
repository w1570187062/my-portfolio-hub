# -*- coding: utf-8 -*-
"""用真机截图验证卡片式解析（真数据，不是构造样本）。

用法：
    python probe_cards.py                      # 用最新截图
    python probe_cards.py path/to/screen.png
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from client.envfix import repair_environment  # noqa: E402

repair_environment()

from PIL import Image  # noqa: E402

from client.ocr.cards import merge_cards, parse_holdings_cards, parse_total  # noqa: E402
from client.ocr.engine import run_ocr  # noqa: E402

CAPTURES = Path(__file__).parent / "data" / "captures"


def main() -> int:
    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        target = Path(sys.argv[1])
    else:
        shots = sorted(CAPTURES.glob("*.png"))
        if not shots:
            print(f"没有截图：{CAPTURES}")
            return 1
        target = shots[-1]

    items = run_ocr(str(target))
    with Image.open(target) as im:
        w, h = im.size
    print(f"图片 {target.name}  {w}×{h}   OCR {len(items)} 条\n")

    total = parse_total(items, h)
    print("=== 顶部汇总 ===")
    print(f"  总持有市值 : {total['market_value']}  (币种 {total['currency'] or '-'})")
    print(f"  日收益     : {total['daily_pnl']}")

    cards = parse_holdings_cards(items, h)
    print(f"\n=== 持仓卡片（{len(cards)} 张）===")
    for i, c in enumerate(cards, 1):
        print(f"\n  [{i}] {c.name}")
        print(f"      持有市值 : {c.market_value}  ({c.raw.get('market_value','')})")
        print(f"      累计收益 : {c.pnl}  ({c.raw.get('pnl','')})")
        print(f"      日收益   : {c.daily_pnl}")
        print(f"      币种     : {c.currency or '-'}")
        print(f"      名称置信 : {c.confidence:.3f}")
        for wmsg in c.warnings:
            print(f"      ⚠ {wmsg}")

    # 多屏合并演示
    merged = merge_cards([cards, cards])
    print(f"\n合并去重后: {len(merged)} 张（同屏重复采集应保持不变）")
    return 0


if __name__ == "__main__":
    sys.exit(main())