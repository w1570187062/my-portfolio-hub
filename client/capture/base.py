# -*- coding: utf-8 -*-
"""采集源抽象。

三个实现：
- UxPlaySource    : 启动 uxplay -vrtp，UDP 收流 + PyAV 解码，预览帧 + 按需截图
- UsbDvtSource    : pymobiledevice3 tunneld + dvt screenshot，原生 PNG
- BacktapSource   : 本地 HTTP 服务，接收手机快捷指令 POST 的截图

所有源都是 QObject，信号可跨线程发射（Qt 自动排入 UI 线程队列）。
"""
from __future__ import annotations

from PySide6.QtCore import QObject, Signal
from PySide6.QtGui import QImage


class CaptureSource(QObject):
    frame = Signal(QImage)    # 预览帧（可空实现）
    capture = Signal(str)     # 截图保存路径
    status = Signal(str)      # 状态文本
    error = Signal(str)       # 错误文本

    def __init__(self, cfg):
        super().__init__()
        self.cfg = cfg
        self._running = False

    @property
    def running(self) -> bool:
        return self._running

    def start(self):
        raise NotImplementedError

    def stop(self):
        raise NotImplementedError

    def capture_now(self) -> str | None:
        """立即截一张并返回路径；发射 capture 信号。"""
        raise NotImplementedError

    def preview_pixmap_available(self) -> bool:
        return False
