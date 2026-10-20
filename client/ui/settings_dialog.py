# -*- coding: utf-8 -*-
"""设置弹窗。"""
from __future__ import annotations

from PySide6.QtWidgets import (
    QComboBox, QDialog, QFormLayout, QHBoxLayout, QLineEdit, QPushButton,
    QVBoxLayout,
)

from ..config import SOURCE_LABELS, SRC_UXPLAY, SRC_USB, SRC_BACKTAP
from ..flow.guide import GUIDES


class SettingsDialog(QDialog):
    def __init__(self, cfg, parent=None):
        super().__init__(parent)
        self.cfg = cfg
        self.setWindowTitle("设置")
        self.setMinimumWidth(520)
        lay = QVBoxLayout(self)
        form = QFormLayout()

        self.url = QLineEdit(cfg.backend_base_url)
        form.addRow("后端地址", self.url)
        self.uid = QLineEdit(str(cfg.user_id))
        form.addRow("用户 ID（X-User-Id）", self.uid)

        self.source = QComboBox()
        for k, v in SOURCE_LABELS.items():
            self.source.addItem(v, k)
        self.source.setCurrentText(SOURCE_LABELS.get(cfg.active_source, SOURCE_LABELS[SRC_UXPLAY]))
        form.addRow("采集源", self.source)

        self.uxplay_bin = QLineEdit(cfg.uxplay_bin)
        self.uxplay_bin.setPlaceholderText("留空自动探测；Windows 需 MSYS2 编译产物路径")
        form.addRow("uxplay 路径", self.uxplay_bin)
        self.uxplay_args = QLineEdit(" ".join(cfg.uxplay_args))
        form.addRow("uxplay 参数", self.uxplay_args)
        self.rtp_port = QLineEdit(str(cfg.rtp_port))
        form.addRow("RTP 端口", self.rtp_port)

        self.usb_python = QLineEdit(cfg.usb_python)
        self.usb_python.setPlaceholderText("留空=当前解释器；需 Python 3.13+ 且装 pymobiledevice3")
        form.addRow("USB 源 Python", self.usb_python)

        self.backtap_port = QLineEdit(str(cfg.backtap_port))
        form.addRow("上传服务端口", self.backtap_port)
        self.backtap_token = QLineEdit(cfg.backtap_token)
        form.addRow("上传 Token", self.backtap_token)

        self.guide = QComboBox()
        for k in GUIDES:
            self.guide.addItem(k, k)
        self.guide.setCurrentText(cfg.guide_key)
        form.addRow("引导流程", self.guide)

        lay.addLayout(form)

        btns = QHBoxLayout()
        btns.addStretch(1)
        ok = QPushButton("保存")
        ok.setObjectName("primary")
        ok.clicked.connect(self._save)
        btns.addWidget(ok)
        cancel = QPushButton("取消")
        cancel.clicked.connect(self.reject)
        btns.addWidget(cancel)
        lay.addLayout(btns)

    def _save(self):
        self.cfg.backend_base_url = self.url.text().strip()
        try:
            self.cfg.user_id = int(self.uid.text().strip())
        except ValueError:
            pass
        self.cfg.active_source = self.source.currentData()
        self.cfg.uxplay_bin = self.uxplay_bin.text().strip()
        self.cfg.uxplay_args = self.uxplay_args.text().split()
        try:
            self.cfg.rtp_port = int(self.rtp_port.text().strip())
        except ValueError:
            pass
        self.cfg.usb_python = self.usb_python.text().strip()
        try:
            self.cfg.backtap_port = int(self.backtap_port.text().strip())
        except ValueError:
            pass
        self.cfg.backtap_token = self.backtap_token.text().strip()
        self.cfg.guide_key = self.guide.currentText()
        self.cfg.save()
        self.accept()
