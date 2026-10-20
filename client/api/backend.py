# -*- coding: utf-8 -*-
"""后端 API 客户端（持仓侠 Portfolio REST）。

契约来源 internal/api/handler.go：
- 认证头 X-User-Id
- POST /api/holdings                      新建持仓（body = db.Holding + cash_account_id）
- PUT  /api/holdings/:id                  全量更新
- POST /api/holdings/:id/adjust           加减仓 {type,quantity,price,fee,note,cash_account_id}
- POST /api/asset/wealth/snapshots        理财快照 {date, items:[{wealth_id,amount,cashflow,cash_account_id}]}
- POST /api/asset/cash/adjust             现金调整 {cash_id,delta,note}
- GET  /api/asset/sources | /api/asset/wealth | /api/asset/cash | /api/holdings | /api/version
"""
from __future__ import annotations

import requests


class BackendError(Exception):
    def __init__(self, status: int, msg: str):
        super().__init__(f"[{status}] {msg}")
        self.status = status
        self.msg = msg


class BackendClient:
    def __init__(self, base_url: str, user_id: int = 1, timeout: float = 10):
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"X-User-Id": str(user_id)})

    # ---------- 基础 ----------
    def _req(self, method: str, path: str, **kw):
        url = self.base + path
        try:
            r = self.session.request(method, url, timeout=self.timeout, **kw)
        except requests.RequestException as e:
            raise BackendError(0, f"网络错误：{e}")
        if r.status_code >= 400:
            msg = r.text
            try:
                j = r.json()
                msg = j.get("error") or j.get("message") or r.text
            except Exception:
                pass
            raise BackendError(r.status_code, msg)
        if r.status_code == 204 or not r.content:
            return None
        try:
            return r.json()
        except Exception:
            return None

    def version(self) -> str:
        j = self._req("GET", "/api/version")
        return (j or {}).get("version", "unknown") if isinstance(j, dict) else "unknown"

    # ---------- 列表 ----------
    def list_sources(self) -> list:
        return self._req("GET", "/api/asset/sources") or []

    def list_holdings(self) -> list:
        j = self._req("GET", "/api/holdings")
        return j if isinstance(j, list) else (j or {}).get("holdings", [])

    def list_wealth(self) -> list:
        j = self._req("GET", "/api/asset/wealth")
        return j if isinstance(j, list) else (j or {}).get("wealth", [])

    def list_cash(self) -> list:
        j = self._req("GET", "/api/asset/cash")
        return j if isinstance(j, list) else (j or {}).get("cash", [])

    # ---------- 持仓 ----------
    def create_holding(self, holding: dict, cash_account_id: int = 0) -> dict:
        body = dict(holding)
        body["cash_account_id"] = cash_account_id
        return self._req("POST", "/api/holdings", json=body)

    def update_holding(self, hid: int, holding: dict) -> dict:
        return self._req("PUT", f"/api/holdings/{hid}", json=holding)

    def adjust_holding(self, hid: int, type_: str, quantity: float, price: float,
                       fee: float = 0, note: str = "", cash_account_id: int = 0) -> dict:
        return self._req("POST", f"/api/holdings/{hid}/adjust", json={
            "type": type_, "quantity": quantity, "price": price,
            "fee": fee, "note": note, "cash_account_id": cash_account_id,
        })

    def find_holding_by_symbol(self, symbol: str):
        symbol = (symbol or "").strip().lower()
        if not symbol:
            return None
        for h in self.list_holdings():
            if str(h.get("symbol", "")).lower() == symbol:
                return h
        return None

    # ---------- 理财 / 现金 ----------
    def wealth_snapshots(self, date: str, items: list) -> dict:
        return self._req("POST", "/api/asset/wealth/snapshots",
                         json={"date": date, "items": items})

    def cash_adjust(self, cash_id: int, delta: float, note: str = "") -> dict:
        return self._req("POST", "/api/asset/cash/adjust",
                         json={"cash_id": cash_id, "delta": delta, "note": note})
