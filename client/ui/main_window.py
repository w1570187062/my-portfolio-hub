# -*- coding: utf-8 -*-
"""主窗口：引导卡片 + 预览 + 截图列表 + 日志。"""
from __future__ import annotations

import os
import threading

from PySide6.QtCore import QObject, QMetaObject, Qt, Signal, Slot
from PySide6.QtGui import QIcon, QImage, QPixmap
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QFileDialog, QHBoxLayout, QLabel, QListWidget,
    QListWidgetItem, QMainWindow, QMessageBox, QPushButton, QStatusBar,
    QVBoxLayout, QWidget,
)

from ..api.backend import BackendClient, BackendError
from ..capture import create_source
from ..config import SOURCE_LABELS, Config
from ..flow.guide import GUIDES, GuideRunner
from ..ocr.engine import items_to_columns, run_ocr
from ..ocr.table import parse_columns
from .review_dialog import ReviewDialog
from .settings_dialog import SettingsDialog
from .theme import STYLESHEET


class _OcrSignals(QObject):
    done = Signal(str, list)      # path, columns
    error = Signal(str)


def run_ocr_async(path: str) -> _OcrSignals:
    sig = _OcrSignals()

    def work():
        try:
            cols = items_to_columns(run_ocr(path))
        except Exception as e:
            sig.error.emit(f"OCR 失败：{e}")
            return
        sig.done.emit(path, cols)

    threading.Thread(target=work, daemon=True).start()
    return sig


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.cfg = Config.load()
        self.cfg.ensure_dirs()
        self.source = None
        self.backend = BackendClient(self.cfg.backend_base_url, self.cfg.user_id)
        self.guide = GuideRunner(self.cfg.guide_key)
        self.guide.on_step = self._on_step
        self.guide.on_capture = self._on_guide_capture
        self.guide.on_log = self._log
        self._ocr_sigs = []
        self._pending_review = None

        self.setWindowTitle("持仓侠 · 手机采集客户端")
        self.resize(1180, 760)
        self.setStyleSheet(STYLESHEET)
        self._build_ui()
        self._refresh_backend()
        self.guide.reset()

    # ---------- UI ----------
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)

        # 顶栏
        top = QHBoxLayout()
        title = QLabel("持仓侠 · 手机采集客户端")
        title.setObjectName("stepTitle")
        top.addWidget(title)
        top.addStretch(1)
        self.backend_tag = QLabel("后端：检测中…")
        self.backend_tag.setObjectName("muted")
        top.addWidget(self.backend_tag)
        settings_btn = QPushButton("设置")
        settings_btn.clicked.connect(self._open_settings)
        top.addWidget(settings_btn)
        root.addLayout(top)

        body = QHBoxLayout()

        # 左栏
        left = QVBoxLayout()
        left.setSpacing(10)

        guide_box = QVBoxLayout()
        self.step_title = QLabel("—")
        self.step_title.setObjectName("stepTitle")
        guide_box.addWidget(self.step_title)
        self.step_hint = QLabel("")
        self.step_hint.setObjectName("hint")
        self.step_hint.setWordWrap(True)
        guide_box.addWidget(self.step_hint)
        self.step_progress = QLabel("")
        self.step_progress.setObjectName("muted")
        guide_box.addWidget(self.step_progress)
        self._group("引导步骤", guide_box, left)

        cap = QVBoxLayout()
        src_row = QHBoxLayout()
        src_row.addWidget(QLabel("采集源"))
        self.src_combo = QComboBox()
        for k, v in SOURCE_LABELS.items():
            self.src_combo.addItem(v, k)
        self.src_combo.setCurrentText(SOURCE_LABELS.get(self.cfg.active_source, ""))
        self.src_combo.currentIndexChanged.connect(self._on_source_changed)
        src_row.addWidget(self.src_combo, 1)
        cap.addLayout(src_row)
        btn_row = QHBoxLayout()
        self.start_btn = QPushButton("启动")
        self.start_btn.setObjectName("primary")
        self.start_btn.clicked.connect(self._start_source)
        btn_row.addWidget(self.start_btn)
        self.stop_btn = QPushButton("停止")
        self.stop_btn.setEnabled(False)
        self.stop_btn.clicked.connect(self._stop_source)
        btn_row.addWidget(self.stop_btn)
        self.cap_btn = QPushButton("立即截图")
        self.cap_btn.setEnabled(False)
        self.cap_btn.clicked.connect(self._capture_now)
        btn_row.addWidget(self.cap_btn)
        self.long_btn = QPushButton("自动长屏")
        self.long_btn.setToolTip("自动滑动 + 逐屏截图 + 拼接成一张长图（需 iPhone 已解锁且在列表页）")
        self.long_btn.clicked.connect(self._capture_long)
        btn_row.addWidget(self.long_btn)
        cap.addLayout(btn_row)
        opt_row = QHBoxLayout()
        self.auto_chk = QCheckBox("判页成功后自动截图")
        self.auto_chk.setChecked(self.cfg.auto_capture)
        self.auto_chk.toggled.connect(lambda v: setattr(self.cfg, "auto_capture", v))
        opt_row.addWidget(self.auto_chk)
        import_btn = QPushButton("从文件导入截图…")
        import_btn.clicked.connect(self._import_file)
        opt_row.addWidget(import_btn)
        diag_btn = QPushButton("设备诊断")
        diag_btn.setToolTip("检查 iPhone 连接 / 驱动 / 开发者模式 / 隧道，输出可读报告")
        diag_btn.clicked.connect(self._run_diagnostics)
        opt_row.addWidget(diag_btn)
        devmode_btn = QPushButton("解锁开发者模式")
        devmode_btn.setToolTip("iOS 16+ 默认隐藏「开发者模式」开关，此按钮通过 AMFI 指令让它出现")
        devmode_btn.clicked.connect(self._unlock_devmode)
        opt_row.addWidget(devmode_btn)
        opt_row.addStretch(1)
        cap.addLayout(opt_row)
        self._group("采集", cap, left)

        self.log_list = QListWidget()
        self._group("日志", QVBoxLayout(), left).layout().addWidget(self.log_list)
        left.addStretch(1)

        # 右栏
        right = QVBoxLayout()
        self.preview = QLabel("镜像预览区（启动 UxPlay 源后显示）")
        self.preview.setObjectName("preview")
        self.preview.setAlignment(Qt.AlignCenter)
        self.preview.setMinimumSize(420, 480)
        right.addWidget(self.preview, 1)

        self.thumbs = QListWidget()
        self.thumbs.setViewMode(QListWidget.IconMode)
        self.thumbs.setFlow(QListWidget.LeftToRight)
        self.thumbs.setIconSize(self.preview.minimumSize() * 0.3)
        self.thumbs.setMaximumHeight(190)
        self.thumbs.setSpacing(6)
        right.addWidget(self.thumbs)

        body.addLayout(left, 3)
        body.addLayout(right, 5)
        root.addLayout(body, 1)

        self.setStatusBar(QStatusBar())

    def _group(self, title, inner: QVBoxLayout, parent_layout: QVBoxLayout):
        from PySide6.QtWidgets import QGroupBox
        box = QGroupBox(title)
        box.setLayout(inner)
        parent_layout.addWidget(box)
        return box

    # ---------- backend ----------
    def _refresh_backend(self):
        try:
            v = self.backend.version()
            self.backend_tag.setText(f"后端：{self.cfg.backend_base_url}（v{v}）")
        except BackendError as e:
            self.backend_tag.setText(f"后端：不可用（{e.msg}）")

    def _open_settings(self):
        dlg = SettingsDialog(self.cfg, self)
        if dlg.exec():
            self.backend = BackendClient(self.cfg.backend_base_url, self.cfg.user_id)
            self.src_combo.setCurrentText(SOURCE_LABELS.get(self.cfg.active_source, ""))
            self.guide = GuideRunner(self.cfg.guide_key)
            self.guide.on_step = self._on_step
            self.guide.on_capture = self._on_guide_capture
            self.guide.on_log = self._log
            self.guide.reset()
            self._refresh_backend()
            self._log("设置已保存")

    # ---------- guide ----------
    def _on_step(self, idx, step):
        self.step_title.setText(f"{idx + 1}. {step.title}")
        self.step_hint.setText(step.hint)
        self.step_progress.setText(f"步骤 {idx + 1}/{len(self.guide.steps)} · {self.guide.guide_key}")

    def _on_guide_capture(self, schema, step):
        self._log(f"引导请求采集（{schema}）")
        if self.cfg.auto_capture and self.source and self.source.running:
            self._capture_now()

    # ---------- source ----------
    def _on_source_changed(self, _idx):
        self.cfg.active_source = self.src_combo.currentData()
        self.cfg.save()
        self._log(f"采集源切换为：{SOURCE_LABELS.get(self.cfg.active_source)}")

    def _start_source(self):
        if self.source and self.source.running:
            return
        self.source = create_source(self.cfg)
        self.source.frame.connect(self._on_frame)
        self.source.capture.connect(self._on_capture_saved)
        self.source.status.connect(self._log)
        self.source.error.connect(self._on_source_error)
        self.source.start()
        self.start_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)
        self.cap_btn.setEnabled(True)

    def _stop_source(self):
        if self.source:
            self.source.stop()
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.cap_btn.setEnabled(False)

    def _on_source_error(self, msg):
        self._log("错误：" + msg.splitlines()[0])
        QMessageBox.warning(self, "采集源错误", msg)

    def _on_frame(self, qimg: QImage):
        pix = QPixmap.fromImage(qimg)
        self.preview.setPixmap(pix.scaled(
            self.preview.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation))

    def _capture_now(self):
        if not self.source or not self.source.running:
            QMessageBox.information(self, "提示", "请先启动采集源")
            return
        self._log("截图中…")
        self.source.capture_now()

    # ---------- capture handling ----------
    def _on_capture_saved(self, path: str):
        self._log(f"已截图：{os.path.basename(path)}")
        self._add_thumb(path)
        sig = run_ocr_async(path)
        self._ocr_sigs.append(sig)
        sig.done.connect(self._on_ocr_done)
        sig.error.connect(self._on_source_error)

    def _on_ocr_done(self, path: str, cols: list):
        pr = parse_columns(cols)
        self.guide.feed_text(pr.text)
        if not pr.rows:
            self._log("未解析到表格行")
            return
        mode_default = ""
        if pr.schema == "wealth":
            mode_default = "理财快照"
        elif pr.schema == "flows":
            mode_default = "现金调整"
        self._log(f"识别到 {len(pr.rows)} 行（{pr.schema}），打开核对弹窗")
        dlg = ReviewDialog(pr, self.backend, self, default_mode=mode_default)
        dlg.exec()

    def _add_thumb(self, path: str):
        item = QListWidgetItem(QIcon(path), os.path.basename(path))
        self.thumbs.addItem(item)
        self.thumbs.scrollToBottom()

    def _import_file(self):
        files, _ = QFileDialog.getOpenFileNames(self, "选择截图", "", "图片 (*.png *.jpg *.jpeg)")
        for f in files:
            self._on_capture_saved(f)

    def _capture_long(self):
        """自动长屏：滑动 + 逐屏截图 + 拼接（后台线程）。"""
        from ..capture.long_shot import capture_long_screen

        self.long_btn.setEnabled(False)
        self._log("开始自动长屏采集（iPhone 需已解锁并停留在列表页）…")

        out_dir = os.path.join(self.cfg.captures_dir, "longshots")

        def work():
            try:
                res = capture_long_screen(
                    udid=self.cfg.udid or None,
                    out_dir=out_dir,
                    max_screens=12,
                    on_log=self._log,
                )
                self._log(f"长屏采集完成：{res.screen_count} 屏")
                if res.stitched_path:
                    self._log(f"长图：{res.stitched_path} "
                              f"{res.stitched_size[0]}×{res.stitched_size[1]}")
                if res.stopped_reason:
                    self._log(f"停止原因：{res.stopped_reason}")
                # 长图也走一次 OCR，供后续结构化解析
                if res.stitched_path:
                    self._on_capture_saved(res.stitched_path)
            except Exception as e:
                self._log(f"长屏采集失败：{type(e).__name__}: {e}")
            finally:
                QMetaObject.invokeMethod(self, "_enable_long_btn", Qt.QueuedConnection)

        threading.Thread(target=work, daemon=True).start()

    @Slot()
    def _enable_long_btn(self):
        self.long_btn.setEnabled(True)

    def _run_diagnostics(self):
        """跑设备链路自检，结果写入日志（后台线程，避免卡 UI）。"""
        import subprocess
        import sys as _sys

        script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "spike_dvt.py")
        self._log("开始设备诊断…")

        def work():
            try:
                r = subprocess.run([_sys.executable, script], capture_output=True,
                                   text=True, timeout=600)
                out = (r.stdout or "") + (r.stderr or "")
            except Exception as e:
                out = f"诊断执行失败：{e}"
            for line in out.splitlines():
                self._log(line)

        threading.Thread(target=work, daemon=True).start()

    def _unlock_devmode(self):
        """通过 AMFI 指令让 iPhone 设置里出现「开发者模式」开关。"""
        import subprocess
        import sys as _sys

        script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "unlock_devmode.py")
        self._log("正在解锁开发者模式…")

        def work():
            try:
                r = subprocess.run([_sys.executable, script], capture_output=True,
                                   text=True, timeout=300)
                out = (r.stdout or "") + (r.stderr or "")
            except Exception as e:
                out = f"解锁失败：{e}"
            for line in out.splitlines():
                self._log(line)

        threading.Thread(target=work, daemon=True).start()

    # ---------- misc ----------
    def _log(self, msg: str):
        from datetime import datetime
        self.log_list.addItem(f"[{datetime.now():%H:%M:%S}] {msg}")
        self.log_list.scrollToBottom()
        self.statusBar().showMessage(msg, 8000)

    def closeEvent(self, e):
        if self.source and self.source.running:
            self.source.stop()
        self.cfg.save()
        super().closeEvent(e)


def main():
    import sys
    from PySide6.QtWidgets import QApplication
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    w = MainWindow()
    w.show()
    sys.exit(app.exec())
