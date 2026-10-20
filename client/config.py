# -*- coding: utf-8 -*-
"""持仓侠 · 手机采集客户端配置。

配置持久化在 client/data/config.json；所有路径均支持用户覆盖。
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CONFIG_PATH = DATA_DIR / "config.json"

# 采集源标识
SRC_UXPLAY = "uxplay"      # UxPlay 镜像（预览 + 镜像帧截图，Spike 阶段主用）
SRC_USB = "usb"            # USB + pymobiledevice3 DVT 原生截图（iOS 17+）
SRC_BACKTAP = "backtap"    # 手机轻点背面/快捷指令 POST 截图

SOURCE_LABELS = {
    SRC_UXPLAY: "UxPlay 镜像（1080p 预览/采集）",
    SRC_USB: "USB 原生截图（pymobiledevice3 DVT）",
    SRC_BACKTAP: "轻点背面上传（快捷指令）",
}


@dataclass
class Config:
    # 后端
    backend_base_url: str = "http://192.168.31.254:9989"
    user_id: int = 1

    # 当前采集源
    active_source: str = SRC_UXPLAY

    # UxPlay 镜像源
    uxplay_bin: str = ""                       # 空 = 自动探测（mac: /usr/local/bin/uxplay, /opt/homebrew/bin/uxplay）
    uxplay_args: list = field(default_factory=lambda: ["-vrtp", "127.0.0.1:5600"])
    rtp_port: int = 5600                       # 与 uxplay_args 中端口保持一致

    # USB DVT 源
    usb_python: str = ""                       # 空 = 当前解释器；需 Python 3.13+
    udid: str = ""                             # iPhone UDID；空 = 自动选第一台 USB 设备
    tunnel_url: str = "http://127.0.0.1:49151" # pymobiledevice3 tunneld 状态接口

    # 轻点背面上传源
    backtap_port: int = 8765
    backtap_token: str = "portfolio"

    # 存储
    captures_dir: str = str(DATA_DIR / "captures")
    spool_dir: str = str(DATA_DIR / "spool")

    # 引导
    guide_key: str = "holdings_init"
    auto_capture: bool = True                  # 引导判页成功后自动截图

    def uxplay_path(self) -> str:
        if self.uxplay_bin:
            return self.uxplay_bin
        for p in ("/usr/local/bin/uxplay", "/opt/homebrew/bin/uxplay", "/usr/bin/uxplay"):
            if os.path.exists(p):
                return p
        return "uxplay"

    def python_path(self) -> str:
        return self.usb_python or sys.executable

    def ensure_dirs(self):
        for d in (self.captures_dir, self.spool_dir):
            Path(d).mkdir(parents=True, exist_ok=True)

    def save(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load(cls) -> "Config":
        cfg = cls()
        if CONFIG_PATH.exists():
            try:
                data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                for k, v in data.items():
                    if hasattr(cfg, k):
                        setattr(cfg, k, v)
            except Exception:
                pass
        return cfg
