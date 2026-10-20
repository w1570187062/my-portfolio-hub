#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""iOS 长页面自动采集（滚动 + 截图 + 拼接）。

原理
----
iOS 17+ 的 **CoreDevice** 服务族给了我们两把钥匙：

1. ``com.apple.coredevice.screencaptureservice``
   → 原生 PNG 截图（比 DVT 通道更完整，含状态栏与安全层以外的全部内容）
2. ``com.apple.coredevice.hid.universalhidservice``
   → **注入真实触摸事件**（mainTouchscreen 面 _ServiceID=257）

于是"自动长屏"可以完全无人值守：

    截图 → 向上拖拽一屏 → 截图 → 拖拽 … → 直到画面不再变化（到底了）→ 拼接

触摸事件的隐藏前提（pymobiledevice3 源码里的 "Authentication gate"）
--------------------------------------------------------------------
backboardd 只接受来自**已认证** HID 面的 digitizer 事件。没有活跃媒体流时，
HID 面被标记为 ``authenticated: NO``，事件会被静默丢弃（日志里是
"ignoring digitizer event for display <main> from unsupported service"）。
``touch_session()`` 的做法是顺手开一条媒体流（Xcode 投屏用的那条视频管），
把认证门顶开，然后丢弃其 RTP 载荷 —— 画面不需要，我们只要"事件能落地"。

坐标系统
--------
HID 报告里 X/Y 是 **0..65535 归一化坐标**，不是像素。1206×2622 的屏幕
上，从中间往上拖一屏 ≈ (32767, 55000) → (32767, 15000)。

已知限制
--------
- 触摸注入要求**开发者模式已开启**（否则 dtuhidd 不注册 HID 面）
- 媒体流守护进程偶发卡死 → 此时 touch_session 会在 10s 内超时并提示重启设备
- 一次进程只能开一条 userspace 隧道（PyTCP 栈是进程级单例）
"""
from __future__ import annotations

import asyncio
import io
import os
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

# HID 归一化坐标空间
NORM_MAX = 65535

# mainTouchscreen 面（真实触控，带 CONTACT/RELEASE 状态）
SURFACE_MAIN_TOUCHSCREEN = 257
# touchscreenGesture 面（纯指针移动，iOS 上无鼠标指针 → 基本无效，仅备用）
SURFACE_TOUCHSCREEN_GESTURE = 1281


class LongCaptureError(RuntimeError):
    """长屏采集过程中的可读错误。"""


@dataclass
class ScrollShot:
    """单屏截图。"""

    index: int
    path: str
    width: int
    height: int
    # 该屏底部与下一屏顶部的重叠像素数（拼接时裁掉）
    overlap: int = 0
    # 纯色/空白屏（滚动到底或加载中）→ 停止依据
    is_blank: bool = False


@dataclass
class LongShotResult:
    """长屏采集结果。"""

    screens: list[ScrollShot] = field(default_factory=list)
    stitched_path: str = ""
    stitched_size: tuple[int, int] = (0, 0)
    stopped_reason: str = ""

    @property
    def screen_count(self) -> int:
        return len(self.screens)


# --------------------------------------------------------------------- 工具


def _norm(px: float, total_px: float) -> int:
    """像素 → 0..65535 归一化坐标。"""
    if total_px <= 0:
        return 0
    return max(0, min(NORM_MAX, int(round(px / total_px * NORM_MAX))))


def _is_blank(img, threshold: float = 2.0) -> bool:
    """单色/近单色图判定（灰度缩采样后极差过小）。"""
    try:
        from PIL import Image

        g = img.convert("L").resize((64, 128))
        st = g.getextrema()
        return (st[1] - st[0]) < 6
    except Exception:
        return False


def _mean_luma(img) -> float:
    """整图平均亮度（0-255）。锁屏纯黑图接近 0，正常界面通常 > 15。"""
    try:
        from PIL import Image

        g = img.convert("L").resize((64, 128))
        px = list(g.getdata())
        return sum(px) / max(len(px), 1)
    except Exception:
        return 255.0


def _looks_like_lock_screen(img) -> bool:
    """判断截图是否为 iOS 锁屏界面。

    iOS 没有暴露锁屏状态 API（``com.apple.coredevice.feature.getlockstate``
    在部分 iOS 版本上直接报 "Action ... is not implemented"），所以这里不靠
    图像特征硬猜 —— 图像特征区分度很差（锁屏/通知中心/主屏长得都像）。

    改为用**可靠的功能信号**：锁屏界面吃滑动（会翻页但内容是锁屏），
    但对 App 内列表无效。真正的判据交给上层：见 :func:`_scroll_had_effect`
    —— 拖拽后画面完全没变，就说明这次拖拽没被目标列表消费。
    本函数仅作辅助提示：检测"底部两个分离圆块 + 上部大时钟"的经典锁屏版式。
    """
    try:
        from PIL import Image
        import numpy as np
    except Exception:
        return False

    try:
        a = np.asarray(img.convert("L"), dtype=np.float32)
    except Exception:
        return False
    H, W = a.shape

    # 底部区域：找两个左右对称、明显比周围亮的圆块（手电筒/相机）
    bot = a[int(H * 0.80):int(H * 0.97), :]
    colm = bot.mean(axis=0)
    bg = float(np.median(colm))
    bright = colm > (bg + 10)
    runs, start = [], None
    for x in range(W):
        if bright[x]:
            if start is None:
                start = x
        else:
            if start is not None:
                runs.append((start, x))
                start = None
    if start is not None:
        runs.append((start, W))
    big = [r for r in runs if (r[1] - r[0]) > W * 0.09]
    if len(big) < 2:
        return False
    lefts = [r for r in big if r[0] < W * 0.42]
    rights = [r for r in big if r[1] > W * 0.58]
    return bool(lefts and rights)


def _scroll_had_effect(prev_bytes: Optional[bytes], cur_bytes: bytes) -> bool:
    """判断这次拖拽是否真的让画面发生了变化。"""
    if prev_bytes is None:
        return True
    return prev_bytes != cur_bytes


def _vertical_overlap(prev, cur, band: int = 120, verify: float = 0.85) -> int:
    """求两屏之间的纵向重叠像素数（真实像素单位）。

    做法
    ----
    1. 把 prev 的**底部一条横带**当模板（高 band 行），在 cur 里上下滑动找落点。
    2. 定位用**行亮度剖面**（每行均值）做一维归一化互相关 —— 纯 numpy 向量化，
       且对 1px 抖动不敏感。
    3. 用**像素级 NCC**在候选落点附近 ±3 行内复核，取最高分。

    推导（设两屏同高 H、模板高 band、滚动距离 D）：
      滚动 D 像素后，prev 的第 r 行出现在 cur 的第 r-D 行
      模板（prev 底部 band 行）在 cur 中的落点 p = H - band - D
      重叠量 = H - D = p + band

    注意：**行方向绝不能下采样**。两屏裁剪起点不同（0 与 D），
    行网格会错位，任何按固定步长取行的比较都会失效。只下采样列是安全的。

    匹配失败（分数不足）返回 0，调用方按"无重叠、直接追加"处理。
    """
    try:
        import numpy as np
    except Exception:
        return 0
    try:
        # 只对列下采样（列错位不影响行对齐判定）
        a = np.asarray(prev.convert("L"), dtype=np.float32)[:, ::2]
        b = np.asarray(cur.convert("L"), dtype=np.float32)[:, ::2]
    except Exception:
        return 0

    H_a, H_b = a.shape[0], b.shape[0]
    th = min(band, max(16, H_a // 3))
    if th < 8 or H_b <= th:
        return 0

    # --- 步骤 1：行亮度剖面一维相关（向量化滑窗） ---
    pa = a.mean(axis=1)
    pb = b.mean(axis=1)
    tpl_p = pa[H_a - th:] - pa[H_a - th:].mean()
    tpl_p_energy = float((tpl_p * tpl_p).sum())
    if tpl_p_energy <= 0:
        return 0

    from numpy.lib.stride_tricks import sliding_window_view

    win = sliding_window_view(pb, th)              # (H_b-th+1, th)
    win_mean = win.mean(axis=1, keepdims=True)
    win_c = win - win_mean
    win_energy = np.sqrt((win_c * win_c).sum(axis=1))
    valid = win_energy > 1e-6
    if not valid.any():
        return 0
    scores = np.zeros(len(win), dtype=np.float32)
    scores[valid] = (win_c[valid] @ tpl_p) / (win_energy[valid] * np.sqrt(tpl_p_energy))
    p0 = int(np.argmax(scores))

    # --- 步骤 2：像素级 NCC 在 ±3 行内复核 ---
    template = a[H_a - th:, :]
    tpl = template - template.mean()
    tpl_energy = float((tpl * tpl).sum())
    if tpl_energy <= 0:
        return 0

    best_p, best_score = -1, -1.0
    lo = max(0, p0 - 3)
    hi = min(H_b - th, p0 + 3)
    for p in range(lo, hi + 1):
        cand = b[p:p + th, :]
        d = cand - cand.mean()
        energy = float((d * d).sum())
        if energy <= 0:
            continue
        score = float((tpl * d).sum() / np.sqrt(tpl_energy * energy))
        if score > best_score:
            best_score = score
            best_p = p

    if best_p < 0 or best_score < verify:
        return 0
    return best_p + th


def stitch(screens: list[ScrollShot], out_path: str) -> tuple[int, int]:
    """把多屏按重叠量纵向拼接成一张长图。

    每屏的下边界 = 上一屏下边界 + 本屏高度 - 本屏与上一屏的重叠量。
    重叠量由 :func:`_vertical_overlap` 逐屏算出（滚动距离不固定时必须实测，
    不能假设"每屏固定滚动 X 像素"）。
    """
    from PIL import Image

    if not screens:
        raise LongCaptureError("没有可拼接的截图")
    imgs = []
    for s in screens:
        with Image.open(s.path) as im:
            imgs.append(im.convert("RGB"))

    canvas_w = max(i.width for i in imgs)
    total_h = 0
    placed = []            # (img, top_y)
    for i, im in enumerate(imgs):
        if i == 0:
            placed.append((im, 0))
            total_h = im.height
            continue
        ov = screens[i].overlap
        if ov < 0:
            ov = 0
        if ov > im.height:
            ov = im.height
        top = max(0, total_h - ov)
        placed.append((im, top))
        total_h = max(total_h, top + im.height)

    canvas = Image.new("RGB", (canvas_w, total_h), (255, 255, 255))
    for im, top in placed:
        canvas.paste(im, (0, top))
    canvas.save(out_path, format="PNG", optimize=True)
    return canvas_w, total_h


# ----------------------------------------------------------------- 采集主体


class LongScreenCapturer:
    """自动滚屏采集器。

    典型用法::

        async with LongScreenCapturer(udid, out_dir) as cap:
            result = await cap.capture(max_screens=12)
    """

    def __init__(
        self,
        udid: Optional[str] = None,
        out_dir: str = ".",
        *,
        scroll_ratio: float = 0.42,
        drag_duration: float = 0.35,
        drag_steps: int = 24,
        settle: float = 0.55,
        on_log: Optional[Callable[[str], None]] = None,
    ):
        self.udid = udid
        self.out_dir = out_dir
        # 一次拖拽移动屏幕高度的百分比（0.42 ≈ 留 58% 重叠，利于拼接与去重）
        self.scroll_ratio = scroll_ratio
        self.drag_duration = drag_duration
        self.drag_steps = drag_steps
        # 拖拽后等待动画停止的时间
        self.settle = settle
        self.on_log = on_log

        self._rsd = None
        self._tunnel = None
        self._display = None
        self._screen_size = (1206, 2622)

    # ---------------------------------------------------------- 生命周期
    async def __aenter__(self):
        from pymobiledevice3.remote.userspace_tunnel import UserspaceRsdTunnel

        self._log("建立 RSD 隧道（免提权）…")
        self._tunnel = UserspaceRsdTunnel(serial=self.udid)
        self._rsd = await self._tunnel.aopen()
        await self._read_display_size()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        for closer in (self._tunnel,):
            if closer is None:
                continue
            try:
                await closer.aclose()
            except Exception:
                pass
        self._tunnel = None
        self._rsd = None
        return False

    def _log(self, msg: str):
        if self.on_log:
            self.on_log(msg)
        else:
            print(msg, flush=True)

    async def _read_display_size(self):
        """读主屏像素尺寸（用于像素↔归一化坐标换算）。

        走 ``DeviceInfoService.get_display_info``（与 CLI ``core-device
        get-display-info`` 同一入口）；失败则用默认值兜底，不影响主流程。
        """
        try:
            from pymobiledevice3.remote.core_device.device_info import DeviceInfoService

            async with DeviceInfoService(self._rsd) as svc:
                di = await svc.get_display_info()
            size = self._pick_display_size(di)
            if size:
                self._screen_size = size
                self._log(f"主屏尺寸 {size[0]}×{size[1]}")
                return
            self._log("显示信息里没找到主屏尺寸，使用默认值")
        except Exception as e:
            self._log(f"读取屏幕尺寸失败（用默认值）：{e}")
        self._log(f"主屏尺寸未知，使用默认 {self._screen_size[0]}×{self._screen_size[1]}")

    @staticmethod
    def _pick_display_size(di: dict) -> Optional[tuple[int, int]]:
        """从 display info 里挑主屏像素尺寸。

        兼容两种结构：
        - ``displays[].currentMode.size``（CLI get-display-info 的形态）
        - ``displays[].bounds`` / ``frame``（纯矩形信息）
        """
        for d in di.get("displays", []) or []:
            if not d.get("current", True):
                continue
            mode = d.get("currentMode") or {}
            sz = mode.get("size") or d.get("size")
            if sz and len(sz) >= 2:
                return int(sz[0]), int(sz[1])
            for key in ("bounds", "frame"):
                rect = d.get(key)
                if rect and len(rect) >= 2:
                    x2, y2 = rect[1]
                    if x2 and y2:
                        return int(x2), int(y2)
        return None

    async def _is_locked(self) -> bool:
        """查设备锁屏状态。

        注意：``com.apple.coredevice.feature.getlockstate`` 在部分 iOS 版本上
        **未实现**（会抛 ``CoreDeviceError: Action ... is not implemented``），
        所以这里只作"尽力而为"的辅助信号，判黑图主要靠图像特征。
        """
        try:
            from pymobiledevice3.remote.core_device.device_info import DeviceInfoService

            async with DeviceInfoService(self._rsd) as svc:
                st = await svc.get_lockstate()
            val = st.get("isLocked") if isinstance(st, dict) else st
            if isinstance(val, str):
                return val.lower() in ("true", "1", "yes")
            return bool(val)
        except Exception:
            return False

    async def _wake_and_retake(self, path: str) -> Optional[bytes]:
        """黑图时尝试唤醒屏幕：注入一次轻触（不按任何按钮）再重截。

        息屏状态下轻触屏幕会点亮它（不产生点击语义）；若已锁屏则会进入
        锁屏界面（仍是不可读画面），两种情况都靠重截后的亮度判定。
        """
        try:
            w, h = self._screen_size
            await self._drag(
                _norm(w / 2, w), _norm(h * 0.5, h),
                _norm(w / 2 + 2, w), _norm(h * 0.5, h),
                steps=2, duration=0.05,
            )
            await asyncio.sleep(0.8)
            return await self._shoot(path)
        except Exception as e:
            self._log(f"唤醒重试失败：{e}")
            return None

    # ---------------------------------------------------------- 截图/滑动
    async def _shoot(self, path: str) -> bytes:
        from pymobiledevice3.remote.core_device.screen_capture_service import ScreenCaptureService

        async with ScreenCaptureService(self._rsd) as svc:
            resp = await svc.capture_screenshot()
        data = resp["image"]
        with open(path, "wb") as f:
            f.write(data)
        return data

    async def _drag(self, x1: int, y1: int, x2: int, y2: int,
                    steps: Optional[int] = None, duration: Optional[float] = None):
        """在 mainTouchscreen 面上注入一次真实拖拽。"""
        from pymobiledevice3.remote.core_device.hid_service import (
            TOUCHSCREEN_STATE_CONTACT,
            TOUCHSCREEN_STATE_RELEASE,
            touch_session,
        )

        steps = self.drag_steps if steps is None else steps
        duration = self.drag_duration if duration is None else duration

        async with touch_session(self._rsd) as hid:
            step_delay = duration / max(steps, 1)
            for i in range(steps):
                t = i / steps
                x = round(x1 + (x2 - x1) * t)
                y = round(y1 + (y2 - y1) * t)
                await hid.send_touchscreen(
                    TOUCHSCREEN_STATE_CONTACT, x, y, service_id=SURFACE_MAIN_TOUCHSCREEN
                )
                await asyncio.sleep(step_delay)
            await hid.send_touchscreen(
                TOUCHSCREEN_STATE_CONTACT, x2, y2, service_id=SURFACE_MAIN_TOUCHSCREEN
            )
            await hid.send_touchscreen(
                TOUCHSCREEN_STATE_RELEASE, x2, y2, service_id=SURFACE_MAIN_TOUCHSCREEN
            )

    async def _scroll_up(self):
        """向上拖一屏（内容向上翻）。"""
        w, h = self._screen_size
        x = _norm(w / 2, w)
        y_from = _norm(h * 0.72, h)
        y_to = _norm(h * (0.72 - self.scroll_ratio), h)
        await self._drag(x, y_from, x, y_to)

    # ------------------------------------------------------------- 主流程
    async def capture(
        self,
        max_screens: int = 12,
    ) -> LongShotResult:
        """自动滚屏采集。

        :param max_screens: 最多采集几屏（防跑飞）
        """
        from PIL import Image

        os.makedirs(self.out_dir, exist_ok=True)
        res = LongShotResult()
        prev_bytes: Optional[bytes] = None
        prev_img = None

        ts = time.strftime("%Y%m%d_%H%M%S")
        for i in range(max_screens):
            path = os.path.join(self.out_dir, f"long_{ts}_{i:02d}.png")
            data = await self._shoot(path)
            with Image.open(io.BytesIO(data)) as im:
                im.load()
                cur_img = im.convert("RGB")
                w, h = cur_img.size
                blank = _is_blank(cur_img)
                luma = _mean_luma(cur_img)

            if blank and luma < 12:
                # 全黑 → 尝试唤醒屏幕再重截一次
                self._log("截图为黑，尝试唤醒屏幕…")
                again = await self._wake_and_retake(path)
                if again is not None:
                    with Image.open(io.BytesIO(again)) as im2:
                        im2.load()
                        cur_img = im2.convert("RGB")
                        w, h = cur_img.size
                        blank = _is_blank(cur_img)
                        luma = _mean_luma(cur_img)
                    data = again
                    if not blank:
                        self._log(f"唤醒成功，亮度 {luma:.1f}")

            if blank and luma < 12:
                res.stopped_reason = (
                    "截图全黑：手机已锁屏或息屏。请解锁手机并停留在目标页面后重试"
                )
                self._log(res.stopped_reason)
                break

            shot = ScrollShot(index=i, path=path, width=w, height=h, is_blank=blank)

            if prev_img is not None:
                shot.overlap = _vertical_overlap(prev_img, cur_img)
                # 重叠量 ≈ 整屏高 → 内容没动，是"到底了"（列表到末尾会回弹）
                if shot.overlap >= h * 0.92:
                    res.stopped_reason = "已到列表末尾（重叠量达到整屏，页面无法继续滚动）"
                    self._log(res.stopped_reason)
                    res.screens.append(shot)
                    break

            res.screens.append(shot)
            self._log(
                f"第 {i + 1} 屏已采集 {w}×{h}"
                + (f"，重叠 {shot.overlap}px" if shot.overlap else "")
            )
            prev_bytes = data
            prev_img = cur_img

            if i == max_screens - 1:
                res.stopped_reason = f"达到最大屏数 {max_screens}"
                break

            await self._scroll_up()
            await asyncio.sleep(self.settle)

            # 拖拽后立刻验证效果：画面完全没变说明滑动没被目标列表消费
            # （锁屏 / 息屏 / 页面不可滚 / 触表面不对）
            probe_path = path + ".probe"
            try:
                probe_bytes = await self._shoot(probe_path)
            except Exception as e:
                self._log(f"验证截图失败（忽略，继续）：{e}")
                probe_bytes = b""
            if probe_bytes and not _scroll_had_effect(data, probe_bytes):
                if _looks_like_lock_screen(cur_img):
                    res.stopped_reason = (
                        "当前是 iOS 锁屏界面，滑动无效。请解锁手机后重试"
                    )
                else:
                    res.stopped_reason = (
                        "滑动后画面无变化：当前页面可能不可滚动，或触摸注入未生效"
                        "（请确认已开开发者模式且停留在列表页）"
                    )
                self._log(res.stopped_reason)
                break
            try:
                os.remove(probe_path)
            except OSError:
                pass

        # 拼接
        if res.screens:
            out = os.path.join(self.out_dir, f"long_{ts}_stitched.png")
            try:
                cw, ch = stitch(res.screens, out)
                res.stitched_path = out
                res.stitched_size = (cw, ch)
                self._log(f"已拼接 {len(res.screens)} 屏 → {cw}×{ch} → {out}")
            except Exception as e:
                res.stopped_reason += f"（拼接失败：{e}）"

        return res


# ------------------------------------------------------------------ 便捷入口


def capture_long_screen(
    udid: Optional[str] = None,
    out_dir: str = ".",
    max_screens: int = 12,
    scroll_ratio: float = 0.42,
    on_log: Optional[Callable[[str], None]] = None,
) -> LongShotResult:
    """同步包装：自动滚屏采集 + 拼接。"""
    async def _run():
        async with LongScreenCapturer(
            udid, out_dir, scroll_ratio=scroll_ratio, on_log=on_log
        ) as cap:
            return await cap.capture(max_screens=max_screens)

    return asyncio.run(_run())
