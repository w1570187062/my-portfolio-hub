# -*- coding: utf-8 -*-
"""金额文本解析：千分位歧义消解。

为什么需要这个
--------------
实测华泰持仓页 OCR 把 `102,114.46` 识别成 `102.114.46`、`70,019.95` 识别成
`70.019.95` —— **千分位逗号被当成小数点**。直接float() 会让10.2 万变成 102 元，
写入后端就是数据灾难。

消歧规则（按金融数值格式约定）
--------------------------
一个合法金额串里，小数点**最多出现一次**且必须伴随 1–2 位小数；千分位逗号
则每3 位分组。据此判定：

    "102.114.46"   → 两个点 → 必定是 [102,114.46] → 102114.46
    "70.019.95"    → 两个点 → 必定是 [70,019.95]   → 70019.95
    "1.234"        → 一个点 + 3 位小数（不合法）→ 千分位 → 1234
    "4.803.56"     → 两个点 → [4,803.56]          → 4803.56
    "102,114.46"   → 已正确 → 102114.46
    "0.85"         → 一个点 + 2 位小数（小数）    → 0.85
    "+19.94"       → 正常小数                     → 19.94
    "1,2345"       → 逗号后 4 位（非法分组）→ 当作小数点 → 1.2345

对仍有歧义的（如"1.234"既可读作1234 也可读作 1.234），按**券商惯例取大值**：
金额字段几乎总是 ≥ 1000，小数点误判会低估1000 倍，比高估更难发现。
调用方可用 `prefer_small=True` 反转该偏好（如解析收益率/百分比时）。
"""
from __future__ import annotations

import re
from typing import NamedTuple

# 数字 + 可选货币符号 + 千分位/小数点，允许 OCR 常见错字（O→0, l/I→1, S→5）
_DIGIT_MAP = str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1", "|": "1",
                            "S": "5", "s": "5", "B": "8", "，": ",", "．": "."})

_CURRENCY = "¥￥$＄€£"
_NUMCHARS = re.compile(r"[-+]?[\dOolI|SsB][\d,.\s]*")

# 纯金额（千分位歧义场景）
_AMOUNT_RE = re.compile(
    r"(?P<neg>[-−–])?\s*"
    r"(?P<cur>[" + _CURRENCY + r"])?\s*"
    r"(?P<body>[\d,.\s]+?)"
    r"\s*(?P<cur2>[" + _CURRENCY + r"]|元|美元|港元|港币|块)?\s*"
    r"(?P<sign>%)?"
)


class Amount(NamedTuple):
    value: float | None
    ok: bool                 # 是否成功解析出数字
    ambiguous: bool          # 是否做了启发式决策（点号歧义）
    had_currency: bool
    raw: str

    @property
    def money(self) -> float | None:
        """金额值（已是正确量级）。"""
        return self.value


def parse_money(s: str, prefer_small: bool = False) -> Amount:
    """解析金额，自动消解千分位/小数点歧义。返回 Amount（value=None 表示失败）。"""
    if s is None:
        return Amount(None, False, False, False, "")
    raw = str(s)
    t = raw.translate(_DIGIT_MAP).replace(" ", "").strip()
    if not t:
        return Amount(None, False, False, False, raw)

    neg = False
    if t[0] in "-−–":
        neg, t = True, t[1:]
    paren_neg = t.startswith("(") and t.endswith(")")
    if paren_neg:
        neg, t = True, t[1:-1]
    had_cur = any(c in raw for c in _CURRENCY) or re.search(r"元|美元|港元|港币", raw) is not None

    m = _NUMCHARS.search(t)
    if not m or not any(ch.isdigit() for ch in t):
        return Amount(None, False, False, had_cur, raw)
    body = m.group(0)

    value, ambiguous = _resolve_separators(body, prefer_small)
    if value is None:
        return Amount(None, False, False, had_cur, raw)
    if neg:
        value = -value
    return Amount(value, True, ambiguous, had_cur, raw)


def _resolve_separators(body: str, prefer_small: bool = False) -> tuple[float | None, bool]:
    """消解分隔符歧义。返回 (值, 是否启发式决策)。"""
    dots = body.count(".")
    commas = body.count(",")
    sign = -1.0 if body.startswith("-") else 1.0
    b = body.lstrip("+-")

    # --- 情形 1: 逗号与点同时存在 → 千分位逗号 + 小数点，无歧义
    if commas and dots:
        # 逗号必须按 3 位分组才合法
        norm = b.replace(",", "")
        try:
            return sign * float(norm), False
        except ValueError:
            pass
        # 分组合法性检查：逗号后必须是 3 位且后面跟 1-3 位数字组
        if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d{1,2})?", b):
            try:
                return sign * float(b.replace(",", "")), False
            except ValueError:
                pass
        # 不合法 → 逗号当小数点用（罕见）
        try:
            return sign * float(b.replace(",", "")), True
        except ValueError:
            return None, False

    # --- 情形 2: 只有一个逗号，无点
    if commas and not dots:
        if re.fullmatch(r"\d{1,3}(,\d{3})+", b):
            try:
                return sign * float(b.replace(",", "")), False
            except ValueError:
                pass
        # 逗号后不是 3 位 → 逗号是小数点（OCR 把 . 认成 ,）
        try:
            return sign * float(b.replace(",", ".")), True
        except ValueError:
            return None, False

    # --- 情形 3: 只有一个点，无逗号  ← 本次实测踩的就是这里
    if dots and not commas:
        parts = b.split(".")
        if len(parts) == 2:
            head, tail = parts
            if not head or not tail:
                return None, False
            if head.isdigit() and tail.isdigit():
                if len(tail) == 3:
                    # "102.114" → 三个尾数不可能是千分位中间段（缺最后一段），
                    # 券商金额惯例取大值：视为千分位 102114
                    joined = head + tail
                    v = float(joined)
                    return (sign * v / 100.0, True) if prefer_small else (sign * v, True)
                # 1–2 位小数 → 正常小数
                try:
                    return sign * float(b), False
                except ValueError:
                    return None, False
        # 多个点（本次实测：102.114.46）→ 最后一个点是真正的小数点，前面全是千分位
        if len(parts) >= 3 and all(p.isdigit() for p in parts):
            frac = parts[-1]
            head = parts[:-1]
            if 1 <= len(frac) <= 2 and 1 <= len(head[0]) <= 3:
                v = float("".join(head) + "." + frac)
                return sign * v, True
            # 全整数段拼接（无小数）→ 如 1.234.567
            try:
                return sign * float("".join(head) + frac), True
            except ValueError:
                return None, False
        return None, False

    # --- 情形 4: 无分隔符
    try:
        return sign * float(b), False
    except ValueError:
        return None, False


def parse_amount(s: str) -> float | None:
    """兼容旧接口：解析金额（含 万/亿 单位换算），失败返回 None。"""
    v = parse_money(s).value
    if v is None:
        return None
    t = str(s)
    if "亿" in t:
        v *= 1e8
    elif "万" in t:
        v *= 1e4
    return v


def parse_number(s: str) -> float | None:
    """百分比/普通数值解析（不做千分位放大，避免把 0.85 误判为 85）。"""
    if s is None:
        return None
    amt = parse_money(s, prefer_small=True)
    if not amt.ok:
        return None
    return amt.value


def parse_pct(s: str) -> float | None:
    v = parse_number(s)
    if v is None:
        return None
    t = str(s)
    if "万" in t:
        v *= 1e4
    return v