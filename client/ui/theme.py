# -*- coding: utf-8 -*-
"""主题：与持仓侠 web 端对齐的暗色金色皮肤。

对应 web style.css 的 CSS 变量：
  --primary:#d9a52b（金）  --radius:10px  涨红 #e5484d / 跌绿 #2fa35c
"""
from __future__ import annotations

PRIMARY = "#d9a52b"
PRIMARY_HOVER = "#e5b944"
BG = "#16171a"
BG_CARD = "#1e2024"
BG_INPUT = "#26282d"
BORDER = "#33363c"
TEXT = "#e8e6e3"
TEXT_MUTED = "#9a9da4"
UP = "#e5484d"
DOWN = "#2fa35c"

STYLESHEET = f"""
QWidget {{
    background: {BG};
    color: {TEXT};
    font-family: "Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif;
    font-size: 13px;
}}
QGroupBox {{
    background: {BG_CARD};
    border: 1px solid {BORDER};
    border-radius: 10px;
    margin-top: 10px;
    padding: 12px 10px 10px 10px;
    font-weight: 600;
}}
QGroupBox::title {{
    subcontrol-origin: margin;
    left: 12px;
    padding: 0 4px;
    color: {TEXT_MUTED};
}}
QPushButton {{
    background: {BG_INPUT};
    border: 1px solid {BORDER};
    border-radius: 8px;
    padding: 5px 14px;
    color: {TEXT};
}}
QPushButton:hover {{ border-color: {PRIMARY}; color: {PRIMARY}; }}
QPushButton:disabled {{ color: #5c5f66; border-color: {BORDER}; }}
QPushButton#primary {{
    background: {PRIMARY};
    border: none;
    color: #1a1508;
    font-weight: 600;
}}
QPushButton#primary:hover {{ background: {PRIMARY_HOVER}; }}
QPushButton#danger {{ color: {UP}; }}
QLineEdit, QComboBox, QSpinBox, QPlainTextEdit {{
    background: {BG_INPUT};
    border: 1px solid {BORDER};
    border-radius: 8px;
    padding: 4px 8px;
    selection-background-color: {PRIMARY};
}}
QComboBox::drop-down {{ border: none; width: 18px; }}
QComboBox QAbstractItemView {{
    background: {BG_INPUT};
    border: 1px solid {BORDER};
    selection-background-color: {PRIMARY};
    selection-color: #1a1508;
}}
QListWidget {{
    background: {BG_INPUT};
    border: 1px solid {BORDER};
    border-radius: 8px;
}}
QLabel#stepTitle {{ font-size: 15px; font-weight: 700; color: {TEXT}; }}
QLabel#hint {{ color: {TEXT_MUTED}; }}
QLabel#muted {{ color: {TEXT_MUTED}; }}
QLabel#preview {{
    background: #0c0d0f;
    border: 1px solid {BORDER};
    border-radius: 10px;
}}
QStatusBar {{ color: {TEXT_MUTED}; }}
QStatusBar::item {{ border: none; }}
"""
