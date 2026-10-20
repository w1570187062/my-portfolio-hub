# -*- coding: utf-8 -*-
"""共享数据模型。"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Column:
    """OCR 识别出的单个文本块（含几何信息）。"""
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    conf: float = 0.0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def h(self) -> float:
        return abs(self.y1 - self.y0)


@dataclass
class ParseResult:
    """一次截图的表格解析结果。"""
    schema: str                       # holdings | wealth | flows | generic
    columns: list                     # 表头文本（或 c0..cN）
    rows: list                        # list[dict]，键为字段名或列序号键
    text: str                         # 全文（用于页面判定）
    header_detected: bool = False
    header_row_idx: int = -1
    items: list = field(default_factory=list)  # 原始 Column 列表


@dataclass
class CaptureRecord:
    path: str
    ts: float
    source: str
    width: int = 0
    height: int = 0
