# -*- coding: utf-8 -*-
"""采集源集合。"""
from .base import CaptureSource
from .uxplay_source import UxPlaySource
from .usb_dvt_source import UsbDvtSource, is_windows_admin
from .backtap_source import BacktapSource
from .rtp_h264 import RtpH264Depacketizer


def create_source(cfg) -> CaptureSource:
    from ..config import SRC_UXPLAY, SRC_USB, SRC_BACKTAP
    if cfg.active_source == SRC_USB:
        return UsbDvtSource(cfg)
    if cfg.active_source == SRC_BACKTAP:
        return BacktapSource(cfg)
    return UxPlaySource(cfg)


__all__ = [
    "CaptureSource", "UxPlaySource", "UsbDvtSource", "BacktapSource",
    "create_source", "RtpH264Depacketizer", "is_windows_admin",
]
