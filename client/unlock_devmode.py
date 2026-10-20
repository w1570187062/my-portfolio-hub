#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键解锁 iPhone 开发者模式（Windows 无需 Mac / Xcode）。

问题
----
iOS 16+ 的「设置 → 隐私与安全性 → 开发者模式」**默认不显示**。Apple 有意隐藏：
只有设备被开发配对过（或收到过 AMFI 的 reveal 指令）才会露出该开关。

本脚本用 pymobiledevice3 的 AMFI lockdown 服务直接下发 reveal 指令，
让 AMFI 在设备上创建 marker 文件 → 设置里立刻出现「开发者模式」。

用法
----
    python client/unlock_devmode.py              # reveal + 查询状态
    python client/unlock_devmode.py --enable     # reveal + 直接请求开启（手机会重启）
    python client/unlock_devmode.py --status     # 只查状态

开启后的手动步骤（推荐 --enable 后仍需手机确认）：
    设置 → 隐私与安全性 → 开发者模式 → 打开 → 重启手机
    重启后上滑解锁 → 弹窗点「启用」→ 输入锁屏密码
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from client.envfix import child_env, repair_environment  # noqa: E402

OK, WARN, FAIL, INFO = "[OK]  ", "[WARN]", "[FAIL]", "[INFO]"


def pmd3(*args: str, timeout: int = 120) -> tuple[int, str]:
    import subprocess

    cmd = [sys.executable, "-m", "pymobiledevice3", *args]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=child_env())
        return r.returncode, ((r.stdout or "") + (r.stderr or "")).strip()
    except subprocess.TimeoutExpired:
        return 124, f"命令超时（{timeout}s）"
    except Exception as e:
        return 1, f"命令异常：{e}"


def require_device() -> bool:
    """先确认 usbmux 能看到设备，否则后续命令无意义。"""
    import socket as _socket

    try:
        s = _socket.create_connection(("127.0.0.1", 27015), timeout=2)
        s.close()
    except Exception:
        print(f"{FAIL} usbmuxd 服务不可达（127.0.0.1:27015）")
        print("       Windows 需先安装 iTunes 桌面版或「Apple Devices」，")
        print("       它们提供 Apple Mobile Device Support（usbmuxd）与 USB 驱动。")
        return False

    rc, out = pmd3("usbmux", "list", timeout=60)
    if rc != 0 or not out.strip():
        print(f"{FAIL} 未枚举到 iPhone：{out[-200:]}")
        print("       排查：数据线（必须支持数据）/ 手机解锁 / 「信任此电脑」/ 驱动已装")
        return False
    print(f"{OK} 设备已连接")
    for line in out.splitlines()[:6]:
        print(f"       {line}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--enable", action="store_true", help="直接请求开启开发者模式（手机会重启）")
    ap.add_argument("--status", action="store_true", help="只查询当前状态")
    args = ap.parse_args()

    repair_environment(verbose=True)

    print("=" * 60)
    print("  iPhone 开发者模式解锁工具")
    print("=" * 60)

    if not require_device():
        return 2

    # 1) 查状态
    rc, out = pmd3("amfi", "developer-mode-status", timeout=60)
    status_txt = out.strip()
    print(f"\n{INFO} 当前开发者模式状态：{status_txt[:200] or '(无输出)'}")

    if args.status:
        return 0

    # 2) reveal —— 让设置里出现开关
    print(f"\n{INFO} 下发 reveal 指令（让「设置」里出现开发者模式开关）…")
    rc, out = pmd3("amfi", "reveal-developer-mode", timeout=90)
    if rc == 0:
        print(f"{OK} reveal 成功。")
        print("     若设置里还没看到，**彻底关闭「设置」App 再重开**（marker 是运行时读取的）")
    else:
        print(f"{WARN} reveal 返回非 0：{out[-300:]}")
        print("       继续尝试 --enable（部分版本 enable 会隐式 reveal）")

    # 3) 直接开启
    if args.enable:
        print(f"\n{INFO} 请求开启开发者模式（手机将重启，锁屏密码需在重启后输入）…")
        rc, out = pmd3("amfi", "enable-developer-mode", timeout=180)
        if rc == 0:
            print(f"{OK} 开启指令已下发。")
            print("     请在手机重启后：上滑解锁 → 弹窗点「启用」→ 输入锁屏密码")
        else:
            low = out.lower()
            if "passcode" in low:
                print(f"{WARN} 设备设置了锁屏密码，AMFI 拒绝代开：{out[-200:]}")
                print("       → 手动开：设置 → 隐私与安全性 → 开发者模式（reveal 后应已出现）")
            else:
                print(f"{WARN} 开启失败：{out[-300:]}")
                print("       → 手动开：设置 → 隐私与安全性 → 开发者模式（reveal 后应已出现）")
        return 0 if rc == 0 else 1

    print("""
下一步：
  1. 手机上 **彻底关闭「设置」App**（从底部上滑划掉），再重新打开
  2. 设置 → 隐私与安全性 → 滑到最底部「安全性」区域 → 「开发者模式」→ 打开
  3. 弹窗点「重启」；重启后上滑解锁 → 弹窗点「启用」→ 输入锁屏密码
  4. 之后回客户端跑：python client/spike_dvt.py
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
