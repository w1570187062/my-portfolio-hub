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

// ===== 导航下拉菜单 =====
const navDropdown = document.getElementById('navDropdown');
const navToggleBtn = document.getElementById('navToggle');

function setNavActive(name) {
  if (!navDropdown) return;
  navDropdown.querySelectorAll('.nav-item').forEach((it) => {
    it.classList.toggle('active', it.dataset.nav === name);
  });
}
function closeNavDropdown() {
  if (!navDropdown || navDropdown.hidden) return;
  navDropdown.hidden = true;
  navToggleBtn.setAttribute('aria-expanded', 'false');
  navToggleBtn.classList.remove('open');
}
if (navToggleBtn && navDropdown) {
  navToggleBtn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = !navDropdown.hidden;
    navDropdown.hidden = isOpen;
    navToggleBtn.setAttribute('aria-expanded', String(!isOpen));
    navToggleBtn.classList.toggle('open', !isOpen);
  };
  document.addEventListener('click', (e) => {
    if (!navDropdown.hidden && !e.target.closest('.brand-nav')) closeNavDropdown();
  });
  navDropdown.querySelectorAll('.nav-item').forEach((item) => {
    item.onclick = () => {
      const nav = item.dataset.nav;
      closeNavDropdown();
      switch (nav) {
        case 'home':
          showHoldingsView();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'calendar':
          if ($('#calendarView').hidden) {
            $('#holdingsView').hidden = true;
            $('#assetView').hidden = true;
            $('#toolsView').hidden = true;
            $('#notifyView').hidden = true;
            $('#calendarView').hidden = false;
            restoreCalMonth();
            renderCalendar();
            setNavActive('calendar');
          } else {
            showHoldingsView();
          }
          break;
        case 'asset': showAssetView(); break;
        case 'tools': showToolsView(); break;
        case 'notify': showNotifyView(); break;
      }
    };
  });
}

const api = (path, opts = {}) => {
  const token = localStorage.getItem('pf_token');
  const uid = localStorage.getItem('pf_user');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (uid) headers['X-User-Id'] = uid;
  return fetch(path, { ...opts, headers });
};

const fmt = (n) => (n == null ? '' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
const pct = (n) => (n > 0 ? '+' : '') + (n == null ? '' : n.toFixed(2)) + '%';
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const cat = (c) => (c === 'fund' ? '基金' : '股票');
// 净值/成本价按类别精度显示：基金净值保留 4 位小数，股票保持 2 位。
const fmtNav = (n, category) => {
  if (n == null) return '';
  if (category === 'fund') return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return fmt(n);
};

let allHoldings = [];
let curPage = 1;
let pageSize = 10;
let catFilter = new Set(); // selected categories; empty = all
let mktFilter = new Set(); // selected markets; empty = all
let textFilter = '';        // 文本搜索（名称/代码/备注），配合「/」快捷聚焦
let usdRate = 1;
let hkdRate = 1;
let dayDate = ''; // 当日盈亏所基于的快照日期（YYYY-MM-DD）
let snapshotDate = '';   // 最近 pnl_daily 快照日期（YYYY-MM-DD）
let updatedAtMax = '';   // 行情更新时间最大值（YYYY-MM-DD HH:MM:SS）
let monthPnlCNY = 0;     // 本月累计盈亏（CNY 折算）
let monthPnlCny = 0;     // 本月累计盈亏（RMB 原始货币）
let monthPnlUsd = 0;     // 本月累计盈亏（USD 原始货币）
let failedSymbols = {};  // symbol -> 失败原因（刷新失败持久标记）
// table | card；移动端（窄屏）默认卡片视图（表格横向溢出体验差），但不强制——允许用户手动切回表格（可横向滚动）
let holdingsView = localStorage.getItem('pf_view') || (window.innerWidth < 640 ? 'card' : 'table');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two-level category -> market association (二级筛选).
const CAT_MARKETS = {
  stock: ['A股', '美股'],
  fund: ['QDII', '债券', '股票', '商品'],
};
const ALL_MARKETS = [...CAT_MARKETS.stock, ...CAT_MARKETS.fund];

// 静默自动登录：用默认凭据向后端换取 token，全程不展示登录界面
async function silentLogin() {
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', pass: 'asd2335979545' }),
    });
    if (r.ok) { const d = await r.json(); localStorage.setItem('pf_token', d.token); }
  } catch (_) {}
}

// 用本地 token 试探一次，有效则无需重新登录
async function tokenValid() {
  const t = localStorage.getItem('pf_token');
  if (!t) return false;
  try {
    const r = await fetch('/api/summary', { headers: { Authorization: 'Bearer ' + t } });
    return r.ok;
  } catch (_) { return false; }
}

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
    const ddl = document.getElementById('dayDateLbl');
    if (ddl) ddl.textContent = dayDate;
    renderFreshness();
    if (!freshnessTimer) freshnessTimer = setInterval(renderFreshness, 30000);
    buildFilters();
    renderFiltered();
  } catch (e) {
    toast('加载异常：' + e.message, 'err');
  }
}

// 行情时效性标识：原「行情更新于 MM-DD HH:MM:SS」已简化为「MM-DD HH:MM:SS 更新」，时间格式不变；
// 显示在 header 左侧（主题切换按钮之前）的第二行圆角 pill，超 30 分钟仅变灰。
let freshnessTimer = null;
function renderFreshness() {
  const el = document.getElementById('hfTime');
  if (!el) return;
  if (!updatedAtMax) { el.textContent = ''; el.hidden = true; return; }
  el.hidden = false;
  const parts = String(updatedAtMax).split(' ');
  const full = parts[1] || updatedAtMax;
  const hhmm = full.length >= 8 ? full.slice(0, 5) : full; // 精确到分钟，去秒
  const dayFull = parts[0] || '';
  const dayMD = dayFull.length >= 10 ? dayFull.slice(5) : dayFull; // 取 MM-DD
  const t = new Date(String(updatedAtMax).replace(' ', 'T'));
  const now = new Date();
  const diffMs = now - t;
  const stale = isNaN(diffMs) ? false : diffMs > 30 * 60 * 1000;
  // 简化：「行情更新于」改为「MM-DD HH:MM 更新」，精确到分钟。
  el.textContent = dayMD + ' ' + hhmm + ' 更新';
  el.className = 'hf-time' + (stale ? ' stale' : '');
}

// 顶部汇率跑马灯（纵向上下滚动）+ 行情更新时间，已移至 header 左侧（主题切换按钮之前）。
// 上方为汇率跑马灯（三项纵向堆叠，复制一份首尾相接，配合 CSS translateY 步进无缝循环），下方为行情更新时间。
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
    // 三角箭头放在涨跌幅前面：如 (▲+0.12%)
    return ' <span class="fx-chg" style="color:' + (chg.pct > 0.01 ? 'var(--up)' : (chg.pct < -0.01 ? 'var(--down)' : 'var(--text-muted)')) + '">(' + dir + sign + abs.toFixed(dec) + '%)</span>';
  }

  const items = [
    { code: 'USD', val: d.usd_cny || 0, dec: 4, unit: '¥', chg: chgStr(usdChg, 2) },
    { code: 'HKD', val: d.hkd_cny || 0, dec: 4, unit: '¥', chg: chgStr(hkdChg, 2) },
    { code: 'CNY', val: d.cny_usd || 0, dec: 4, unit: '$', chg: chgStr(cnyChg, 2) },
  ];

  // 纵向跑马灯：三项汇率纵向堆叠成一组，复制一份首尾相接；CSS 步进 -20px(单项高) → -60px(-3 项) 实现无缝循环。
  const oneSet = items.map((it) =>
    '<div class="hf-item"><b>1 ' + it.code +
    ' = <span class="hf-num">' + it.val.toFixed(it.dec) + '</span> ' + it.unit + '</b>' + it.chg + '</div>'
  ).join('');
  track.innerHTML = oneSet + oneSet;

  // 行情更新时间 pill（由 renderFreshness 填充，30s 刷新一次）
  renderFreshness();
}

// Holdings after applying the two-level (category + market) filter.
function filteredHoldings() {
  const kw = textFilter;
  return allHoldings.filter((h) => {
    if (catFilter.size && !catFilter.has(h.category)) return false;
    // 市场筛选仅在选定了具体类别（市场行可见）时生效：全不勾选 → 空集 → 无数据；全勾选 → 全部。
    if (catFilter.size && !mktFilter.has(h.market)) return false;
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

// Apply the active column sort to a filtered holding list.
// 市值/盈亏按 RMB 折算后比较，与列表展示口径一致；盈亏率按原值。
function sortedHoldings(hs) {
  if (!sortKey) return hs;
  const dir = sortDir === 'asc' ? 1 : -1;
  const val = (h) => (sortKey === 'pnl_pct' ? (h.pnl_pct || 0) : toRmb(h, h[sortKey]));
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
  // 视图以用户选择为准（holdingsView），移动端仅作为默认偏好，不再强制卡片，保证切换按钮在手机上真实生效
  const useCard = holdingsView === 'card';
  if (useCard) {
    if (tbl) tbl.hidden = true;
    if (tw) tw.hidden = true;
    if (pager) pager.hidden = true;
    if (cards) cards.hidden = false;
    renderCards(sorted);
  } else {
    if (cards) cards.hidden = true;
    if (tw) tw.hidden = false;
    if (tbl) tbl.hidden = false;
    if (pager) pager.hidden = false;
    renderRows(sorted);
  }
  if (empty) {
    const emptyMsg = document.getElementById('emptyMsg');
    const emptyAddBtn = document.getElementById('emptyAddBtn');
    if (allHoldings.length === 0) {
      if (emptyMsg) emptyMsg.textContent = '还没有任何持仓，添加第一笔开始记录吧。';
      if (emptyAddBtn) emptyAddBtn.hidden = false;
      empty.hidden = false;
    } else if (hs.length === 0) {
      if (emptyMsg) emptyMsg.textContent = '无数据：当前筛选条件下没有匹配的持仓，请调整筛选。';
      if (emptyAddBtn) emptyAddBtn.hidden = true;
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
  }
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
  // 合并卡：总资产 / 总盈亏(带涨跌箭头) / 涨跌平数 三列并排、竖线分割，币种市值明细置于总资产列下。
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
  const updownVal = `<span class="up">▲ ${upCount}</span><span class="ud-sep">/</span><span class="down">▼ ${downCount}</span><span class="ud-sep">/</span><span class="flat">— ${flatCount}</span>`;
  // 本月累计：CNY 折算总额下方，再列出本月 RMB/USD 原始货币盈亏（上下排列）
  const mpCnyCls = cls(monthPnlCny), mpUsdCls = cls(monthPnlUsd);
  const mpRows = `<div class="c-pnl-row"><span class="c-pnl-label">RMB</span><span class="c-pnl-val ${mpCnyCls}">¥${fmt(monthPnlCny)}</span></div>` +
                 `<div class="c-pnl-row"><span class="c-pnl-label">USD</span><span class="c-pnl-val ${mpUsdCls}">$${fmt(monthPnlUsd)}</span></div>`;
  $('#summary').innerHTML = `
   <div class="card card-merged"><div class="card-body card-cols">
     <div class="c-col">
       <div class="c-head"><div class="card-icon">${ICON.total}</div><div class="label">总资产 (CNY)</div></div>
       <div class="value">${fmt(totalCNY)}</div><div class="c-breakdown">${br}</div>
     </div>
     <div class="c-col">
       <div class="c-head"><div class="card-icon">${ICON.pnl}</div><div class="label">总盈亏 (CNY)</div></div>
       <div class="value ${pCls}">${pnlVal}</div><div class="c-sub ${pCls}">${pct(totalPct)}</div><div class="c-pnl">${pnlRows}</div>
     </div>
     <div class="c-col">
       <div class="c-head"><div class="card-icon">${ICON.distribution}</div><div class="label">涨跌平数 (${todayStr})</div></div>
       <div class="value updown-value">${updownVal}</div><div class="c-sub ${mpCls}">本月累计 ¥${fmt(monthPnlCNY)}</div><div class="c-pnl">${mpRows}</div>
     </div>
   </div></div>`;
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
    label.innerHTML = `<input type="checkbox" value="${m}" ${mktFilter.has(m) ? 'checked' : ''}> ${m}`;
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
     <td class="name-clickable ${h.day_pnl_pct > 0 ? 'name-up' : (h.day_pnl_pct < 0 ? 'name-down' : '')}" data-analysis="${h.id}" data-category="${h.category}" data-linked-symbol="${esc(h.linked_symbol || '')}" title="${h.category === 'fund' && !h.linked_symbol ? '基金未关联股票代码，不支持技术分析' : esc(h.name)}">${h.day_pnl_pct > 0 ? '<span class="name-arrow">▲</span>' : (h.day_pnl_pct < 0 ? '<span class="name-arrow-down">▼</span>' : '')}<span class="name-text">${esc(h.name)}</span>${h.category === 'fund' && h.linked_symbol ? ' <span class="linked-badge" title="关联 ' + esc(h.linked_symbol) + '">🔗</span>' : ''}</td><td>${h.symbol}</td><td class="hide-col">${cat(h.category)}</td><td class="hide-col">${h.market}</td><td class="hide-col">${h.currency}</td>
     <td class="num">${fmt(h.quantity)}</td>
     <td class="num">${fmtNav(h.cost_price, h.category)}</td>
     <td class="num">${fmtNav(h.current_price, h.category)}</td>
     <td class="num">${fmt(toRmb(h, h.market_value))}${mvOrigNote(h)}</td>
     <td class="num ${cls(h.day_pnl)}">${fmt(toRmb(h, h.day_pnl))} <span class="dp-pct">(${pct(h.day_pnl_pct)})</span></td>
     <td class="num ${cls(h.pnl)}">${fmt(toRmb(h, h.pnl))}</td>
     <td class="num ${cls(h.pnl_pct)}">${pct(h.pnl_pct)}</td>
     <td class="num" style="font-size:12px;color:var(--text-muted)">${h.holding_days > 0 ? h.holding_days + '天' : '—'}</td>
     <td style="font-size:12px;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(h.note || '')}">${esc(h.note || '')}</td>
     <td class="row-actions"><button class="btn act-refresh" data-refresh="${h.id}" title="刷新">🔄</button><button class="btn act-adjust" data-adjust="${h.id}" title="加减仓">📊</button><button class="btn act-edit" data-edit="${h.id}" title="编辑">✏️</button><button class="btn act-hist" data-hist="${h.id}" title="历史">📈</button><button class="btn act-del danger" data-del="${h.id}" title="删除">🗑️</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('[data-refresh]').forEach((b) => (b.onclick = () => { console.log('[click] 刷新持仓', b.dataset.refresh); refreshHolding(b.dataset.refresh, b); }));
  tb.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => { console.log('[click] 编辑持仓', b.dataset.edit); editHolding(b.dataset.edit); }));
  tb.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { console.log('[click] 删除持仓', b.dataset.del); delHolding(b.dataset.del); }));
  tb.querySelectorAll('[data-adjust]').forEach((b) => (b.onclick = () => { console.log('[click] 加减仓', b.dataset.adjust); openAdjust(b.dataset.adjust); }));
  tb.querySelectorAll('[data-hist]').forEach((b) => (b.onclick = () => { console.log('[click] 历史持仓', b.dataset.hist); openHoldingHistory(b.dataset.hist); }));
  tb.querySelectorAll('[data-fail]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toast(failedSymbols[b.dataset.fail] || '刷新失败', 'err'); }));
  tb.querySelectorAll('.name-clickable').forEach((td) => (td.onclick = () => { const id = td.dataset.analysis; const cat = td.dataset.category; const linked = td.dataset.linkedSymbol; if (cat === 'fund' && !linked) { toast('该基金未设置关联股票代码，不支持技术分析', 'info'); return; } console.log('[click] 技术分析', id, linked || ''); openAnalysis(id); }));
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

// refreshHolding refreshes the latest quote for a single holding, persists it,
// and reloads the table. Shows a toast with the new market value.
async function refreshHolding(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  const url = '/api/holdings/' + id + '/refresh';
  console.log('[refresh] 请求 POST', url);
  try {
    const r = await api(url, { method: 'POST' });
    if (r.ok) {
      const d = await r.json();
      const h = d.holding;
      const mv = fmt(toRmb(h, h.market_value));
      const dp = fmt(toRmb(h, h.day_pnl));
      console.log('[refresh] 结果', { name: h.name, symbol: h.symbol, current_price: h.current_price, prev_close: h.prev_close, market_value: h.market_value, day_pnl: h.day_pnl, day_pnl_pct: h.day_pnl_pct, pnl: h.pnl });
      toast(`${h.name} 已刷新：现价 ${fmtNav(h.current_price, h.category)}｜市值 ¥${mv}｜当日盈亏 ${dp}`, 'ok');
      await load();
    } else {
      let msg = '刷新失败 (HTTP ' + r.status + ')';
      try { const e = await r.json(); if (e.error) msg += '：' + e.error; } catch (_) {}
      toast(msg, 'err');
      if (btn) { btn.disabled = false; btn.textContent = '🔄'; }
    }
  } catch (e) {
    toast('刷新异常：' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = '🔄 刷新'; }
  }
}

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
  $('#f_currency').value = h ? h.currency : 'CNY';
  $('#f_quantity').value = h ? h.quantity : '';
  $('#f_cost_price').value = h ? h.cost_price : '';
  $('#f_current_price').value = h ? h.current_price : '';
  $('#f_prev_close').value = h ? h.prev_close : '';
  $('#f_note').value = h ? (h.note || '') : '';
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
function openAdjust(id) {
  const h = allHoldings.find((x) => String(x.id) === String(id));
  if (!h) { toast('未找到该持仓', 'err'); return; }
  $('#adj_id').value = h.id;
  adjType = 'BUY';
  syncAdjSeg();
  $('#adjustTitle').textContent = '加减仓 · ' + (h.name || h.symbol);
  $('#adj_quantity').value = '';
  $('#adj_price').value = h.current_price ? h.current_price : '';
  $('#adj_fee').value = 0;
  $('#adj_note').value = '';
  $('#adjErr').textContent = '';
  computeAdjPreview();
  renderAdjHistory(h.id);
  $('#adjustModal').hidden = false;
  $('#adj_quantity').focus();
}
function syncAdjSeg() {
  document.querySelectorAll('#adjTypeSeg .seg-btn').forEach((b) => {
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
  if (!h) { box.innerHTML = ''; return; }
  if (adjType === 'BUY') {
    const newQty = h.quantity + qty;
    if (qty <= 0) { box.innerHTML = ''; return; }
    if (newQty <= 0) { box.innerHTML = '<span class="warn">加仓后份额需大于 0</span>'; return; }
    const newCost = (h.quantity * h.cost_price + qty * priceVal + fee) / newQty;
    box.innerHTML = `加仓后：份额 <b>${fmt(newQty)}</b>｜摊薄成本价 <b>${fmtNav(newCost, h.category)}</b>` +
      (h.cost_price > 0 ? `（原 ${fmtNav(h.cost_price, h.category)}）` : '');
  } else {
    if (qty <= 0) { box.innerHTML = ''; return; }
    if (qty > h.quantity) { box.innerHTML = '<span class="warn">减仓数量不能超过当前份额 ' + fmt(h.quantity) + '</span>'; return; }
    const realized = (priceVal - h.cost_price) * qty - fee;
    const remainQty = h.quantity - qty;
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
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  adjType = b.dataset.type;
  syncAdjSeg();
  computeAdjPreview();
});
['adj_quantity', 'adj_price', 'adj_fee'].forEach((fid) => {
  const el = document.getElementById(fid);
  if (el) el.addEventListener('input', computeAdjPreview);
});
$('#adjustForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#adj_id').value;
  const h = allHoldings.find((x) => String(x.id) === String(id));
  const qty = parseFloat($('#adj_quantity').value);
  if (!qty || qty <= 0) { $('#adjErr').textContent = '请输入大于 0 的数量'; return; }
  let price = parseFloat($('#adj_price').value);
  if (isNaN(price) && h) price = h.current_price;
  if (isNaN(price) || price < 0) { $('#adjErr').textContent = '价格无效'; return; }
  const fee = parseFloat($('#adj_fee').value) || 0;
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
  pendingAssetDel = null;
  pendingExport = false;
  const btn = $('#confirmOk');
  btn.textContent = '删除';
  btn.classList.add('danger');
  $('#confirmTitle').textContent = '确认删除';
}
$('#confirmOk').onclick = async () => {
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
$('#refreshBtn').onclick = async () => {
  $('#refreshBtn').textContent = '⏳ 刷新中…';
  try {
    const r = await api('/api/refresh', { method: 'POST' });
    $('#refreshBtn').textContent = '🔄 刷新行情';
    if (r.ok) {
      const d = await r.json();
      // 刷新失败标的持久标记：重置为本次失败集合（成功者下次刷新自动清除）
      failedSymbols = {};
      if (d.failed && d.failed.length) {
        d.failed.forEach((f) => {
          const sym = f.indexOf(': ') >= 0 ? f.slice(0, f.indexOf(': ')) : f;
          failedSymbols[sym] = f;
        });
        toast('以下持仓未刷新成功：\n' + d.failed.join('\n'), 'err');
      } else {
        toast('行情已刷新', 'ok');
      }
    } else {
      toast('刷新请求失败 (HTTP ' + r.status + ')', 'err');
    }
  } catch (e) {
    $('#refreshBtn').textContent = '🔄 刷新行情';
    toast('刷新异常：' + e.message, 'err');
  }
  load();
};

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
window.addEventListener('resize', positionIndicator);
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
  const payload = {
    name: $('#f_name').value,
    symbol: $('#f_symbol').value,
    category: $('#f_category').value,
    market: $('#f_market').value,
    currency: $('#f_currency').value,
    quantity: parseFloat($('#f_quantity').value),
    cost_price: parseFloat($('#f_cost_price').value),
    current_price: parseFloat($('#f_current_price').value || '0'),
    prev_close: parseFloat($('#f_prev_close').value || '0') || 0,
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
    return `<div data-label="${esc(s.label)}" style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:14px${opts.onSeg ? ';cursor:pointer' : ''}">
      <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${s.color}"></span>
      <span>${esc(s.label)}</span><span style="margin-left:auto;font-weight:600">¥${fmt(s.value)} (${p}%)</span></div>`;
  }).join('');
  const back = opts.onBack
    ? `<div class="pie-back" data-back="1">← 返回总览</div>`
    : '';
  const hint = opts.onSeg ? `<div class="pie-hint">${opts.hint || '点击区块可查看二级细分'}</div>` : '';
  $('#chartBody').innerHTML = `${back}${hint}<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
    <svg width="220" height="220" viewBox="0 0 220 220">${paths}</svg>
    <div style="min-width:200px">${legend}</div></div>`;
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

$('#assetPieBtn').onclick = () => { renderPie(); };
$('#assetTrendBtn').onclick = renderTrend;
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

$('#calendarBtn').onclick = async () => {
  if ($('#calendarView').hidden) {
    $('#holdingsView').hidden = true;
    $('#assetView').hidden = true;
    $('#toolsView').hidden = true;
    $('#calendarView').hidden = false;
    $('#calendarBtn').classList.add('active');
    $('#calendarBtn').scrollIntoView({ inline: 'center', block: 'nearest' });
    calViewDate = new Date();   // 打开时回到当月
    await renderCalendar();
  } else {
    showHoldingsView();
  }
};

function showHoldingsView() {
  $('#calendarView').hidden = true;
  $('#assetView').hidden = true;
  $('#toolsView').hidden = true;
  $('#notifyView').hidden = true;
  $('#holdingsView').hidden = false;
  $('#calendarBtn').classList.remove('active');
  setNavActive('home');
  syncViewToggle(); // 回到主页时同步滑块选中态与白块位置
}

// 主页按钮：回到一级页面（持仓列表）并滚到顶部
$('#homeBtn').onclick = () => {
  showHoldingsView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
// 「观澜」标题文本：点击回到主页（替代已隐藏的主页按钮）
$('#brandTitle').onclick = () => {
  if (navDropdown && !navDropdown.hidden) closeNavDropdown();
  showHoldingsView();
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
  // 优先关闭导航下拉菜单
  if (navDropdown && !navDropdown.hidden) { closeNavDropdown(); return; }
  // 弹框优先（已有各自的关闭按钮，但 ESC 顺手关弹框更友好）
  const openModals = document.querySelectorAll('.modal:not([hidden])');
  if (openModals.length) return; // 让弹框内的 ESC 由各弹框自行处理
  const inSubView = !$('#assetView').hidden || !$('#toolsView').hidden || !$('#calendarView').hidden || !$('#notifyView').hidden;
  if (inSubView) {
    showHoldingsView();
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
      ms.innerHTML = '<span class="cal-ms-label">本月总盈亏</span>'
        + `<span class="cal-ms-val ${msCls}">¥${sign}${fmt(monthPnl)}</span>`
        + `<span class="cal-ms-sub">${monthDays} 天有数据</span>`;
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
    } else rows = '<p style="color:#8a8f99">无个股明细。</p>';
  } catch (e) { rows = '<p style="color:#f5222d">明细解析失败</p>'; }
  // USD 盈亏也折算为 CNY 展示，保证弹框内全部统一为人民币口径
  const usdCNY = (typeof rec.total_usd === 'number' ? rec.total_usd : 0) * usdRate;
  $('#calModalBody').innerHTML = `
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:14px">
      <div><div class="cal-sub">当日盈亏 (CNY)</div><div class="value ${cls(v)}">${fmt(v)}</div></div>
      <div><div class="cal-sub">USD 盈亏</div><div class="value">${fmt(rec.total_usd)} <span style="color:#8a8f99;font-size:13px">≈ ${fmt(usdCNY)} CNY</span></div></div>
      <div><div class="cal-sub">汇率</div><div class="value">${(rec.rate || 0).toFixed(4)}</div></div>
    </div>${rows}`;
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
  } catch (e) { /* 忽略，使用默认值 */ }
  $('#ai_apikey').value = aiCfg.api_key || '';
  $('#ai_model').value = aiCfg.model || 'deepseek-v4-pro';
  $('#ai_baseurl').value = aiCfg.base_url || 'https://api.deepseek.com';
  $('#aiAutoDaily').checked = !!aiCfg.auto_daily;
  $('#aiAutoSend').checked = !!aiCfg.auto_send;
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

function openAIResultModal(text) {
  $('#aiResultBody').textContent = text;
  $('#aiResultModal').hidden = false;
}

async function aiSaveSettings() {
  $('#aiErr').textContent = '';
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
  aiCfg.model = $('#ai_model').value.trim() || 'deepseek-v4-pro';
  aiCfg.base_url = $('#ai_baseurl').value.trim() || 'https://api.deepseek.com';
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
    $('#aiModal').hidden = true;
  } catch (e) {
    $('#aiErr').textContent = '保存异常：' + e.message;
  }
}

async function aiSummarize() {
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
  const content = (edited && edited.trim()) ? edited : (aiCfg.templates[aiSelIdx] ? aiCfg.templates[aiSelIdx].content : '');
  if (!api_key) { toast('请先在「AI 设置」填写 API Key', 'err'); openAIModal(); return; }
  if (api_key) localStorage.setItem('pf_ai_key', api_key);
  if (!content) { toast('提示词模板为空', 'err'); return; }
  openAIResultModal('生成中…（模型思考中，请稍候，最长约 3 分钟）');
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
  if (tab === 'settings') renderTplSelect();
  if (tab === 'history') loadAIHistory();
}
$('#aiPickBtn').onclick = () => {
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
  $('#aiHubModal').hidden = true;
  if (type === 'all') assetAiSummarize();
  else aiSummarize();
};
$('#ai_export_json').onclick = confirmExport;

// ---- 持仓历史盈亏（每日表格 + 盈亏曲线，tab 切换） ----
$('#histTabTable').onclick = () => switchHistTab('table');
$('#histTabChart').onclick = () => switchHistTab('chart');

// ===== 调试：统一按钮点击日志（addEventListener 追加，不干扰原有 onclick） =====
['addBtn','guideBtn','refreshBtn','aiPickBtn','moreBtn','aiPickGo','aiHubXClose','hubTabSummary','hubTabTools','hubTabSettings','hubTabHistory','calendarBtn','confirmOk','assetPieBtn','assetTrendBtn','calModalPrev','calModalNext','calPrev','calNext','themeToggleBtn','navToggle','ai_save','ai_tpl_new','ai_tpl_del','ai_toggleKey','ai_copy','histTabTable','histTabChart'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => console.log('[click]', id));
});

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
  const cls = x.day_pnl > 0 ? 't-up' : x.day_pnl < 0 ? 't-down' : 't-muted';
  const sign = x.day_pnl > 0 ? '+' : '';
  const dayStr = sign + fmt(x.day_pnl);
  const cumCls = x.total_pnl > 0 ? 't-up' : x.total_pnl < 0 ? 't-down' : 't-muted';
  tip.innerHTML = '<div class="t-date">' + x.date + '</div>'
    + '<div class="t-row"><span>当日盈亏</span><span class="' + cls + '">' + dayStr + '</span></div>'
    + '<div class="t-row"><span>累计盈亏</span><span class="' + cumCls + '">' + fmt(x.total_pnl) + '</span></div>';
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

$('#assetBtn').onclick = () => showAssetView();

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
  $('#calendarView').hidden = true;
  $('#toolsView').hidden = true;
  $('#notifyView').hidden = true;
  $('#assetView').hidden = false;
  injectPageHead('assetView', '🗂️ 资产全景');
  // 将工具栏整排移入页头右侧 actions（与「资产全景」同一行末尾）
  const tb = document.querySelector('#assetView .asset-toolbar');
  const acts = document.querySelector('#assetView .page-head__actions');
  if (tb && acts && tb.parentElement !== acts) acts.appendChild(tb);
  $('#calendarBtn').classList.remove('active');
  $('#assetBtn').scrollIntoView({ inline: 'center', block: 'nearest' });
  setNavActive('asset');
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

$('#toolsBtn').onclick = () => showToolsView();
async function showToolsView() {
  $('#holdingsView').hidden = true;
  $('#calendarView').hidden = true;
  $('#assetView').hidden = true;
  $('#notifyView').hidden = true;
  $('#toolsView').hidden = false;
  injectPageHead('toolsView', '');
  $('#calendarBtn').classList.remove('active');
  $('#toolsBtn').scrollIntoView({ inline: 'center', block: 'nearest' });
  setNavActive('tools');
  await loadToolsFx();
  const eqOk = await loadEqRows();
  if (!eqOk) addEqRow();
  const usdOk = await loadUsdRows();
  if (!usdOk) { addUsdBuy(); addUsdPnl(); }
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
    <select class="eq-kind">
      <option value="stock">股票</option>
      <option value="fund">基金</option>
      <option value="wealth">理财</option>
    </select>
    <input class="eq-amt" type="number" step="any" placeholder="盈亏金额（正盈利/负亏损）">
    <select class="eq-cur">
      <option value="USD">USD 美元</option>
      <option value="HKD">HKD 港币</option>
      <option value="RMB" selected>RMB 人民币</option>
    </select>
    <input class="eq-note" type="text" placeholder="备注（可选）">
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
    <input class="usd-buy" type="number" step="any" placeholder="买入 USD 金额">
    <input class="usd-brate" type="number" step="any" placeholder="买入汇率 RMB/USD">
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
    <select class="usd-kind">
      <option value="stock">股票</option>
      <option value="fund">基金</option>
      <option value="wealth">理财</option>
      <option value="cash">现金</option>
    </select>
    <input class="usd-pnl" type="number" step="any" placeholder="盈亏 USD 金额（正盈利/负亏损）">
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
};

// 计算器卡片关闭 / 恢复
function updateRestore() {
  const hidden = document.querySelectorAll('.tool-card[hidden]').length;
  const box = $('#toolsRestore');
  if (!box) return;
  if (hidden > 0) {
    box.hidden = false;
    $('#restoreCount').textContent = hidden;
  } else {
    box.hidden = true;
  }
}
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
  if (modal) { modal.hidden = true; return; }
  const card = x.closest('.tool-card');
  if (card) { card.hidden = true; updateRestore(); }
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
const toolsRestoreBtn = $('#toolsRestoreBtn');
if (toolsRestoreBtn) {
  toolsRestoreBtn.onclick = () => {
    document.querySelectorAll('.tool-card[hidden]').forEach(c => { c.hidden = false; });
    updateRestore();
  };
}

// 补仓成本计算器：补仓现价同时作为买入价与盈亏参考价；手续费买卖各一笔（买费进成本、卖费扣盈亏）
function calcAdd() {
  const P0 = parseFloat($('#addOldPrice').value);
  const Q0 = parseFloat($('#addOldQty').value);
  const f  = parseFloat($('#addFee').value);
  const P1 = parseFloat($('#addNewPrice').value);
  const el = $('#addResult');
  const mode = $('#addMode').value;
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
  html += `<div class="res-row">合并持仓数量：<b>${fmt(Q)}</b>　｜　合并持仓成本：<b>${fmt(avgCost)}</b> / 份</div>`;
  html += `<div class="res-row">补仓明细：${addDesc}</div>`;
  html += `<div class="res-main ${sign}">补仓后盈亏（净，已扣双费）：¥ ${fmt(Math.abs(pnl))} ${pnl >= 0 ? '盈利' : '亏损'}（${pct(pctVal)}）</div>`;
  html += `<div class="res-detail">口径拆解：原仓 (现价−原价)×原数量 = ¥${fmt(Q0 * (P1 - P0))}；买卖双费 = ¥${fmt(2 * fee)}；补仓份数按现价计为平。盈亏比例以合并成本 ¥${fmt(costBasis)} 为分母。</div>`;
  el.innerHTML = html;
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
  const eq = d.equity || {}, w = d.wealth || {}, l = d.liability || {}, c = d.consumption || {}, cash = d.cash || {};
  const wBy = w.by_currency || {};
  const cBy = cash.by_currency || {};
  const byCurHtml = (m) => Object.keys(m).map((k) => `${curSymbolJS(k)}${fmt(m[k] || 0)}`).join(' | ');
  const total = (eq.market_value || 0) + (w.total || 0) + (cash.total || 0);
  // 合并卡片：总资产（含 权益市值 / 理财持仓 明细）
  const equityRow =
    `<div class="c-br"><span class="c-br-label">权益市值</span>` +
    `<span class="c-br-val">${money(eq.market_value || 0)}</span>` +
    `<span class="c-br-delta ${pnlCls(eq.day_pnl || 0)}">当日 ${pnlTxt(eq.day_pnl || 0)}</span></div>`;
  const wealthRow =
    `<div class="c-br"><span class="c-br-label">理财持仓</span>` +
    `<span class="c-br-val">${money(w.total || 0)}</span>` +
    `<span class="c-br-delta ${pnlCls(w.today_pnl || 0)}">${(w.snap_date && w.snap_date !== new Date().toLocaleDateString('en-CA') ? '今日未录入' : '今日收益 ' + pnlTxt(w.today_pnl || 0))}</span></div>`;
  const cashRow =
    `<div class="c-br"><span class="c-br-label">现金</span>` +
    `<span class="c-br-val">${money(cash.total || 0)}</span>` +
    `<span class="c-br-delta">${byCurHtml(cBy) ? byCurHtml(cBy) : '—'}</span></div>`;
  const mergedCard =
    `<div class="card card-merged">` +
      `<div class="c-label">总资产</div>` +
      `<div class="c-value">${money(total)}</div>` +
      `<div class="c-breakdown">${equityRow}${wealthRow}${cashRow}</div>` +
    `</div>`;
  $('#assetSummary').innerHTML = mergedCard;
}

function renderAssetTab() {
  const body = $('#assetTabBody');
  if (assetTab === 'sources') return renderSources(body);
  if (assetTab === 'wealth') return renderWealth(body);
  if (assetTab === 'cash') return renderCash(body);
  if (assetTab === 'liability') return renderLiability(body);
  if (assetTab === 'consume') return renderConsume(body);
}

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

function assetDel(type, id) {
  const msg = {
    source: '确认删除该资产来源？关联记录会保留来源名快照，但来源本身不可恢复。',
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
  let html = `<div class="asset-section-head"><h3>资产来源（${list.length}）</h3><button class="btn asset-add" id="addSourceBtn">＋ 添加来源</button></div>`;
  if (!list.length) html += `<div class="empty-block"><p class="empty">还没有资产来源，先添加一个银行或平台吧。</p><button class="btn asset-add-inline" data-empty-add="source" type="button">➕ 添加来源</button></div>`;
  else {
    html += `<table class="asset-table"><thead><tr><th>名称</th><th>类型</th><th>备注</th><th></th></tr></thead><tbody>`;
    for (const s of list) {
      html += `<tr><td>${esc(s.name)}</td><td>${s.type === 'platform' ? '平台' : '银行'}</td><td>${esc(s.note || '')}</td>
        <td class="num asset-row-actions"><button class="btn btn-icon" data-act="edit-source" data-id="${s.id}">✏️ 编辑</button><button class="btn btn-icon danger" data-act="del-source" data-id="${s.id}">🗑️ 删除</button></td></tr>`;
    }
    html += `</tbody></table>`;
  }
  body.innerHTML = html;
  $('#addSourceBtn').onclick = () => openAssetSourceModal(null);
  body.querySelectorAll('[data-act="edit-source"]').forEach((b) => b.onclick = () => openAssetSourceModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="del-source"]').forEach((b) => b.onclick = () => assetDel('source', Number(b.dataset.id)));
}

function openAssetSourceModal(id) {
  const s = id ? assetSources.find((x) => x.id === id) : null;
  $('#assetSourceTitle').textContent = s ? '编辑资产来源' : '添加资产来源';
  $('#as_id').value = s ? s.id : '';
  $('#as_name').value = s ? s.name : '';
  $('#as_type').value = s ? s.type : 'bank';
  $('#as_note').value = s ? (s.note || '') : '';
  $('#assetSourceErr').textContent = '';
  $('#assetSourceModal').hidden = false;
}
$('#assetSourceForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#as_id').value ? Number($('#as_id').value) : 0;
  const payload = { name: $('#as_name').value.trim(), type: $('#as_type').value, note: $('#as_note').value.trim() };
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

function renderWealth(body) {
  const raw = (assetData.wealth || {}).products || [];
  const w = [...raw].sort((a, b) => Number(b.amount) - Number(a.amount)); // 按卡片显示的原币金额从大到小（与卡片展示口径一致）
  let html = `<div class="asset-section-head"><h3>理财（${w.length}）</h3><button class="btn asset-add" id="addWealthBtn">＋ 添加理财</button></div>`;
  if (!w.length) html += `<div class="empty-block"><p class="empty">还没有理财，添加一个并每日录入持仓金额即可自动算每日盈亏。</p><button class="btn asset-add-inline" data-empty-add="wealth" type="button">➕ 添加第一笔理财</button></div>`;
  else {
    html += `<div class="asset-list wealth-list">`;
    w.forEach((p, i) => {
      const pnl = p.today_pnl || 0;
      const cum = p.cum_pnl || 0;
      html += `<div class="asset-card wealth-card"><div class="ac-head">
          <div class="ac-idx">${i + 1}</div>
          <div class="ac-main"><div class="ac-title">${esc(p.name)} <span class="cur-badge">${curSymbolJS(p.currency)}</span></div>
            <div class="ac-sub">${esc(p.code || '')} ${esc(p.source_name || '')} ｜ 已录入 ${p.snap_count || 0} 天</div></div></div>
        <div class="ac-sub">总金额：<span class="ac-amount">${moneyCur(p.amount || 0, p.currency)}</span> ｜ 今日收益：<span class="${pnlCls(pnl)}">${(pnl >= 0 ? '+' : '')}${moneyCur(pnl, p.currency)}</span> ｜ 累计收益：<span class="${pnlCls(cum)}">${(cum >= 0 ? '+' : '')}${moneyCur(cum, p.currency)}</span></div>
        <div class="ac-actions">
          <button class="btn btn-icon" data-act="wealth-hist" data-id="${p.id}">📈 每日盈亏</button>
          <button class="btn btn-icon" data-act="edit-wealth" data-id="${p.id}">✏️ 编辑</button>
          <button class="btn btn-icon danger" data-act="del-wealth" data-id="${p.id}">🗑️ 删除</button>
        </div></div>`;
    });
    html += `</div>`;
  }
  body.innerHTML = html;
  $('#addWealthBtn').onclick = () => openWealthModal(null);
  body.querySelectorAll('[data-act="edit-wealth"]').forEach((b) => b.onclick = () => openWealthModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="del-wealth"]').forEach((b) => b.onclick = () => assetDel('wealth', Number(b.dataset.id)));
  body.querySelectorAll('[data-act="wealth-hist"]').forEach((b) => b.onclick = () => openWealthHist(Number(b.dataset.id)));
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
  $('#w_note').value = w ? (w.note || '') : '';
  $('#wealthErr').textContent = '';
  $('#wealthModal').hidden = false;
}
$('#wealthForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#w_id').value ? Number($('#w_id').value) : 0;
  const payload = { name: $('#w_name').value.trim(), code: $('#w_code').value.trim(), source_id: Number($('#w_source').value) || 0, currency: $('#w_currency').value, note: $('#w_note').value.trim() };
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
  const list = (assetData.cash || {}).items || [];
  let html = `<div class="asset-section-head"><h3>现金（${list.length}）</h3><button class="btn asset-add" id="addCashBtn">＋ 添加现金</button></div>`;
  if (!list.length) html += `<div class="empty-block"><p class="empty">还没有现金记录，添加各账户的现金余额即可纳入总资产。</p><button class="btn asset-add-inline" data-empty-add="cash" type="button">➕ 添加现金</button></div>`;
  else {
    html += `<table class="asset-table"><thead><tr><th>名称</th><th class="num">余额</th><th>币种</th><th>来源</th><th>备注</th><th></th></tr></thead><tbody>`;
    for (const c of list) {
      html += `<tr><td>${esc(c.name)}</td><td class="num">${moneyCur(c.amount || 0, c.currency)}</td><td>${curSymbolJS(c.currency)}</td><td>${esc(c.source_name || '')}</td><td>${esc(c.note || '')}</td>
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

async function openWealthHist(id) {
  try {
    const r = await api('/api/asset/wealth/' + id + '/history');
    if (!r.ok) { toast('加载失败 (HTTP ' + r.status + ')', 'err'); return; }
    const d = await r.json();
    const rows = d.rows || [];
    if (!rows.length) { $('#wealthHistBody').innerHTML = '<p class="empty">暂无录入记录。</p>'; }
    else {
      let html = '<table class="asset-table"><thead><tr><th>日期</th><th class="num">持仓金额</th><th class="num">净存入</th><th class="num">当日盈亏</th><th class="num">累计盈亏</th></tr></thead><tbody>';
      for (const r2 of rows) {
        const p = r2.pnl || 0, cum = r2.cum_pnl || 0;
        html += `<tr><td>${r2.date}</td><td class="num">${money(r2.amount || 0)}</td><td class="num">${money(r2.cashflow || 0)}</td>
          <td class="num ${pnlCls(p)}">${pnlTxt(p)}</td><td class="num ${pnlCls(cum)}">${pnlTxt(cum)}</td></tr>`;
      }
      html += '</tbody></table>';
      $('#wealthHistBody').innerHTML = html;
    }
    $('#wealthHistModal').hidden = false;
  } catch (err) { toast('异常：' + err.message, 'err'); }
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
$('#assetSnapBtn').onclick = openSnapModal;

// ---- 通知渠道二级页 ----
function showNotifyView() {
  $('#holdingsView').hidden = true;
  $('#assetView').hidden = true;
  $('#toolsView').hidden = true;
  $('#calendarView').hidden = true;
  $('#notifyView').hidden = false;
  injectPageHead('notifyView', '🔔 通知渠道');
  setNavActive('notify');
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
          <input type="number" step="any" class="sr-amt" id="amt-${p.id}" data-id="${p.id}" value="${p.amount || 0}" placeholder="如 105000（今天收盘后的总市值）">
          <div class="sr-hint">该理财今天的总持仓金额（本金+收益）。默认带出上次录入值，留空则不更新此项。</div>
        </div>
        <div class="sr-field">
          <label class="sr-label" for="cf-${p.id}">② 当日净存入 ${curSymbolJS(p.currency)}</label>
          <input type="number" step="any" class="sr-cf" id="cf-${p.id}" data-id="${p.id}" value="0" placeholder="转入为正，转出为负，无变动填 0">
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
  $('#snapBody').querySelectorAll('.snap-row').forEach((row) => {
    const amtInput = row.querySelector('.sr-amt');
    if (amtInput.value === '') return;
    items.push({ wealth_id: Number(amtInput.dataset.id), amount: Number(amtInput.value), cashflow: Number(row.querySelector('.sr-cf').value || 0) });
  });
  if (!items.length) { toast('没有可保存的数据', 'err'); return; }
  try {
    const r = await api('/api/asset/wealth/snapshots', { method: 'POST', body: JSON.stringify({ date, items }) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
    $('#snapModal').hidden = true;
    toast('今日持仓已保存', 'ok');
    await loadAsset();
  } catch (err) { toast('保存异常：' + err.message, 'err'); }
};

// ---- 一键 AI 总结（汇总全部资产） ----
async function assetAiSummarize() {
  const boxKey = ($('#ai_apikey') ? $('#ai_apikey').value : '').trim();
  const lsKey = (localStorage.getItem('pf_ai_key') || '').trim();
  const api_key = boxKey || lsKey || (aiCfg.api_key || '').trim();
  const model = ($('#ai_model').value || '').trim() || 'deepseek-v4-pro';
  const base_url = ($('#ai_baseurl').value || '').trim() || 'https://api.deepseek.com';
  // 与权益类一致：优先使用 AI 设置弹框中当前编辑/选中的模板，避免静默回退到第一条或默认模板
  const edited = ($('#ai_tpl_content') ? $('#ai_tpl_content').value : '');
  const content = (edited && edited.trim()) ? edited : (aiCfg.templates[aiSelIdx] ? aiCfg.templates[aiSelIdx].content : '');
  if (!api_key) { toast('请先在「AI 设置」填写 API Key', 'err'); openAIModal(); return; }
  if (!content) { toast('提示词模板为空，请先在「AI 设置」选择或填写模板', 'err'); openAIModal(); return; }
  if (api_key) localStorage.setItem('pf_ai_key', api_key);
  openAIResultModal('生成中…（正在汇总全部资产并调用模型，请稍候）');
  $('#aiPickGo').disabled = true;
  try {
    const r = await api('/api/asset/summary', { method: 'POST', body: JSON.stringify({ model, base_url, api_key, template: content }) });
    if (!r.ok) { let m = '生成失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#aiResultBody').textContent = m; return; }
    const d = await r.json();
    $('#aiResultBody').textContent = d.content || '（空）';
  } catch (err) {
    $('#aiResultBody').textContent = '异常：' + err.message;
  } finally {
    $('#aiPickGo').disabled = false;
  }
}

// ── 技术分析 ──────────────────────────────────────────
async function openAnalysis(id) {
  const modal = $('#analysisModal');
  const body = $('#analysisBody');
  body.innerHTML = '<div class="analysis-loading">⏳ 正在获取技术分析数据…</div>';
  modal.hidden = false;
  try {
    const r = await api('/api/holdings/' + id + '/analysis');
    if (!r.ok) {
      let msg = '获取技术分析失败 (HTTP ' + r.status + ')';
      try { const e = await r.json(); if (e.error) msg += '：' + e.error; } catch (_) {}
      body.innerHTML = '<div class="analysis-err">' + msg + '</div>';
      return;
    }
    const d = await r.json();
    const a = d.analysis;
    if (a.error) {
      body.innerHTML = '<div class="analysis-err">' + a.error + '</div>';
      return;
    }
    // 基金：仅当后端未返回指标（未关联股票代码/数据不足）时才提示不支持；
    // 有关联代码且分析成功的基金应正常渲染。
    if (a.category === 'fund' && !a.indicators) {
      body.innerHTML = '<div class="analysis-err">该基金未设置关联股票代码，不支持技术分析</div>';
      return;
    }
    $('#analysisTitle').textContent = '📊 ' + a.name + (a.category === 'fund' ? ' (关联 ' + a.symbol + ' 分析)' : ' (' + a.symbol + ') 技术分析');
    renderAnalysis(a);
    const tsEl = document.getElementById('analysisTime');
    if (tsEl) tsEl.textContent = a.generated_at ? '分析时间：' + a.generated_at : '';
  } catch (e) {
    body.innerHTML = '<div class="analysis-err">异常：' + e.message + '</div>';
  }
}

function renderAnalysis(a) {
  const ind = a.indicators;
  const prob = a.probability;
  if (!ind || !prob) {
    $('#analysisBody').innerHTML = '<div class="analysis-err">数据不足</div>';
    return;
  }

  const upColor = '#ff4757', downColor = '#2ed573';

  let html = '';

  // Probability card
  const upPct = prob.up_pct || 50;
  html += '<div class="prob-card">';
  html += '<div class="prob-bar-wrap"><div class="prob-bar"><div class="prob-up" style="width:' + upPct + '%">▲ ' + upPct.toFixed(1) + '%</div><div class="prob-down" style="width:' + (100-upPct) + '%">▼ ' + (100-upPct).toFixed(1) + '%</div></div></div>';
  html += '<div class="prob-summary">' + esc(prob.summary) + '</div>';
  html += '<div class="prob-conf">置信度：' + '★'.repeat(prob.confidence || 0) + '☆'.repeat(5 - (prob.confidence || 0)) + '</div>';
  html += '</div>';

  // Indicators table
  html += '<div class="ind-table-wrap"><table class="ind-table">';
  html += '<thead><tr><th>指标</th><th>数值</th><th>信号</th><th>依据</th></tr></thead><tbody>';

  // Price vs MA
  html += '<tr><td>最新价</td><td>' + ind.price.toFixed(2) + '</td><td colspan="2"></td></tr>';
  html += '<tr><td>MA5</td><td>' + (ind.ma5 ? ind.ma5.toFixed(2) : '—') + '</td><td class="' + (ind.price > ind.ma5 ? 'up' : 'down') + '">' + (ind.price > ind.ma5 ? '多头 ↑' : '空头 ↓') + '</td><td></td></tr>';
  html += '<tr><td>MA10</td><td>' + (ind.ma10 ? ind.ma10.toFixed(2) : '—') + '</td><td class="' + (ind.price > ind.ma10 ? 'up' : 'down') + '">' + (ind.price > ind.ma10 ? '多头 ↑' : '空头 ↓') + '</td><td></td></tr>';
  html += '<tr><td>MA20</td><td>' + (ind.ma20 ? ind.ma20.toFixed(2) : '—') + '</td><td class="' + (ind.price > ind.ma20 ? 'up' : 'down') + '">' + (ind.price > ind.ma20 ? '多头 ↑' : '空头 ↓') + '</td><td></td></tr>';
  html += '<tr><td>MA60</td><td>' + (ind.ma60 ? ind.ma60.toFixed(2) : '—') + '</td><td class="' + (ind.price > ind.ma60 ? 'up' : 'down') + '">' + (ind.price > ind.ma60 ? '多头 ↑' : '空头 ↓') + '</td><td></td></tr>';

  // MACD
  const macd = ind.macd || {};
  const macdDir = macd.hist > 0 ? 'up' : 'down';
  html += '<tr><td>MACD DIF</td><td>' + (macd.dif ? macd.dif.toFixed(4) : '—') + '</td><td rowspan="3" class="' + macdDir + '">' + (macd.hist > 0 ? '金叉 ↑' : '死叉 ↓') + '</td><td rowspan="3" style="font-size:12px">DIF=' + (macd.dif ? macd.dif.toFixed(4) : '—') + ' DEA=' + (macd.dea ? macd.dea.toFixed(4) : '—') + ' HIST=' + (macd.hist ? macd.hist.toFixed(4) : '—') + '</td></tr>';
  html += '<tr><td>MACD DEA</td><td>' + (macd.dea ? macd.dea.toFixed(4) : '—') + '</td></tr>';
  html += '<tr><td>MACD HIST</td><td>' + (macd.hist ? macd.hist.toFixed(4) : '—') + '</td></tr>';

  // RSI
  const rsi = ind.rsi || 50;
  const rsiState = rsi > 70 ? '超买↓' : rsi > 50 ? '偏强↑' : rsi > 30 ? '偏弱↓' : '超卖↑';
  html += '<tr><td>RSI(14)</td><td>' + rsi.toFixed(1) + '</td><td class="' + (rsi > 50 ? 'up' : 'down') + '">' + rsiState + '</td><td style="font-size:12px">' + (rsi > 70 ? '超买区域，回调风险高' : rsi > 50 ? '偏强区域，趋势向好' : rsi > 30 ? '偏弱区域，趋势偏空' : '超卖区域，反弹概率高') + '</td></tr>';

  // KDJ
  const kdj = ind.kdj || {};
  html += '<tr><td>KDJ K</td><td>' + (kdj.k ? kdj.k.toFixed(2) : '—') + '</td><td rowspan="3" class="' + (kdj.k > kdj.d ? 'up' : 'down') + '">' + (kdj.k > kdj.d ? '金叉 ↑' : '死叉 ↓') + '</td><td rowspan="3" style="font-size:12px">J=' + (kdj.j ? kdj.j.toFixed(2) : '—') + ' ' + (kdj.j > 100 ? '超买' : kdj.j < 0 ? '超卖' : '') + '</td></tr>';
  html += '<tr><td>KDJ D</td><td>' + (kdj.d ? kdj.d.toFixed(2) : '—') + '</td></tr>';
  html += '<tr><td>KDJ J</td><td>' + (kdj.j ? kdj.j.toFixed(2) : '—') + '</td></tr>';

  // BOLL
  const boll = ind.boll || {};
  const bollPos = boll.mid > 0 ? ((ind.price - boll.lower) / (boll.upper - boll.lower) * 100) : 50;
  html += '<tr><td>BOLL 上轨</td><td>' + (boll.upper ? boll.upper.toFixed(2) : '—') + '</td><td rowspan="3" class="' + (bollPos > 50 ? 'up' : 'down') + '">' + (bollPos > 80 ? '上轨压力↓' : bollPos > 50 ? '中上轨↑' : bollPos > 20 ? '中下轨↓' : '下轨支撑↑') + '</td><td rowspan="3" style="font-size:12px">带宽：' + (boll.width ? boll.width.toFixed(1) + '%' : '—') + ' ' + (boll.width > 20 ? '宽幅震荡' : boll.width < 5 ? '即将变盘' : '') + '</td></tr>';
  html += '<tr><td>BOLL 中轨</td><td>' + (boll.mid ? boll.mid.toFixed(2) : '—') + '</td></tr>';
  html += '<tr><td>BOLL 下轨</td><td>' + (boll.lower ? boll.lower.toFixed(2) : '—') + '</td></tr>';

  html += '</tbody></table></div>';

  // Signal breakdown
  if (prob.signals && prob.signals.length) {
    html += '<div class="sig-list"><h4>信号分解</h4>';
    prob.signals.forEach(s => {
      const cls = s.direction === 'bullish' ? 'sig-up' : s.direction === 'bearish' ? 'sig-down' : 'sig-neutral';
      const arrow = s.direction === 'bullish' ? '▲' : s.direction === 'bearish' ? '▼' : '—';
      html += '<div class="sig-item ' + cls + '"><span class="sig-ind">' + esc(s.indicator) + '</span><span class="sig-arrow">' + arrow + '</span><span class="sig-reason">' + esc(s.reason) + '</span><span class="sig-score">' + (s.score > 0 ? '+' : '') + (s.score || 0).toFixed(2) + '</span></div>';
    });
    html += '</div>';
  }

  $('#analysisBody').innerHTML = html;
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

// 补仓档位是否已到点位：联接ETF最新价 ≤ 该档触发价（与推送通知的判定一致）。
// 注意 BuyPlanTier.Signal 只是档位说明文字（恒非空），不是触发标记。
function isTierTriggered(plan, t) {
  return !!(t && plan && plan.ETFLatest != null && plan.ETFLatest > 0 && plan.ETFLatest <= t.Price);
}

// 直接渲染所有带补仓计划的基金（数据来自 holdings.buy_plan，由净值刷新时计算）
// 二级列表样式：每个基金条目头部可点击折叠/展开其补仓计划明细
async function renderBuyPlans() {
  const body = $('#guidePlanBody');
  const planned = guideHoldings.filter((h) => h.buy_plan && (h.linked_symbol || h.category === 'stock'));
  if (!planned.length) {
    body.innerHTML = '<div class="guide-empty">暂无补仓计划：持仓基金 / 亏损股票会在净值刷新（定时 21:00 / 手动刷新）后自动计算</div>';
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
        <div class="bp-badge">🤖 自动补仓计划</div>`;
    if (plan.Note) html += `<div class="plan-note">${esc(plan.Note)}</div>`;
    if (tiers.length) {
      html += '<div class="plan-tiers">';
      tiers.forEach((t, idx) => {
        const exec = execSet[idx];
        const sig = isTierTriggered(plan, t);
        const action = exec
          ? `<div class="tier-executed">✓ 已执行${exec.note ? ' · ' + esc(exec.note) : ''}</div>`
          : `<button class="btn btn-sm tier-exec-btn" data-exec-h="${h.id}" data-exec-idx="${idx}" data-exec-label="${esc(t.Label)}" data-exec-price="${t.Price}" data-exec-amount="${t.Amount}">标记已补</button>`;
        html += `<div class="plan-tier${sig ? ' has-signal' : ''}${exec ? ' is-executed' : ''}">
          <div class="plan-tier-label">${esc(t.Label)}${sig ? '<span class="tier-flag">触发</span>' : ''}</div>
          <div class="plan-tier-grid">
            <span>触发价</span><b>${fmt(t.Price)}</b>
            <span>回撤</span><b>${t.Drawdown != null ? t.Drawdown.toFixed(1) : '—'}%</b>
            <span>建议投入</span><b>¥${fmt(t.Amount)}</b>
            <span>可补份额</span><b>${fmt(t.Shares)}</b>
          </div>
          ${t.Signal ? `<div class="plan-tier-signal">${esc(t.Signal)}</div>` : ''}
          <div class="tier-action">${action}</div>
        </div>`;
      });
      html += '</div>';
      html += `<div class="plan-foot">弹药上限 ≈ ¥${fmt(plan.AmmoCap)}　｜　已持有市值 ¥${fmt(plan.HeldValue)}　｜　浮动亏损 ¥${fmt(plan.LossAmt)}</div>`;
      if (plan.ETFLatest) {
        html += `<div class="plan-meta">${h.category === 'stock' ? '标的' : '联接ETF'} 最新 ${fmt(plan.ETFLatest)}　｜　BOLL 中轨 ${fmt(plan.BOLLMid)} / 下轨 ${fmt(plan.BOLLLower)}　｜　近60日 ${fmt(plan.SwingBottom)}~${fmt(plan.SwingTop)}（自高点回撤 ${plan.BottomPct != null ? plan.BottomPct.toFixed(1) : '—'}%）</div>`;
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

// 标记某补仓档位为"已执行"（仅记录，不改动持仓数量/成本）
async function executeBuyPlan(btn) {
  const hid = btn.dataset.execH;
  const idx = parseInt(btn.dataset.execIdx, 10);
  const label = btn.dataset.execLabel;
  const price = parseFloat(btn.dataset.execPrice) || 0;
  const amount = parseFloat(btn.dataset.execAmount) || 0;
  if (!confirm(`确认将「${label}」标记为已补？\n（仅记录执行，不会自动加减仓）`)) return;
  btn.disabled = true;
  try {
    const r = await api('/api/holdings/' + hid + '/buy-plan/execute', {
      method: 'POST',
      body: JSON.stringify({ tier_index: idx, tier_label: label, price, amount, note: '' }),
    });
    if (!r.ok) { let m = '标记失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); btn.disabled = false; return; }
    toast('已标记为已补', 'ok');
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
    const contentHtml = g.content ? `<div class="guide-item-content">${esc(g.content)}</div>` : '';
    h += `<div class="guide-item">
      <div class="guide-item-body">
        <div class="guide-item-title">${esc(g.title)}</div>
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
