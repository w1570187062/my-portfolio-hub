# -*- coding: utf-8 -*-
"""千分位消歧解析器测试。

首批用例全部来自 2026-10-20 实测：华泰持仓页OCR 把千分位逗号认成句点。
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from client.envfix import repair_environment  # noqa: E402

repair_environment()

from client.ocr.money import parse_amount, parse_money, parse_number  # noqa: E402

# (输入, 期望值, 说明)
CASES_MONEY = [
    # ---- 实测真机OCR 输出（原图确实是逗号）----
    ("102.114.46", 102114.46, "实测总市值：逗号被认成点"),
    ("70.019.95", 70019.95, "实测鑫添益持有市值"),
    ("4.803.56", 4803.56, "实测中银 QDII 持有市值"),
    # ---- 正常千分位（OCR 认对了）----
    ("102,114.46", 102114.46, "标准千分位"),
    ("70,019.95", 70019.95, "标准千分位"),
    ("1,234.56", 1234.56, "标准千分位"),
    ("4,803.56", 4803.56, "标准千分位"),
    # ---- 真实小数（不能被放大）----
    ("0.85", 0.85, "净值/份额"),
    ("19.94", 19.94, "收益"),
    ("+312.07", 312.07, "累计收益带加号"),
    ("1.2345", 1.2345, "四位小数（行情价格）"),
    ("0.0001", 0.0001, "极小值"),
    # ---- 符号 ----
    ("-1,234.56", -1234.56, "负数千分位"),
    ("(1,234.56)", -1234.56, "会计括号负数"),
    ("+19.01", 19.01, "日收益"),
    # ---- OCR 常见错字 ----
    ("1O2,1I4.46", 102114.46, "字母 O/I 误认"),
    ("1，234.56", 1234.56, "全角逗号"),
    ("102．114", 102114.0, "全角句点作千分位"),
    # ---- 货币与单位 ----
    ("¥1,234.56", 1234.56, "带货币符号"),
    ("$4,803.56", 4803.56, "美元"),
    # ---- 无效输入 ----
    ("", None, "空串"),
    ("—", None, "破折号"),
    ("--", None, "双横线"),
    ("暂无", None, "中文占位"),
]

CASES_NUMBER = [
    ("0.85", 0.85, "小数优先模式不应被放大"),
    ("102.114.46", 102114.46, "多点仍能正确拼接"),
    ("12.34%", 12.34, "百分比"),
    ("-5%", -5.0, "负百分比"),
]


def run() -> int:
    fails = 0
    print("=== parse_money（金额，千分位歧义消解）===")
    for src, want, why in CASES_MONEY:
        got = parse_money(src).value
        ok = (got is None and want is None) or (
            got is not None and want is not None and abs(got - want) < 0.005)
        if not ok:
            fails += 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {src!r:18s} → {got!r:14s} "
              f"(期望 {want!r}) {why}")

    print("\n=== parse_number（普通数值，小数优先）===")
    for src, want, why in CASES_NUMBER:
        got = parse_number(src)
        ok = got is not None and abs(got - want) < 0.005
        if not ok:
            fails += 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {src!r:18s} → {got!r:14s} "
              f"(期望 {want!r}) {why}")

    print("\n=== parse_amount 兼容接口（万/亿换算）===")
    for src, want, why in [("1.5万", 15000.0, "万单位"), ("2.38亿", 238000000.0, "亿单位")]:
        got = parse_amount(src)
        ok = got is not None and abs(got - want) < 1
        if not ok:
            fails += 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {src!r:18s} → {got!r:14s} "
              f"(期望 {want!r}) {why}")

    print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(run())