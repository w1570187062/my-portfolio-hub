# -*- coding: utf-8 -*-
"""表格解析：OCR 文本块 → 行 → 列 → 按字段名映射。

设计目标：券商 App 截图版式不固定，因此不写死列序——
先在前 3 行中找「表头行」（含 ≥2 个字段关键词），按表头文字映射字段；
找不到表头时退化为 c0..cN 序号列，交给人工在审核界面映射。
"""
from __future__ import annotations

import re

from ..models import Column, ParseResult

# 每种业务表结构的字段 → 表头关键词
SCHEMAS = {
    "holdings": {
        "symbol": ["代码", "证券代码", "基金代码", "股票代码"],
        "name": ["名称", "产品名称", "股票名称", "基金名称"],
        "quantity": ["持仓", "数量", "份额", "持有", "股数"],
        "cost_price": ["成本价", "摊薄成本", "买入价", "成交价"],
        "current_price": ["现价", "市价", "最新价", "净值"],
        "market_value": ["市值", "参考市值", "总额", "资产"],
        "pnl": ["盈亏", "收益", "浮动盈亏"],
        "pnl_pct": ["收益率", "盈亏比例", "涨跌幅", "涨幅"],
    },
    "wealth": {
        "name": ["产品", "名称", "基金"],
        "amount": ["金额", "本金", "市值", "持有金额"],
        "pnl": ["收益", "盈亏", "累计收益"],
        "yield": ["年化", "七日", "收益率"],
        "cashflow": ["存入", "净存入", "赎回"],
    },
    "flows": {
        "date": ["日期", "时间", "交易日期"],
        "type": ["类型", "方向", "业务", "摘要类型"],
        "amount": ["金额", "发生额", "交易金额"],
        "balance": ["余额", "可用"],
        "note": ["摘要", "说明", "备注", "对方"],
    },
}

_NUM_RE = re.compile(r"[-+(]?[\d,]+(?:\.\d+)?\)?%?")


def parse_number(s: str):
    """'1,234.56' / '(12.3)' / '-5%' → float 或 None。"""
    if s is None:
        return None
    t = str(s).strip().replace(",", "").replace("¥", "").replace("￥", "").replace("$", "")
    if not t:
        return None
    neg = False
    if t.startswith("(") and t.endswith(")"):
        neg = True
        t = t[1:-1]
    if t.endswith("%"):
        t = t[:-1]
    try:
        v = float(t)
    except ValueError:
        m = _NUM_RE.search(t)
        if not m:
            return None
        try:
            v = float(m.group(0).strip("()").rstrip("%"))
        except ValueError:
            return None
    return -v if neg else v


def parse_amount(s: str):
    """带 万/亿 单位的金额 → float。"""
    v = parse_number(s)
    if v is None:
        return None
    t = str(s)
    if "亿" in t:
        v *= 1e8
    elif "万" in t:
        v *= 1e4
    return v


def parse_pct(s: str):
    v = parse_number(s)
    if v is None:
        return None
    t = str(s)
    if "万" in t:
        v *= 1e4
    return v


def rows_from_columns(cols: list, y_tol: float | None = None) -> list:
    """按纵向聚类把文本块分成行，行内按 x 排序。"""
    if not cols:
        return []
    cols = sorted(cols, key=lambda c: c.cy)
    if y_tol is None:
        hs = sorted(c.h for c in cols)
        y_tol = max(8.0, hs[len(hs) // 2] * 0.6)
    rows, cur = [], [cols[0]]
    for c in cols[1:]:
        ref = sum(x.cy for x in cur) / len(cur)
        if abs(c.cy - ref) <= y_tol:
            cur.append(c)
        else:
            rows.append(sorted(cur, key=lambda x: x.x0))
            cur = [c]
    rows.append(sorted(cur, key=lambda x: x.x0))
    return rows


def detect_schema(text: str) -> str:
    best, best_hits = "generic", 0
    for schema, spec in SCHEMAS.items():
        hits = sum(1 for kws in spec.values() for kw in kws if kw in text)
        if hits > best_hits:
            best, best_hits = schema, hits
    return best if best_hits >= 2 else "generic"


def parse_columns(cols: list) -> ParseResult:
    rows = rows_from_columns(cols)
    row_texts = [" ".join(c.text for c in r) for r in rows]
    full = "\n".join(row_texts)
    schema = detect_schema(full)
    spec = SCHEMAS.get(schema, {})

    # 表头识别：前 3 行中含 >=2 个字段关键词
    header_idx, field_map = -1, {}
    for i, r in enumerate(rows[:3]):
        m, hits = {}, 0
        for f, kws in spec.items():
            for j, c in enumerate(r):
                if any(kw in c.text for kw in kws):
                    m[f] = j
                    hits += 1
                    break
        if hits >= 2:
            header_idx, field_map = i, m
            break

    parsed = []
    if header_idx >= 0:
        header_texts = [c.text for c in rows[header_idx]]
        for r in rows[header_idx + 1:]:
            d = {}
            for f, j in field_map.items():
                if j < len(r):
                    d[f] = r[j].text
            if any(v and v.strip() for v in d.values()):
                parsed.append(d)
        columns = header_texts
    else:
        n = max((len(r) for r in rows), default=0)
        columns = [f"c{i}" for i in range(n)]
        for r in rows:
            d = {f"c{i}": (r[i].text if i < len(r) else "") for i in range(n)}
            parsed.append(d)

    return ParseResult(
        schema=schema,
        columns=columns,
        rows=parsed,
        text=full,
        header_detected=header_idx >= 0,
        header_row_idx=header_idx,
        items=cols,
    )
