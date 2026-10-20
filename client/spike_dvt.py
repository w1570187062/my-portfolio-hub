#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P1 Spike 诊断脚本：iOS 17+ USB 原生截图（pymobiledevice3 DVT）全链路自检。

用法：
    python client/spike_dvt.py            # 完整自检 + 截图
    python client/spike_dvt.py --info     # 只看设备信息
    python client/spike_dvt.py --shot     # 只截图（跳过诊断）

逐项检查：
    1. 解释器/依赖（pymobiledevice3 版本）
    2. usbmux 设备枚举（USB 连接 + 信任）
    3. 开发者模式
    4. 开发者磁盘镜像挂载
    5. 隧道建立（userspace → tunnel → native 依次尝试）
    6. DVT 截图，输出 PNG 尺寸对比
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from client.envfix import child_env, repair_environment  # noqa: E402

OUT_DIR = ROOT / "client" / "data" / "captures"

OK, WARN, FAIL, INFO = "[OK]  ", "[WARN]", "[FAIL]", "[INFO]"


def hr(title: str):
    print("\n" + "=" * 64)
    print(f"  {title}")
    print("=" * 64)


def run(cmd: list[str], timeout: int = 120) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=child_env())
        return r.returncode, ((r.stdout or "") + (r.stderr or "")).strip()
    except subprocess.TimeoutExpired:
        return 124, f"命令超时（{timeout}s）"
    except Exception as e:
        return 1, f"命令异常：{e}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--info", action="store_true", help="只打印设备信息")
    ap.add_argument("--shot", action="store_true", help="只截图")
    args = ap.parse_args()

    info = repair_environment(verbose=True)
    if info.get("removed"):
        print(f"{INFO} 已清理外部 PYTHONPATH 污染：{len(info['removed'])} 项")
        for p in info["removed"]:
            print(f"       - {p}")

    py = sys.executable
    hr("1. 依赖检查")
    try:
        from importlib.metadata import version as _ver

        print(f"{OK} pymobiledevice3 {_ver('pymobiledevice3')}")
    except Exception as e:
        print(f"{FAIL} pymobiledevice3 不可用：{e}")
        print("       安装：pip install pymobiledevice3")
        return 1
    print(f"{INFO} Python {sys.version.split()[0]}  ({sys.executable})")

    if args.info:
        hr("设备信息")
        rc, out = run([py, "-m", "pymobiledevice3", "lockdown", "info"], timeout=60)
        print(out[:3000] if out else "(无输出)")
        return 0 if rc == 0 else 1

    hr("2. 设备枚举（usbmux）")
    # 2a. usbmuxd 通道可达性（Windows 靠 iTunes/Apple Devices 的 27015 TCP 服务）
    import socket as _socket

    try:
        s = _socket.create_connection(("127.0.0.1", 27015), timeout=2)
        s.close()
        print(f"{OK} usbmuxd 服务可达（127.0.0.1:27015）")
    except Exception:
        print(f"{FAIL} usbmuxd 服务不可达（127.0.0.1:27015）")
        print("       Windows 必须安装 Apple 驱动组件，pymobiledevice3 才能看到 USB 设备：")
        print("         · 推荐：安装 iTunes 桌面版（https://www.apple.com/itunes/）")
        print("         · 或安装 Microsoft Store 版「Apple Devices」")
        print("         · 装完需重启 pymobiledevice3 进程（服务是 Apple Mobile Device Service）")
        if os.name == "nt":
            return 2

    rc, out = run([py, "-m", "pymobiledevice3", "usbmux", "list"], timeout=60)
    if rc != 0 or not out.strip():
        print(f"{FAIL} 未枚举到设备")
        print(f"       报错：{out[-300:]}")
        print("       排查：① 数据线是否为数据线 ② 手机已解锁 ③ 手机上点「信任此电脑」")
        print("             ④ Windows 需装 iTunes / Apple Devices 提供 USB 驱动")
        print("             ⑤ iOS 17+ 需开启开发者模式：设置 → 隐私与安全性 → 开发者模式")
        return 2
    print(f"{OK} usbmux 可见设备：")
    for line in out.splitlines()[:10]:
        print(f"       {line}")

    udid = ""
    import re

    m = re.search(r"([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})", out)
    if m:
        udid = m.group(1)
        print(f"{OK} 目标 UDID = {udid}")

    hr("3. 开发者模式")
    rc, out = run([py, "-m", "pymobiledevice3", "amfi", "developer-mode-status"], timeout=60)
    dev_mode_on = "true" in out.lower()
    if dev_mode_on:
        print(f"{OK} 开发者模式已开启")
    else:
        print(f"{WARN} 开发者模式未开启（{out.strip()[:120] or '无输出'}）")
        print("       iOS 16+ 默认隐藏该开关，需先 reveal 才会出现：")
        print("         python client/unlock_devmode.py            # 只显示开关")
        print("         python client/unlock_devmode.py --enable   # 直接请求开启（手机会重启）")
        if "--fix-devmode" in sys.argv:
            rc2, out2 = run([py, "-m", "pymobiledevice3", "amfi", "reveal-developer-mode"], timeout=90)
            if rc2 == 0:
                print(f"{OK} reveal 已下发 → 手机「设置」里现在应出现「开发者模式」")
                print("       关闭「设置」App 后重开，隐私与安全性 → 最底部 → 开发者模式")
            else:
                print(f"{WARN} reveal 失败：{out2[-200:]}")

    # DDI 挂载：iOS 17.4+ 的 DVT 截图实测不需要 PersonalizedImage（会自动处理），
    # 且auto-mount 会联网下载镜像，耗时可达数分钟 → 降级为可选步骤，超时不阻断
    if "--mount" in sys.argv:
        hr("4. 开发者磁盘镜像（可选）")
        rc, out = run([py, "-m", "pymobiledevice3", "mounter", "auto-mount"] + (["--udid", udid] if udid else []),
                       timeout=300)
        if rc == 0:
            print(f"{OK} 开发者镜像已挂载：{out[:160] or '(静默成功)'}")
        else:
            print(f"{WARN} 镜像挂载未成功：{out[-300:]}")
            if not dev_mode_on:
                print("       （开发者模式未开时 DDI 挂载会失败，属预期）")
    else:
        print(f"{INFO} 跳过 DDI 挂载（iOS 17.4+ 截图不需要；需要时加 --mount）")

    if args.shot:
        return _shot(py, udid)

    hr("5-6. 隧道建立 + DVT 截图")
    return _shot(py, udid)


def _shot(py: str, udid: str) -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # auto 必须排第一：iOS 17.4+ 的 RSD 隧道由 pymobiledevice3 自动建立，
    # 传任何隧道 flag 都会报 "no flag is needed"。17.0-17.3 才需要显式降级。
    modes = ["auto", "userspace", "tunnel", "native"]
    last = ""
    for mode in modes:
        if mode == "native" and sys.platform != "darwin":
            continue
        out_path = OUT_DIR / f"spike_{mode}.png"
        cmd = [py, "-m", "pymobiledevice3", "developer", "dvt", "screenshot", str(out_path)]
        if mode == "userspace":
            cmd.append("--userspace")
        elif mode == "tunnel":
            cmd += ["--tunnel", udid] if udid else []
        elif mode == "native":
            cmd.append("--native")
        if udid:
            cmd += ["--udid", udid]
        label = "auto（iOS17.4+ 自动隧道）" if mode == "auto" else mode
        print(f"\n{INFO} 尝试隧道模式：{label}")
        rc, out = run(cmd, timeout=150)
        if rc == 0 and out_path.exists() and out_path.stat().st_size > 0:
            size = out_path.stat().st_size
            dims = ""
            blank = False
            try:
                from PIL import Image, ImageStat

                with Image.open(out_path) as im:
                    dims = f"{im.width}×{im.height}"
                    st = ImageStat.Stat(im.convert("L").resize((64, 128)))
                    blank = st.stddev[0] < 2.0
            except Exception:
                pass
            print(f"{OK} 截图成功 → {out_path}")
            print(f"     文件大小 {size/1024:.1f} KB，分辨率 {dims or '未知'}")
            if blank:
                print(f"{FAIL} 但画面是纯色/全黑 —— 命令返回成功却拿不到有效内容")
                print("       最可能原因：**iPhone 正处于锁屏状态**。")
                print("       Secure Layer 由硬件保护，DVT 开发者服务无权限读取该层画面，")
                print("       此时截图命令仍返回 0，但产物是纯黑图。")
                print("       → 解锁 iPhone，停留在目标 App 页面（保持屏幕常亮），再跑一次。")
                return 4
            print(f"\n结论：可用隧道模式 = {label}")
            if mode == "auto":
                print("     （iOS 17.4+ 首选：隧道自动建立，免提权、无需 tunneld）")
            return 0
        last = out
        print(f"{WARN} 模式 {label} 失败：{out[-260:] or '(无输出)'}")
        # 开发者模式未开时所有模式都是同一堵墙，不必继续空转
        low = out.lower()
        if "apple removed this service" in low or "developer mode" in low:
            print(f"\n{FAIL} 卡在开发者模式：换隧道模式也无效，先在手机上开启")
            print("       设置 → 隐私与安全性 → 滑到最底部 → 开发者模式 → 开启 → 重启")
            print("       （已下发过 reveal，若设置里看不到就彻底划掉「设置」App 再重开）")
            return 3

    print(f"\n{FAIL} 所有隧道模式均失败")
    print(f"       最后错误：{last[-500:]}")
    print("""
排查建议：
  · iOS 17.4+ 不需要任何隧道 flag（auto 模式即通）；17.0-17.3 需 tunneld 或 userspace
  · 手机需解锁 + 已信任本机 + **已开开发者模式**（最常见失败原因）
  · 确认 USB 驱动正常：pymobiledevice3 usbmux list 能列出设备
""")
    return 3


if __name__ == "__main__":
    sys.exit(main())
