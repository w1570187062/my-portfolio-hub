# -*- coding: utf-8 -*-
"""券商 App「卡片式持仓页」解析。

背景
----
实测华泰 iOS App 持仓页**不是表格**，而是卡片流：

    ┌─────────────────────────────────────┐
    │ 鑫添益最短持有7天2号                 │   ← 产品名（可能跨行、被括号补充）
    │ 70,019.95        +19.94             │   ← 市值      累计收益
    │ 持有市值(元)      累计收益           │   ← 字段标签（说明数字含义）
    └─────────────────────────────────────┘
    ┌─────────────────────────────────────┐
    │ 中银理财-QDII日计划（美元版）       │
    │ 4,803.56  +312.07   +1.85           │
    │ 持有市值(美元) 累计收益 日收益(10-19)│   ← 三列，币种藏在标签里
    └─────────────────────────────────────┘

关键点：**数字的含义由同区域下方的文字标签决定**，而不是靠列位置。
所以解析策略是「先切卡片 → 卡内按 (x, y) 邻近配对 数字↔标签」。

分页/滚动
--------
单屏只显示 2–3 张卡，必须支持多屏叠加（见 merge_cards），
用产品名做去重键，保留后截到的（同一次采集内）。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .money import parse_money

# 「持有市值(美元)」这类标签 → 币种
_CUR_TAG = {
    "元": "cny", "人民币": "cny", "美元": "usd", "美金": "usd",
    "港元": "hkd", "港币": "hkd", "港": "hkd",
}
_LABEL_CUR_RE = re.compile(r"[（(]\s*(元|人民币|美元|美金|港元|港币)\s*[)）]")

# 字段标签关键词 → 规范字段名
# 注意：卡片切分靠「持有市值」类标签做锚点，所以这里的关键词必须**精确**，
# 不能用「资产」「市值」这种宽泛词 —— 实测「总资产>」「历史资产」「按持有市值」
# 都会被误判成 market_value 锚点，把页面切得稀碎。
_LABEL_MAP = [
    ("持有市值", "market_value"), ("参考市值", "market_value"), ("最新市值", "market_value"),
    ("累计收益", "pnl"), ("持有收益", "pnl"), ("浮动盈亏", "pnl"), ("盈亏", "pnl"),
    ("日收益", "daily_pnl"), ("当日收益", "daily_pnl"),
    ("持有份额", "quantity"), ("持仓数量", "quantity"), ("持有数量", "quantity"), ("份额", "quantity"),
    ("单位净值", "nav"), ("最新净值", "nav"), ("参考净值", "nav"), ("净值", "nav"),
    ("持仓成本", "cost_price"), ("成本价", "cost_price"), ("成本净值", "cost_price"),
    ("持仓收益率", "pnl_pct"), ("收益率", "pnl_pct"), ("年化", "yield_pct"),
]

# 状态栏/导航栏区域（按 1206×2622 实测，需按分辨率缩放）
_STATUS_BAR_RATIO = 0.065     # 顶部时间/电量/信号
_TABBAR_RATIO = 0.90          # 底部市场/自选/持仓导航
# 顶部深色横幅里的「持有市值(元)」是**汇总**不是卡片。
# 横幅实测延伸到 y≈840（0.32）；卡片区第一张卡名称在 y≈1530（0.58），
# 中间是「持有产品/全部/活钱管理」筛选栏。
_SUMMARY_BAND = 0.45     # parse_total 的取值上界（含日收益标签 y≈806）
_CARD_ANCHOR_MIN = 0.50  # 卡片锚点（持有市值标签）的下界，排除汇总横幅


@dataclass
class HoldingCard:
    """一张持仓卡片。"""
    name: str = ""
    market_value: float | None = None
    pnl: float | None = None
    daily_pnl: float | None = None
    quantity: float | None = None
    nav: float | None = None
    cost_price: float | None = None
    pnl_pct: float | None = None
    yield_pct: float | None = None
    currency: str = ""
    raw: dict = field(default_factory=dict)      # 字段 → 原始 OCR 文本
    confidence: float = 0.0
    box: tuple = (0, 0, 0, 0)                   # (x0, y0, x1, y1) 用于截图回显高亮
    warnings: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "name": self.name, "market_value": self.market_value, "pnl": self.pnl,
            "daily_pnl": self.daily_pnl, "quantity": self.quantity, "nav": self.nav,
            "cost_price": self.cost_price, "pnl_pct": self.pnl_pct,
            "yield_pct": self.yield_pct, "currency": self.currency,
            "raw": self.raw, "confidence": round(self.confidence, 3),
            "warnings": self.warnings,
        }


_NOISE_EXACT = {
    "全部", "活钱管理", "低波稳健", "订单记录", "历史资产", "我的定投",
    "市场", "自选", "持仓", "持有产品", "全部币种", "总资产", "总资产>",
    "按持有市值", "持有", "查看", "详情", "更多",
}
_NOISE_PREFIX = ("持有产品", "全部币种", "风险提示", "理财非存款", "市场", "自选")
_PAREN_FRAG = re.compile(r"^[（(][^）)]{0,12}[）)]$")
# 括号里只有币种/份额类别等修饰词时，它是名称的一部分而非独立块
_PAREN_MODIFIER = re.compile(r"^[（(](元|人民币|美元|美金|港元|港币|"
                             r"[A-Za-z]{1,4}版|[A-Z]{2,}版|[A-Za-z\s]{2,12})[）)]$",
                             re.IGNORECASE)


def _is_noise(text: str) -> bool:
    t = str(text).strip()
    if not t or len(t) <= 1:
        return True
    if t in _NOISE_EXACT:
        return True
    return any(t.startswith(p) for p in _NOISE_PREFIX)


def _is_name_suffix(text: str) -> bool:
    """'(美元版)' / '(美元)' 这类纯修饰括号内容 → 属于产品名的一部分。"""
    t = str(text).strip()
    if not _PAREN_FRAG.match(t):
        return False
    inner = t[1:-1].strip()
    return bool(re.fullmatch(r"元|人民币|美元|美金|港元|港币|[A-Za-z]{1,4}版",
                             inner, re.IGNORECASE))


def _label_field(text: str) -> tuple[str, str] | None:
    """把标签文本映射到 (字段名, 标签中携带的币种)。"""
    cur = ""
    m = _LABEL_CUR_RE.search(text)
    if m:
        cur = _CUR_TAG.get(m.group(1), "")
    t = text.replace("(", "").replace(")", "").replace("（", "").replace("）", "")
    for kw, fieldname in _LABEL_MAP:
        if kw in t:
            return fieldname, cur
    return None


def _is_numberish(text: str) -> bool:
    """是否是一个**纯数值文本块**。

    实测坑：不能只看"能否解析出数字"—— 产品名「鑫添益最短持有7天2号」、
    「中银理财-QDII日计划」都含数字，会被误判成数值块而被排除出名称候选。
    判据：去掉货币符号/正负号/千分位后，**数字字符占比 ≥ 80%** 且不含 CJK 汉字。
    """
    t = str(text).strip()
    if not t:
        return False
    if re.search(r"[\u4e00-\u9fff]", t):
        # 含汉字：只有「持有市值(元)」这类纯标签才当数字块，已由 _label_field 处理
        return False
    body = re.sub(r"[\s,.\-+()%¥￥$＄€£]", "", t)
    if not body:
        return False
    digits = sum(ch.isdigit() for ch in body)
    if digits == 0:
        return False
    if digits / len(body) >= 0.8:
        return parse_money(t).ok
    return False


def split_cards(items, img_h: int) -> list:
    """把 OCR 文本块按卡片边界切分。

    实测（华泰iOS 持仓页，1206×2622）：卡内行距 30–64px，卡间 134–178px。
    但卡内字段标签行（如「持有市值(元)」）与上一行数字也有 30–64px 间隙，
    与卡间差距不够大 → **单纯间隙阈值法会误判**（实测把每个文本行切成一块）。

    正确做法：以「市值类标签」为**结构锚点**切分，不依赖间隙：
    1. 收集所有 market_value 标签的 y（每张卡必有一个，实测无一例外）
    2. 每个锚点归属到「上方最近的非标签标题行」作为卡片名，锚点以下到下一个
       锚点（或免责声明/页面尾）之间的所有块属于这张卡
    3. 锚点上方的数字（紧贴标签上方、x 相近）也归入本卡
    """
    clean = []
    for it in items:
        box, text, score = it
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        y0, y1 = min(ys), max(ys)
        if y1 < img_h * _STATUS_BAR_RATIO or y0 > img_h * _TABBAR_RATIO:
            continue  # 状态栏 / 底部导航栏 → 噪音
        if not str(text).strip():
            continue
        clean.append({"x0": min(xs), "y0": y0, "x1": max(xs), "y1": y1,
                      "text": str(text).strip(), "conf": float(score)})
    if not clean:
        return []
    clean.sort(key=lambda c: c["y0"])

    anchors = []
    for c in clean:
        hit = _label_field(c["text"])
        # 顶部深色横幅里的「持有市值(元)」是**汇总**不是卡片，排除
        if hit and hit[0] == "market_value" and c["y0"] > img_h * _CARD_ANCHOR_MIN:
            anchors.append(c)
    if not anchors:
        return [clean]

    # 卡片底部：遇到免责声明/风险提示/底部导航类噪音即截断
    def _is_tail(b) -> bool:
        t = b["text"]
        return bool(re.search(r"风险|须谨慎|非存款|版权|©|用户协议", t))

    result = []
    # 免责声明/版权行之后的内容一律不属于卡片
    def _is_tail(b) -> bool:
        return bool(re.search(r"风险|须谨慎|非存款|版权|©|用户协议", b["text"]))

    tail_y = 1e9
    for b in clean:
        if _is_tail(b):
            tail_y = min(tail_y, b["y0"])

    for i, anc in enumerate(anchors):
        # 本卡下界：下一张卡的**名称行顶部**（不是锚点！实测下一卡名称
        # y=1913 远高于下一卡锚点 y=2090，用锚点会吞掉下一卡名字）。
        next_top = tail_y
        if i + 1 < len(anchors):
            nxt = anchors[i + 1]
            nxt_names = [
                b for b in clean
                if anc["y0"] < b["y1"] <= nxt["y0"]
                and not _is_numberish(b["text"])
                and not _is_noise(b["text"])
                and not _label_field(b["text"])
            ]
            # 本卡锚点之后、下一个锚点之前出现的名称行 = 下一卡的名称
            if nxt_names:
                next_top = min(b["y0"] for b in nxt_names)
            else:
                next_top = nxt["y0"]
        lower = min(next_top, tail_y)

        # 本卡上界与名称：锚点上方最近的非标签非数字非噪音行
        name_cands = [
            b for b in clean
            if b["y1"] <= anc["y0"]
            and not _is_noise(b["text"])
            and not _is_numberish(b["text"])
            and not _label_field(b["text"])
        ]
        block = []
        if name_cands:
            top_name = max(name_cands, key=lambda b: b["y1"])
            # 名称所在行 + 同行的括号补充（如"(美元版)"）
            row = [b for b in clean
                   if abs(b["y0"] - top_name["y0"]) < 30
                   and b["y0"] <= anc["y0"] + 4
                   and not _is_numberish(b["text"]) and not _is_noise(b["text"])
                   and not _label_field(b["text"])]
            if not row:
                row = [top_name]
            block += row
            # 上界取**名称行的 y0**，不能取 row 的最小值：
            # 实测筛选 chip（全部/活钱管理/低波稳健）虽被判为噪音，
            # 但它们与名称同处一个粗切块内，会把 upper 拉到筛选栏高度。
            upper = top_name["y0"]
        else:
            upper = anc["y0"] - 400

        # 卡片主体：整段区间内的块
        for b in clean:
            if upper - 5 <= b["y0"] < lower:
                block.append(b)

        # 去重
        uniq, seen = [], set()
        for b in sorted(block, key=lambda z: (z["y0"], z["x0"])):
            k = (round(b["y0"]), round(b["x0"]), b["text"])
            if k not in seen:
                seen.add(k)
                uniq.append(b)
        if uniq:
            result.append(uniq)
    return result


def parse_card(blocks: list) -> HoldingCard | None:
    """解析单张卡片：名称 + 数字与标签的邻近配对。"""
    if not blocks:
        return None
    texts = [b["text"] for b in blocks]
    # 过滤干扰行：分类/导航/按钮/免责声明
    blocks = [b for b in blocks if not _is_noise(b["text"])]
    if not blocks:
        return None

    card = HoldingCard()
    # 卡片外框
    card.box = (min(b["x0"] for b in blocks), min(b["y0"] for b in blocks),
                max(b["x1"] for b in blocks), max(b["y1"] for b in blocks))

    # 标签块：能映射到字段名的
    label_pos = []
    for b in blocks:
        hit = _label_field(b["text"])
        if hit:
            label_pos.append((b, hit[0], hit[1]))

    # 名称：块内**最靠上**的文本行（split_cards 已把区间上界定在名称行）
    name_parts = [b for b in blocks if not _is_numberish(b["text"]) and not _label_field(b["text"])]
    if name_parts:
        top = min(b["y0"] for b in name_parts)
        head = [b for b in name_parts if b["y0"] <= top + 30]
        head.sort(key=lambda b: b["x0"])
        card.name = "".join(b["text"] for b in head).strip()
        card.confidence = sum(b["conf"] for b in head) / len(head)

    # 数字 ↔ 标签 配对：按 x 重叠优先，其次按 y 距离
    numbers = [b for b in blocks if _is_numberish(b["text"])]
    used = set()
    for lb, fieldname, cur in label_pos:
        best, best_score = None, -1e9
        for nb in numbers:
            if id(nb) in used:
                continue
            xov = min(lb["x1"], nb["x1"]) - max(lb["x0"], nb["x0"])
            xov_ratio = xov / max(1e-6, min(lb["x1"] - lb["x0"], nb["x1"] - nb["x0"]))
            dy = abs(nb["y0"] - lb["y1"])
            sc = xov_ratio * 2.0 - dy / 60.0
            if xov_ratio > 0.15 and sc > best_score:
                best, best_score = nb, sc
        if best is None:
            continue
        used.add(id(best))
        amt = parse_money(best["text"])
        if not amt.ok:
            continue
        setattr(card, fieldname, amt.value)
        card.raw[fieldname] = best["text"]
        if cur and not card.currency:
            card.currency = cur
        if amt.ambiguous:
            card.warnings.append(f"{fieldname}={best['text']!r} 千分位/小数点歧义已按惯例判定为 {amt.value:,.2f}")
    if not card.currency:
        # 从产品名里的括号兜底
        m = _LABEL_CUR_RE.search(card.name)
        if m:
            card.currency = _CUR_TAG.get(m.group(1), "")
    if card.name and card.market_value is None:
        card.warnings.append("未识别到持有市值，请人工确认")
    return card


def looks_like_card(card: HoldingCard | None) -> bool:
    """是否是一张真卡片：有名称，且至少有市值或收益字段。

    实测坑：免责声明「理财非存款。产品有风险。投资须谨慎」会被当成产品名，
    它不含任何市值/收益标签 → 用本判据挡掉。
    """
    if card is None or not card.name:
        return False
    if card.market_value is not None:
        return True
    return any(getattr(card, f) is not None for f in ("pnl", "daily_pnl", "quantity", "nav"))


def parse_holdings_cards(items, img_h: int) -> list:
    """整页解析入口。items = [(box, text, score), ...]"""
    out = []
    for blocks in split_cards(items, img_h):
        c = parse_card(blocks)
        if looks_like_card(c):
            out.append(c)
    return out


def merge_cards(groups: list) -> list:
    """合并多屏采集结果，按产品名去重（后截到的覆盖先前的）。"""
    seen = {}
    for g in groups:
        for c in g:
            key = re.sub(r"\s+", "", c.name)
            if key in seen:
                old = seen[key]
                # 补齐先前缺失的字段
                for f in ("market_value", "pnl", "daily_pnl", "quantity", "nav"):
                    if getattr(old, f) is None and getattr(c, f) is not None:
                        setattr(old, f, getattr(c, f))
                old.warnings.extend(c.warnings)
            else:
                seen[key] = c
    return list(seen.values())


def parse_total(items, img_h: int) -> dict:
    """抓页面顶部的汇总值（总持有市值 / 日收益）。

    实测版式（华泰）：
        y≈492  102.114.46          ← 数字
        y≈600  持有市值(元)          ← 标签（在数字**下方**）
        y≈724  +19.01
        y≈806  日收益(10-19)         ← 标签（在数字**下方**）

    标签在数字下方 → 按 x 对齐、y 向上找最近数字即可。
    坑：日收益标签的 y 距离市值标签 200px+，若不限定 x 范围会把总市值抢走
    → 必须要求 x 起点与标签对齐（±60px）。
    """
    out = {"market_value": None, "daily_pnl": None, "currency": ""}
    blocks = []
    for box, text, score in items:
        ys = [float(p[1]) for p in box]
        xs = [float(p[0]) for p in box]
        y0, y1 = min(ys), max(ys)
        if not (img_h * 0.06 < y0 < img_h * _SUMMARY_BAND):
            continue
        blocks.append({"x0": min(xs), "y0": y0, "x1": max(xs), "y1": y1,
                       "text": str(text).strip(), "conf": float(score)})

    # 数值块：顶部的数字字号大且不带 CJK，用 _is_numberish 已能过滤
    numbers = [b for b in blocks if _is_numberish(b["text"])]
    labels = [b for b in blocks if _label_field(b["text"])]
    for lb in labels:
        fieldname, cur = _label_field(lb["text"])
        if fieldname not in out or out[fieldname] is not None:
            continue
        # 标签**上方**的数字。x 起点对齐（±60px）+ 纵向最近。
        # 关键：不能用 max(y1) 取"最上面那个"——`日收益(10-19)` 上方最近的是
        # `+19.01`，若按 y 排序取错会拿到 `102.114.46`（实测踩过）。
        cand = [nb for nb in numbers
                if 0 < lb["y0"] - nb["y1"] < 300
                and abs(nb["x0"] - lb["x0"]) < 60]
        if not cand:
            continue
        # 距离标签越近越优先
        cand.sort(key=lambda b: lb["y0"] - b["y1"])
        amt = parse_money(cand[0]["text"])
        if amt.ok:
            out[fieldname] = amt.value
            if cur and not out["currency"]:
                out["currency"] = cur
    return out