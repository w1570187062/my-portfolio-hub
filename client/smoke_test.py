# -*- coding: utf-8 -*-
"""冒烟测试：不依赖真机/真后端，验证核心链路。

运行：python smoke_test.py
覆盖：
  1. RTP/H.264 解包（单 NAL + FU-A 重组）
  2. 表格解析（模拟 OCR 盒 → 行 → 表头映射）
  3. 数字/金额/百分比解析
  4. 引导状态机推进
  5. OCR 引擎真实推理（合成持仓表截图 → parse_columns）
  6. 主窗口无头实例化（QT_QPA_PLATFORM=offscreen）
"""
import os
import struct
import sys

# 环境里有残缺的全局 PIL（PYTHONPATH 指向 D:\Chenyifei\SDK\python），
# 会遮蔽 venv 依赖：把当前解释器的 purelib 提到 sys.path 最前。
import sysconfig
_site = sysconfig.get_paths()["purelib"]
if sys.path and sys.path[0] != _site:
    sys.path.insert(0, _site)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAILED = []


def check(name, cond, detail=""):
    tag = "PASS" if cond else "FAIL"
    print(f"[{tag}] {name} {detail}")
    if not cond:
        FAILED.append(name)


# ---------- 1. RTP ----------
def test_rtp():
    from client.capture.rtp_h264 import RtpH264Depacketizer

    def rtp(payload: bytes, marker: bool = True) -> bytes:
        b0 = 0x80
        b1 = (0x80 if marker else 0x00) | 96
        return struct.pack(">BBHII", b0, b1, 1, 1000, 0x1234) + payload

    dep = RtpH264Depacketizer()
    nal = bytes([0x65, 0xAA, 0xBB])  # IDR
    au = dep.feed(rtp(nal))
    check("RTP 单NAL", au == b"\x00\x00\x00\x01" + nal, f"got={au!r}")

    # FU-A: 拆成 3 片
    dep2 = RtpH264Depacketizer()
    big = bytes([0x41, 0x00, 0x01, 0x02, 0x03])
    fu_start = bytes([0x7C, (1 << 7) | 5]) + big[:2]
    fu_mid = bytes([0x7C, 5]) + big[2:3]
    fu_end = bytes([0x7C, (1 << 6) | 5]) + big[3:]
    r1 = dep2.feed(rtp(fu_start, marker=False))
    r2 = dep2.feed(rtp(fu_mid, marker=False))
    r3 = dep2.feed(rtp(fu_end, marker=True))
    expect = b"\x00\x00\x00\x01" + bytes([0x65]) + big
    check("RTP FU-A重组", r1 is None and r2 is None and r3 == expect, f"got={r3!r}")


# ---------- 2. 表格解析 ----------
def test_table():
    from client.models import Column
    from client.ocr.table import parse_columns

    # 模拟一张持仓表：表头 + 2 行数据
    cells = [
        # 表头 y=10
        ("股票代码", 10, 10), ("名称", 120, 10), ("持仓数量", 220, 10), ("参考市值", 340, 10), ("盈亏", 440, 10),
        # 行1 y=60
        ("600519", 10, 60), ("贵州茅台", 120, 60), ("100", 220, 60), ("15,800.00", 340, 60), ("+2,300.50", 440, 60),
        # 行2 y=110
        ("000858", 10, 110), ("五粮液", 120, 110), ("200", 220, 110), ("25,600.00", 340, 110), ("-1,200.00", 440, 110),
    ]
    cols = []
    for text, x, y in cells:
        w = 14 * len(text)
        cols.append(Column(text=text, x0=x, y0=y, x1=x + w, y1=y + 20))
    pr = parse_columns(cols)
    check("表结构识别", pr.schema == "holdings", f"schema={pr.schema}")
    check("表头识别", pr.header_detected, f"idx={pr.header_row_idx}")
    check("行数", len(pr.rows) == 2, f"rows={len(pr.rows)}")
    if pr.rows:
        r0 = pr.rows[0]
        check("字段映射(symbol)", r0.get("symbol") == "600519", f"{r0.get('symbol')}")
        check("字段映射(name)", r0.get("name") == "贵州茅台", f"{r0.get('name')}")
        check("字段映射(market_value)", r0.get("market_value") == "15,800.00", f"{r0.get('market_value')}")
        check("字段映射(pnl)", r0.get("pnl") == "+2,300.50", f"{r0.get('pnl')}")


# ---------- 3. 数字解析 ----------
def test_numbers():
    from client.ocr.table import parse_amount, parse_number, parse_pct
    check("数字-千分位", parse_number("1,234.56") == 1234.56)
    check("数字-括号负", parse_number("(12.3)") == -12.3)
    check("金额-万", parse_amount("1.5万") == 15000.0)
    check("金额-亿", parse_amount("2亿") == 2e8)
    check("百分比", parse_pct("-1.23%") == -1.23)
    check("非数字", parse_number("--") is None)


# ---------- 4. 引导 ----------
def test_guide():
    from client.flow.guide import GuideRunner
    g = GuideRunner("holdings_init")
    events = []
    g.on_step = lambda i, s: events.append(("step", i, s.id))
    captured = []
    g.on_capture = lambda schema, s: captured.append(schema)
    # 持仓列表页文本：同时命中 step0(资产/持仓) 与 step1(持仓/市值) → 前进到采集步并触发
    g.feed_text("总资产 128.5万 持仓 市值")
    check("引导-前进到采集步", g.idx == 2, f"idx={g.idx}")
    check("引导-采集触发一次", captured == ["holdings"], f"captured={captured}")
    # 再次喂同一页面（防循环）：不应重复触发
    g.feed_text("总资产 128.5万 持仓 市值")
    check("引导-防重复触发", captured == ["holdings"], f"captured={captured}")
    check("引导-步骤回调", ("step", 1, "holdings_page") in events and ("step", 2, "capture_holdings") in events, f"{events}")
    g.advance()
    check("引导-手动下一步到核对", g.idx == 3, f"idx={g.idx}")


# ---------- 5. 真实 OCR ----------
def test_ocr_e2e():
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        check("OCR端到端", False, "pillow 未安装")
        return
    import tempfile

    font_path = "C:/Windows/Fonts/msyh.ttc"
    if not os.path.exists(font_path):
        check("OCR端到端", True, "跳过（无中文字体）")
        return
    font = ImageFont.truetype(font_path, 22)
    img = Image.new("RGB", (900, 420), "white")
    d = ImageDraw.Draw(img)
    rows = [
        ["股票代码", "名称", "持仓数量", "参考市值", "盈亏"],
        ["600519", "贵州茅台", "100", "15,800.00", "+2,300.50"],
        ["000858", "五粮液", "200", "25,600.00", "-1,200.00"],
    ]
    y = 20
    for row in rows:
        x = 20
        for cell in row:
            d.text((x, y), cell, fill="black", font=font)
            x += 170
        y += 80
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        img.save(f.name)
        path = f.name
    try:
        from client.ocr.engine import items_to_columns, run_ocr
        from client.ocr.table import parse_columns
        items = run_ocr(path)
        cols = items_to_columns(items)
        pr = parse_columns(cols)
        check("OCR端到端-表结构", pr.schema == "holdings", f"schema={pr.schema}")
        check("OCR端到端-行数", len(pr.rows) >= 2, f"rows={len(pr.rows)}")
        syms = [r.get("symbol") for r in pr.rows]
        check("OCR端到端-代码", "600519" in syms, f"syms={syms}")
    finally:
        os.unlink(path)


# ---------- 6. 无头 GUI ----------
def test_gui_headless():
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    try:
        from PySide6.QtWidgets import QApplication
        from client.ui.main_window import MainWindow
        app = QApplication.instance() or QApplication([])
        w = MainWindow()
        check("GUI无头实例化", w.step_title.text().startswith("1."), w.step_title.text())
        w.close()
    except Exception as e:
        check("GUI无头实例化", False, repr(e))


if __name__ == "__main__":
    test_rtp()
    test_table()
    test_numbers()
    test_guide()
    test_ocr_e2e()
    test_gui_headless()
    print()
    if FAILED:
        print(f"FAILED: {len(FAILED)} -> {FAILED}")
        sys.exit(1)
    print("ALL PASS")
