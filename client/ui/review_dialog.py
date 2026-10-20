# -*- coding: utf-8 -*-
"""识别结果审核弹窗：列映射 → 人工修正 → 写入后端。"""
from __future__ import annotations

from datetime import datetime

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox, QDialog, QHBoxLayout, QLabel, QMessageBox, QPushButton,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from ..api.backend import BackendError
from ..ocr.table import SCHEMAS, parse_amount, parse_number

# 每种模式可映射的目标字段（顺序 = 下拉项顺序）
FIELD_OPTIONS = {
    "holdings": [
        ("symbol", "代码"), ("name", "名称"), ("quantity", "数量/份额"),
        ("cost_price", "成本价"), ("current_price", "现价"), ("market_value", "市值"),
        ("pnl", "盈亏"), ("pnl_pct", "收益率"), ("ignore", "（忽略）"),
    ],
    "wealth": [
        ("name", "产品名"), ("amount", "金额"), ("cashflow", "净存入"),
        ("pnl", "收益"), ("yield", "收益率"), ("ignore", "（忽略）"),
    ],
    "flows": [
        ("date", "日期"), ("type", "类型"), ("amount", "金额"),
        ("balance", "余额"), ("note", "摘要"), ("ignore", "（忽略）"),
    ],
    "generic": [
        ("symbol", "代码"), ("name", "名称"), ("quantity", "数量/份额"),
        ("cost_price", "成本价"), ("current_price", "现价"), ("market_value", "市值"),
        ("ignore", "（忽略）"),
    ],
}

MODES = ["新建持仓", "更新已有持仓（按代码匹配）", "理财快照", "现金调整"]
MODE_SCHEMA = {
    "新建持仓": "holdings",
    "更新已有持仓（按代码匹配）": "holdings",
    "理财快照": "wealth",
    "现金调整": "flows",
}


class ReviewDialog(QDialog):
    def __init__(self, parse_result, backend, parent=None, default_mode: str = ""):
        super().__init__(parent)
        self.pr = parse_result
        self.backend = backend
        self.setWindowTitle("识别结果核对")
        self.setMinimumSize(880, 520)
        self.sources = []
        self.cash = []
        self.wealth = []
        try:
            self.sources = backend.list_sources()
            self.cash = backend.list_cash()
            self.wealth = backend.list_wealth()
        except BackendError as e:
            QMessageBox.warning(self, "后端连接失败", str(e))

        schema = parse_result.schema if parse_result.schema in FIELD_OPTIONS else "generic"
        self.fields = FIELD_OPTIONS[schema]

        lay = QVBoxLayout(self)

        # ---- 模式 ----
        row = QHBoxLayout()
        row.addWidget(QLabel("写入模式："))
        self.mode_box = QComboBox()
        self.mode_box.addItems(MODES)
        if default_mode in MODES:
            self.mode_box.setCurrentText(default_mode)
        elif parse_result.schema == "wealth":
            self.mode_box.setCurrentText("理财快照")
        self.mode_box.currentTextChanged.connect(self._on_mode)
        row.addWidget(self.mode_box, 1)
        self.schema_tag = QLabel(f"识别表结构：{parse_result.schema}"
                                 + ("（已识别表头）" if parse_result.header_detected else "（无表头，请手动映射）"))
        self.schema_tag.setObjectName("muted")
        row.addWidget(self.schema_tag)
        row.addStretch(1)
        lay.addLayout(row)

        # ---- 默认字段（持仓类模式可见）----
        self.def_row = QWidget()
        drow = QHBoxLayout(self.def_row)
        drow.setContentsMargins(0, 0, 0, 0)
        drow.addWidget(QLabel("来源"))
        self.src_box = QComboBox()
        for s in self.sources:
            self.src_box.addItem(f"{s.get('name')} (#{s.get('id')})", s.get("id"))
        drow.addWidget(self.src_box)
        drow.addWidget(QLabel("币种"))
        self.cur_box = QComboBox()
        self.cur_box.addItems(["cny", "usd", "hkd"])
        drow.addWidget(self.cur_box)
        drow.addWidget(QLabel("类别"))
        self.cat_box = QComboBox()
        self.cat_box.addItems(["stock", "fund"])
        drow.addWidget(self.cat_box)
        drow.addWidget(QLabel("市场"))
        self.mkt_box = QComboBox()
        self.mkt_box.addItems(["沪深", "美股", "港股", "QDII", "债券", "股票"])
        drow.addWidget(self.mkt_box)
        drow.addWidget(QLabel("资金子账户"))
        self.cash_box = QComboBox()
        self.cash_box.addItem("自动（余额最大）", 0)
        for c in self.cash:
            self.cash_box.addItem(f"{c.get('name')} [{c.get('currency')}]", c.get("id"))
        drow.addWidget(self.cash_box)
        drow.addStretch(1)
        lay.addWidget(self.def_row)

        # ---- 列映射 ----
        map_row = QHBoxLayout()
        map_row.addWidget(QLabel("列映射："))
        self.map_boxes = []
        for i, col_text in enumerate(parse_result.columns):
            cb = QComboBox()
            for key, label in self.fields:
                cb.addItem(f"第{i + 1}列[{col_text}]→{label}" if False else label, key)
            # 按表头文字自动猜一个字段
            guess = self._guess_field(col_text)
            if guess:
                cb.setCurrentIndex(max(0, cb.findData(guess)))
            map_row.addWidget(cb)
            self.map_boxes.append(cb)
        map_row.addStretch(1)
        lay.addLayout(map_row)

        # ---- 数据表 ----
        self.table = QTableWidget(0, len(parse_result.columns) + 1)
        self.table.setHorizontalHeaderLabels(parse_result.columns + ["状态"])
        for r, row_data in enumerate(parse_result.rows):
            self.table.insertRow(r)
            for c in range(len(parse_result.columns)):
                key = f"c{c}"
                val = row_data.get(key, "")
                self.table.setItem(r, c, QTableWidgetItem(str(val)))
            self.table.setItem(r, len(parse_result.columns), QTableWidgetItem("待提交"))
        lay.addWidget(self.table, 1)

        # ---- 按钮 ----
        btns = QHBoxLayout()
        btns.addStretch(1)
        self.submit_btn = QPushButton("提交到后端")
        self.submit_btn.setObjectName("primary")
        self.submit_btn.clicked.connect(self._submit)
        btns.addWidget(self.submit_btn)
        cancel = QPushButton("取消")
        cancel.clicked.connect(self.reject)
        btns.addWidget(cancel)
        lay.addLayout(btns)

        self._on_mode(self.mode_box.currentText())

    # ---------- helpers ----------
    def _guess_field(self, header_text: str):
        spec = SCHEMAS.get(MODE_SCHEMA.get(self.mode_box.currentText(), ""), {})
        for f, kws in spec.items():
            if any(kw in header_text for kw in kws):
                return f
        return None

    def _mapping(self) -> dict:
        """列序号 → 字段名。"""
        return {i: cb.currentData() for i, cb in enumerate(self.map_boxes)}

    def _on_mode(self, mode: str):
        holdings_like = mode in ("新建持仓", "更新已有持仓（按代码匹配）")
        self.def_row.setVisible(holdings_like)

    def _row_values(self, r: int) -> dict:
        m = self._mapping()
        out = {}
        for c, f in m.items():
            if f and f != "ignore":
                it = self.table.item(r, c)
                out[f] = it.text().strip() if it else ""
        return out

    # ---------- submit ----------
    def _submit(self):
        mode = self.mode_box.currentText()
        status_col = len(self.pr.columns)
        ok, fail = 0, 0
        try:
            if mode in ("新建持仓", "更新已有持仓（按代码匹配）"):
                ok, fail = self._submit_holdings(mode, status_col)
            elif mode == "理财快照":
                ok, fail = self._submit_wealth(status_col)
            elif mode == "现金调整":
                ok, fail = self._submit_cash(status_col)
        except BackendError as e:
            QMessageBox.critical(self, "写入失败", str(e))
            return
        self.statusBar_msg(f"完成：成功 {ok} 行，失败 {fail} 行")
        if ok and not fail:
            self.accept()

    def statusBar_msg(self, msg):
        QMessageBox.information(self, "提交结果", msg)

    def _submit_holdings(self, mode: str, status_col: int):
        ok = fail = 0
        for r in range(self.table.rowCount()):
            v = self._row_values(r)
            sym = (v.get("symbol") or "").strip()
            try:
                if mode == "新建持仓":
                    if not sym or not v.get("name"):
                        raise ValueError("缺少代码或名称")
                    holding = {
                        "symbol": sym, "name": v.get("name", ""),
                        "quantity": parse_number(v.get("quantity", "")) or 0,
                        "cost_price": parse_number(v.get("cost_price", "")) or 0,
                        "current_price": parse_number(v.get("current_price", "")) or 0,
                        "category": self.cat_box.currentText(),
                        "market": self.mkt_box.currentText(),
                        "currency": self.cur_box.currentText(),
                        "source_id": self.src_box.currentData(),
                    }
                    self.backend.create_holding(holding, int(self.cash_box.currentData() or 0))
                else:
                    h = self.backend.find_holding_by_symbol(sym)
                    if not h:
                        raise ValueError(f"后端未找到代码 {sym}")
                    upd = dict(h)
                    for f in ("quantity", "cost_price", "current_price"):
                        if v.get(f):
                            upd[f] = parse_number(v[f]) or upd.get(f, 0)
                    upd.pop("updated_at", None)
                    self.backend.update_holding(h["id"], upd)
                self.table.setItem(r, status_col, QTableWidgetItem("✓ 已写入"))
                ok += 1
            except (BackendError, ValueError) as e:
                self.table.setItem(r, status_col, QTableWidgetItem(f"✗ {e}"))
                fail += 1
        return ok, fail

    def _submit_wealth(self, status_col: int):
        name_to_id = {}
        for w in self.wealth:
            name_to_id[str(w.get("name", ""))] = w.get("id")
        items, ok, fail = [], 0, 0
        for r in range(self.table.rowCount()):
            v = self._row_values(r)
            name = (v.get("name") or "").strip()
            amt = parse_amount(v.get("amount", "") or "")
            wid = None
            for wn, wi in name_to_id.items():
                if name and (name in wn or wn in name):
                    wid = wi
                    break
            if wid is None or amt is None:
                self.table.setItem(r, status_col, QTableWidgetItem("✗ 未匹配产品或金额无效"))
                fail += 1
                continue
            items.append({
                "wealth_id": wid, "amount": amt,
                "cashflow": parse_amount(v.get("cashflow", "") or "") or 0,
                "cash_account_id": int(self.cash_box.currentData() or 0),
            })
            self.table.setItem(r, status_col, QTableWidgetItem("✓ 已写入"))
            ok += 1
        if items:
            self.backend.wealth_snapshots(datetime.now().strftime("%Y-%m-%d"), items)
        return ok, fail

    def _submit_cash(self, status_col: int):
        ok = fail = 0
        for r in range(self.table.rowCount()):
            v = self._row_values(r)
            amt = parse_amount(v.get("amount", "") or "")
            if amt is None or amt == 0:
                self.table.setItem(r, status_col, QTableWidgetItem("✗ 金额无效"))
                fail += 1
                continue
            self.backend.cash_adjust(int(self.cash_box.currentData() or 0), amt,
                                     v.get("note", "截图导入"))
            self.table.setItem(r, status_col, QTableWidgetItem("✓ 已写入"))
            ok += 1
        return ok, fail
