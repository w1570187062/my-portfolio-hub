# -*- coding: utf-8 -*-
"""USB DVT 源：pymobiledevice3 + iOS 17+ 原生截图通道。

原理
----
iOS 17 起 Apple 移除了旧的 screenshotr 服务，必须走 RemoteXPC 隧道 + DVT
(Developer Tools) 通道才能拿到**原生分辨率 PNG**。

隧道策略（按 iOS 版本分档，顺序不可乱）
----------------------------------------
1. ``auto``（**iOS 17.4+ 首选**）：不传任何隧道 flag。17.4 起 RSD 隧道由
   pymobiledevice3 在进程内自动建立（默认走免提权的 userspace 实现）。
   传了 ``--userspace`` / ``--tunnel`` 反而会报 "no flag is needed" 类错误。
2. ``userspace``  iOS 17.0–17.3（Windows/Linux）：显式要求纯 Python 用户态隧道，免提权
3. ``tunnel``     已有 tunneld 常驻时使用（需管理员）
4. ``native``     仅 macOS：借道 Apple 自带 remoted

关键约束
--------
- 旧命令 ``developer screenshot`` 在 iOS 17+ 已失效，必须用 ``developer dvt screenshot``
- **DVT 通道硬前置：手机必须开启「开发者模式」**（设置→隐私与安全性→开发者模式）。
  未开启时报 "Apple removed this service" —— 这不是命令错，是权限没给。
- ``--tunnel ""``（空串）会弹出交互式选择器，在脚本/子进程里会挂起 → 永不传空串
- 首次连接手机需点"信任此电脑"
- 子进程必须用干净环境（清 PYTHONPATH），否则会命中用户 SDK 里的 python312 DLL
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from ..envfix import child_env
from .base import CaptureSource

# 隧道策略优先级：auto（iOS 17.4+ 自动建隧道，不传 flag）→ userspace → tunnel → native
_TUNNEL_MODES = ("auto", "userspace", "tunnel", "native")

# 错误关键词 → 中文提示（顺序敏感：先匹配具体项）
_ERR_HINTS = (
    ("Apple removed this service", "DVT 服务不可用 —— 通常是**手机未开启开发者模式**。"
                                   "请在 设置 → 隐私与安全性 → 开发者模式 打开（重启后输入锁屏密码）"),
    ("Developer Mode is disabled", "手机未开启开发者模式：设置 → 隐私与安全性 → 开发者模式"),
    ("Developer Mode is not enabled", "手机未开启开发者模式：设置 → 隐私与安全性 → 开发者模式"),
    ("DeveloperDiskImage not mounted", "开发者镜像未挂载：请运行 mounter auto-mount"),
    ("PersonalizedImage", "个性化开发者镜像未挂载：请运行 mounter auto-mount"),
    ("InvalidServiceError", "开发者服务不可用：需先开启手机开发者模式"),
    ("RSDRequiredError", "iOS 17+ 需要 RSD 隧道：请勿传 --tunnel 空串，或改用 auto 模式"),
    ("Failed to start service", "开发者服务启动失败：确认手机已解锁并已信任本机"),
    ("pairing", "配对失效：手机上重新信任本机，或执行 lockdown unpair && lockdown pair"),
    ("ConnectionRefused", "隧道未建立：iOS 17.4+ 不需任何 flag；若为 17.0-17.3 请启动 tunneld"),
    ("no flag is needed", "隧道参数多余：iOS 17.4+ 应使用 auto 模式（不传隧道 flag）"),
    ("timeout", "隧道握手超时：手机可能已锁屏，请解锁后重试"),
    ("tunt", "隧道建立失败"),
)


def is_windows_admin() -> bool:
    if sys.platform != "win32":
        return True
    try:
        import ctypes

        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _friendly_error(raw: str) -> str:
    """把 pymobiledevice3 的英文报错翻译成可执行的中文提示。"""
    low = raw.lower()
    for key, hint in _ERR_HINTS:
        if key.lower() in low:
            return f"{hint}\n原始错误：{raw.strip()[-300:]}"
    return raw.strip()[-400:]


def _mode_label(mode: str) -> str:
    """隧道模式的中文可读名（auto 是 iOS 17.4+ 的默认自动隧道）。"""
    return {
        "auto": "auto（iOS17.4+ 自动隧道）",
        "userspace": "userspace（免提权）",
        "tunnel": "tunnel（外部 tunneld）",
        "native": "native（macOS remoted）",
    }.get(mode, mode)


def _analyze_blank(path: str, threshold: float = 0.998) -> tuple[bool, str]:
    """检测截图是否无内容（纯黑/纯白/单色）。

    DVT 通道在 iOS **锁屏状态下只能拿到纯黑图**：Secure Layer 由硬件保护，
    开发者服务无权限读取，此时命令仍返回 0，不做检测的话用户会对着黑图
    以为是截图失败。
    """
    try:
        from PIL import Image, ImageStat
    except ImportError:
        return False, ""
    try:
        with Image.open(path) as im:
            # 缩采样足够判定单色，且避免大图解码开销
            small = im.convert("L").resize((64, 128))
            stat = ImageStat.Stat(small)
            mean = stat.mean[0]
            stddev = stat.stddev[0]
    except Exception:
        return False, ""
    # 标准差接近 0 = 整幅图同色
    if stddev < 2.0:
        kind = "黑屏" if mean < 25 else ("白屏" if mean > 230 else "单色画面")
        return True, (f"{kind}（平均亮度 {mean:.0f}，无有效内容）。"
                      f"若手机处于锁屏，Secure Layer 由硬件保护，DVT 无法读取画面。")
    return False, ""


class UsbDvtSource(CaptureSource):
    """USB + DVT 原生截图源。

    用法：start() 建立隧道上下文 → capture_now() 抓图 → stop() 释放。
    """

    def __init__(self, cfg):
        super().__init__(cfg)
        self._udid: str = ""
        self._mode: str = ""
        self._proc: subprocess.Popen | None = None
        self._mounted = False

    # ------------------------------------------------------------------ 生命周期
    def start(self):
        self.cfg.ensure_dirs()
        if not is_windows_admin():
            self.status.emit("提示：当前非管理员。本客户端默认使用 userspace 隧道（免提权），"
                             "仅在必要时才要求管理员启动 tunneld。")

        self._udid = self._detect_udid()
        if not self._udid:
            self.error.emit(
                "未检测到 iPhone。请检查：① 数据线已插好且是数据线（非充电线）"
                "② 手机已解锁 ③ 手机上已点「信任此电脑」"
                "④ Windows 需安装 iTunes 或 Apple Devices 以提供 USB 驱动"
            )
            return

        self.status.emit(f"已识别设备 UDID={self._udid[:8]}…")

        if not self._ensure_mounted():
            return

        self._running = True
        self.status.emit(f"USB DVT 源就绪（隧道模式：{self._mode or '待首次截图时确定'}）")

    def stop(self):
        self._running = False
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.terminate()
            except Exception:
                pass
        self._proc = None
        self.status.emit("USB DVT 源已停止")

    # ------------------------------------------------------------------ 抓图
    def capture_now(self) -> str | None:
        if not self._running:
            self.error.emit("USB DVT 源未就绪")
            return None

        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        path = os.path.join(self.cfg.captures_dir, f"usb_{ts}.png")
        py = self.cfg.python_path()

        # 依次尝试各隧道模式；第一个成功的即锁定模式
        modes = [self._mode] if self._mode else list(_TUNNEL_MODES)
        last_err = ""
        for mode in modes:
            if not mode:
                continue
            if mode == "native" and sys.platform != "darwin":
                continue
            ok, err = self._try_capture(py, mode, path)
            if ok:
                # 命令返回 0 不代表画面有效：iOS 锁屏时 DVT 只能拿到纯黑图
                # （Secure Layer 硬件保护，DVT 服务无权限），必须拦下来告诉用户
                blank, why = _analyze_blank(path)
                if blank:
                    self.error.emit(
                        f"截图成功但画面是空的：{why}\n"
                        f"解锁 iPhone 停留在目标 App 页面后重新截图。"
                    )
                    try:
                        os.remove(path)
                    except OSError:
                        pass
                    return None
                self._mode = mode
                self._mounted = True
                self.capture.emit(path)
                self.status.emit(f"截图成功（隧道模式：{self._mode_label(mode)}）")
                return path
            last_err = err
            if os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
            # 开发者模式未开时，换任何隧道模式都是同一堵墙 → 立即停，别再空转
            if "developer mode" in err.lower() or "apple removed this service" in err.lower():
                last_err += "\n（各隧道模式均要求开发者模式，请先在手机上开启）"
                break

        self.error.emit("DVT 截图失败：\n" + _friendly_error(last_err or "未知错误"))
        return None

    # ------------------------------------------------------------------ internals
    def _try_capture(self, py: str, mode: str, path: str) -> tuple[bool, str]:
        cmd = [py, "-m", "pymobiledevice3", "developer", "dvt", "screenshot", path]
        # auto = iOS 17.4+：RSD 隧道自动建立，绝不能传 --userspace/--tunnel/--native
        if mode == "userspace":
            cmd.append("--userspace")
        elif mode == "tunnel":
            cmd += ["--tunnel", self._udid]
        elif mode == "native":
            cmd.append("--native")
        if self._udid:
            cmd += ["--udid", self._udid]

        env = child_env()
        env["PYMOBILEDEVICE3_UDID"] = self._udid

        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env)
        except subprocess.TimeoutExpired:
            return False, f"[{mode}] 截图命令超时（120s）。请确认手机已解锁。"
        except Exception as e:
            return False, f"[{mode}] 截图命令执行失败：{e}"

        if r.returncode == 0 and os.path.exists(path) and os.path.getsize(path) > 0:
            return True, ""
        raw = (r.stderr or r.stdout or "").strip()
        return False, f"[{mode}] {raw}"

    def _detect_udid(self) -> str:
        """列出 usbmux 可见的设备，取第一个 iPhone。"""
        py = self.cfg.python_path()
        try:
            r = subprocess.run(
                [py, "-m", "pymobiledevice3", "usbmux", "list"],
                capture_output=True, text=True, timeout=30, env=child_env(),
            )
        except Exception:
            return ""
        if r.returncode != 0:
            return ""
        # 输出为 JSON 数组，或含 "UDID" 字段的文本
        out = (r.stdout or "").strip()
        try:
            data = json.loads(out)
            if isinstance(data, list) and data:
                for d in data:
                    if isinstance(d, dict) and d.get("UDID"):
                        return d["UDID"]
        except Exception:
            pass
        m = re.search(r"([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})", out)
        return m.group(1) if m else ""

    def _ensure_mounted(self) -> bool:
        """挂载开发者磁盘镜像（DDI），DVT 服务需要。

        iOS 17.4+ 走自动隧道，**不传** ``--userspace``/``--tunnel``（传了会报
        "RSD is required ... override with --tunnel/--userspace/--native"）。
        挂载失败不阻断流程——真正的错误会在截图那一步以更准确的文案给出。
        """
        py = self.cfg.python_path()
        cmd = [py, "-m", "pymobiledevice3", "mounter", "auto-mount"]
        if self._udid:
            cmd += ["--udid", self._udid]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=180, env=child_env())
        except Exception as e:
            self.status.emit(f"开发者镜像挂载异常（不阻断）：{e}")
            return True
        if r.returncode != 0:
            self.status.emit("开发者镜像挂载警告：" + (r.stderr or r.stdout or "").strip()[-200:])
        else:
            self._mounted = True
        return True

    def device_info(self) -> str:
        """调试用：返回设备信息 JSON 文本。"""
        py = self.cfg.python_path()
        try:
            r = subprocess.run(
                [py, "-m", "pymobiledevice3", "lockdown", "info"],
                capture_output=True, text=True, timeout=30, env=child_env(),
            )
            return (r.stdout or r.stderr or "").strip()
        except Exception as e:
            return f"失败：{e}"
