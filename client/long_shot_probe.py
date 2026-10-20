#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""长屏自动采集 —— 实机验证脚本。

用法：
    python long_shot_probe.py                 # 默认最多 8 屏
    python long_shot_probe.py --max 15        # 更多屏
    python long_shot_probe.py --ratio 0.5     # 每屏滚动距离（屏高百分比）
    python long_shot_probe.py --no-stitch     # 只存单屏不拼接

前置：iPhone 已插线 + 已信任本机 + 已开开发者模式 + 已进入目标列表页。
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from client.envfix import repair_environment  # noqa: E402

repair_environment()

from client.capture.long_shot import LongCaptureError, capture_long_screen  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "longshots")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=8, help="最多采集屏数")
    ap.add_argument("--ratio", type=float, default=0.42, help="每屏滚动距离（屏高比例）")
    ap.add_argument("--no-stitch", action="store_true", help="不拼接")
    ap.add_argument("--udid", default=os.environ.get("PYMOBILEDEVICE3_UDID"))
    args = ap.parse_args()

    print(f"输出目录：{OUT}")
    print("提示：请确保手机已解锁并停留在要采集的列表页顶部。")
    print("-" * 56)

    try:
        res = capture_long_screen(
            udid=args.udid,
            out_dir=OUT,
            max_screens=args.max,
            scroll_ratio=args.ratio,
        )
    except LongCaptureError as e:
        print(f"[失败] {e}")
        return 1
    except Exception as e:
        print(f"[异常] {type(e).__name__}: {e}")
        return 2

    print("-" * 56)
    print(f"采集屏数：{res.screen_count}")
    print(f"停止原因：{res.stopped_reason}")
    if res.stitched_path:
        print(f"长图：{res.stitched_path}  {res.stitched_size[0]}×{res.stitched_size[1]}")
    for s in res.screens:
        print(f"  [{s.index + 1}] {os.path.basename(s.path)}  "
              f"重叠 {s.overlap}px" + ("  (空白)" if s.is_blank else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
