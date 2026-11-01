#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 pnl_daily 里的美股条目整体前移到它所属的交易日（2026-11-01）。

背景
----
旧口径把「北京日期 D 的快照」整行记在 D，但美股在北京时间凌晨才收盘：
D 日白天的现价其实是美东 D−1 的收盘价。于是周五夜盘（北京周六凌晨收盘）被记到了
周六那一格，日历上永远比券商对账单右移一天（实盘：10-30 格 −201.60，
其中美股是美东 10-29 的；美东 10-30 那批 +98.60 落在 10-31 格）。

新口径（doSnapshot 已同步改）
--------------------------
美股条目归属「美东交易日」= 北京日期往前一个工作日；A股/基金/港股仍留在当天。

本脚本做的事
----------
逐行读取 pnl_daily.detail.by_symbol，把属于美股的条目搬到目标日期那一行
（目标行原有的美股条目整组替换），A股/基金条目原地不动，然后按剩余条目重算
total_cny / total_usd / detail 的三个小计。

安全性
------
- 执行前先用 VACUUM INTO 生成一份完整备份（同目录 backup-*.db），失败即中止。
- 幂等：跑完在 meta 表写 us_pnl_date_shift=1，重复执行直接退出（--force 可强制）。
- --dry-run 只打印将要发生的变化，不写库。
- 全 0 的美股批次不搬（周末 staleness 保护的产物），避免把上一个交易日的
  非零值覆盖成 0。

用法
----
  python3 scripts/migrate_us_pnl_shift.py --db /path/portfolio.db --dry-run
  python3 scripts/migrate_us_pnl_shift.py --db /path/portfolio.db
"""

import argparse
import datetime as dt
import json
import os
import shutil
import sqlite3
import sys

MARKER = "us_pnl_date_shift"


def us_target_date(date_str):
    """北京日期 D 的快照里，美股盈亏应归属的日期：D 之前的最近一个工作日。"""
    d = dt.date.fromisoformat(date_str) - dt.timedelta(days=1)
    for _ in range(7):
        if d.weekday() < 5:  # 0=周一 … 4=周五
            break
        d -= dt.timedelta(days=1)
    return d.isoformat()


def load_holdings(conn):
    """symbol -> (market, category)。含已清仓持仓，供老 detail（无 market 字段）反查。"""
    out = {}
    try:
        rows = conn.execute("SELECT symbol, market, category FROM holdings").fetchall()
    except sqlite3.Error:
        return out
    for sym, market, category in rows:
        if sym:
            out[sym] = (market or "", category or "")
    return out


def parse_entries(detail):
    if not detail:
        return []
    try:
        obj = json.loads(detail)
    except (ValueError, TypeError):
        return []
    entries = obj.get("by_symbol") or []
    return [e for e in entries if isinstance(e, dict)]


def is_us(entry, holdings):
    mkt = entry.get("market") or ""
    if mkt:
        return mkt == "美股"
    sym = entry.get("symbol") or ""
    return holdings.get(sym, ("", ""))[0] == "美股"


def enrich(entry, holdings):
    """给老条目补 market / category，迁移后格式统一，后续判断不必再反查。"""
    mkt, cat = holdings.get(entry.get("symbol") or "", ("", ""))
    if not entry.get("market") and mkt:
        entry["market"] = mkt
    if not entry.get("category") and cat:
        entry["category"] = cat
    return entry


def entry_usd(entry):
    return (entry.get("currency") or "").strip().upper() in ("USD", "$")


def build_detail(entries):
    by_cat = {"stock": 0.0, "fund": 0.0}
    by_cur = {"CNY": 0.0, "USD": 0.0, "HKD": 0.0}
    for e in entries:
        cat = e.get("category") or "stock"
        by_cat[cat] = by_cat.get(cat, 0.0) + float(e.get("pnl") or 0)
        cur = (e.get("currency") or "").strip().upper()
        if cur in ("USD", "$"):
            key = "USD"
        elif cur in ("HKD", "HK$"):
            key = "HKD"
        else:
            key = "CNY"
        by_cur[key] += float(e.get("pnl") or 0)
    return json.dumps(
        {
            "by_category": {"stock": round(by_cat.get("stock", 0.0), 2), "fund": round(by_cat.get("fund", 0.0), 2)},
            "by_currency": {
                "CNY": round(by_cur["CNY"], 2),
                "USD": round(by_cur["USD"], 2),
                "HKD": round(by_cur["HKD"], 2),
            },
            "by_symbol": entries,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def totals(entries):
    cny = round(sum(float(e.get("pnl_cny") or 0) for e in entries), 2)
    usd = round(sum(float(e.get("pnl") or 0) for e in entries if entry_usd(e)), 2)
    return cny, usd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="portfolio.db 路径")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="忽略已迁移标记，强制再跑一次")
    ap.add_argument("--no-backup", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        sys.exit("数据库文件不存在: " + args.db)

    conn = sqlite3.connect(args.db, timeout=30)
    conn.row_factory = sqlite3.Row

    if not args.force:
        try:
            row = conn.execute("SELECT value FROM meta WHERE key=?", (MARKER,)).fetchone()
            if row and row["value"] == "1":
                print("已迁移过（meta.%s=1），跳过。需要重跑请加 --force" % MARKER)
                return
        except sqlite3.Error:
            pass

    if not args.dry_run and not args.no_backup:
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = os.path.join(os.path.dirname(os.path.abspath(args.db)), "portfolio.db.bak-us-shift-" + stamp)
        conn.execute("VACUUM INTO ?", (bak,))
        print("已备份 ->", bak)

    holdings = load_holdings(conn)
    rows = conn.execute(
        "SELECT date,user_id,total_cny,total_usd,rate,base_cny,detail FROM pnl_daily ORDER BY date ASC, user_id ASC"
    ).fetchall()

    # 1) 按用户收集：每一行的非美股条目 + 美股条目按目标日期归堆
    rest_by_row = {}      # (user, date) -> [entry]（非美股，原样保留）
    us_pool = {}          # (user, target_date) -> [entry]（取日期最大的非零批次）
    base_by_row = {}      # (user, date) -> (rate, base_cny)
    old_total = {}        # (user, date) -> (total_cny, total_usd)
    for r in rows:
        key = (r["user_id"], r["date"])
        entries = [enrich(e, holdings) for e in parse_entries(r["detail"])]
        rest = [e for e in entries if not is_us(e, holdings)]
        us = [e for e in entries if is_us(e, holdings)]
        rest_by_row[key] = rest
        base_by_row[key] = (r["rate"], r["base_cny"])
        old_total[key] = (r["total_cny"], r["total_usd"])
        if us:
            # 全 0 批次不参与搬运（staleQuote 的产物，搬过去会把已有非零值抹平）
            if round(sum(float(e.get("pnl") or 0) for e in us), 2) != 0:
                us_pool[(r["user_id"], us_target_date(r["date"]))] = us

    # 2) 组装新行：原非美股 + 本该落在这一天的美股
    new_rows = {}
    for key, rest in rest_by_row.items():
        new_rows[key] = rest + us_pool.get(key, [])
    for key, us in us_pool.items():
        if key not in new_rows:  # 目标日原来没有行（历史缺口）→ 新建
            new_rows[key] = us

    # 3) 打印 & 写回
    changed = 0
    print("\n%-12s %-4s %12s %12s %10s" % ("日期", "uid", "原 total_cny", "新 total_cny", "差额"))
    for key in sorted(new_rows):
        user_id, date = key
        entries = new_rows[key]
        cny, usd = totals(entries)
        old_cny, old_usd = old_total.get(key, (0.0, 0.0))
        if abs(cny - (old_cny or 0)) < 0.005 and key in old_total:
            continue
        changed += 1
        print("%-12s %-4s %12.2f %12.2f %10.2f" % (date, user_id, old_cny or 0, cny, cny - (old_cny or 0)))
        if args.dry_run:
            continue
        rate, base_cny = base_by_row.get(key, (None, None))
        if rate is None:
            rate = conn.execute(
                "SELECT rate FROM pnl_daily WHERE user_id=? ORDER BY date DESC LIMIT 1", (user_id,)
            ).fetchone()
            rate = rate["rate"] if rate else 7.0
        detail = build_detail(entries)
        conn.execute(
            """INSERT INTO pnl_daily(date,user_id,total_cny,total_usd,rate,base_cny,detail) VALUES(?,?,?,?,?,?,?)
               ON CONFLICT(date,user_id) DO UPDATE SET total_cny=excluded.total_cny,
                 total_usd=excluded.total_usd, detail=excluded.detail""",
            (date, user_id, cny, usd, rate, base_cny or 0, detail),
        )

    print("\n共 %d 行发生变化%s" % (changed, "（dry-run，未写库）" if args.dry_run else ""))
    if not args.dry_run:
        conn.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (MARKER, "1"))
        conn.commit()
        print("已写入 meta.%s=1" % MARKER)
    conn.close()


if __name__ == "__main__":
    main()
