# -*- coding: utf-8 -*-
"""轻点背面上传源：本地 HTTP 服务接收手机快捷指令 POST 的截图。

iPhone 侧快捷指令（一次性配置）：
  1. 新建个人自动化 → 触发条件「截取屏幕时」→ 关闭"运行前询问"
  2. 动作：获取最新截图 → 获取文件 URL
  3. 「获取 URL 内容」POST http://<电脑IP>:8765/shot?token=<token>
     （方法 POST，请求体=文件；请求头 X-Token=<token>）
  4. 动作：删除截图（避免占手机空间）
  或绑定「辅助功能 → 触控 → 轻点背面」手动触发。
"""
from __future__ import annotations

import os
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .base import CaptureSource


class _Handler(BaseHTTPRequestHandler):
    server: "BacktapServer"

    def do_GET(self):
        if self.path.startswith("/ping"):
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/shot"):
            self._json(404, {"error": "not found"})
            return
        token = self.headers.get("X-Token", "")
        if token != self.server.token:
            self._json(403, {"error": "bad token"})
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0:
            self._json(400, {"error": "empty body"})
            return
        data = self.rfile.read(length)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        os.makedirs(self.server.spool_dir, exist_ok=True)
        path = os.path.join(self.server.spool_dir, f"backtap_{ts}.png")
        with open(path, "wb") as f:
            f.write(data)
        self._json(200, {"ok": True, "path": path})
        self.server.source.capture.emit(path)

    def log_message(self, fmt, *args):  # 静音
        pass

    def _json(self, code, obj):
        import json
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class BacktapServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, source, token, spool_dir):
        super().__init__(addr, _Handler)
        self.source = source
        self.token = token
        self.spool_dir = spool_dir


class BacktapSource(CaptureSource):
    def __init__(self, cfg):
        super().__init__(cfg)
        self._srv = None
        self._thread = None

    def start(self):
        if self._running:
            return
        self.cfg.ensure_dirs()
        try:
            self._srv = BacktapServer(
                ("0.0.0.0", int(self.cfg.backtap_port)), self,
                self.cfg.backtap_token, self.cfg.spool_dir)
        except OSError as e:
            self.error.emit(f"端口 {self.cfg.backtap_port} 绑定失败：{e}")
            return
        self._thread = threading.Thread(target=self._srv.serve_forever, daemon=True)
        self._thread.start()
        self._running = True
        self.status.emit(f"上传服务已启动：POST http://<本机IP>:{self.cfg.backtap_port}/shot "
                         f"（头 X-Token={self.cfg.backtap_token}）")

    def stop(self):
        if not self._running:
            return
        self._running = False
        if self._srv:
            self._srv.shutdown()
            self._srv.server_close()
        self._srv = None
        self.status.emit("上传服务已停止")

    def capture_now(self) -> str | None:
        self.status.emit("该源为被动接收：请在 iPhone 上触发快捷指令（截屏自动化 / 轻点背面）")
        return None
