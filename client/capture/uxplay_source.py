# -*- coding: utf-8 -*-
"""UxPlay 镜像源：启动 uxplay（-vrtp 转发解密后 H.264），本地 UDP 收流解码。

镜像分辨率上限 1080p（AirPlay 协议限制），适合预览与页面判定；
正式数据采集建议切到 USB DVT 源（原生 PNG）。
"""
from __future__ import annotations

import os
import socket
import subprocess
import threading
import time
from datetime import datetime

import av
from PySide6.QtCore import QTimer
from PySide6.QtGui import QImage

from ..config import SRC_UXPLAY
from .base import CaptureSource
from .rtp_h264 import RtpH264Depacketizer


class UxPlaySource(CaptureSource):
    def __init__(self, cfg):
        super().__init__(cfg)
        self.proc: subprocess.Popen | None = None
        self._stop = threading.Event()
        self._want_capture = threading.Event()
        self._threads: list[threading.Thread] = []
        self._last_qimg: QImage | None = None
        self._codec = None

    # ---------- lifecycle ----------
    def start(self):
        if self._running:
            return
        exe = self.cfg.uxplay_path()
        args = [exe] + list(self.cfg.uxplay_args)
        self.cfg.ensure_dirs()
        try:
            self.proc = subprocess.Popen(
                args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
        except FileNotFoundError:
            self.error.emit(f"找不到 uxplay 可执行文件：{exe}\n请先在设置中指定 uxplay 路径（或先完成镜像 Spike）。")
            return
        except Exception as e:
            self.error.emit(f"uxplay 启动失败：{e}")
            return

        self._stop.clear()
        self._running = True
        self.status.emit(f"uxplay 已启动：{' '.join(args)}")

        t_log = threading.Thread(target=self._stderr_loop, daemon=True)
        t_rtp = threading.Thread(target=self._rtp_loop, daemon=True)
        t_log.start()
        t_rtp.start()
        self._threads = [t_log, t_rtp]

        # 进程退出看门狗
        self._wd = QTimer()
        self._wd.setInterval(1000)
        self._wd.timeout.connect(self._check_proc)
        self._wd.start()

    def stop(self):
        if not self._running:
            return
        self._running = False
        self._stop.set()
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=3)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass
        self.proc = None
        self.status.emit("uxplay 已停止")

    def preview_pixmap_available(self) -> bool:
        return True

    # ---------- capture ----------
    def capture_now(self) -> str | None:
        if not self._running:
            self.error.emit("镜像未启动")
            return None
        self._want_capture.set()
        # 等最多 5 秒出帧
        for _ in range(50):
            if not self._want_capture.is_set():
                return self._last_path
            time.sleep(0.1)
        self.error.emit("截图超时：镜像流中没有新帧（iPhone 是否已连接并投屏？）")
        return None

    # ---------- internals ----------
    def _check_proc(self):
        if self.proc and self.proc.poll() is not None and self._running:
            self._running = False
            self.error.emit(f"uxplay 进程退出（code={self.proc.returncode}）")

    def _stderr_loop(self):
        proc = self.proc
        if not proc or not proc.stderr:
            return
        for raw in iter(proc.stderr.readline, b""):
            if self._stop.is_set():
                break
            line = raw.decode("utf-8", "replace").strip()
            if line:
                self.status.emit(line)

    def _rtp_loop(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", int(self.cfg.rtp_port)))
        except OSError as e:
            self.error.emit(f"RTP 端口 {self.cfg.rtp_port} 绑定失败：{e}")
            return
        sock.settimeout(0.5)

        dep = RtpH264Depacketizer()
        try:
            self._codec = av.CodecContext.create("h264", "r")
        except Exception as e:
            self.error.emit(f"H.264 解码器创建失败：{e}")
            return

        self.status.emit(f"RTP 监听 127.0.0.1:{self.cfg.rtp_port}，等待 iPhone 投屏…")
        self._last_path = None

        while not self._stop.is_set():
            try:
                data, _ = sock.recvfrom(65536)
            except socket.timeout:
                continue
            except OSError:
                break
            au = dep.feed(data)
            if not au:
                continue
            try:
                pkt = av.Packet(au)
                frames = self._codec.decode(pkt)
            except Exception as e:
                self.error.emit(f"解码错误：{e}")
                continue
            for f in frames:
                try:
                    arr = f.to_ndarray(format="bgr24")
                except Exception:
                    continue
                h, w = arr.shape[:2]
                qimg = QImage(arr.tobytes(), w, h, w * 3, QImage.Format_BGR888).copy()
                self._last_qimg = qimg
                self.frame.emit(qimg)
                if self._want_capture.is_set():
                    self._save_frame(arr, w, h)

        try:
            sock.close()
        except Exception:
            pass

    def _save_frame(self, arr, w, h):
        self._want_capture.clear()
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        path = os.path.join(self.cfg.captures_dir, f"mirror_{ts}.png")
        try:
            import cv2
            os.makedirs(self.cfg.captures_dir, exist_ok=True)
            cv2.imwrite(path, arr)
        except Exception as e:
            self.error.emit(f"保存截图失败：{e}")
            return
        self._last_path = path
        self.capture.emit(path)
