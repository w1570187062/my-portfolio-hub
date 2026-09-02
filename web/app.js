const $ = (s) => document.querySelector(s);

// ===== 主题切换（日间/夜间） =====
// 默认夜间模式；读取 localStorage 持久化偏好。
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
}
applyTheme(localStorage.getItem('pf_theme') || 'dark');
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('pf_theme') || 'dark');
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('pf_theme', next);
    applyTheme(next);
  };

  // 页脚版本信息：commit 短哈希 + 提交时间戳（后端构建时注入）
  const vi = document.getElementById('versionInfo');
  if (vi) {
    fetch('/api/version')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((v) => {
        let txt = 'build ' + (v.commit || 'dev');
        if (v.commit_time) {
          const t = String(v.commit_time).replace('T', ' ').slice(0, 16);
          txt += ' · ' + t;
        }
        vi.textContent = txt;
      })
      .catch(() => { vi.textContent = 'build dev'; });
  }
});

// ---- 视图路由（hash）：仅资产全景占用 #/asset，其余视图均为无 hash 的默认首页 ----
// 刷新保持：资产全景页刷新仍在 #/asset；首页无路由占位（默认视图）。
function viewFromHash() {
  return location.hash === '#/asset' ? 'asset' : 'holdings';
}
function applyRoute() {
  if (viewFromHash() === 'asset') showAssetView();
  else showHoldingsView();
}
function navigate(view) {
  if (view === 'asset') {
    if (location.hash !== '#/asset') location.hash = '/asset'; // 触发 hashchange → applyRoute
    else applyRoute(); // hash 已一致：幂等应用（重复点击同一导航）
    return;
  }
  // 非 asset 视图：清除 URL hash（pushState 保留后退到 #/asset 的能力）并直接应用目标视图
  if (location.hash && location.hash !== '#') {
    history.pushState(null, '', location.pathname + location.search);
  }
  switch (view) {
    case 'tools': showToolsView(); break;
    case 'calendar': openCalendarView(); break;
    case 'notify': showNotifyView(); break;
    default: showHoldingsView();
  }
}
window.addEventListener('hashchange', applyRoute);

const api = (path, opts = {}) => {
  const uid = localStorage.getItem('pf_user');
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers['X-User-Id'] = uid;
  return fetch(path, { ...opts, headers });
};

const fmt = (n) => (n == null ? '' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
// 价格类字段统一截断到 4 位小数，避免 float64 全精度（如 12.34738291）污染输入框与落库。
const round4 = (n) => { const v = Number(n); if (!isFinite(v)) return 0; return Math.round(v * 1e4) / 1e4; };
const round2 = (n) => { const v = Number(n); if (!isFinite(v)) return 0; return Math.round(v * 1e2) / 1e2; };
// 按类别保留小数：基金 4 位、股票 2 位（成本价/昨收/成交价口径）
const roundByCat = (v, cat) => (cat === 'fund' ? round4(v) : round2(v));
function fmtCat(n, cat) { return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: cat === 'fund' ? 4 : 2 }); }
// 调仓计算器上下文类别（决定价格输入框保留几位小数），由 prefillAdjCalc 写入
let calcCat = 'stock';
function clampCalc(el) { clampDecimals(el, calcCat === 'fund' ? 4 : 2); }
const pct = (n) => (n > 0 ? '+' : '') + (n == null ? '' : n.toFixed(2)) + '%';
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const cat = (c) => (c === 'fund' ? '基金' : '股票');
// 净值/成本价按类别精度显示：基金净值保留 4 位小数，股票保持 2 位。
const fmtNav = (n, category) => {
  if (n == null) return '';
  if (category === 'fund') return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return fmt(n);
};
// 输入框小数位限制：键入时直接截断到 max 位（不四舍五入），避免超长小数点。供 index.html 内联 oninput 调用。
function clampDecimals(el, max) {
  max = max || 4;
  const v = el.value;
  if (v.indexOf('.') < 0) return;
  const parts = v.split('.');
  if (parts[1] && parts[1].length > max) {
    el.value = parts[0] + '.' + parts[1].slice(0, max);
  }
}

let allHoldings = [];
let sparkCache = {}; // symbol -> 近20个交易日收盘价序列（时间正序），供表格迷你走势线使用
let curPage = 1;
let pageSize = 10;
let catFilter = new Set(); // selected categories; empty = all
let mktFilter = new Set(); // selected markets; empty = all
let sourceFilter = new Set(); // selected source ids (点击表头「来源」筛选); empty = all
let textFilter = '';        // 文本搜索（名称/代码/备注），配合「/」快捷聚焦
let usdRate = 1;
let hkdRate = 1;
let dayDate = ''; // 当日盈亏所基于的快照日期（YYYY-MM-DD）
let snapshotDate = '';   // 最近 pnl_daily 快照日期（YYYY-MM-DD）
let updatedAtMax = '';   // 行情更新时间最大值（YYYY-MM-DD HH:MM:SS）
let monthPnlCNY = 0;     // 本月累计盈亏（CNY 折算）
let monthPnlCny = 0;     // 本月累计盈亏（RMB 原始货币）
let todayRealizedCny = 0; // 今日已实现盈亏（减仓落库，CNY 折算），并入首页「当日盈亏」
let monthPnlUsd = 0;     // 本月累计盈亏（USD 原始货币）
let failedSymbols = {};  // symbol -> 失败原因（刷新失败持久标记）
// table | card；移动端（窄屏）默认卡片视图（表格横向溢出体验差），但不强制——允许用户手动切回表格（可横向滚动）
let holdingsView = localStorage.getItem('pf_view') || (window.innerWidth < 640 ? 'card' : 'table');
let wealthView = localStorage.getItem('pf_wealth_view') || (window.innerWidth < 640 ? 'card' : 'table');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two-level category -> market association (二级筛选).
const CAT_MARKETS = {
  stock: ['沪深', '美股', '港股'],
  fund: ['QDII', '债券', '股票', '商品'],
};
const ALL_MARKETS = [...CAT_MARKETS.stock, ...CAT_MARKETS.fund];

async function boot() {
  // 解析当前用户（多用户：前端用 localStorage 记录选中的用户，请求头携带 X-User-Id）。
  try { await initUser(); } catch (e) { console.warn('[user] initUser 失败:', e); }
  showApp();
}

function showApp() {
  $('#app').hidden = false;
  load();
  loadAISettings();
  // #app 在 boot() 前一直 hidden，顶层 syncViewToggle() 测得 0 宽导致滑块白块不可见；
  // 此处 #app 已可见，重新定位指示器，并用 rAF / fonts.ready 兜底字体异步加载导致的位移偏差。
  syncViewToggle();
  requestAnimationFrame(syncViewToggle);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncViewToggle);
}

function toast(msg, type = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 5000);
}

async function load() {
  try {
    const [h, s, f] = await Promise.all([api('/api/holdings'), api('/api/summary'), api('/api/fx')]);
    if (!h.ok) { toast('加载持仓失败 (HTTP ' + h.status + ')', 'err'); return; }
    if (!s.ok) { toast('加载汇总失败 (HTTP ' + s.status + ')', 'err'); return; }
    const hd = await h.json();
    const sd = await s.json();
    usdRate = sd.rate || 1;
    hkdRate = sd.hkd_rate || 1;
    // 汇率条：解析 /api/fx 结果并渲染（漏调用会导致汇率条一直 hidden）
    const fd = await f.json().catch(() => null);
    renderFx(fd);
    allHoldings = hd.holdings || [];
    dayDate = hd.day_date || '';
    snapshotDate = hd.snapshot_date || '';
    updatedAtMax = hd.updated_at_max || '';
    monthPnlCNY = sd.month_pnl_cny || 0;
    monthPnlCny = sd.month_pnl_cny_ccy || 0;
    monthPnlUsd = sd.month_pnl_usd || 0;
    todayRealizedCny = sd.today_realized_cny || 0;
    const ddl = document.getElementById('dayDateLbl');
    if (ddl) ddl.textContent = dayDate;
    renderFreshness();
    if (!freshnessTimer) freshnessTimer = setInterval(renderFreshness, 30000);
    await loadSourcesCache();
    sparkCache = await loadSpark(hd.holdings || []);
    buildFilters();
    renderFiltered();
  } catch (e) {
    toast('加载异常：' + e.message, 'err');
  }
}

// 批量拉取各标的历史收盘价序列（近20日），供表格迷你走势线使用；失败降级为空对象。
async function loadSpark(hs) {
  const syms = [...new Set((hs || []).map(x => x.symbol).filter(Boolean))];
  if (!syms.length) return {};
  try {
    const r = await api('/api/price/spark?symbols=' + encodeURIComponent(syms.join(',')));
    const d = await r.json().catch(() => null);
    return (d && d.spark) || {};
  } catch (e) {
    return {};
  }
}

// 行情时效性标识：原「行情更新于 MM-DD HH:MM:SS」已简化为「MM-DD HH:MM:SS 更新」，时间格式不变；
// 显示在首页卡片上方 market-bar 更新时间行的左侧，超 30 分钟仅变灰。
let freshnessTimer = null;
function renderFreshness() {
  const txt = (() => {
    if (!updatedAtMax) return '';
    const parts = String(updatedAtMax).split(' ');
    const full = parts[1] || updatedAtMax;
    const hhmm = full.length >= 8 ? full.slice(0, 5) : full; // 精确到分钟，去秒
    const dayFull = parts[0] || '';
    const dayMD = dayFull.length >= 10 ? dayFull.slice(5) : dayFull; // 取 MM-DD
    const t = new Date(String(updatedAtMax).replace(' ', 'T'));
    const now = new Date();
    const diffMs = now - t;
    const stale = isNaN(diffMs) ? false : diffMs > 30 * 60 * 1000;
    return { txt: dayMD + ' ' + hhmm + ' 更新', stale };
  })();
  // 首页卡片上方单独一行的更新时间
  const mb = document.getElementById('mbTime');
  if (mb) {
    if (!txt.txt) { mb.textContent = ''; mb.hidden = true; }
    else { mb.hidden = false; mb.textContent = txt.txt; mb.className = 'mb-time' + (txt.stale ? ' stale' : ''); }
  }
  // 兼容旧引用（若仍存在于页面）
  const el = document.getElementById('hfTime');
  if (el) {
    if (!txt.txt) { el.textContent = ''; el.hidden = true; }
    else { el.hidden = false; el.textContent = txt.txt; el.className = 'hf-time' + (txt.stale ? ' stale' : ''); }
  }
}

// 汇率纵向轮播（上下切换），位于首页 market-bar 更新时间行右侧。
// 内容复制一份首尾相接，配合 CSS translateY 分步上移无缝循环。
function renderFx(d) {
  const track = document.getElementById('hfTrack');
  if (!track) return;
  if (!d) { track.innerHTML = ''; return; }

  // Per-item day-over-day comparison (red=up/涨，green=down/跌，Chinese convention)
  let usdChg = null, hkdChg = null, cnyChg = null;
  if (d.has_yesterday && d.yesterday_cny > 0 && d.yesterday_hkd > 0) {
    const yHkdCny = d.yesterday_cny / d.yesterday_hkd;
    const yCnyUsd = 1 / d.yesterday_cny;
    const cHkd = d.hkd_cny || (d.usd_cny / d.usd_hkd);
    const cCny = d.cny_usd || (1 / d.usd_cny);
    if (d.usd_cny > 0) usdChg = { pct: (d.usd_cny - d.yesterday_cny) / d.yesterday_cny * 100 };
    if (cHkd > 0 && yHkdCny > 0) hkdChg = { pct: (cHkd - yHkdCny) / yHkdCny * 100 };
    if (cCny > 0 && yCnyUsd > 0) cnyChg = { pct: (cCny - yCnyUsd) / yCnyUsd * 100 };
  }

  function chgStr(chg, dec) {
    if (!chg) return '';
    const abs = Math.abs(chg.pct);
    const sign = chg.pct >= 0 ? '+' : '';
    const dir = chg.pct > 0.01 ? '▲' : (chg.pct < -0.01 ? '▼' : '');
    return ' <span class="fx-chg" style="color:' + (chg.pct > 0.01 ? 'var(--up)' : (chg.pct < -0.01 ? 'var(--down)' : 'var(--text-muted)')) + '">(' + sign + abs.toFixed(dec) + '% ' + dir + ')</span>';
  }

  const items = [
    { code: 'USD', val: d.usd_cny || 0, dec: 4, unit: '¥', chg: chgStr(usdChg, 2) },
    { code: 'HKD', val: d.hkd_cny || 0, dec: 4, unit: '¥', chg: chgStr(hkdChg, 2) },
    { code: 'CNY', val: d.cny_usd || 0, dec: 4, unit: '$', chg: chgStr(cnyChg, 2) },
  ];

  // 单份内容：三项汇率用「·」分隔，末尾再补一个「·」便于无缝循环。
  const itemHtml = items.map((it) =>
    '<span class="hf-item"><b>1 ' + it.code +
    ' = <span class="hf-num">' + it.val.toFixed(it.dec) + '</span> ' + it.unit + '</b>' + it.chg + '</span>'
  ).join('<span class="hf-dot">·</span>');
  const unit = itemHtml + '<span class="hf-dot">·</span>';
  // 复制一份首尾相接，translateX(-50%) 正好偏移一个 unit 宽度，实现无缝滚动。
  track.innerHTML = unit + unit;

  // 行情更新时间 pill（由 renderFreshness 填充，30s 刷新一次）
  renderFreshness();
}

// Holdings after applying the two-level (category + market) filter.
function filteredHoldings() {
  const kw = textFilter;
  return allHoldings.filter((h) => {
    // 已清仓（份额为 0）的持仓从活跃列表隐藏：数据仍保留在库，日后重新买入会自动恢复；
    // 其落袋盈亏已并入首页「当日盈亏」数值，首页不再单独展示「含已实现」标注，无需在列表里再占一行。
    if ((h.quantity || 0) <= 0) return false;
    if (catFilter.size && !catFilter.has(h.category)) return false;
    // 市场筛选仅在选定了具体类别（市场行可见）时生效：全不勾选 → 空集 → 无数据；全勾选 → 全部。
    if (catFilter.size && !mktFilter.has(h.market)) return false;
    // 来源筛选：点击表头「来源」勾选来源后，仅显示属于这些来源的持仓。
    if (sourceFilter.size && !sourceFilter.has(String(h.source_id || 0))) return false;
    if (kw) {
      const hay = ((h.name || '') + ' ' + (h.symbol || '') + ' ' + (h.note || '')).toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

// Render both the summary cards and the table from the currently filtered set,
// so statistics follow the category + market filter.
let sortKey = null;        // null | 'market_value' | 'pnl' | 'pnl_pct'
let sortDir = 'desc';      // 'asc' | 'desc'

// Convert a holding's CNY-equivalent value (USD/HKD holdings scaled by exchange rate).
function toRmb(h, v) {
  if (h.currency === 'USD') return (v || 0) * usdRate;
  if (h.currency === 'HKD') return (v || 0) * hkdRate;
  return v || 0;
}

// 市值原币种括号备注：非人民币持仓，在人民币金额后附注原币种符号+金额，便于核对真实币种规模。
// market_value 本身是持仓原始币种金额（USD 持仓即美元数），toRmb 才折算人民币展示。
function mvOrigNote(h) {
  const cur = (h.currency || 'CNY').toUpperCase();
  if (cur === 'CNY' || cur === 'RMB') return '';
  return ` <span class="mv-orig">(${curSymbolJS(h.currency)}${fmt(h.market_value || 0)})</span>`;
}
// 市值外币值悬停提示（表格列：主显 RMB，悬停显示原币种金额）
function mvOrigTitle(h) {
  const cur = (h.currency || 'CNY').toUpperCase();
  if (cur === 'CNY' || cur === 'RMB') return '';
  return ` title="原币种市值 ${curSymbolJS(h.currency)}${fmt(h.market_value || 0)}"`;
}

// Apply the active column sort to a filtered holding list.
// 市值/盈亏按 RMB 折算后比较，与列表展示口径一致；盈亏率按原值。
function sortedHoldings(hs) {
  if (!sortKey) return hs;
  const dir = sortDir === 'asc' ? 1 : -1;
  const val = (h) => (sortKey === 'pnl_pct' || sortKey === 'day_pnl_pct' ? (h[sortKey] || 0) : toRmb(h, h[sortKey]));
  return [...hs].sort((a, b) => (val(a) - val(b)) * dir);
}

// Toggle/reverse sort when a sortable header is clicked.
function setSort(key) {
  if (sortKey === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = 'desc';
  }
  updateSortIndicators();
  curPage = 1;
  renderFiltered();
}

// Reflect the current sort state on the table headers.
function updateSortIndicators() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    const k = th.dataset.sort;
    const ind = th.querySelector('.sort-ind');
    if (ind) ind.textContent = k === sortKey ? (sortDir === 'asc' ? '▲' : '▼') : '';
    th.classList.toggle('active', k === sortKey);
  });
}

function renderFiltered() {
  const hs = filteredHoldings();
  renderSummary(hs);
  const sorted = sortedHoldings(hs);
  const tbl = document.getElementById('tbl');
  const pager = document.getElementById('pager');
  const cards = document.getElementById('cards');
  const empty = document.getElementById('holdingsEmpty');
  const tw = document.querySelector('.table-wrap');
  const srcBox = document.getElementById('holdingsBySource');
  // 视图以用户选择为准（holdingsView）；移动端仅作为默认偏好
  const useCard = holdingsView === 'card';
  if (useCard) {
    if (tbl) tbl.hidden = true;
    if (tw) tw.hidden = true;
    if (pager) pager.hidden = true;
    if (srcBox) srcBox.hidden = true;
    if (cards) cards.hidden = false;
    renderCards(sorted);
  } else {
    // 表格视图改为「按来源分组的折叠卡片」（借鉴 PanWatch portfolio 来源分组）
    if (cards) cards.hidden = true;
    if (tw) tw.hidden = true;
    if (tbl) tbl.hidden = true;
    if (pager) pager.hidden = true;
    if (srcBox) srcBox.hidden = false;
    renderHoldingsBySource(sorted);
  }
  if (empty) {
    const emptyMsg = document.getElementById('emptyMsg');
    const emptyAddBtn = document.getElementById('emptyAddBtn');
    if (allHoldings.length === 0) {
      if (emptyMsg) emptyMsg.textContent = '还没有任何持仓，添加第一笔开始记录吧。';
      if (emptyAddBtn) emptyAddBtn.hidden = false;
      empty.hidden = false;
    } else if (hs.length === 0) {
      // 区分「全部已清仓」与「筛选无匹配」：前者是正常状态（列表仅隐藏 0 份额持仓）
      const allClosed = allHoldings.length > 0 && allHoldings.every((h) => (h.quantity || 0) <= 0);
      if (allClosed) {
        if (emptyMsg) emptyMsg.textContent = '全部持仓已清仓，列表暂无可持仓标的；重新买入后会自动恢复显示，已落袋盈亏已计入首页「当日盈亏」。';
      } else {
        if (emptyMsg) emptyMsg.textContent = '无数据：当前筛选条件下没有匹配的持仓，请调整筛选。';
      }
      if (emptyAddBtn) emptyAddBtn.hidden = true;
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
  }
}

// 判断某持仓是否支持技术分析（股票始终支持；基金需关联股票代码）
function supportsAnalysis(h) {
  if (h.category === 'fund') return !!(h.linked_symbol && String(h.linked_symbol).trim());
  return !!(h.symbol && String(h.symbol).trim());
}

// 分析按钮角标：根据持仓自动技术分析的买卖信号展示 买/卖（红涨绿跌），hold 不展示。
function anaBadge(sig) {
  if (!sig) return '';
  if (sig === 'buy') return '<span class="ana-badge buy" title="自动分析：看涨">买</span>';
  if (sig === 'sell') return '<span class="ana-badge sell" title="自动分析：看跌">卖</span>';
  return '';
}

// 用最新分析结论刷新某持仓行右上角的买卖角标，使角标与弹框结论保持一致。
// 例：弹框显示“中性”时，角标应清空（hold 不展示），而不是停留在旧的“买”。
function syncAnalysisBadge(id, sig) {
  const btn = document.querySelector('.act-analysis[data-ana="' + id + '"]');
  if (!btn) return;
  const wrap = btn.closest('.ana-wrap');
  if (!wrap) return;
  const old = wrap.querySelector('.ana-badge');
  const neu = anaBadge(sig);
  if (old) {
    if (neu) old.outerHTML = neu;
    else old.remove();
  } else if (neu) {
    wrap.insertAdjacentHTML('afterbegin', neu);
  }
  // 同步全局持仓数据，避免后续整表重渲染把角标回退为旧值
  const h = allHoldings.find((x) => String(x.id) === String(id));
  if (h) h.analysis_signal = sig;
}

// 预填「修改/加减仓」弹框内的补仓成本计算器（合并自首页操作列的「计算」按钮）。
// 计算器表单字段直接内嵌于 #adjustModal，故此处只做表单赋值，不单独开弹框。
function prefillAdjCalc(h) {
  const set = (iid, v) => { const el = document.getElementById(iid); if (el) el.value = (v == null || v === '' ? '' : v); };
  calcCat = h.category || 'stock';
  set('addOldPrice', roundByCat(h.cost_price, calcCat));
  set('addOldQty', h.quantity);
  set('addNewPrice', roundByCat(h.current_price, calcCat));
  set('addNewQty', '');
  set('addAmount', '');
  const feeEl = document.getElementById('addFee');
  set('addFee', feeEl && feeEl.value ? feeEl.value : 0);
  set('addMode', 'qty');
  const qw = document.getElementById('addQtyWrap'); if (qw) qw.style.display = '';
  const aw = document.getElementById('addAmtWrap'); if (aw) aw.style.display = 'none';
  const res = document.getElementById('addResult');
  if (res) res.innerHTML = '<span class="tool-empty">已带入该持仓的成本价 / 现价 / 数量，请填写补仓信息后点击「计算」</span>';
  lastAdd = null;
  const ab = document.getElementById('addApply');
  if (ab) ab.disabled = true;
}
// 临时在页面实际字体下测量元素渲染宽度（用于按最长名称计算名称列固定间距）
function _measureWidth(makeEl) {
  const el = makeEl();
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  el.style.top = '0';
  el.style.visibility = 'hidden';
  el.style.whiteSpace = 'nowrap';
  document.body.appendChild(el);
  const w = el.getBoundingClientRect().width || el.offsetWidth || 0;
  document.body.removeChild(el);
  return w;
}
function measureNameWidth(text) {
  return _measureWidth(() => {
    const s = document.createElement('span');
    s.style.fontSize = '14px';
    s.style.fontWeight = '400';
    s.style.fontFamily = 'inherit';
    s.textContent = text;
    return s;
  });
}
function measureBtnWidth(label) {
  return _measureWidth(() => {
    const b = document.createElement('button');
    b.className = 'btn btn-sm act-adjust-inline';
    b.textContent = label;
    return b;
  });
}

// 按来源分组渲染首页持仓为折叠卡片（每来源一张子表 + 4 列汇总）
// 借鉴 PanWatch portfolio：来源标题 + 数量 + 右侧市值/当日/总盈亏/盈亏率 + 折叠
// 持仓按 id 索引，供首页「计算」按钮快速取用成本/现价/数量（避免二次请求）
let HOLDINGS_BY_ID = {};
function renderHoldingsBySource(hs) {
  const box = document.getElementById('holdingsBySource');
  if (!box) return;
  if (!hs.length) { box.innerHTML = ''; return; }
  HOLDINGS_BY_ID = {};
  for (const h of hs) HOLDINGS_BY_ID[h.id] = h;
  const toCny = (v, cur) => cur === 'USD' ? v * usdRate : cur === 'HKD' ? v * hkdRate : v;
  const groups = new Map();
  for (const h of hs) {
    const sid = h.source_id || 0;
    const sname = h.source_name || (sid === 0 ? '未分组' : '来源' + sid);
    if (!groups.has(sid)) groups.set(sid, { sid, name: sname, items: [], mv: 0, cost: 0, dayPnl: 0, pnl: 0 });
    const g = groups.get(sid);
    g.items.push(h);
    g.mv += toCny(h.market_value || 0, h.currency);
    g.cost += toCny(h.cost_value || 0, h.currency);
    g.dayPnl += toCny(h.day_pnl || 0, h.currency);
    g.pnl += toCny(h.pnl || 0, h.currency);
  }
  const arr = [...groups.values()].sort((a, b) => b.mv - a.mv);
  // 根据所有名称最长长度计算名称列固定宽度，使加减仓/分析按钮落在一致位置对齐
  let maxName = 0, hasAna = false;
  for (const h of hs) {
    maxName = Math.max(maxName, measureNameWidth(h.name || ''));
    if (supportsAnalysis(h)) hasAna = true;
  }
  const ARROW = 16, GAP = 3, CELLPAD = 4;
  const wAdd = measureBtnWidth('修改');
  const wAna = hasAna ? measureBtnWidth('分析') : 0;
  // 固定名称列最大宽度为300px，保证修改/分析按钮始终完整显示
  // 公式：左边距 + 箭头 + 间距 + (maxName上限) + 间距 + 修改按钮 + (间距 + 分析按钮) + 右边距
  const maxNameCap = Math.min(maxName, 200); // 名称文字最多占200px，超过截断
  let colW = CELLPAD + ARROW + GAP + maxNameCap + GAP + wAdd + (hasAna ? GAP + wAna : 0) + CELLPAD;
  // 整体列宽上限300px
  colW = Math.min(colW, 300);
  box.style.setProperty('--name-col-w', Math.ceil(colW) + 'px');
  box.style.setProperty('--name-w', Math.ceil(Math.min(maxName, 200)) + 'px');
  let html = '';
  for (const g of arr) {
    const pnlPct = g.cost > 0 ? (g.pnl / g.cost) * 100 : 0;
    const dayPctV = g.mv > 0 ? (g.dayPnl / g.mv) * 100 : 0;
    html += `<div class="collapsible source-group holdings-group" data-sid="${g.sid}">`
      + `<div class="collapse-hat holdings-group-head">`
      + `<span class="hat-title"><span class="src-ico">${srcTypeIconForSource(g.sid)}</span> ${esc(g.name)} <span class="hat-count">${g.items.length} 只</span></span>`
      + `<span class="hat-side">`
      + `<span class="hat-stat hat-stat-mv" title="该来源持仓折合人民币市值"><span class="hat-stat-lbl">市值</span><b>¥${fmt(g.mv)}</b></span>`
      + `<span class="hat-side-extra" title="悬停展开：当日 / 总盈亏 / 盈亏率">`
      + `<span class="hat-stat" title="该来源当日盈亏合计"><span class="hat-stat-lbl">当日</span><b class="${cls(g.dayPnl)}">${fmt(g.dayPnl)} <small>(${pct(dayPctV)})</small></b></span>`
      + `<span class="hat-stat" title="该来源累计盈亏合计"><span class="hat-stat-lbl">总盈亏</span><b class="${cls(g.pnl)}">${fmt(g.pnl)}</b></span>`
      + `<span class="hat-stat" title="该来源累计盈亏率"><span class="hat-stat-lbl">盈亏率</span><b class="${cls(pnlPct)}">${pct(pnlPct)}</b></span>`
      + `</span>`
      + `<span class="hat-chevron">▾</span></span>`
      + `</div>`
      + `<div class="collapse-body source-group-body">`
      + `<div class="subtable-wrap"><table class="asset-table holdings-subtable">`
      + `<thead><tr><th>名称</th><th>代码</th><th class="hide-col">市场</th><th class="hide-col">币种</th>`
      + `<th class="num">份额</th><th class="num">成本价</th><th class="num">现价</th>`
      + `<th class="num">市值</th><th class="num">当日</th><th class="num">当日%</th>`
      + `<th class="num">总盈亏</th><th class="num">盈亏%</th><th class="num">持仓天数</th><th>备注</th>`
      + `<th class="num" title="近20个交易日收盘价走势">近20日</th><th>操作</th>`
      + `</tr></thead><tbody>${g.items.map((h, i) => renderGroupRow(h, i)).join('')}</tbody>`
      + `</table></div></div></div>`;
  }
  box.innerHTML = html;
  // 绑定每组内行事件
  box.querySelectorAll('.holdings-group').forEach((gEl) => {
    gEl.querySelectorAll('[data-edit]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); console.log('[click] 编辑持仓', b.dataset.edit); editHolding(b.dataset.edit); });
    gEl.querySelectorAll('[data-del]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); console.log('[click] 删除持仓', b.dataset.del); delHolding(b.dataset.del); });
    gEl.querySelectorAll('[data-adjust]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); console.log('[click] 加减仓', b.dataset.adjust); openAdjust(b.dataset.adjust); });
    gEl.querySelectorAll('[data-hist]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); console.log('[click] 历史持仓', b.dataset.hist); openHoldingHistory(b.dataset.hist); });
    gEl.querySelectorAll('[data-fail]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); toast(failedSymbols[b.dataset.fail] || '刷新失败', 'err'); });
    gEl.querySelectorAll('[data-ana]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); console.log('[click] 技术分析', b.dataset.ana); openAnalysis(b.dataset.ana); });
    gEl.querySelectorAll('[data-copy]').forEach((el) => el.onclick = (e) => {
      e.stopPropagation();
      const txt = el.dataset.copy;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(txt).then(() => toast('已复制: ' + txt, 'ok'));
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        toast('已复制: ' + txt, 'ok');
      }
    });
  });
}

// 来源分组子表行模板：名称左侧 带颜色箭头(▲/▼) 方向指示 + 名称(过长截断) + 修改/分析 幽灵按钮；操作列纯色文字链接
function renderGroupRow(h, i) {
  const isFail = !!failedSymbols[h.symbol];
  const dayPnl = Number(h.day_pnl) || 0;
  const dirCls = dayPnl > 0 ? 'up' : (dayPnl < 0 ? 'down' : 'flat');
  const dirArrow = dirCls === 'up' ? '▲' : (dirCls === 'down' ? '▼' : '');
  return `<tr${isFail ? ' class="row-failed"' : ''}>
    <td class="name-cell">
      ${isFail ? '<span class="fail-badge" data-fail="' + esc(h.symbol) + '" title="点击查看失败原因">⚠</span>' : ''}
      <span class="dir-ind ${dirCls}" title="${dirCls === 'up' ? '涨' : dirCls === 'down' ? '跌' : ''}">${dirArrow}</span>
      <span class="name-clickable" data-copy="${esc(h.name)}" title="${esc(h.name)}">${esc(h.name)}</span>
      <button class="btn btn-sm act-adjust-inline act-modify" data-adjust="${h.id}" title="修改">修改</button>
      ${supportsAnalysis(h) ? '<span class="ana-wrap">' + anaBadge(h.analysis_signal) + '<button class="btn btn-sm act-adjust-inline act-analysis" data-ana="' + h.id + '" title="技术分析">分析</button></span>' : ''}
    </td>
    <td>${h.symbol}</td>
    <td class="hide-col">${h.market}</td>
    <td class="hide-col">${h.currency}</td>
    <td class="num">${fmt(h.quantity)}</td>
    <td class="num">${fmtNav(h.cost_price, h.category)}</td>
    <td class="num">${fmtNav(h.current_price, h.category)}</td>
    <td class="num"${mvOrigTitle(h)}>${fmt(toRmb(h, h.market_value))}</td>
    <td class="num ${cls(h.day_pnl)}">${fmt(toRmb(h, h.day_pnl))}</td>
    <td class="num ${cls(h.day_pnl_pct)}">${pct(h.day_pnl_pct)}</td>
    <td class="num ${cls(h.pnl)}">${fmt(toRmb(h, h.pnl))}</td>
    <td class="num ${cls(h.pnl_pct)}">${pct(h.pnl_pct)}</td>
    <td class="num" style="font-size:12px;color:var(--text-muted)">${h.holding_days > 0 ? h.holding_days + '天' : '—'}</td>
    <td style="font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(h.note || '')}">${esc(h.note || '')}</td>
    <td class="num spark-td">${sparkCell(h.symbol)}</td>
    <td class="row-act-cell">
      <button class="row-act" data-edit="${h.id}" title="编辑持仓">编辑</button>
      <button class="row-act" data-hist="${h.id}" title="历史走势">历史</button>
      <button class="row-act danger" data-del="${h.id}" title="删除持仓">删除</button>
    </td>
  </tr>`;
}

// 卡片视图：每只持仓一张卡（名称+代码 / 现价+当日% / 市值 / 累计盈亏），点击进详情。
function renderCards(hs) {
  const box = document.getElementById('cards');
  if (!box) return;
  if (!hs.length) { box.innerHTML = ''; return; }
  box.innerHTML = hs.map((h) => {
    const dpCls = cls(h.day_pnl);
    const pCls = cls(h.pnl);
    const fail = failedSymbols[h.symbol];
    return `<div class="holding-card${fail ? ' card-failed' : ''}" data-card="${h.id}" data-category="${h.category}" data-linked-symbol="${esc(h.linked_symbol || '')}">
      <div class="hc-top">
        <div class="hc-name${h.day_pnl_pct > 0 ? ' name-up' : (h.day_pnl_pct < 0 ? ' name-down' : '')}">${h.day_pnl_pct > 0 ? '<span class="name-arrow">▲</span>' : (h.day_pnl_pct < 0 ? '<span class="name-arrow-down">▼</span>' : '')}${esc(h.name)}${h.category === 'fund' && h.linked_symbol ? ' <span class="linked-badge">🔗</span>' : ''}</div>
        ${fail ? '<span class="fail-badge" data-fail="' + esc(h.symbol) + '" title="点击查看失败原因">⚠</span>' : ''}
      </div>
      <div class="hc-code">${esc(h.symbol)} · ${cat(h.category)} · ${h.market} · ${h.currency}</div>
      <div class="hc-row"><span class="hc-label">现价</span><span class="hc-val">${fmtNav(h.current_price, h.category)}</span><span class="hc-label">当日</span><span class="hc-val ${dpCls}">${pct(h.day_pnl_pct)}</span></div>
      <div class="hc-row"><span class="hc-label">市值</span><span class="hc-val">¥${fmt(toRmb(h, h.market_value))}${mvOrigNote(h)}</span></div>
      <div class="hc-row"><span class="hc-label">累计盈亏</span><span class="hc-val ${pCls}">¥${fmt(toRmb(h, h.pnl))} (${pct(h.pnl_pct)})</span></div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-card]').forEach((c) => {
    c.onclick = (e) => {
      const fb = e.target.closest('[data-fail]');
      if (fb) { e.stopPropagation(); toast(failedSymbols[fb.dataset.fail] || '刷新失败', 'err'); return; }
      const id = c.dataset.card, catv = c.dataset.category, linked = c.dataset.linkedSymbol;
      if (catv === 'fund' && !linked) { toast('该基金未设置关联股票代码，不支持技术分析', 'info'); return; }
      openAnalysis(id);
    };
  });
}

function renderSummary(hs) {
  let cnyMV = 0, cnyCV = 0, cnyPnl = 0, usdMV = 0, usdCV = 0, usdPnl = 0, hkdMV = 0, hkdCV = 0, hkdPnl = 0, totalCNY = 0, totalCostCNY = 0;
  hs.forEach((h) => {
    const mv = h.market_value || 0, cv = h.cost_value || 0, pnl = h.pnl || 0;
    if (h.currency === 'USD') {
      usdMV += mv; usdCV += cv; usdPnl += pnl;
      totalCNY += mv * usdRate; totalCostCNY += cv * usdRate;
    } else if (h.currency === 'HKD') {
      hkdMV += mv; hkdCV += cv; hkdPnl += pnl;
      totalCNY += mv * hkdRate; totalCostCNY += cv * hkdRate;
    } else {
      cnyMV += mv; cnyCV += cv; cnyPnl += pnl;
      totalCNY += mv; totalCostCNY += cv;
    }
  });
  const totalPnl = totalCNY - totalCostCNY;
  const totalPct = totalCostCNY > 0 ? totalPnl / totalCostCNY * 100 : 0;
  const rateTxt = (usdRate ? ('1 USD ≈ ' + usdRate.toFixed(4) + ' CNY') : 'USD汇率失败') + (hkdRate ? (' ｜ 1 HKD ≈ ' + hkdRate.toFixed(4) + ' CNY') : '');
  const pCls = cls(totalPnl);
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  let upCount = 0, downCount = 0, flatCount = 0, dayPnlCNY = 0;
  hs.forEach((h) => {
    const d = h.day_pnl_pct || 0;
    if (d > 0) upCount++;
    else if (d < 0) downCount++;
    else flatCount++;
    dayPnlCNY += toRmb(h, h.day_pnl || 0);
  });
  dayPnlCNY += todayRealizedCny; // 并入今日已实现（清仓/减仓）盈亏，避免已清仓标的漏算
  const dpCls = cls(dayPnlCNY);
  const mpCls = cls(monthPnlCNY);
  const ICON = {
    total: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1"/><path d="M3 8v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="13" r="1.2"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 7 9 13 13 9 21 17"/><polyline points="15 17 21 17 21 11"/></svg>',
    rmb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l6 8 6-8"/><line x1="12" y1="12" x2="12" y2="20"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="8" y1="18" x2="16" y2="18"/></svg>',
    usd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><path d="M16.5 7c0-1.9-2-2.8-4.5-2.8S7.5 5.1 7.5 7s1.5 2.5 4.5 3 4.5 1.4 4.5 3.5-2 2.8-4.5 2.8-4.5-.9-4.5-2.8"/></svg>',
    distribution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="7"/><line x1="18" y1="20" x2="18" y2="10"/></svg>',
    pnl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><polyline points="7 15 11 10 14 13 21 6"/></svg>',
  };
  // 合并卡：总资产 / 总盈亏(带涨跌箭头) / 涨跌数 三列并排、居中，币种市值明细置于各列右侧。
  let br = '';
  br += `<div class="c-br"><span class="c-br-label">RMB 市值</span><span class="c-br-val">${fmt(cnyMV)}</span></div>`;
  br += `<div class="c-br"><span class="c-br-label">USD 市值</span><span class="c-br-val">${fmt(usdMV * usdRate)}</span></div>`;
  if (hkdMV > 0) br += `<div class="c-br"><span class="c-br-label">HKD 市值</span><span class="c-br-val">${fmt(hkdMV * hkdRate)}</span></div>`;
  // 总盈亏：涨用 ▲+红、跌用 ▼+绿（国内惯例），与持仓涨跌箭头风格一致
  const pnlArrow = pCls === 'up' ? '▲' : (pCls === 'down' ? '▼' : '');
  const pnlVal = pCls === 'flat' ? fmt(totalPnl) : (pnlArrow + ' ' + fmt(totalPnl));
  // 分币种盈亏（折算为 CNY，与顶部总额一致）：RMB / USD /（有持仓的）HKD，上下排列
  let pnlRows = '';
  pnlRows += `<div class="c-pnl-row"><span class="c-pnl-label">RMB</span><span class="c-pnl-val ${cls(cnyPnl)}">¥${fmt(cnyPnl)}</span></div>`;
  pnlRows += `<div class="c-pnl-row"><span class="c-pnl-label">USD</span><span class="c-pnl-val ${cls(usdPnl)}">$${fmt(usdPnl)}</span></div>`;
  if (hkdMV > 0) pnlRows += `<div class="c-pnl-row"><span class="c-pnl-label">HKD</span><span class="c-pnl-val ${cls(hkdPnl)}">${fmt(hkdPnl * hkdRate)}</span></div>`;
  const updownVal = `<span class="up">▲ ${upCount}</span><span class="ud-sep">/</span><span class="down">▼ ${downCount}</span>`;
  // 本月累计：CNY 折算总额下方，再列出本月 RMB/USD 原始货币盈亏（上下排列）
  const mpCnyCls = cls(monthPnlCny), mpUsdCls = cls(monthPnlUsd);
  const mpRows = `<div class="c-pnl-row"><span class="c-pnl-label">RMB</span><span class="c-pnl-val ${mpCnyCls}">¥${fmt(monthPnlCny)}</span></div>` +
                 `<div class="c-pnl-row"><span class="c-pnl-label">USD</span><span class="c-pnl-val ${mpUsdCls}">$${fmt(monthPnlUsd)}</span></div>`;
  // 首页总览：账户父卡片内，把总资产/总盈亏/当日盈亏/本月盈亏/涨跌数拆成多个独立卡片（参考 PanWatch 持仓页）。总资产→总市值。
  const card = document.getElementById('accountCard');
  const el = document.getElementById('acSummaryData');
  if (!el) return;
  if (card) card.hidden = false;
  // 独立卡片：标签在上、大号数值在下；涨跌数用 ▲/▼ 着色；总盈亏/当日/本月带涨跌色。
  el.innerHTML = `
    <div class="sum-card"><span class="sum-lbl">总市值</span><b class="sum-val">¥${fmt(totalCNY)}</b></div>
    <div class="sum-card"><span class="sum-lbl">总盈亏</span><b class="sum-val ${pCls}">¥${fmt(totalPnl)} <small>(${pct(totalPct)})</small></b></div>
    <div class="sum-card"><span class="sum-lbl">当日盈亏</span><b class="sum-val ${dpCls}">¥${fmt(dayPnlCNY)}</b></div>
    <div class="sum-card"><span class="sum-lbl">本月盈亏</span><b class="sum-val ${mpCls}">¥${fmt(monthPnlCNY)}</b></div>
    <div class="sum-card"><span class="sum-lbl">涨跌</span><b class="sum-val"><span class="up">▲${upCount}</span> <span class="down">▼${downCount}</span></b></div>`;
}

// Build the two-level filter UI: a category slider (left-right swipeable, single
// select) and a market row (multi-select chips) whose options depend on the
// selected category (二级筛选).
function buildFilters() {
  const box = $('#filters');
  box.innerHTML = '';

  // 类别：左右滑动滑块（单选：全部 / 股票 / 基金），按需求不显示「类别：」文字标签
  const catRow = document.createElement('div');
  catRow.className = 'filter-row';
  const catSlider = document.createElement('div');
  catSlider.id = 'catSlider';
  catSlider.className = 'slider';
  [['', '全部'], ['stock', '股票'], ['fund', '基金']].forEach(([val, txt]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slider-item' + (val === '' ? ' active' : '');
    b.dataset.cat = val;
    b.textContent = txt;
    b.onclick = () => onCatSelect(val, catSlider);
    catSlider.appendChild(b);
  });
  catRow.appendChild(catSlider);
  box.appendChild(catRow);
  catFilter = new Set(); // 默认：全部

  // 市场：多选 chips（横向可滑动，避免换行）
  const mktRow = document.createElement('div');
  mktRow.id = 'mktRow';
  mktRow.className = 'filter-row scroll-row';
  mktRow.innerHTML = ''; // 不显示「市场：」文字标签（需求）
  box.appendChild(mktRow);
  mktRow.style.display = 'none'; // 默认全部时隐藏市场行
  mktFilter = new Set(ALL_MARKETS);
  rebuildMarketChips();
}

// Markets offered depend on which categories are selected.
function availableMarkets() {
  if (catFilter.size === 0) return ALL_MARKETS;
  let ms = [];
  catFilter.forEach((c) => { ms = ms.concat(CAT_MARKETS[c] || []); });
  return ms;
}

function rebuildMarketChips() {
  const mktRow = $('#mktRow');
  mktRow.querySelectorAll('.chip').forEach((el) => el.remove());
  const avail = availableMarkets();
  const valid = new Set(avail);
  [...mktFilter].forEach((m) => { if (!valid.has(m)) mktFilter.delete(m); });
  // 注意：不再在空集时自动补回全部——全部不勾选即代表「无选中市场」，应过滤为空（显示无数据）。
  avail.forEach((m) => {
    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="checkbox" name="mkt-filter" value="${m}" ${mktFilter.has(m) ? 'checked' : ''}> ${m}`;
    label.querySelector('input').onchange = onMktChange;
    mktRow.appendChild(label);
  });
}

function onCatSelect(val, slider) {
  [...slider.children].forEach((el) => el.classList.toggle('active', el.dataset.cat === val));
  catFilter = (val === '') ? new Set() : new Set([val]);
  mktFilter = new Set(availableMarkets()); // 切换类别时把市场重置为该类全部
  rebuildMarketChips();
  // 选"全部"时隐藏市场筛选行
  const mktRow = document.getElementById('mktRow');
  if (mktRow) mktRow.style.display = (val === '') ? 'none' : '';
  applyFilter();
}

function onMktChange() {
  mktFilter = new Set([...document.querySelectorAll('#mktRow input:checked')].map((i) => i.value));
  applyFilter();
}

function applyFilter() {
  curPage = 1;
  renderFiltered();
}

let sparkUid = 0;
// 迷你走势线（借鉴 PanWatch Sparkline）：纯 SVG polyline + 渐变面积 + 尾端点圆。
// 涨红跌绿（中国惯例），w/h 固定 1:1 用 viewBox 精确匹配，避免拉伸变形。
function sparkline(data, opts) {
  const w = (opts && opts.w) || 100, h = (opts && opts.h) || 28;
  const stroke = (opts && opts.stroke) || 'currentColor';
  const fill = (opts && opts.fill) || stroke;
  const vals = (data || []).filter(v => Number.isFinite(v));
  if (vals.length < 2) return '';
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 1e-9) { max += 1; min -= 1; }
  const padY = Math.max(1.5, h * 0.12), innerH = h - padY * 2;
  const xAt = i => (w * i) / (vals.length - 1);
  const yAt = v => padY + innerH - (innerH * (v - min)) / (max - min);
  const pts = vals.map((v, i) => `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`).join(' ');
  const last = pts.split(' ').pop();
  const gid = 'spk' + (++sparkUid);
  const area = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${stroke}" stop-opacity=".32"/><stop offset="100%" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs><polygon points="${xAt(0).toFixed(2)},${h} ${pts} ${xAt(vals.length - 1).toFixed(2)},${h}" fill="url(#${gid})"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="${w}" height="${h}" style="vertical-align:middle;display:block" role="img" aria-hidden="true">${area}<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${last.split(',')[0]}" cy="${last.split(',')[1]}" r="2.2" fill="${stroke}"/></svg>`;
}

// 表格迷你走势单元格：末价 vs 首价定涨跌色（涨红跌绿），无数据时显示占位符。
function sparkCell(sym) {
  const arr = sparkCache[sym];
  if (!arr || arr.length < 2) return '<span class="spark-empty">—</span>';
  const up = arr[arr.length - 1] >= arr[0];
  const color = up ? 'var(--up)' : 'var(--down)';
  return sparkline(arr, { w: 110, h: 26, stroke: color, fill: color });
}

function renderRows(hs) {
  const total = hs.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (curPage > totalPages) curPage = totalPages;
  if (curPage < 1) curPage = 1;
  const start = (curPage - 1) * pageSize;
  const pageItems = hs.slice(start, start + pageSize);
  const tb = $('#rows');
  tb.innerHTML = '';
  pageItems.forEach((h, i) => {
    const tr = document.createElement('tr');
    const isFail = !!failedSymbols[h.symbol];
    if (isFail) tr.className = 'row-failed';
    tr.innerHTML = `
     <td class="num idx">${start + i + 1}${isFail ? '<span class="fail-badge" data-fail="' + esc(h.symbol) + '" title="点击查看失败原因">⚠</span>' : ''}</td>
     <td class="name-clickable ${h.day_pnl_pct > 0 ? 'name-up' : (h.day_pnl_pct < 0 ? 'name-down' : '')}" title="${esc(h.name)}">${h.day_pnl_pct > 0 ? '<span class="name-arrow">▲</span>' : (h.day_pnl_pct < 0 ? '<span class="name-arrow-down">▼</span>' : '')}<span class="name-text">${esc(h.name)}</span></td><td>${h.symbol}</td><td>${esc(h.source_name || '')}</td><td class="hide-col">${cat(h.category)}</td><td class="hide-col">${h.market}</td><td class="hide-col">${h.currency}</td>
     <td class="num">${fmt(h.quantity)}</td>
     <td class="num">${fmtNav(h.cost_price, h.category)}</td>
     <td class="num">${fmtNav(h.current_price, h.category)}</td>
     <td class="num spark-td">${sparkCell(h.symbol)}</td>
     <td class="num"${mvOrigTitle(h)}>${fmt(toRmb(h, h.market_value))}</td>
     <td class="num ${cls(h.day_pnl)}">${fmt(toRmb(h, h.day_pnl))}</td>
     <td class="num ${cls(h.day_pnl_pct)}">${pct(h.day_pnl_pct)}</td>
     <td class="num ${cls(h.pnl)}">${fmt(toRmb(h, h.pnl))}</td>
     <td class="num ${cls(h.pnl_pct)}">${pct(h.pnl_pct)}</td>
     <td class="num" style="font-size:12px;color:var(--text-muted)">${h.holding_days > 0 ? h.holding_days + '天' : '—'}</td>
     <td style="font-size:12px;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(h.note || '')}">${esc(h.note || '')}</td>
     <td class="row-actions"><button class="btn act-adjust" data-adjust="${h.id}" title="加减仓">📊</button><button class="btn act-edit" data-edit="${h.id}" title="编辑">✏️</button><button class="btn act-hist" data-hist="${h.id}" title="历史">📈</button><button class="btn act-del danger" data-del="${h.id}" title="删除">🗑️</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => { console.log('[click] 编辑持仓', b.dataset.edit); editHolding(b.dataset.edit); }));
  tb.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { console.log('[click] 删除持仓', b.dataset.del); delHolding(b.dataset.del); }));
  tb.querySelectorAll('[data-adjust]').forEach((b) => (b.onclick = () => { console.log('[click] 加减仓', b.dataset.adjust); openAdjust(b.dataset.adjust); }));
  tb.querySelectorAll('[data-hist]').forEach((b) => (b.onclick = () => { console.log('[click] 历史持仓', b.dataset.hist); openHoldingHistory(b.dataset.hist); }));
  tb.querySelectorAll('[data-fail]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toast(failedSymbols[b.dataset.fail] || '刷新失败', 'err'); }));
  renderPager(total, totalPages);
}

// 分页栏：每页 pageSize 条，底部分页控件，样式与现有 slider/tab 一致。
function renderPager(total, totalPages) {
  const el = $('#pager');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; } // 单页不显示分页栏
  // 页码窗口：始终含首/尾/当前±1，超出用「…」省略
  const raw = new Set([1, totalPages, curPage, curPage - 1, curPage + 1].filter((p) => p >= 1 && p <= totalPages));
  const sorted = [...raw].sort((a, b) => a - b);
  let nums = [];
  let prev = 0;
  sorted.forEach((p) => {
    if (p - prev > 1) nums.push('…');
    nums.push(p);
    prev = p;
  });
  let html = `<span class="pg-info">共 ${total} 条</span>`;
  html += `<button class="btn pg-btn pg-prev" data-pg="${curPage - 1}" ${curPage <= 1 ? 'disabled' : ''}>‹ 上一页</button>`;
  nums.forEach((n) => {
    if (n === '…') html += `<span class="pg-ellipsis">…</span>`;
    else html += `<button class="btn pg-num ${n === curPage ? 'active' : ''}" data-pg="${n}">${n}</button>`;
  });
  html += `<button class="btn pg-btn pg-next" data-pg="${curPage + 1}" ${curPage >= totalPages ? 'disabled' : ''}>下一页 ›</button>`;
  html += `<span class="pg-info">第 ${curPage} / ${totalPages} 页</span>`;
  const sizes = [5, 10, 20];
  const sizeOpts = sizes.map((s) => `<option value="${s}" ${s === pageSize ? 'selected' : ''}>${s}</option>`).join('');
  html += `<label class="pg-size">每页<select id="pgSize">${sizeOpts}</select>条</label>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-pg]').forEach((b) => {
    b.onclick = () => {
      const p = parseInt(b.dataset.pg, 10);
      if (p >= 1 && p <= totalPages) { curPage = p; renderFiltered(); }
    };
  });
  const sz = $('#pgSize');
  if (sz) sz.onchange = () => { pageSize = parseInt(sz.value, 10) || 10; curPage = 1; renderFiltered(); };
}

// 单只持仓手动刷新逻辑已移除：行情改由定时快照（refreshAllQuotes）自动更新。

// Populate the market <select> with options valid for the chosen category.
function fillMarketOptions(catVal) {
  const sel = $('#f_market');
  const opts = CAT_MARKETS[catVal] || [];
  sel.innerHTML = opts.map((m) => `<option value="${m}">${m}</option>`).join('');
}

function openModal(h) {
  $('#modalTitle').textContent = h ? '编辑持仓' : '添加持仓';
  $('#f_id').value = h ? h.id : '';
  $('#f_name').value = h ? h.name : '';
  $('#f_symbol').value = h ? h.symbol : '';
  $('#f_category').value = h ? h.category : 'stock';
  fillMarketOptions($('#f_category').value);
  $('#f_market').value = h ? h.market : CAT_MARKETS['stock'][0];
  const fsrc = $('#f_source');
  fsrc.innerHTML = (assetSources || []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') || '<option value="">（请先添加来源）</option>';
  fsrc.value = h && h.source_id ? String(h.source_id) : (assetSources && assetSources[0] ? String(assetSources[0].id) : '');
  $('#f_currency').value = h ? h.currency : 'CNY';
  $('#f_quantity').value = h ? round4(h.quantity) : '';
  const eCat = h ? h.category : 'stock';
  $('#f_cost_price').value = h ? roundByCat(h.cost_price, eCat) : '';
  $('#f_current_price').value = h ? roundByCat(h.current_price, eCat) : '';
  $('#f_note').value = h ? (h.note || '') : '';
  $('#f_cost').value = h ? roundByCat(h.transaction_cost, eCat) : '';
  $('#f_buy_date').value = h ? (h.buy_date || '') : '';
  $('#f_linked_symbol').value = h ? (h.linked_symbol || '') : '';
  toggleLinkedSymbol($('#f_category').value);
  $('#formErr').textContent = '';
  $('#modal').hidden = false;
}

function toggleLinkedSymbol(catVal) {
  const row = $('#linked_symbol_row');
  if (row) row.style.display = catVal === 'fund' ? '' : 'none';
}

async function editHolding(id) {
  try {
    const r = await api('/api/holdings');
    if (!r.ok) { toast('加载持仓失败 (HTTP ' + r.status + ')', 'err'); return; }
    const d = await r.json();
    const h = (d.holdings || []).find((x) => x.id == id);
    if (!h) { toast('未找到该持仓', 'err'); return; }
    openModal(h);
  } catch (e) {
    toast('编辑异常：' + e.message, 'err');
  }
}

// ---------------- 加减仓 ----------------
let adjType = 'BUY';
let lastAdd = null;        // 调仓计算器最近一次有效方案 { q1, p1, fee, mode, side }
let pendingApplyAdd = false; // 确认弹框：计入持仓 pending 标记
function openAdjust(id) {
  const h = allHoldings.find((x) => String(x.id) === String(id));
  if (!h) { toast('未找到该持仓', 'err'); return; }
  $('#adj_id').value = h.id;
  adjType = 'BUY';
  syncAdjSeg();
  $('#adjustTitle').textContent = '加减仓 · ' + (h.name || h.symbol);
  $('#adj_quantity').value = '';
  $('#adj_price').value = h.current_price ? round4(h.current_price) : '';
  $('#adj_fee').value = 0;
  $('#adj_note').value = '';
  $('#adjErr').textContent = '';
  computeAdjPreview();
  renderAdjHistory(h.id);
  prefillAdjCalc(h);
  document.querySelectorAll('#adjustModal .adj-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'adjust'));
  document.querySelectorAll('#adjustModal .adj-panel').forEach((p) => { p.hidden = p.dataset.panel !== 'adjust'; });
  $('#adjustModal').hidden = false;
  $('#adj_quantity').focus();
}
function syncAdjSeg() {
  document.querySelectorAll('#adjTypeSeg .circ-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.type === adjType);
  });
}
function computeAdjPreview() {
  const h = allHoldings.find((x) => String(x.id) === String($('#adj_id').value));
  const qty = parseFloat($('#adj_quantity').value) || 0;
  const price = parseFloat($('#adj_price').value);
  const fee = parseFloat($('#adj_fee').value) || 0;
  const priceVal = isNaN(price) ? (h ? h.current_price : 0) : price;
  const amount = qty * priceVal;
  $('#adj_amount').value = amount ? amount.toFixed(4) : '';
  const box = $('#adjPreview');
  box.style.display = 'none';
  if (!h) { box.innerHTML = ''; return; }
  if (adjType === 'BUY') {
    const newQty = h.quantity + qty;
    if (qty <= 0) { box.innerHTML = ''; return; }
    if (newQty <= 0) { box.style.display = 'block'; box.innerHTML = '<span class="warn">加仓后份额需大于 0</span>'; return; }
    const newCost = (h.quantity * h.cost_price + qty * priceVal + fee) / newQty;
    box.style.display = 'block';
    box.innerHTML = `加仓后：份额 <b>${fmt(newQty)}</b>｜摊薄成本价 <b>${fmtNav(newCost, h.category)}</b>` +
      (h.cost_price > 0 ? `（原 ${fmtNav(h.cost_price, h.category)}）` : '');
  } else {
    if (qty <= 0) { box.innerHTML = ''; return; }
    if (qty > h.quantity) { box.style.display = 'block'; box.innerHTML = '<span class="warn">减仓数量不能超过当前份额 ' + fmt(h.quantity) + '</span>'; return; }
    const realized = (priceVal - h.cost_price) * qty - fee;
    const remainQty = h.quantity - qty;
    box.style.display = 'block';
    box.innerHTML = `减仓后：剩余份额 <b>${fmt(remainQty)}</b>｜本次实现盈亏 <b class="${cls(realized)}">${fmt(realized)}</b>` +
      (realized < 0 ? '（亏本）' : (realized > 0 ? '（盈利）' : ''));
  }
}
async function renderAdjHistory(id) {
  const list = $('#adjHistoryList');
  try {
    const r = await api('/api/holdings/' + id + '/transactions');
    if (!r.ok) { list.innerHTML = '<div class="adj-empty">记录加载失败</div>'; return; }
    const d = await r.json();
    const txs = d.transactions || [];
    if (!txs.length) { list.innerHTML = '<div class="adj-empty">暂无记录</div>'; return; }
    let html = '<div class="adj-realized">累计实现盈亏：<b>' + fmt(d.realized_total || 0) + '</b></div>';
    html += txs.map((t) => {
      const tag = t.tx_type === 'BUY'
        ? '<span class="adj-tag buy">加仓</span>'
        : '<span class="adj-tag sell">减仓</span>';
      const rl = t.tx_type === 'SELL'
        ? `<span class="adj-rl ${cls(t.realized_pnl)}">盈亏 ${fmt(t.realized_pnl)}</span>`
        : '';
      return `<div class="adj-tx">${tag}<span class="adj-meta">${t.created_at}</span>${rl}` +
        `<div class="adj-detail">数量 ${fmt(t.quantity)}｜价 ${fmt(t.price)}｜金额 ${fmt(t.amount)}｜成本 ${fmt(t.fee)}${t.note ? '｜' + esc(t.note) : ''}</div></div>`;
    }).join('');
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = '<div class="adj-empty">记录加载异常</div>';
  }
}
$('#adjTypeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.circ-btn');
  if (!b) return;
  adjType = b.dataset.type;
  syncAdjSeg();
  // 减仓：预填当前持仓全部数量，便于一键清仓（可手动改小做部分减仓）
  if (adjType === 'SELL') {
    const hh = allHoldings.find((x) => String(x.id) === String($('#adj_id').value));
    if (hh) $('#adj_quantity').value = hh.quantity;
  }
  computeAdjPreview();
});
// 加减仓弹框 tab 切换（加减仓 / 调仓计算器）
document.querySelectorAll('#adjustModal .adj-tab').forEach((b) => {
  b.addEventListener('click', () => {
    const tab = b.dataset.tab;
    document.querySelectorAll('#adjustModal .adj-tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('#adjustModal .adj-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  });
});
['adj_quantity', 'adj_price', 'adj_fee'].forEach((fid) => {
  const el = document.getElementById(fid);
  if (el) el.addEventListener('input', computeAdjPreview);
});
$('#adjustForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#adj_id').value;
  const h = allHoldings.find((x) => String(x.id) === String(id));
  const qty = round4(parseFloat($('#adj_quantity').value));
  if (!qty || qty <= 0) { $('#adjErr').textContent = '请输入大于 0 的数量'; return; }
  let price = round4(parseFloat($('#adj_price').value));
  if (isNaN(price) && h) price = h.current_price;
  if (isNaN(price) || price < 0) { $('#adjErr').textContent = '价格无效'; return; }
  const fee = round4(parseFloat($('#adj_fee').value) || 0);
  const note = $('#adj_note').value.trim();
  $('#adjErr').textContent = '';
  try {
    const r = await api('/api/holdings/' + id + '/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: adjType, quantity: qty, price: price, fee: fee, note: note }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { $('#adjErr').textContent = d.error || ('操作失败 (HTTP ' + r.status + ')'); return; }
    const hh = d.holding;
    const op = adjType === 'BUY' ? '加仓' : '减仓';
    let msg = `${op}成功：${hh.name} 现份额 ${fmt(hh.quantity)}｜成本价 ${fmtNav(hh.cost_price, hh.category)}`;
    if (adjType === 'SELL') {
      msg += `｜本次实现盈亏 ${fmt(d.realized_pnl || 0)}（累计 ${fmt(d.realized_total || 0)}）`;
    }
    toast(msg, 'ok');
    $('#adjustModal').hidden = true;
    await load();
  } catch (err) {
    $('#adjErr').textContent = '操作异常：' + err.message;
  }
};

let pendingDelId = null;
let pendingSnapDelete = null;
let pendingExport = false;
function delHolding(id) {
  pendingDelId = id;
  $('#confirmMsg').textContent = '确认删除该持仓？删除后不可恢复。';
  $('#confirmModal').hidden = false;
}
function confirmExport() {
  pendingExport = true;
  const btn = $('#confirmOk');
  btn.textContent = '导出';
  btn.classList.remove('danger');
  $('#confirmTitle').textContent = '确认导出';
  $('#confirmMsg').textContent = '将导出全部资产数据（持仓 / 理财 / 现金 / 负债 / 消费）为 JSON 文件，是否继续？';
  $('#confirmModal').hidden = false;
}
function resetConfirm() {
  $('#confirmModal').hidden = true;
  pendingDelId = null;
  pendingSnapDelete = null;
  pendingAssetDel = null;
  pendingExport = false;
  pendingImport = null;
  pendingApplyAdd = false;
  const btn = $('#confirmOk');
  btn.textContent = '删除';
  btn.classList.remove('primary');
  btn.classList.add('danger');
  $('#confirmTitle').textContent = '确认删除';
}
$('#confirmCancel').onclick = () => { resetConfirm(); };
$('#confirmOk').onclick = async () => {
  if (pendingApplyAdd) {
    pendingApplyAdd = false;
    $('#confirmModal').hidden = true;
    const a = lastAdd;
    const id = $('#adj_id').value;
    try {
      const r = await api('/api/holdings/' + id + '/adjust', { method: 'POST', body: JSON.stringify({ type: a.side || 'buy', quantity: a.q1, price: a.p1, fee: a.fee, note: '调仓计算器计入' }) });
      if (!r.ok) { let m = '计入失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m + ' (HTTP ' + r.status + ')', 'err'); return; }
      toast('已计入持仓（作为一笔' + (a.side === 'sell' ? '卖出' : '买入') + '交易）', 'ok');
      $('#adjustModal').hidden = true;
      await load();
    } catch (e) { toast('计入异常：' + e.message, 'err'); }
    resetConfirm();
    return;
  }
  if (pendingImport) {
    const data = pendingImport;
    pendingImport = null;
    $('#confirmModal').hidden = true;
    try {
      const r = await api('/api/import', { method: 'POST', body: JSON.stringify(data) });
      if (!r.ok) { let m = '导入失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m + ' (HTTP ' + r.status + ')', 'err'); return; }
      const d = await r.json();
      const im = d.imported || {}; const sk = d.skipped || {};
      toast(`导入完成：持仓 ${im.holdings || 0} 理财 ${im.wealth || 0} 现金 ${im.cash || 0} 负债 ${im.liability || 0} 消费 ${im.consumption || 0} 来源 ${im.sources || 0}；跳过 ${sk.holdings || 0}/${sk.wealth || 0}/${sk.cash || 0}/${sk.liability || 0}/${sk.consumption || 0}`, 'ok');
      if (d.errors && d.errors.length) console.warn('[import]', d.errors);
      await loadAsset();
      await load();
    } catch (e) { toast('导入异常：' + e.message, 'err'); }
    return;
  }
  if (pendingExport) {
    pendingExport = false;
    resetConfirm();
    exportHoldingsJSON();
    return;
  }
  if (pendingClearUserId) {
    const id = pendingClearUserId;
    pendingClearUserId = null;
    $('#confirmModal').hidden = true;
    try {
      const r = await api('/api/users/' + id + '/clear', { method: 'POST' });
      if (!r.ok) { let m = '清空失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m + ' (HTTP ' + r.status + ')', 'err'); return; }
      toast('已清空当前用户数据', 'ok');
      await load();
      await loadAsset();
      await loadAISettings();
      await loadGuides();
      await refreshUsers();
    } catch (e) { toast('清空异常：' + e.message, 'err'); }
    return;
  }
  if (pendingAssetDel) {
    const { type, id } = pendingAssetDel;
    $('#confirmModal').hidden = true;
    pendingAssetDel = null;
    const paths = { source: '/api/asset/sources/', wealth: '/api/asset/wealth/', cash: '/api/asset/cash/', liability: '/api/asset/liabilities/', consumption: '/api/asset/consumptions/' };
    try {
      const r = await api(paths[type] + id, { method: 'DELETE' });
      if (!r.ok) { let m = '删除失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m + ' (HTTP ' + r.status + ')', 'err'); return; }
    } catch (e) { toast('删除异常：' + e.message, 'err'); return; }
    toast('已删除', 'ok');
    loadAsset();
    return;
  }
  if (pendingSnapDelete) {
    const { wealth_id, date } = pendingSnapDelete;
    $('#confirmModal').hidden = true;
    pendingSnapDelete = null;
    try {
      const r = await api('/api/asset/wealth/snapshots?wealth_id=' + wealth_id + '&date=' + encodeURIComponent(date), { method: 'DELETE' });
      if (!r.ok) { let m = '删除失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m + ' (HTTP ' + r.status + ')', 'err'); return; }
      toast('已删除该日快照（可在审计记录撤销）', 'ok');
      await openWealthHistory(wealth_id);
      await loadAsset();
    } catch (e) { toast('删除异常：' + e.message, 'err'); }
    return;
  }
  const id = pendingDelId;
  $('#confirmModal').hidden = true;
  pendingDelId = null;
  if (!id) return;
  try {
    const r = await api('/api/holdings/' + id, { method: 'DELETE' });
    if (!r.ok) {
      let msg = '删除失败';
      try { const d = await r.json(); if (d && d.error) msg = d.error; } catch (_) {}
      toast(msg + ' (HTTP ' + r.status + ')', 'err');
      return;
    }
  } catch (e) {
    toast('删除异常：' + e.message, 'err');
    return;
  }
  toast('已删除', 'ok');
  load();
};

// 登录界面已移除：初始化时由 boot() 静默自动登录，无需手动输入
$('#addBtn').onclick = () => openModal(null);
$('#guideBtn').onclick = () => openGuide();
$('#f_category').onchange = () => {
  fillMarketOptions($('#f_category').value);
  const opts = CAT_MARKETS[$('#f_category').value] || [];
  $('#f_market').value = opts[0] || '';
  toggleLinkedSymbol($('#f_category').value);
};
// 首页「刷新」按钮已移除：手动整体刷新入口取消，行情改由定时快照自动更新。
// （批量 /api/refresh 接口仍保留供定时任务复用。）

// 视图切换（表格 / 卡片）：localStorage 记忆，桌面端默认表格
function syncViewToggle() {
  document.querySelectorAll('#viewToggle .vt-btn').forEach((x) => x.classList.toggle('active', x.dataset.view === holdingsView));
  positionIndicator();
}
// 滑动白块：根据当前 active 按钮定位指示器（宽 + 位移），实现左右平移动画
function positionIndicator() {
  const ind = document.getElementById('vtIndicator');
  if (!ind) return;
  const active = document.querySelector('#viewToggle .vt-btn.active');
  if (!active) return;
  ind.style.width = active.offsetWidth + 'px';
  ind.style.transform = 'translateX(' + active.offsetLeft + 'px)';
}
document.querySelectorAll('#viewToggle .vt-btn').forEach((b) => {
  b.onclick = () => {
    holdingsView = b.dataset.view;
    localStorage.setItem('pf_view', holdingsView);
    syncViewToggle();
    renderFiltered();
  };
});
syncViewToggle();
// 通用：根据当前 active 按钮定位滑动白块（支持首页与资产全景理财两个切换器）
function positionIndicatorFor(toggleId, indId) {
  const ind = document.getElementById(indId);
  if (!ind) return;
  const active = document.querySelector('#' + toggleId + ' .vt-btn.active');
  if (!active) return;
  ind.style.width = active.offsetWidth + 'px';
  ind.style.transform = 'translateX(' + active.offsetLeft + 'px)';
}
function syncWealthToggle() {
  document.querySelectorAll('#wealthViewToggle .vt-btn').forEach((x) => x.classList.toggle('active', x.dataset.wview === wealthView));
  positionIndicatorFor('wealthViewToggle', 'wealthVtIndicator');
  setTimeout(() => positionIndicatorFor('wealthViewToggle', 'wealthVtIndicator'), 0);
}
window.addEventListener('resize', () => { positionIndicator(); positionIndicatorFor('wealthViewToggle', 'wealthVtIndicator'); });
setTimeout(positionIndicator, 0); // 字体/布局稳定后校正初始位置
$('#emptyAddBtn').onclick = () => openModal(null);
// 文本筛选（设计系统：搜索框 + 「/」聚焦 + Enter 提交）
(function wireFilter() {
  const fi = document.getElementById('filterInput');
  if (!fi) return;
  const apply = () => { textFilter = fi.value.trim().toLowerCase(); curPage = 1; renderFiltered(); };
  fi.addEventListener('input', apply);
  fi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
})();

// ---- 来源筛选：点击首页持仓表表头「来源」弹出复选框，勾选后仅显示对应来源的持仓 ----
function renderSourceFilterList() {
  const box = $('#sourceFilterList');
  if (!box) return;
  box.innerHTML = '';
  const srcs = assetSources || [];
  if (!srcs.length) {
    box.innerHTML = '<p class="src-empty">暂无来源，请先在资产全景添加</p>';
    return;
  }
  srcs.forEach((s) => {
    const lbl = document.createElement('label');
    lbl.className = 'src-item';
    lbl.innerHTML = `<input type="checkbox" name="src-filter" value="${s.id}" ${sourceFilter.has(String(s.id)) ? 'checked' : ''}> <span>${esc(s.name)}</span>`;
    lbl.querySelector('input').addEventListener('change', applySourceFilter);
    box.appendChild(lbl);
  });
}
function applySourceFilter() {
  sourceFilter = new Set([...document.querySelectorAll('#sourceFilterList input:checked')].map((i) => i.value));
  updateSourceBadge();
  curPage = 1;
  renderFiltered();
}
function updateSourceBadge() {
  const b = $('#sourceBadge');
  if (!b) return;
  b.hidden = sourceFilter.size === 0;
  b.textContent = String(sourceFilter.size);
}
function toggleSourceFilterPop(force) {
  const th = $('#sourceTh');
  const pop = $('#sourceFilterPop');
  if (!th || !pop) return;
  const show = (force === undefined) ? pop.hidden : force;
  if (show) {
    renderSourceFilterList();
    const r = th.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(r.right - 224, window.innerWidth - 232)) + 'px';
    pop.hidden = false;
  } else {
    pop.hidden = true;
  }
}
$('#sourceTh').onclick = (e) => { e.stopPropagation(); toggleSourceFilterPop(); };
$('#srcApply').onclick = () => toggleSourceFilterPop(false);
$('#srcAll').onclick = () => { document.querySelectorAll('#sourceFilterList input').forEach((i) => { i.checked = true; }); applySourceFilter(); };
$('#srcNone').onclick = () => { document.querySelectorAll('#sourceFilterList input').forEach((i) => { i.checked = false; }); applySourceFilter(); };
document.addEventListener('click', (e) => {
  const pop = $('#sourceFilterPop');
  if (pop && !pop.hidden && !pop.contains(e.target) && !e.target.closest('#sourceTh')) {
    pop.hidden = true;
  }
});
// 资产空状态内联"添加"按钮（各空 tab 共用，data-empty-add 区分类型）
$('#assetTabBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-empty-add]');
  if (!b) return;
  const k = b.dataset.emptyAdd;
  if (k === 'wealth') openWealthModal(null);
  else if (k === 'cash') openCashModal(null);
  else if (k === 'liability') openLiabilityModal(null);
  else if (k === 'consume') openConsumeModal(null);
  else if (k === 'source') openAssetSourceModal(null);
});
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  $('#formErr').textContent = '';
  const id = $('#f_id').value;
  const eid = parseInt(id, 10);
  const orig = allHoldings.find((x) => x.id === eid);
  const payload = {
    name: $('#f_name').value,
    symbol: $('#f_symbol').value,
    category: $('#f_category').value,
    market: $('#f_market').value,
    currency: $('#f_currency').value,
    source_id: parseInt($('#f_source').value || '0', 10) || 0,
    quantity: round4(parseFloat($('#f_quantity').value)),
    cost_price: roundByCat(parseFloat($('#f_cost_price').value), $('#f_category').value),
    transaction_cost: roundByCat(parseFloat($('#f_cost').value || '0'), $('#f_category').value),
    current_price: roundByCat(parseFloat($('#f_current_price').value || '0'), $('#f_category').value),
    prev_close: roundByCat((orig ? orig.prev_close : 0), $('#f_category').value),
    note: $('#f_note').value || '',
    buy_date: $('#f_buy_date').value || '',
    linked_symbol: $('#f_linked_symbol').value || '',
  };
  let r;
  if (id) {
    r = await api('/api/holdings/' + id, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    r = await api('/api/holdings', { method: 'POST', body: JSON.stringify(payload) });
  }
  if (!r.ok) {
    let msg = '保存失败，请重试';
    try { const d = await r.json(); if (d && d.error) msg = d.error; } catch (_) {}
    $('#formErr').textContent = msg;
    return;
  }
  $('#modal').hidden = true;
  toast(id ? '已更新' : '已添加', 'ok');
  load();
};

// ---- Charts ----

function openChart() {
  $('#chartModal').hidden = false;
}
function closeChart() {
  $('#chartModal').hidden = true;
}

// Asset composition pie: 现金 / 股票 / 基金 / 理财 across the WHOLE portfolio,
// with click-to-drill second-level breakdown (e.g. 股票 -> each sub-stock's share).
const PIE_BASE = { 现金: '#E6DDD4', 理财: '#87C9C0', 基金: '#C39FC2', 股票: '#E6957A' };

// Blend hex color a toward b by ratio t∈[0,1] (used for sub-segment shades).
function mixHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Parse "#rrggbb" to {r,g,b} for building rgba() strings.
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// Top-level segments (现金/股票/基金/理财), values already in CNY.
function getTopSegs(d) {
  const eq = d.equity || {};
  let stock = 0, fund = 0;
  (eq.items || []).forEach((h) => {
    const mv = h.market_value || 0; // 后端已折算为 CNY
    if (h.category === 'stock') stock += mv;
    else if (h.category === 'fund') fund += mv;
  });
  const wealth = (d.wealth && d.wealth.total) || 0; // CNY
  const cash = (d.cash && d.cash.total) || 0;       // CNY
  const seg = { 现金: cash, 股票: stock, 基金: fund, 理财: wealth };
  return Object.keys(seg)
    .map((k) => ({ label: k, value: seg[k], color: PIE_BASE[k] }))
    .filter((s) => s.value > 0);
}

// Second-level items within a top-level category, values converted to CNY.
function getSubSegs(d, key) {
  let items = [];
  if (key === '股票' || key === '基金') {
    const cat = key === '股票' ? 'stock' : 'fund';
    items = (d.equity ? d.equity.items : []).filter((h) => h.category === cat)
      .map((h) => ({ label: h.name || h.symbol || '未命名', value: h.market_value || 0, _item: h }));
  } else if (key === '现金') {
    items = (d.cash ? d.cash.items : []).map((c) => ({ label: c.name || '现金', value: toRmb(c, c.amount || 0), _item: c }));
  } else if (key === '理财') {
    items = (d.wealth ? d.wealth.products : []).map((p) => ({ label: p.name || p.code || '理财', value: toRmb(p, p.amount || 0), _item: p }));
  }
  // 仅保留正值，并按总金额从小到大排序（饼图扇区与图例均按此顺序）
  items = items.filter((s) => s.value > 0).sort((a, b) => a.value - b.value);
  const base = PIE_BASE[key];
  const rgb = hexToRgb(base);
  const n = items.length;
  // 透明度按 10% 递减：占比越大越不透明（最大=1.0），最小不低于 0.4 以保证可见。
  // 用「同色相 + 透明度阶梯」替代原来的「向白色渐变」——相邻子项因透明度等差而区分度更高。
  return items.map((it, i) => {
    const op = Math.max(0.4, 1 - (n - 1 - i) * 0.1);
    return { ...it, color: `rgba(${rgb.r},${rgb.g},${rgb.b},${op.toFixed(2)})` };
  });
}

// Draw a pie (single-level) + legend into #chartBody.
function drawPie(segs, total, title, opts) {
  opts = opts || {};
  $('#chartTitle').textContent = title;
  if (total <= 0 || segs.length === 0) { $('#chartBody').innerHTML = '<p style="color:#8a8f99">暂无数据</p>'; openChart(); return; }
  const cx = 110, cy = 110, r = 90;
  let paths;
  const segClick = opts.onSeg
    ? ` data-label="${esc(segs[0].label)}" style="cursor:pointer"`
    : '';
  if (segs.length === 1) {
    paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${segs[0].color}" stroke="#fff" stroke-width="2"${segClick}/>`;
  } else {
    let angle = -Math.PI / 2;
    paths = '';
    segs.forEach((s) => {
      const frac = s.value / total;
      const a2 = angle + frac * 2 * Math.PI;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      paths += `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${s.color}" stroke="#fff" stroke-width="2"${opts.onSeg ? ` data-label="${esc(s.label)}" style="cursor:pointer"` : ''}/>`;
      angle = a2;
    });
  }
  const legend = segs.map((s) => {
    const p = (s.value / total * 100).toFixed(1);
    return `<div data-label="${esc(s.label)}" style="display:flex;align-items:center;gap:8px;font-size:14px${opts.onSeg ? ';cursor:pointer' : ''}">
      <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${s.color}"></span>
      <span>${esc(s.label)}</span><span style="font-weight:600">¥${fmt(s.value)} (${p}%)</span></div>`;
  }).join('');
  const back = opts.onBack
    ? `<div class="pie-back" data-back="1">← 返回总览</div>`
    : '';
  const hint = opts.onSeg ? `<div class="pie-hint">${opts.hint || '点击区块可查看二级细分'}</div>` : '';
  $('#chartBody').innerHTML = `${back}${hint}<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;justify-content:center">
    <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;justify-content:center"><svg width="220" height="220" viewBox="0 0 220 220">${paths}</svg></div>
    <div style="display:flex;flex-direction:column;gap:10px">${legend}</div></div>`;
  if (opts.onSeg) {
    $('#chartBody').querySelectorAll('[data-label]').forEach((el) => (el.onclick = () => opts.onSeg(el.dataset.label)));
  }
  if (opts.onBack) {
    const b = $('#chartBody').querySelector('[data-back]');
    if (b) b.onclick = opts.onBack;
  }
  openChart();
}

async function renderPie() {
  let d = assetData;
  if (!d || !d.equity) {
    try {
      const r = await api('/api/asset/overview');
      if (!r.ok) { toast('资产总览加载失败 (HTTP ' + r.status + ')', 'err'); return; }
      d = await r.json();
    } catch (e) {
      toast('资产总览加载异常：' + e.message, 'err'); return;
    }
  }
  pieData = d; // 缓存本次总览数据，供二级下钻 showPieDrill 使用，避免下钻时数据为空导致「暂无数据」
  const segs = getTopSegs(d);
  const total = segs.reduce((a, s) => a + s.value, 0);
  drawPie(segs, total, '资产构成（现金 / 股票 / 基金 / 理财）', {
    onSeg: (label) => showPieDrill(label),
  });
}

// Drill into a top-level category: show each sub-item's share of that category.
function showPieDrill(key) {
  const d = pieData || assetData || {};
  const sub = getSubSegs(d, key);
  const total = sub.reduce((a, s) => a + s.value, 0);
  drawPie(sub, total, `资产构成 › ${key}（二级细分占比）`, {
    onBack: () => renderPie(),
    onSeg: (label) => showItemDetail(key, label),
    hint: '点击区块查看该标的明细',
  });
}

// Second-level click: show a single sub-item's full details (same modal layout as level-1).
function showItemDetail(key, label) {
  const d = pieData || assetData || {};
  const sub = getSubSegs(d, key);
  const total = sub.reduce((a, s) => a + s.value, 0);
  const it = sub.find((x) => x.label === label);
  if (!it) { toast('未找到该明细', 'err'); return; }
  const raw = it._item || {};
  const cat = key === '股票' ? 'stock' : key === '基金' ? 'fund' : key;
  $('#chartTitle').textContent = `资产构成 › ${key} › ${esc(label)}`;
  const rows = [];
  if (cat === 'stock' || cat === 'fund') {
    const h = raw;
    rows.push(['分类', key]);
    if (h.symbol) rows.push(['代码', h.symbol]);
    rows.push(['占本类', (it.value / total * 100).toFixed(1) + '%']);
    rows.push(['市值 (CNY)', '¥' + fmt(toRmb(h, h.market_value || 0))]);
    rows.push(['成本 (CNY)', '¥' + fmt(toRmb(h, h.cost_value || 0))]);
    rows.push(['累计盈亏', `${fmt(toRmb(h, h.pnl || 0))}（${pct(h.pnl_pct || 0)}）`, cls(h.pnl || 0)]);
    rows.push(['数量', fmt(h.quantity || 0)]);
    rows.push(['成本价', fmtNav(h.cost_price, h.category)]);
    rows.push(['现价 / 净值', fmtNav(h.current_price, h.category)]);
    rows.push(['当日盈亏', `${fmt(toRmb(h, h.day_pnl || 0))}（${pct(h.day_pnl_pct || 0)}）`, cls(h.day_pnl || 0)]);
  } else if (cat === 'cash') {
    rows.push(['分类', '现金']);
    if (raw.currency) rows.push(['币种', raw.currency]);
    rows.push(['金额 (CNY)', '¥' + fmt(it.value)]);
  } else if (cat === 'wealth') {
    rows.push(['分类', '理财']);
    if (raw.code) rows.push(['代码', raw.code]);
    rows.push(['金额 (CNY)', '¥' + fmt(it.value)]);
  }
  const back = `<div class="pie-back" data-back="1">← 返回${key}明细</div>`;
  const body = rows.map(([k, v, c]) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:9px 4px;border-bottom:1px solid rgba(0,0,0,.06)"><span style="color:#8a8f99">${k}</span><span style="font-weight:600${c ? ' class="' + c + '"' : ''}">${v}</span></div>`).join('');
  $('#chartBody').innerHTML = back + `<div style="max-width:440px;margin:14px auto 0">${body}</div>`;
  const b = $('#chartBody').querySelector('[data-back]');
  if (b) b.onclick = () => showPieDrill(key);
  openChart();
}

// Daily P&L history: bar (daily P&L) + overlaid line (cumulative P&L).
// 支持左右翻页（每页 15 天），导航时复用缓存数据不重复请求接口。
let trendHist = null;    // 缓存的盈亏历史
let trendEndDate = null; // null=最新(今天)；否则为当前查看页的结束日期 YYYY-MM-DD

async function renderTrend() {
  $('#chartTitle').textContent = '盈亏走势（每日盈亏柱状 + 累计折线）';
  const r = await api('/api/pnl/history');
  if (!r.ok) { toast('加载盈亏历史失败 (HTTP ' + r.status + ')', 'err'); return; }
  const d = await r.json();
  trendHist = d.history || [];
  trendEndDate = null; // 每次打开回到最新
  drawTrend();
}

// 翻页：dir=-1 前 15 天，dir=+1 后 15 天；不超过今天
function shiftTrend(dir) {
  const PAGE = 15;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cur = trendEndDate ? parseYmd(trendEndDate) : new Date(today);
  cur.setHours(0, 0, 0, 0);
  let nxt = addDays(cur, dir * PAGE);
  if (nxt > today) nxt = new Date(today);
  trendEndDate = ymd(nxt);
  drawTrend();
}

function drawTrend() {
  const hist = trendHist || [];
  if (hist.length === 0) {
    $('#chartBody').innerHTML = '<p style="color:#8a8f99;line-height:1.6">暂无历史数据。系统每个交易日 15:15 自动记录（周末及法定节假日不记录），或点「刷新行情」即记录当日；之后此处显示每日盈亏柱状图与累计折线。<br>从记录之日起，每个交易日会生成一个数据点。</p>';
    openChart();
    return;
  }
  // 始终以 trendEndDate（默认今天）为终点展示最近 15 个日期槽位；无快照的日期用浅色占位柱补齐，
  // 保证一页固定 15 条、柱宽一致，缺失数据一目了然。
  const PAGE = 15;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = trendEndDate ? parseYmd(trendEndDate) : new Date(today);
  end.setHours(0, 0, 0, 0);
  if (end > today) end.setTime(today.getTime());
  const byDate = {};
  hist.forEach((h) => { byDate[h.date] = h; });
  const slots = [];
  for (let i = PAGE - 1; i >= 0; i--) {
    const ds = ymd(addDays(end, -i));
    const rec = byDate[ds];
    slots.push(rec ? { ...rec, hasData: true } : { date: ds, total_cny: 0, hasData: false });
  }
  let cum = 0;
  const data = slots.map((s) => { if (s.hasData) cum += s.total_cny; return { ...s, cum }; });
  const W = 720, H = 360, mL = 60, mR = 60, mT = 20, mB = 40;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const n = data.length;
  const maxBar = Math.max(1, ...data.map((x) => Math.abs(x.total_cny)));
  const cVals = data.map((x) => x.cum);
  // 累计盈亏与当日盈亏共用中央零基线、同半幅归一化，消除双轴割裂感
  const cMaxAbs = Math.max(1, ...cVals.map((v) => Math.abs(v)));
  const zeroY = mT + plotH / 2;
  const yBar = (v) => zeroY - (v / maxBar) * (plotH / 2);
  const yLine = (v) => zeroY - (v / cMaxAbs) * (plotH / 2);
  const slot = plotW / n;
  const bw = Math.max(2, slot * 0.6);
  const linePts = [];
  let bars = '', line = '', area = '', dots = '', hotspots = '';
  data.forEach((x, i) => {
    const cx = mL + (i + 0.5) * slot;
    // 交互热区：覆盖整列，hover 显示金额
    hotspots += `<rect class="trend-hot" data-i="${i}" x="${(mL + i * slot).toFixed(2)}" y="${mT}" width="${slot.toFixed(2)}" height="${plotH}" fill="transparent"/>`;
    const ly = yLine(x.cum);
    linePts.push([cx, ly]);
    if (!x.hasData) {
      // 占位：浅色细柱，表示当日无快照数据
      bars += `<rect x="${(cx - bw / 2).toFixed(2)}" y="${(zeroY - 1).toFixed(2)}" width="${bw.toFixed(2)}" height="2" fill="#e9ebf0"/>`;
      line += `${(i === 0 ? 'M' : 'L')} ${cx.toFixed(2)} ${ly.toFixed(2)} `;
      return;
    }
    const yv = yBar(x.total_cny);
    const top = Math.min(zeroY, yv), hgt = Math.abs(yv - zeroY);
    const color = x.total_cny > 0 ? '#f5222d' : x.total_cny < 0 ? '#00a854' : '#c9ced6';
    bars += `<rect x="${(cx - bw / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.5, hgt).toFixed(2)}" rx="2" fill="${color}"/>`;
    line += `${(i === 0 ? 'M' : 'L')} ${cx.toFixed(2)} ${ly.toFixed(2)} `;
    // 折线数据点圆点，对齐柱子中心，把柱与线焊在一起
    dots += `<circle cx="${cx.toFixed(2)}" cy="${ly.toFixed(2)}" r="3" fill="#722ed1" stroke="#fff" stroke-width="1.2"/>`;
  });
  // 面积：折线到中央零线的闭合带，给折线体量感、与柱子共用零线呼应
  if (linePts.length) {
    let ap = `M ${linePts[0][0].toFixed(2)} ${zeroY.toFixed(2)} `;
    linePts.forEach((p) => { ap += `L ${p[0].toFixed(2)} ${p[1].toFixed(2)} `; });
    ap += `L ${linePts[linePts.length - 1][0].toFixed(2)} ${zeroY.toFixed(2)} Z`;
    area = `<path d="${ap}" fill="rgba(114,46,209,0.10)" stroke="none"/>`;
  }
  // axes & grid
  const xLabelStep = Math.max(1, Math.ceil(n / 10));
  let xlabels = '';
  data.forEach((x, i) => {
    if (i % xLabelStep === 0 || i === n - 1) {
      const cx = mL + (i + 0.5) * slot;
      xlabels += `<text x="${cx.toFixed(2)}" y="${H - 14}" font-size="10" fill="#8a8f99" text-anchor="middle">${x.date.slice(5)}</text>`;
    }
  });
  const yLabels = `
    <text x="${mL - 6}" y="${(zeroY - plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#f5222d" text-anchor="end">+${fmt(maxBar)}</text>
    <text x="${mL - 6}" y="${(zeroY + 4).toFixed(2)}" font-size="10" fill="#8a8f99" text-anchor="end">0</text>
    <text x="${mL - 6}" y="${(zeroY + plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#00a854" text-anchor="end">-${fmt(maxBar)}</text>
    <text x="${W - mR + 6}" y="${(zeroY - plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#722ed1" text-anchor="start">+${fmt(cMaxAbs)}</text>
    <text x="${W - mR + 6}" y="${(zeroY + 4).toFixed(2)}" font-size="10" fill="#8a8f99" text-anchor="start">0</text>
    <text x="${W - mR + 6}" y="${(zeroY + plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#722ed1" text-anchor="start">-${fmt(cMaxAbs)}</text>`;
  const grid = `<line x1="${mL}" y1="${zeroY}" x2="${W - mR}" y2="${zeroY}" stroke="#e5e6eb" stroke-width="1"/>`;
  const legend = `
    <div style="display:flex;gap:18px;margin-top:10px;font-size:13px;flex-wrap:wrap">
      <span><span style="display:inline-block;width:12px;height:12px;background:#f5222d;border-radius:2px;margin-right:6px;vertical-align:middle"></span>当日盈亏 (红涨绿跌)</span>
      <span><span style="display:inline-block;width:18px;height:3px;background:#722ed1;margin-right:6px;vertical-align:middle"></span>累计盈亏</span>
      <span><span style="display:inline-block;width:12px;height:3px;background:#e9ebf0;margin-right:6px;vertical-align:middle"></span>无数据日 (占位)</span>
    </div>`;
  // 翻页导航：‹ 前15天 | 日期范围 | 后15天 › | 回最新
  const startLabel = data[0].date, endLabel = data[n - 1].date;
  const atLatest = end.getTime() >= today.getTime();
  const nav = `<div class="trend-nav">
    <button type="button" id="trendPrev" class="btn cal-nav-btn" title="前 15 天">‹</button>
    <span class="trend-range">${startLabel} ~ ${endLabel}</span>
    <button type="button" id="trendNext" class="btn cal-nav-btn" title="后 15 天"${atLatest ? ' disabled' : ''}>›</button>
    ${atLatest ? '' : '<button type="button" id="trendLatest" class="btn btn-sm" title="回到最新">最新</button>'}
  </div>`;
  $('#chartBody').innerHTML = `
    ${nav}<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${grid}${area}${bars}${hotspots}
      <path d="${line}" fill="none" stroke="#722ed1" stroke-width="2" stroke-linejoin="round"/>
      ${dots}${yLabels}${xlabels}
    </svg>${legend}`;
  // 绑定柱子交互热区 tooltip
  document.querySelectorAll('#chartBody .trend-hot').forEach((r) => {
    const i = +r.dataset.i;
    r.addEventListener('mouseenter', (e) => showTrendTip(e, data[i]));
    r.addEventListener('mousemove', moveTrendTip);
    r.addEventListener('mouseleave', hideTrendTip);
  });
  // 绑定翻页按钮
  const p = document.getElementById('trendPrev'); if (p) p.onclick = () => shiftTrend(-1);
  const nx = document.getElementById('trendNext'); if (nx) nx.onclick = () => shiftTrend(1);
  const lt = document.getElementById('trendLatest'); if (lt) lt.onclick = () => { trendEndDate = null; drawTrend(); };
  openChart();
}

// 盈亏走势 tooltip：hover 柱子显示当日/累计盈亏
function showTrendTip(e, x) {
  let tip = document.getElementById('trendTip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'trendTip'; tip.className = 'trend-tip'; document.body.appendChild(tip); }
  const cls = x.total_cny > 0 ? 't-up' : x.total_cny < 0 ? 't-down' : 't-muted';
  const sign = x.total_cny > 0 ? '+' : '';
  const dayStr = x.hasData ? sign + fmt(x.total_cny) : '—';
  const cumCls = x.cum > 0 ? 't-up' : x.cum < 0 ? 't-down' : 't-muted';
  tip.innerHTML = '<div class="t-date">' + x.date + (x.hasData ? '' : '（无数据）') + '</div>'
    + '<div class="t-row"><span>当日盈亏</span><span class="' + cls + '">' + dayStr + '</span></div>'
    + '<div class="t-row"><span>累计盈亏</span><span class="' + cumCls + '">' + fmt(x.cum) + '</span></div>';
  tip.classList.add('show');
  moveTrendTip(e);
}
function moveTrendTip(e) {
  const tip = document.getElementById('trendTip'); if (!tip) return;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > window.innerWidth) x = e.clientX - r.width - 14;
  if (y + r.height > window.innerHeight) y = e.clientY - r.height - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTrendTip() { const tip = document.getElementById('trendTip'); if (tip) tip.classList.remove('show'); }

// 资产工具栏按钮改由 #assetToolbar 事件委托（见下方 document.getElementById('assetToolbar').addEventListener）
// 关闭按钮已移除：右上角 ✕ 与点击遮罩均可关闭
$('#chartModal').addEventListener('click', (e) => { if (e.target === $('#chartModal')) $('#chartModal').hidden = true; });
$('#histModal').addEventListener('click', (e) => { if (e.target === $('#histModal')) $('#histModal').hidden = true; });

// ---- P&L Calendar ----
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sundayOf = (d) => addDays(new Date(d), -d.getDay());
const saturdayOf = (d) => addDays(new Date(d), 6 - d.getDay());

let calData = {};

// 打开盈亏日历视图（资产全景工具栏「📅 盈亏日历」）
// 路由模式下只负责「进入」：已显示则保持（返回用浏览器后退/主页）
async function openCalendarView() {
  // 无可见视图时，先落回首页作弹框背景
  if ($('#holdingsView').hidden && $('#assetView').hidden) {
    showHoldingsView();
  }
  $('#calendarModal').hidden = false;
  calViewDate = new Date();   // 打开时回到当月
  await renderCalendar();
}

function showHoldingsView() {
  $('#assetView').hidden = true;
  $('#holdingsView').hidden = false;
  syncViewToggle(); // 回到主页时同步滑块选中态与白块位置
  // 首页：显示更新时间+汇率行（资产工具按钮常驻 header，不在此隐藏）
  const mb = document.getElementById('marketBar'); if (mb) mb.hidden = false;
}

// 「观澜」标题文本：点击回到主页
$('#brandTitle').onclick = () => {
  navigate('holdings');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
// ESC 键：从任意二级页（资产/速算/日历）返回主页
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const tag = (t.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  // 「/」聚焦筛选（设计系统：快捷聚焦搜索框）
  if (e.key === '/' && !typing) {
    const fi = document.getElementById('filterInput');
    if (fi) { e.preventDefault(); fi.focus(); }
    return;
  }
  if (e.key !== 'Escape') return;
  // 弹框优先（含通知弹框），ESC 直接关闭
  const openModals = document.querySelectorAll('.modal:not([hidden])');
  if (openModals.length) {
    openModals.forEach((m) => { m.hidden = true; });
    return;
  }
  const inSubView = !$('#assetView').hidden;
  if (inSubView) {
    navigate('holdings');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
$('#calPrev').onclick = () => { calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1); drawCalMonth(); };
$('#calNext').onclick = () => { calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1); drawCalMonth(); };

// 盈亏日历：点击月份标题弹出年/月快速跳转
let calJumpYear = new Date().getFullYear();
$('#calTitle').onclick = () => openCalJump();
$('#calJumpClose').onclick = () => { $('#calJumpModal').hidden = true; };
$('#calJumpPrevY').onclick = () => { calJumpYear--; renderCalJump(); };
$('#calJumpNextY').onclick = () => { calJumpYear++; renderCalJump(); };
function openCalJump() {
  calJumpYear = calViewDate.getFullYear();
  renderCalJump();
  $('#calJumpModal').hidden = false;
}
function renderCalJump() {
  $('#calJumpYear').textContent = calJumpYear + ' 年';
  const curM = calViewDate.getMonth() + 1;
  const curY = calViewDate.getFullYear();
  let html = '';
  for (let m = 1; m <= 12; m++) {
    const active = (m === curM && calJumpYear === curY) ? ' active' : '';
    html += `<button class="btn cal-jump-m${active}" data-m="${m}" type="button">${m}月</button>`;
  }
  const box = $('#calJumpMonths');
  box.innerHTML = html;
  box.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = () => {
      calViewDate = new Date(calJumpYear, parseInt(b.dataset.m, 10) - 1, 1);
      drawCalMonth();
      $('#calJumpModal').hidden = true;
    };
  });
}

// 日历弹框：前一天 / 后一天（跳到有快照数据的前/后一个日期，便于连续浏览盈亏）
$('#calModalPrev').onclick = () => shiftCalDay(-1);
$('#calModalNext').onclick = () => shiftCalDay(1);
$('#calGrid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-cell');
  if (cell && cell.dataset.date) openCalDay(cell.dataset.date);
});

// 当前日历弹框打开的日期
let calModalCurDate = null;
// 在 calData 中向前/向后跳到相邻的有数据日期；无相邻数据则按日历 ±1 天（仍可浏览空档）
function shiftCalDay(dir) {
  if (!calModalCurDate) return;
  const dates = Object.keys(calData).sort();
  if (dates.length) {
    const idx = dates.indexOf(calModalCurDate);
    if (idx >= 0) {
      const ni = idx + dir;
      if (ni >= 0 && ni < dates.length) { openCalDay(dates[ni]); return; }
    }
  }
  // 回退：纯日历 ±1 天
  const d = new Date(calModalCurDate + 'T00:00:00');
  d.setDate(d.getDate() + dir);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  openCalDay(y + '-' + m + '-' + day);
}

// 盈亏日历：仅显示当前查看月份，支持上/下月切换
let calViewDate = new Date();   // 当前查看的月份
// 日历月份记忆（设计系统：二级页记忆日历月份）
function saveCalMonth() {
  try { localStorage.setItem('pf_cal_month', calViewDate.getFullYear() + '-' + (calViewDate.getMonth() + 1)); } catch (_) {}
}
function restoreCalMonth() {
  try {
    const s = localStorage.getItem('pf_cal_month');
    if (s && /^\d{4}-\d{1,2}$/.test(s)) {
      const p = s.split('-'); calViewDate = new Date(+p[0], +p[1] - 1, 1); return;
    }
  } catch (_) {}
  calViewDate = new Date();
}
restoreCalMonth();
let calMaxAbs = 1;              // 盈亏着色归一化最大值

async function renderCalendar() {
  const r = await api('/api/pnl/history');
  if (!r.ok) { toast('加载盈亏历史失败 (HTTP ' + r.status + ')', 'err'); return; }
  const d = await r.json();
  const hist = d.history || [];
  calData = {};
  hist.forEach((h) => { calData[h.date] = h; });
  calMaxAbs = 1;
  hist.forEach((h) => { const a = Math.abs(h.total_cny); if (a > calMaxAbs) calMaxAbs = a; });
  drawCalMonth();
}

// 绘制 calViewDate 所在月份的网格（7 列：日 一 二 三 四 五 六）
function drawCalMonth() {
  const y = calViewDate.getFullYear();
  const m = calViewDate.getMonth();
  $('#calTitle').textContent = y + '年' + (m + 1) + '月';

  // 当月总盈亏：所查看月份所有有数据日期的 total_cny 求和（切换月份自动更新）
  const monthPrefix = y + '-' + String(m + 1).padStart(2, '0');
  let monthPnl = 0, monthDays = 0;
  for (const ds in calData) {
    if (ds.startsWith(monthPrefix)) {
      monthPnl += calData[ds].total_cny || 0;
      monthDays++;
    }
  }
  const ms = $('#calMonthSummary');
  if (ms) {
    if (!monthDays) {
      ms.innerHTML = '<span class="cal-ms-label">本月暂无盈亏数据</span>';
    } else {
      const msCls = monthPnl > 0 ? 'up' : monthPnl < 0 ? 'down' : 'flat';
      const sign = monthPnl >= 0 ? '+' : '';
      let emoji = '😐';
      if (monthPnl > 0) emoji = '📈';
      else if (monthPnl < 0) emoji = '📉';
      ms.innerHTML = '<span class="cal-ms-label">本月总盈亏</span>'
        + `<span class="cal-ms-val ${msCls}">${emoji}¥${sign}${fmt(monthPnl)}</span>`;
    }
  }

  const first = new Date(y, m, 1);
  const start = sundayOf(first);                       // 该月1号所在周的周日
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const last = new Date(y, m, daysInMonth);
  const end = saturdayOf(last);                        // 该月最后一天所在周的周六

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const cur = new Date(start);
  let cells = '';
  while (cur <= end) {
    for (let i = 0; i < 7; i++) {
      const inMonth = cur.getMonth() === m;
      const ds = ymd(cur);
      if (!inMonth) {
        cells += '<div class="cal-cell cal-out"></div>';
      } else if (cur > today) {
        // 未来日期尚未发生，无数据
        cells += '<div class="cal-cell cal-future" data-date="' + ds + '"><span class="cal-day">' + cur.getDate() + '</span></div>';
      } else {
        const rec = calData[ds];
        let color, emoji = '';
        if (!rec) color = 'lg-none';
        else {
          const v = rec.total_cny;
          if (Math.abs(v) < 1e-9) { color = 'lg-zero'; emoji = '😐'; }
          else {
            const t = Math.min(1, Math.abs(v) / calMaxAbs);
            const lvl = t < 0.25 ? 1 : t < 0.5 ? 2 : t < 0.75 ? 3 : 4;
            color = (v > 0 ? 'lg-up' : 'lg-down') + lvl;
            // 情绪脸方案：盈/亏各 4 档，从微笑😊到狂喜😍、从皱眉🙁到惊恐😱，风格统一且直觉
            emoji = v > 0 ? ['😊', '😄', '😁', '😍'][lvl - 1] : ['🙁', '😟', '😣', '😱'][lvl - 1];
          }
        }
        const isToday = cur.getTime() === today.getTime();
        const pnlTxt = rec ? fmt(rec.total_cny) : '—';
        const title = ds + (rec ? ('：当日盈亏 ' + pnlTxt + ' CNY') : '：无快照数据');
        const dayNum = cur.getDate();
        const valHtml = '<span class="cal-val">' + pnlTxt + '</span>';
        cells += '<div class="cal-cell ' + color + ' has-amt' + (isToday ? ' cal-today' : '') + '" data-date="' + ds + '" title="' + title + '"><span class="cal-day">' + dayNum + '</span><span class="cal-emoji">' + emoji + '</span>' + valHtml + '</div>';
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  const grid = $('#calGrid');
  grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
  grid.innerHTML = cells;
  saveCalMonth();
}

function openCalDay(date) {
  calModalCurDate = date;
  const rec = calData[date];
  $('#calModalDate').textContent = date + ' 盈亏明细';
  if (!rec) {
    $('#calModalBody').innerHTML = '<p style="color:#8a8f99">当日无快照数据。</p>';
    $('#calModal').hidden = false;
    return;
  }
  const v = rec.total_cny;
  let rows = '';
  let wRows = '';
  let equityCNY = 0, wealthCNY = 0;
  try {
    const det = JSON.parse(rec.detail || '{}');
    const syms = det.by_symbol || [];
    if (syms.length) {
      rows = '<table class="cal-detail-tbl"><thead><tr><th>代码</th><th>名称</th><th>币种</th><th class="num">当日盈亏 (CNY)</th></tr></thead><tbody>' +
        syms.map((s) => {
          // 优先用快照时折算的 CNY 值；旧快照无该字段则用当前汇率回退折算
          const cny = (typeof s.pnl_cny === 'number') ? s.pnl_cny : toRmb({ currency: s.currency }, s.pnl);
          return '<tr><td>' + s.symbol + '</td><td>' + (s.name || '') + '</td><td>' + (s.currency || '') + '</td><td class="num ' + cls(cny) + '">' + fmt(cny) + '</td></tr>';
        }).join('') +
        '</tbody></table>';
      syms.forEach((s) => { const c = (typeof s.pnl_cny === 'number') ? s.pnl_cny : toRmb({ currency: s.currency }, s.pnl); equityCNY += c; });
    } else rows = '<p style="color:#8a8f99">无个股明细。</p>';
    // 理财当日收益（已合并进 total_cny）
    const wts = det.by_wealth || [];
    if (wts.length) {
      wRows = '<table class="cal-detail-tbl" style="margin-top:10px"><thead><tr><th>理财</th><th>币种</th><th class="num">当日盈亏 (CNY)</th></tr></thead><tbody>' +
        wts.map((w) => '<tr><td>' + (w.name || '') + '</td><td>' + (w.currency || '') + '</td><td class="num ' + cls(w.pnl_cny) + '">' + fmt(w.pnl_cny) + '</td></tr>').join('') +
        '</tbody></table>';
      wts.forEach((w) => { wealthCNY += (typeof w.pnl_cny === 'number') ? w.pnl_cny : 0; });
    }
  } catch (e) { rows = '<p style="color:#f5222d">明细解析失败</p>'; }
  $('#calModalBody').innerHTML = `
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:14px">
      <div><div class="cal-sub">当日盈亏 (CNY)</div><div class="value ${cls(v)}">${fmt(v)}</div></div>
      <div><div class="cal-sub">权益盈亏 (CNY)</div><div class="value ${cls(equityCNY)}">${fmt(equityCNY)}</div></div>
      <div><div class="cal-sub">理财盈亏 (CNY)</div><div class="value ${cls(wealthCNY)}">${fmt(wealthCNY)}</div></div>
    </div>${rows}${wRows}`;
  $('#calModal').hidden = false;
}

// ---- AI 总结历史 ----
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function loadAIHistory() {
  try {
    const r = await api('/api/ai/history');
    if (!r.ok) { toast('加载历史失败 (HTTP ' + r.status + ')', 'err'); return; }
    const d = await r.json();
    const list = d.history || [];
    const box = $('#aiHistoryList');
    if (!list.length) {
      box.innerHTML = '<p style="color:#8a8f99">暂无历史记录。生成 AI 总结后会自动保存。</p>';
      return;
    }
    box.innerHTML = list.map((it) => `
      <div class="ai-history-item" data-id="${it.id}">
        <div class="ai-history-meta"><span>${it.created_at}</span><span>${it.model || ''}</span></div>
        <div class="ai-history-preview">${escapeHtml(it.content)}</div>
      </div>`).join('');
    box.querySelectorAll('.ai-history-item').forEach((el) => {
      el.onclick = () => {
        const rec = list.find((x) => String(x.id) === el.dataset.id);
        if (rec) openAIResultModal(rec.content);
      };
    });
  } catch (e) { toast('加载历史异常：' + e.message, 'err'); }
}

// Export a full snapshot of ALL asset data (持仓/股票/基金/理财/现金/负债/消费) to JSON.
async function exportHoldingsJSON() {
  // 并行拉取：持仓明细（股票+基金，字段最全）与全量资产快照（各分类汇总 + 明细）
  const [hResp, oResp] = await Promise.all([
    api('/api/holdings'),
    api('/api/asset/overview'),
  ]);
  let holdings = allHoldings || [];
  if (hResp.ok) { try { const d = await hResp.json(); if (d && d.holdings) holdings = d.holdings; } catch (_) {} }
  let overview = null;
  if (oResp.ok) { try { overview = await oResp.json(); } catch (_) {} }

  const eq = (overview && overview.equity && overview.equity.items) || [];
  const wealth = (overview && overview.wealth && overview.wealth.products) || [];
  const cash = (overview && overview.cash && overview.cash.items) || [];
  const liability = (overview && overview.liability && overview.liability.items) || [];
  const consumption = (overview && overview.consumption && overview.consumption.items) || [];
  const total = holdings.length + wealth.length + cash.length + liability.length + consumption.length;
  if (!total) { toast('暂无可导出的数据', 'err'); return; }

  const payload = {
    exported_at: new Date().toISOString(),
    rates: { usd_cny: usdRate, hkd_cny: hkdRate },
    summary: {
      holding_count: holdings.length,        // 股票 + 基金
      wealth_count: wealth.length,           // 理财
      cash_count: cash.length,               // 现金
      liability_count: liability.length,     // 负债
      consumption_count: consumption.length, // 消费
    },
    holdings: holdings,     // 股票 + 基金完整明细
    wealth: wealth,         // 理财
    cash: cash,             // 现金
    liability: liability,   // 负债
    consumption: consumption, // 消费
    asset_overview: overview, // 全量快照（含各分类汇总与净资产），确保不丢任何字段
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '持仓与资产数据_' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('数据已导出：持仓 ' + holdings.length + ' / 理财 ' + wealth.length + ' / 现金 ' + cash.length + ' 条', 'ok');
}

// ---- AI 持仓总结 ----
let aiCfg = { api_key: '', model: 'deepseek-v4-pro', base_url: 'https://api.deepseek.com', templates: [] };
let aiSelIdx = 0;
let aiModelIdx = 0; // 当前选中的模型配置下标（models 数组）

function defaultAITemplates() {
  return [
    { name: '诙谐幽默', content: '你是一位喜欢拿用户持仓开涮、但数据从不乱编的财经段子手。请基于下面「我的持仓数据」，用诙谐、幽默、带点调侃（可以适度玩梗、使用表情符号）的口吻，给我写一份专属的「持仓体检报告」。\n要求：\n1. 先来一句风趣的总体定调（赚麻了还是绿油油）；\n2. 挑几个有代表性的持仓点评一下，夸就夸到位，亏就损到位，但数字必须准确；\n3. 用轻松的方式点出风险或槽点；\n4. 结尾给一句毒舌又实在的寄语。\n不要说教，多用口语，篇幅适中（300~500字）。\n\n我的持仓数据如下：\n{{DATA}}' },
    { name: '专业视角', content: '你是一名严谨、客观、专业的投资顾问。请基于下面的「我的持仓数据」，用专业、结构化、条理清晰的视角，做一份持仓分析报告。\n要求：\n1. 组合概览：总资产、总盈亏及收益率、RMB/USD 市值分布；\n2. 结构分析：股票与基金的占比、各市场分布、单一标的集中度风险；\n3. 当日表现：当日盈亏与当日盈亏率的整体与个股情况；\n4. 风险提示：结合回撤、集中度、币种敞口给出客观判断；\n5. 配置建议：基于以上数据给出 2~3 条可执行的优化建议。\n语言专业克制，避免夸张表述，可适度使用分点与小标题，篇幅 400~600字。\n\n我的持仓数据如下：\n{{DATA}}' },
  ];
}

async function loadAISettings() {
  try {
    const r = await api('/api/ai/settings');
    if (!r.ok) return;
    const d = await r.json();
    aiCfg = Object.assign({ api_key: '', model: 'deepseek-v4-pro', base_url: 'https://api.deepseek.com', templates: [] }, d);
    // Fall back to the locally saved key if the DB config has none (e.g. key lost
    // after a backend reset), so the user doesn't have to retype it.
    if (!aiCfg.api_key) {
      const lk = (localStorage.getItem('pf_ai_key') || '').trim();
      if (lk) aiCfg.api_key = lk;
    }
    if (!aiCfg.templates || !aiCfg.templates.length) aiCfg.templates = defaultAITemplates();
    // 多模型：兼容旧单条配置，迁移为 models 数组（旧版仅存 api_key/model/base_url）
    if (!Array.isArray(aiCfg.models) || !aiCfg.models.length) {
      aiCfg.models = [{ name: '默认', model: aiCfg.model || 'deepseek-v4-pro', api_key: aiCfg.api_key || '', base_url: aiCfg.base_url || 'https://api.deepseek.com' }];
    }
    if (aiModelIdx >= aiCfg.models.length) aiModelIdx = 0;
  } catch (e) { /* 忽略，使用默认值 */ }
  $('#aiAutoDaily').checked = !!aiCfg.auto_daily;
  $('#aiAutoSend').checked = !!aiCfg.auto_send;
  renderModelSelect();
}

// 多模型配置：渲染下拉、切换选中项、同步输入框
function renderModelSelect() {
  const sel = $('#ai_model_sel');
  if (!sel) return;
  if (!Array.isArray(aiCfg.models) || !aiCfg.models.length) {
    aiCfg.models = [{ name: '默认', model: 'deepseek-v4-pro', api_key: '', base_url: 'https://api.deepseek.com' }];
  }
  if (aiModelIdx >= aiCfg.models.length) aiModelIdx = 0;
  sel.innerHTML = aiCfg.models.map((m, i) => `<option value="${i}">${m.name || ('模型' + (i + 1))}</option>`).join('');
  sel.value = String(aiModelIdx);
  selectModel(aiModelIdx);
}

function selectModel(i) {
  aiModelIdx = i;
  const m = aiCfg.models[i];
  if (!m) return;
  $('#ai_cfg_name').value = m.name || '';
  $('#ai_model').value = m.model || 'deepseek-v4-pro';
  $('#ai_apikey').value = m.api_key || '';
  $('#ai_baseurl').value = m.base_url || 'https://api.deepseek.com';
}

function syncModelFromInputs() {
  if (!Array.isArray(aiCfg.models) || !aiCfg.models.length) {
    aiCfg.models = [{ name: '', model: '', api_key: '', base_url: '' }];
  }
  if (!aiCfg.models[aiModelIdx]) aiCfg.models[aiModelIdx] = { name: '', model: '', api_key: '', base_url: '' };
  const m = aiCfg.models[aiModelIdx];
  m.name = $('#ai_cfg_name').value.trim();
  m.model = $('#ai_model').value.trim() || 'deepseek-v4-pro';
  m.api_key = $('#ai_apikey').value.trim();
  m.base_url = $('#ai_baseurl').value.trim() || 'https://api.deepseek.com';
}

function renderTplSelect() {
  const sel = $('#ai_tpl_sel');
  if (!aiCfg.templates.length) aiCfg.templates = defaultAITemplates();
  if (aiSelIdx >= aiCfg.templates.length) aiSelIdx = 0;
  sel.innerHTML = aiCfg.templates.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
  sel.value = String(aiSelIdx);
  selectTpl(aiSelIdx);
}

function selectTpl(i) {
  aiSelIdx = i;
  const t = aiCfg.templates[i];
  if (!t) return;
  $('#ai_tpl_name').value = t.name;
  $('#ai_tpl_content').value = t.content;
}

function openAIModal() {
  switchHubTab('settings');
}

// 总结面板里的提示词模板下拉（与设置面板独立，便于一键总结时直接选模板）
function renderPickTplSelect() {
  const sel = $('#aiPickTpl');
  if (!sel) return;
  if (!aiCfg.templates.length) aiCfg.templates = defaultAITemplates();
  sel.innerHTML = aiCfg.templates.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
  sel.value = String(aiSelIdx);
}

function openAIResultModal(text, loading) {
  const body = $('#aiResultBody');
  if (loading) {
    body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:10px;color:var(--text-muted)';
    const sp = document.createElement('span');
    sp.className = 'ana-funnel';
    sp.style.fontSize = '22px';
    sp.textContent = '⏳';
    const tx = document.createElement('span');
    tx.textContent = text;
    wrap.appendChild(sp);
    wrap.appendChild(tx);
    body.appendChild(wrap);
  } else {
    body.textContent = text;
  }
  $('#aiResultModal').hidden = false;
}

// 把模型返回的 content 安全地写入结果弹框；空/纯空白时显式占位，避免“看似没反显”
function setAIResult(text) {
  const t = (text != null) ? String(text) : '';
  $('#aiResultBody').textContent = t.trim() ? t : '（模型返回为空）';
}

async function aiSaveSettings() {
  $('#aiErr').textContent = '';
  // 先把当前输入写回选中的模型配置（多模型），再统一持久化
  syncModelFromInputs();
  const boxKey = $('#ai_apikey').value.trim();
  if (boxKey) {
    // 框内有值：用框内 key 并写入 localStorage
    aiCfg.api_key = boxKey;
    localStorage.setItem('pf_ai_key', boxKey);
  } else {
    // 框为空：绝不清成空串。优先沿用 localStorage，再沿用已加载的原值（库里的 key）
    const lsKey = (localStorage.getItem('pf_ai_key') || '').trim();
    if (lsKey) aiCfg.api_key = lsKey;
    // 否则保持 aiCfg.api_key 不变（来自库的旧值），避免覆盖成空导致下次生成 401
  }
  // 保持单字段与当前选中模型一致（向后兼容生成路径读取 aiCfg.model/api_key/base_url）
  const cur = aiCfg.models[aiModelIdx];
  if (cur) {
    aiCfg.model = cur.model || 'deepseek-v4-pro';
    aiCfg.base_url = cur.base_url || 'https://api.deepseek.com';
  } else {
    aiCfg.model = $('#ai_model').value.trim() || 'deepseek-v4-pro';
    aiCfg.base_url = $('#ai_baseurl').value.trim() || 'https://api.deepseek.com';
  }
  aiCfg.auto_daily = $('#aiAutoDaily').checked;
  aiCfg.auto_send = $('#aiAutoSend').checked;
  if (aiCfg.templates[aiSelIdx]) {
    aiCfg.templates[aiSelIdx].name = $('#ai_tpl_name').value.trim() || ('模板' + (aiSelIdx + 1));
    aiCfg.templates[aiSelIdx].content = $('#ai_tpl_content').value;
  }
  try {
    const r = await api('/api/ai/settings', { method: 'POST', body: JSON.stringify(aiCfg) });
    if (!r.ok) {
      let m = '保存失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {}
      $('#aiErr').textContent = m;
      return;
    }
    toast('AI 设置已保存', 'ok');
    $('#aiHubModal').hidden = true;
  } catch (e) {
    $('#aiErr').textContent = '保存异常：' + e.message;
  }
}

async function aiSummarize(tplIdx) {
  // Prefer the key currently typed in the box; fall back to the locally saved key
  // (localStorage) and then the config key. The frontend now sends the key so a
  // freshly entered/updated key takes effect immediately without a separate save —
  // otherwise a stale/invalid saved key makes every summary 401.
  const boxKey = ($('#ai_apikey') ? $('#ai_apikey').value : '').trim();
  const lsKey = (localStorage.getItem('pf_ai_key') || '').trim();
  const api_key = boxKey || lsKey || (aiCfg.api_key || '').trim();
  const model = ($('#ai_model').value || '').trim() || 'deepseek-v4-pro';
  const base_url = ($('#ai_baseurl').value || '').trim() || 'https://api.deepseek.com';
  const edited = $('#ai_tpl_content').value;
  let content;
  if (typeof tplIdx === 'number' && aiCfg.templates[tplIdx]) content = aiCfg.templates[tplIdx].content;
  else content = (edited && edited.trim()) ? edited : (aiCfg.templates[aiSelIdx] ? aiCfg.templates[aiSelIdx].content : '');
  if (!api_key) { toast('请先在「AI 设置」填写 API Key', 'err'); openAIModal(); return; }
  if (api_key) localStorage.setItem('pf_ai_key', api_key);
  if (!content) { toast('提示词模板为空', 'err'); return; }
  openAIResultModal('生成中…（模型思考中，请稍候，最长约 3 分钟）', true);
  $('#aiPickGo').disabled = true;
  try {
    const r = await api('/api/ai/summary', { method: 'POST', body: JSON.stringify({ api_key, model, base_url, template: content }) });
    if (!r.ok) {
      let m = '生成失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {}
      $('#aiResultBody').textContent = m;
      return;
    }
    const d = await r.json();
    $('#aiResultBody').textContent = d.content || '（模型返回为空）';
    toast('AI 总结已生成并保存到历史', 'ok');
  } catch (e) {
    $('#aiResultBody').textContent = '请求异常：' + e.message;
  } finally {
    $('#aiPickGo').disabled = false;
  }
}

function copyText(txt) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(txt).then(() => toast('已复制', 'ok'), () => fallbackCopy(txt));
  } else {
    fallbackCopy(txt);
  }
}
function fallbackCopy(txt) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('已复制', 'ok'); }
  catch (e) { toast('复制失败，请手动选择', 'err'); }
  document.body.removeChild(ta);
}

// AI 事件绑定
$('#ai_save').onclick = aiSaveSettings;
$('#ai_tpl_sel').onchange = (e) => selectTpl(parseInt(e.target.value, 10));
$('#ai_tpl_new').onclick = () => {
  aiCfg.templates.push({ name: '新模板' + (aiCfg.templates.length + 1), content: '请基于以下我的持仓数据，给出总结：\n{{DATA}}' });
  aiSelIdx = aiCfg.templates.length - 1;
  renderTplSelect();
  $('#ai_tpl_name').focus();
};
$('#ai_tpl_del').onclick = () => {
  if (aiCfg.templates.length <= 1) { toast('至少保留一个模板', 'err'); return; }
  aiCfg.templates.splice(aiSelIdx, 1);
  aiSelIdx = Math.max(0, aiSelIdx - 1);
  renderTplSelect();
};
// 多模型配置：切换 / 新增 / 删除
$('#ai_model_sel').onchange = (e) => selectModel(parseInt(e.target.value, 10));
$('#ai_model_new').onclick = () => {
  syncModelFromInputs();
  aiCfg.models.push({ name: '新模型' + (aiCfg.models.length + 1), model: 'deepseek-v4-pro', api_key: '', base_url: 'https://api.deepseek.com' });
  aiModelIdx = aiCfg.models.length - 1;
  renderModelSelect();
  $('#ai_cfg_name').focus();
};
$('#ai_model_del').onclick = () => {
  if (aiCfg.models.length <= 1) { toast('至少保留一个模型配置', 'err'); return; }
  aiCfg.models.splice(aiModelIdx, 1);
  aiModelIdx = Math.max(0, aiModelIdx - 1);
  renderModelSelect();
};
$('#ai_toggleKey').onclick = () => {
  const inp = $('#ai_apikey');
  if (inp.type === 'password') { inp.type = 'text'; $('#ai_toggleKey').textContent = '隐藏'; }
  else { inp.type = 'password'; $('#ai_toggleKey').textContent = '显示'; }
};
$('#ai_copy').onclick = () => copyText($('#aiResultBody').textContent);

// ---- AI 中枢弹框（总结下拉选择 + 功能 / 设置 / 历史，tab 切换） ----
function switchHubTab(tab) {
  $('#hubTabSummary').classList.toggle('active', tab === 'summary');
  $('#hubTabSettings').classList.toggle('active', tab === 'settings');
  $('#hubTabHistory').classList.toggle('active', tab === 'history');
  $('#hubSummaryPanel').hidden = tab !== 'summary';
  $('#hubSettingsPanel').hidden = tab !== 'settings';
  $('#hubHistoryPanel').hidden = tab !== 'history';
  $('#aiHubModal').hidden = false;
  if (tab === 'summary') renderPickTplSelect();
  if (tab === 'settings') { renderTplSelect(); renderModelSelect(); }
  if (tab === 'history') loadAIHistory();
}
// 首页 AI 按钮：打开 AI 中枢弹框
$('#aiHomeBtn').onclick = () => {
  $('#aiPickErr').textContent = '';
  $('#aiPickGo').disabled = false;
  switchHubTab('summary');
};
$('#hubTabSummary').onclick = () => switchHubTab('summary');
$('#hubTabSettings').onclick = () => switchHubTab('settings');
$('#hubTabHistory').onclick = () => switchHubTab('history');
$('#aiHubXClose').onclick = () => { $('#aiHubModal').hidden = true; };
$('#aiPickGo').onclick = () => {
  const type = $('#aiPickType').value;
  const tplIdx = parseInt($('#aiPickTpl').value, 10);
  $('#aiHubModal').hidden = true;
  if (type === 'all') assetAiSummarize(tplIdx);
  else aiSummarize(tplIdx);
};
// ai_export_json 已迁至用户抽屉（见 wireUserUI 中绑定）

// ---- 数据导入（格式与导出一致，入库当前用户）----
let pendingImport = null;
// ai_import_json 已迁至用户抽屉（见 wireUserUI 中绑定）
$('#importFile').onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = ''; // 允许重复选择同一文件
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const lists = ['holdings', 'wealth', 'cash', 'liability', 'consumption'];
    if (!lists.some((k) => Array.isArray(data[k]) && data[k].length)) {
      toast('文件不是有效的导出数据（缺少 holdings/wealth 等数组）', 'err');
      return;
    }
    pendingImport = data;
    const counts = lists.map((k) => `${k} ${(data[k] || []).length}`).join(' / ');
    const btn = $('#confirmOk');
    btn.textContent = '导入';
    btn.classList.remove('danger');
    $('#confirmTitle').textContent = '确认导入';
    $('#confirmMsg').textContent = `将导入：${counts}。已存在的同名持仓/理财/现金/负债及相同消费流水会自动跳过，是否继续？`;
    $('#confirmModal').hidden = false;
  } catch (err) { toast('文件解析失败：' + err.message, 'err'); }
};

// ---- 持仓历史盈亏（每日表格 + 盈亏曲线，tab 切换） ----
$('#histTabTable').onclick = () => switchHistTab('table');
$('#histTabChart').onclick = () => switchHistTab('chart');

let histData = null; // 当前持仓历史原始返回

async function openHoldingHistory(id) {
  $('#histModal').hidden = false;
  switchHistTab('table');
  $('#histTable').innerHTML = '<p style="color:#8a8f99;padding:8px 2px">加载中…</p>';
  $('#histChartBody').innerHTML = '';
  const r = await api('/api/holdings/' + id + '/pnl-history');
  if (!r.ok) { $('#histTable').innerHTML = '<p style="color:#f5222d">加载失败 (HTTP ' + r.status + ')</p>'; return; }
  const d = await r.json();
  histData = d;
  const h = d.holding || {};
  const cur = (d.currency === 'USD' ? 'USD ' : d.currency === 'HKD' ? 'HK$ ' : '¥');
  $('#histTitle').textContent = (h.name || '') + '（' + (h.symbol || '') + '）历史盈亏';
  renderHistTable(d, cur);
  renderHistChart(d, cur);
}

function switchHistTab(which) {
  const isTable = which === 'table';
  $('#histTableWrap').hidden = !isTable;
  $('#histChartWrap').hidden = isTable;
  $('#histTabTable').classList.toggle('active', isTable);
  $('#histTabChart').classList.toggle('active', !isTable);
}

function renderHistTable(d, cur) {
  const s = (d.series || []).slice().reverse(); // 从新到旧展示（曲线仍用原升序）
  if (s.length === 0) {
    $('#histTable').innerHTML = '<p style="color:#8a8f99;line-height:1.6;padding:8px 2px">暂无历史数据。系统每个交易日 15:15 自动记录（周末及法定节假日不记录），或点「刷新行情」即记录当日；从记录之日起每个交易日生成一个数据点。</p>';
    return;
  }
  const rows = s.map((x, i) => {
    const isBase = (i === s.length - 1); // 最早一天无"当日盈亏"
    return `
    <tr>
      <td>${x.date}</td>
      <td class="num">${fmtNav(x.close, (d.holding || {}).category)}</td>
      <td class="num ${cls(x.day_pnl)}">${isBase ? '—' : fmt(x.day_pnl)}</td>
      <td class="num ${cls(x.day_pnl_pct)}">${isBase ? '—' : pct(x.day_pnl_pct)}</td>
      <td class="num ${cls(x.total_pnl)}">${fmt(x.total_pnl)}</td>
      <td class="num ${cls(x.total_pnl_pct)}">${pct(x.total_pnl_pct)}</td>
      <td class="num">${fmt(x.market_value)}</td>
    </tr>`;
  }).join('');
  $('#histTable').innerHTML = `
    <table class="hist-tbl">
      <thead><tr>
        <th>日期</th><th>收盘价</th><th>当日盈亏</th><th>当日%</th><th>累计盈亏</th><th>累计%</th><th>市值</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="color:#8a8f99;font-size:12px;margin-top:6px">金额单位 ${cur}（USD 持仓已按汇率折算人民币口径，红涨绿跌）</div>`;
}

// 复用全局盈亏走势的 SVG 双轴风格：当日盈亏柱状（左轴，红涨绿跌）+ 累计盈亏折线（右轴）
function renderHistChart(d, cur) {
  const s = d.series || [];
  if (s.length === 0) { $('#histChartBody').innerHTML = '<p style="color:#8a8f99">暂无历史数据。</p>'; return; }
  const W = 720, H = 360, mL = 60, mR = 60, mT = 20, mB = 40;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const n = s.length;
  const maxBar = Math.max(1, ...s.map((x) => Math.abs(x.day_pnl)));
  const cVals = s.map((x) => x.total_pnl);
  const cMaxAbs = Math.max(1, ...cVals.map((v) => Math.abs(v)));
  const zeroY = mT + plotH / 2;
  const yBar = (v) => zeroY - (v / maxBar) * (plotH / 2);
  const yLine = (v) => zeroY - (v / cMaxAbs) * (plotH / 2);
  const slot = plotW / n;
  const bw = Math.max(2, slot * 0.6);
  const linePts = [];
  let bars = '', line = '', area = '', dots = '', hotspots = '';
  s.forEach((x, i) => {
    const cx = mL + (i + 0.5) * slot;
    // 交互热区：覆盖整列，hover 显示金额
    hotspots += `<rect class="trend-hot" data-i="${i}" x="${(mL + i * slot).toFixed(2)}" y="${mT}" width="${slot.toFixed(2)}" height="${plotH}" fill="transparent"/>`;
    const ly = yLine(x.total_pnl);
    linePts.push([cx, ly]);
    const yv = yBar(x.day_pnl);
    const top = Math.min(zeroY, yv), hgt = Math.abs(yv - zeroY);
    const color = x.day_pnl > 0 ? '#f5222d' : x.day_pnl < 0 ? '#00a854' : '#c9ced6';
    bars += `<rect x="${(cx - bw / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.5, hgt).toFixed(2)}" rx="2" fill="${color}"/>`;
    line += `${(i === 0 ? 'M' : 'L')} ${cx.toFixed(2)} ${ly.toFixed(2)} `;
    dots += `<circle cx="${cx.toFixed(2)}" cy="${ly.toFixed(2)}" r="3" fill="#722ed1" stroke="#fff" stroke-width="1.2"/>`;
  });
  if (linePts.length) {
    let ap = `M ${linePts[0][0].toFixed(2)} ${zeroY.toFixed(2)} `;
    linePts.forEach((p) => { ap += `L ${p[0].toFixed(2)} ${p[1].toFixed(2)} `; });
    ap += `L ${linePts[linePts.length - 1][0].toFixed(2)} ${zeroY.toFixed(2)} Z`;
    area = `<path d="${ap}" fill="rgba(114,46,209,0.10)" stroke="none"/>`;
  }
  const xLabelStep = Math.max(1, Math.ceil(n / 10));
  let xlabels = '';
  s.forEach((x, i) => {
    if (i % xLabelStep === 0 || i === n - 1) {
      const cx = mL + (i + 0.5) * slot;
      xlabels += `<text x="${cx.toFixed(2)}" y="${H - 14}" font-size="10" fill="#8a8f99" text-anchor="middle">${x.date.slice(5)}</text>`;
    }
  });
  const yLabels = `
    <text x="${mL - 6}" y="${(zeroY - plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#f5222d" text-anchor="end">+${fmt(maxBar)}</text>
    <text x="${mL - 6}" y="${(zeroY + 4).toFixed(2)}" font-size="10" fill="#8a8f99" text-anchor="end">0</text>
    <text x="${mL - 6}" y="${(zeroY + plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#00a854" text-anchor="end">-${fmt(maxBar)}</text>
    <text x="${W - mR + 6}" y="${(zeroY - plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#722ed1" text-anchor="start">+${fmt(cMaxAbs)}</text>
    <text x="${W - mR + 6}" y="${(zeroY + 4).toFixed(2)}" font-size="10" fill="#8a8f99" text-anchor="start">0</text>
    <text x="${W - mR + 6}" y="${(zeroY + plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#722ed1" text-anchor="start">-${fmt(cMaxAbs)}</text>`;
  const grid = `<line x1="${mL}" y1="${zeroY}" x2="${W - mR}" y2="${zeroY}" stroke="#e5e6eb" stroke-width="1"/>`;
  const legend = `
    <div style="display:flex;gap:18px;margin-top:10px;font-size:13px;flex-wrap:wrap">
      <span><span style="display:inline-block;width:12px;height:12px;background:#f5222d;border-radius:2px;margin-right:6px;vertical-align:middle"></span>当日盈亏 (左轴, 红涨绿跌)</span>
      <span><span style="display:inline-block;width:18px;height:3px;background:#722ed1;margin-right:6px;vertical-align:middle"></span>累计盈亏 (右轴)</span>
    </div>`;
  $('#histChartBody').innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${grid}${area}${bars}${hotspots}
      <path d="${line}" fill="none" stroke="#722ed1" stroke-width="2" stroke-linejoin="round"/>
      ${dots}${yLabels}${xlabels}
    </svg>${legend}`;
  // 绑定柱子交互热区 tooltip
  document.querySelectorAll('#histChartBody .trend-hot').forEach((r) => {
    const i = +r.dataset.i;
    r.addEventListener('mouseenter', (e) => showHistTip(e, s[i]));
    r.addEventListener('mousemove', moveTrendTip);
    r.addEventListener('mouseleave', hideTrendTip);
  });
}

// 历史盈亏曲线 tooltip：hover 柱子显示当日/累计盈亏
function showHistTip(e, x) {
  let tip = document.getElementById('trendTip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'trendTip'; tip.className = 'trend-tip'; document.body.appendChild(tip); }
  const day = (x.day_pnl !== undefined ? x.day_pnl : (x.pnl || 0));
  const cum = (x.total_pnl !== undefined ? x.total_pnl : (x.cum_pnl || 0));
  const cls = day > 0 ? 't-up' : day < 0 ? 't-down' : 't-muted';
  const sign = day > 0 ? '+' : '';
  const dayStr = sign + fmt(day);
  const cumCls = cum > 0 ? 't-up' : cum < 0 ? 't-down' : 't-muted';
  tip.innerHTML = '<div class="t-date">' + x.date + '</div>'
    + '<div class="t-row"><span>当日盈亏</span><span class="' + cls + '">' + dayStr + '</span></div>'
    + '<div class="t-row"><span>累计盈亏</span><span class="' + cumCls + '">' + fmt(cum) + '</span></div>';
  tip.classList.add('show');
  moveTrendTip(e);
}

// 应用入口：静默自动登录后直接进入（登录界面已移除）
boot();

// ===================== 资产全景模块 =====================
let assetData = null;       // /api/asset/overview 响应
let pieData = null;          // 最近一次绘制「资产构成」饼图所用的总览数据，供二级下钻使用
let assetSources = [];       // 资产来源缓存（供下拉）
let assetTab = 'wealth';     // 当前 tab: wealth/cash/liability/consume/sources
let pendingAssetDel = null;   // { type, id }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '¥' + fmt(n == null ? 0 : n);
const pnlCls = (n) => (n >= 0 ? 'up' : 'down');
const pnlTxt = (n) => (n >= 0 ? '+' : '') + money(n);
function curSymbolJS(cur) {
  cur = (cur || '').toLowerCase();
  if (cur === 'usd' || cur === '$') return '$';
  if (cur === 'hkd' || cur === 'hk$') return 'HK$';
  return '¥';
}
const moneyCur = (n, cur) => curSymbolJS(cur) + fmt(n == null ? 0 : n);

// 二级页统一页头（设计系统：标题 + 操作区；不显示返回箭头）
function injectPageHead(viewId, title) {
  const v = document.getElementById(viewId);
  if (!v || v.querySelector(':scope > .page-head')) return;
  const h = document.createElement('div');
  h.className = 'page-head';
  h.innerHTML = '<h2 class="page-head__title">' + (title || '') + '</h2>'
    + '<div class="page-head__actions"></div>';
  v.insertBefore(h, v.firstChild);
}
async function showAssetView() {
  $('#holdingsView').hidden = true;
  $('#assetView').hidden = false;
  // 关闭可能打开的弹框（日历/工具/通知）
  $('#calendarModal').hidden = true;
  $('#toolsModal').hidden = true;
  $('#notifyModal').hidden = true;
  // 资产工具条已移至 header 暗黑按钮右侧（全局 #assetToolbar）：进入资产全景时显示，离开时隐藏
  const at = document.getElementById('assetToolbar');
  if (at) at.hidden = false;
  const mb = document.getElementById('marketBar');
  if (mb) mb.hidden = true;
  // 注入面包屑导航（首页 / 资产全景）
  const v = document.getElementById('assetView');
  let ph = v.querySelector(':scope > .page-head');
  if (!ph) {
    ph = document.createElement('div');
    ph.className = 'page-head';
    v.insertBefore(ph, v.firstChild);
  }
  ph.innerHTML = '<div class="breadcrumb">'
    + '<span class="breadcrumb-item" data-home>首页</span>'
    + '<span class="breadcrumb-sep">/</span>'
    + '<span class="breadcrumb-item breadcrumb-current">资产全景</span>'
    + '</div>';
  ph.querySelector('[data-home]').onclick = (e) => { e.preventDefault(); showHoldingsView(); navigate('holdings'); };
  await loadAsset();
}

// 工具栏引导动画已按需求取消（不再首次进入时依次提示）
async function showToolbarGuide() {
  return;
}
function showToolTip(el, text) {
  const tip = document.getElementById('toolTipHint');
  if (!tip || !text) return;
  const r = el.getBoundingClientRect();
  tip.textContent = text;
  tip.hidden = false;
  tip.style.top = (window.scrollY + r.bottom + 8) + 'px';
  tip.style.left = Math.max(8, window.scrollX + r.left) + 'px';
}
function hideToolTip() {
  const tip = document.getElementById('toolTipHint');
  if (tip) tip.hidden = true;
}

// ===== 小工具：权益/美元资产盈亏计算器 =====
let fxUsdCny = 1, fxHkdCny = 1;
let lastEqRmb = null, lastEqBreakdown = [];
let lastUsdRmb = null, lastUsdDetail = null;
let lastUsdKindAggRmb = { stock: 0, fund: 0, wealth: 0, cash: 0 };

// ---- 汇率计算工具（CNY / HKD / USD 互换算，汇率取页面实时 usdRate/hkdRate）----
function convertMoney(amt, from, to) {
  let cny = amt;
  if (from === 'USD') cny = amt * (usdRate || 1);
  else if (from === 'HKD') cny = amt * (hkdRate || 1);
  if (to === 'CNY') return cny;
  if (to === 'USD') return cny / (usdRate || 1);
  if (to === 'HKD') return cny / (hkdRate || 1);
  return amt;
}
function fxRateText(from, to) {
  const p = (v) => (v ? v.toFixed(4) : '—');
  if (from === to) return '同币种';
  if (from === 'CNY') return `1 ${to} ≈ ${p(to === 'USD' ? usdRate : hkdRate)} CNY`;
  if (to === 'CNY') return `1 ${from} ≈ ${p(from === 'USD' ? usdRate : hkdRate)} CNY`;
  return from === 'USD' ? `1 USD ≈ ${p((usdRate || 1) / (hkdRate || 1))} HKD` : `1 HKD ≈ ${p((hkdRate || 1) / (usdRate || 1))} USD`;
}
function fxCalcRun() {
  const el = $('#fxResult');
  if (!el) return;
  const amt = parseFloat($('#fxAmount').value);
  const from = $('#fxFrom').value;
  const to = $('#fxTo').value;
  if (!amt || isNaN(amt)) { el.innerHTML = '<p class="res-flat">请输入金额</p>'; return; }
  const v = convertMoney(amt, from, to);
  const sym = { CNY: '¥', HKD: 'HK$', USD: '$' }[to] || '';
  el.innerHTML = `<div class="res-group-head">${sym}${fmt(v)}</div>
    <div class="res-sub">${from} ${fmt(amt)} → ${to} ${fmt(v)}</div>
    <div class="res-sub" style="color:var(--text-muted)">参考汇率：${fxRateText(from, to)}</div>`;
}
$('#fxAmount').oninput = fxCalcRun;
$('#fxFrom').onchange = fxCalcRun;
$('#fxTo').onchange = fxCalcRun;
async function showToolsView() {
  // 无可见视图时，先落回首页作弹框背景
  if ($('#holdingsView').hidden && $('#assetView').hidden && $('#calendarModal').hidden) {
    showHoldingsView();
  }
  $('#toolsModal').hidden = false;
  // 默认切到权益盈亏面板（汇率计算已移至最后一个 tab）
  switchToolsTab('eq');
  await loadToolsFx();
  const eqOk = await loadEqRows();
  if (!eqOk) addEqRow();
  const usdOk = await loadUsdRows();
  if (!usdOk) { addUsdBuy(); addUsdPnl(); }
  // 评级逻辑 tab：加载已存脚本 + 填充测试下拉
  loadScriptTool();
  // 汇率计算工具：显示当前汇率并刷新结果
  const fh = $('#fxRateHint');
  if (fh) fh.textContent = `当前：1 USD ≈ ${(usdRate || 1).toFixed(4)} CNY，1 HKD ≈ ${(hkdRate || 1).toFixed(4)} CNY`;
  fxCalcRun();
}
function switchToolsTab(tab) {
  $('#tlTabFx').classList.toggle('active', tab === 'fx');
  $('#tlTabEq').classList.toggle('active', tab === 'eq');
  $('#tlTabUsd').classList.toggle('active', tab === 'usd');
  $('#tlTabScr').classList.toggle('active', tab === 'scr');
  $('#tlPanelFx').hidden = tab !== 'fx';
  $('#tlPanelEq').hidden = tab !== 'eq';
  $('#tlPanelUsd').hidden = tab !== 'usd';
  $('#tlPanelScr').hidden = tab !== 'scr';
}

async function loadToolsFx() {
  try {
    const r = await api('/api/fx');
    if (r.ok) {
      const d = await r.json();
      fxUsdCny = d.usd_cny || fxUsdCny;
      fxHkdCny = d.hkd_cny || fxHkdCny;
      const rate = $('#usdRate');
      if (rate && !rate.value) rate.value = fxUsdCny;
      const h = $('#eqFxHint');
      if (h) h.textContent = `当前汇率：1 USD = ${fxUsdCny.toFixed(4)} ¥，1 HKD = ${fxHkdCny.toFixed(4)} ¥`;
    }
  } catch (_) {}
}

function addEqRow(init) {
  const row = document.createElement('div');
  row.className = 'trow';
  row.innerHTML = `
    <select class="eq-kind" name="eq-kind">
      <option value="stock">股票</option>
      <option value="fund">基金</option>
      <option value="wealth">理财</option>
    </select>
    <input class="eq-amt" name="eq-amt" type="number" step="0.0001" min="0" oninput="clampDecimals(this,4)" placeholder="盈亏金额（正盈利/负亏损）">
    <select class="eq-cur" name="eq-cur">
      <option value="USD">USD 美元</option>
      <option value="HKD">HKD 港币</option>
      <option value="RMB" selected>RMB 人民币</option>
    </select>
    <input class="eq-note" name="eq-note" type="text" placeholder="备注（可选）">
    <button class="trow-del btn btn-sm danger" type="button" title="删除">✕</button>`;
  if (init) {
    if (init.kind) row.querySelector('.eq-kind').value = init.kind;
    if (init.amt != null) row.querySelector('.eq-amt').value = init.amt;
    if (init.cur) row.querySelector('.eq-cur').value = init.cur;
    if (init.note != null) row.querySelector('.eq-note').value = init.note;
  }
  row.querySelector('.trow-del').onclick = () => row.remove();
  $('#eqRows').appendChild(row);
}

function addUsdBuy(init) {
  const row = document.createElement('div');
  row.className = 'trow';
  row.innerHTML = `
    <input class="usd-buy" name="usd-buy" type="number" step="0.0001" min="0" oninput="clampDecimals(this,4)" placeholder="买入 USD 金额">
    <input class="usd-brate" name="usd-brate" type="number" step="0.0001" min="0" oninput="clampDecimals(this,4)" placeholder="买入汇率 RMB/USD">
    <span class="usd-cost" title="买入花费（RMB）">—</span>
    <button class="trow-del btn btn-sm danger" type="button" title="删除">✕</button>`;
  const buyEl = row.querySelector('.usd-buy');
  const brateEl = row.querySelector('.usd-brate');
  const costEl = row.querySelector('.usd-cost');
  const recalc = () => {
    const b = parseFloat(buyEl.value), r = parseFloat(brateEl.value);
    if (isFinite(b) && b > 0 && isFinite(r) && r > 0) costEl.textContent = '¥ ' + fmt(b * r);
    else costEl.textContent = '—';
  };
  buyEl.addEventListener('input', recalc);
  brateEl.addEventListener('input', recalc);
  if (init) {
    if (init.buy != null) buyEl.value = init.buy;
    if (init.brate != null) brateEl.value = init.brate;
  }
  recalc();
  row.querySelector('.trow-del').onclick = () => row.remove();
  $('#usdBuyRows').appendChild(row);
}

function addUsdPnl(init) {
  const row = document.createElement('div');
  row.className = 'trow';
  row.innerHTML = `
    <select class="usd-kind" name="usd-kind">
      <option value="stock">股票</option>
      <option value="fund">基金</option>
      <option value="wealth">理财</option>
      <option value="cash">现金</option>
    </select>
    <input class="usd-pnl" name="usd-pnl" type="number" step="0.0001" min="0" oninput="clampDecimals(this,4)" placeholder="盈亏 USD 金额（正盈利/负亏损）">
    <button class="trow-del btn btn-sm danger" type="button" title="删除">✕</button>`;
  if (init) {
    if (init.kind) row.querySelector('.usd-kind').value = init.kind;
    if (init.pnl != null) row.querySelector('.usd-pnl').value = init.pnl;
  }
  row.querySelector('.trow-del').onclick = () => row.remove();
  $('#usdPnlRows').appendChild(row);
}

/* ---- 录入持久化（后端 SQLite，全局单份） ---- */
async function saveEq() {
  try {
    const rows = [...document.querySelectorAll('#eqRows .trow')].map(r => ({
      kind: r.querySelector('.eq-kind').value,
      amt: r.querySelector('.eq-amt').value,
      cur: r.querySelector('.eq-cur').value,
      note: r.querySelector('.eq-note').value
    }));
    const r = await api('/api/calc/inputs', { method: 'PUT', body: JSON.stringify({ kind: 'equity', payload: rows }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast('已保存权益盈亏录入', 'ok');
  } catch (e) { toast('保存失败：' + e.message, 'err'); }
}
async function loadEqRows() {
  try {
    const r = await api('/api/calc/inputs?kind=equity');
    if (!r.ok) return false;
    const d = await r.json();
    const arr = (typeof d.payload === 'string' ? JSON.parse(d.payload) : d.payload) || [];
    if (!Array.isArray(arr) || !arr.length) return false;
    $('#eqRows').innerHTML = '';
    arr.forEach(x => addEqRow(x));
    return true;
  } catch (e) { return false; }
}
async function saveUsd() {
  try {
    const buys = [...document.querySelectorAll('#usdBuyRows .trow')].map(r => ({
      buy: r.querySelector('.usd-buy').value,
      brate: r.querySelector('.usd-brate').value
    }));
    const pnls = [...document.querySelectorAll('#usdPnlRows .trow')].map(r => ({
      kind: r.querySelector('.usd-kind').value,
      pnl: r.querySelector('.usd-pnl').value
    }));
    const rate = $('#usdRate').value;
    const r = await api('/api/calc/inputs', { method: 'PUT', body: JSON.stringify({ kind: 'usd', payload: { rate, buys, pnls } }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast('已保存美元计算器录入', 'ok');
  } catch (e) { toast('保存失败：' + e.message, 'err'); }
}
async function loadUsdRows() {
  try {
    const r = await api('/api/calc/inputs?kind=usd');
    if (!r.ok) return false;
    const d = await r.json();
    const obj = (typeof d.payload === 'string' ? JSON.parse(d.payload) : d.payload) || {};
    const buys = obj.buys, pnls = obj.pnls;
    if ((!Array.isArray(buys) || !buys.length) && (!Array.isArray(pnls) || !pnls.length)) return false;
    $('#usdBuyRows').innerHTML = '';
    $('#usdPnlRows').innerHTML = '';
    (buys || []).forEach(x => addUsdBuy(x));
    (pnls || []).forEach(x => addUsdPnl(x));
    if (obj.rate != null && obj.rate !== '') $('#usdRate').value = obj.rate;
    return true;
  } catch (e) { return false; }
}

function calcEq() {
  const rows = [...document.querySelectorAll('#eqRows .trow')];
  const breakdown = [];
  let total = 0;
  rows.forEach(r => {
    const amt = parseFloat(r.querySelector('.eq-amt').value);
    const cur = r.querySelector('.eq-cur').value;
    if (!isFinite(amt) || amt === 0) return;
    const rate = cur === 'USD' ? fxUsdCny : cur === 'HKD' ? fxHkdCny : 1;
    const rmb = amt * rate;
    total += rmb;
    const kind = r.querySelector('.eq-kind').value;
    breakdown.push({ kind, cur, amt, rmb, note: (r.querySelector('.eq-note').value || '').trim() });
  });
  const el = $('#eqResult');
  if (!breakdown.length) { el.innerHTML = '<span class="tool-empty">请先录入至少一笔非零盈亏</span>'; lastEqRmb = null; lastEqBreakdown = []; return; }
  const sign = total >= 0 ? 'up' : 'down';
  lastEqRmb = total;
  lastEqBreakdown = breakdown;
  const order = [['stock', '股票'], ['fund', '基金'], ['wealth', '理财']];
  const groups = {};
  breakdown.forEach(b => { (groups[b.kind] = groups[b.kind] || []).push(b); });
  let html = `<div class="res-main ${sign}">合计盈亏（RMB）：¥ ${fmt(Math.abs(total))} <span>${total >= 0 ? '盈利' : '亏损'}</span></div>`;
  order.forEach(([k, lbl]) => {
    const items = groups[k];
    if (!items || !items.length) return;
    const sub = items.reduce((s, b) => s + b.rmb, 0);
    const subSign = sub >= 0 ? 'up' : 'down';
    const lines = items.map(b => {
      const tag = b.note ? ` <span class="res-note">(${esc(b.note)})</span>` : '';
      return `${b.cur} ${b.amt > 0 ? '+' : ''}${fmt(b.amt)} → ¥${fmt(b.rmb)}${tag}`;
    }).join('　｜　');
    html += `<div class="res-group"><div class="res-group-head ${subSign}">${lbl} 小计：<b>${sub >= 0 ? '+' : '−'}¥${fmt(Math.abs(sub))}</b></div><div class="res-detail">${lines}</div></div>`;
  });
  el.innerHTML = html;
}

function calcUsd() {
  const Rcur = parseFloat($('#usdRate').value);
  const el = $('#usdResult');
  if (!isFinite(Rcur) || Rcur <= 0) { el.innerHTML = '<span class="tool-empty">请填写有效的当前汇率（RMB/USD）</span>'; lastUsdRmb = null; return; }
  const buys = [...document.querySelectorAll('#usdBuyRows .trow')];
  const pnls = [...document.querySelectorAll('#usdPnlRows .trow')];
  let totalBuy = 0, weighted = 0, costRmb = 0;
  buys.forEach(r => {
    const buy = parseFloat(r.querySelector('.usd-buy').value);
    if (!isFinite(buy) || buy <= 0) return;
    const b = parseFloat(r.querySelector('.usd-brate').value);
    const brate = isFinite(b) ? b : Rcur;
    totalBuy += buy;
    weighted += buy * brate;
    costRmb += buy * brate;
  });
  let totalPnl = 0;
  const kindAggUsd = { stock: 0, fund: 0, wealth: 0, cash: 0 };
  pnls.forEach(r => {
    const p = parseFloat(r.querySelector('.usd-pnl').value);
    if (!isFinite(p)) return;
    totalPnl += p;
    const k = r.querySelector('.usd-kind').value;
    if (k in kindAggUsd) kindAggUsd[k] += p;
  });
  if (totalBuy <= 0) { el.innerHTML = '<span class="tool-empty">请先在「① 买入美元记录」录入至少一笔有效买入（金额 &gt; 0）</span>'; lastUsdRmb = null; return; }
  const avgRate = weighted / totalBuy;
  const assetValueRmb = (totalBuy + totalPnl) * Rcur;
  const netPnlRmb = assetValueRmb - costRmb;
  const pnlRmb = totalPnl * Rcur;
  const fxGainRmb = totalBuy * (Rcur - avgRate);
  const fxAppr = (Rcur - avgRate) / avgRate * 100;
  const assetRet = totalPnl / totalBuy * 100;
  const beat = assetRet > fxAppr;
  lastUsdRmb = netPnlRmb;
  lastUsdDetail = { totalBuy, avgRate, totalPnl, pnlRmb, fxGainRmb, fxAppr, assetRet, beat, Rcur };
  const kindAggRmb = {
    stock: kindAggUsd.stock * Rcur,
    fund: kindAggUsd.fund * Rcur,
    wealth: kindAggUsd.wealth * Rcur,
    cash: kindAggUsd.cash * Rcur
  };
  lastUsdKindAggRmb = kindAggRmb;
  let html = '';
  html += `<div class="res-row">买入 USD 合计：<b>${fmt(totalBuy)}</b>　｜　平均买入汇率：<b>${avgRate.toFixed(4)}</b> ¥/USD　｜　总花费 RMB：<b>¥${fmt(costRmb)}</b></div>`;
  html += `<div class="res-main ${netPnlRmb >= 0 ? 'up' : 'down'}">最终盈亏金额（RMB）：¥ ${fmt(Math.abs(netPnlRmb))} ${netPnlRmb >= 0 ? '盈利' : '亏损'}</div>`;
  html += `<div class="res-row">盈亏（USD）：<b>${totalPnl > 0 ? '+' : ''}${fmt(totalPnl)}</b> USD　＝　¥ ${fmt(pnlRmb)}</div>`;
  html += `<div class="res-row">其中汇率收益（仅持有美元现金）：¥ ${fmt(fxGainRmb)}（美元升值 ${pct(fxAppr)}）</div>`;
  html += `<div class="res-row">资产美元收益率：<b>${pct(assetRet)}</b>　｜　是否跑赢汇率贬值：<span class="${beat ? 'up' : 'down'}">${beat ? '是 ✅（资产收益跑赢单纯持有美元）' : '否 ❌（未跑赢，不如直接持美元现金）'}</span></div>`;
  const kindParts = ['stock', 'fund', 'wealth', 'cash'].map(k => {
    const lbl = k === 'fund' ? '基金' : k === 'wealth' ? '理财' : k === 'cash' ? '现金' : '股票';
    const v = kindAggRmb[k];
    return Math.abs(v) < 1e-9 ? null : `${lbl} ¥${fmt(v)}`;
  }).filter(Boolean);
  if (kindParts.length) html += `<div class="res-row">分类盈亏统计（RMB）：<b>${kindParts.join('　｜　')}</b></div>`;
  el.innerHTML = html;
}

$('#eqAddRow').onclick = addEqRow;
$('#usdAddBuy').onclick = addUsdBuy;
$('#usdAddPnl').onclick = addUsdPnl;
$('#eqCalc').onclick = calcEq;
$('#usdCalc').onclick = calcUsd;
$('#eqSave').onclick = saveEq;
$('#usdSave').onclick = saveUsd;
$('#eqClear').onclick = () => { $('#eqRows').innerHTML = ''; addEqRow(); $('#eqResult').innerHTML = ''; lastEqRmb = null; lastEqBreakdown = []; $('#mergeModal').hidden = true; api('/api/calc/inputs?kind=equity', { method: 'DELETE' }); };
$('#usdClear').onclick = () => { $('#usdBuyRows').innerHTML = ''; $('#usdPnlRows').innerHTML = ''; addUsdBuy(); addUsdPnl(); $('#usdResult').innerHTML = ''; lastUsdRmb = null; lastUsdDetail = null; $('#mergeModal').hidden = true; api('/api/calc/inputs?kind=usd', { method: 'DELETE' }); };
$('#mergeBtn').onclick = mergeSummary;
$('#addMode').onchange = () => {
  const isAmt = $('#addMode').value === 'amount';
  $('#addQtyWrap').style.display = isAmt ? 'none' : '';
  $('#addAmtWrap').style.display = isAmt ? '' : 'none';
};
$('#addCalc').onclick = calcAdd;
$('#addClear').onclick = () => {
  ['addOldPrice','addOldQty','addNewQty','addAmount','addFee','addNewPrice'].forEach(id => { $('#'+id).value = ''; });
  $('#addMode').value = 'qty';
  $('#addQtyWrap').style.display = '';
  $('#addAmtWrap').style.display = 'none';
  $('#addResult').innerHTML = '';
  lastAdd = null;
  const ab = $('#addApply'); if (ab) ab.disabled = true;
};
$('#addApply').onclick = () => {
  if (!lastAdd) { toast('请先点击「计算」生成补仓方案', 'err'); return; }
  const name = ($('#adjustTitle').textContent || '').replace('加减仓 · ', '');
  const sideLabel = lastAdd.side === 'sell' ? '卖出' : '买入';
  pendingApplyAdd = true;
  const btn = $('#confirmOk');
  btn.textContent = '确认计入';
  btn.classList.remove('danger');
  btn.classList.add('primary');
  $('#confirmTitle').textContent = '计入持仓';
  $('#confirmMsg').textContent = '将把这笔操作作为一笔「' + sideLabel + '」交易计入「' + name + '」：' + sideLabel + ' ' + fmt(lastAdd.q1) + ' 份 × ¥' + fmt(lastAdd.p1)
    + '，手续费 ¥' + fmt(lastAdd.fee) + '。计入后该持仓的数量与成本/盈亏将按交易流水重新核算。';
  $('#confirmModal').hidden = false;
};

// 统一关闭：.card-close 同时服务弹窗（关闭模态）与工具卡（收起计算器）。
// 设计系统要求所有弹窗关闭位统一为 .card-close（右上角 ×）。
function injectModalClose() {
  document.querySelectorAll('.modal .modal-card').forEach((mc) => {
    if (mc.querySelector('.card-close')) return;
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'card-close'; x.textContent = '✕';
    x.setAttribute('title', '关闭'); x.setAttribute('aria-label', '关闭');
    mc.insertBefore(x, mc.firstChild);
  });
}
injectModalClose();
document.addEventListener('click', (e) => {
  const x = e.target.closest('.card-close');
  if (!x) return;
  const modal = x.closest('.modal');
  if (modal) modal.hidden = true;
});
// 部分遮罩：保留首尾若干字符，中间以 * 替代（Webhook/加签密钥 这类普通文本框默认只露头尾）
function maskSecret(v) {
  v = v || '';
  if (v.length <= 10) return v;            // 过短不遮罩，避免只剩 *
  const head = v.slice(0, 8);
  const tail = v.slice(-4);
  const n = Math.min(v.length - head.length - tail.length, 16);
  return head + '*'.repeat(n) + tail;
}
// 眼睛切换：password 型（邮箱授权码/AI Key）直接切 type；部分遮罩型（Webhook/密钥）切「只读遮罩 ↔ 可编辑明文」
const EYE_OPEN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
// 来源分组标题图标：替换原 ▦ 占位符；分层/堆叠样式对应「按来源归组的持仓集合」（feather layers）
const SRC_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
// 资产全景来源类型图标：银行=地标建筑、证券=K线蜡烛、软件=显示器；平台复用 SRC_ICON 分层图标
const BANK_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>';
const SEC_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M9 5v4"/><path d="M9 19v-2"/><path d="M9 9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/><path d="M15 3v2"/><path d="M15 21v-4"/><path d="M15 11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/><path d="M21 7v3"/><path d="M21 17v2"/><path d="M21 11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/></svg>';
const SOFTWARE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
const SRC_TYPE_ICON = { bank: BANK_ICON, securities: SEC_ICON, software: SOFTWARE_ICON, platform: SRC_ICON };
function srcTypeIcon(t) { return SRC_TYPE_ICON[t] || SRC_ICON; }
// 首页持仓分组：按来源 id 取来源类型，返回对应特色图标；未分组/未知来源回退 SRC_ICON
function srcTypeIconForSource(sid) {
  const s = assetSources.find((x) => x.id === sid);
  if (!s) return SRC_ICON;
  const t = (s.type === 'securities' || s.type === 'software' || s.type === 'platform') ? s.type : 'bank';
  return srcTypeIcon(t);
}
document.querySelectorAll('.eye-toggle').forEach(b => { if (!b.innerHTML.trim()) b.innerHTML = EYE_OPEN; });
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.eye-toggle');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.eyeFor);
  if (!input) return;
  if (input.type === 'password') {
    // 完全隐藏型：直接切换密文/明文
    input.type = 'text';
    btn.innerHTML = EYE_OFF;
    btn.setAttribute('aria-label', '隐藏明文');
  } else {
    // 部分遮罩型：默认只读遮罩，点眼睛展开可编辑明文、再点重新遮罩（并保留编辑结果）
    if (input.readOnly) {
      input.value = input.dataset.raw || '';
      input.readOnly = false;
      input.focus();
      if (input.select) input.select();
      btn.innerHTML = EYE_OFF;
      btn.setAttribute('aria-label', '隐藏明文');
    } else {
      input.dataset.raw = input.value;
      input.value = maskSecret(input.value);
      input.readOnly = true;
      btn.innerHTML = EYE_OPEN;
      btn.setAttribute('aria-label', '显示明文');
    }
  }
});


function calcAdd() {
  const P0 = parseFloat($('#addOldPrice').value);
  const Q0 = parseFloat($('#addOldQty').value);
  const f  = parseFloat($('#addFee').value);
  const P1 = parseFloat($('#addNewPrice').value);
  const el = $('#addResult');
  const mode = $('#addMode').value;
  const side = $('#addSide').value || 'buy';
  // 重置「计入持仓」按钮状态，待计算成功后再启用
  lastAdd = null;
  const applyBtn = $('#addApply');
  if (applyBtn) applyBtn.disabled = true;
  const fee = Number.isFinite(f) ? f : 0;
  if (![P0, Q0, P1].every(Number.isFinite)) {
    el.innerHTML = '<span class="tool-empty">请填写：原成交价、原持仓数量、补仓现价（手续费可填 0）</span>';
    return;
  }
  if (Q0 <= 0) {
    el.innerHTML = '<span class="tool-empty">原持仓数量需大于 0</span>';
    return;
  }
  let Q1, costAdd, addDesc;
  if (mode === 'amount') {
    const X = parseFloat($('#addAmount').value);
    if (!Number.isFinite(X) || X <= 0) {
      el.innerHTML = '<span class="tool-empty">请填写有效的补仓金额（大于 0）</span>';
      return;
    }
    if (X <= fee) {
      el.innerHTML = '<span class="tool-empty">补仓金额需大于买入手续费</span>';
      return;
    }
    Q1 = (X - fee) / P1;          // 买入费从金额中扣除 → 实际买入份额
    costAdd = X;                    // 合并成本按实际投入金额计
    addDesc = `按金额补仓 ¥${fmt(X)} → 买入 ${fmt(Q1)} 份（已扣买入费 ¥${fmt(fee)}）`;
  } else {
    Q1 = parseFloat($('#addNewQty').value);
    if (!Number.isFinite(Q1) || Q1 <= 0) {
      el.innerHTML = '<span class="tool-empty">请填写有效的补仓数量（大于 0）</span>';
      return;
    }
    costAdd = Q1 * P1 + fee;       // 买入费计入合并成本
    addDesc = `按数量补仓 ${fmt(Q1)} 份 × ¥${fmt(P1)} + 买入费 ¥${fmt(fee)}`;
  }
  const Q = Q0 + Q1;                           // 合并持仓数量
  const costBasis = Q0 * P0 + costAdd;          // 合并总成本（costAdd 已含买入费或按投入金额计）
  const avgCost = costBasis / Q;                // 合并持仓成本（每份）
  const marketValue = Q * P1;                   // 以补仓现价为盈亏基准
  const pnl = marketValue - costBasis - fee;    // 再扣卖出费 → 净盈亏
  const pctVal = costBasis > 0 ? pnl / costBasis * 100 : 0;
  const sign = pnl >= 0 ? 'up' : 'down';
  let html = '';
  html += `<div class="res-row">合并持仓数量：<b>${fmt(Q)}</b>　｜　合并持仓成本：<b>${fmtCat(avgCost, calcCat)}</b> / 份</div>`;
  html += `<div class="res-row">补仓明细：${addDesc}</div>`;
  html += `<div class="res-main ${sign}">补仓后盈亏（净，已扣双费）：¥ ${fmt(Math.abs(pnl))} ${pnl >= 0 ? '盈利' : '亏损'}（${pct(pctVal)}）</div>`;
  html += `<div class="res-detail">口径拆解：原仓 (现价−原价)×原数量 = ¥${fmt(Q0 * (P1 - P0))}；买卖双费 = ¥${fmt(2 * fee)}；补仓份数按现价计为平。盈亏比例以合并成本 ¥${fmt(costBasis)} 为分母。</div>`;
  el.innerHTML = html;
  // 记录本次有效补仓方案，供「计入持仓」使用
  lastAdd = { q1: Q1, p1: P1, fee: fee, mode: mode, side: side };
  if (applyBtn) applyBtn.disabled = false;
}

function mergeSummary() {
  const el = $('#mergeResult');
  $('#mergeModal').hidden = false;
  const eq = lastEqRmb == null ? 0 : lastEqRmb;
  const usd = lastUsdRmb == null ? 0 : lastUsdRmb;
  const total = eq + usd;
  const eqMissing = lastEqRmb == null;
  const usdMissing = lastUsdRmb == null;
  const sign = total >= 0 ? 'up' : 'down';
  let html = '';
  html += `<div class="res-row">权益资产盈亏（RMB）：<b class="${eq >= 0 ? 'up' : 'down'}">${eq >= 0 ? '+' : '−'}¥ ${fmt(Math.abs(eq))}</b>${eqMissing ? ' <span class="res-note">（未计算，按 0 计）</span>' : ''}</div>`;
  html += `<div class="res-row">美元资产盈亏（RMB）：<b class="${usd >= 0 ? 'up' : 'down'}">${usd >= 0 ? '+' : '−'}¥ ${fmt(Math.abs(usd))}</b>${usdMissing ? ' <span class="res-note">（未计算，按 0 计）</span>' : ''}</div>`;
  html += `<div class="res-main ${sign}">合计盈亏（RMB）：¥ ${fmt(Math.abs(total))} ${total >= 0 ? '盈利' : '亏损'}</div>`;
  const kindAggRmb = { stock: 0, fund: 0, wealth: 0, cash: 0 };
  if (!eqMissing && lastEqBreakdown.length) {
    lastEqBreakdown.forEach(b => { if (b.kind in kindAggRmb) kindAggRmb[b.kind] += b.rmb; });
  }
  if (!usdMissing) {
    ['stock', 'fund', 'wealth', 'cash'].forEach(k => { kindAggRmb[k] += lastUsdKindAggRmb[k] || 0; });
  }
  const mKindParts = ['stock', 'fund', 'wealth', 'cash'].map(k => {
    const lbl = k === 'fund' ? '基金' : k === 'wealth' ? '理财' : k === 'cash' ? '现金' : '股票';
    const v = kindAggRmb[k];
    return Math.abs(v) < 1e-9 ? null : `${lbl} ¥${fmt(v)}`;
  }).filter(Boolean);
  if (mKindParts.length) html += `<div class="res-row">分类汇总（股票/基金/理财/现金，RMB）：<b>${mKindParts.join('　｜　')}</b></div>`;
  if (!usdMissing && lastUsdDetail) {
    const d = lastUsdDetail;
    html += `<div class="res-detail">美元拆解：盈亏 ${d.totalPnl > 0 ? '+' : ''}${fmt(d.totalPnl)} USD ＝ ¥${fmt(d.pnlRmb)}　｜　汇率收益 ¥${fmt(d.fxGainRmb)}（美元升值 ${pct(d.fxAppr)}）　｜　${d.beat ? '跑赢汇率 ✅' : '未跑赢 ❌'}</div>`;
  }
  if (!eqMissing && lastEqBreakdown.length) {
    html += '<div class="res-detail">权益明细：' + lastEqBreakdown.map(b => {
      const tag = b.note ? ` <span class="res-note">(${esc(b.note)})</span>` : '';
      return `${b.cur} ${b.amt > 0 ? '+' : ''}${fmt(b.amt)} → ¥${fmt(b.rmb)}${tag}`;
    }).join('　｜　') + '</div>';
  }
  el.innerHTML = html;
}

async function loadAsset() {
  try {
    const r = await api('/api/asset/overview');
    if (!r.ok) { toast('资产总览加载失败 (HTTP ' + r.status + ')', 'err'); return; }
    assetData = await r.json();
    renderAssetSummary();
    await loadSourcesCache();
    renderAssetTab();
  } catch (e) {
    toast('资产加载异常：' + e.message, 'err');
  }
}

async function loadSourcesCache() {
  try {
    const r = await api('/api/asset/sources');
    if (r.ok) { const d = await r.json(); assetSources = d.sources || []; }
  } catch (_) {}
}

function renderAssetSummary() {
  const d = assetData; if (!d) return;
  const eq = d.equity || {}, w = d.wealth || {}, l = d.liability || {}, cash = d.cash || {};
  const eqMV = eq.market_value || 0, wTotal = w.total || 0, cTotal = cash.total || 0, lTotal = l.total || 0;
  // 净资产 = 总资产(权益+理财+现金) − 负债；总资产 = 权益+理财+现金
  const net = eqMV + wTotal + cTotal - lTotal;
  const total = eqMV + wTotal + cTotal;
  // 境内/境外资产：后端已按来源 region 归集（domestic_assets / overseas_assets，CNY）
  const dom = d.domestic_assets || 0, ovs = d.overseas_assets || 0;
  // 合并为 3 张卡片：净资产(含总资产/负债行) / 境内外 / 资产分布(权益·理财·现金)
  const cardNet =
    `<div class="sum-card sum-merged">` +
      `<span class="sum-head">净资产</span>` +
      `<b class="sum-big">${money(net)}</b>` +
      `<div class="sum-rows">` +
        `<div class="sum-row"><span class="sr-lbl">总资产</span><span class="sr-val">${money(total)}</span></div>` +
        `<div class="sum-row"><span class="sr-lbl">负债</span><span class="sr-val ov-liab">${money(lTotal)}</span></div>` +
      `</div>` +
    `</div>`;
  const cardRegion =
    `<div class="sum-card sum-merged">` +
      `<span class="sum-head">境内 / 境外资产</span>` +
      `<div class="sum-rows sum-rows-plain">` +
        `<div class="sum-row"><span class="sr-lbl">境内资产</span><span class="sr-val ov-dom">${money(dom)}</span></div>` +
        `<div class="sum-row"><span class="sr-lbl">境外资产</span><span class="sr-val ov-ovs">${money(ovs)}</span></div>` +
      `</div>` +
    `</div>`;
  const cardDist =
    `<div class="sum-card sum-merged">` +
      `<span class="sum-head">资产分布</span>` +
      `<div class="sum-rows sum-rows-plain">` +
        `<div class="sum-row"><span class="sr-lbl">权益</span><span class="sr-val">${money(eqMV)}</span></div>` +
        `<div class="sum-row"><span class="sr-lbl">理财</span><span class="sr-val">${money(wTotal)}</span></div>` +
        `<div class="sum-row"><span class="sr-lbl">现金</span><span class="sr-val">${money(cTotal)}</span></div>` +
      `</div>` +
    `</div>`;
  $('#assetSummaryBody').innerHTML = `<div class="ac-summary-cards asset-cards">${cardNet}${cardRegion}${cardDist}</div>`;
}

function renderAssetTab() {
  const body = $('#assetTabBody');
  renderAssetToolbar(assetTab);
  if (assetTab === 'sources') return renderSources(body);
  if (assetTab === 'wealth') return renderWealth(body);
  if (assetTab === 'cash') return renderCash(body);
  if (assetTab === 'liability') return renderLiability(body);
  if (assetTab === 'consume') return renderConsume(body);
}

// 资产全景页内本地工具条：仅图表分析（AI中枢已迁至首页「添加」旁；数据录入迁至理财区；导入导出迁至用户抽屉）
function renderAssetToolbar(tab) {
  const t = document.getElementById('assetLocalToolbar');
  if (!t) return;
  const L = (s) => `<span class="atool-label">${s}</span>`;
  const B = (id, icon, tip) => `<button id="${id}" class="btn icon-btn" type="button" data-tip="${tip}" aria-label="${tip}">${icon}</button>`;
  t.innerHTML =
    B('assetCalendarBtn', '📅', '盈亏日历') + B('assetTrendBtn', '📈', '盈亏走势') + B('assetPieBtn', '🥧', '资产构成');
}
// 全局 header 工具条：资产工具 + 资产全景 + 通知渠道三个图标按钮，常驻暗黑模式切换按钮右侧
function renderGlobalAssetToolbar() {
  const t = document.getElementById('assetToolbar');
  if (!t) return;
  t.innerHTML =
    `<button id="assetToolsBtn" class="btn icon-btn" type="button" data-tip="资产工具" aria-label="资产工具">🛠️</button>` +
    `<button id="assetPanoNavBtn" class="btn icon-btn" type="button" data-tip="资产全景" aria-label="资产全景">🗂️</button>` +
    `<button id="notifyNavBtn" class="btn icon-btn" type="button" data-tip="通知渠道" aria-label="通知渠道">🔔</button>`;
  t.hidden = false;
}
renderGlobalAssetToolbar();

document.querySelectorAll('#assetTabs .atab').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#assetTabs .atab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    assetTab = b.dataset.tab;
    renderAssetTab();
    // 切 tab 后滚动到标签栏位置，避免内容高度变化导致页面跳动
    $('#assetTabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
});

// 资产工具栏按钮事件委托：全局 header(#assetToolbar) 与 资产全景页内(#assetLocalToolbar) 共用同一处理逻辑
function onAssetToolbarClick(e) {
  const b = e.target.closest('button');
  if (!b || !b.id) return;
  switch (b.id) {
    case 'assetCalendarBtn': openCalendarView(); break;
    case 'assetTrendBtn': renderTrend(); break;
    case 'assetPieBtn': renderPie(); break;
    case 'assetToolsBtn': showToolsView(); break;
    case 'assetPanoNavBtn':
      navigate('asset');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'notifyNavBtn':
      showNotifyView();
      break;
  }
}
document.getElementById('assetToolbar').addEventListener('click', onAssetToolbarClick);
document.getElementById('assetLocalToolbar').addEventListener('click', onAssetToolbarClick);

function assetDel(type, id) {
  const msg = {
    source: '确认删除该来源？关联记录会保留来源名快照，但来源本身不可恢复。',
    wealth: '确认删除该理财？其每日录入记录一并删除，不可恢复。',
    cash: '确认删除该现金记录？不可恢复。',
    liability: '确认删除该负债？不可恢复。',
    consumption: '确认删除该消费记录？不可恢复。',
  }[type] || '确认删除？';
  pendingAssetDel = { type, id };
  $('#confirmMsg').textContent = msg;
  $('#confirmModal').hidden = false;
}

// ---- 资产来源 ----
function renderSources(body) {
  const list = assetSources;
  let html = `<div class="asset-section-head"><h3>来源（${list.length}）</h3><button class="btn asset-add" id="addSourceBtn">＋ 添加来源</button></div>`;
  if (!list.length) html += `<div class="empty-block"><p class="empty">还没有来源，先添加一个银行、证券或软件吧。</p><button class="btn asset-add-inline" data-empty-add="source" type="button">➕ 添加来源</button></div>`;
  else {
    // 按类型分组：银行 / 证券 / 软件 / 平台（未知类型归银行）
    const typeOf = (s) => (s.type === 'securities' || s.type === 'software' || s.type === 'platform') ? s.type : 'bank';
    const typeName = { bank: '银行', securities: '证券', software: '软件', platform: '平台' };
    const groups = ['bank', 'securities', 'software', 'platform']
      .map((t) => ({ t, items: list.filter((s) => typeOf(s) === t).sort((a, b) => (b.funds_cny || 0) - (a.funds_cny || 0)) }))
      .filter((g) => g.items.length);
    for (const g of groups) {
      const gTotal = g.items.reduce((a, s) => a + (s.funds_cny || 0), 0);
      html += `<div class="collapsible source-group asset-pano collapsed"><div class="collapse-hat asset-pano-head">`;
      html += `<div class="ac-left"><span class="ac-name"><span class="src-ico">${srcTypeIcon(g.t)}</span> ${typeName[g.t]}（${g.items.length}）</span></div>`;
      html += `<div class="ac-right"><div class="ac-stat"><span class="ac-stat-lbl">关联资金</span><b>${money(gTotal)}</b></div><span class="hat-chevron">▾</span></div></div>`;
      html += `<div class="collapse-body source-group-body"><table class="asset-table"><thead><tr><th class="num">#</th><th>名称</th><th>类型</th><th class="num">关联数</th><th class="num">关联资金(CNY)</th><th>备注</th><th></th></tr></thead><tbody>`;
      for (let i = 0; i < g.items.length; i++) {
        const s = g.items[i];
        html += `<tr><td class="num">${i + 1}</td><td><span class="src-ico">${srcTypeIcon(typeOf(s))}</span> ${esc(s.name)}</td><td>${typeName[typeOf(s)]} <span class="src-region ${s.region === 'overseas' ? 'ovs' : 'dom'}">${s.region === 'overseas' ? '境外' : '境内'}</span></td>
          <td class="num" title="被持仓/理财/现金/负债/消费引用的条目数">${s.ref_count || 0}</td>
          <td class="num" title="该来源下持仓市值+理财金额+现金余额（折算 CNY）">¥${fmt(s.funds_cny || 0)}</td><td>${esc(s.note || '')}</td>
          <td class="num asset-row-actions"><button class="btn btn-icon" data-act="edit-source" data-id="${s.id}">✏️ 编辑</button><button class="btn btn-icon danger" data-act="del-source" data-id="${s.id}">🗑️ 删除</button></td></tr>`;
      }
      html += `</tbody></table></div></div>`;
    }
  }
  body.innerHTML = html;
  $('#addSourceBtn').onclick = () => openAssetSourceModal(null);
  body.querySelectorAll('[data-act="edit-source"]').forEach((b) => b.onclick = () => openAssetSourceModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="del-source"]').forEach((b) => b.onclick = () => assetDel('source', Number(b.dataset.id)));
}

function openAssetSourceModal(id) {
  const s = id ? assetSources.find((x) => x.id === id) : null;
  $('#assetSourceTitle').textContent = s ? '编辑来源' : '添加来源';
  $('#as_id').value = s ? s.id : '';
  $('#as_name').value = s ? s.name : '';
  $('#as_type').value = s ? s.type : 'bank';
  $('#as_region').value = s ? (s.region || 'domestic') : 'domestic';
  $('#as_note').value = s ? (s.note || '') : '';
  $('#assetSourceErr').textContent = '';
  $('#assetSourceModal').hidden = false;
}
$('#assetSourceForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#as_id').value ? Number($('#as_id').value) : 0;
  const payload = { name: $('#as_name').value.trim(), type: $('#as_type').value, region: $('#as_region').value, note: $('#as_note').value.trim() };
  if (!payload.name) { $('#assetSourceErr').textContent = '名称不能为空'; return; }
  try {
    const r = id ? await api('/api/asset/sources/' + id, { method: 'PUT', body: JSON.stringify(payload) })
                 : await api('/api/asset/sources', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#assetSourceErr').textContent = m; return; }
    $('#assetSourceModal').hidden = true;
    await loadAsset();
  } catch (err) { $('#assetSourceErr').textContent = '异常：' + err.message; }
};

// ---- 理财 ----
// 统一折算成 RMB 金额用于排序（不同币种可比较"总金额"）
function wealthAmount(p) {
  const a = Number(p.amount) || 0;
  const c = (p.currency || 'rmb').toLowerCase();
  if (c === 'usd') return a * (usdRate || 1);
  if (c === 'hkd') return a * (hkdRate || 1);
  return a;
}
// 任意理财金额折算成 RMB（总金额 / 今日收益 / 累计收益通用）
function wCny(p, v) {
  const a = Number(v) || 0;
  const c = (p.currency || 'rmb').toLowerCase();
  if (c === 'usd') return a * (usdRate || 1);
  if (c === 'hkd') return a * (hkdRate || 1);
  return a;
}
// 悬停 tooltip：非 RMB 币种显示"约 ¥xx"（RMB 币种返回空，不重复显示）
function wRmbTitle(p, v) {
  const c = (p.currency || 'rmb').toLowerCase();
  if (c === 'rmb') return '';
  return ` title="约 ¥${fmt(wCny(p, v))}"`;
}

function renderWealth(body) {
  const raw = (assetData.wealth || {}).products || [];
  const w = [...raw].sort((a, b) => Number(b.amount) - Number(a.amount)); // 按卡片显示的原币金额从大到小（与卡片展示口径一致）
  const toggleHtml = w.length ? `<div class="view-toggle" id="wealthViewToggle">
      <span class="vt-indicator" id="wealthVtIndicator"></span>
      <button class="btn vt-btn ${wealthView === 'table' ? 'active' : ''}" data-wview="table" type="button">表格</button>
      <button class="btn vt-btn ${wealthView === 'card' ? 'active' : ''}" data-wview="card" type="button">卡片</button>
    </div>` : '';
  let html = `<div class="asset-section-head"><h3>理财（${w.length}）</h3><div class="sec-actions"><button class="btn asset-add" id="assetSnapBtn" title="更新理财持仓">📥 更新</button><button class="btn asset-add" id="addWealthBtn">＋ 添加</button>${toggleHtml}</div></div>`;
  if (!w.length) html += `<div class="empty-block"><p class="empty">还没有理财，添加一个并每日录入持仓金额即可自动算每日盈亏。</p><button class="btn asset-add-inline" data-empty-add="wealth" type="button">➕ 添加第一笔理财</button></div>`;
  else if (wealthView === 'table') html += renderWealthTable(w);
  else {
    html += `<div class="asset-list wealth-list">`;
    w.forEach((p, i) => {
      const pnl = p.today_pnl || 0;
      const cum = p.cum_pnl || 0;
      html += `<div class="asset-card wealth-card"><div class="ac-head">
          <div class="ac-idx">${i + 1}</div>
          <div class="ac-main"><div class="ac-title">${esc(p.name)} <span class="cur-badge">${curSymbolJS(p.currency)}</span></div>
            <div class="ac-sub">${esc(p.code || '-')} ${esc(p.source_name || '')} ｜ 已录入 ${p.snap_count || 0} 天</div></div></div>
        <div class="ac-sub">总金额：<span class="ac-amount"${wRmbTitle(p, p.amount)}>${moneyCur(p.amount || 0, p.currency)}</span> ｜ 今日收益：<span class="${pnlCls(pnl)}"${wRmbTitle(p, pnl)}>${(pnl >= 0 ? '+' : '')}${moneyCur(pnl, p.currency)}</span> ｜ 累计收益：<span class="${pnlCls(cum)}"${wRmbTitle(p, cum)}>${(cum >= 0 ? '+' : '')}${moneyCur(cum, p.currency)}</span></div>
        <div class="ac-actions">
          <button class="btn btn-icon" data-act="wealth-hist" data-id="${p.id}">📈 每日盈亏</button>
          <button class="btn btn-icon" data-act="edit-wealth" data-id="${p.id}">✏️ 编辑</button>
          <button class="btn btn-icon danger" data-act="del-wealth" data-id="${p.id}">🗑️ 删除</button>
        </div></div>`;
    });
    html += `</div>`;
  }
  body.innerHTML = html;
  $('#assetSnapBtn').onclick = () => openSnapModal();
  $('#addWealthBtn').onclick = () => openWealthModal(null);
  body.querySelectorAll('[data-act="edit-wealth"]').forEach((b) => b.onclick = () => openWealthModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="del-wealth"]').forEach((b) => b.onclick = () => assetDel('wealth', Number(b.dataset.id)));
  body.querySelectorAll('[data-act="wealth-hist"]').forEach((b) => b.onclick = () => openWealthHistory(Number(b.dataset.id)));
  // 视图切换（表格 / 卡片），复用首页同款滑动切换器
  body.querySelectorAll('#wealthViewToggle .vt-btn').forEach((b) => {
    b.onclick = () => {
      wealthView = b.dataset.wview;
      localStorage.setItem('pf_wealth_view', wealthView);
      renderWealth(body);
    };
  });
  syncWealthToggle();
}

// 理财表格视图（与卡片视图共用同一份数据，列：名称/代码/来源/总金额/今日收益/累计收益/录入天数/操作）
function renderWealthTable(w) {
  let rows = w.map((p, i) => {
    const pnl = p.today_pnl || 0;
    const cum = p.cum_pnl || 0;
    return `<tr>
      <td class="num">${i + 1}</td>
      <td>${esc(p.name)} <span class="cur-badge">${curSymbolJS(p.currency)}</span></td>
      <td>${esc(p.code || '-')}</td>
      <td>${esc(p.source_name || '')}</td>
      <td class="num"${wRmbTitle(p, p.amount)}>${moneyCur(p.amount || 0, p.currency)}</td>
      <td class="num ${pnlCls(pnl)}"${wRmbTitle(p, pnl)}>${(pnl >= 0 ? '+' : '')}${moneyCur(pnl, p.currency)}</td>
      <td class="num ${pnlCls(cum)}"${wRmbTitle(p, cum)}>${(cum >= 0 ? '+' : '')}${moneyCur(cum, p.currency)}</td>
      <td class="num">${p.snap_count || 0}</td>
      <td class="num asset-row-actions">
        <button class="btn btn-icon" data-act="wealth-hist" data-id="${p.id}" title="每日盈亏">📈 每日盈亏</button>
        <button class="btn btn-icon" data-act="edit-wealth" data-id="${p.id}" title="编辑">✏️ 编辑</button>
        <button class="btn btn-icon danger" data-act="del-wealth" data-id="${p.id}" title="删除">🗑️ 删除</button>
      </td>
    </tr>`;
  }).join('');
  // 不包 .table-wrap：与现金等其它资产表格保持一致的左右间距
  return `<table class="asset-table"><thead><tr>
    <th class="num">#</th><th>名称</th><th>代码</th><th>来源</th><th class="num">总金额</th><th class="num">今日收益</th><th class="num">累计收益</th><th class="num">录入天数</th><th>操作</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

async function openWealthModal(id) {
  await loadSourcesCache();
  const sel = $('#w_source');
  sel.innerHTML = assetSources.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') || '<option value="">（请先添加来源）</option>';
  let w = null;
  if (id) { const r = await api('/api/asset/wealth'); if (r.ok) { const d = await r.json(); w = (d.wealth || []).find((x) => x.id === id); } }
  $('#wealthTitle').textContent = w ? '编辑理财' : '添加理财';
  $('#w_id').value = w ? w.id : '';
  $('#w_name').value = w ? w.name : '';
  $('#w_code').value = w ? (w.code || '') : '';
  $('#w_source').value = w ? w.source_id : (assetSources[0] ? assetSources[0].id : '');
  $('#w_currency').value = w ? (w.currency || 'rmb') : 'rmb';
  $('#w_cum').value = w ? (w.cum_pnl != null ? w.cum_pnl : '') : '';
  $('#w_note').value = w ? (w.note || '') : '';
  $('#wealthErr').textContent = '';
  $('#wealthModal').hidden = false;
}
$('#wealthForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#w_id').value ? Number($('#w_id').value) : 0;
  const payload = { name: $('#w_name').value.trim(), code: $('#w_code').value.trim(), source_id: Number($('#w_source').value) || 0, currency: $('#w_currency').value, cum_pnl: parseFloat($('#w_cum').value) || 0, note: $('#w_note').value.trim() };
  if (!payload.name) { $('#wealthErr').textContent = '名称不能为空'; return; }
  try {
    const r = id ? await api('/api/asset/wealth/' + id, { method: 'PUT', body: JSON.stringify(payload) })
                 : await api('/api/asset/wealth', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#wealthErr').textContent = m; return; }
    $('#wealthModal').hidden = true;
    await loadAsset();
  } catch (err) { $('#wealthErr').textContent = '异常：' + err.message; }
};

// ---- 现金 ----
function renderCash(body) {
  // 按金额(CNY 等值：USD/HKD 按页面汇率折算)从大到小排序
  const list = ((assetData.cash || {}).items || []).slice().sort((a, b) => toRmb(b, b.amount || 0) - toRmb(a, a.amount || 0));
  let html = `<div class="asset-section-head"><h3>现金（${list.length}）</h3><button class="btn asset-add" id="addCashBtn">＋ 添加现金</button></div>`;
  if (!list.length) html += `<div class="empty-block"><p class="empty">还没有现金记录，添加各账户的现金余额即可纳入总资产。</p><button class="btn asset-add-inline" data-empty-add="cash" type="button">➕ 添加现金</button></div>`;
  else {
    html += `<table class="asset-table"><thead><tr><th class="num">#</th><th>名称</th><th class="num">余额</th><th>币种</th><th>来源</th><th>备注</th><th></th></tr></thead><tbody>`;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      html += `<tr><td class="num">${i + 1}</td><td>${esc(c.name)}</td><td class="num">${moneyCur(c.amount || 0, c.currency)}</td><td>${curSymbolJS(c.currency)}</td><td>${esc(c.source_name || '')}</td><td>${esc(c.note || '')}</td>
        <td class="num asset-row-actions"><button class="btn btn-icon" data-act="edit-cash" data-id="${c.id}">✏️ 编辑</button><button class="btn btn-icon danger" data-act="del-cash" data-id="${c.id}">🗑️ 删除</button></td></tr>`;
    }
    html += `</tbody></table>`;
  }
  body.innerHTML = html;
  $('#addCashBtn').onclick = () => openCashModal(null);
  body.querySelectorAll('[data-act="edit-cash"]').forEach((b) => b.onclick = () => openCashModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="del-cash"]').forEach((b) => b.onclick = () => assetDel('cash', Number(b.dataset.id)));
}

async function openCashModal(id) {
  await loadSourcesCache();
  const sel = $('#c_source');
  sel.innerHTML = assetSources.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') || '<option value="">（请先添加来源）</option>';
  let c = null;
  if (id) { const r = await api('/api/asset/cash'); if (r.ok) { const d = await r.json(); c = (d.cash || []).find((x) => x.id === id); } }
  $('#cashTitle').textContent = c ? '编辑现金' : '添加现金';
  $('#c_id').value = c ? c.id : '';
  $('#c_name').value = c ? c.name : '';
  $('#c_currency').value = c ? (c.currency || 'rmb') : 'rmb';
  $('#c_amount').value = c ? c.amount : '';
  $('#c_source').value = c ? c.source_id : (assetSources[0] ? assetSources[0].id : '');
  $('#c_note').value = c ? (c.note || '') : '';
  $('#cashErr').textContent = '';
  $('#cashModal').hidden = false;
}
$('#cashForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#c_id').value ? Number($('#c_id').value) : 0;
  const payload = {
    name: $('#c_name').value.trim(), currency: $('#c_currency').value,
    amount: Number($('#c_amount').value || 0), source_id: Number($('#c_source').value) || 0, note: $('#c_note').value.trim(),
  };
  if (!payload.name) { $('#cashErr').textContent = '名称不能为空'; return; }
  if (!payload.amount) { $('#cashErr').textContent = '余额不能为空'; return; }
  try {
    const r = id ? await api('/api/asset/cash/' + id, { method: 'PUT', body: JSON.stringify(payload) })
                 : await api('/api/asset/cash', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#cashErr').textContent = m; return; }
    $('#cashModal').hidden = true;
    await loadAsset();
  } catch (err) { $('#cashErr').textContent = '异常：' + err.message; }
};

let currentWealthHistId = 0;
async function openWealthHistory(id) {
  currentWealthHistId = id;
  try {
    const r = await api('/api/asset/wealth/' + id + '/history');
    if (!r.ok) { toast('加载失败 (HTTP ' + r.status + ')', 'err'); return; }
    const d = await r.json();
    const rows = d.rows || [];
    // 标题：优先取理财名称
    let title = '理财每日盈亏';
    if (assetData && assetData.wealth && Array.isArray(assetData.wealth.products)) {
      const p = assetData.wealth.products.find((x) => x.id === id);
      if (p) title = (p.name || ('理财 #' + id)) + ' 每日盈亏';
    }
    $('#histTitle').textContent = title;
    $('#histModal').hidden = false;
    switchHistTab('table');
    let html = `<div class="wh-actions"><button type="button" class="btn" id="whAuditBtn">审计记录</button></div>`;
    if (!rows.length) { html += '<p class="empty">暂无录入记录。</p>'; }
    else {
      html += '<table class="asset-table"><thead><tr><th>日期</th><th class="num">持仓金额</th><th class="num">净存入</th><th class="num">当日盈亏</th><th class="num">累计盈亏</th><th></th></tr></thead><tbody>';
      for (const r2 of rows) {
        const p = r2.pnl || 0, cum = r2.cum_pnl || 0;
        html += `<tr><td>${r2.date}</td><td class="num">${money(r2.amount || 0)}</td><td class="num">${money(r2.cashflow || 0)}</td>
          <td class="num ${pnlCls(p)}">${pnlTxt(p)}</td><td class="num ${pnlCls(cum)}">${pnlTxt(cum)}</td>
          <td class="num asset-row-actions"><button class="btn btn-icon danger" data-del-date="${r2.date}">🗑️ 删除</button></td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += `<div id="whAuditPanel" hidden><h3>审计记录（修改/删除均可撤销）</h3><div id="whAuditBody"></div></div>`;
    $('#histTable').innerHTML = html;
    $('#whAuditBtn').onclick = loadWealthAudit;
    $('#histTable').querySelectorAll('[data-del-date]').forEach((b) => b.onclick = () => {
      pendingSnapDelete = { wealth_id: id, date: b.dataset.delDate };
      $('#confirmTitle').textContent = '删除当日快照';
      $('#confirmMsg').textContent = '确认删除 ' + b.dataset.delDate + ' 的这条持仓记录？删除后仍可在「审计记录」里撤销。';
      $('#confirmOk').textContent = '删除';
      $('#confirmOk').classList.add('danger');
      $('#confirmModal').hidden = false;
    });
    renderWealthHistChart(d);
  } catch (err) { toast('异常：' + err.message, 'err'); }
}

// 理财每日盈亏曲线：复用权益弹框的 dual-axis SVG（当日盈亏柱 + 累计盈亏折线）
function renderWealthHistChart(d) {
  const rows = (d.rows || []).slice().reverse(); // 旧→新，与曲线升序一致
  const s = rows.map((r) => ({ date: r.date, day_pnl: r.pnl || 0, total_pnl: r.cum_pnl || 0 }));
  const body = $('#histChartBody');
  if (s.length === 0) { body.innerHTML = '<p style="color:#8a8f99">暂无历史数据。</p>'; return; }
  const W = 720, H = 360, mL = 60, mR = 60, mT = 20, mB = 40;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const n = s.length;
  const maxBar = Math.max(1, ...s.map((x) => Math.abs(x.day_pnl)));
  const cVals = s.map((x) => x.total_pnl);
  const cMaxAbs = Math.max(1, ...cVals.map((v) => Math.abs(v)));
  const zeroY = mT + plotH / 2;
  const yBar = (v) => zeroY - (v / maxBar) * (plotH / 2);
  const yLine = (v) => zeroY - (v / cMaxAbs) * (plotH / 2);
  const slot = plotW / n;
  const bw = Math.max(2, slot * 0.6);
  const linePts = [];
  let bars = '', line = '', area = '', dots = '', hotspots = '';
  s.forEach((x, i) => {
    const cx = mL + (i + 0.5) * slot;
    hotspots += `<rect class="trend-hot" data-i="${i}" x="${(mL + i * slot).toFixed(2)}" y="${mT}" width="${slot.toFixed(2)}" height="${plotH}" fill="transparent"/>`;
    const ly = yLine(x.total_pnl);
    linePts.push([cx, ly]);
    const yv = yBar(x.day_pnl);
    const top = Math.min(zeroY, yv), hgt = Math.abs(yv - zeroY);
    const color = x.day_pnl > 0 ? '#f5222d' : x.day_pnl < 0 ? '#00a854' : '#c9ced6';
    bars += `<rect x="${(cx - bw / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.5, hgt).toFixed(2)}" rx="2" fill="${color}"/>`;
    line += `${(i === 0 ? 'M' : 'L')} ${cx.toFixed(2)} ${ly.toFixed(2)} `;
    dots += `<circle cx="${cx.toFixed(2)}" cy="${ly.toFixed(2)}" r="3" fill="#722ed1" stroke="#fff" stroke-width="1.2"/>`;
  });
  if (linePts.length) {
    let ap = `M ${linePts[0][0].toFixed(2)} ${zeroY.toFixed(2)} `;
    linePts.forEach((p) => { ap += `L ${p[0].toFixed(2)} ${p[1].toFixed(2)} `; });
    ap += `L ${linePts[linePts.length - 1][0].toFixed(2)} ${zeroY.toFixed(2)} Z`;
    area = `<path d="${ap}" fill="rgba(114,46,209,0.10)" stroke="none"/>`;
  }
  const xLabelStep = Math.max(1, Math.ceil(n / 10));
  let xlabels = '';
  s.forEach((x, i) => {
    if (i % xLabelStep === 0 || i === n - 1) {
      const cx = mL + (i + 0.5) * slot;
      xlabels += `<text x="${cx.toFixed(2)}" y="${H - 14}" font-size="10" fill="#8a8f99" text-anchor="middle">${x.date.slice(5)}</text>`;
    }
  });
  const yLabels = `
    <text x="${mL - 6}" y="${(zeroY - plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#f5222d" text-anchor="end">+${fmt(maxBar)}</text>
    <text x="${mL - 6}" y="${(zeroY + 4).toFixed(2)}" font-size="10" fill="#8a8f99" text-anchor="end">0</text>
    <text x="${mL - 6}" y="${(zeroY + plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#00a854" text-anchor="end">-${fmt(maxBar)}</text>
    <text x="${W - mR + 6}" y="${(zeroY - plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#722ed1" text-anchor="start">+${fmt(cMaxAbs)}</text>
    <text x="${W - mR + 6}" y="${(zeroY + 4).toFixed(2)}" font-size="10" fill="#8a8f99" text-anchor="start">0</text>
    <text x="${W - mR + 6}" y="${(zeroY + plotH / 2 + 4).toFixed(2)}" font-size="10" fill="#722ed1" text-anchor="start">-${fmt(cMaxAbs)}</text>`;
  const grid = `<line x1="${mL}" y1="${zeroY}" x2="${W - mR}" y2="${zeroY}" stroke="#e5e6eb" stroke-width="1"/>`;
  const legend = `
    <div style="display:flex;gap:18px;margin-top:10px;font-size:13px;flex-wrap:wrap">
      <span><span style="display:inline-block;width:12px;height:12px;background:#f5222d;border-radius:2px;margin-right:6px;vertical-align:middle"></span>当日盈亏 (左轴, 红涨绿跌)</span>
      <span><span style="display:inline-block;width:18px;height:3px;background:#722ed1;margin-right:6px;vertical-align:middle"></span>累计盈亏 (右轴)</span>
    </div>`;
  body.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${grid}${area}${bars}${hotspots}
      <path d="${line}" fill="none" stroke="#722ed1" stroke-width="2" stroke-linejoin="round"/>
      ${dots}${yLabels}${xlabels}
    </svg>${legend}`;
  document.querySelectorAll('#histChartBody .trend-hot').forEach((r) => {
    const i = +r.dataset.i;
    r.addEventListener('mouseenter', (e) => showHistTip(e, s[i]));
    r.addEventListener('mousemove', moveTrendTip);
    r.addEventListener('mouseleave', hideTrendTip);
  });
}

async function loadWealthAudit() {
  const id = currentWealthHistId;
  const panel = $('#whAuditPanel');
  panel.hidden = false;
  const body = $('#whAuditBody');
  body.innerHTML = '加载中…';
  try {
    const r = await api('/api/asset/wealth/' + id + '/audit');
    if (!r.ok) { body.innerHTML = '加载失败'; return; }
    const d = await r.json();
    const rows = d.rows || [];
    if (!rows.length) { body.innerHTML = '<p class="empty">暂无变更记录。</p>'; return; }
    const label = { upsert: '修改', delete: '删除', undo: '撤销' };
    let html = '<table class="asset-table"><thead><tr><th>时间</th><th>操作</th><th>日期</th><th class="num">旧值(金额/净存)</th><th class="num">新值(金额/净存)</th><th></th></tr></thead><tbody>';
    for (const a of rows) {
      const oldV = a.old_exists ? `${money(a.old_amount)} / ${money(a.old_cashflow)}` : '（无）';
      const newV = a.action === 'delete' ? '—' : `${money(a.new_amount)} / ${money(a.new_cashflow)}`;
      html += `<tr><td>${a.created_at}</td><td>${label[a.action] || a.action}</td><td>${a.date}</td>
        <td class="num">${oldV}</td><td class="num">${newV}</td>
        <td class="num asset-row-actions">${a.action === 'undo' ? '' : `<button class="btn btn-icon" data-undo="${a.id}">↩ 撤销</button>`}</td></tr>`;
    }
    html += '</tbody></table>';
    body.innerHTML = html;
    body.querySelectorAll('[data-undo]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        const r2 = await api('/api/asset/wealth/snapshots/undo', { method: 'POST', body: JSON.stringify({ audit_id: Number(b.dataset.undo) }) });
        if (!r2.ok) { let m = '撤销失败'; try { const d2 = await r2.json(); if (d2 && d2.error) m = d2.error; } catch (_) {} toast(m, 'err'); b.disabled = false; return; }
        toast('已撤销', 'ok');
        await loadWealthAudit();
      } catch (e) { toast('撤销异常：' + e.message, 'err'); b.disabled = false; }
    });
  } catch (e) { body.innerHTML = '异常：' + e.message; }
}

// ---- 负债 ----
function renderLiability(body) {
  const list = (assetData.liability || {}).items || [];
  let html = `<div class="asset-section-head"><h3>负债（${list.length}）</h3><button class="btn asset-add" id="addLbBtn">＋ 添加负债</button></div>`;
  if (!list.length) html += `<div class="empty-block"><p class="empty">暂无负债记录。</p><button class="btn asset-add-inline" data-empty-add="liability" type="button">➕ 添加负债</button></div>`;
  else {
    html += `<table class="asset-table"><thead><tr><th>名称</th><th>类型</th><th>来源</th><th class="num">欠款</th><th class="num">年利率</th><th class="num">月供</th><th>备注</th><th></th></tr></thead><tbody>`;
    for (const l of list) {
      html += `<tr><td>${esc(l.name)}</td><td>${esc(l.type || '')}</td><td>${esc(l.source_name || '')}</td>
        <td class="num">${money(l.amount || 0)}</td><td class="num">${l.rate ? l.rate + '%' : ''}</td><td class="num">${money(l.monthly_payment || 0)}</td>
        <td>${esc(l.note || '')}</td>
        <td class="num asset-row-actions"><button class="btn btn-icon" data-act="edit-lb" data-id="${l.id}">✏️ 编辑</button><button class="btn btn-icon danger" data-act="del-lb" data-id="${l.id}">🗑️ 删除</button></td></tr>`;
    }
    html += `</tbody></table>`;
  }
  body.innerHTML = html;
  $('#addLbBtn').onclick = () => openLiabilityModal(null);
  body.querySelectorAll('[data-act="edit-lb"]').forEach((b) => b.onclick = () => openLiabilityModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="del-lb"]').forEach((b) => b.onclick = () => assetDel('liability', Number(b.dataset.id)));
}

async function openLiabilityModal(id) {
  await loadSourcesCache();
  const sel = $('#lb_source');
  sel.innerHTML = assetSources.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') || '<option value="">（请先添加来源）</option>';
  let l = null;
  if (id) { const r = await api('/api/asset/liabilities'); if (r.ok) { const d = await r.json(); l = (d.liabilities || []).find((x) => x.id === id); } }
  $('#liabilityTitle').textContent = l ? '编辑负债' : '添加负债';
  $('#lb_id').value = l ? l.id : '';
  $('#lb_name').value = l ? l.name : '';
  $('#lb_type').value = l ? (l.type || '') : '';
  $('#lb_source').value = l ? l.source_id : (assetSources[0] ? assetSources[0].id : '');
  $('#lb_amount').value = l ? l.amount : '';
  $('#lb_rate').value = l ? (l.rate || '') : '';
  $('#lb_monthly').value = l ? (l.monthly_payment || '') : '';
  $('#lb_note').value = l ? (l.note || '') : '';
  $('#liabilityErr').textContent = '';
  $('#liabilityModal').hidden = false;
}
$('#liabilityForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#lb_id').value ? Number($('#lb_id').value) : 0;
  const payload = {
    name: $('#lb_name').value.trim(), type: $('#lb_type').value.trim(), source_id: Number($('#lb_source').value) || 0,
    amount: Number($('#lb_amount').value || 0), rate: Number($('#lb_rate').value || 0),
    monthly_payment: Number($('#lb_monthly').value || 0), note: $('#lb_note').value.trim(),
  };
  if (!payload.name) { $('#liabilityErr').textContent = '名称不能为空'; return; }
  if (!payload.amount) { $('#liabilityErr').textContent = '欠款余额不能为空'; return; }
  try {
    const r = id ? await api('/api/asset/liabilities/' + id, { method: 'PUT', body: JSON.stringify(payload) })
                 : await api('/api/asset/liabilities', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#liabilityErr').textContent = m; return; }
    $('#liabilityModal').hidden = true;
    await loadAsset();
  } catch (err) { $('#liabilityErr').textContent = '异常：' + err.message; }
};

// ---- 消费 ----
function renderConsume(body) {
  const list = (assetData.consumption || {}).items || [];
  let html = `<div class="asset-section-head"><h3>消费（最近 ${list.length}）</h3><button class="btn asset-add" id="addCsBtn">＋ 添加消费</button></div>`;
  if (!list.length) html += `<div class="empty-block"><p class="empty">还没有消费记录。</p><button class="btn asset-add-inline" data-empty-add="consume" type="button">➕ 添加消费</button></div>`;
  else {
    html += `<table class="asset-table"><thead><tr><th>日期</th><th>类别</th><th>来源</th><th class="num">金额</th><th>备注</th><th></th></tr></thead><tbody>`;
    for (const c of list) {
      html += `<tr><td>${esc(c.date)}</td><td>${esc(c.category || '')}</td><td>${esc(c.source_name || '')}</td>
        <td class="num">${money(c.amount || 0)}</td><td>${esc(c.note || '')}</td>
        <td class="num asset-row-actions"><button class="btn btn-icon" data-act="edit-cs" data-id="${c.id}">✏️ 编辑</button><button class="btn btn-icon danger" data-act="del-cs" data-id="${c.id}">🗑️ 删除</button></td></tr>`;
    }
    html += `</tbody></table>`;
  }
  body.innerHTML = html;
  $('#addCsBtn').onclick = () => openConsumeModal(null);
  body.querySelectorAll('[data-act="edit-cs"]').forEach((b) => b.onclick = () => openConsumeModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="del-cs"]').forEach((b) => b.onclick = () => assetDel('consumption', Number(b.dataset.id)));
}

async function openConsumeModal(id) {
  await loadSourcesCache();
  const sel = $('#cs_source');
  sel.innerHTML = assetSources.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') || '<option value="">（请先添加来源）</option>';
  let c = null;
  if (id) { const r = await api('/api/asset/consumptions'); if (r.ok) { const d = await r.json(); c = (d.consumptions || []).find((x) => x.id === id); } }
  $('#consumeTitle').textContent = c ? '编辑消费' : '添加消费';
  $('#cs_id').value = c ? c.id : '';
  $('#cs_date').value = c ? c.date : ymd(new Date());
  $('#cs_category').value = c ? (c.category || '') : '';
  $('#cs_amount').value = c ? c.amount : '';
  $('#cs_source').value = c ? c.source_id : (assetSources[0] ? assetSources[0].id : '');
  $('#cs_note').value = c ? (c.note || '') : '';
  $('#consumeErr').textContent = '';
  $('#consumeModal').hidden = false;
}
$('#consumeForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#cs_id').value ? Number($('#cs_id').value) : 0;
  const payload = {
    date: $('#cs_date').value || ymd(new Date()), category: $('#cs_category').value.trim(),
    amount: Number($('#cs_amount').value || 0), source_id: Number($('#cs_source').value) || 0, note: $('#cs_note').value.trim(),
  };
  if (!payload.category) { $('#consumeErr').textContent = '类别不能为空'; return; }
  if (!payload.amount) { $('#consumeErr').textContent = '金额不能为空'; return; }
  try {
    const r = id ? await api('/api/asset/consumptions/' + id, { method: 'PUT', body: JSON.stringify(payload) })
                 : await api('/api/asset/consumptions', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#consumeErr').textContent = m; return; }
    $('#consumeModal').hidden = true;
    await loadAsset();
  } catch (err) { $('#consumeErr').textContent = '异常：' + err.message; }
};

// ---- 每日持仓金额录入（自动算每日盈亏） ----
// assetSnapBtn 已迁至理财区「添加理财」旁（renderWealth 中直接绑定）

// ---- 通知渠道二级页 ----
// 通知渠道：改为弹框展示（保留 #/notify 路由，打开时叠加在当前视图上）
function switchNotifyTab(tab) {
  $('#ntTabPolicy').classList.toggle('active', tab === 'policy');
  $('#ntTabDt').classList.toggle('active', tab === 'dt');
  $('#ntTabEm').classList.toggle('active', tab === 'em');
  $('#ntPanelPolicy').hidden = tab !== 'policy';
  $('#ntPanelDt').hidden = tab !== 'dt';
  $('#ntPanelEm').hidden = tab !== 'em';
}
function showNotifyView() {
  // 无可见视图（如刷新后直接落在 #/notify）时，先落回首页作弹框背景
  if ($('#holdingsView').hidden && $('#assetView').hidden) {
    showHoldingsView();
  }
  $('#notifyModal').hidden = false;
  loadNotifySettings();
}
async function loadNotifySettings() {
  $('#notifyErr').textContent = '';
  try {
    const r = await api('/api/notify/settings');
    if (!r.ok) return;
    const d = await r.json();
    const dt = d.dingtalk || {};
    const em = d.email || {};
    $('#dtEnabled').checked = !!dt.enabled;
    $('#dtWebhook').dataset.raw = dt.webhook || '';
    $('#dtWebhook').value = maskSecret(dt.webhook || '');
    $('#dtWebhook').readOnly = true;
    $('#dtSecret').dataset.raw = dt.secret || '';
    $('#dtSecret').value = maskSecret(dt.secret || '');
    $('#dtSecret').readOnly = true;
    $('#emEnabled').checked = !!em.enabled;
    $('#emHost').value = em.smtp_host || '';
    $('#emPort').value = em.smtp_port || 465;
    $('#emUser').value = em.username || '';
    $('#emPass').value = em.password || '';
    $('#emFrom').value = em.from || '';
    $('#emTo').value = em.to || '';
    $('#ntfPolicy').value = d.policy || 'every';
  } catch (e) { /* 忽略，使用默认值 */ }
}
$('#notifySaveBtn').onclick = async () => {
  $('#notifyErr').textContent = '';
  const payload = {
    dingtalk: {
      enabled: $('#dtEnabled').checked,
      webhook: ($('#dtWebhook').readOnly ? ($('#dtWebhook').dataset.raw || '') : $('#dtWebhook').value).trim(),
      secret: ($('#dtSecret').readOnly ? ($('#dtSecret').dataset.raw || '') : $('#dtSecret').value).trim(),
    },
    email: {
      enabled: $('#emEnabled').checked,
      smtp_host: $('#emHost').value.trim(),
      smtp_port: parseInt($('#emPort').value, 10) || 465,
      username: $('#emUser').value.trim(),
      password: $('#emPass').value,
      from: $('#emFrom').value.trim(),
      to: $('#emTo').value.trim(),
    },
    policy: $('#ntfPolicy').value || 'every',
  };
  try {
    const r = await api('/api/notify/settings', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) {
      let m = '保存失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {}
      $('#notifyErr').textContent = m;
      return;
    }
    toast('通知配置已保存', 'ok');
  } catch (e) {
    $('#notifyErr').textContent = '保存异常：' + e.message;
  }
};
$('#notifyTestBtn').onclick = async () => {
  $('#notifyErr').textContent = '';
  const r = await api('/api/notify/test', { method: 'POST', body: JSON.stringify({}) });
  let m = '';
  if (!r.ok) {
    try { const d = await r.json(); m = d.error || ('测试失败 (HTTP ' + r.status + ')'); } catch (_) { m = '测试失败 (HTTP ' + r.status + ')'; }
    $('#notifyErr').textContent = m;
    return;
  }
  const d = await r.json();
  const res = d.results || {};
  const parts = Object.keys(res).map((k) => (k === 'dingtalk' ? '钉钉' : '邮箱') + '：' + res[k]);
  if (!parts.length) { $('#notifyErr').textContent = '没有已开启且配置完整的渠道'; return; }
  const okAll = parts.every((p) => p.endsWith('ok'));
  toast('测试结果 — ' + parts.join('；'), okAll ? 'ok' : 'err');
  $('#notifyErr').textContent = '测试结果：' + parts.join('；');
};
// 通知弹框：tab 切换 / 关闭（✕ 与点击遮罩）
$('#ntTabPolicy').onclick = () => switchNotifyTab('policy');
$('#ntTabDt').onclick = () => switchNotifyTab('dt');
$('#ntTabEm').onclick = () => switchNotifyTab('em');
$('#notifyClose').onclick = () => { $('#notifyModal').hidden = true; };
$('#notifyModal').addEventListener('click', (e) => { if (e.target === $('#notifyModal')) $('#notifyModal').hidden = true; });

// 资产工具弹框：tab 切换 / 关闭
$('#tlTabFx').onclick = () => switchToolsTab('fx');
$('#tlTabEq').onclick = () => switchToolsTab('eq');
$('#tlTabUsd').onclick = () => switchToolsTab('usd');
$('#tlTabScr').onclick = () => switchToolsTab('scr');
$('#toolsClose').onclick = () => { $('#toolsModal').hidden = true; };
$('#toolsModal').addEventListener('click', (e) => { if (e.target === $('#toolsModal')) $('#toolsModal').hidden = true; });

// ===== 评级逻辑 tab：自定义脚本编辑 / 保存 / 测试 =====
// 契约：实现 evaluate(ind) 返回 0~100 看涨概率。ind 字段见后端 IndicatorsResult json 标签。
const SCR_TEMPLATE = `// 自定义评级脚本示例（简化版均线+MACD+RSI 打分）
// 必须实现 evaluate(ind)，返回 0~100 的看涨概率
// 可用字段：ind.price / ind.ma5 / ind.ma10 / ind.ma20 / ind.ma60
//           ind.dif / ind.dea / ind.hist / ind.hist_prev   (MACD)
//           ind.rsi / ind.k / ind.d / ind.j                (RSI / KDJ)
//           ind.bu / ind.bm / ind.bl / ind.bw              (布林上/中/下轨/带宽)
// 内置助手：clamp(v, min, max)
function evaluate(ind) {
  var s = 0;
  s += ind.price > ind.ma5 ? 0.3 : -0.3;
  s += ind.price > ind.ma10 ? 0.3 : -0.3;
  s += ind.price > ind.ma20 ? 0.2 : -0.2;
  s += ind.dif > ind.dea ? 0.2 : -0.2;
  s += ind.hist > 0 ? 0.2 : -0.2;
  if (ind.rsi > 70) s -= 0.3;        // 超买减分
  else if (ind.rsi < 30) s += 0.3;   // 超卖加分
  return clamp(50 + s * 40, 10, 90);
}`;
const SCR_SIG_TXT = { buy: '买入', sell: '卖出', hold: '观望' };

// 压缩脚本为单行后保存：去块注释/行注释 → 折叠全部空白为单空格。
// 行注释仅在前置字符为空白或行首时剥离，避免误伤字符串中的 '://' 等。
function minifyScript(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// 把压缩成单行的脚本还原为可读的 pretty 格式（编辑器展示用，不改变语义）：
// 按 {} 换行缩进、顶层 ; 换行；字符串与括号内的 ; 不拆行（for(...) 保持完整）。
function prettyScript(code) {
  if (!code) return code;
  if (code.indexOf('\n') >= 0) return code; // 已是多行：视为未压缩，原样展示
  let out = '', ind = 0, paren = 0, str = null;
  const pad = (n) => '  '.repeat(Math.max(0, n));
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (str) {
      out += ch;
      if (ch === str && code[i - 1] !== '\\') str = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { str = ch; out += ch; continue; }
    if (ch === '(') { paren++; out += ch; continue; }
    if (ch === ')') { paren = Math.max(0, paren - 1); out += ch; continue; }
    if (ch === '{') { ind++; out += '{\n' + pad(ind); continue; }
    if (ch === '}') {
      ind = Math.max(0, ind - 1);
      out = out.replace(/[ \t]+$/, ''); // 去掉缩进尾巴
      out += '\n' + pad(ind) + '}\n' + pad(ind);
      continue;
    }
    if (ch === ';') {
      out += ';';
      if (paren === 0) out += '\n' + pad(ind);
      continue;
    }
    out += ch;
  }
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

let scrLoaded = false;
async function loadScriptTool() {
  if (scrLoaded) return;
  scrLoaded = true;
  // 填充测试下拉：可分析的持仓（股票 或 已关联代码的基金）
  const sel = $('#scrTestHolding');
  sel.innerHTML = allHoldings
    .filter((h) => h.category === 'stock' || (h.linked_symbol || h.category !== 'fund'))
    .map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('') || '<option value="">（暂无可分析持仓）</option>';
  try {
    const r = await api('/api/analysis-script');
    if (r.ok) {
      const s = await r.json();
      $('#scrCode').value = s.code ? prettyScript(s.code) : SCR_TEMPLATE;
      $('#scrEnabled').checked = !!s.enabled;
      $('#scrMeta').textContent = s.updated_at ? `（上次保存：${s.updated_at}）` : '';
      return;
    }
  } catch (_) {}
  $('#scrCode').value = SCR_TEMPLATE;
  $('#scrEnabled').checked = false;
}
$('#scrTemplate').onclick = () => { $('#scrCode').value = SCR_TEMPLATE; toast('已填入示例模板', 'info'); };
$('#scrSave').onclick = async () => {
  const code = minifyScript($('#scrCode').value);
  const enabled = $('#scrEnabled').checked;
  const btn = $('#scrSave');
  btn.disabled = true;
  try {
    const r = await api('/api/analysis-script', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, enabled }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || '保存失败', 'err'); return; }
    $('#scrMeta').textContent = d.updated_at ? `（上次保存：${d.updated_at}）` : '';
    toast(enabled ? '已保存并启用自定义脚本' : '已保存（使用内置逻辑）', 'ok');
  } catch (e) { toast('保存异常：' + e.message, 'err'); }
  finally { btn.disabled = false; }
};
$('#scrTest').onclick = async () => {
  const sel = $('#scrTestHolding');
  const id = sel.value;
  if (!id) { toast('请先选择一个测试持仓', 'err'); return; }
  const out = $('#scrTestResult');
  out.hidden = false;
  out.innerHTML = '<span style="color:var(--text-muted)">⏳ 正在测试…</span>';
  try {
    const r = await api('/api/analysis-script/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('#scrCode').value, holding_id: Number(id) }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { out.innerHTML = `<span class="scr-err">${esc(d.error || '测试失败')}</span>`; return; }
    if (d.error) { out.innerHTML = `<span class="scr-err">${esc(d.error)}</span>`; return; }
    const row = (label, up, sig, cls) => `<div class="scr-test-row ${cls}"><b>${label}</b><span>看涨 ${fmt(up)}%</span><span>评级：${SCR_SIG_TXT[sig] || sig || '—'}</span></div>`;
    let html = `<div class="scr-test-head">${esc(d.name)}（${esc(d.symbol)}）现价 ${fmt(d.price)}</div>`;
    html += row('内置默认', d.default_up_pct, d.default_signal, 'scr-def');
    if (d.custom_error) html += `<div class="scr-test-row scr-err"><b>自定义脚本</b><span>${esc(d.custom_error)}</span></div>`;
    else html += row('自定义脚本', d.custom_up_pct, d.custom_signal, 'scr-cus');
    out.innerHTML = html;
  } catch (e) { out.innerHTML = `<span class="scr-err">测试异常：${esc(e.message)}</span>`; }
};

// 盈亏日历弹框：关闭
$('#calClose').onclick = () => { $('#calendarModal').hidden = true; };
$('#calendarModal').addEventListener('click', (e) => { if (e.target === $('#calendarModal')) $('#calendarModal').hidden = true; });

async function openSnapModal() {
  await loadAsset();
  // 与理财卡片列表保持相同顺序（按原币持仓金额从大到小）
  const raw = (assetData.wealth || {}).products || [];
  const w = [...raw].sort((a, b) => Number(b.amount) - Number(a.amount));
  if (!w.length) { toast('请先在「理财」里添加一个产品', 'err'); return; }
  const today = ymd(new Date());
  const body = $('#snapBody');
  body.innerHTML = w.map((p) => `
    <div class="snap-row">
      <div class="sr-name">${esc(p.name)} <span class="cur-badge">${curSymbolJS(p.currency)}</span><small>${esc(p.source_name || '')} ｜ 上次持仓 ${moneyCur(p.amount || 0, p.currency)}</small></div>
      <div class="sr-fields">
        <div class="sr-field">
          <label class="sr-label" for="amt-${p.id}">① 今日持仓金额 ${curSymbolJS(p.currency)}</label>
          <input type="number" step="0.01" min="0" oninput="clampDecimals(this,2)" class="sr-amt" id="amt-${p.id}" data-id="${p.id}" value="${round2(p.amount || 0)}" placeholder="如 105000（今天收盘后的总市值）">
          <div class="sr-hint">该理财今天的总持仓金额（本金+收益）。默认带出上次录入值，留空则不更新此项。</div>
        </div>
        <div class="sr-field">
          <label class="sr-label" for="cf-${p.id}">② 当日净存入 ${curSymbolJS(p.currency)}</label>
          <input type="number" step="0.01" min="0" oninput="clampDecimals(this,2)" class="sr-cf" id="cf-${p.id}" data-id="${p.id}" value="0" placeholder="转入为正，转出为负，无变动填 0">
          <div class="sr-hint">今天新存入(+)或取出(−)的本金。用于剔除本金变动：当日盈亏 = 今日金额 − 昨日金额 − 当日净存入。</div>
        </div>
      </div>
    </div>`).join('');
  $('#snapModal').dataset.date = today;
  $('#snapModal').hidden = false;
}
$('#snapSave').onclick = async () => {
  const date = $('#snapModal').dataset.date || ymd(new Date());
  const items = [];
  const diff = [];
  $('#snapBody').querySelectorAll('.snap-row').forEach((row) => {
    const amtInput = row.querySelector('.sr-amt');
    if (amtInput.value === '') return;
    const id = Number(amtInput.dataset.id);
    const amount = Number(amtInput.value);
    const cashflow = Number(row.querySelector('.sr-cf').value || 0);
    const old = ((assetData.wealth || {}).products || []).find((p) => p.id === id);
    const oldAmt = old ? Number(old.amount || 0) : 0;
    items.push({ wealth_id: id, amount, cashflow });
    if (Math.abs(amount - oldAmt) > 0.005 || Math.abs(cashflow) > 0.005) {
      diff.push({ name: old ? old.name : ('#' + id), currency: old ? old.currency : 'rmb', oldAmt, amount, cashflow });
    }
  });
  if (!items.length) { toast('没有可保存的数据', 'err'); return; }
  if (!diff.length) { toast('数值未变化，无需保存', 'err'); return; }
  renderSnapConfirm(date, diff, items);
};

let pendingSnapSave = null;
function renderSnapConfirm(date, diff, items) {
  pendingSnapSave = { date, items };
  const body = $('#snapConfirmBody');
  body.innerHTML = `<p class="snap-hint">请核对以下 ${diff.length} 项「旧值 → 新值」，确认无误后保存。保存后若录错，可到该理财「每日盈亏 → 审计记录」里一键撤销或删除。</p>
    <table class="asset-table"><thead><tr><th>理财</th><th class="num">旧持仓</th><th></th><th class="num">新持仓</th><th class="num">当日净存入</th></tr></thead><tbody>
    ${diff.map((d) => `<tr><td>${esc(d.name)}</td><td class="num">${moneyCur(d.oldAmt, d.currency)}</td><td class="num">→</td><td class="num">${moneyCur(d.amount, d.currency)}</td><td class="num ${d.cashflow >= 0 ? 'up' : 'down'}">${d.cashflow >= 0 ? '+' : ''}${moneyCur(d.cashflow, d.currency)}</td></tr>`).join('')}
    </tbody></table>`;
  $('#snapConfirmModal').hidden = false;
}
$('#snapConfirmOk').onclick = async () => {
  if (!pendingSnapSave) return;
  const { date, items } = pendingSnapSave;
  pendingSnapSave = null;
  $('#snapConfirmModal').hidden = true;
  try {
    const r = await api('/api/asset/wealth/snapshots', { method: 'POST', body: JSON.stringify({ date, items }) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
    $('#snapModal').hidden = true;
    toast('今日持仓已保存', 'ok');
    await loadAsset();
  } catch (err) { toast('保存异常：' + err.message, 'err'); }
};
$('#snapConfirmCancel').onclick = () => { pendingSnapSave = null; $('#snapConfirmModal').hidden = true; };

// ---- 一键 AI 总结（汇总全部资产） ----
async function assetAiSummarize(tplIdx) {
  const boxKey = ($('#ai_apikey') ? $('#ai_apikey').value : '').trim();
  const lsKey = (localStorage.getItem('pf_ai_key') || '').trim();
  const api_key = boxKey || lsKey || (aiCfg.api_key || '').trim();
  const model = ($('#ai_model').value || '').trim() || 'deepseek-v4-pro';
  const base_url = ($('#ai_baseurl').value || '').trim() || 'https://api.deepseek.com';
  // 与权益类一致：优先使用 AI 设置弹框中当前编辑/选中的模板，避免静默回退到第一条或默认模板
  const edited = ($('#ai_tpl_content') ? $('#ai_tpl_content').value : '');
  let content;
  if (typeof tplIdx === 'number' && aiCfg.templates[tplIdx]) content = aiCfg.templates[tplIdx].content;
  else content = (edited && edited.trim()) ? edited : (aiCfg.templates[aiSelIdx] ? aiCfg.templates[aiSelIdx].content : '');
  if (!api_key) { toast('请先在「AI 设置」填写 API Key', 'err'); openAIModal(); return; }
  if (!content) { toast('提示词模板为空，请先在「AI 设置」选择或填写模板', 'err'); openAIModal(); return; }
  if (api_key) localStorage.setItem('pf_ai_key', api_key);
  openAIResultModal('生成中…（正在汇总全部资产并调用模型，请稍候）', true);
  $('#aiPickGo').disabled = true;
  try {
    const r = await api('/api/asset/summary', { method: 'POST', body: JSON.stringify({ model, base_url, api_key, template: content }) });
    if (!r.ok) { let m = '生成失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#aiResultBody').textContent = m; return; }
    const d = await r.json();
    setAIResult(d.content);
  } catch (err) {
    $('#aiResultBody').textContent = '异常：' + err.message;
  } finally {
    $('#aiPickGo').disabled = false;
  }
}

// ── 技术分析 ──────────────────────────────────────────
let analysisGenId = 0; // 防止并发打开时旧请求覆盖新请求渲染
async function openAnalysis(id) {
  const myGen = ++analysisGenId;
  const modal = $('#analysisModal');
  const body = $('#analysisBody');
  // 打开即重置标题与时间，避免残留上一次标的的信息
  $('#analysisTitle').textContent = '📊 技术分析（加载中…）';
  const tsPre = document.getElementById('analysisTime');
  if (tsPre) tsPre.textContent = '';
  body.innerHTML = '<div class="analysis-loading"><span class="ana-funnel">⏳</span> 正在获取技术分析数据…</div>';
  modal.hidden = false;
  try {
    const r = await api('/api/holdings/' + id + '/analysis');
    if (myGen !== analysisGenId) return; // 已有更新的请求，放弃本次渲染
    if (!r.ok) {
      let msg = '获取技术分析失败 (HTTP ' + r.status + ')';
      try { const e = await r.json(); if (e.error) msg += '：' + e.error; } catch (_) {}
      $('#analysisTitle').textContent = '📊 技术分析';
      body.innerHTML = '<div class="analysis-err">' + msg + '</div>';
      return;
    }
    const d = await r.json();
    if (myGen !== analysisGenId) return;
    const a = d.analysis;
    if (a.error) {
      $('#analysisTitle').textContent = '📊 技术分析';
      body.innerHTML = '<div class="analysis-err">' + a.error + '</div>';
      return;
    }
    // 基金：仅当后端未返回指标（未关联股票代码/数据不足）时才提示不支持；
    // 有关联代码且分析成功的基金应正常渲染。
    if (a.category === 'fund' && !a.indicators) {
      $('#analysisTitle').textContent = '📊 技术分析';
      body.innerHTML = '<div class="analysis-err">该基金未设置关联股票代码，不支持技术分析</div>';
      return;
    }
    $('#analysisTitle').textContent = '📊 ' + a.name + (a.category === 'fund' ? ' (关联 ' + a.symbol + ')' : ' (' + a.symbol + ')') + ' 技术分析';
    renderAnalysis(a);
    // 用本次分析结论刷新该行买卖角标，避免弹框显示“中性”而角标仍显示“买”
    syncAnalysisBadge(id, a.signal || '');
    const tsEl = document.getElementById('analysisTime');
    if (tsEl) tsEl.textContent = (a.market ? a.market + ' · ' : '') + '周期 1d · 数据截至 ' + (a.generated_at || '—');
  } catch (e) {
    if (myGen !== analysisGenId) return;
    $('#analysisTitle').textContent = '📊 技术分析';
    body.innerHTML = '<div class="analysis-err">异常：' + e.message + '</div>';
  }
}

// 迷你K线（纯SVG蜡烛图，使用分析接口返回的已有日K线数据组装）
// patMap: { [date]: [{name, dir}] } —— 命中形态的日期→形态列表，用于悬停提示（不在蜡烛上加外边框）
// 分页：每页 base*zoom 根（1×=60），左右箭头按日期区间循环翻页（page 0 = 最近一段）。
let klState = null; // { bars, patMap, sigMap, base, zoom, win, pages, page }
function klineMiniHTML(bars, patMap, dailySignals) {
  const sigMap = {};
  (dailySignals || []).forEach((d) => { if (d && d.date) sigMap[d.date] = d.signal; });
  klState = { bars, patMap, sigMap, base: 60, zoom: 1, page: 0, win: Math.min(bars.length, 60), pages: 1 };
  return klRenderWindow();
}

// 渲染当前 klState.page 对应的窗口（窗口大小 = base*zoom，箭头/缩放翻页时整块替换重绑）
function klRenderWindow() {
  const { bars, patMap, sigMap, base, zoom, page } = klState;
  const win = Math.min(bars.length, base * zoom);
  const pages = Math.max(1, Math.floor((bars.length - win) / win) + 1);
  klState.win = win; klState.pages = pages;
  const end = bars.length - page * win;
  const data = bars.slice(Math.max(0, end - win), end);
  if (!data.length) return '';
  const n = data.length;
  let hi = -Infinity, lo = Infinity;
  data.forEach((b) => { if (b.High > hi) hi = b.High; if (b.Low < lo) lo = b.Low; });
  if (!(hi > lo)) { hi = lo + 1; }
  const pad = (hi - lo) * 0.08; hi += pad; lo -= pad;
  const W = 600, H = 168, step = W / n, cw = Math.max(1.5, step * 0.62);
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const up = '#ff4757', down = '#2ed573';
  // 压力位 / 支撑位：可视区间内极值（根据已有日K线数据组装，不新增条目）
  let res = -Infinity, sup = Infinity;
  data.forEach((b) => { if (b.High > res) res = b.High; if (b.Low < sup) sup = b.Low; });
  let body = '';
  // 压力位虚线（上）
  if (res > lo && res < hi) body += '<line x1="0" y1="' + y(res).toFixed(2) + '" x2="' + W + '" y2="' + y(res).toFixed(2) + '" stroke="#f59e0b" stroke-width="0.9" stroke-dasharray="5 3"/>';
  // 支撑位虚线（下）
  if (sup > lo && sup < hi) body += '<line x1="0" y1="' + y(sup).toFixed(2) + '" x2="' + W + '" y2="' + y(sup).toFixed(2) + '" stroke="#38bdf8" stroke-width="0.9" stroke-dasharray="5 3"/>';
  data.forEach((b, i) => {
    const x = i * step + step / 2;
    const isUp = b.Close >= b.Open;
    const col = isUp ? up : down;
    const yO = y(b.Open), yC = y(b.Close);
    const top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yO - yC));
    const px = (x / W * 100).toFixed(2);
    const py = (yC / H * 100).toFixed(2);
    const ps = (patMap && patMap[b.Date]) || [];
    const patAttr = ps.length ? ' data-pat="' + ps.map((p) => p.dir + '~' + p.name).  join('|') + '"' : '';
    let mark = '';
    if (ps.length) {
      const mc = ps[0].dir === 'bullish' ? '#ff4757' : ps[0].dir === 'bearish' ? '#2ed573' : '#f59e0b';
      const gap = 8, triH = 5;            // 倒三角与蜡烛最高价之间的留白 / 三角高度
      const triW = Math.max(cw, 5);       // 底边至少为蜡烛宽度
      const apexY = Math.max(triH + 0.5, y(b.High) - gap); // 朝下顶点，距蜡烛 gap
      const tTop = apexY - triH;
      mark = '<polygon class="kl-patmark" points="'
        + (x - triW / 2).toFixed(2) + ',' + tTop.toFixed(2) + ' '
        + (x + triW / 2).toFixed(2) + ',' + tTop.toFixed(2) + ' '
        + x.toFixed(2) + ',' + apexY.toFixed(2)
        + '" fill="' + mc + '"/>';
    }
    const sigAttr = sigMap[b.Date] ? ' data-sig="' + sigMap[b.Date] + '"' : '';
    body += '<g class="kc" data-d="' + esc(b.Date) + '" data-c="' + b.Close.toFixed(2) + '" data-pc="' + (i > 0 ? data[i - 1].Close.toFixed(2) : '') + '" data-dir="' + (isUp ? 'up' : 'down') + '" data-px="' + px + '" data-py="' + py + '"' + patAttr + sigAttr + '>';
    body += '<line class="kl-wick" x1="' + x.toFixed(2) + '" y1="' + y(b.High).toFixed(2) + '" x2="' + x.toFixed(2) + '" y2="' + y(b.Low).toFixed(2) + '" stroke="' + col + '" stroke-width="1"/>';
    body += '<rect class="kl-body" x="' + (x - cw / 2).toFixed(2) + '" y="' + top.toFixed(2) + '" width="' + cw.toFixed(2) + '" height="' + hgt.toFixed(2) + '" fill="' + col + '"/>';
    body += '<rect class="kl-hit" x="' + (i * step).toFixed(2) + '" y="0" width="' + step.toFixed(2) + '" height="' + H + '" fill="rgba(0,0,0,0)"/>';
    body += mark;
    body += '</g>';
  });
  // 收盘价折线（折线图模式显示，蜡烛图模式隐藏）：与蜡烛共享同一坐标缩放
  let linePts = '';
  data.forEach((b, i) => {
    linePts += (i ? ' ' : '') + (i * step + step / 2).toFixed(2) + ',' + y(b.Close).toFixed(2);
  });
  body += '<polyline class="kl-close-line" points="' + linePts + '" fill="none" stroke="#3b82f6" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>';
  // 计算 MA 线：MA5 / MA10 / MA20（SMA，不足周期时从首个有值位置开始）
  const mas = [
    { period: 5, color: '#f97316', label: 'MA5' },
    { period: 10, color: '#22c55e', label: 'MA10' },
    { period: 20, color: '#eab308', label: 'MA20' },
  ];
  mas.forEach((ma) => {
    let pts = '';
    data.forEach((b, i) => {
      if (i + 1 < ma.period) return;
      let sum = 0;
      for (let j = i - ma.period + 1; j <= i; j++) sum += data[j].Close;
      const avg = sum / ma.period;
      const x = (i * step + step / 2).toFixed(2);
      const yv = y(avg).toFixed(2);
      pts += (pts ? ' ' : '') + x + ',' + yv;
    });
    if (pts) body += '<polyline points="' + pts + '" fill="none" stroke="' + ma.color + '" stroke-width="1.2" stroke-linejoin="round" opacity="0.75"/>';
  });

  // MACD(12,26,9)：DIF=EMA12-EMA26，DEA=EMA9(DIF)，柱=2*(DIF-DEA)；独立小SVG共享同x轴，红涨绿跌
  const Hm = 44, zeroY = Hm / 2;
  const closes = data.map((b) => b.Close);
  const emaGen = (period) => { const k = 2 / (period + 1); let prev = closes[0]; return closes.map((c) => (prev = c * k + prev * (1 - k))); };
  const e12 = emaGen(12), e26 = emaGen(26);
  const dif = closes.map((_, i) => e12[i] - e26[i]);
  let dprev = dif[0];
  const dea = dif.map((v) => (dprev = v * (2 / 10) + dprev * (8 / 10)));
  const hist = dif.map((v, i) => (v - dea[i]) * 2);
  let mAbs = 0; hist.forEach((v) => { const a = Math.abs(v); if (a > mAbs) mAbs = a; });
  let mBody = '<line x1="0" y1="' + zeroY + '" x2="' + W + '" y2="' + zeroY + '" stroke="#64748b" stroke-width="0.8" opacity="0.5"/>';
  hist.forEach((v, i) => {
    const h = Math.max(0.8, Math.abs(v) / mAbs * (Hm / 2 - 2));
    const x = i * step + step / 2;
    mBody += '<rect x="' + (x - cw / 2).toFixed(2) + '" y="' + (zeroY - h).toFixed(2) + '" width="' + cw.toFixed(2) + '" height="' + h.toFixed(2) + '" fill="' + (v >= 0 ? up : down) + '" opacity="0.85"/>';
  });

  const last = data[data.length - 1].Close;
  const yLast = y(last);
  body += '<line x1="0" y1="' + yLast.toFixed(2) + '" x2="' + W + '" y2="' + yLast.toFixed(2) + '" stroke="#94a3b8" stroke-width="0.8" stroke-dasharray="3 3"/>';
  // 窗口日期区间（MM-DD~MM-DD），箭头翻页时随之更新
  const range = data[0].Date.slice(5).replace(/-/g, '/') + '~' + data[data.length - 1].Date.slice(5).replace(/-/g, '/');
  const arrows = pages > 1
    ? '<button class="kl-arrow kl-prev" type="button" data-dir="1" aria-label="更早一段">‹</button>'
    + '<button class="kl-arrow kl-next" type="button" data-dir="-1" aria-label="更近一段">›</button>'
    : '';
  const zIn = zoom >= 3 ? ' disabled' : '';
  const zOut = zoom <= 1 ? ' disabled' : '';
  const zoombar = '<div class="kl-zoombar">'
    + '<button class="kl-zoom kl-zoom-out" type="button" data-zoom="-1" aria-label="缩小"' + zOut + '>−</button>'
    + '<span class="kl-zoom-lv">×' + zoom + '</span>'
    + '<button class="kl-zoom kl-zoom-in" type="button" data-zoom="1" aria-label="放大"' + zIn + '>+</button>'
    + '<button class="kl-toggle" type="button" data-mode="candle" aria-label="切换折线图">折线</button>'
    + '</div>';
  return '<div class="kline-mini"><div class="klwrap">'
    + '<div class="kl-label"><span class="kl-title">日K线</span><span style="color:#f97316">MA5</span><span style="color:#22c55e">MA10</span><span style="color:#eab308">MA20</span><span class="kl-range">' + range + '</span></div>'
    + zoombar
    + arrows
    + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + body + '</svg>'
    + '<div class="kline-mini-tip" hidden></div></div>'
    + '<div class="kl-macd"><span class="kl-macd-label">MACD(12,26,9)</span><svg viewBox="0 0 ' + W + ' ' + Hm + '" preserveAspectRatio="none">' + mBody + '</svg></div>'
    + '<div class="kline-mini-meta"><span style="color:#f59e0b">压力 ' + res.toFixed(2) + '</span><span style="color:#38bdf8">支撑 ' + sup.toFixed(2) + '</span><span class="' + (hist[hist.length - 1] >= 0 ? 'up' : 'down') + '">MACD ' + hist[hist.length - 1].toFixed(2) + '</span><span class="' + (last >= data[0].Open ? 'up' : 'down') + '">最新 ' + last.toFixed(2) + '</span></div></div>';
}

// 箭头翻页：按窗口长度切换显示的K线日期区间（‹更早 / ›更近），到边界时提示、不循环
function klGo(dir) {
  if (!klState || klState.pages <= 1) return;
  const target = klState.page + dir;
  if (target < 0) { toast('已经是最近的数据了', 'info'); return; }
  if (target >= klState.pages) { toast('没有更早的数据了', 'info'); return; }
  klState.page = target;
  const cur = document.querySelector('#analysisBody .kline-mini');
  if (!cur) return;
  const holder = document.createElement('div');
  holder.innerHTML = klRenderWindow();
  const fresh = holder.firstElementChild;
  if (!fresh) return;
  cur.replaceWith(fresh);
  bindKlineMini(fresh);
}

// 缩放：调整每页K线数据量（1×=60根，+/− 在 1×~3× 间切换），回到最近一段窗口并重渲染
function klZoom(delta) {
  if (!klState) return;
  const nz = Math.min(3, Math.max(1, klState.zoom + delta));
  if (nz === klState.zoom) { toast(nz >= 3 ? '已放大到最大 3×' : '已是最小 1×', 'info'); return; }
  klState.zoom = nz;
  klState.page = 0;
  const cur = document.querySelector('#analysisBody .kline-mini');
  if (!cur) return;
  const holder = document.createElement('div');
  holder.innerHTML = klRenderWindow();
  const fresh = holder.firstElementChild;
  if (!fresh) return;
  cur.replaceWith(fresh);
  bindKlineMini(fresh);
}

// 迷你K线交互：悬停预览 / 点击固定显示 日期+收盘价；再次点击或点空白取消
function bindKlineMini(root) {
  const wrap = root.querySelector('.klwrap');
  if (!wrap) return;
  const tip = wrap.querySelector('.kline-mini-tip');
  // 蜡烛图 / 折线图切换：按钮显示「要切换到」的模式名
  const tg = wrap.querySelector('.kl-toggle');
  if (tg) tg.addEventListener('click', (e) => {
    e.stopPropagation();
    const mini = wrap.closest('.kline-mini');
    if (!mini) return;
    const line = mini.classList.toggle('mode-line');
    tg.dataset.mode = line ? 'line' : 'candle';
    tg.textContent = line ? '蜡烛' : '折线';
    const title = wrap.querySelector('.kl-title');
    if (title) title.textContent = line ? '收盘折线' : '日K线';
    pinned = null; clearSel(); hideTip(); hover = null;
  });
  // 左右箭头：按日期区间循环翻页（整块重渲染后由 klGo 内部重绑）
  wrap.querySelectorAll('.kl-arrow').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    klGo(Number(b.dataset.dir) || 0);
  }));
  // 缩放：调整每页K线数据量（1×~3×）
  wrap.querySelectorAll('.kl-zoom').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    klZoom(Number(b.dataset.zoom) || 0);
  }));
  let pinned = null, hover = null, tipTimer = null;
  function showTip(g, stay) {
    const c = Number(g.dataset.c);
    let html = '<div class="kl-tip-d">' + esc(g.dataset.d) + '</div>';
    const pc = g.dataset.pc ? Number(g.dataset.pc) : 0;
    if (pc > 0) {
      const pct = (c - pc) / pc * 100;
      html += '<div class="kl-tip-c ' + (pct >= 0 ? 'up' : 'down') + '">涨跌幅 ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%</div>';
    }
    html += '<div class="kl-tip-c ' + g.dataset.dir + '">收盘 ' + c.toFixed(2) + '</div>';
    const sig = g.dataset.sig;
    if (sig) {
      const m = ({ buy: { t: '买入', c: 'up', a: '▲' }, sell: { t: '卖出', c: 'down', a: '▼' }, hold: { t: '中性', c: 'neu', a: '◆' } })[sig] || { t: '—', c: 'neu', a: '◆' };
      html += '<div class="kl-tip-pat ' + m.c + '">' + m.a + ' 评级 ' + m.t + '</div>';
    }
    const pat = g.dataset.pat;
    if (pat) {
      pat.split('|').forEach((seg) => {
        const parts = seg.split('~');
        const d = parts[0], name = parts.slice(1).join('~');
        const cls = d === 'bullish' ? 'up' : d === 'bearish' ? 'down' : 'neu';
        const ar = d === 'bullish' ? '▲' : d === 'bearish' ? '▼' : '◆';
        html += '<div class="kl-tip-pat ' + cls + '">' + ar + ' ' + esc(name) + '</div>';
      });
    }
    tip.innerHTML = html;
    tip.style.transform = 'none';
    tip.hidden = false;
    // 悬停态 3 秒后自动隐藏，避免遮挡 K 线；pin(点击钉住)态 stay=true 常驻
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    if (!stay) tipTimer = setTimeout(hideTip, 3000);
    // 以 .klwrap 为定位上下文，用像素定位并夹取在可视区内，避免溢出/窝角
    const wx = wrap.getBoundingClientRect();
    const tx = tip.getBoundingClientRect();
    const tw = tx.width, th = tx.height;
    const px = parseFloat(g.dataset.px) / 100 * wx.width;   // 蜡烛中心 x（svg 横向填满 wrap）
    const py = parseFloat(g.dataset.py) / 100 * wx.height;  // 蜡烛中心 y（svg 纵向拉伸填满 wrap）
    let left = px - tw / 2;
    let top = (py >= 16) ? (py - th - 8) : (py + 8);        // 默认悬于蜡烛上方，贴顶时改下方
    if (left < 2) left = 2;
    if (left + tw > wx.width - 2) left = Math.max(2, wx.width - tw - 2);
    if (top < 2) top = 2;
    if (top + th > wx.height - 2) top = Math.max(2, wx.height - th - 2);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip() { if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; } tip.hidden = true; hover = null; }
  function clearSel() { wrap.querySelectorAll('.kc.sel').forEach((x) => x.classList.remove('sel')); }
  wrap.addEventListener('mousemove', (e) => {
    if (pinned) return;
    const g = e.target.closest('.kc');
    if (g) { if (hover !== g.dataset.d) { showTip(g); hover = g.dataset.d; } }
    else if (hover) { hideTip(); hover = null; }
  });
  wrap.addEventListener('click', (e) => {
    const g = e.target.closest('.kc');
    if (!g) { pinned = null; clearSel(); hideTip(); hover = null; return; }
    if (pinned === g.dataset.d) { pinned = null; clearSel(); hideTip(); hover = null; }
    else { pinned = g.dataset.d; clearSel(); g.classList.add('sel'); showTip(g, true); hover = g.dataset.d; }
  });
  wrap.addEventListener('mouseleave', () => { hideTip(); });
}

// ── K线形态识别 ──────────────────────────────────────────
// 基于分析接口返回的日K线(series)做纯前端形态识别，无需后端改动。
function trendContext(bars, i, n) {
  if (i < n) return 'neutral';
  let sum = 0;
  for (let k = i - n; k < i; k++) sum += bars[k].Close;
  const sma = sum / n;
  const c = bars[i].Close;
  if (c < sma * 0.995) return 'down';
  if (c > sma * 1.005) return 'up';
  return 'neutral';
}

// 返回数组：{ idx, date, name, dir('bullish'|'bearish'|'neutral'), desc }
// 头肩底（简化启发式）：在 bar i 背后 30 根窗口内寻找 左肩-头-右肩 结构，
// 且当前(或近 4 根内)向上突破颈线。仅在「首次突破」那根标记为信号，避免连续重复命中。
function detectHSBottom(bars, i) {
  const w = 30;
  if (i - w < 0) return null;
  const seg = bars.slice(i - w, i + 1); // 长 31，末尾(索引30)即 bar i
  const L = seg.length;
  // 头：中间区域 [8,22] 最低 Low
  let headPos = -1, headLow = Infinity;
  for (let k = 8; k <= 22; k++) { if (seg[k].Low < headLow) { headLow = seg[k].Low; headPos = k; } }
  if (headPos < 0) return null;
  // 左肩：头之前区域最低 Low
  let lsPos = -1, lsLow = Infinity;
  for (let k = 0; k <= headPos - 3; k++) { if (seg[k].Low < lsLow) { lsLow = seg[k].Low; lsPos = k; } }
  // 右肩：头之后区域最低 Low
  let rsPos = -1, rsLow = Infinity;
  for (let k = headPos + 3; k <= L - 3; k++) { if (seg[k].Low < rsLow) { rsLow = seg[k].Low; rsPos = k; } }
  if (lsPos < 0 || rsPos < 0) return null;
  // 头必须最低于两肩
  if (!(headLow < lsLow - 1e-6 && headLow < rsLow - 1e-6)) return null;
  // 两肩低点大致相当（容差 7%）
  if (lsLow > 0 && Math.abs(lsLow - rsLow) / lsLow > 0.07) return null;
  // 颈线 = 两肩间两个峰(High)的平均值（左肩→头、头→右肩）
  let peakL = -Infinity;
  for (let k = lsPos; k <= headPos; k++) { if (seg[k].High > peakL) peakL = seg[k].High; }
  let peakR = -Infinity;
  for (let k = headPos; k <= rsPos; k++) { if (seg[k].High > peakR) peakR = seg[k].High; }
  const neck = (peakL + peakR) / 2;
  const cur = seg[L - 1];
  // 突破：当前收盘站上颈线，且约 4 根前仍在颈线下方（首次突破）
  if (!(cur.Close > neck)) return null;
  if (!(seg[L - 4].Close <= neck)) return null;
  return { idx: i, date: cur.Date, name: '头肩底', dir: 'bullish', desc: '左肩-头-右肩结构完成并向上突破颈线，中期底部反转信号' };
}

function detectKlinePatterns(bars) {
  if (!bars || bars.length < 2) return [];
  const out = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1];
    const body = Math.abs(b.Close - b.Open);
    const range = b.High - b.Low;
    if (range <= 0) continue;

    // 三只乌鸦：连续三根长阴线，逐根收盘价更低，第三根开盘落在前一根实体之内
    if (i >= 3) {
      const c1 = bars[i - 2], c2 = bars[i - 1], c3 = b;
      const blk = (x) => x.Close < x.Open;
      const lng = (x) => (x.High - x.Low) > 0 && Math.abs(x.Close - x.Open) / (x.High - x.Low) > 0.5;
      if (blk(c1) && blk(c2) && blk(c3) && lng(c1) && lng(c2) && lng(c3)
        && c3.Close < c2.Close && c2.Close < c1.Close
        && c3.Open <= c2.Open && c3.Open >= c2.Close) {
        out.push({ idx: i, date: c3.Date, name: '三只乌鸦', dir: 'bearish', desc: '连续三根长阴线逐根走低，强烈看跌延续/见顶信号' });
        continue;
      }
    }
    // 头肩底（简化）：背后存在 左肩-头-右肩 结构且当前向上突破颈线
    if (i >= 30) {
      const hs = detectHSBottom(bars, i);
      if (hs) { out.push(hs); continue; }
    }

    const upper = b.High - Math.max(b.Open, b.Close);
    const lower = Math.min(b.Open, b.Close) - b.Low;
    const bodyRatio = body / range;

    // 十字星：实体极小 + 上下影线明显 + 整体振幅不可忽略，避免极窄波动误报
    if (bodyRatio <= 0.12 && Math.min(upper, lower) > body && range > b.Close * 0.004) {
      out.push({ idx: i, date: b.Date, name: '十字星', dir: 'neutral', desc: '开盘≈收盘、上下影线明显，多空僵持，警惕变盘' });
      continue;
    }

    // 锤子系：实体小、下影线长、上影线极短
    if (lower >= 2 * body && upper <= body && bodyRatio <= 0.5) {
      const ctx = trendContext(bars, i, 20);
      if (ctx === 'down') out.push({ idx: i, date: b.Date, name: '锤子线', dir: 'bullish', desc: '实体小、下影线长，下跌末端见底反转信号' });
      else if (ctx === 'up') out.push({ idx: i, date: b.Date, name: '上吊线', dir: 'bearish', desc: '形态同锤子但处上涨末端，见顶回落风险' });
      else out.push({ idx: i, date: b.Date, name: '锤子线', dir: 'neutral', desc: '实体小、下影线长' });
      continue;
    }

    // 倒锤子系：实体小、上影线长、下影线极短
    if (upper >= 2 * body && lower <= body && bodyRatio <= 0.5) {
      const ctx = trendContext(bars, i, 20);
      if (ctx === 'down') out.push({ idx: i, date: b.Date, name: '倒锤子线', dir: 'bullish', desc: '实体小、上影线长，下跌末端可能反弹' });
      else if (ctx === 'up') out.push({ idx: i, date: b.Date, name: '射击之星', dir: 'bearish', desc: '形态同倒锤但处上涨末端，见顶回落' });
      else out.push({ idx: i, date: b.Date, name: '倒锤子线', dir: 'neutral', desc: '实体小、上影线长' });
      continue;
    }

    const prevBear = prev.Close < prev.Open, prevBull = prev.Close > prev.Open;
    const curBear = b.Close < b.Open, curBull = b.Close > b.Open;
    // 前一根实体占比：用于区分“有实体内涵”的实体与近似十字星
    const prevRange = prev.High - prev.Low;
    const prevBodyRatio = prevRange > 0 ? Math.abs(prev.Close - prev.Open) / prevRange : 0;
    // 吞没形态：当前实体完全覆盖前一根实体；要求两根均为“有分量”的实体
    // （实体占振幅比 > 阈值），避免极小实体（如 1 分钱阴线被 4 分钱阳线“吞没”）
    // 产生无意义的假信号。
    const engulfMinRatio = 0.25;
    const minMove = b.Close * 0.006;          // 整体振幅至少 ~0.6%，过滤微幅噪音
    if (prevBear && curBull && prevBodyRatio > engulfMinRatio && bodyRatio > engulfMinRatio
        && (b.High - b.Low) > minMove
        && b.Open <= prev.Close && b.Close >= prev.Open) {
      out.push({ idx: i, date: b.Date, name: '看涨吞没', dir: 'bullish', desc: '阳线实体完全吞没前阴线，反转向上' });
      continue;
    }
    if (prevBull && curBear && prevBodyRatio > engulfMinRatio && bodyRatio > engulfMinRatio
        && (b.High - b.Low) > minMove
        && b.Open >= prev.Close && b.Close <= prev.Open) {
      out.push({ idx: i, date: b.Date, name: '看跌吞没', dir: 'bearish', desc: '阴线实体完全吞没前阳线，反转向下' });
      continue;
    }

    // 孕线：当前小实体被前一根实体包裹；要求前一根为“有分量”实体，且整体振幅不可忽略
    const haramiMinRatio = 0.25;
    if (prevBear && curBull && prevBodyRatio > haramiMinRatio && (b.High - b.Low) > minMove
        && b.Open >= prev.Close && b.Close <= prev.Open) {
      out.push({ idx: i, date: b.Date, name: '看涨孕线', dir: 'bullish', desc: '小阳线被前阴线包裹，下跌动能减弱' });
      continue;
    }
    if (prevBull && curBear && prevBodyRatio > haramiMinRatio && (b.High - b.Low) > minMove
        && b.Open <= prev.Close && b.Close >= prev.Open) {
      out.push({ idx: i, date: b.Date, name: '看跌孕线', dir: 'bearish', desc: '小阴线被前阳线包裹，上涨动能减弱' });
      continue;
    }
  }
  return out;
}

// 仅在迷你K线可见窗口(近60根)内汇总，返回 { visible, html, score }
function buildPatterns(bars) {
  const all = detectKlinePatterns(bars);
  const n = Math.min(bars.length, 60);
  const startIdx = bars.length - n;
  const visible = all.filter((p) => p.idx >= startIdx);
  visible.sort((a, b) => b.idx - a.idx);
  const score = computePatternScore(visible);
  return { visible, html: patternsListHTML(visible, n, score), score };
}

// 形态权重：方向 × 强度。多头为 +，空头为 −。
function patternWeight(name) {
  switch (name) {
    case '头肩底': return 2.8;
    case '三只乌鸦': return -2.6;
    case '看涨吞没': return 1.2;
    case '看跌吞没': return -1.2;
    case '锤子线': return 1.0;
    case '上吊线': return -1.0;
    case '倒锤子线': return 0.7;
    case '射击之星': return -0.7;
    case '看涨孕线': return 0.5;
    case '看跌孕线': return -0.5;
    case '十字星': return 0;
    default: return 0;
  }
}

// 由可见窗口命中形态汇总出净评分：牛/熊权重差除以总权重，归一到 (-1,1) 后乘 4，
// 得到“近期多空偏倚”而非“形态数量”，落在 (-4,4)。平衡≈0，单边倾向→±4。
function computePatternScore(patterns) {
  if (!patterns || !patterns.length) return 0;
  let bull = 0, bear = 0;
  patterns.forEach((p) => {
    const w = Math.abs(patternWeight(p.name));
    if (p.dir === 'bullish') bull += w;
    else if (p.dir === 'bearish') bear += w;
  });
  const denom = bull + bear + 0.5;
  let score = ((bull - bear) / denom) * 4;
  if (score > 4) score = 4;
  if (score < -4) score = -4;
  return Math.round(score * 100) / 100;
}

function patternsListHTML(visible, n, score) {
  if (!visible.length) return '';
  const dir = score > 0.3 ? 'up' : score < -0.3 ? 'down' : 'neu';
  const arrow = score > 0.3 ? '▲' : score < -0.3 ? '▼' : '◆';
  const tone = score > 0.3 ? '偏多' : score < -0.3 ? '偏空' : '均衡';
  const top = visible.slice(0, 14);
  const items = top.map((p) => {
    const pt = p.dir === 'bullish' ? 'up' : p.dir === 'bearish' ? 'down' : 'neu';
    const pa = p.dir === 'bullish' ? '▲' : p.dir === 'bearish' ? '▼' : '◆';
    return '<div class="pat-item ' + pt + '"><span class="pat-date">' + esc(p.date) + '</span>'
      + '<span class="pat-name">' + pa + ' ' + esc(p.name) + '</span>'
      + '<span class="pat-desc">' + esc(p.desc) + '</span></div>';
  }).join('');
  return '<div class="pat-card"><div class="pat-head">K线形态识别'
    + '<span class="pat-sub">近 ' + n + ' 根 · 命中 ' + visible.length + ' 处</span>'
    + '<span class="pat-score ' + dir + '">' + arrow + ' 形态净评分 ' + (score > 0 ? '+' : '') + score.toFixed(2) + ' ' + tone + '</span></div>'
    + '<div class="pat-list">' + items + '</div>'
    + (visible.length > top.length ? '<div class="pat-more">…另有 ' + (visible.length - top.length) + ' 处更早形态</div>' : '')
    + '</div>';
}

// 信号分解（合并模型信号 + 形态评分）渲染
function buildMergedSignals(prob, patScore, patCount) {
  const arr = [];
  if (prob && prob.signals && prob.signals.length) arr.push(...prob.signals);
  const dir = patScore > 0.3 ? 'bullish' : patScore < -0.3 ? 'bearish' : 'neutral';
  arr.push({
    indicator: 'K线形态',
    direction: dir,
    reason: '近60根命中 ' + patCount + ' 处形态，净方向' + (dir === 'bullish' ? '偏多' : dir === 'bearish' ? '偏空' : '均衡'),
    score: patScore,
  });
  return arr;
}

function sigListHTML(signals) {
  if (!signals || !signals.length) return '';
  let h = '<div class="sig-list"><h4>信号分解</h4>';
  signals.forEach((s) => {
    const cls = s.direction === 'bullish' ? 'sig-up' : s.direction === 'bearish' ? 'sig-down' : 'sig-neutral';
    const arrow = s.direction === 'bullish' ? '▲' : s.direction === 'bearish' ? '▼' : '—';
    const sc = (typeof s.score === 'number') ? s.score : 0;
    h += '<div class="sig-item ' + cls + '"><span class="sig-ind">' + esc(s.indicator) + '</span><span class="sig-arrow">' + arrow + '</span><span class="sig-reason">' + esc(s.reason) + '</span><span class="sig-score">' + (sc > 0 ? '+' : '') + sc.toFixed(2) + '</span></div>';
  });
  h += '</div>';
  return h;
}

// 命中形态仅在悬停时通过 data-pat 展示，迷你K线蜡烛不再描边/加框

// 关键信号徽章（由已有指标派生，对应 PanWatch 的 TechnicalBadge 风格）
function anaBadgesHTML(ind, prob) {
  const items = [];
  const maUp = ind.price > ind.ma20 && ind.ma20 > 0;
  const maDown = ind.price < ind.ma20 && ind.ma20 > 0;
  items.push({ label: maUp ? '均线 多头' : maDown ? '均线 空头' : '均线 交织', tone: maUp ? 'up' : maDown ? 'down' : 'neu' });
  const macd = ind.macd || {};
  if (macd.hist != null) items.push({ label: 'MACD ' + (macd.hist > 0 ? '金叉' : '死叉'), tone: macd.hist > 0 ? 'up' : 'down' });
  const rsi = ind.rsi || 50;
  items.push({ label: 'RSI ' + rsi.toFixed(0), tone: rsi > 70 ? 'down' : rsi > 55 ? 'up' : rsi >= 45 ? 'neu' : rsi > 30 ? 'down' : 'up' });
  const kdj = ind.kdj || {};
  if (kdj.k != null && kdj.d != null) items.push({ label: 'KDJ ' + (kdj.k > kdj.d ? '金叉' : '死叉'), tone: kdj.k > kdj.d ? 'up' : 'down' });
  const boll = ind.boll || {};
  if (boll.mid) { const pctB = boll.mid > 0 ? ((ind.price - boll.lower) / (boll.upper - boll.lower) * 100) : 50; items.push({ label: 'BOLL ' + (pctB > 50 ? '中上轨' : '中下轨'), tone: pctB > 50 ? 'up' : 'down' }); }
  const upPct = prob.up_pct || 50;
  items.push({ label: '看涨 ' + upPct.toFixed(0) + '%', tone: upPct >= 50 ? 'up' : 'down' });
  return '<div class="ana-badges">' + items.map((it) => '<span class="ana-badge ' + it.tone + '">' + esc(it.label) + '</span>').join('') + '</div>';
}

// 由技术面看涨指数推导买入评级（买入阈值65：弱偏多不给买入，PEP案例65.8%虚高已由后端约束压至58以下）
function buyRating(upPct) {
  if (upPct >= 80) return { label: '强烈买入', cls: 'up' };
  if (upPct >= 65) return { label: '买入', cls: 'up' };
  if (upPct >= 45) return { label: '中性', cls: 'neu' };
  if (upPct >= 30) return { label: '减仓', cls: 'down' };
  return { label: '卖出', cls: 'down' };
}

// 概览标签：技术评分（形态净评分）+ 买入评级（+ 回测胜率）
// 买入评级与首页右上角角标共用同一口径（a.signal = SignalFromUpPct），
// 避免出现「弹框显示中性、角标仍显示买」的脱节。buyRating 仅作内部参考，不再用于此框。
function overviewScoreRatingHTML(prob, patScore, patCount, dailySignals, signal) {
  const dir = patScore > 0.3 ? 'up' : patScore < -0.3 ? 'down' : 'neu';
  const arrow = patScore > 0.3 ? '▲' : patScore < -0.3 ? '▼' : '◆';
  const tone = patScore > 0.3 ? '偏多' : patScore < -0.3 ? '偏空' : '均衡';
  // 回测胜率 + 期望收益：仅统计 buy/sell 信号（hold 不参与）
  let rate = 0, exp = null, sigCount = 0;
  if (dailySignals && dailySignals.length) {
    let buy = 0, buyWin = 0, sell = 0, sellWin = 0, er = 0, ern = 0;
    dailySignals.forEach((d) => {
      if (d.signal === 'buy') { buy++; if (d.win) buyWin++; }
      else if (d.signal === 'sell') { sell++; if (d.win) sellWin++; }
      if (d.next_ret != null) { er += d.next_ret; ern++; }
    });
    const total = buy + sell;
    sigCount = total;
    rate = total ? ((buyWin + sellWin) / total * 100) : 0;
    exp = ern ? er / ern : null;
  }
  // 买入评级：直接用后端归一化信号 a.signal（与角标完全一致的口径）
  const sigMap = {
    buy:  { label: '买入', cls: 'up' },
    sell: { label: '卖出', cls: 'down' },
    hold: { label: '中性', cls: 'neu' },
    '':   { label: '—', cls: 'neu' },
  };
  const r = sigMap[signal] || sigMap[''];
  let ratingVal, ratingSub, ratingCls = r.cls;
  if (prob && prob.up_pct != null) {
    ratingVal = r.label;
    ratingSub = '技术面看涨 ' + prob.up_pct.toFixed(0);
  } else {
    ratingVal = '—';
    ratingSub = '数据不足';
    ratingCls = 'neu';
  }
  const scoreVal = (patScore > 0 ? '+' : '') + patScore.toFixed(2);
  const scoreSub = tone + ' · 近60根命中 ' + patCount + ' 处';
  const expVal = exp != null ? (exp >= 0 ? '+' : '') + exp.toFixed(2) + '%' : '—';
  const expCls = exp != null ? (exp >= 0 ? 'up' : 'down') : 'neu';
  // 统一框：按决策逻辑排序 评级→形态→胜率→期望收益
  const cells = [
    { label: '买入评级', val: ratingVal, cls: ratingCls, sub: ratingSub, big: true },
    { label: '形态净评分', val: arrow + ' ' + scoreVal, cls: dir, sub: scoreSub },
    { label: '回测胜率', val: rate.toFixed(1) + '%', cls: rate >= 50 ? 'up' : 'down', sub: sigCount + ' 个信号' },
    { label: '期望收益', val: expVal, cls: expCls, sub: '信号方向·等权' },
  ];
  let html = '<div class="ana-score-card"><div class="ana-score-grid2">';
  cells.forEach((c) => {
    html += '<div class="ana-score-cell' + (c.big ? ' is-big' : '') + '">'
      + '<div class="ana-score-label">' + c.label + '</div>'
      + '<div class="ana-score-val ' + c.cls + '">' + c.val + '</div>'
      + '<div class="ana-score-sub">' + c.sub + '</div>'
      + '</div>';
  });
  html += '</div></div>';
  return html;
}

// 逐日信号回测明细表（仅展示 buy/sell 信号，按日期倒序，最新在前；可滚动）
function __sigHover(e, el) {
  try {
    const svg = el.ownerSVGElement;
    const box = svg.parentElement;
    const cR = box.getBoundingClientRect();
    const pts = JSON.parse(el.getAttribute('data-pts'));
    const n = parseInt(el.getAttribute('data-n'), 10);
    const SW = 640, SH = 150, mlFrac = 46 / SW, mrFrac = 10 / SW;
    const xr = (e.clientX - cR.left) / cR.width;
    let idx = Math.round((xr - mlFrac) / (1 - mlFrac - mrFrac) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    const p = pts[idx];
    const tip = box.querySelector('.curve-tip');
    const fmt = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    const cls = (v) => v == null ? '' : (v >= 0 ? 'up' : 'down');
    tip.innerHTML = '<div class="ct-date">' + esc(p.date) + '</div>'
      + '<div class="ct-row">本周期策略收益 <b class="' + cls(p.r) + '">' + fmt(p.r) + '</b></div>'
      + '<div class="ct-row">累计 <b class="' + cls(p.cum) + '">' + fmt(p.cum) + '</b></div>';
    tip.hidden = false;
    const leftPx = p.sx / SW * cR.width;
    const topPx = p.sy / SH * cR.height;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let L = leftPx - tw / 2;
    L = Math.max(2, Math.min(cR.width - tw - 2, L));
    let T = topPx - th - 10;
    if (T < 0) T = topPx + 10;
    tip.style.left = L + 'px';
    tip.style.top = T + 'px';
  } catch (err) {}
}
function __sigLeave(el) {
  const box = el.ownerSVGElement.parentElement;
  const tip = box.querySelector('.curve-tip');
  if (tip) tip.hidden = true;
}

let lastDailySignals = null;

// 取某一持有周期 T(1/3/5) 的【信号方向收益%】：后端 sigRet 已对卖出取反，
// 故 buy=涨为正、sell=跌为正，直接作为"策略实际收益率"。
function dsPeriodRet(d, T) {
  if (T === 3) return d.ret_3;
  if (T === 5) return d.ret_5;
  return d.next_ret;
}

// 盈亏分级：按策略实际收益率相对止盈/止损阈值细分为四档
function dsTierInfo(r, tp, sl) {
  if (r == null) return { emoji: '·', label: '—', cls: 'na' };
  if (r > tp) return { emoji: '🔴', label: '大赚', cls: 'tier-bigwin' };
  if (r > 0) return { emoji: '🟡', label: '小赚', cls: 'tier-smallwin' };
  if (r >= sl) return { emoji: '🟠', label: '小亏', cls: 'tier-smallloss' };
  return { emoji: '🟢', label: '大亏', cls: 'tier-bigloss' };
}

// 核心指标：只使用 [T日收益] 列（周期对齐），方向已由数据保证
function dsMetrics(ds, T, tp, sl) {
  const rows = ds.filter((d) => d.signal === 'buy' || d.signal === 'sell');
  let N = 0, hits = 0, g = 0, gn = 0, l = 0, ln = 0;
  const tiers = { bigWin: [], smallWin: [], smallLoss: [], bigLoss: [] };
  rows.forEach((d) => {
    const r = dsPeriodRet(d, T);
    if (r == null) return;
    N++;
    if (r > 0) { hits++; g += r; gn++; tiers[r > tp ? 'bigWin' : 'smallWin'].push(r); }
    else { l += -r; ln++; tiers[r >= sl ? 'smallLoss' : 'bigLoss'].push(r); }
  });
  const rate = N ? hits / N * 100 : 0;
  const avgWin = gn ? g / gn : null;   // 平均盈利率(%)
  const avgLoss = ln ? l / ln : null;  // 平均亏损率(%)，以正值表示幅度
  const pl = (g > 0 && l > 0) ? (g / l) : null; // 实际盈亏比 = 总盈利/总亏损
  return { N, hits, rate, avgWin, avgLoss, pl, tiers };
}

// 累计策略收益曲线（按选定周期 T 累加）
function dsCurve(ds, T) {
  let cum = 0; const curve = []; const meta = [];
  ds.filter((d) => d.signal === 'buy' || d.signal === 'sell').forEach((d) => {
    const r = dsPeriodRet(d, T);
    if (r == null) return;
    cum += r; curve.push(cum); meta.push({ date: d.date, r: r, cum: cum });
  });
  if (curve.length < 1) return '';
  const SW = 640, SH = 150, ml = 46, mr = 10, mt = 12, mb = 24;
  const px0 = ml, px1 = SW - mr, py0 = mt, py1 = SH - mb;
  const max = Math.max.apply(null, curve.concat(0)), min = Math.min.apply(null, curve.concat(0));
  const range = (max - min) || 1;
  const X = (i) => px0 + (curve.length === 1 ? 0 : (i / (curve.length - 1)) * (px1 - px0));
  const Y = (v) => py1 - ((v - min) / range) * (py1 - py0);
  const pts = curve.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
  let yGrid = '', yLabels = '';
  [{ v: max, y: Y(max) }, ...(min < 0 && max > 0 ? [{ v: 0, y: Y(0) }] : []), { v: min, y: Y(min) }].forEach((t) => {
    yGrid += '<line x1="' + px0 + '" y1="' + t.y.toFixed(1) + '" x2="' + px1 + '" y2="' + t.y.toFixed(1) + '" stroke="rgba(255,255,255,.10)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    yLabels += '<span class="ax-y" style="top:' + (t.y / SH * 100).toFixed(2) + '%">' + t.v.toFixed(1) + '%</span>';
  });
  const xi = [0, Math.floor((meta.length - 1) / 2), meta.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  let xGrid = '', xLabels = '';
  xi.forEach((i) => { const cx = X(i); xGrid += '<line x1="' + cx.toFixed(1) + '" y1="' + py0 + '" x2="' + cx.toFixed(1) + '" y2="' + py1 + '" stroke="rgba(255,255,255,.07)" stroke-width="1" vector-effect="non-scaling-stroke"/>'; xLabels += '<span class="ax-x" style="left:' + (cx / SW * 100).toFixed(2) + '%">' + esc(meta[i].date) + '</span>'; });
  const zy = Y(0).toFixed(1);
  const hoverPts = meta.map((m, i) => ({ date: m.date, r: m.r, cum: m.cum, sx: X(i), sy: Y(m.cum) }));
  const ptsJSON = JSON.stringify(hoverPts).replace(/"/g, '&quot;');
  const svg = '<svg viewBox="0 0 ' + SW + ' ' + SH + '" class="ret-curve" preserveAspectRatio="none">'
    + yGrid + xGrid
    + '<line x1="' + px0 + '" y1="' + zy + '" x2="' + px1 + '" y2="' + zy + '" stroke="rgba(255,255,255,.28)" stroke-width="1" vector-effect="non-scaling-stroke"/>'
    + '<polyline points="' + pts + '" fill="none" stroke="#6f9e5e" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'
    + '<rect class="curve-hit" x="' + px0 + '" y="' + py0 + '" width="' + (px1 - px0) + '" height="' + (py1 - py0) + '" fill="transparent" data-pts="' + ptsJSON + '" data-n="' + meta.length + '" onmousemove="__sigHover(event,this)" onmouseleave="__sigLeave(this)"/></svg>';
  const axis = '<div class="curve-axis">' + yLabels + xLabels + '</div>';
  return '<div class="daily-sig-curve"><div class="curve-box">' + svg + axis + '<div class="curve-tip" hidden></div></div><div class="curve-cap">累计策略收益曲线（持有 ' + T + ' 日·按信号方向等权累加·悬停查看每日明细）</div></div>';
}

// 构建回测面板主体（控制条之外的部分），供首次渲染与切换周期/阈值时复用
function buildDailySigInner(ds, T, tp, sl) {
  const fmtPct = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const clsPct = (v) => v == null ? '' : (v >= 0 ? 'up' : 'down');
  const m = dsMetrics(ds, T, tp, sl);
  const allRows = ds.filter((d) => d.signal === 'buy' || d.signal === 'sell');
  const sum = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : null;
  const tierCell = (arr, label, emoji, cls) => {
    const n = arr.length;
    const avg = arr.length ? (arr[0] >= 0 ? '+' : '') + sum(arr).toFixed(2) + '%' : '—';
    return '<span class="ds-tier ' + cls + '">' + emoji + label + ' ' + n + ' ' + avg + '</span>';
  };
  const t = m.tiers;
  let html = '';
  html += '<div class="daily-sig-summary">回测（持有 ' + T + '日）：有效信号 <b>' + m.N + '</b> 个 · 胜率 <b class="' + (m.rate >= 50 ? 'up' : 'down') + '">' + m.rate.toFixed(1) + '%</b> · 最近 ' + Math.min(40, allRows.length) + ' 条</div>';
  html += '<div class="ds-metrics">'
    + '<div class="ds-metric"><span>胜率</span><b class="' + (m.rate >= 50 ? 'up' : 'down') + '">' + m.rate.toFixed(1) + '%</b></div>'
    + '<div class="ds-metric"><span>平均盈利率</span><b class="up">' + (m.avgWin != null ? '+' + m.avgWin.toFixed(2) + '%' : '—') + '</b></div>'
    + '<div class="ds-metric"><span>平均亏损率</span><b class="down">' + (m.avgLoss != null ? '-' + m.avgLoss.toFixed(2) + '%' : '—') + '</b></div>'
    + '<div class="ds-metric"><span>实际盈亏比</span><b>' + (m.pl != null ? m.pl.toFixed(2) + ':1' : '—') + '</b></div>'
    + '<div class="ds-tiers">' + tierCell(t.bigWin, '大赚', '🔴', 'tier-bigwin') + tierCell(t.smallWin, '小赚', '🟡', 'tier-smallwin') + tierCell(t.smallLoss, '小亏', '🟠', 'tier-smallloss') + tierCell(t.bigLoss, '大亏', '🟢', 'tier-bigloss') + '</div>'
    + '</div>';
  const curve = dsCurve(ds, T);
  if (curve) html += curve;
  const rows = allRows.slice(-40).reverse();
  let body = '';
  rows.forEach((d) => {
    const isBuy = d.signal === 'buy';
    const r = dsPeriodRet(d, T);
    const r5 = dsPeriodRet(d, T); // 策略收益：与"结果/分级/曲线"同周期，后端 sigRet 已对卖出取反（跌为正）
    const tier = dsTierInfo(r, tp, sl);
    const ok = r != null && r > 0;
    body += '<tr>'
      + '<td class="ds-date">' + esc(d.date) + '</td>'
      + '<td><span class="ds-sig ' + (isBuy ? 'up' : 'down') + '">' + (isBuy ? '买入' : '卖出') + '</span></td>'
      + '<td class="ds-num ' + clsPct(r5) + '">' + (r5 == null ? '—' : fmtPct(r5)) + '</td>'
      + '<td class="ds-result ' + (r == null ? '' : (ok ? 'hit' : 'miss')) + '">' + (r == null ? '—' : (ok ? '✔ 命中' : '✘ 失效')) + '</td>'
      + '<td>' + (r == null ? '<span class="ds-tier na">· —</span>' : '<span class="ds-tier ' + tier.cls + '">' + tier.emoji + ' ' + tier.label + '</span>') + '</td>'
      + '</tr>';
  });
  html += '<div class="daily-sig-scroll"><table class="daily-sig-table">'
    + '<thead><tr><th>日期</th><th>信号</th><th>策略收益(' + T + '日)</th><th>结果</th><th>盈亏分级</th></tr></thead>'
    + '<tbody>' + body + '</tbody></table></div>';
  return html;
}

function dailySignalsHTML(ds) {
  if (!ds || !ds.length) return '<div class="analysis-err">暂无可回测的逐日信号</div>';
  lastDailySignals = ds;
  const ctrl = '<div class="ds-controls">持有周期：'
    + '<span class="ds-t-seg"><button type="button" data-t="1" class="active">1日</button><button type="button" data-t="3">3日</button><button type="button" data-t="5">5日</button></span>'
    + '　止盈 ≥ <input id="dsTp" type="number" step="0.5" value="2.0">%　止损 ≤ <input id="dsSl" type="number" step="0.5" value="-1.5">%</div>';
  return '<div class="daily-sig-wrap" id="dsWrap">' + ctrl + '<div id="dsInner">' + buildDailySigInner(ds, 1, 2.0, -1.5) + '</div></div>';
}

// 周期/阈值切换后局部重渲染（数据已在前端，无需回服务端）
function bindDailySignals() {
  const wrap = document.getElementById('dsWrap');
  if (!wrap || !lastDailySignals) return;
  const inner = wrap.querySelector('#dsInner');
  const tpEl = wrap.querySelector('#dsTp');
  const slEl = wrap.querySelector('#dsSl');
  const segBtns = wrap.querySelectorAll('.ds-t-seg button');
  const render = () => {
    const active = wrap.querySelector('.ds-t-seg button.active');
    const T = parseInt(active ? active.dataset.t : '1', 10) || 1;
    const tp = parseFloat(tpEl.value); const sl = parseFloat(slEl.value);
    inner.innerHTML = buildDailySigInner(lastDailySignals, T, isNaN(tp) ? 2 : tp, isNaN(sl) ? -1.5 : sl);
  };
  segBtns.forEach((b) => { b.onclick = () => { segBtns.forEach((x) => x.classList.toggle('active', x === b)); render(); }; });
  tpEl.oninput = render; slEl.oninput = render;
}

// 涨跌概率卡片
function probCardHTML(prob) {
  const upPct = prob.up_pct || 50;
  const engineTag = prob.engine === 'custom' ? ' <span class="prob-engine">自定义脚本</span>'
    : prob.engine === 'default(fallback)' ? ' <span class="prob-engine fallback">脚本降级·内置逻辑</span>' : '';
  let h = '<div class="prob-card">';
  h += '<div class="prob-bar-wrap"><div class="prob-bar"><div class="prob-up" style="width:' + upPct + '%">▲ ' + upPct.toFixed(1) + '%</div><div class="prob-down" style="width:' + (100 - upPct) + '%">▼ ' + (100 - upPct).toFixed(1) + '%</div></div></div>';
  h += '<div class="prob-summary">' + esc(prob.summary) + engineTag + '</div>';
  h += '<div class="prob-conf">置信度：' + '★'.repeat(prob.confidence || 0) + '☆'.repeat(5 - (prob.confidence || 0)) + '</div>';
  h += '</div>';
  return h;
}

// 指标表格
function indicatorsTableHTML(ind) {
  let h = '<div class="ind-table-wrap"><table class="ind-table">';
  h += '<thead><tr><th>指标</th><th>数值</th><th>信号</th><th>依据</th></tr></thead><tbody>';
  h += '<tr><td>最新价</td><td>' + ind.price.toFixed(2) + '</td><td colspan="2"></td></tr>';
  h += '<tr><td>MA5</td><td>' + (ind.ma5 ? ind.ma5.toFixed(2) : '—') + '</td><td class="' + (ind.price > ind.ma5 ? 'up' : 'down') + '">' + (ind.price > ind.ma5 ? '多头 ↑' : '空头 ↓') + '</td><td></td></tr>';
  h += '<tr><td>MA10</td><td>' + (ind.ma10 ? ind.ma10.toFixed(2) : '—') + '</td><td class="' + (ind.price > ind.ma10 ? 'up' : 'down') + '">' + (ind.price > ind.ma10 ? '多头 ↑' : '空头 ↓') + '</td><td></td></tr>';
  h += '<tr><td>MA20</td><td>' + (ind.ma20 ? ind.ma20.toFixed(2) : '—') + '</td><td class="' + (ind.price > ind.ma20 ? 'up' : 'down') + '">' + (ind.price > ind.ma20 ? '多头 ↑' : '空头 ↓') + '</td><td></td></tr>';
  h += '<tr><td>MA60</td><td>' + (ind.ma60 ? ind.ma60.toFixed(2) : '—') + '</td><td class="' + (ind.price > ind.ma60 ? 'up' : 'down') + '">' + (ind.price > ind.ma60 ? '多头 ↑' : '空头 ↓') + '</td><td></td></tr>';
  const macd = ind.macd || {};
  const macdDir = macd.hist > 0 ? 'up' : 'down';
  h += '<tr><td>MACD DIF</td><td>' + (macd.dif ? macd.dif.toFixed(4) : '—') + '</td><td rowspan="3" class="' + macdDir + '">' + (macd.hist > 0 ? '金叉 ↑' : '死叉 ↓') + '</td><td rowspan="3" style="font-size:12px">DIF=' + (macd.dif ? macd.dif.toFixed(4) : '—') + ' DEA=' + (macd.dea ? macd.dea.toFixed(4) : '—') + ' HIST=' + (macd.hist ? macd.hist.toFixed(4) : '—') + '</td></tr>';
  h += '<tr><td>MACD DEA</td><td>' + (macd.dea ? macd.dea.toFixed(4) : '—') + '</td></tr>';
  h += '<tr><td>MACD HIST</td><td>' + (macd.hist ? macd.hist.toFixed(4) : '—') + '</td></tr>';
  const rsi = ind.rsi || 50;
  const rsiState = rsi > 70 ? '超买↓' : rsi >= 65 ? '接近超买' : rsi > 50 ? '偏强↑' : rsi > 30 ? '偏弱↓' : '超卖↑';
  const rsiCls = rsi > 70 ? 'down' : rsi >= 65 ? 'neu' : rsi > 50 ? 'up' : rsi > 30 ? 'down' : 'up';
  const rsiTip = rsi > 70 ? '超买区域，回调风险高' : rsi >= 65 ? '接近超买，谨慎追高' : rsi > 50 ? '偏强区域，趋势向好' : rsi > 30 ? '偏弱区域，趋势偏空' : '超卖区域，反弹概率高';
  h += '<tr><td>RSI(14)</td><td>' + rsi.toFixed(1) + '</td><td class="' + rsiCls + '">' + rsiState + '</td><td style="font-size:12px">' + rsiTip + '</td></tr>';
  const kdj = ind.kdj || {};
  const kdjUp = kdj.k > kdj.d && !(kdj.j > 100);
  const kdjState = kdj.j > 100 ? '高位钝化↓' : kdj.k > kdj.d ? '金叉 ↑' : '死叉 ↓';
  const kdjCls = kdjUp ? 'up' : 'down';
  const kdjJTip = kdj.j > 100 ? '高位钝化(超买)' : kdj.j < 0 ? '超卖' : kdj.j > 80 ? '高位' : '';
  h += '<tr><td>KDJ K</td><td>' + (kdj.k ? kdj.k.toFixed(2) : '—') + '</td><td rowspan="3" class="' + kdjCls + '">' + kdjState + '</td><td rowspan="3" style="font-size:12px">J=' + (kdj.j ? kdj.j.toFixed(2) : '—') + ' ' + kdjJTip + '</td></tr>';
  h += '<tr><td>KDJ D</td><td>' + (kdj.d ? kdj.d.toFixed(2) : '—') + '</td></tr>';
  h += '<tr><td>KDJ J</td><td>' + (kdj.j ? kdj.j.toFixed(2) : '—') + '</td></tr>';
  const boll = ind.boll || {};
  const bollPos = boll.mid > 0 ? ((ind.price - boll.lower) / (boll.upper - boll.lower) * 100) : 50;
  const bollSig = bollPos > 80 ? { t: '上轨压力↓', c: 'down' } : bollPos > 50 ? { t: '中上轨↑', c: 'up' } : bollPos > 20 ? { t: '中下轨↓', c: 'down' } : { t: '下轨支撑↑', c: 'up' };
  h += '<tr><td>BOLL 上轨</td><td>' + (boll.upper ? boll.upper.toFixed(2) : '—') + '</td><td rowspan="3" class="' + bollSig.c + '">' + bollSig.t + '</td><td rowspan="3" style="font-size:12px">带宽：' + (boll.width ? boll.width.toFixed(1) + '%' : '—') + ' ' + (boll.width > 20 ? '宽幅震荡' : boll.width < 5 ? '即将变盘' : '') + '</td></tr>';
  h += '<tr><td>BOLL 中轨</td><td>' + (boll.mid ? boll.mid.toFixed(2) : '—') + '</td></tr>';
  h += '<tr><td>BOLL 下轨</td><td>' + (boll.lower ? boll.lower.toFixed(2) : '—') + '</td></tr>';
  h += '</tbody></table></div>';
  return h;
}

// 标签栏（仿 Panwatch 个股详情 概览/建议/报告 按钮：小圆角胶囊）
function analysisTabBarHTML(tabs, active) {
  return '<div class="ana-tabs">' + tabs.map((t) =>
    '<button type="button" class="ana-tab-btn' + (t.id === active ? ' active' : '') + '" data-tab="' + t.id + '">' + esc(t.label) + '</button>'
  ).join('') + '</div>';
}

// 标签切换：点击切换 active 并显隐对应面板
function bindAnalysisTabs() {
  const bar = document.querySelector('#analysisBody .ana-tabs');
  if (!bar) return;
  bar.querySelectorAll('.ana-tab-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.tab;
      bar.querySelectorAll('.ana-tab-btn').forEach((x) => x.classList.toggle('active', x === btn));
      document.querySelectorAll('#analysisBody .ana-panel').forEach((p) => { p.hidden = (p.dataset.tab !== id); });
    };
  });
}

// 技术分析弹框：概览（评分+评级+K线）+ 其它选项 slider 切换
function renderAnalysis(a) {
  const ind = a.indicators, prob = a.probability;
  let patVisible = [], patHTML = '', patScore = 0;
  if (a.series && a.series.length) {
    const bp = buildPatterns(a.series);
    patVisible = bp.visible; patHTML = bp.html; patScore = bp.score;
  }

  // 可选标签：概览必有；K线形态需 series；信号需 prob；指标需 ind
  const tabs = [{ id: 'overview', label: '概览' }];
  if (a.series && a.series.length >= 2) tabs.push({ id: 'patterns', label: 'K线形态' });
  if (prob) tabs.push({ id: 'signals', label: '信号' });
  if (ind) tabs.push({ id: 'indicators', label: '指标' });
  if (a.daily_signals) tabs.push({ id: 'backtest', label: '回测' });
  const active = tabs[0].id;

  let html = analysisTabBarHTML(tabs, active);

  // ── 概览：迷你K线 + 徽章 + 评分/评级 ──
  html += '<div class="ana-panel" data-tab="overview">';
  if (a.series && a.series.length) {
    const pmap = {};
    patVisible.forEach((p) => { (pmap[p.date] = pmap[p.date] || []).push(p); });
    html += klineMiniHTML(a.series, pmap, a.daily_signals);
  }
  if (ind && prob) html += anaBadgesHTML(ind, prob);
  html += overviewScoreRatingHTML(prob, patScore, patVisible.length, a.daily_signals, a.signal);
  if (!ind || !prob) html += '<div class="analysis-err">数据不足，部分评分/评级暂不可用</div>';
  html += '</div>';

  // ── K线形态 ──
  if (a.series && a.series.length >= 2) {
    html += '<div class="ana-panel" data-tab="patterns" hidden>' + patHTML + '</div>';
  }

  // ── 信号：信号分解 + 涨跌概率 ──
  if (prob) {
    html += '<div class="ana-panel" data-tab="signals" hidden>';
    html += sigListHTML(buildMergedSignals(prob, patScore, patVisible.length));
    html += probCardHTML(prob);
    html += '</div>';
  }

  // ── 指标 ──
  if (ind) {
    html += '<div class="ana-panel" data-tab="indicators" hidden>' + indicatorsTableHTML(ind) + '</div>';
  }

  // ── 回测：逐日信号明细（独立标签页，避免在信号面板底部过长不便浏览） ──
  if (a.daily_signals) {
    html += '<div class="ana-panel" data-tab="backtest" hidden>' + dailySignalsHTML(a.daily_signals) + '</div>';
  }

  $('#analysisBody').innerHTML = html;
  bindKlineMini($('#analysisBody'));
  bindAnalysisTabs();
  bindDailySignals();
}

// ── 弹框关闭 ──────────────────────────────────────────

// ── 操作指南 ──────────────────────────────────────────

let allGuides = [];
let guideHoldings = [];

async function openGuide() {
  $('#guideModal').hidden = false;
  $('#guideForm').hidden = true;
  $('#guideActions').hidden = false;
  // 预加载操作记录 + 持仓补仓计划
  await Promise.all([loadGuides(), loadGuideHoldings()]);
}

async function loadGuides() {
  try {
    const r = await api('/api/guides');
    if (!r.ok) { toast('加载操作指南失败', 'err'); return; }
    const d = await r.json();
    allGuides = d.guides || [];
    renderGuideList();
  } catch (e) { toast('加载异常：' + e.message, 'err'); }
}

// 加载持仓列表，用于「动态补仓计划」的数据来源
async function loadGuideHoldings() {
  try {
    const r = await api('/api/holdings');
    if (!r.ok) return;
    const d = await r.json();
    guideHoldings = d.holdings || [];
    await renderBuyPlans();
  } catch (_) {}
}

// 档位是否已到点位：
//  - 买入档位：联接ETF最新价 ≤ 触发价（与推送通知的买入判定一致）
//  - 卖出档位：联接ETF最新价 ≥ 触发价（涨到止盈/减仓目标）
// 注意 BuyPlanTier.Signal 只是档位说明文字（恒非空），不是触发标记。
function isTierTriggered(plan, t) {
  if (!t || !plan || plan.ETFLatest == null || plan.ETFLatest <= 0) return false;
  if (t.Action === 'sell') return plan.ETFLatest >= t.Price;
  return plan.ETFLatest <= t.Price;
}

// 直接渲染所有带补仓计划的基金（数据来自 holdings.buy_plan，由净值刷新时计算）
// 二级列表样式：每个基金条目头部可点击折叠/展开其补仓计划明细
async function renderBuyPlans() {
  const body = $('#guidePlanBody');
  const planned = guideHoldings.filter((h) => h.buy_plan && (h.linked_symbol || h.category === 'stock'));
  if (!planned.length) {
    body.innerHTML = '<div class="guide-empty">暂无调仓计划：持仓基金 / 亏损股票会在净值刷新（定时 21:00 / 手动刷新）后自动计算</div>';
    return;
  }
  let html = '';
  for (const h of planned) {
    let plan;
    try { plan = JSON.parse(h.buy_plan); } catch (_) { continue; }
    const name = h.name || h.symbol || ('#' + h.id);
    const tiers = (plan.HasData && plan.Tiers) ? plan.Tiers : [];
    const triggered = tiers.filter((t) => isTierTriggered(plan, t)).length;
    const summary = triggered > 0
      ? `<span class="bp-summary trig">🔥 触发 ${triggered} 档</span>`
      : (tiers.length ? `<span class="bp-summary">待触发 · ${tiers.length} 档</span>` : '<span class="bp-summary">计划中</span>');
    // 已执行档位（"标记已补"）：拉取该持仓的已执行记录
    let execSet = {};
    try {
      const r = await api('/api/holdings/' + h.id + '/buy-plan/executed');
      if (r.ok) { const d = await r.json(); (d.executed || []).forEach((e) => { execSet[e.tier_index] = e; }); }
    } catch (_) {}
    html += `<div class="bp-card collapsed">
      <div class="bp-head bp-toggle" data-bp="${h.id}">
        <span class="bp-chevron">▾</span>
        <span class="bp-name">${esc(name)}</span>
        <span class="bp-code">${esc(h.symbol || '')}${h.category === 'stock' ? '' : (' · 联接 ' + esc(h.linked_symbol || ''))}</span>
        ${summary}
      </div>
      <div class="bp-body">
        <div class="bp-badge">🤖 自动调仓计划</div>`;
    if (plan.Note) html += `<div class="plan-note">${esc(plan.Note)}</div>`;
    if (tiers.length) {
      html += '<div class="plan-tiers">';
      tiers.forEach((t, idx) => {
        const exec = execSet[idx];
        const isSell = t.Action === 'sell';
        const sig = isTierTriggered(plan, t);
        const execDone = isSell ? '已减' : '已补';
        const action = exec
          ? `<div class="tier-executed">✓ 已${execDone}${exec.note ? ' · ' + esc(exec.note) : ''}</div>`
          : `<button class="btn btn-sm tier-exec-btn" data-exec-h="${h.id}" data-exec-idx="${idx}" data-exec-label="${esc(t.Label)}" data-exec-price="${t.Price}" data-exec-amount="${t.Amount}" data-exec-action="${isSell ? 'sell' : 'buy'}">${isSell ? '标记已减' : '标记已补'}</button>`;
        html += `<div class="plan-tier${sig ? ' has-signal' : ''}${exec ? ' is-executed' : ''}${isSell ? ' sell' : ''}">
          <div class="plan-tier-label">${esc(t.Label)}${isSell ? '<span class="tier-tag sell">减仓</span>' : ''}${sig ? '<span class="tier-flag">触发</span>' : ''}</div>
          <div class="plan-tier-grid">
            <span>触发价</span><b>${fmt(t.Price)}</b>
            <span>${isSell ? '上行空间' : '回撤'}</span><b>${t.Drawdown != null ? t.Drawdown.toFixed(1) : '—'}%</b>
            <span>${isSell ? '建议卖出' : '建议投入'}</span><b>¥${fmt(t.Amount)}</b>
            <span>${isSell ? '估算份额' : '可补份额'}</span><b>${isSell ? '—' : fmt(t.Shares)}</b>
          </div>
          ${t.Signal ? `<div class="plan-tier-signal">${esc(t.Signal)}</div>` : ''}
          <div class="tier-action">${action}</div>
        </div>`;
      });
      html += '</div>';
      html += `<div class="plan-foot">弹药上限 ≈ ¥${fmt(plan.AmmoCap)}　｜　已持有市值 ¥${fmt(plan.HeldValue)}　｜　浮动亏损 ¥${fmt(plan.LossAmt)}</div>`;
      if (plan.ETFLatest) {
        html += `<div class="plan-meta">${h.category === 'stock' ? '标的' : '联接ETF'} 最新 ${fmt(plan.ETFLatest)}　｜　BOLL 中轨 ${fmt(plan.BOLLMid)} / 下轨 ${fmt(plan.BOLLLower)}${plan.BOLLUpper ? ' / 上轨 ' + fmt(plan.BOLLUpper) : ''}　｜　近60日 ${fmt(plan.SwingBottom)}~${fmt(plan.SwingTop)}（自高点回撤 ${plan.BottomPct != null ? plan.BottomPct.toFixed(1) : '—'}%）</div>`;
      }
    } else {
      html += '<div class="guide-empty">暂无可用的标的K线，补仓位未更新</div>';
    }
    html += `<div class="plan-time">计算时间：${esc(plan.ComputedAt || '')}</div>`;
    html += `</div></div>`;
  }
  body.innerHTML = html;
  body.querySelectorAll('.bp-toggle').forEach((el) => {
    el.onclick = () => {
      const card = el.closest('.bp-card');
      if (!card) return;
      card.classList.toggle('collapsed');
    };
  });
  body.querySelectorAll('.tier-exec-btn').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); executeBuyPlan(b); };
  });
}

// 标记某档位为"已执行"（仅记录，不改动持仓数量/成本）；买入档位=已补，卖出档位=已减
async function executeBuyPlan(btn) {
  const hid = btn.dataset.execH;
  const idx = parseInt(btn.dataset.execIdx, 10);
  const label = btn.dataset.execLabel;
  const price = parseFloat(btn.dataset.execPrice) || 0;
  const amount = parseFloat(btn.dataset.execAmount) || 0;
  const action = btn.dataset.execAction || 'buy';
  const verbDone = action === 'sell' ? '已减' : '已补';
  if (!confirm(`确认将「${label}」标记为${verbDone}？\n（仅记录执行，不会自动加减仓）`)) return;
  btn.disabled = true;
  try {
    const r = await api('/api/holdings/' + hid + '/buy-plan/execute', {
      method: 'POST',
      body: JSON.stringify({ tier_index: idx, tier_label: label, action, price, amount, note: '' }),
    });
    if (!r.ok) { let m = '标记失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); btn.disabled = false; return; }
    toast('已标记为' + verbDone, 'ok');
    await renderBuyPlans();
  } catch (e) { toast('标记异常：' + e.message, 'err'); btn.disabled = false; }
}

function renderGuideList() {
  const el = $('#guideList');
  if (!allGuides.length) {
    el.innerHTML = '<div class="guide-empty">暂无操作记录，点击「新增记录」开始</div>';
    return;
  }
  let h = '';
  allGuides.forEach((g) => {
    const tagsHtml = g.tags ? g.tags.split(',').filter(Boolean).map((t) => `<span class="guide-tag">${esc(t.trim())}</span>`).join('') : '';
    const holdingName = g.holding_id ? `关联: #${g.holding_id}` : '';
    const sideBadge = g.side === 'sell' ? '<span class="guide-side sell">卖出</span>'
      : (g.side === 'buy' ? '<span class="guide-side buy">买入</span>' : '');
    const contentHtml = g.content ? `<div class="guide-item-content">${esc(g.content)}</div>` : '';
    h += `<div class="guide-item">
      <div class="guide-item-body">
        <div class="guide-item-title">${esc(g.title)} ${sideBadge}</div>
        ${tagsHtml ? `<div class="guide-item-tags">${tagsHtml}</div>` : ''}
        ${contentHtml}
        <div class="guide-item-info">
          <span>${g.created_at ? g.created_at.slice(0,10) : ''}</span>
          ${holdingName ? `<span>${holdingName}</span>` : ''}
        </div>
      </div>
      <div class="guide-item-actions">
        <button class="btn" data-guide-edit="${g.id}" title="编辑">✏️</button>
        <button class="btn danger" data-guide-del="${g.id}" title="删除">🗑️</button>
      </div>
    </div>`;
  });
  el.innerHTML = h;
  // 绑定编辑/删除事件
  el.querySelectorAll('[data-guide-edit]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); editGuide(parseInt(b.dataset.guideEdit)); };
  });
  el.querySelectorAll('[data-guide-del]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); deleteGuide(parseInt(b.dataset.guideDel)); };
  });
}

async function openGuideForm(guide) {
  // 先加载持仓列表
  const sel = $('#guide_holding');
  let holdingsHtml = '<option value="0">不关联</option>';
  try {
    const r = await api('/api/holdings');
    if (r.ok) {
      const d = await r.json();
      (d.holdings || []).forEach((h) => {
        holdingsHtml += `<option value="${h.id}">${esc(h.name || h.symbol || '#'+h.id)}</option>`;
      });
    }
  } catch (_) {}
  sel.innerHTML = holdingsHtml;

  if (guide) {
    $('#guide_id').value = guide.id;
    $('#guide_title').value = guide.title || '';
    $('#guide_content').value = guide.content || '';
    $('#guide_tags').value = guide.tags || '';
    $('#guide_holding').value = guide.holding_id || 0;
    $('#guide_side').value = guide.side || 'buy';
  } else {
    $('#guide_id').value = '';
    $('#guide_title').value = '';
    $('#guide_content').value = '';
    $('#guide_tags').value = '';
    $('#guide_holding').value = '0';
  }
  $('#guideErr').textContent = '';
  $('#guideForm').hidden = false;
  $('#guideActions').hidden = true;
  $('#guideList').hidden = true;
}

function closeGuideForm() {
  $('#guideForm').hidden = true;
  $('#guideActions').hidden = false;
  $('#guideList').hidden = false;
}

function editGuide(id) {
  const g = allGuides.find((x) => x.id === id);
  if (g) openGuideForm(g);
}

async function deleteGuide(id) {
  if (!confirm('删除这条操作记录？此操作不可撤销')) return;
  try {
    const r = await api('/api/guides/' + id, { method: 'DELETE' });
    if (!r.ok) { toast('删除失败', 'err'); return; }
    toast('已删除', 'ok');
    loadGuides();
  } catch (e) { toast('删除异常：' + e.message, 'err'); }
}

// 表单提交
$('#guideForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#guideErr').textContent = '';
  const id = $('#guide_id').value;
  const payload = {
    holding_id: parseInt($('#guide_holding').value) || 0,
    title: $('#guide_title').value.trim(),
    content: $('#guide_content').value.trim(),
    tags: $('#guide_tags').value.trim(),
    side: $('#guide_side').value || 'buy',
  };
  if (!payload.title) { $('#guideErr').textContent = '标题不能为空'; return; }
  try {
    const url = id ? '/api/guides/' + id : '/api/guides';
    const method = id ? 'PUT' : 'POST';
    const r = await api(url, { method, body: JSON.stringify(payload) });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      $('#guideErr').textContent = err.error || '保存失败';
      return;
    }
    toast(id ? '已更新' : '已添加', 'ok');
    closeGuideForm();
    loadGuides();
  } catch (err) { $('#guideErr').textContent = '异常：' + err.message; }
};

$('#guideNew').onclick = () => openGuideForm(null);
$('#guideCancel').onclick = () => closeGuideForm();

// ESC 关闭指南弹窗（扩展原有 ESC 逻辑：弹框层优先）
document.addEventListener('keydown', function _guideEsc(e) {
  if (e.key !== 'Escape') return;
  if (!$('#guideModal').hidden && $('#guideForm').hidden) {
    // 列表视图：ESC 关闭整个 modal
    $('#guideModal').hidden = true;
  }
}, true); // capture phase, 比现有的 ESC handler 先触发
$('#analysisModal').addEventListener('click', (e) => { if (e.target === $('#analysisModal')) { $('#analysisModal').hidden = true; } });

// ===== 多用户：用户切换 / 用户管理（底部抽屉） =====
// 当前用户 ID 持久化在 localStorage('pf_user')；api() 会在请求头注入 X-User-Id。
let allUsersCache = [];

function setUserText(name) {
  const t = document.getElementById('userNameText');
  const uc = document.getElementById('ucName');
  if (t) t.textContent = name || '默认';
  if (uc) uc.textContent = name || '默认';
}

async function fetchUsers() {
  try {
    const r = await fetch('/api/users');
    if (!r.ok) return [];
    const d = await r.json();
    return d.users || [];
  } catch (e) { return []; }
}

// 启动 / 刷新时解析当前用户：优先用 localStorage 中记录的 pf_user，否则回退到首个用户。
async function initUser() {
  const users = await fetchUsers();
  if (!users.length) { setUserText('默认'); return; }
  allUsersCache = users;
  const saved = localStorage.getItem('pf_user');
  let cur = users.find((u) => String(u.id) === String(saved));
  if (!cur) { cur = users[0]; localStorage.setItem('pf_user', String(cur.id)); }
  setUserText(cur.name);
}

function closeUserSheet() {
  const sheet = document.getElementById('userSheet');
  if (sheet) sheet.hidden = true;
}

async function openUserSheet() {
  const sheet = document.getElementById('userSheet');
  if (sheet) sheet.hidden = false;
  await refreshUsers();
}

async function refreshUsers() {
  const users = await fetchUsers();
  allUsersCache = users;
  const curId = localStorage.getItem('pf_user');
  const resolvedCur = users.find((u) => String(u.id) === String(curId)) ? curId : (users.length ? String(users[0].id) : null);
  const statsMap = {};
  await Promise.all(users.map(async (u) => {
    try {
      const r = await fetch('/api/users/' + u.id + '/stats');
      if (r.ok) {
        const d = await r.json();
        statsMap[u.id] = (d.stats && typeof d.stats.total === 'number') ? d.stats.total : 0;
      }
    } catch (e) {}
  }));
  renderUserList(users, resolvedCur, statsMap);
  const cur = users.find((u) => String(u.id) === String(resolvedCur));
  const ucMeta = document.getElementById('ucMeta');
  if (ucMeta) ucMeta.textContent = (statsMap[resolvedCur] != null ? statsMap[resolvedCur] : 0) + ' 条数据';
  setUserText(cur ? cur.name : '默认');
}

function renderUserList(users, curId, statsMap) {
  const list = document.getElementById('userList');
  if (!list) return;
  if (!users.length) { list.innerHTML = '<div class="user-empty">暂无用户</div>'; return; }
  const canDelete = users.length > 1;
  list.innerHTML = users.map((u) => {
    const isCur = String(u.id) === String(curId);
    const cnt = (statsMap[u.id] != null ? statsMap[u.id] : 0);
    const delBtn = canDelete
      ? `<button class="btn danger ur-del" type="button" data-act="delete" data-id="${u.id}" data-name="${escapeHtml(u.name)}">删除</button>`
      : `<button class="btn danger" type="button" disabled title="至少保留一个用户">删除</button>`;
    return `
    <div class="user-row ${isCur ? 'active' : ''}" data-id="${u.id}">
      <div class="ur-main">
        <div class="ur-name">${escapeHtml(u.name)}${isCur ? ' <span class="ur-cur">当前</span>' : ''}</div>
        <div class="ur-meta">${cnt} 条数据</div>
      </div>
      <div class="ur-actions">
        ${isCur ? '' : `<button class="btn ur-switch" type="button" data-act="switch" data-id="${u.id}">切换</button>`}
        ${delBtn}
      </div>
    </div>`;
  }).join('');
}

function onUserListClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  const name = btn.dataset.name;
  if (act === 'switch') switchUser(id);
  else if (act === 'delete') deleteUser(id, name);
}

async function switchUser(id) {
  let u = allUsersCache.find((x) => String(x.id) === String(id));
  if (!u) { const users = await fetchUsers(); u = users.find((x) => String(x.id) === String(id)); }
  localStorage.setItem('pf_user', String(id));
  setUserText(u ? u.name : '默认');
  closeUserSheet();
  try {
    await load();
    await loadAsset();
    await loadAISettings();
    await loadGuides();
    toast('已切换到用户：' + (u ? u.name : id), 'ok');
  } catch (e) { toast('切换用户失败：' + e.message, 'err'); }
}

async function addUser() {
  const inp = document.getElementById('userNameInput');
  const name = (inp && inp.value || '').trim();
  if (!name) { toast('请输入用户名', 'err'); return; }
  try {
    const r = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      let m = '新增失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {}
      toast(m, 'err');
      return;
    }
    if (inp) inp.value = '';
    toast('已新增用户：' + name, 'ok');
    await refreshUsers();
  } catch (e) { toast('新增异常：' + e.message, 'err'); }
}

let pendingClearUserId = null;
function clearUserData() {
  const curId = localStorage.getItem('pf_user');
  if (!curId) { toast('未选择用户', 'err'); return; }
  pendingClearUserId = curId;
  $('#confirmTitle').textContent = '清空当前用户数据';
  $('#confirmMsg').textContent = '确认清空当前用户的全部账户数据（持仓 / 资产全景 / 计算器 / AI 配置 / 历史等）？此操作不可恢复。';
  $('#confirmModal').hidden = false;
}

let pendingDeleteUserId = null;
let pendingDeleteName = '';
function deleteUser(id, name) {
  pendingDeleteUserId = Number(id);
  pendingDeleteName = name || '';
  const msg = document.getElementById('userDeleteMsg');
  if (msg) msg.textContent = '确认删除用户「' + name + '」及其全部账户数据？删除后该用户的所有数据将被清空，且不可恢复。';
  const inp = document.getElementById('userDeleteInput');
  if (inp) inp.value = '';
  const ok = document.getElementById('userDeleteOk');
  if (ok) ok.disabled = true;
  const modal = document.getElementById('userDeleteModal');
  if (modal) modal.hidden = false;
  if (inp) setTimeout(() => inp.focus(), 50);
}

async function onUserDeleteConfirm() {
  const id = pendingDeleteUserId;
  const name = pendingDeleteName;
  const modal = document.getElementById('userDeleteModal');
  if (modal) modal.hidden = true;
  pendingDeleteUserId = null;
  if (!id) return;
  try {
    const r = await fetch('/api/users/' + id, { method: 'DELETE' });
    if (!r.ok) {
      let m = '删除失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {}
      toast(m + ' (HTTP ' + r.status + ')', 'err');
      return;
    }
    toast('已删除用户：' + name, 'ok');
    // 若删除的是当前用户，自动切换到剩余首个用户
    const curId = localStorage.getItem('pf_user');
    if (String(curId) === String(id)) {
      const users = await fetchUsers();
      const next = users.length ? users[0] : null;
      if (next) { localStorage.setItem('pf_user', String(next.id)); setUserText(next.name); }
    }
    await load();
    await loadAsset();
    await loadAISettings();
    await loadGuides();
    await refreshUsers();
  } catch (e) { toast('删除异常：' + e.message, 'err'); }
}

// 绑定用户切换相关 UI
(function wireUserUI() {
  const userBtn = document.getElementById('userBtn');
  if (userBtn) userBtn.onclick = () => openUserSheet();
  const closeBtn = document.getElementById('userSheetClose');
  if (closeBtn) closeBtn.onclick = closeUserSheet;
  const backdrop = document.getElementById('userSheetBackdrop');
  if (backdrop) backdrop.onclick = closeUserSheet;
  const addBtn = document.getElementById('userAddBtn');
  if (addBtn) addBtn.onclick = addUser;
  const clearBtn = document.getElementById('userClearBtn');
  if (clearBtn) clearBtn.onclick = clearUserData;
  // 数据导出/导入（原资产全景工具栏迁入，功能不变）
  const exportBtn = document.getElementById('ai_export_json');
  if (exportBtn) exportBtn.onclick = confirmExport;
  const importBtn = document.getElementById('ai_import_json');
  if (importBtn) importBtn.onclick = () => { document.getElementById('importFile').click(); };
  const list = document.getElementById('userList');
  if (list) list.addEventListener('click', onUserListClick);
  const delInput = document.getElementById('userDeleteInput');
  if (delInput) delInput.oninput = () => {
    const ok = document.getElementById('userDeleteOk');
    if (ok) ok.disabled = delInput.value.trim() !== '我已知晓';
  };
  const delCancel = document.getElementById('userDeleteCancel');
  if (delCancel) delCancel.onclick = () => { const m = document.getElementById('userDeleteModal'); if (m) m.hidden = true; };
  const delOk = document.getElementById('userDeleteOk');
  if (delOk) delOk.onclick = onUserDeleteConfirm;
  const delModal = document.getElementById('userDeleteModal');
  if (delModal) delModal.addEventListener('click', (e) => { if (e.target === delModal) delModal.hidden = true; });
})();

// 卡片折叠/展开（资产总览 / 资产全景顶部卡片 / 通知渠道卡片 / 来源分组表）。
// 事件委托：动态渲染的 .collapsible（如来源分组）同样生效。
document.addEventListener('click', (e) => {
  const hat = e.target.closest('.collapse-hat');
  if (!hat) return;
  // 帽子里的交互元素（启用开关/输入/按钮/链接）点击时不触发折叠
  if (e.target.closest('input, select, textarea, button, a, label.switch')) return;
  const card = hat.parentElement;
  if (!card || !card.classList.contains('collapsible')) return;
  card.classList.toggle('collapsed');
});

// 初始路由：按 URL hash 恢复视图（刷新不退回首页；无 hash 默认持仓列表）
applyRoute();
