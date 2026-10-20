# -*- coding: utf-8 -*-
"""引导流程：步骤定义 + 判页状态机（纯逻辑，无 Qt 依赖）。

用法：
    guide = GuideRunner("holdings_init")
    guide.on_step = lambda idx, title, hint: ...      # 步骤切换回调
    guide.on_capture = lambda schema: ...             # 需要截图时回调
    guide.feed_text(ocr_text)                         # 每次截图后喂入
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class GuideStep:
    id: str
    title: str
    hint: str
    keywords: list = field(default_factory=list)    # 全部命中才算到达（all-of）
    keywords_any: list = field(default_factory=list)  # 任一命中（any-of，与 keywords 取交集）
    schema: str = ""                                # 到达后需要采集的业务表结构
    manual: bool = False                           # True = 只提示，等用户点"继续"


def _step_matches(st: GuideStep, text: str) -> bool:
    if st.keywords and not all(k in text for k in st.keywords):
        return False
    if st.keywords_any and not any(k in text for k in st.keywords_any):
        return False
    return bool(st.keywords or st.keywords_any)


GUIDES = {
    "holdings_init": [
        GuideStep("open_app", "打开券商 App",
                  "在 iPhone 上打开你的券商/基金 App，进入「资产」或「持仓」页面。",
                  keywords_any=["持仓", "总资产", "资产", "我的"]),
        GuideStep("holdings_page", "进入持仓列表",
                  "滑到持仓列表页，确保列表完整显示（代码、名称、数量、市值列可见）。",
                  keywords=["持仓"], keywords_any=["市值", "盈亏", "成本", "份额"]),
        GuideStep("capture_holdings", "采集持仓页",
                  "保持页面不动，客户端将自动截图。如有多屏持仓，逐屏手动点「立即截图」。",
                  schema="holdings"),
        GuideStep("review", "核对并写入",
                  "在弹窗中核对识别结果，修正错别字后提交到后端。",
                  manual=True),
    ],
    "wealth": [
        GuideStep("open_wealth", "打开理财页面",
                  "进入 App 的「理财」/「基金」页面。",
                  keywords_any=["理财", "基金", "产品"]),
        GuideStep("capture_wealth", "采集理财页",
                  "保持页面不动，客户端将自动截图。",
                  schema="wealth"),
        GuideStep("review", "核对并写入",
                  "在弹窗中核对识别结果，按产品名匹配后端已有产品后提交。",
                  manual=True),
    ],
    "flows": [
        GuideStep("open_flows", "打开流水页面",
                  "进入账户的「交易流水」/「收支明细」页面。",
                  keywords_any=["流水", "明细", "交易记录"]),
        GuideStep("capture_flows", "采集流水页",
                  "从最新一笔开始截取；每屏一张，翻页后再截。",
                  schema="flows"),
        GuideStep("review", "核对并写入",
                  "流水仅作为记录核对，暂不自动写入后端（避免重复记账）。",
                  manual=True),
    ],
}


class GuideRunner:
    def __init__(self, guide_key: str = "holdings_init"):
        self.steps = GUIDES.get(guide_key) or GUIDES["holdings_init"]
        self.guide_key = guide_key
        self.idx = 0
        self.done = False
        self.on_step = None       # (idx, step)
        self.on_capture = None    # (schema, step)
        self.on_log = None        # (msg)
        self._fired = set()       # 已触发过采集的步骤 id（防重复自动触发）

    @property
    def current(self) -> GuideStep:
        return self.steps[self.idx]

    def _emit_step(self):
        if self.on_step:
            self.on_step(self.idx, self.current)

    def reset(self):
        self.idx = 0
        self.done = False
        self._emit_step()

    def advance(self):
        if self.idx < len(self.steps) - 1:
            self.idx += 1
            self._emit_step()
            self._maybe_fire()
        else:
            self.done = True
            if self.on_log:
                self.on_log("引导流程完成")

    def _maybe_fire(self):
        """当前步骤是采集步且本次为新到达 → 触发一次采集。"""
        st = self.current
        if st.schema and st.id not in self._fired:
            self._fired.add(st.id)
            if self.on_capture:
                self.on_capture(st.schema, st)

    def feed_text(self, text: str):
        """喂入一次截图的 OCR 全文，自动推进步骤。

        推进规则：从当前步起，关键词全部命中的步骤依次前进；
        穿过后续无关键词的采集步时触发一次采集（仅新到达时触发，防循环）。
        """
        if self.done:
            return
        i = self.idx
        advanced = False
        while i < len(self.steps):
            st = self.steps[i]
            if st.manual:
                break
            has_kw = bool(st.keywords or st.keywords_any)
            if has_kw and not _step_matches(st, text):
                break
            # 命中（或无关键词的采集步）：前进到 i
            if i > self.idx:
                for j in range(self.idx, i):
                    if self.on_log:
                        self.on_log(f"跳过「{self.steps[j].title}」")
                self.idx = i
                self._emit_step()
                advanced = True
            if not has_kw:
                # 采集步：触发后停在这里等用户（多屏可手动再截）
                if advanced:
                    self._maybe_fire()
                break
            i += 1
        if not advanced and self.idx == i and i >= len(self.steps):
            return
        if not advanced:
            cur = self.current
            if not cur.manual and cur.keywords:
                if self.on_log:
                    self.on_log(f"未匹配到步骤「{cur.title}」的关键词，请按提示操作手机")
