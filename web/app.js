const $ = (s) => document.querySelector(s);

// ===== 主题切换（日间/夜间） =====
// 默认夜间模式；读取 localStorage 持久化偏好。
// 2026-10-27：顶栏的日/夜快捷切换按钮已删除，入口统一收进右上角个人菜单。
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // 个人菜单里的「日间/夜间」勾选态与主题事实源同步（函数声明已提升，首屏调用时查不到节点也无害）
  syncAcctTheme();
}
applyTheme(localStorage.getItem('pf_theme') || 'dark');

// ===== 主题色（后期可调）：给 <html> 挂 data-accent，具体色值见 style.css 的预设块 =====
// 预设主题：在 style.css 追加一对 :root[data-accent="x"] 规则并把色名加进 ACCENTS；
// 自定义主题（铅笔）：任意颜色以内联 CSS 变量覆盖 --primary/--tint 及 hover/active 衍生色，
// 不与亮暗主题预设冲突（去掉的 purple/rose 与负债珊瑚红、境外紫分类色过近，已移除）。
const ACCENTS = ['gold', 'green', 'blue', 'custom'];
// hex → "R, G, B"（供 rgba(var(--tint),x) 使用）
function hexToTint(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
// 明度调整：t>0 向白靠拢（hover），t<0 向黑靠拢（active）
function shadeHex(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  return '#' + [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
// WCAG 相对亮度：用于判定主色实心底上该用深字还是浅字
function relLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
// 主色实心底上的文字色（--on-primary）：浅色主色配深字，深色主色配柔白字。
// 分界点 L≈0.179 —— 此时白字与黑字对比度相等。深字取同色系压暗版，保留色相。
function onPrimaryFor(hex) {
  const L = relLuminance(hex);
  const withWhite = 1.05 / (L + 0.05);
  const withDark = (L + 0.05) / 0.05;
  return withWhite >= withDark ? '#fafafa' : shadeHex(hex, -0.86);
}
function applyCustomAccent(hex) {
  const root = document.documentElement;
  root.dataset.accent = 'custom';
  root.style.setProperty('--primary', hex);
  root.style.setProperty('--tint', hexToTint(hex));
  root.style.setProperty('--primary-hover', shadeHex(hex, 0.18));
  root.style.setProperty('--primary-active', shadeHex(hex, -0.15));
  root.style.setProperty('--on-primary', onPrimaryFor(hex));
}
function applyAccent(accent) {
  if (accent === 'custom' && localStorage.getItem('pf_accent_custom')) {
    applyCustomAccent(localStorage.getItem('pf_accent_custom'));
  } else {
    if (accent === 'custom') accent = 'blue'; // 无自定义色历史时回退默认
    const v = ACCENTS.indexOf(accent) >= 0 ? accent : 'blue';
    const root = document.documentElement;
    root.dataset.accent = v;
    // 清除自定义内联覆盖，恢复预设色值
    ['--primary', '--tint', '--primary-hover', '--primary-active', '--on-primary'].forEach((p) => root.style.removeProperty(p));
  }
  document.querySelectorAll('#accentSwatches .accent-swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.accent === document.documentElement.dataset.accent);
  });
}
applyAccent(localStorage.getItem('pf_accent') || 'blue');

// PWA：注册 Service Worker。仅安全上下文（https / http://localhost）生效；
// 局域网 http://<ip>:9989 下 window.isSecureContext 为 false，自动跳过、不报错。
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('pf_theme') || 'dark');
  // v3.4 行密度：恢复上次选择（仅 compact 对 CSS 生效，standard 为默认）
  document.body.dataset.density = localStorage.getItem('pf_row_density') || 'standard';
  // 设置页「外观主题」的明暗开关（顶栏快捷按钮已下线，主题入口在个人菜单与设置页两处）
  const themeSw = document.getElementById('themeSwitch');
  if (themeSw) {
    themeSw.checked = (document.documentElement.dataset.theme === 'dark');
    themeSw.onchange = () => {
      const next = themeSw.checked ? 'dark' : 'light';
      localStorage.setItem('pf_theme', next);
      applyTheme(next);
    };
  }

  applyAccent(localStorage.getItem('pf_accent') || 'blue');
  document.querySelectorAll('#accentSwatches .accent-swatch').forEach((b) => {
    b.onclick = () => {
      applyAccent(b.dataset.accent);
      localStorage.setItem('pf_accent', b.dataset.accent);
    };
  });
  // 铅笔按钮：打开系统取色器；选定颜色后立即应用并记忆（下次点铅笔直接恢复该颜色）
  const cBtn = document.getElementById('accentCustomBtn');
  const cInput = document.getElementById('accentCustom');
  if (cBtn && cInput) {
    cBtn.onclick = () => cInput.click();
    cInput.oninput = () => {
      localStorage.setItem('pf_accent_custom', cInput.value);
      localStorage.setItem('pf_accent', 'custom');
      applyAccent('custom');
    };
  }

});

// ---- 视图路由（hash）：每个常驻视图都有后缀 URL，刷新保持当前路径 ----
// 2026-10-27：新增 rebalance（再平衡）独立页；settings 仍在 VIEWS 内可直达 #/settings，
// 只是不再占据主导航——入口已迁到右上角个人菜单。
// 2026-10-29：设置页过载，把两块高频内容拆成独立页 devices（绑定设备）/ notify（通知推送），
// 同样只在个人菜单里有入口，不占主导航。
const VIEWS = ['home', 'invest', 'asset', 'finance', 'rebalance', 'settings', 'devices', 'notify'];

// ==== 再平衡页状态与配色（声明必须早于下方同步执行的 applyRoute()，否则 TDZ 报错）====
const RB_CLASS_LABEL = { stock: '股票', fund: '基金', wealth: '理财', cash: '现金' };
// 分类色复用 --cat-*（与资产构成卡同源，同一类别跨页同色）。
// 值以字符串形式注入 style 的 --rb-c，故此处保留 rgba(var(--cat-x), 1) 原样写法。
const RB_CLASS_COLOR = {
  stock: 'rgba(var(--cat-equity), 1)',
  fund: 'rgba(var(--cat-fund), 1)',
  wealth: 'rgba(var(--cat-wealth), 1)',
  cash: 'rgba(var(--cat-cash), 1)',
};
// 圆环「超配那截」的浅色做法：白底 + 55% 类别色两层叠出不透明浅色，
// 而不是给类别色降 alpha —— 降 alpha 在暗色主题下是往背景偏（变暗，看着像缺口），
// 这里要的恰恰是「变浅」。
const RB_LITE_ALPHA = 0.55;
let rbData = null;         // /api/rebalance 最近一次结果
let rbPicked = new Set();  // 本次勾选要执行的类别 key
let rbHistoryLogs = [];
// 本期兑现（2026-10-29）：与 rbData 分开拉。period 只影响兑现卡与 KPI 的收益三张，
// 不重算配置偏离（偏离是「此刻快照」，与区间无关）。
let rbActual = null;
let rbPeriod = 'last';
// 2026-10-20 tab 重构：原 hash 'holdings' 兼容映射到 'invest'（持仓/理财视图）。
function viewFromHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const mapped = h === 'holdings' ? 'invest' : h;
  return VIEWS.includes(mapped) ? mapped : 'home';
}
// 常驻主导航激活态：与路由视图同步
let currentNavView = 'home';
function setActiveNav(view) {
  document.querySelectorAll('#mainNav .nav-pill').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
}
// 隐藏全部常驻视图（列表必须与 VIEWS 一一对应，漏一个就会两页叠着显示）
function hideAllViews() {
  ['homeView', 'holdingsView', 'assetView', 'financeView', 'rebalanceView', 'settingsView', 'devicesView', 'notifyView'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
}
function applyRoute() {
  const v = viewFromHash();
  currentNavView = v;
  setActiveNav(v);
  hideAllViews();
  closeAcctMenu(); // 路由切换时收起个人菜单（同 PanWatch 的 route 变化即关闭）
  if (v === 'home') showHomeView();
  else if (v === 'asset') showAssetView();
  else if (v === 'finance') showFinanceView();
  else if (v === 'rebalance') showRebalanceView();
  else if (v === 'settings') showSettingsView();
  else if (v === 'devices') showDevicesView();
  else if (v === 'notify') showNotifyView();
  else showHoldingsView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function navigate(view) {
  if (!VIEWS.includes(view)) view = 'invest';
  if (location.hash !== '#/' + view) location.hash = '/' + view; // 触发 hashchange → applyRoute
  else applyRoute(); // hash 已一致：幂等应用（重复点击同一导航）
}
window.addEventListener('hashchange', applyRoute);

// ---- 认证层（2026-10-28）：身份由 HttpOnly Cookie 决定，前端不再自报 X-User-Id ----
// 401 → 弹出认领/配对闸门；403+pin_required → 弹操作 PIN 输入框并自动重试一次。
let authState = { authed: false, mode: '', user: null, users: [], read_only: false, has_pin: false };
let authReturnHash = '';   // 进闸门前所在路由，认证成功后回跳
let pinCache = '';         // 本页会话内记住的操作 PIN（仅内存，退出登录即清）
let authReady = false;     // 认证完成前不执行初始路由

async function fetchSession() {
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

const api = async (path, opts = {}) => {
  const run = (pin) => {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (pin) headers['X-Auth-Pin'] = pin;
    return fetch(path, { ...opts, headers, credentials: 'same-origin' });
  };
  let r = await run(pinCache);
  if (r.status === 401) {
    showAuthGate(await fetchSession());
    throw new Error('unauthenticated');
  }
  if (r.status === 403) {
    let d = null;
    try { d = await r.clone().json(); } catch (e) { /* 非 JSON 错误体 */ }
    if (d && d.pin_required) {
      const pin = await promptPIN();
      if (!pin) throw new Error('已取消：该操作需要操作 PIN');
      r = await run(pin);
      if (r.status === 403) toast('操作 PIN 不正确', 'err');
      else pinCache = pin;
    }
  }
  return r;
};

const fmt = (n) => (n == null ? '' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
// 盈亏专用格式：强制 2 位小数 + 显式正负号（如 +432.00 / -18.34 / 0.00）。
// 整数与小数统一成同一「形状」，配合 tabular-nums 按小数点对齐，避免整数(432)比小数(72.42)视觉更窄被看岔。
const fmtPnl = (n) => (n == null ? '' : (n > 0 ? '+' : '') + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// 万位压缩金额：|n| ≥ 1万 → 「x.xx万」（固定 2 位小数），不足万沿用 fmt（千分位）。
// 表格/卡片里长金额占宽过大；压缩后由调用方挂 wanTitle，悬停还原精确值。
const fmtWan = (n) => {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(2) + '万' : fmt(v);
};
// 万位压缩的盈亏版：正数带 + 号（负数自带 -），形状约定与 fmtPnl 一致（tabular-nums 按小数点对齐）
const fmtWanPnl = (n) => (n > 0 ? '+' : '') + fmtWan(n);
// 万位金额悬停精确值：仅 |n| ≥ 1万 时输出 title 属性（prefix 传货币符号），配合 fmtWan 使用；
// 负数符号提到货币符号前（-¥89,000，而不是 ¥-89,000）
const wanTitle = (n, prefix) => {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1e4) return '';
  return ` title="${v < 0 ? '-' : ''}${prefix || ''}${fmt(Math.abs(v))}"`;
};
// money / moneyCur / yuanOf 的万位压缩版（≥1万显示 x.xx万，其余同原函数）
const moneyCurW = (n, cur) => curSymbolJS(cur) + fmtWan(n == null ? 0 : n);
// yuanOfW：万位压缩版（≥1万显示 x.xx万，其余同 yuanOf 原始值）
const yuanOfW = (v) => { const n = Number(v) || 0; return (n < 0 ? '-¥' : '¥') + fmtWan(Math.abs(n)) };
// 带符号货币金额（不做万位压缩）：符号一律提到货币符号之前（-¥89,000，而非 ¥-89,000），0 不带 +。
// 用于表格里的盈亏金额列，避免负数被渲染成「¥-201」这种别扭形状。
const signedCur = (v, cur) => {
  const n = Number(v) || 0;
  return (n < 0 ? '-' : n > 0 ? '+' : '') + curSymbolJS(cur) + fmt(Math.abs(n));
};

// 价格类字段统一截断到 4 位小数，避免 float64 全精度（如 12.34738291）污染输入框与落库。
const round4 = (n) => { const v = Number(n); if (!isFinite(v)) return 0; return Math.round(v * 1e4) / 1e4; };
const round2 = (n) => { const v = Number(n); if (!isFinite(v)) return 0; return Math.round(v * 1e2) / 1e2; };
// 按类别保留小数：股票 / 基金 4 位（美股/部分基金现价与成本价需 4 位精度）、其余 2 位（成本价/昨收/成交价口径）
const roundByCat = (v, cat) => (cat === 'fund' || cat === 'stock' ? round4(v) : round2(v));
function fmtCat(n, cat) { return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: (cat === 'fund' || cat === 'stock') ? 4 : 2 }); }
// 试算 Tab 上下文类别（决定价格输入框保留几位小数），由 prefillAdjCalc 写入
let calcCat = 'stock';
const pct = (n) => (n > 0 ? '+' : '') + (n == null ? '' : n.toFixed(2)) + '%';
// 盈亏颜色统一入口：正=红(up)、负=绿(down)、零=灰(flat)（中国惯例涨红跌绿）。
// 全项目所有盈亏/涨跌幅着色都走这里，消除分散的 > 0 ? 'up' : 'down' 判断。
const clsPnl = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const cat = (c) => (c === 'fund' ? '基金' : '股票');
// 年化口径：单利 年化 = 收益率 × 365 ÷ 持有天数。持有不足 ANN_MIN_DAYS 天一律不外推 ——
// 短期收益线性放大后是个「数值为真、结论无意义」的数（14 天 +8% → +209%，1 天 +1% → +372%），
// 直接显示会误导；改成「—」并用 title 说明原因，比封顶或改成复利（更夸张）都诚实。
const ANN_MIN_DAYS = 30;
function annOf(pct, days) {
  if (pct == null || !isFinite(pct) || !(days > 0)) return { val: null, short: false };
  if (days < ANN_MIN_DAYS) return { val: null, short: true };
  return { val: pct * 365 / days, short: false };
}
const annHint = (short) => (short
  ? `持有不足 ${ANN_MIN_DAYS} 天，不做年化外推（短期收益线性放大后无参考意义）`
  : '单利年化 = 收益率 × 365 ÷ 持有天数');
const annText = (v) => (v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '—');
// 净值/成本价按类别精度显示：基金净值强制 4 位小数，股票保留最多 4 位（美股/部分基金需第 3-4 位），其余按货币默认 2 位。
const fmtNav = (n, category) => {
  if (n == null) return '';
  if (category === 'fund') return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if (category === 'stock') return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
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
let manualClosedRecords = []; // 已平仓页「手动补录」纯记录（不入账），按 kind 归并进持仓/理财表
let sparkCache = {}; // symbol -> 近30个交易日收盘价序列（时间正序），供表格迷你走势线使用；展示时取最近20个（近20日走势）
let cashBalMap = {}; // "sourceID:currency"(小写、存量 rmb 归一为 cny) -> 该(来源,币种)现金子账户余额合计，供「仓位」列算分母；来自 /api/home 的 cash 字段
// 币种归一：存量数据里人民币有 rmb/cny 两种写法，匹配前统一成 cny（前后端 key 必须一致；全站 2026-10-16 起统一 cny/usd/hkd）
const normCur = (c) => { const s = String(c || '').toLowerCase(); return s === 'rmb' ? 'cny' : s; };
// 金额折人民币：usd/hkd 按汇率，其余（cny/rmb）按原值。usdRate/hkdRate 在模块初始化后赋值。
const cnyOf = (v, cur) => (cur === 'usd' ? v * usdRate : cur === 'hkd' ? v * hkdRate : v);
let catFilter = new Set(); // selected categories; empty = all
let mktFilter = new Set(); // selected markets; empty = all
let textFilter = '';        // 文本搜索（名称/代码/备注），配合「/」快捷聚焦
let usdRate = 1;
let hkdRate = 1;
let snapshotDate = '';   // 最近 pnl_daily 快照日期（YYYY-MM-DD）
let monthPnlCNY = 0;     // 本月累计盈亏（CNY 折算）
let monthPnlCny = 0;     // 本月累计盈亏（CNY 原始货币）
let todayRealizedCny = 0; // 今日已实现盈亏（减仓落库，CNY 折算），并入首页「今日盈亏」
let monthPnlUsd = 0;     // 本月累计盈亏（USD 原始货币）
let failedSymbols = {};  // symbol -> 失败原因（刷新失败持久标记）
// table | card；移动端（窄屏）默认卡片视图（表格横向溢出体验差），但不强制——允许用户手动切回表格（可横向滚动）
// 首页主区切换：持仓 / 理财（localStorage 记忆），默认持仓
let homeSection = localStorage.getItem('pf_home_section') || 'holdings';
let homeLoadError = false;  // 首页持仓数据加载失败标记（驱动 alert-triangle 空态）
// Two-level category -> market association (二级筛选).
const CAT_MARKETS = {
  stock: ['沪深', '美股', '港股'],
  fund: ['QDII', '债券', '股票', '商品'],
};
const ALL_MARKETS = [...CAT_MARKETS.stock, ...CAT_MARKETS.fund];

// 基金判定：以是否关联基金代码（linked_symbol）为准，取代已废弃的手动分类字段 category
const isFund = (h) => !!(h && (h.category === 'fund' || (h.linked_symbol && String(h.linked_symbol).trim())));

// 投资页表头工具条状态（复用原型 holding-toolbar 的筛选 chips + 排序下拉）
let holdingsSort = 'mv';        // 持仓排序：mv 市值 | profit 盈亏 | days 持仓天数（点击表头切换，见 renderHoldingsBySource）
let holdingsSortDir = 'desc';   // 排序方向：desc 降序 | asc 升序（再次点击同一表头 toggle）
let wealthCatFilter = '';       // 理财筛选：'' 全部 | nav 净值型 | other 其他
let flowRangeDays = 30;         // 资产页流水区间：7 | 30 | 365
let homeRangeDays = 30;         // 首页净资产走势区间：30 | 90 | 365 | 0(全部)
let homeNetVal = 0;             // 首页净资产走势区间收益率基准（= 净资产）
let homeRateSparkState = null;  // 首页权益曲线 hover 弹框所用序列（日期 / 单日盈亏 / 日均 / 累计 / 成本 / 基准）
// 首页权益曲线主序列：avg 日均（默认）| day 单日原始 | cum 累计。
// 默认给 avg 是因为单日序列正负天天翻（实测 75 天里翻 39 次），画出来就是一条心电图；
// 日均把锯齿压掉，才看得出「这一段整体在赚还是在亏」。
let homeRateMode = 'avg';
let flowTypeFilter = 'all';     // 资产页流水类型：all | in | out | dividend | trade
let assetFlowsCache = [];       // 资产页流水全量缓存（供筛选/区间重渲染，避免重复请求）
let homeRecentFilter = 'all';    // 首页最新流水类型过滤：all | in | out | neutral
let homeRecentFlowsData = [];    // 首页最新流水全量缓存（近 45 天最近 8 笔，供类型过滤重渲染）
let finFlowsCache = [];          // 财务页收支汇总明细缓存（全年流水，供分类折叠下钻）

async function boot() {
  // 认证先行：无有效会话 → 认领/配对闸门（成功后由 onAuthed → enterApp 进入应用）
  const st = await fetchSession();
  if (!st || (!st.authed && st.mode !== 'readonly')) {
    showAuthGate(st);
    return;
  }
  await enterApp(st);
}

// 认证通过后的统一入口：解析账本 → 显示应用 → 按当前 hash 渲染视图
async function enterApp(st) {
  authState = st || authState;
  authReady = true;
  try { await initUser(); } catch (e) { console.warn('[user] initUser 失败:', e); }
  showApp();
  applyRoute();
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

// 理财总览数据（/api/asset/overview）：首页总市值卡「理财」段与首页理财视图共用。
// 只赋值 assetData，不触发资产页渲染（renderAssetTab 仅资产页需要）。
async function fetchOverview() {
  try {
    const r = await api('/api/asset/overview');
    if (r.ok) assetData = await r.json();
  } catch (_) { /* 理财数据失败不阻塞首页：总市值卡降级为仅持仓 */ }
}

async function load() {
  try {
    homeLoadError = false;
    // 首屏数据合并为单次请求：/api/home 聚合 holdings/summary/fx/sources/spark，
    // 消除原先 4~5 个请求的瀑布，缩短首屏视觉完成时间（Speed Index 瓶颈）。
    // 并行拉取资产总览（理财总额/产品列表），供总市值卡「理财」段与首页理财视图使用。
    const [r] = await Promise.all([api('/api/home'), fetchOverview()]);
    if (!r.ok) { toast('加载失败 (HTTP ' + r.status + ')', 'err'); return; }
    const hd = await r.json();
    usdRate = hd.rate || 1;
    hkdRate = hd.hkd_rate || 1;
    // 汇率条（renderFx）已随首页 market-bar 整体下线（2026-10-09），/api/home 的 fx 字段保留但前端不再渲染。
    allHoldings = hd.holdings || [];
    assetSources = hd.sources || [];
    sparkCache = hd.spark || {};
    cashBalMap = hd.cash || {};
    snapshotDate = hd.snapshot_date || '';
    monthPnlCNY = hd.month_pnl_cny || 0;
    monthPnlCny = hd.month_pnl_cny_ccy || 0;
    monthPnlUsd = hd.month_pnl_usd || 0;
    todayRealizedCny = hd.today_realized_cny || 0;
    buildFilters();
    await loadManualClosed(); // 已平仓页手动补录记录（不入账）
    await loadCustomFlowCats(); // 自定义收支分类（设置页维护，选择器/统计共用）
    await loadDeposits(); // 存款列表（首页「存款」分段）
    renderFiltered();
    loadCashflow(); // 首页紧凑卡片：本月收支计划（不阻塞主渲染）
    // 首屏数据就绪后，重渲染依赖 overview 的常驻视图（首页净资产/资产分布依赖 assetData；财务概览重渲染幂等）
    const _v = viewFromHash();
    if (_v === 'home') showHomeView();
    else if (_v === 'finance') showFinanceView();
  } catch (e) {
    homeLoadError = true;
    toast('加载异常：' + e.message, 'err');
    renderFiltered(); // 刷新空态为 alert-triangle（若有持仓区在视图内）
  }
}

// 已平仓页「手动补录」纯记录：与持仓/现金完全隔离，仅用于补登系统外发生的平仓。
async function loadManualClosed() {
  try {
    const r = await api('/api/manual-closed');
    if (r.ok) {
      const d = await r.json();
      manualClosedRecords = (d && d.records) || [];
    }
  } catch (_) { /* 手动记录加载失败不阻塞主流程 */ }
}

// 已平仓视图回退（撤销清仓/重开）后：重新拉取持仓与理财，刷新已平仓视图。
async function refreshClosedData() {
  try {
    const [r] = await Promise.all([api('/api/home'), fetchOverview()]);
    if (r.ok) {
      const hd = await r.json();
      allHoldings = hd.holdings || [];
      assetSources = hd.sources || [];
    }
  } catch (_) {}
  await loadManualClosed();
  if (homeSection === 'closed') renderFiltered();
}

// 撤销清仓/重开持仓（已平仓视图「回退」按钮）：用清仓前快照还原份额与成本。
// 会还原份额/成本并重新计入总资产，走项目通用确认弹框（#confirmModal）后再执行。
async function reopenHoldingRow(id) {
  openConfirm({
    title: '撤销清仓',
    msg: '将用清仓前快照还原该持仓的份额与成本价，并重新计入总资产。是否继续？',
    okText: '回退', danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/holdings/' + id + '/reopen', { method: 'POST' });
        if (!r.ok) { let m = '回退失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
        await refreshClosedData();
        toast('已撤销清仓，持仓已恢复', 'ok');
      } catch (e) { toast('异常：' + e.message, 'err'); }
    },
  });
}

// 行情时效性标识（renderFreshness/更新时间行）已随首页 market-bar 整体下线（2026-10-09）。

// Holdings after applying the two-level (category + market) filter.
function filteredHoldings() {
  const kw = textFilter;
  return allHoldings.filter((h) => {
    if (catFilter.size && !catFilter.has(h.category)) return false;
    // 市场筛选仅在选定了具体类别（市场行可见）时生效：全不勾选 → 空集 → 无数据；全勾选 → 全部。
    if (catFilter.size && !mktFilter.has(h.market)) return false;
    if (kw) {
      // 搜索框按「名称 / 代码」过滤（首页 #homeFilterInput 绑定 textFilter）
      const hay = ((h.name || '') + ' ' + (h.symbol || '')).toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

// Render both the summary cards and the table from the currently filtered set,
// so statistics follow the category + market filter.

// Convert a holding's CNY-equivalent value (USD/HKD holdings scaled by exchange rate).
function toRmb(h, v) {
  // toUpperCase 容错：历史数据 'usd'/'USD' 混写，严格比较会把小写美元当人民币（漏乘汇率）
  if ((h.currency || '').toUpperCase() === 'USD') return (v || 0) * usdRate;
  if ((h.currency || '').toUpperCase() === 'HKD') return (v || 0) * hkdRate;
  return v || 0;
}

// 市值外币值悬停提示（表格列：主显 CNY，悬停显示精确值）：
// 市值压缩为「x.xx万」时悬停还原精确人民币金额；非 CNY 币种追加原币种金额，两者都有时用｜分隔
function mvOrigTitle(h) {
  const cur = (h.currency || 'cny').toLowerCase();
  const mvCny = toRmb(h, h.market_value);
  const parts = [];
  if (Math.abs(mvCny) >= 1e4) parts.push('¥' + fmt(mvCny));
  if (cur !== 'cny' && cur !== 'rmb') parts.push('原币种市值 ' + curSymbolJS(h.currency) + fmt(h.market_value || 0));
  return parts.length ? ` title="${parts.join('｜')}"` : '';
}

// v3.4 空状态线条插画（120×120，stroke 随主题色 currentColor，由 CSS 控制尺寸）
const EMPTY_ICONS = {
  inbox: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 66h13l5 9h40l5-9h13"/><path d="M30 38h60l9 24v18a5 5 0 0 1-5 5H26a5 5 0 0 1-5-5V62l9-24Z"/><path d="M44 38V30a16 16 0 0 1 32 0v8"/></svg>',
  searchX: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="50" cy="50" r="24"/><path d="M68 68l22 22"/><path d="M42 42l16 16M58 42l-16 16"/></svg>',
  alert: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M60 32L96 96H24L60 32Z"/><path d="M60 54v22"/><path d="M60 86v3"/></svg>',
  wallet: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="22" y="38" width="76" height="50" rx="8"/><path d="M22 54h76"/><circle cx="80" cy="63" r="6"/><path d="M98 46v34a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6V44a6 6 0 0 1 6-6h54"/></svg>',
  bank: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 46h80"/><path d="M28 46V34h64v12"/><path d="M38 46v26M60 46v26M82 46v26"/><path d="M18 82h84"/></svg>',
  plan: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="26" y="34" width="68" height="60" rx="8"/><path d="M26 52h68"/><path d="M44 26v12M76 26v12"/><path d="M48 66l8 8 16-18"/></svg>',
  deposit: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="24" y="44" width="72" height="44" rx="6"/><path d="M24 60h72"/><circle cx="60" cy="60" r="9"/><path d="M42 34V26a6 6 0 0 1 6-6h24a6 6 0 0 1 6 6v8"/></svg>',
};

// 统一空状态模板：icon（EMPTY_ICONS）+ 标题 + 描述 + 主按钮，与持仓页 #holdingsEmpty 同款样式（.empty-state）。
function emptyStateHTML({ icon, title, desc, btnLabel, btnAttrs }) {
  return '<div class="empty-state">'
    + '<div class="empty-icon" aria-hidden="true">' + icon + '</div>'
    + '<h3 class="empty-title">' + title + '</h3>'
    + '<p class="empty-desc">' + desc + '</p>'
    + '<button class="btn primary" type="button"' + (btnAttrs ? ' ' + btnAttrs : '') + '>' + btnLabel + '</button>'
    + '</div>';
}

function renderFiltered() {
  const hs = filteredHoldings();
  renderSummary(hs);
  const desc = document.getElementById('tblDesc');
  const empty = document.getElementById('holdingsEmpty');
  const srcBox = document.getElementById('holdingsBySource');
  const metaBar = document.querySelector('.tbl-meta-bar');
  const wl = document.getElementById('homeWealthBox');
  const vt = document.getElementById('viewToggle');
  const closedBox = document.getElementById('closedView');
  const toolbar = document.getElementById('investToolbar');

  if (metaBar) metaBar.hidden = false;
  // 数量已并入分段控件徽标（原型风格），左侧描述留空避免重复
  if (desc) desc.hidden = true;

  // 每个 tab 有自己的 KPI 口径（持仓看市值/今日/本月/收益率，平仓看落袋，理财看收益/年化，
  // 存款看本金/利息/到期）。但**不能只隐藏不补位**——那样下方内容整体上移，切 tab 会有
  // 明显跳变。改为四块 KPI 在同一位置互换（结构一致、卡片数一致、高度对齐）。
  // 四个 tab 共用同一块顶部区域：只切换显隐，内容等高（眉标 + 4 张 .kpi-card），
  // 因此切换时下方内容不会位移。新增 tab 只需在这里加一项。
  const heroBySection = {
    holdings: document.getElementById('investHero'),
    closed: document.getElementById('closedHero'),
    wealth: document.getElementById('wealthHero'),
    deposits: document.getElementById('depositHero'),
  };
  for (const key of Object.keys(heroBySection)) {
    const el = heroBySection[key];
    if (el) el.hidden = (homeSection !== key);
  }

  // 分段控件数量徽标：持仓 = 当前筛选后持仓数；理财 = 理财条目数；存款 = 存款条数；已平仓 = 清仓持仓数 + 清合理财数
  const wProducts = (assetData.wealth || {}).products || [];
  const wCount = wProducts.length;
  const closedHoldings = allHoldings.filter((h) => (h.quantity || 0) <= 0);
  const closedWealth = wProducts.filter((p) => p.archived);
  const closedCount = closedHoldings.length + closedWealth.length;
  if (vt) {
    const hb = vt.querySelector('[data-count="holdings"]');
    const wb = vt.querySelector('[data-count="wealth"]');
    const db3 = vt.querySelector('[data-count="deposits"]');
    const cb = vt.querySelector('[data-count="closed"]');
    if (hb) hb.textContent = hs.length;
    if (wb) wb.textContent = wCount;
    if (db3) db3.textContent = (depositsCache || []).length;
    if (cb) cb.textContent = closedCount;
  }

  // 已平仓视图：隐藏持仓/理财/表头工具条，显示落袋收益汇总
  if (homeSection === 'closed') {
    if (srcBox) srcBox.hidden = true;
    if (wl) wl.hidden = true;
    const depBoxC = document.getElementById('homeDepositBox');
    if (depBoxC) depBoxC.hidden = true;
    if (empty) empty.hidden = true;
    if (toolbar) { toolbar.hidden = false; renderClosedToolbar(toolbar); }
    if (closedBox) { closedBox.hidden = false; renderClosed(closedBox, closedHoldings, closedWealth); }
    return;
  }

  // 恢复表头工具条（非 closed 视图）
  if (vt) vt.hidden = false;
  if (toolbar) toolbar.hidden = false;
  renderInvestToolbar();

  // 存款视图：隐藏持仓/理财区，主区域显示存款表格（renderDeposits）
  if (homeSection === 'deposits') {
    if (srcBox) srcBox.hidden = true;
    if (empty) empty.hidden = true;
    if (closedBox) closedBox.hidden = true;
    if (wl) wl.hidden = true;
    const depBox = document.getElementById('homeDepositBox');
    if (depBox) { depBox.hidden = false; renderDeposits(depBox); }
    return;
  }

  // 理财视图：隐藏持仓区，主区域显示理财管理区（表格视图，已移除卡片展示）
  if (homeSection === 'wealth') {
    if (srcBox) srcBox.hidden = true;
    if (empty) empty.hidden = true;
    if (closedBox) closedBox.hidden = true;
    // 存款盒必须一并隐藏：从「存款」切回「理财」时它不会自动收起（曾残留整张存款表）
    const depBoxW = document.getElementById('homeDepositBox');
    if (depBoxW) depBoxW.hidden = true;
    if (wl) { wl.hidden = false; renderWealth(wl); }
    return;
  }

  // 持仓视图（默认）：隐藏理财区，按来源分组表展示（已移除卡片展示）
  if (wl) wl.hidden = true;
  if (closedBox) closedBox.hidden = true;
  const depBox2 = document.getElementById('homeDepositBox');
  if (depBox2) depBox2.hidden = true;
  if (srcBox) { srcBox.hidden = false; renderHoldingsBySource(hs); }
  if (empty) {
    const emptyIcon = document.getElementById('emptyIcon');
    const emptyTitle = document.getElementById('emptyTitle');
    const emptyMsg = document.getElementById('emptyMsg');
    const emptyAddBtn = document.getElementById('emptyAddBtn');
    if (allHoldings.length === 0) {
      // 加载失败（数据未就绪）与「真的无持仓」共用 alert-triangle / inbox 两态
      if (homeLoadError) {
        if (emptyIcon) emptyIcon.innerHTML = EMPTY_ICONS.alert;
        if (emptyTitle) emptyTitle.textContent = '加载失败';
        if (emptyMsg) emptyMsg.textContent = '数据加载异常，请稍后重试或检查网络。';
        if (emptyAddBtn) emptyAddBtn.hidden = true;
      } else {
        if (emptyIcon) emptyIcon.innerHTML = EMPTY_ICONS.inbox;
        if (emptyTitle) emptyTitle.textContent = '还没有任何持仓';
        if (emptyMsg) emptyMsg.textContent = '添加第一笔开始记录吧。';
        if (emptyAddBtn) emptyAddBtn.hidden = false;
      }
      empty.hidden = false;
    } else if (hs.length === 0) {
      // 区分「全部已清仓」与「筛选无匹配」：前者是正常状态（列表仅隐藏 0 份额持仓）
      const allClosed = allHoldings.length > 0 && allHoldings.every((h) => (h.quantity || 0) <= 0);
      if (allClosed) {
        if (emptyIcon) emptyIcon.innerHTML = EMPTY_ICONS.inbox;
        if (emptyTitle) emptyTitle.textContent = '全部持仓已清仓';
        if (emptyMsg) emptyMsg.textContent = '列表暂无可持仓标的；重新买入后会自动恢复显示，已落袋盈亏已计入首页「今日盈亏」。';
      } else {
        if (emptyIcon) emptyIcon.innerHTML = EMPTY_ICONS.searchX;
        if (emptyTitle) emptyTitle.textContent = '无匹配结果';
        if (emptyMsg) emptyMsg.textContent = '当前筛选条件下没有匹配的持仓，请调整筛选。';
      }
      if (emptyAddBtn) emptyAddBtn.hidden = true;
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
  }
}

// 已平仓汇总视图：持仓(quantity<=0) + 理财(archived=1) 的系统归集，合并「手动补录」纯记录（不入账）。
// 列：名称 / 代码 / 类型 / 盈亏金额 / 盈亏% / 年化% / 来源 / 清仓时间 / 天数 / 操作（已取消「本金」列）。
// 类型口径 = 资产类别（股票 / 基金 / 理财）：系统持仓按是否关联基金代码区分，手动补录按记录里的类型。
// 系统记录可「回退」（撤销清仓/重开）；手动补录可「编辑 / 删除」。
function renderClosed(box, closedHoldings, closedWealth) {
  // 手动补录按类型归并：wealth 属理财表，stock / fund 属证券表（历史 hold 按股票处理）
  const mHold = manualClosedRecords.filter((m) => normManKind(m.kind) !== 'wealth');
  const mWealth = manualClosedRecords.filter((m) => normManKind(m.kind) === 'wealth');

  const hCount = closedHoldings.length + mHold.length;
  const wCount = closedWealth.length + mWealth.length;
  const totalCount = hCount + wCount;

  // 汇总 KPI（系统 + 手动补录合并统计落袋）
  // 手动补录的盈亏可能记在 HKD / USD，汇总统一折 CNY（与持仓、理财页同一口径）
  const mcToCny = (m) => {
    const c = normCurJS(m.currency);
    const v = Number(m.amount) || 0;
    return c === 'usd' ? v * usdRate : c === 'hkd' ? v * hkdRate : v;
  };
  let hTotalDays = 0, hTotalRealized = 0, wTotalDays = 0, wTotalPnl = 0;
  closedHoldings.forEach((h) => { hTotalDays += ((h.closed_date && h.buy_date) ? daysBetween(h.buy_date, h.closed_date) : (h.holding_days || 0)); hTotalRealized += (Number(h.realized_pnl) || 0); });
  mHold.forEach((m) => { hTotalDays += (Number(m.holding_days) || 0); hTotalRealized += mcToCny(m); });
  closedWealth.forEach((w) => { wTotalDays += (w.holding_days || 0); wTotalPnl += (Number(w.cum_pnl) || 0); });
  mWealth.forEach((m) => { wTotalDays += (Number(m.holding_days) || 0); wTotalPnl += mcToCny(m); });
  const hAvgDays = hCount ? Math.round(hTotalDays / hCount) : 0;
  const wAvgDays = wCount ? Math.round(wTotalDays / wCount) : 0;
  const grandTotal = hTotalRealized + wTotalPnl;

  // 逐笔明细：胜率/平均持有/统计区间共用。金额为 0 的记录不进胜率分母（补录可能只填 0）。
  // cls = 类型口径（stock 股票 / fund 基金 / wealth 理财），供「胜率」卡底部分类胜率使用。
  const ctRows = [
    ...closedHoldings.map((h) => ({ amt: Number(h.realized_pnl) || 0, days: (h.closed_date && h.buy_date) ? daysBetween(h.buy_date, h.closed_date) : (h.holding_days || 0), date: h.closed_date || '', cls: isFund(h) ? 'fund' : 'stock' })),
    ...mHold.map((m) => ({ amt: Number(m.amount) || 0, days: Number(m.holding_days) || 0, date: m.realized_at || '', cls: normManKind(m.kind) })),
    ...closedWealth.map((w) => ({ amt: Number(w.cum_pnl) || 0, days: Number(w.holding_days) || 0, date: w.snap_date || '', cls: 'wealth' })),
    ...mWealth.map((m) => ({ amt: Number(m.amount) || 0, days: Number(m.holding_days) || 0, date: m.realized_at || '', cls: 'wealth' })),
  ];
  const winN = ctRows.filter((r) => r.amt > 0).length;
  const lossN = ctRows.filter((r) => r.amt < 0).length;
  const flatN = ctRows.length - winN - lossN;
  const winRate = (winN + lossN) > 0 ? Math.round(winN / (winN + lossN) * 100) : null;
  // 分类胜率：只在有输赢样本时给数（0 笔或全平仓 → 「—」）
  const classWinRate = (cls) => {
    const rows = ctRows.filter((r) => r.cls === cls);
    const w = rows.filter((r) => r.amt > 0).length;
    const l = rows.filter((r) => r.amt < 0).length;
    return (w + l) > 0 ? Math.round(w / (w + l) * 100) + '%' : '—';
  };
  const stockWin = classWinRate('stock');
  const fundWin = classWinRate('fund');
  const dayList = ctRows.map((r) => r.days).filter((d) => d > 0);
  const avgDays = dayList.length ? Math.round(dayList.reduce((a, b) => a + b, 0) / dayList.length) : 0;
  const manN = mHold.length + mWealth.length;

  // 汇总卡：走项目统一 KPI 体系（锚点卡承载主数字，其余三张为卫星指标）。
  // 渲染目标是顶部 #closedKpiBody（与持仓 KPI 同一块区域互换显示），眉标在
  // index.html 的 #closedHero 里，此处只产出卡片行。
  const summaryRow = `<div class="kpi-row cols-anchor">
      <div class="kpi-card density-standard anchor">
        <div class="kpi-icon ${grandTotal >= 0 ? 'kpi-ico-up' : 'kpi-ico-down'}"><svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></div>
        <div class="kpi-label">落袋合计</div>
        <div class="kpi-main"><div class="kpi-value ${clsPnl(grandTotal)}">${grandTotal > 0 ? '+' : ''}${yuanOfW(grandTotal)}</div></div>
        <div class="kpi-sub">持仓 <span class="hl">${yuanOfW(hTotalRealized)}</span> · 理财 <span class="hl">${yuanOfW(wTotalPnl)}</span></div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
        <div class="kpi-label">清仓笔数</div>
        <div class="kpi-main"><div class="kpi-value">${ctRows.length}</div></div>
        <div class="kpi-sub">持仓 ${hCount} · 理财 ${wCount}${manN ? ` · 补录 ${manN}` : ''}</div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-pct"><svg viewBox="0 0 24 24"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg></div>
        <div class="kpi-label">胜率</div>
        <div class="kpi-main"><div class="kpi-value">${winRate === null ? '—' : winRate + '%'}</div></div>
        <div class="kpi-sub">盈 <span class="hl">${winN}</span> · 亏 <span class="hl">${lossN}</span>${flatN ? ` · 平 ${flatN}` : ''}</div>
        <div class="kpi-sub kpi-sub-split">股票 <span class="hl">${stockWin}</span> · 基金 <span class="hl">${fundWin}</span></div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg></div>
        <div class="kpi-label">平均持有</div>
        <div class="kpi-main"><div class="kpi-value">${avgDays || '—'}${avgDays ? '<span class="kpi-unit">天</span>' : ''}</div></div>
        <div class="kpi-sub">持仓 ${hAvgDays} 天 · 理财 ${wAvgDays} 天</div>
      </div>
  </div>`;

  // KPI 落到顶部固定位置：无论有无记录都渲染（空数据时为零值/「—」），
  // 保证在「平仓 ↔ 持仓」之间切换时顶部高度恒定，不产生跳变。
  const kpiEl = document.getElementById('closedKpiBody');
  if (kpiEl) kpiEl.innerHTML = summaryRow;

  if (totalCount === 0) {
    box.innerHTML = `<div class="closed-empty">
      <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="closed-empty-icon"><circle cx="60" cy="60" r="36"/><path d="M40 58l14 14 26-28"/></svg>
      <h3 class="empty-title">暂无已平仓记录</h3>
      <p class="empty-desc">清仓后标的会保留历史数据自动归入此视图；系统外的平仓可在首页「快捷功能 · 新增平仓」补录。</p>
    </div>`;
    return;
  }

  // —— 按账户(来源)分组折叠展示（效果同持仓表）：取消「年化% / 清仓时间 / 来源」列，
  // 来源即分组账户；盈亏率由组头汇总（本金缺失的账户不展示盈亏率）。——
  const rows = [];
  closedHoldings.forEach((h) => {
    const principal = Number(h.invested_cost) || Number(h.cost_value) || 0;
    const realized = Number(h.realized_pnl) || 0;
    const days = (h.closed_date && h.buy_date) ? daysBetween(h.buy_date, h.closed_date) : (h.holding_days || 0);
    const pct = principal > 0 ? realized / principal * 100 : null;
    rows.push({ ctType: isFund(h) ? 'fund' : 'stock', sys: true, sysKind: 'hold', id: h.id, name: h.name, code: h.symbol || '', source: (h.source_name || '').trim() || '未指定', amount: realized, currency: normCurJS(h.currency), principal, pct, days, op: (h.closed ? actBtn('undo', `data-reopen-hold="${h.id}"`, '撤销清仓（重开持仓）') : '<span class="u-muted">—</span>') });
  });
  mHold.forEach((m) => {
    const amt = Number(m.amount) || 0;
    const principal = m.principal != null ? Number(m.principal) : 0;
    const days = Number(m.holding_days) || 0;
    const pct = m.return_rate != null ? Number(m.return_rate) : (principal > 0 ? amt / principal * 100 : null);
    rows.push({ ctType: normManKind(m.kind), sys: false, id: m.id, name: m.name, code: m.code || '', source: (m.source || '').trim() || '未指定', amount: amt, currency: normCurJS(m.currency), principal, pct, days, op: actBtn('edit', `data-edit-manual="${m.id}"`, '编辑') + actBtn('del', `data-del-manual="${m.id}"`, '删除', { danger: true }) });
  });
  closedWealth.forEach((w) => {
    const cumPnl = Number(w.cum_pnl) || 0;
    const days = w.holding_days || 0;
    const pct = w.cum_return_rate != null ? w.cum_return_rate : null;
    rows.push({ ctType: 'wealth', sys: true, sysKind: 'wealth', id: w.id, name: w.name, code: w.code || '', source: (w.source_name || '').trim() || '未指定', amount: cumPnl, currency: normCurJS(w.currency), principal: null, pct, days, op: actBtn('undo', `data-reopen-wealth="${w.id}"`, '重开理财') });
  });
  mWealth.forEach((m) => {
    const amt = Number(m.amount) || 0;
    const principal = m.principal != null ? Number(m.principal) : 0;
    const days = Number(m.holding_days) || 0;
    const pct = m.return_rate != null ? Number(m.return_rate) : (principal > 0 ? amt / principal * 100 : null);
    rows.push({ ctType: 'wealth', sys: false, id: m.id, name: m.name, code: m.code || '', source: (m.source || '').trim() || '未指定', amount: amt, currency: normCurJS(m.currency), principal, pct, days, op: actBtn('edit', `data-edit-manual="${m.id}"`, '编辑') + actBtn('del', `data-del-manual="${m.id}"`, '删除', { danger: true }) });
  });

  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.source)) groups.set(r.source, { name: r.source, items: [], pnlCny: 0, principalCny: 0, daySum: 0, dayN: 0 });
    const g = groups.get(r.source);
    g.items.push(r);
    g.pnlCny += cnyOf(r.amount, r.currency);
    if (r.principal) g.principalCny += cnyOf(r.principal, r.currency);
    if (r.days > 0) { g.daySum += r.days; g.dayN++; }
  }
  const arr = [...groups.values()].sort((a, b) => b.pnlCny - a.pnlCny);

  let html = '';
  for (const g of arr) {
    const gpct = g.principalCny > 0 ? g.pnlCny / g.principalCny * 100 : null;
    html += `<div class="collapsible source-group closed-group" data-src="${esc(g.name)}">
      <div class="collapse-hat holdings-group-head">
        <span class="hat-title">${accountLogo(g.name)} ${esc(g.name)} <span class="hat-count">${g.items.length} 笔</span></span>
        <span class="hat-side">
          <span class="hat-stat hat-stat-mv" title="该账户落袋盈亏（折合人民币）"><span class="hat-stat-lbl">落袋</span><b class="${clsPnl(g.pnlCny)}"${wanTitle(g.pnlCny, '¥')}>${g.pnlCny >= 0 ? '+' : ''}¥${fmtWan(g.pnlCny)}</b></span>
          ${gpct != null ? `<span class="hat-side-extra" title="该账户盈亏率（落袋 ÷ 本金）"><span class="hat-stat" title="该账户盈亏率"><span class="hat-stat-lbl">盈亏率</span><b class="${clsPnl(gpct)}"${wanTitle(gpct, '%')}>${gpct >= 0 ? '+' : ''}${gpct.toFixed(2)}%</b></span></span>` : ''}
          <span class="hat-chevron">▾</span>
        </span>
      </div>
      <div class="collapse-body source-group-body">
        <div class="subtable-wrap"><table class="closed-table">
          <thead><tr>
            <th class="ct-name">名称</th>
            <th class="ct-code-col">代码</th>
            <th>类型</th>
            <th class="num">盈亏金额</th>
            <th class="num">盈亏%</th>
            <th class="num">天数</th>
            <th class="ct-ops">操作</th>
          </tr></thead>
          <tbody>${g.items.map(rowClosed).join('')}</tbody>
        </table></div>
      </div></div>`;
  }

  box.innerHTML = html;
  bindClosedActions(box);
}

// 已平仓分组子表行模板：名称 / 代码 / 类型 / 盈亏金额 / 盈亏% / 天数 / 操作
// （已取消 年化% / 清仓时间 / 来源 列 —— 来源即分组账户，盈亏率由组头汇总）
function rowClosed(r) {
  const pctTxt = r.pct != null ? (r.pct >= 0 ? '+' : '') + r.pct.toFixed(2) + '%' : '—';
  const pctCls = r.pct != null ? clsPnl(r.pct) : 'flat';
  const labelMap = { stock: '股票', fund: '基金', wealth: '理财' };
  const typeCls = { stock: 'ct-type-stock', fund: 'ct-type-fund', wealth: 'ct-type-wealth' }[r.ctType];
  return `<tr class="ct-row ${r.sys ? (r.sysKind === 'wealth' ? 'ct-row-w' : 'ct-row-h') : 'ct-row-m'}" data-ct-type="${r.ctType}">
    <td class="ct-name"><span class="name-clickable" title="${esc(r.name)}（${r.sys ? '已清仓' : '手动补录'}）">${esc(r.name)}</span></td>
    <td class="ct-code-col">${r.code ? esc(r.code) : '—'}</td>
    <td><span class="ct-type ${typeCls}">${labelMap[r.ctType]}</span></td>
    <td class="ct-num ${clsPnl(r.amount)}">${signedCur(r.amount, r.currency)}</td>
    <td class="ct-num ${pctCls}">${pctTxt}</td>
    <td class="ct-num">${r.days || '—'}</td>
    <td class="ct-ops">${r.op}</td>
  </tr>`;
}

// 已平仓「类型」筛选与统计区间已于 2026-10-28 移除（类型筛选按钮、统计区间提示均下线）。

// 已平仓表格行内操作（事件委托，重渲染后按钮仍生效）
function bindClosedActions(box) {
  box.querySelectorAll('[data-reopen-hold]').forEach((b) => { b.onclick = () => reopenHoldingRow(Number(b.dataset.reopenHold)); });
  box.querySelectorAll('[data-reopen-wealth]').forEach((b) => {
    b.onclick = () => {
      const wid = Number(b.dataset.reopenWealth);
      // 与「回退」同一口径：恢复录入并重新计入总资产，先确认后执行
      openConfirm({
        title: '重开理财',
        msg: '将恢复该理财的每日持仓录入，并重新计入总资产。是否继续？',
        okText: '重开', danger: true,
        onOk: async () => {
          await enableWealthRow(wid); // 重开理财（archived=0，复用既有 enable）
          if (homeSection === 'closed') renderFiltered();
        },
      });
    };
  });
  box.querySelectorAll('[data-edit-manual]').forEach((b) => {
    b.onclick = () => {
      const m = manualClosedRecords.find((x) => x.id === Number(b.dataset.editManual));
      if (m) openClosedRecordModal(m);
    };
  });
  box.querySelectorAll('[data-del-manual]').forEach((b) => {
    b.onclick = () => {
      const id = Number(b.dataset.delManual);
      const m = manualClosedRecords.find((x) => x.id === id);
      openConfirm({
        title: '删除已平仓记录',
        msg: '确认删除「' + (m ? m.name : '#' + id) + '」这条纯记录？不可恢复。',
        okText: '删除', danger: true,
        onOk: async () => {
          const r = await api('/api/manual-closed/' + id, { method: 'DELETE' });
          if (!r.ok) { let e2 = '删除失败'; try { const d = await r.json(); if (d && d.error) e2 = d.error; } catch (_) {} toast(e2, 'err'); return; }
          await loadManualClosed();
          if (homeSection === 'closed') renderFiltered();
          toast('已删除', 'ok');
        },
      });
    };
  });
}

function renderInvestToolbar() {
  const bar = document.getElementById('investToolbar');
  if (!bar) return;
  // 存款视图：没有筛选 / 排序 / 密度切换，但这一行不能空着 ——
  // 右侧放一句当前最有行动价值的信息（到期待落袋），空行会把上方 KPI 和下方表格隔开显得断裂。
  if (homeSection === 'deposits') {
    const list = depositsCache || [];
    const pending = list.filter((d) => d.status !== 'settled' && d.matured);
    bar.innerHTML = pending.length
      ? '<div class="toolbar-gain right">已到期待落袋 <b>' + pending.length + '</b> 笔 · 行内点「确认落袋」把本金+利息入账</div>'
      : '<div class="toolbar-gain right">共 <b>' + list.length + '</b> 笔 · 预计利息按「年利率 × 天数 / 365」估算</div>';
    return;
  }
  if (homeSection === 'wealth') {
    // 累计收益已上移到顶部理财 KPI 卡，工具条只留分类 chips（避免同一数字出现两次）。
    // 注意：不能带 .keep-space —— 那个类只用于占位，会 visibility:hidden 把可点的筛选器藏掉。
    bar.innerHTML =
      '<div class="filter-group" id="wealthCatChips">' +
        toolbarChip('', '全部', wealthCatFilter === '') +
        toolbarChip('nav', '净值型', wealthCatFilter === 'nav') +
        toolbarChip('other', '其他', wealthCatFilter === 'other') +
      '</div>';
    bar.querySelectorAll('.filter-chip').forEach((b) => {
      b.onclick = () => { wealthCatFilter = b.dataset.cat; renderInvestToolbar(); renderWealth(document.getElementById('homeWealthBox')); };
    });
    return;
  }
  // 持仓态：类别筛选（catFilter 按 h.category）+ 排序下拉
  const dens = localStorage.getItem('pf_row_density') || 'standard';
  bar.innerHTML =
    '<div class="filter-group" id="catChips">' +
      toolbarChip('', '全部', catFilter.size === 0) +
      toolbarChip('stock', '股票', catFilter.has('stock')) +
      toolbarChip('fund', '基金', catFilter.has('fund')) +
      toolbarChip('etf', 'ETF', catFilter.has('etf')) +
      toolbarChip('bond', '债券', catFilter.has('bond')) +
    '</div>' +
    '<div class="toolbar-right">' +
      '<div class="density-toggle" role="group" aria-label="行密度">' +
        '<button type="button" class="dt-btn' + (dens === 'compact' ? ' active' : '') + '" data-density="compact">紧凑</button>' +
        '<button type="button" class="dt-btn' + (dens === 'standard' ? ' active' : '') + '" data-density="standard">标准</button>' +
      '</div>' +
      '<button type="button" class="inv-refresh-btn" id="invRefreshBtn" title="刷新行情（补刷漏更新的持仓数据）" aria-label="刷新行情"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>' +
    '</div>';
  bar.querySelectorAll('.filter-chip').forEach((b) => {
    b.onclick = () => { catFilter = new Set(b.dataset.cat ? [b.dataset.cat] : []); renderInvestToolbar(); renderFiltered(); };
  });
  // v3.4 行密度切换：记忆到 localStorage，仅切 body[data-density]，CSS 实时生效（无需重渲染）
  bar.querySelectorAll('.dt-btn').forEach((b) => {
    b.onclick = () => {
      const d = b.dataset.density;
      localStorage.setItem('pf_row_density', d);
      document.body.dataset.density = d;
      bar.querySelectorAll('.dt-btn').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  // 持仓工具条「刷新行情」按钮：手动补刷漏更新的行情/当日盈亏（系统重启、断网等导致定时快照漏跑时）
  const rfb = bar.querySelector('#invRefreshBtn');
  if (rfb) rfb.onclick = () => refreshHoldingsQuotes(rfb);
}

// 投资页持仓工具条「刷新」按钮：手动触发行情刷新 + 当日盈亏快照。
// 后端 /api/refresh 复用定时快照的 refreshAllQuotes：刷新全部持仓现价/汇率并重算当日 P&L。
// 点击刷新按钮：先弹确认框（含 N 天回朔输入），确认后再真正拉取行情
let refreshBtnRef = null; // 记住触发刷新的按钮，刷新完成后恢复其状态
function refreshHoldingsQuotes(btn) {
  refreshBtnRef = btn || null;
  const input = document.getElementById('refreshDays');
  if (input && !input.value) input.value = '20';
  $('#refreshConfirmModal').hidden = false;
}

async function doRefresh() {
  const modal = $('#refreshConfirmModal');
  const input = document.getElementById('refreshDays');
  let days = parseInt(input.value, 10);
  if (!isFinite(days) || days < 1) days = 1;
  if (days > 120) days = 120;
  input.value = String(days);
  modal.hidden = true;
  const btn = refreshBtnRef;
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
  try {
    const r = await api('/api/refresh', { method: 'POST', body: JSON.stringify({ days }) });
    if (!r.ok) { toast('刷新失败 (HTTP ' + r.status + ')', 'err'); return; }
    const d = await r.json().catch(() => ({}));
    await load(); // 重新拉取 /api/home：刷新 allHoldings 与 KPI（含当日盈亏/快照日期），再原地重渲染投资页
    const failed = d.failed || [];
    const bf = d.backfill;
    let msg = '';
    if (failed.length) msg += failed.length + ' 只更新失败：' + failed.slice(0, 5).join('、') + (failed.length > 5 ? '…' : '');
    if (bf && (bf.price_rows > 0 || bf.pnl_dates > 0)) {
      const tail = (bf.errors && bf.errors.length) ? ('；' + bf.errors.length + ' 条失败') : '';
      msg += (msg ? '；' : '') + '回朔 ' + bf.days + ' 天：补 ' + bf.price_rows + ' 条价、' + bf.pnl_dates + ' 天盈亏' + tail;
    }
    if (msg) toast(msg, failed.length ? 'err' : 'ok');
    else toast('行情已刷新', 'ok');
  } catch (e) {
    toast('刷新异常：' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    refreshBtnRef = null;
  }
}

// 刷新确认弹框：确定 / 取消 / 遮罩点击关闭
(function bindRefreshConfirm() {
  const modal = $('#refreshConfirmModal');
  const ok = document.getElementById('refreshOk');
  const cancel = document.getElementById('refreshCancel');
  if (ok) ok.onclick = () => doRefresh();
  if (cancel) cancel.onclick = () => { modal.hidden = true; refreshBtnRef = null; };
  modal.addEventListener('click', (e) => { if (e.target === modal) { modal.hidden = true; refreshBtnRef = null; } });
})();

function toolbarChip(cat, label, active) {
  return '<button type="button" class="filter-chip' + (active ? ' active' : '') + '" data-cat="' + cat + '">' + label + '</button>';
}

// 已平仓视图工具条：类型下拉与统计区间已移除（2026-10-28），此处仅保留一行占位，
// 高度由 CSS .closed-toolbar 的 --toolbar-row-h 兜住，与持仓工具条等高，避免切 tab 时表格上下窜。
function renderClosedToolbar(bar) {
  bar.innerHTML = '<div class="closed-toolbar"></div>';
}

// 打开「新增 / 编辑已平仓记录」弹框（纯记录，不入账）。record 为空表示新增。
function openClosedRecordModal(record) {
  const m = record || null;
  $('#crTitle').textContent = m ? '编辑已平仓记录' : '新增已平仓记录';
  $('#crHint').textContent = (m ? '修改这条纯记录（不入账）。' : '仅作记录，不会计入任何账户或持仓。')
    + '收益率留空时按「盈亏 ÷ 本金」推算，年化再按「收益率 × 365 ÷ 天数」折算。';
  $('#cr_id').value = m ? m.id : '';
  $('#cr_sys').value = '0';
  $('#cr_target_id').value = '';
  const kind = m ? normManKind(m.kind) : 'stock';
  $('#cr_kind').value = kind;
  $('#cr_kind_sel').value = kind;
  $('#cr_name').value = m ? (m.name || '') : '';
  $('#cr_code').value = m ? (m.code || '') : '';
  $('#cr_amount').value = m ? (m.amount != null ? m.amount : '') : '';
  $('#cr_currency').value = m ? normCurJS(m.currency) : 'cny';
  $('#cr_principal').value = m && m.principal != null ? m.principal : '';
  $('#cr_rate').value = m && m.return_rate != null ? m.return_rate : '';
  $('#cr_days').value = m ? (m.holding_days != null ? m.holding_days : '') : '';
  fillClosedSourceSelect(m ? (m.source || '') : '');
  $('#cr_realized_at').value = m ? (m.realized_at || '') : '';
  $('#crErr').textContent = '';
  $('#closedRecordModal').hidden = false;
}
// 手动补录类型口径：stock（股票）/ fund（基金）/ wealth（理财）。
// 历史数据里的 hold 与任何未知值一律按股票（与后端 normKind 一致）。
function normManKind(k) {
  return k === 'wealth' ? 'wealth' : (k === 'fund' ? 'fund' : 'stock');
}

// 账户名称下拉：选项 = 已有资产来源名（assetSources，去重保序）。
// 记录里的历史值若已不在账户列表（曾手填 / 账户被删），回退到「其他（自定义）」并把手填框填上，
// 保证编辑时不丢值，也不用给下拉塞一堆「历史 / 已删」的怪选项。
const CR_SRC_CUSTOM = '__custom';
function fillClosedSourceSelect(current) {
  const sel = $('#cr_source');
  if (!sel) return;
  const cur = String(current || '').trim();
  const names = [];
  (assetSources || []).forEach((s) => {
    const n = String(s.name || '').trim();
    if (n && names.indexOf(n) < 0) names.push(n);
  });
  let html = '<option value="">（未指定）</option>';
  html += names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  html += `<option value="${CR_SRC_CUSTOM}">其他（自定义）</option>`;
  sel.innerHTML = html;
  const known = cur && names.indexOf(cur) >= 0;
  sel.value = known ? cur : (cur ? CR_SRC_CUSTOM : '');
  $('#cr_source_custom').value = cur && !known ? cur : '';
  syncClosedSourceCustom();
}

// 「其他（自定义）」选中态 → 显示手填框（隐藏时清空，避免残留值被误提交）
function syncClosedSourceCustom() {
  const sel = $('#cr_source');
  const row = $('#crSourceCustomRow');
  if (!sel || !row) return;
  const isCustom = sel.value === CR_SRC_CUSTOM;
  row.hidden = !isCustom;
  if (!isCustom) $('#cr_source_custom').value = '';
}

// 手动补录的「收益率 / 年化」：优先用记录里填的收益率（持有期 %），
// 留空则按 盈亏 ÷ 本金 推算；年化 = 收益率 × 365 ÷ 天数（持有不足 30 天不外推，见 annOf）。
function manClosedRates(m, amt) {
  const principal = m && m.principal != null ? Number(m.principal) : 0;
  const rateIn = m && m.return_rate != null ? Number(m.return_rate) : null;
  const pct = rateIn != null ? rateIn : (principal > 0 ? amt / principal * 100 : null);
  const days = Number(m && m.holding_days) || 0;
  const a = annOf(pct, days);
  const ann = a.val;
  return {
    pctTxt: pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—',
    annTxt: annText(ann),
    annHint: annHint(a.short),
    pctCls: pct != null ? clsPnl(pct) : 'flat',
    annCls: ann != null ? clsPnl(ann) : 'flat',
  };
}
function toolbarOpt(v, label, active) {
  return '<option value="' + v + '"' + (active ? ' selected' : '') + '>' + label + '</option>';
}
// 持仓天数（自买入日算；无买入日按 0）
function holdingDaysOf(h) {
  if (!h.buy_date) return 0;
  const t = Date.parse(h.buy_date);
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

// 判断某持仓是否支持技术分析（股票始终支持；基金需关联股票代码）
function supportsAnalysis(h) {
  if (isFund(h)) return true;
  return !!(h.symbol && String(h.symbol).trim());
}

// 按「交易日期」取该持仓当日收盘净值/收盘价（基金净值 4 位小数），填进「补仓现价」。
// 逻辑要点：补仓价必须来自「补仓当日收盘」，不能用当前现价预填 —— 补录历史日期的补仓时，
// 用最新净值会把成交价算错、摊薄成本随之失真；净值口径固定 4 位小数。
let adjNavSeq = 0;
async function syncAdjNavPrice(force) {
  const idEl = document.getElementById('adj_id');
  const priceEl = document.getElementById('addNewPrice');
  const dateEl = document.getElementById('add_date');
  const hint = document.getElementById('addPriceHint');
  if (!idEl || !priceEl || !dateEl || !idEl.value) return;
  const date = normDateInput(dateEl) || todayStr();
  if (!force && priceEl.dataset.navDate === date) return;   // 同一天不重复请求
  const seq = ++adjNavSeq;
  try {
    const r = await api('/api/holdings/' + idEl.value + '/nav?date=' + encodeURIComponent(date));
    if (seq !== adjNavSeq || !r.ok) return;
    const d = await r.json();
    if (seq !== adjNavSeq) return;
    if (d && d.price != null && d.price > 0) {
      priceEl.value = String(roundByCat(d.price, calcCat));
      priceEl.dataset.navDate = date;
    }
    if (hint) {
      // 单行短提示，避免撑高该列破坏三列节奏；完整来源放 title
      const srcLabel = d.source === 'current' ? '当前价·无历史' : (d.date === date ? '当日收盘' : '最近交易日');
      hint.textContent = d && d.price != null ? `${(d.date || '').slice(5)} ${fmtNav(d.price, calcCat)}` : '';
      hint.title = d && d.price != null ? `${d.date} ${srcLabel} ${fmtNav(d.price, calcCat)}` : '';
    }
  } catch (_) { /* 取价失败不阻断手填 */ }
}

// 预填「修改/加减仓」弹框内的补仓成本计算器（合并自首页操作列的「计算」按钮）。
// 计算器表单字段直接内嵌于 #adjustModal，故此处只做表单赋值，不单独开弹框。
function prefillAdjCalc(h) {
  const set = (iid, v) => { const el = document.getElementById(iid); if (el) el.value = (v == null || v === '' ? '' : v); };
  calcCat = isFund(h) ? 'fund' : 'stock';
  set('addOldPrice', roundByCat(h.cost_price, calcCat));
  set('addOldQty', round4(h.quantity));
  set('addNewPrice', roundByCat(h.current_price, calcCat));
  set('addNewQty', '');
  set('addAmount', '');
  const feeEl = document.getElementById('addFee');
  set('addFee', round4(feeEl && feeEl.value ? feeEl.value : 0));
  set('addMode', 'qty');
  set('addSide', 'buy');
  syncAdjSideUI();
  const qw = document.getElementById('addQtyWrap'); if (qw) qw.style.display = '';
  const aw = document.getElementById('addAmtWrap'); if (aw) aw.style.display = 'none';
  const res = document.getElementById('addResult');
  if (res) res.innerHTML = '';
  const ph = document.getElementById('addPriceHint');
  if (ph) ph.textContent = '';
  const pn = document.getElementById('addNewPrice');
  if (pn) delete pn.dataset.navDate;
  lastAdd = null;
  const ab = document.getElementById('addApply');
  if (ab) ab.disabled = true;
  // 补仓价按「交易日期」取当日收盘净值（4 位），覆盖上面的当前价预填
  syncAdjNavPrice(true);
}

// 按来源分组渲染首页持仓为折叠卡片（每来源一张子表 + 4 列汇总）
// 来源标题 + 数量 + 右侧市值/今日/总盈亏 + 折叠
// 持仓按 id 索引，供首页「计算」按钮快速取用成本/现价/数量（避免二次请求）
let HOLDINGS_BY_ID = {};
function renderHoldingsBySource(hs) {
  const box = document.getElementById('holdingsBySource');
  if (!box) return;
  if (!hs.length) { box.innerHTML = ''; return; }
  HOLDINGS_BY_ID = {};
  for (const h of hs) HOLDINGS_BY_ID[h.id] = h;
  const toCny = (v, cur) => (cur || '').toUpperCase() === 'USD' ? v * usdRate : (cur || '').toUpperCase() === 'HKD' ? v * hkdRate : v;
  const groups = new Map();
  for (const h of hs) {
    const sid = h.source_id || 0;
    const sname = h.source_name || (sid === 0 ? '未分组' : '账户' + sid);
    if (!groups.has(sid)) groups.set(sid, { sid, name: sname, items: [], mv: 0, cost: 0, dayPnl: 0, pnl: 0 });
    const g = groups.get(sid);
    g.items.push(h);
    g.mv += toCny(h.market_value || 0, h.currency);
    g.cost += toCny(h.cost_value || 0, h.currency);
    g.dayPnl += toCny(h.day_pnl || 0, h.currency);
    g.pnl += toCny(h.pnl || 0, h.currency);
  }
  // 表头工具条排序：组内持仓按（市值 / 收益率 / 盈亏 / 持仓天数）降序
  const sortKey = (h) => {
    if (holdingsSort === 'profit') return toRmb(h, h.pnl || 0);
    if (holdingsSort === 'pnl') return (h.cost_price && h.cost_price > 0) ? ((h.current_price || 0) - h.cost_price) / h.cost_price * 100 : -1e9;
    if (holdingsSort === 'days') return holdingDaysOf(h);
    return toRmb(h, h.market_value || 0);
  };
  // v3.6 排序列指示器：当前排序键映射到表头列；带方向类 sorted-asc/sorted-desc（点击表头 toggle）
  const sortedCls = (key) => (holdingsSort === key ? ' sorted ' + (holdingsSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc') : '');
  groups.forEach((g) => { g.items.sort((a, b) => { const d = sortKey(b) - sortKey(a); return holdingsSortDir === 'asc' ? -d : d; }); });
  const arr = [...groups.values()].sort((a, b) => b.mv - a.mv);
  // 每组内部持仓占比归一化的最大值（组内 max MV，防止极端值把 bar 撑爆）
  arr.forEach((g) => {
    let m = 0;
    g.items.forEach((h) => { const v = toRmb(h, h.market_value); if (v > m) m = v; });
    g.maxItemMV = m;
  });
  // 仓位分母（全量口径，不随筛选漂移）：同(来源,币种)持仓市值合计(原币种) + 现金子账户余额。
  // cashBalMap 匹配不到该 key → 该池无现金子账户 → 行内显示 —（用户指定口径）。
  const poolHold = {};
  for (const h of allHoldings) {
    const k = (h.source_id || 0) + ':' + normCur(h.currency);
    poolHold[k] = (poolHold[k] || 0) + (h.market_value || 0);
  }
  const poolOf = (h) => {
    const k = (h.source_id || 0) + ':' + normCur(h.currency);
    const cash = cashBalMap[k];
    if (cash === undefined) return 0; // 无匹配现金子账户
    return (poolHold[k] || 0) + cash;
  };
  let html = '';
  for (const g of arr) {
    html += `<div class="collapsible source-group holdings-group" data-sid="${g.sid}">`
      + `<div class="collapse-hat holdings-group-head">`
      + `<span class="hat-title">${srcLogo(g.sid)} ${esc(g.name)} <span class="hat-count">${g.items.length} 只</span></span>`
      + `<span class="hat-side">`
      + `<span class="hat-stat hat-stat-mv" title="该账户持仓折合人民币市值"><span class="hat-stat-lbl">市值</span><b${wanTitle(g.mv, '¥')}>¥${fmtWan(g.mv)}</b></span>`
      + `<span class="hat-side-extra" title="今日 / 总盈亏（该账户合计）">`
      + `<span class="hat-stat" title="该账户今日盈亏合计"><span class="hat-stat-lbl">今日</span><b class="${clsPnl(g.dayPnl)}"${wanTitle(g.dayPnl, '¥')}>¥${fmtWanPnl(g.dayPnl)}</b></span>`
      + `<span class="hat-stat" title="该账户累计盈亏合计"><span class="hat-stat-lbl">总盈亏</span><b class="${clsPnl(g.pnl)}"${wanTitle(g.pnl, '¥')}>¥${fmtWanPnl(g.pnl)}</b></span>`
      + `</span>`
      + `<span class="hat-chevron">▾</span></span>`
      + `</div>`
      + `<div class="collapse-body source-group-body">`
      + `<div class="subtable-wrap"><table class="asset-table holdings-subtable">`
      + `<thead><tr><th>名称</th><th class="num" title="近20日收盘价走势">近20日走势</th><th>代码</th><th class="num">现价</th><th class="num" title="今日涨跌幅：现价相对昨收（基金为昨日净值），行情口径；与「今日」列括号里的盈亏率不同——今日% 首日按买入成本计">涨跌幅</th><th class="num" title="成本价（每份）">成本价</th>`
      + `<th class="num sortable${sortedCls('mv')}" data-sort="mv" title="持仓市值（折人民币；悬停查看原币种市值）· 点击排序">市值</th>`
      + `<th class="num" title="占该账户同币种资金池比例：持仓市值 ÷ 持仓合计+现金子账户余额；无匹配现金子账户时显示 —">仓位</th>`
      + `<th class="num" title="今日盈亏金额">今日</th>`
      + `<th class="num sortable${sortedCls('profit')}" data-sort="profit" title="持有期总盈亏金额 · 点击排序">盈亏</th>`
      + `<th class="num sortable${sortedCls('days')}" data-sort="days" title="持仓天数 · 点击排序">持仓</th>`
      + `<th>操作</th>`
      + `</tr></thead><tbody>${g.items.map((h, i) => renderGroupRow(h, i, g.maxItemMV || 1, poolOf(h))).join('')}</tbody>`
      + `</table></div></div></div>`;
  }
  box.innerHTML = html;
  // v3.6 表头点击排序：同一列再次点击 toggle 升/降序；切换列则默认降序（与原下拉口径一致）
  box.querySelectorAll('th.sortable').forEach((th) => {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (holdingsSort === key) {
        holdingsSortDir = holdingsSortDir === 'desc' ? 'asc' : 'desc';
      } else {
        holdingsSort = key;
        holdingsSortDir = 'desc';
      }
      renderFiltered();
    };
  });
  // 绑定每组内行事件
  box.querySelectorAll('.holdings-group').forEach((gEl) => {
    gEl.querySelectorAll('[data-edit]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); editHolding(b.dataset.edit); });
    gEl.querySelectorAll('[data-del]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); delHolding(b.dataset.del); });
    gEl.querySelectorAll('[data-adjust]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openAdjust(b.dataset.adjust); });
    gEl.querySelectorAll('[data-hist]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openHoldingHistory(b.dataset.hist); });
    gEl.querySelectorAll('[data-fail]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); toast(failedSymbols[b.dataset.fail] || '刷新失败', 'err'); });
    gEl.querySelectorAll('[data-ana]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openAnalysis(b.dataset.ana); });
  });
}

// 通用点击复制委托：容器内所有 [data-copy] 元素点击即复制其 data-copy 文本；
// 持仓/理财名称单元格已不再带 data-copy（取消点击复制），此处仅服务于其它带 data-copy 的入口。
function bindCopyDelegation(root) {
  root.querySelectorAll('[data-copy]').forEach((el) => el.onclick = (e) => {
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
}

// 来源分组子表行模板：名称左侧 带颜色箭头(▲/▼) 方向指示 + 名称(过长截断) + 修改/分析 幽灵按钮；操作列纯色文字链接
// 持仓类型徽标：基金=基，美股=美，港股=港，沪深股票=沪/深（按代码前缀区分，小号圆角浅底标签，颜色复用分类色体系）
function holdTypeTag(h) {
  if (isFund(h)) return '<span class="type-tag tag-fund">基</span>';
  if (h.market === '美股') return '<span class="type-tag tag-us">美</span>';
  if (h.market === '港股') return '<span class="type-tag tag-hk">港</span>';
  // A 股按代码前缀判定沪/深：6 开头=沪，0/3 开头=深，其余（含北交所 8/4）兜底显示「沪深」
  const sym = (h.symbol || '').toUpperCase();
  const aTag = /^6/.test(sym) ? '沪' : /^[03]/.test(sym) ? '深' : '沪深';
  return '<span class="type-tag tag-a">' + aTag + '</span>';
}
function renderGroupRow(h, i, maxItemMV, pool) {
  const isFail = !!failedSymbols[h.symbol];
  const mvCny = toRmb(h, h.market_value);
  const dayCny = toRmb(h, h.day_pnl);
  const pnlCny = toRmb(h, h.pnl);
  // 已清仓：份额为 0（卖出后 holdings 保留记录）。行整体置灰 + 名称后挂「已清仓」徽标，
  // 与理财表格的 wealth-archived 视觉口径一致；操作列仍可点（编辑/历史/删除）。
  const closed = (h.quantity || 0) <= 0;
  // 仓位：同(来源,币种)资金池占比，动态宽度颜色条（同资产页账户列表「占比」表现形式）
  const posPct = pool > 0 ? (Number(h.market_value) || 0) / pool * 100 : 0;
  // 今日涨跌幅：现价 vs 昨收（行情口径，红涨绿跌）。prev_close 取不到行情时显示 —。
  // 与「今日」列括号里的 day_pnl_pct 区分：那个首日按买入成本计，这里恒为昨收口径。
  const chgPct = (h.prev_close > 0 && h.current_price > 0)
    ? (h.current_price - h.prev_close) / h.prev_close * 100 : null;
  const rowCls = [isFail ? 'row-failed' : '', closed ? 'holding-archived' : ''].filter(Boolean).join(' ');
  // 不再挂「已清仓」文字徽标（视觉噪音），改为整行置灰 + 名称 title 里说明清仓状态
  const nameTitle = closed ? esc(h.name) + '（已清仓：份额为 0，历史盈亏见「历史走势」，重新买入后自动恢复）' : esc(h.name);
  return `<tr${rowCls ? ` class="${rowCls}"` : ''}>
    <td class="name-cell">
      ${isFail ? '<span class="fail-badge" data-fail="' + esc(h.symbol) + '" title="点击查看失败原因">' + actIcon('warn') + '</span>' : ''}
      ${holdTypeTag(h)}<span class="name-cap"><span class="name-clickable" title="${nameTitle}">${esc(h.name)}</span></span>
      ${actBtn('adjust', `data-adjust="${h.id}"`, '修改', { cls: 'push-right' })}
      ${supportsAnalysis(h) ? actBtn('analysis', 'data-ana="' + h.id + '"', '技术分析') : ''}
    </td>
    <td class="num spark-td">${sparkCell(h.symbol, h.pnl)}</td>
    <td class="code-cell u-sm u-muted" title="${esc(h.symbol || '')}">${esc(h.symbol || '—')}</td>
    <td class="num">${fmtNav(h.current_price, isFund(h) ? 'fund' : 'stock')}</td>
    <td class="num ${clsPnl(chgPct)}" title="今日涨跌幅（现价 vs 昨收${isFund(h) ? '，基金为昨日净值' : ''}）">${chgPct != null ? pct(chgPct) : '—'}</td>
    <td class="num" title="成本价（每份）">${fmtNav(h.cost_price, isFund(h) ? 'fund' : 'stock')}</td>
    <td class="num"${mvOrigTitle(h)}>¥${fmtWan(mvCny)}</td>
    <td class="num share${pool > 0 ? '' : ' is-empty'}"${pool > 0 ? ` style="--p:${posPct.toFixed(1)}%"` : ''} title="占该账户同币种资金池比例${pool > 0 ? ' ' + posPct.toFixed(2) + '%' : '；该账户无匹配现金子账户，无法算占比'}">${pool > 0 ? posPct.toFixed(2) + '%' : '—'}</td>
    <td class="num ${clsPnl(h.day_pnl)}" title="今日盈亏${h.day_pnl_pct ? ' ' + pct(h.day_pnl_pct) : ''}（首日按买入成本计）"><span${wanTitle(dayCny, '¥')}>¥${fmtWanPnl(dayCny)}</span></td>
    <td class="num ${clsPnl(h.pnl)}" title="持有期总盈亏${h.pnl_pct ? ' ' + pct(h.pnl_pct) : ''}"><span${wanTitle(pnlCny, '¥')}>¥${fmtWanPnl(pnlCny)}</span></td>
    <td class="num u-sm u-muted">${h.holding_days > 0 ? h.holding_days + '天' : '—'}</td>
    <td class="row-act-cell">
      ${actBtn('edit', `data-edit="${h.id}"`, '编辑持仓')}
      ${actBtn('hist', `data-hist="${h.id}"`, '历史盈亏')}
      ${actBtn('del', `data-del="${h.id}"`, '删除持仓', { danger: true })}
    </td>
  </tr>`;
}

// 卡片视图已移除（2026-10-19）：持仓仅保留按来源分组表格（#holdingsBySource），卡片网格 #cards 一并删除。

function renderSummary(hs) {
  let totalCNY = 0, totalCostCNY = 0;
  hs.forEach((h) => {
    const mv = h.market_value || 0, cv = h.cost_value || 0;
    // toUpperCase 容错：币种大小写混写时漏乘汇率（历史 bug：'usd' 走进 CNY 分支）
    const cur = (h.currency || '').toUpperCase();
    if (cur === 'USD') {
      totalCNY += mv * usdRate; totalCostCNY += cv * usdRate;
    } else if (cur === 'HKD') {
      totalCNY += mv * hkdRate; totalCostCNY += cv * hkdRate;
    } else {
      totalCNY += mv; totalCostCNY += cv;
    }
  });
  const totalPnl = totalCNY - totalCostCNY;
  const totalPct = totalCostCNY > 0 ? totalPnl / totalCostCNY * 100 : 0;
  const pCls = clsPnl(totalPnl);
  let dayPnlCNY = 0;
  hs.forEach((h) => {
    dayPnlCNY += toRmb(h, h.day_pnl || 0);
  });
  dayPnlCNY += todayRealizedCny; // 并入今日已实现（清仓/减仓）盈亏，避免已清仓标的漏算
  const dpCls = clsPnl(dayPnlCNY);
  const mpCls = clsPnl(monthPnlCNY);
  // 总市值分类（股票/基金/其他，CNY 折算）用于首页彩色堆叠进度条
  let stockMV = 0, fundMV = 0, otherMV = 0;
  hs.forEach((h) => {
    const mv = toRmb(h, h.market_value || 0);
    if (isFund(h)) fundMV += mv;
    else if (!isFund(h)) stockMV += mv;
    else otherMV += mv;
  });
  // 总市值分类堆叠条（股票/基金/理财/其他）。理财段（2026-10-09 迁入）：
  // 仅「全部 / 理财」筛选口径下显示（选中股票/基金时保持纯持仓口径）；分母同步含理财。
  const showWealthSeg = catFilter.size === 0 || catFilter.has('wealth');
  const wealthTotal = showWealthSeg && assetData && assetData.wealth ? (Number(assetData.wealth.total) || 0) : 0;
  const mvAll = totalCNY + wealthTotal;
  const mvSegs = [
    { name: '股票', v: stockMV, c: 'rgb(var(--cat-equity))', rgb: 'var(--cat-equity)' },
    { name: '基金', v: fundMV, c: 'rgb(var(--cat-fund))', rgb: 'var(--cat-fund)' },
  ];
  if (showWealthSeg && wealthTotal > 0) mvSegs.push({ name: '理财', v: wealthTotal, c: 'rgb(var(--cat-wealth))', rgb: 'var(--cat-wealth)' });
  if (otherMV > 0) mvSegs.push({ name: '其他', v: otherMV, c: '#94a3b8', rgb: '148,163,184' });
  // 总市值 panel 主色跟随占比最高的分类色
  const topSeg = mvSegs.slice().sort((a, b) => b.v - a.v)[0];
  // 投资页 Hero（KPI 居中卡）：持仓市值 / 今日盈亏 / 本月盈亏 / 持仓收益率
  const invMv = document.getElementById('investMv');
  if (invMv) invMv.textContent = '¥' + fmt(totalCNY);
  // 锚点卡副标：只数 + 成本（不重复卡片 4 的收益率）
  const invMvSub = document.getElementById('investMvSub');
  if (invMvSub) invMvSub.innerHTML = `持仓 <span class="hl">${hs.length}</span> 只 · 成本 <span class="hl">¥${fmt(totalCostCNY)}</span>`;
  // 今日盈亏口径与首页「今日」一致：持仓今日盈亏 + 今日已实现（清仓/减仓）盈亏，均折 CNY
  const invDay = document.getElementById('investDayPnl');
  if (invDay) {
    invDay.textContent = (dayPnlCNY > 0 ? '+' : '') + '¥' + fmt(Math.abs(dayPnlCNY));
    invDay.className = 'kpi-value ' + dpCls;
    const sub = document.getElementById('investDayPct');
    if (sub) { sub.textContent = pct(dayPnlCNY / Math.max(totalCNY - dayPnlCNY, 1) * 100); sub.className = 'kpi-sub ' + dpCls; }
  }
  const invMonth = document.getElementById('investMonthPnl');
  if (invMonth) {
    invMonth.textContent = (monthPnlCNY > 0 ? '+' : '') + '¥' + fmt(Math.abs(monthPnlCNY));
    invMonth.className = 'kpi-value ' + mpCls;
    const sub = document.getElementById('investMonthPct');
    if (sub) { sub.textContent = pct(monthPnlCNY / Math.max(totalCNY - monthPnlCNY, 1) * 100); sub.className = 'kpi-sub ' + mpCls; }
  }
  const invPct = document.getElementById('investPct');
  if (invPct) {
    invPct.textContent = pct(totalPct);
    invPct.className = 'kpi-value ' + pCls;
  }
  // 盈亏日历 / AI 助手入口已迁至右上角操作区（act-group），此处不再绑定；
  // 权益曲线已迁至首页卡片（renderHomeDashboard 内 renderRateSpark）。
}

// 首页「净资产走势」卡片：近 N 日净资产累计走势（数据复用盈亏日历 /api/pnl/history，
// calData 已加载时不再重复请求）。区间由 #homeRangeTabs 切换，仅切片客户端已取序列，不重复请求。
// v3.7：增加累计投入 dashed 参考线（后端 contrib_cny 推算），让用户直观看到"净值 vs 投入"的差距。
async function renderRateSpark(rangeDays, netVal) {
  if (typeof rangeDays === 'number') homeRangeDays = rangeDays;
  if (typeof netVal === 'number') homeNetVal = netVal;
  const rDays = homeRangeDays;
  try {
    if (!Object.keys(calData).length) {
      const r = await api('/api/pnl/history');
      if (!r.ok) return;
      const d = await r.json();
      (d.history || []).forEach((h) => { calData[h.date] = h; });
    }
    const sortedDates = Object.keys(calData).sort();
    // 每日盈亏增量（CNY）：只用 equity_pnl_cny —— 后端叠加理财之前存的纯持仓盈亏。
    // 不能写成 `|| total_cny` 兜底：equity_pnl_cny 为 0 有两种正常情况（周末全市场休市、
    // 或当天只有理财快照的补行），一旦兜底就取到含理财的 total_cny，理财收益会漏进权益曲线，
    // 分母（= 权益市值 − 区间累计盈亏）也跟着虚高。字段后端每行都输出，不存在缺键。
    const dailyPnl = sortedDates.map((ds) => {
      const v = calData[ds].equity_pnl_cny;
      return (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
    });
    // 每日累计净投入（CNY），后端由 base_cny + total_cny 推算
    const contribRaw = sortedDates.map((ds) => calData[ds].contrib_cny);
    if (rDays && rDays > 0 && dailyPnl.length > rDays) {
      const cut = dailyPnl.length - rDays;
      dailyPnl.splice(0, cut);
      contribRaw.splice(0, cut);
      // 日期数组必须同步截断：homeRateSparkState.dates 与 cumPnl/dayPnl 按同一下标对齐，
      // 漏截会让悬停 tooltip 的日期整体前移（实测悬停 10/6 的减仓悬崖会显示成 8/4）
      sortedDates.splice(0, cut);
    }
    // 剔「空快照」日：equity_pnl 与 total 同时为 0，说明当天根本没抓到净值
    // （周末/假日常见 —— 本库 10-11、10-18 都是周日，所有持仓 pnl 全 0）。
    // 这些点把曲线一天一次拉回零轴，是「心电图」的一半来源；剔掉不改变区间累计
    // （0 不影响求和），只是少画几个贴在零线上的假点。
    for (let i = dailyPnl.length - 1; i >= 0; i--) {
      if (!dailyPnl[i]) {
        dailyPnl.splice(i, 1); contribRaw.splice(i, 1); sortedDates.splice(i, 1);
      }
    }
    const heroBox = document.getElementById('homeRateSpark');
    const heroTrend = document.getElementById('homeRateSparkTrend');
    // 区间 chip 与状态对齐：离开首页再回来时按 homeRangeDays 重渲染，高亮要跟着走
    const rtTabs = document.getElementById('homeRangeTabs');
    if (rtTabs) {
      rtTabs.querySelectorAll('.range-tab').forEach((x) => {
        x.classList.toggle('active', (parseInt(x.dataset.range, 10) || 0) === (rDays || 0));
      });
    }
    if (heroBox && dailyPnl.length >= 2) {
      // 累计盈亏：切片之后从 0 累加 = 「本区间累计」。所以「近7天」看得出这 7 天的走势；
      // 若用全期累计，7 天的波动会被几千的历史盈亏压成一条平线。
      const cumPnl = []; let s = 0;
      dailyPnl.forEach((v) => { s += v; cumPnl.push(s); });
      const rangePnl = s;   // 区间累计盈亏（= 每日盈亏之和 = cumPnl 末值），头部涨跌幅与配色都用它
      // 累计投入（后端已算好，直接取）：只做 hover 读数，不上曲线 —— 它是「存量」，
      // 一笔大额买入就会把整条线的量级整体抬走（¥9.7万 → ¥14.7万），Y 轴被撑到十几万后，
      // 真正要看的盈亏（几百到几千）就压成一条直线。2026-10-29 新增 ¥5 万债基即此症状。
      const contrib = contribRaw.map((v) => (v == null || isNaN(v)) ? null : v);
      // 方案 A：收益率基准改用「起始权益本金」= 当前权益市值 − 区间累计权益盈亏，
      // 不再混入理财/现金/负债的全口径净资产，使首页权益曲线与持仓口径可比。
      const eqMV = Number(assetData?.equity?.market_value || 0);
      const baseMV = eqMV > 0 ? eqMV : (homeNetVal || 0);
      const base = Math.max(baseMV - rangePnl, 1);  // 区间起始权益本金

      // 主序列 = 盈亏金额（avg 日均 / day 单日 / cum 累计），不再是净值：买在市值上时
      // 成本与市值同增、盈亏≈0，所以这个口径对「新增大额持仓」天然免疫，不会出现台阶式跳变。
      const dmode = homeRateMode === 'cum' ? 'cum' : (homeRateMode === 'day' ? 'day' : 'avg');
      // 日均窗口：按点数自适应，≈点数的 1/6 再夹在 2~7 之间。
      // 固定给 7 会把「近7天」的 6 个点全抹平成一条斜坡（走势全丢），
      // 给 1 又等于没平均；28 点→5、70 点→7 正好。
      const nPts = dailyPnl.length;
      const maWin = dmode !== 'avg' ? 1 : Math.max(2, Math.min(7, Math.round(nPts / 6)));
      const series = dmode === 'cum' ? cumPnl : dailyPnl;
      // 真正画出来的那条：日均 = 居中移动平均（去锯齿），其余口径 = 原值
      const shown = maWin > 1 ? rbCenteredMA(series, maWin) : series;

      // Y 轴：0 恒在轴内（盈亏分界线，正负一眼可辨）；再保一个最小跨度，
      // 免得几十块的抖动被拉成满屏暴跌。下限 = 本金的 0.4%（约等于一个「正常日波动」），
      // 但均值把波动压小了约 √w 倍，下限也要跟着除 √w，否则日均曲线永远只占轴高的一小截，
      // 看着像「一条直线」而不是「一段趋势」。
      let axMin = Math.min(0, ...shown), axMax = Math.max(0, ...shown);
      if (axMax - axMin < 1e-9) { axMax += 1; axMin -= 1; }
      const axMid = (axMin + axMax) / 2;
      const minSpan = Math.max(120, Math.abs(base) * 0.004 / Math.sqrt(maWin));
      if (axMax - axMin < minSpan) { axMin = axMid - minSpan / 2; axMax = axMid + minSpan / 2; }
      const axis = { min: axMin, max: axMax };

      const trendCls = clsPnl(rangePnl);
      const strokeColor = trendCls === 'up' ? 'var(--up)' : (trendCls === 'down' ? 'var(--down)' : 'var(--text-muted)');

      // v3.6：先测 heroBox 实际像素尺寸 → 用精确匹配的 viewBox + 硬编码 width/height，
      let svgW = 300, svgH = 72;
      try {
        const r = heroBox.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { svgW = Math.round(r.width); svgH = Math.round(r.height); }
      } catch (_) {}

      // 单序列画法：面积从零轴起填（不是从画布底边），亏损段才不会被填成「正面积」；
      // smooth:true 用单调三次插值把折线画成曲线 —— 日频数据的折线全是尖角，
      // 一个正负交替的序列画出来就是心电图，圆润之后读的是「走势」而不是「锯齿」。
      heroBox.innerHTML = sparkline(shown, {
        w: svgW, h: svgH, stroke: strokeColor, fill: strokeColor, axis, zero: true, smooth: true,
      });

      // 趋势文案：区间累计盈亏折算为收益率（基准 = 起始权益本金）。
      // 与主序列口径解耦 —— 切到「日均/单日」时这里仍是区间累计收益率，卡片头部语义不变。
      if (heroTrend) {
        const pctV = rangePnl / base * 100;
        heroTrend.textContent = (pctV > 0 ? '+' : '') + pctV.toFixed(2) + '%';
        heroTrend.className = `hero-mini-trend ${trendCls}`;
      }

      // hover 弹框所需序列：日期 / 单日盈亏 / 本期累计盈亏 / 实际画的那条(shown) / 成本 / 期初本金。
      // series 单独存一份：日均口径下画的是均值，弹框的参考点必须落在均值上，
      // 否则竖线/卡片会飘到曲线之外。成本不上图但留在弹框里，想确认「我投了多少」不必切页面。
      homeRateSparkState = {
        dates: sortedDates.slice(), dayPnl: dailyPnl.slice(), cumPnl: cumPnl.slice(),
        series: shown.slice(), maWin,
        contrib: contrib.slice(), base, n: shown.length,
        mode: dmode, axisMin: axMin, axisMax: axMax,
      };
      bindHomeRateHover();
    } else if (heroBox) {
      heroBox.innerHTML = '<span class="hero-spark-empty">—</span>';
    }
  } catch (e) { /* 走势失败不影响卡片主信息 */ }
}

// 首页权益曲线 hover 弹框：鼠标在曲线上移动时定位到最近数据点，显示日期 + 持仓成本
// + 单日盈亏 + 本期累计盈亏 + 盈亏率，并画一条竖向参考线。
// 曲线画的是盈亏金额（day/cum 两口径），而成本只在弹框里出现 —— 弹框不影响 Y 轴，
// 所以「¥9.7万的本金」不会再把曲线压平；参考点的 y 按 homeRateSparkState.mode 取同一条序列。
function bindHomeRateHover() {
  const box = document.getElementById('homeRateSpark');
  const wrap = box ? box.closest('.nw-spark') : null;
  if (!box || !wrap) return;
  let tip = document.getElementById('homeRateTip');
  let guide = document.getElementById('homeRateGuide');
  if (!tip) { tip = document.createElement('div'); tip.id = 'homeRateTip'; tip.className = 'rate-tip'; tip.hidden = true; document.body.appendChild(tip); }
  if (!guide) { guide = document.createElement('div'); guide.id = 'homeRateGuide'; guide.className = 'rate-tip-guide'; guide.hidden = true; box.appendChild(guide); }
  box.onmousemove = (e) => {
    const st = homeRateSparkState;
    if (!st || st.n < 2) return;
    const r = box.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (w <= 0 || h <= 0) return;
    const xPad = Math.max(1.5, h * 0.08);
    const x = e.clientX - r.left;
    let i = Math.round((x - xPad) / (w - xPad * 2) * (st.n - 1));
    i = Math.max(0, Math.min(st.n - 1, i));
    const pnl = st.cumPnl[i] || 0;
    const dayAmt = (st.dayPnl && st.dayPnl[i]) || 0;
    const rate = st.base > 0 ? pnl / st.base * 100 : 0;
    const cls = pnl > 0 ? 'up' : (pnl < 0 ? 'down' : 'flat');
    const dCls = dayAmt > 0 ? 'up' : (dayAmt < 0 ? 'down' : 'flat');
    const sign = pnl > 0 ? '+' : (pnl < 0 ? '-' : '');
    const dSign = dayAmt > 0 ? '+' : (dayAmt < 0 ? '-' : '');
    const dateStr = (st.dates[i] || '').slice(0, 10);
    // 日均口径时把「画的那个均值」也列出来，否则鼠标停在一条平缓的曲线上、
    // 弹框却报一个 ±400 的单日数，会以为曲线画错了。
    const avgAmt = (st.series && st.series[i] != null) ? st.series[i] : null;
    const aCls = avgAmt > 0 ? 'up' : (avgAmt < 0 ? 'down' : 'flat');
    const aSign = avgAmt > 0 ? '+' : (avgAmt < 0 ? '-' : '');
    const avgRow = (st.mode === 'avg' && avgAmt != null)
      ? '<div class="rt-row"><span>' + (st.maWin || 5) + '日均</span><b class="' + aCls + '">' + aSign + '¥' + fmt(Math.abs(avgAmt)) + '</b></div>'
      : '';
    // 只有「持仓成本」还留在这里：曲线画的是盈亏金额，市值 = 成本 + 本期累计盈亏已经不是一个
    // 能直接读的数（本期累计从区间首日归零），再列「持仓市值」会让人拿三个数互相对账对不上。
    const cost = st.contrib[i];
    tip.innerHTML =
      '<div class="rt-date">' + dateStr + '</div>' +
      (cost == null ? '' : '<div class="rt-row"><span>持仓成本</span><b>¥' + fmt(cost) + '</b></div>') +
      '<div class="rt-row"><span>单日盈亏</span><b class="' + dCls + '">' + dSign + '¥' + fmt(Math.abs(dayAmt)) + '</b></div>' +
      avgRow +
      '<div class="rt-row"><span>累计盈亏</span><b class="' + cls + '">' + sign + '¥' + fmt(Math.abs(pnl)) + '</b></div>' +
      '<div class="rt-row"><span>盈亏率</span><b class="' + cls + '">' + sign + Math.abs(rate).toFixed(2) + '%</b></div>';
    // 纵向参考线
    guide.style.left = x + 'px';
    guide.hidden = false;
    // 弹框定位：用与曲线同一套 Y 轴（含最小跨度）保证参考点对齐；以 fixed 挂 body 定位，
    // 避免被 .hero-banner{overflow:hidden} 裁掉下半部分。
    const padY = Math.max(1.5, h * 0.12), innerH = h - padY * 2;
    // 参考点取「当前画的那条序列」的值（st.series）：日均口径下画的是均值，
    // 用单日原值去均值轴上定位，弹框会飘到曲线之外。
    const anchor = (st.series && st.series[i] != null)
      ? st.series[i]
      : (st.mode === 'cum' ? pnl : dayAmt);
    let vmin = st.axisMin, vmax = st.axisMax;
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax <= vmin) {
      const all = st.series || (st.mode === 'cum' ? st.cumPnl : st.dayPnl);
      vmin = Math.min.apply(null, all); vmax = Math.max.apply(null, all);
      vmin = Math.min(vmin, 0); vmax = Math.max(vmax, 0);
      if (vmax - vmin < 1e-9) { vmax += 1; vmin -= 1; }
    }
    const y = padY + innerH - (innerH * (anchor - vmin)) / (vmax - vmin);
    tip.hidden = false;                       // 先显示，量出真实尺寸再夹紧
    const tipW = tip.offsetWidth || 168, tipH = tip.offsetHeight || 120;
    const br = box.getBoundingClientRect();
    const px = br.left + x, py = br.top + y;
    let left = px + 14;
    if (left + tipW > window.innerWidth - 8) left = px - tipW - 14;   // 右侧放不下→翻到左侧
    if (left < 8) left = 8;
    let top = py - 12;
    if (top + tipH > window.innerHeight - 8) top = py - tipH - 12;    // 下方放不下→翻到点上方
    if (top < 8) top = 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };
  box.onmouseleave = () => { if (tip) tip.hidden = true; if (guide) guide.hidden = true; };
}

// （sparklineDual 已于 2026-10-29 删除：首页曲线改画盈亏金额后只剩一条序列，
//   原「净值 area + 累计投入 dashed」双轴没有别的调用方。）

// 首页净资产走势区间切换（近30天/近90天/近1年/全部）：仅切片已取序列，不重复请求
function bindHomeRangeTabs() {
  const rt = document.getElementById('homeRangeTabs');
  if (!rt) return;
  rt.querySelectorAll('.range-tab').forEach((b) => {
    b.onclick = () => {
      rt.querySelectorAll('.range-tab').forEach((x) => x.classList.toggle('active', x === b));
      // 0 = 全部：不能写 `parseInt(...) || 30`，那样「全部」也会被当成 30 天（老 bug）
      const rd = parseInt(b.dataset.range, 10);
      renderRateSpark(Number.isFinite(rd) ? rd : 30);
    };
  });
}

// 首页权益曲线口径切换（日均 / 单日 / 累计）：只换主序列，不重新请求接口
function bindHomeRateMode() {
  const box = document.getElementById('homeRateMode');
  if (!box) return;
  box.querySelectorAll('.spark-mode-btn').forEach((b) => {
    // 与状态对齐：离开首页再回来时按钮高亮要跟着 homeRateMode 走，否则默认「日均」
    // 显示出来是「单日」高亮，点一下反而没反应（m === homeRateMode 直接 return）
    b.classList.toggle('active', (b.dataset.mode || 'avg') === homeRateMode);
    b.onclick = () => {
      const m = b.dataset.mode === 'cum' ? 'cum' : (b.dataset.mode === 'day' ? 'day' : 'avg');
      if (m === homeRateMode) return;
      homeRateMode = m;
      box.querySelectorAll('.spark-mode-btn').forEach((x) => x.classList.toggle('active', x === b));
      renderRateSpark();
    };
  });
}

// Build the two-level filter UI: a category slider (left-right swipeable, single
// select) and a market row (multi-select chips) whose options depend on the
// selected category (二级筛选).
// 布局（2026-10-09 压缩高度）：类别滑块与市场 chips 合并为一行（slider 左、市场右，
// 仅选中股票/基金时出现市场 chips；全部/理财时整行只有滑块，高度省一半）。
function buildFilters() {
  // 重置筛选状态（保留「按市场筛选」弹窗所需的 mktFilter 初始化）。
  // 文本搜索框已按需求移除（见投资页清理），#filters 容器一并下线，故找不到时直接返回。
  catFilter = new Set();
  mktFilter = new Set(ALL_MARKETS);
  const box = $('#filters');
  if (!box) return;
  box.innerHTML = '';
}

// Markets offered depend on which categories are selected.
function availableMarkets() {
  if (catFilter.size === 0) return ALL_MARKETS;
  let ms = [];
  catFilter.forEach((c) => { ms = ms.concat(CAT_MARKETS[c] || []); });
  return ms;
}

// 摘要按钮：全选显示「市场：全部」，部分显示数量，全不选显示「市场：未选」
function syncMktSummary() {
  const btn = document.getElementById('mktSummaryBtn');
  if (!btn) return;
  const avail = availableMarkets();
  let label;
  if (!mktFilter.size) label = '市场：未选';
  else if (mktFilter.size >= avail.length) label = '市场：全部';
  else if (mktFilter.size === 1) label = '市场：' + [...mktFilter][0];
  else label = '市场：' + mktFilter.size + ' 项';
  btn.textContent = label;
  btn.classList.toggle('is-partial', mktFilter.size > 0 && mktFilter.size < avail.length);
  btn.classList.toggle('is-empty', mktFilter.size === 0);
}

function renderMktList(avail) {
  const box = $('#mktFilterList');
  if (!box) return;
  box.innerHTML = '';
  if (!avail.length) { box.innerHTML = '<p class="src-empty">当前类别没有市场维度</p>'; return; }
  avail.forEach((m) => {
    const lbl = document.createElement('label');
    lbl.className = 'src-item';
    lbl.innerHTML = `<input type="checkbox" name="mkt-filter" value="${m}" ${mktFilter.has(m) ? 'checked' : ''}> <span>${esc(m)}</span>`;
    lbl.querySelector('input').addEventListener('change', onMktChange);
    box.appendChild(lbl);
  });
}

function toggleMktPop(force) {
  const btn = document.getElementById('mktSummaryBtn');
  const pop = $('#mktFilterPop');
  if (!btn || !pop) return;
  const show = (force === undefined) ? pop.hidden : force;
  if (show) {
    renderMktList(availableMarkets());
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px';
    // 右对齐到按钮右缘，并夹在视口内（弹层固定 224px 宽）
    pop.style.left = Math.max(8, Math.min(r.right - 224, window.innerWidth - 232)) + 'px';
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  } else {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
}

function onMktChange() {
  mktFilter = new Set([...document.querySelectorAll('#mktFilterList input:checked')].map((i) => i.value));
  syncMktSummary();
  applyFilter();
}

// 市场弹层交互：摘要按钮开合、全选/清空、点击外部关闭、Esc 关闭
// 注意：#mktSummaryBtn 是 buildFilters() 动态创建的（load() 里才执行，晚于本段脚本），
// 所以按钮一律走 document 事件委托，不能在此处直接取元素绑定 —— 否则拿到 null 静默失效。
(function wireMktFilter() {
  const pop = document.getElementById('mktFilterPop');
  if (!pop) return;
  const apply = document.getElementById('mktApply');
  const all = document.getElementById('mktAll');
  const none = document.getElementById('mktNone');
  if (apply) apply.onclick = () => toggleMktPop(false);
  if (all) all.onclick = () => {
    document.querySelectorAll('#mktFilterList input').forEach((i) => { i.checked = true; });
    onMktChange();
  };
  if (none) none.onclick = () => {
    document.querySelectorAll('#mktFilterList input').forEach((i) => { i.checked = false; });
    onMktChange();
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#mktSummaryBtn');
    if (btn) { e.stopPropagation(); toggleMktPop(); return; }
    if (!pop.hidden && !pop.contains(e.target)) toggleMktPop(false);
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) toggleMktPop(false);
  });
})();

function applyFilter() {
  renderFiltered();
}

let sparkUid = 0;
// 迷你走势线（Sparkline）：纯 SVG polyline + 渐变面积 + 尾端点圆。
// 涨红跌绿（中国惯例），w/h 固定 1:1 用 viewBox 精确匹配，避免拉伸变形。
// 将 CSS 变量（var(--up) 等）解析为具体颜色：SVG <stop> 的 stop-color 不支持 presentation 属性里的 var()，
// 直接传 var() 会回退成黑色，在深色 hero 下渐变填充几乎不可见；这里统一解析成真实色值。
// 已知 CSS 变量的兜底色值：当 getComputedStyle 因故取不到时（极端时序/沙箱）仍能拿到真实色，
// 避免 SVG stop-color 拿到 var() 字符串后回退为 black 而在深色卡片上「看不见」。
const CSS_VAR_FALLBACK = {
  '--up': '#f87171', '--down': '#4ade80', '--text-muted': '#94a3b8',
  '--primary': '#0a84ff', '--tint': '#0a84ff', '--danger': '#f87171',
};
function resolveColor(c) {
  if (typeof c === 'string' && c.indexOf('var(') === 0) {
    const name = c.slice(c.indexOf('(') + 1, c.lastIndexOf(')')).trim();
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) return v;
    } catch (_) {}
    if (CSS_VAR_FALLBACK[name]) return CSS_VAR_FALLBACK[name];
  }
  return c;
}

// 居中移动平均（去锯齿）：窗口 w 以当前点为中心，两端窗口自动收窄。
// 用居中而不是「过去 w 天」，是因为后者会让整条曲线右移 (w-1)/2 天，
// 末点显示的是「几天前的平均值」，而卡片右下角恰恰是用户最常看的最新一天。
function rbCenteredMA(arr, w) {
  const W = Math.max(1, Math.round(w) || 1);
  if (W <= 1 || arr.length < 3) return arr.slice();
  const h = Math.floor(W / 2);
  return arr.map((_, i) => {
    const lo = Math.max(0, i - h), hi = Math.min(arr.length - 1, i + h);
    let s = 0;
    for (let j = lo; j <= hi; j++) s += arr[j];
    return s / (hi - lo + 1);
  });
}

// 折线 → 平滑曲线：单调三次 Hermite 插值（Fritsch–Carlson 限幅）。
// 不用 Catmull-Rom 的原因：它会在拐点两侧甩出比原值更高/更低的一段（overshoot），
// 在跨零轴的盈亏曲线里会把「小亏」画成「盈利」，读图直接读反。
// 单调插值保证曲线在两相邻点之间不越过这两点的值域，只在形状上变圆润。
function rbCurvePath(xs, ys) {
  const n = xs.length;
  if (n < 2) return '';
  let d = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  if (n === 2) return d + `L${xs[1].toFixed(2)},${ys[1].toFixed(2)}`;
  const dx = new Array(n - 1), m = new Array(n - 1), t = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    m[i] = dx[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / dx[i];   // 割线斜率
  }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // 极值点（两侧斜率异号）切线置零 → 曲线在峰谷处「落平」，不会冲过原值
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i];
    const s2 = a * a + b * b;
    if (s2 > 9) {                       // 限幅到单位圆半径 3，保证段内单调
      const k = 3 / Math.sqrt(s2);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const h3 = dx[i] / 3;
    d += `C${(xs[i] + h3).toFixed(2)},${(ys[i] + t[i] * h3).toFixed(2)} ` +
         `${(xs[i + 1] - h3).toFixed(2)},${(ys[i + 1] - t[i + 1] * h3).toFixed(2)} ` +
         `${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
  }
  return d;
}

function sparkline(data, opts) {
  const w = (opts && opts.w) || 100, h = (opts && opts.h) || 28;
  const stroke = (opts && opts.stroke) || 'currentColor';
  const fill = (opts && opts.fill) || stroke;
  const strokeColor = resolveColor(stroke);
  const strokeWidth = (opts && opts.strokeWidth) || 1.5;
  const vals = (data || []).filter(v => Number.isFinite(v));
  if (vals.length < 2) return '';
  let min, max;
  const ax = opts && opts.axis;
  if (ax && Number.isFinite(ax.min) && Number.isFinite(ax.max) && ax.max > ax.min) {
    min = ax.min; max = ax.max;
  } else {
    min = Math.min(...vals); max = Math.max(...vals);
    if (max - min < 1e-9) { max += 1; min -= 1; }
  }
  const padY = Math.max(1.5, h * 0.12), innerH = h - padY * 2;
  // v3.6: 两端 padding 和圆点半径都按 h 等比缩放，避免小容器里圆点太小/大容器里圆点太大
  const xPad = Math.max(1.5, h * 0.08);
  const dotR = Math.max(1.2, Math.min(3.5, h * 0.06));
  const xAt = i => xPad + ((w - xPad * 2) * i) / (vals.length - 1);
  const yAt = v => padY + innerH - (innerH * (v - min)) / (max - min);
  const xs = vals.map((_, i) => xAt(i));
  const ys = vals.map((v) => yAt(v));
  const pts = xs.map((x, i) => `${x.toFixed(2)},${ys[i].toFixed(2)}`).join(' ');
  const last = `${xs[xs.length - 1].toFixed(2)},${ys[ys.length - 1].toFixed(2)}`;
  // smooth:true → 用单调三次插值画曲线（折线在日频数据上全是尖角，像心电图的折纸边）。
  // 点太少（<3）时插值没有意义，直接退回折线。
  const smooth = !!(opts && opts.smooth) && vals.length >= 3;
  const lineD = smooth ? rbCurvePath(xs, ys) : '';
  const gid = 'spk' + (++sparkUid);
  // 渐变：默认 fade（顶深→底透明）；'soft' = 曲线下方同色柔和底色，
  // 自上而下近乎均匀、底部保留可见色（不淡出到透明），仅紧贴曲线处略深
  const grad = (opts && opts.gradient) || 'fade';
  let topOp = '.20', botOp = '0';
  // soft：柔和底色强度（.26/.13 在深色卡片上几乎不可见，提高到可清晰辨识的强度）
  if (grad === 'soft') { topOp = '.30'; botOp = '.22'; }
  // zero:true → 面积从零轴起填。盈亏曲线跨零轴时若仍填到画布底边，
  // 亏损段会被填成一块「正面积」，看图会读反。零轴不在数据范围内时退回底边。
  const zeroIn = !!(opts && opts.zero) && min <= 0 && max >= 0;
  const baseY = zeroIn ? yAt(0) : h;
  const zeroEl = zeroIn
    ? `<line x1="${xAt(0).toFixed(2)}" y1="${yAt(0).toFixed(2)}" x2="${xAt(vals.length - 1).toFixed(2)}" y2="${yAt(0).toFixed(2)}" stroke="${resolveColor('var(--text-faint)')}" stroke-width="1" stroke-dasharray="2,3" vector-effect="non-scaling-stroke"/>`
    : '';
  const areaShape = smooth
    ? `<path d="${lineD}L${xs[xs.length - 1].toFixed(2)},${baseY.toFixed(2)}L${xs[0].toFixed(2)},${baseY.toFixed(2)}Z" fill="url(#${gid})"/>`
    : `<polygon points="${xAt(0).toFixed(2)},${baseY.toFixed(2)} ${pts} ${xAt(vals.length - 1).toFixed(2)},${baseY.toFixed(2)}" fill="url(#${gid})"/>`;
  const area = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${strokeColor}" stop-opacity="${topOp}"/><stop offset="100%" stop-color="${strokeColor}" stop-opacity="${botOp}"/></linearGradient></defs>${areaShape}`;
  // responsive:true → 去掉硬编码 width/height，只留 viewBox，由 CSS 容器控制尺寸
  const dimAttrs = (opts && opts.responsive) ? '' : ` width="${w}" height="${h}"`;
  const par = (opts && opts.nonUniform) ? 'none' : 'xMidYMid meet';
  const lineEl = smooth
    ? `<path d="${lineD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth || 1.5}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
    : `<polyline points="${pts}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth || 1.5}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="${par}"${dimAttrs} class="u-block u-va-mid" role="img" aria-hidden="true">${area}${zeroEl}${lineEl}<circle cx="${last.split(',')[0]}" cy="${last.split(',')[1]}" r="${dotR.toFixed(1)}" fill="${strokeColor}"/></svg>`;
}

// 表格迷你走势单元格：线条为近30日收盘价走势，颜色按首尾收盘价对比（尾>首=涨红，否则=跌绿，
// 中国惯例涨红跌绿），无数据时显示占位符。
function sparkCell(sym, pnl) {
  const arr = (sparkCache[sym] || []).slice(-20);
  if (!arr || arr.length < 2) return '<span class="spark-empty">—</span>';
  const dir = clsPnl(arr[arr.length - 1] - arr[0]);
  const color = dir === 'down' ? 'var(--down)' : dir === 'up' ? 'var(--up)' : 'var(--text-muted)';
  return sparkline(arr, { w: 110, h: 26, stroke: color, fill: color });
}

// 单只持仓手动刷新逻辑已移除：行情改由定时快照（refreshAllQuotes）自动更新。

// ---------------- 添加/编辑持仓：名称/代码联想 + 类别/市场胶囊 ----------------
// 联想接口返回的市场码 -> 组合持仓市场口径（中文）。
const SEARCH_MKT_TO_PF = { CN: '沪深', HK: '港股', US: '美股' };
// 当前选中的联想项（{symbol,name,marketPF,category}）：非空表示用户从联想列表选定了标的；
// 手动输入时置空，提交时按「名称/代码」框内容兜底解析。
let curSel = null;
let selCat = 'stock';   // 当前类别胶囊
let selMkt = '沪深';    // 当前市场胶囊

// 选中一条联想结果：自动识别 港/美/A股/基金，市场与类别不再让用户手选。
// 基金（it.category==='fund'）自动归为基金，无需选择市场（市场细分留空，由后端兜底）；
// 股票按联想返回的市场码映射为 沪深/港股/美股。
function pickSuggestion(it) {
  selCat = it.category === 'fund' ? 'fund' : 'stock';
  const htSel = $('#f_hold_type'); if (htSel) htSel.value = selCat;
  selMkt = selCat === 'fund' ? '' : (SEARCH_MKT_TO_PF[it.market] || '沪深');
  curSel = { symbol: it.symbol, name: it.name, marketPF: selMkt, category: selCat };
  $('#f_search').value = it.name;
  $('#f_name').value = it.name;
  $('#f_symbol').value = it.symbol;
  $('#f_market').value = selMkt;
  $('#fSuggest').hidden = true;
  $('#fSuggest').innerHTML = ''; // 清空，避免 <label> 重新聚焦输入框时下拉被 focus 处理器重开
  toggleLinkedSymbol();
}

// 名称/代码联想：输入防抖 220ms 请求 /api/search，点击结果即回填。
function wireSearch() {
  const inp = $('#f_search');
  const box = $('#fSuggest');
  if (!inp || !box) return;
  let timer = null;
  const hide = () => { box.hidden = true; };
  inp.addEventListener('input', () => {
    curSel = null; // 用户正在改动文本，取消上次联想选中
    const q = inp.value.trim();
    if (timer) clearTimeout(timer);
    if (!q) { hide(); box.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api('/api/search?q=' + encodeURIComponent(q));
        if (!r.ok) { hide(); return; }
        const d = await r.json();
        const items = (d.results || []).slice(0, 12);
        if (!items.length) { hide(); box.innerHTML = ''; return; }
        box.innerHTML = items.map((it, i) => (
          `<button type="button" class="f-suggest-item" data-i="${i}">`
          + `<span class="f-si-name">${esc(it.name)}</span>`
          + `<span class="f-si-code">${esc(it.symbol)}</span>`
          + `<span class="f-si-mkt">${esc(SEARCH_MKT_TO_PF[it.market] || it.market || '')}</span>`
          + '</button>'
        )).join('');
        box.hidden = false;
        box.querySelectorAll('.f-suggest-item').forEach((b) => {
          b.onclick = (ev) => { ev.preventDefault(); pickSuggestion(items[Number(b.dataset.i)]); };
        });
      } catch (_) { hide(); }
    }, 220);
  });
  inp.addEventListener('focus', () => { if (box.innerHTML) box.hidden = false; });
  document.addEventListener('click', (e) => {
    if (!box.hidden && e.target !== inp && !box.contains(e.target)) hide();
  });
}

// 是否像证券代码（纯数字/字母，长度 1-8），用于手动输入时拆出代码。
function looksLikeCode(s) {
  return /^[0-9A-Za-z.]{1,8}$/.test(String(s || '').trim());
}

async function openModal(h) {
  await loadCashAccounts();
  $('#modalTitle').textContent = h ? '编辑持仓' : '添加持仓';
  $('#f_id').value = h ? h.id : '';
  // 名称/代码合并为一个联想框；市场/类别由联想结果自动识别，不再手选（详见 pickSuggestion）。
  selCat = (h && isFund(h)) ? 'fund' : 'stock';
  selMkt = h ? h.market : '沪深';
  curSel = h ? { symbol: h.symbol, name: h.name, marketPF: selMkt, category: selCat } : null;
  // 持仓类型下拉（股票/基金/ETF/债券）：以已有分类为准，手动选择时覆盖 selCat（见 onchange）
  const initCat = (h && h.category) ? h.category : selCat;
  selCat = initCat;
  const htSel = $('#f_hold_type');
  if (htSel) {
    htSel.value = initCat;
    htSel.onchange = () => {
      selCat = htSel.value;
      if (selCat === 'fund') { selMkt = ''; $('#f_market').value = ''; }
    };
  }
  $('#f_search').value = h ? h.name : '';
  $('#fSuggest').hidden = true;
  $('#fSuggest').innerHTML = '';
  $('#f_name').value = h ? h.name : '';
  $('#f_symbol').value = h ? h.symbol : '';
  $('#f_market').value = selMkt;
  // 账户·币种：合并选择器（二级子账户折叠面板）。编辑模式只列持仓当前父账户的子账户，并预选同 (父账户, 币种) 的子账户；新增列全部子账户。
  buildHoldPicker(h ? h.source_id : null);
  const presetAcc = h
    ? (cashAccountsCache || []).find((c) => Number(c.source_id) === Number(h.source_id) && String(c.currency).toLowerCase() === String(h.currency).toLowerCase())
    : (cashAccountsCache || [])[0];
  holdSetSelection(presetAcc);
  $('#f_quantity').value = h ? round4(h.quantity) : '';
  const eCat = (h && isFund(h)) ? 'fund' : 'stock';
  $('#f_cost_price').value = h ? roundByCat(h.cost_price, eCat) : '';
  $('#f_note').value = h ? (h.note || '') : '';
  $('#f_cost').value = h ? roundByCat(h.transaction_cost, eCat) : '';
  $('#f_buy_date').value = h ? (h.buy_date || '') : todayStr();
  syncDateHint($('#f_buy_date'));
  // 关联基金代码：拆分为 market 下拉 + code 输入（后端 resolveSymbol 已支持 prefix:code 格式）
  let linkedSym = h ? (h.linked_symbol || '') : '';
  let linkedMkt = 'a', linkedCode = '';
  if (linkedSym.includes(':')) {
    const [p, c] = linkedSym.split(':');
    linkedMkt = p.toLowerCase();
    linkedCode = (c || '').trim();
  } else if (linkedSym) {
    // 存量兼容：无前缀的代码按 market 字段推断
    linkedCode = linkedSym;
    if (selMkt === '美股') linkedMkt = 'us';
    else if (selMkt === '港股') linkedMkt = 'hk';
    else linkedMkt = 'a';
  }
  $('#f_linked_market').value = linkedMkt;
  $('#f_linked_code').value = linkedCode;
  toggleLinkedSymbol();
  $('#formErr').textContent = '';
  $('#modal').hidden = false;
}

// 关联基金代码行：基金判定已统一由 linked_symbol 决定，此处恒显示该行（用户可随时补录关联代码）
function toggleLinkedSymbol() {
  const row = $('#linked_symbol_row');
  if (row) row.style.display = '';
}

// 关联基金代码输入时，实时按 linked_symbol 推导 selCat（基金判定仍以 linked_symbol 为准，与 isFund 一致）
function syncCatFromLinked() {
  const linked = ($('#f_linked_code').value || '').trim();
  selCat = linked ? 'fund' : 'stock';
  const htSel = $('#f_hold_type'); if (htSel) htSel.value = selCat;
  $('#f_market').value = selMkt;
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

// ---------------- 修改持仓弹框（加减仓 / 分红） ----------------
let lastAdd = null;        // 试算 Tab 最近一次有效方案 { q1, p1, fee, mode, side }
let pendingApplyAdd = false; // 确认弹框：计入持仓 pending 标记
// 现金账户列表缓存（供加减仓「资金账户」下拉使用）
let cashAccountsCache = [];
// 添加流水弹框：负债账户缓存（与现金账户合并进同一下拉，按前缀区分 c:/l:）
let flowLibsCache = [];
async function loadCashAccounts() {
  try {
    const r = await api('/api/asset/cash');
    if (r.ok) { const d = await r.json(); cashAccountsCache = d.cash || []; }
  } catch (_) {}
  return cashAccountsCache;
}
// 兜底账户选取（2026-10-16 移除「默认子账户」概念）：与后端 PickCashAccount 同口径——
// 同来源同币种下余额最大（并列取较新创建）。各类资金账户下拉的预选都走它。
function pickFallbackCash(list) {
  if (!list || !list.length) return null;
  return list.slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0) || (Number(b.id) || 0) - (Number(a.id) || 0))[0];
}
// 渲染加减仓的资金账户下拉：只列该持仓同来源、同币种的现金账户（资金来源限定同来源同币种），
// 预选余额最大的子账户；该来源暂无现金账户时仅留自动兜底项（后端会按需补建落点账户）
function renderAdjCashSelect(h) {
  const srcId = Number(h && h.source_id) || 0;
  const cur = normCur(h && h.currency);
  const list = (cashAccountsCache || []).filter((c) => Number(c.source_id) === srcId && normCur(c.currency) === cur);
  const opts = list.map((c) => {
    const csym = c.currency === 'usd' ? '＄' : (c.currency === 'hkd' ? 'HK＄' : '¥');
    return `<option value="${c.id}">${esc(c.name)}（${csym}${fmt(c.amount || 0)}）</option>`;
  }).join('');
  const html = `<option value="0">（自动：余额最大的同币种子账户）</option>` + opts;
  const def = pickFallbackCash(list);
  const sel = $('#adj_cash_id');
  if (sel) {
    sel.innerHTML = html;
    sel.value = def ? String(def.id) : '0';
  }
  // 调仓面板复用同一账户的账户下拉（与加减仓/分红保持一致）
  const addSel = $('#add_cash_id');
  if (addSel) {
    addSel.innerHTML = html;
    addSel.value = def ? String(def.id) : '0';
  }
}

async function openAdjust(id) {
  const h = allHoldings.find((x) => String(x.id) === String(id));
  if (!h) { toast('未找到该持仓', 'err'); return; }
  $('#adj_id').value = h.id;
  $('#div_id').value = h.id;
  await loadCashAccounts();
  renderAdjCashSelect(h);   // 复用：填充（改名后的）加减仓面板资金账户下拉（#add_cash_id）
  renderDivCashSelect(h);
  $('#adjustTitle').textContent = '加减仓 · ' + (h.name || h.symbol);
  // 分红面板复位
  $('#div_mode').value = 'per_share';
  $('#div_per_share').value = '';
  $('#div_total').value = '';
  $('#div_fee').value = '';
  $('#div_per_share_out').value = '';
  $('#div_amount').value = '';
  $('#div_note').value = '';
  $('#divErr').textContent = '';
  $('#divPreview').style.display = 'none';
  $('#div_method').value = 'cash';
  $('#div_date').value = todayStr();
  $('#add_date').value = todayStr();
  // 改「交易日期」→ 重新按该日收盘净值取价（补录历史补仓时不会沿用最新净值）
  $('#add_date').onchange = () => {
    const pe = document.getElementById('addNewPrice');
    if (pe) delete pe.dataset.navDate;
    syncAdjNavPrice(true);
  };
  renderDivModePills();
  renderDivMethodPills();
  syncDivModeUI();
  syncDivMethodUI();
  prefillAdjCalc(h);
  renderAdjModePills();
  renderAdjSidePills();
  syncAdjModeUI();
  // 默认展示「加减仓」（原调仓）tab
  document.querySelectorAll('#adjustModal .adj-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'calc'));
  document.querySelectorAll('#adjustModal .adj-panel').forEach((p) => { p.hidden = p.dataset.panel !== 'calc'; });
  $('#adjustModal').hidden = false;
  const firstInput = document.querySelector('#adjustModal .adj-calc input');
  if (firstInput) firstInput.focus();
}

// 分红 tab：入账账户下拉（与加减仓同规则——只列该持仓同来源同币种的现金账户，预选余额最大）
function renderDivCashSelect(h) {
  const sel = $('#div_cash_id');
  if (!sel) return;
  const srcId = Number(h && h.source_id) || 0;
  const cur = normCur(h && h.currency);
  const list = (cashAccountsCache || []).filter((c) => Number(c.source_id) === srcId && normCur(c.currency) === cur);
  const opts = list.map((c) => {
    const csym = c.currency === 'usd' ? '＄' : (c.currency === 'hkd' ? 'HK＄' : '¥');
    return `<option value="${c.id}">${esc(c.name)}（${csym}${fmt(c.amount || 0)}）</option>`;
  }).join('');
  sel.innerHTML = `<option value="0">（自动：余额最大的同币种子账户）</option>` + opts;
  const def = pickFallbackCash(list);
  sel.value = def ? String(def.id) : '0';
}

// 修改持仓弹框（加减仓）：计算方式 / 买卖方向 改为胶囊（沿用添加持仓的 at-chip-toggle 外观）。
// 值仍承载在隐藏 input（id 保持 addMode / addSide），下方 calcAdd/apply 逻辑无需改动。
function renderAdjModePills() {
  const box = document.getElementById('addModePills');
  if (!box) return;
  const cur = document.getElementById('addMode').value || 'qty';
  const opts = [['qty', '按数量'], ['amount', '按金额']];
  box.innerHTML = opts.map(([v, l]) => `<button type="button" class="at-chip-toggle${cur === v ? ' on' : ''}" data-v="${v}">${l}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      document.getElementById('addMode').value = b.dataset.v;
      renderAdjModePills();
      syncAdjModeUI();
    };
  });
}
function renderAdjSidePills() {
  const box = document.getElementById('addSidePills');
  if (!box) return;
  const cur = document.getElementById('addSide').value || 'buy';
  const opts = [['buy', '买入'], ['sell', '卖出']];
  box.innerHTML = opts.map(([v, l]) => `<button type="button" class="at-chip-toggle${cur === v ? ' on' : ''}" data-v="${v}">${l}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      document.getElementById('addSide').value = b.dataset.v;
      renderAdjSidePills();
      syncAdjSideUI();
      // 切换方向后旧试算结果（按另一方向算的）作废
      const r = document.getElementById('addResult'); if (r) r.innerHTML = '';
      lastAdd = null;
      const ab = document.getElementById('addApply'); if (ab) ab.disabled = true;
    };
  });
}
// 买卖方向切换：动态更新下方输入标签（买入=补仓 / 卖出=减仓）
function syncAdjSideUI() {
  const isSell = document.getElementById('addSide').value === 'sell';
  const qL = document.getElementById('addQtyLabel');
  const aL = document.getElementById('addAmtLabel');
  const pL = document.getElementById('addPriceLabel');
  if (qL) qL.textContent = isSell ? '减仓数量' : '补仓数量';
  if (aL) aL.textContent = isSell ? '减仓金额' : '补仓金额';
  if (pL) pL.textContent = isSell ? '减仓价' : '补仓价';
}
// 计算方式切换：同步下方输入行显隐（原 select onchange 逻辑）；按金额→金额框、按数量→数量框
function syncAdjModeUI() {
  const isAmt = document.getElementById('addMode').value === 'amount';
  const qw = document.getElementById('addQtyWrap'); if (qw) qw.style.display = isAmt ? 'none' : '';
  const aw = document.getElementById('addAmtWrap'); if (aw) aw.style.display = isAmt ? '' : 'none';
}

// 分红预览：per_share 模式 总额 = 每股 × 份额；total 模式 每股 = 总额 ÷ 份额。
// 新成本 = 原成本 − 每股（税前口径，不扣费用）；费用只从现金入账里扣。
function computeDivPreview() {
  const h = allHoldings.find((x) => String(x.id) === String($('#div_id').value));
  const mode = $('#div_mode').value || 'per_share';
  const fee = Math.max(0, parseFloat($('#div_fee').value) || 0);
  const box = $('#divPreview');
  let per = 0;
  if (mode === 'total') {
    const total = parseFloat($('#div_total').value);
    per = (h && isFinite(total) && total > 0 && h.quantity > 0) ? total / h.quantity : 0;
    $('#div_per_share_out').value = per > 0 ? per.toFixed(4) : '';
    $('#div_amount').value = (isFinite(total) && total > 0) ? String(total) : '';
  } else {
    per = parseFloat($('#div_per_share').value);
    $('#div_amount').value = (h && isFinite(per) && per > 0) ? (per * h.quantity).toFixed(4) : '';
  }
  updateDivAutoRows();
  box.style.display = 'none';
  if (!h || !isFinite(per) || per <= 0) { box.innerHTML = ''; return; }
  const total = per * h.quantity;
  const method = $('#div_method').value || 'cash';
  box.style.display = 'block';
  if (method === 'reinvest') {
    const nav = h.current_price > 0 ? h.current_price : 0;
    if (nav <= 0) { box.innerHTML = '<span class="warn">当前无净值，无法计算红利再投份额</span>'; return; }
    const newShares = total / nav;
    const newQty = h.quantity + newShares;
    const newCost = newQty > 0 ? (h.quantity * h.cost_price + total) / newQty : h.cost_price;
    box.innerHTML = `红利再投：分红总额 <b>${fmt(total)}</b>｜按净值 ${fmtNav(nav, isFund(h) ? 'fund' : 'stock')} 买入 <b>${fmt(newShares)}</b> 份` +
      `<br>新份额 <b>${fmt(newQty)}</b>｜新成本价 <b>${fmtNav(newCost, isFund(h) ? 'fund' : 'stock')}</b>（份额增加、不出现金）`;
    return;
  }
  const newCost = h.cost_price - per;
  if (newCost < 0) { box.style.display = 'block'; box.innerHTML = '<span class="warn">折算每股分红超过当前成本价，成本价不能为负</span>'; return; }
  const cut = h.cost_price > 0 ? ((per / h.cost_price) * 100).toFixed(2) : '0';
  let html = `分红总额 <b>${fmt(total)}</b>｜折算每股 <b>${fmtNav(per, isFund(h) ? 'fund' : 'stock')}</b>｜新成本价 <b>${fmtNav(newCost, isFund(h) ? 'fund' : 'stock')}</b>` +
    `（原 ${fmtNav(h.cost_price, isFund(h) ? 'fund' : 'stock')}，降低 ${cut}%）｜份额不变 ${fmt(h.quantity)}`;
  if (fee > 0) html += `<br>扣除费用 <b>${fmt(fee)}</b> → 现金实际入账 <b>${fmt(total - fee)}</b>（费用另记一笔「费用」流水）`;
  box.innerHTML = html;
}

// 分红方式小胶囊：每股分红（按股派息）｜分红总额（账单只给累计金额时用）
function renderDivModePills() {
  const box = $('#divModePills');
  if (!box) return;
  const cur = $('#div_mode').value || 'per_share';
  const opts = [['per_share', '每股分红'], ['total', '分红总额']];
  box.innerHTML = opts.map(([v, l]) => `<button type="button" class="at-chip-toggle${cur === v ? ' on' : ''}" data-v="${v}">${l}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      $('#div_mode').value = b.dataset.v;
      renderDivModePills();
      syncDivModeUI();
      computeDivPreview();
    };
  });
}
// 分红方式切换：显隐每股/总额输入框与自动回显行，费用输入两种模式都可用
function syncDivModeUI() {
  const isTotal = $('#div_mode').value === 'total';
  const per = $('#divPerWrap'), tot = $('#divTotalWrap');
  if (per) per.hidden = isTotal;
  if (tot) tot.hidden = !isTotal;
  updateDivAutoRows();
  const ps = $('#div_per_share');
  if (ps) ps.required = !isTotal;
}
// 分红去向胶囊：现金分红（cash，默认）｜红利再投（reinvest，增加份额、不出现金）
function renderDivMethodPills() {
  const box = $('#divMethodPills');
  if (!box) return;
  const cur = $('#div_method').value || 'cash';
  const opts = [['cash', '现金分红'], ['reinvest', '红利再投']];
  box.innerHTML = opts.map(([v, l]) => `<button type="button" class="at-chip-toggle${cur === v ? ' on' : ''}" data-v="${v}">${l}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      $('#div_method').value = b.dataset.v;
      renderDivMethodPills();
      syncDivMethodUI();
      computeDivPreview();
    };
  });
}
// 分红去向切换：红利再投时隐藏「入账账户」与「扣除费用」（不出现金，费用不参与再投）
function syncDivMethodUI() {
  const isReinvest = ($('#div_method').value || 'cash') === 'reinvest';
  const cashWrap = $('#divCashWrap'), feeWrap = $('#divFeeWrap');
  if (cashWrap) cashWrap.hidden = isReinvest;
  if (feeWrap) feeWrap.hidden = isReinvest;
}
// 自动回显行（分红总额（自动）/ 折算每股（自动））：有内容才显示（同 .adj-preview 先隐藏后展示的口径），空值时不占位
function updateDivAutoRows() {
  const isTotal = $('#div_mode').value === 'total';
  const auto = $('#divAmountWrap'), out = $('#divPerShareOutWrap');
  if (auto) auto.hidden = isTotal || !$('#div_amount').value;
  if (out) out.hidden = !isTotal || !$('#div_per_share_out').value;
}

$('#dividendForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#div_id').value;
  const h = allHoldings.find((x) => String(x.id) === String(id));
  const mode = $('#div_mode').value || 'per_share';
  const method = $('#div_method').value || 'cash';
  const fee = method === 'reinvest' ? 0 : Math.max(0, round4(parseFloat($('#div_fee').value) || 0));
  let per = 0, total = 0;
  if (mode === 'total') {
    total = round4(parseFloat($('#div_total').value) || 0);
    if (!isFinite(total) || total <= 0) { $('#divErr').textContent = '请输入大于 0 的分红总额'; return; }
    if (!h || h.quantity <= 0) { $('#divErr').textContent = '份额为 0，无法按总额折算'; return; }
    per = total / h.quantity;
    if (h.cost_price - per < 0) { $('#divErr').textContent = '折算每股分红超过当前成本价'; return; }
  } else {
    per = round4(parseFloat($('#div_per_share').value) || 0);
    if (!isFinite(per) || per <= 0) { $('#divErr').textContent = '请输入大于 0 的每股分红'; return; }
    if (h && h.cost_price - per < 0) { $('#divErr').textContent = '每股分红超过当前成本价'; return; }
  }
  const note = $('#div_note').value.trim();
  $('#divErr').textContent = '';
  try {
    const r = await api('/api/holdings/' + id + '/dividend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode, per_share: mode === 'total' ? 0 : per, total_amount: mode === 'total' ? total : 0, fee,
        cash_account_id: method === 'reinvest' ? 0 : (Number($('#div_cash_id').value) || 0),
        date: normDateInput($('#div_date')), method, note,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { $('#divErr').textContent = d.error || ('操作失败 (HTTP ' + r.status + ')'); return; }
    const hh = d.holding;
    if (method === 'reinvest') {
      toast(`红利再投成功：${hh.name} 新增份额（分红总额 ${fmt(d.dividend_total || 0)}）｜新成本价 ${fmtNav(hh.cost_price, isFund(hh) ? 'fund' : 'stock')}`, 'ok');
    } else {
      const feeTxt = d.fee > 0 ? `｜费用 -${fmt(d.fee)}｜净入账 ${fmt(d.net_cash || 0)}` : '';
      toast(`分红成功：${hh.name} 入账 ${fmt(d.dividend_total || 0)}${feeTxt}｜成本价 ${fmtNav(hh.cost_price, isFund(hh) ? 'fund' : 'stock')}`, 'ok');
    }
    $('#adjustModal').hidden = true;
    await load();
  } catch (err) {
    $('#divErr').textContent = '操作异常：' + err.message;
  }
};
['div_total', 'div_fee'].forEach((fid) => {
  const el = document.getElementById(fid);
  if (el) el.addEventListener('input', computeDivPreview);
});

// 加减仓/分红交易记录已迁至「历史盈亏」弹框的交易记录分段（renderHistTxTable，2026-10-20）。

// 回退一笔持仓交易（加仓/减仓/分红），仅最新一笔可回退（后端 LIFO 校验）
async function revertAdjTx(id, txID) {
  openConfirm({
    title: '回退该笔交易',
    msg: '将对称还原份额/成本价与资金账户余额（减仓还会撤销已实现盈亏台账）。仅最新一笔可回退。是否继续？',
    okText: '回退', danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/holdings/' + id + '/transactions/' + txID + '/revert', { method: 'POST' });
        if (!r.ok) { let m = '回退失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
        toast('已回退该笔交易', 'ok');
        await loadAsset();
        // 回退会改变份额/成本与已实现盈亏 → 曲线与交易记录都要重拉（保留当前分段）
        if (histHistId === Number(id)) await reloadHistData();
      } catch (err) { toast('异常：' + err.message, 'err'); }
    },
  });
}
// 修改持仓弹框 tab 切换（加减仓 / 分红）
document.querySelectorAll('#adjustModal .adj-tab').forEach((b) => {
  b.addEventListener('click', () => {
    const tab = b.dataset.tab;
    document.querySelectorAll('#adjustModal .adj-tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('#adjustModal .adj-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  });
});

let pendingDelId = null;
let pendingSnapDelete = null;
let pendingExport = false;
let pendingConfirmCb = null; // 通用确认弹框（复用 #confirmModal）的确认回调
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
  const full = !!(document.getElementById('fullMigrateChk') && document.getElementById('fullMigrateChk').checked);
  $('#confirmMsg').textContent = full
    ? '将导出【完整迁移】数据（持仓 / 理财 / 现金 / 负债 + 收支计划 / 来源账户 / AI配置 / 应用设置 / 净值历史）为 JSON 文件，是否继续？'
    : '将导出全部资产数据（持仓 / 理财 / 现金 / 负债）为 JSON 文件，是否继续？';
  $('#confirmModal').hidden = false;
}
// 通用确认弹框（复用导出数据用的 #confirmModal）：按需显示 标题/正文/按钮文案，确认后执行 onOk 回调
function openConfirm({ title = '确认操作', msg = '', okText = '确定', cancelText, danger = false, onOk, onCancel } = {}) {
  pendingConfirmCb = onOk || null;
  pendingCancelCb = onCancel || null;
  const ok = $('#confirmOk');
  ok.textContent = okText;
  ok.classList.toggle('danger', !!danger);
  const cb = $('#confirmCancel');
  if (cancelText) cb.textContent = cancelText; else cb.textContent = '取消';
  $('#confirmTitle').textContent = title;
  $('#confirmMsg').textContent = msg;
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
  pendingConfirmCb = null;
  pendingCancelCb = null;
  const btn = $('#confirmOk');
  btn.textContent = '删除';
  btn.classList.remove('primary');
  btn.classList.add('danger');
  $('#confirmTitle').textContent = '确认删除';
  const cb = $('#confirmCancel');
  cb.textContent = '取消';
  cb.classList.remove('primary');
}
let pendingCancelCb = null;
$('#confirmCancel').onclick = () => {
  const cb = pendingCancelCb;
  pendingCancelCb = null;
  resetConfirm();
  if (cb) cb();
};
$('#confirmOk').onclick = async () => {
  if (pendingConfirmCb) {
    const cb = pendingConfirmCb;
    pendingConfirmCb = null;
    $('#confirmModal').hidden = true;
    try { await cb(); } catch (e) { toast('操作异常：' + e.message, 'err'); }
    return;
  }
  if (pendingApplyAdd) {
    pendingApplyAdd = false;
    $('#confirmModal').hidden = true;
    const a = lastAdd;
    const id = $('#adj_id').value;
    try {
      const r = await api('/api/holdings/' + id + '/adjust', { method: 'POST', body: JSON.stringify({ type: a.side || 'buy', quantity: a.q1, price: a.p1, fee: a.fee, cash_account_id: Number($('#add_cash_id').value) || 0, note: '调仓计入', date: normDateInput($('#add_date')) }) });
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
      let msg = `导入完成：持仓 ${im.holdings || 0} 理财 ${im.wealth || 0} 现金 ${im.cash || 0} 负债 ${im.liability || 0} 账户 ${im.sources || 0}`;
      const extra = [];
      if (im.plans) extra.push('收支计划 ' + im.plans);
      if (im.ai_config) extra.push('AI配置 1');
      if (im.settings) extra.push('设置 ' + im.settings);
      if (im.calc_inputs) extra.push('计算器 ' + im.calc_inputs);
      if (im.pnl_history) extra.push('净值历史 ' + im.pnl_history);
      if (extra.length) msg += '；' + extra.join(' / ');
      msg += `；跳过 ${sk.holdings || 0}/${sk.wealth || 0}/${sk.cash || 0}/${sk.liability || 0}`;
      toast(msg, 'ok');
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
      toast('已清空当前账本数据', 'ok');
      await load();
      await loadAsset();
      await loadAISettings();
      await refreshUsers();
    } catch (e) { toast('清空异常：' + e.message, 'err'); }
    return;
  }
  if (pendingAssetDel) {
    const { type, id } = pendingAssetDel;
    $('#confirmModal').hidden = true;
    pendingAssetDel = null;
    const paths = { source: '/api/asset/sources/', wealth: '/api/asset/wealth/', cash: '/api/asset/cash/', liability: '/api/asset/liabilities/', cashflow: '/api/cashflow/plans/' };
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
      toast('已删除该日快照（可在本表撤销）', 'ok');
      // 撤销已并入「每日盈亏」单表：原地刷新合并视图（保留当前范围），再同步账户总资产
      await reloadWealthHist();
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
// 「添加」按钮：先弹类型选择（持仓 / 理财），再打开对应弹框。
// 默认高亮跟随顶部类别胶囊 —— 胶囊停在「理财」时默认选理财，否则默认选持仓。
// 添加持仓 / 理财快照 / 基金定投：入口保留在首页「快捷功能」卡片（见 renderHomeDashboard）。
// 投资页原右侧按钮已按需求移除，对应入口改为：盈亏日历 / AI 助手在右上角操作区（act-group）。
$('#dcaPlansClose').onclick = () => { $('#dcaPlansModal').hidden = true; };
$('#dcaPlansNew').onclick = () => { $('#dcaPlansModal').hidden = true; openDCAModal(null); };
// 右上角操作区按钮：AI 助手（盈亏日历 2026-10-28 已提为顶栏图标按钮 #pnlCalTopBtn，窄屏仍走个人菜单 pnl-cal）
const _aiTop = document.getElementById('aiChatTopBtn');
if (_aiTop) _aiTop.onclick = () => aiChatToggle();
function openAddPick() {
  const wealthFirst = homeSection === 'wealth';
  const box = document.querySelector('#addPickModal .add-pick');
  if (box) {
    // 顺序即默认项：胶囊选理财时把「理财」放首位并标 primary
    const hold = box.querySelector('[data-add-kind="holding"]');
    const wealth = box.querySelector('[data-add-kind="wealth"]');
    if (hold && wealth) {
      wealth.classList.toggle('primary', wealthFirst);
      hold.classList.toggle('primary', !wealthFirst);
      if (wealthFirst) box.insertBefore(wealth, hold); else box.insertBefore(hold, wealth);
    }
  }
  $('#addPickModal').hidden = false;
}
$('#addPickModal').addEventListener('click', (e) => {
  const it = e.target.closest('[data-add-kind]');
  if (!it) return;
  $('#addPickModal').hidden = true;
  if (it.dataset.addKind === 'wealth') openWealthModal(null);
  else openModal(null);
});
// 名称/代码联想框初始化（类别/市场已改为胶囊，不再用下拉框 onchange）
wireSearch();
// 首页「刷新」按钮已移除：手动整体刷新入口取消，行情改由定时快照自动更新。
// （批量 /api/refresh 接口仍保留供定时任务复用。）

// 投资页主区切换（持仓 / 理财）：localStorage 记忆，默认持仓；下划线样式（无滑动白块）
function syncViewToggle() {
  document.querySelectorAll('#viewToggle .sub-tab').forEach((x) => x.classList.toggle('active', x.dataset.view === homeSection));
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
// 通用：根据指定切换器内当前 active 按钮定位滑动白块（首页/资产/日历多个切换器共用）
function positionIndicatorFor(toggleId, indId) {
  const ind = document.getElementById(indId);
  if (!ind) return;
  const active = document.querySelector('#' + toggleId + ' .vt-btn.active');
  if (!active) return;
  ind.style.width = active.offsetWidth + 'px';
  ind.style.transform = 'translateX(' + active.offsetLeft + 'px)';
}
document.querySelectorAll('#viewToggle .sub-tab').forEach((b) => {
  b.onclick = () => {
    homeSection = b.dataset.view;
    localStorage.setItem('pf_home_section', homeSection);
    syncViewToggle();
    renderFiltered();
  };
});
syncViewToggle();
window.addEventListener('resize', () => { positionIndicator(); });
setTimeout(positionIndicator, 0); // 字体/布局稳定后校正初始位置
$('#emptyAddBtn').onclick = () => openModal(null);
// 文本筛选（设计系统：搜索框 + 「/」聚焦 + Enter 提交）
(function wireFilter() {
  const fi = document.getElementById('filterInput');
  if (!fi) return;
  const apply = () => { textFilter = fi.value.trim().toLowerCase(); renderFiltered(); };
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
  else if (k === 'source') openAssetSourceModal(null);
});
// 首页理财视图（#homeWealthBox，2026-10-09 迁入）：空状态「添加第一笔理财」按钮委托
const homeWealthEl = document.getElementById('homeWealthBox');
if (homeWealthEl) homeWealthEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-empty-add="wealth"]');
  if (b) openWealthModal(null);
});
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  $('#formErr').textContent = '';
  const id = $('#f_id').value;
  const eid = parseInt(id, 10);
  const orig = allHoldings.find((x) => x.id === eid);
  // 账户·币种：从所选子账户派生 source_id + currency
  const selCash = (cashAccountsCache || []).find((x) => String(x.id) === String($('#f_cash').value));
  if (!selCash) { $('#formErr').textContent = '请选择账户（子账户）'; return; }
  const submitSource = Number(selCash.source_id) || 0;
  const submitCurrency = selCash.currency;
  // 名称/代码：优先用联想选中的标的；手动输入时取框内容，疑似代码则同时作为代码。
  let finalName, finalSymbol;
  if (curSel) {
    finalName = curSel.name;
    finalSymbol = curSel.symbol;
  } else {
    const v = $('#f_search').value.trim();
    finalName = v;
    finalSymbol = looksLikeCode(v) ? v.toUpperCase() : '';
  }
  // 编辑态：若未改动名称（未走联想选中），沿用原代码，避免误触丢失代码。
  if (!finalSymbol && orig && finalName === orig.name) finalSymbol = orig.symbol || '';
  if (!finalName) { $('#formErr').textContent = '请填写名称或代码'; return; }
  if (!selMkt && selCat !== 'fund') { $('#formErr').textContent = '请选择市场'; return; }
  $('#f_name').value = finalName;
  $('#f_symbol').value = finalSymbol;
  const payload = {
    name: finalName,
    symbol: finalSymbol,
    market: $('#f_market').value,
    category: selCat,
    currency: submitCurrency,
    source_id: submitSource,
    cash_account_id: Number($('#f_cash').value) || 0, // 出资子账户：新建自动扣款，编辑按差值联动调账
    quantity: round4(parseFloat($('#f_quantity').value)),
    cost_price: roundByCat(parseFloat($('#f_cost_price').value), selCat),
    transaction_cost: roundByCat(parseFloat($('#f_cost').value || '0'), selCat),
    // 现价不再由用户填写：新增时默认＝成本价（未更新前按成本计市值，盈亏 0）；编辑时沿用库中原值（由每日行情快照自动刷新）
    current_price: (id && orig) ? roundByCat(Number(orig.current_price) || 0, selCat) : roundByCat(parseFloat($('#f_cost_price').value || '0'), selCat),
    prev_close: roundByCat((orig ? orig.prev_close : 0), selCat),
    note: $('#f_note').value || '',
    buy_date: normDateInput($('#f_buy_date')) || '',
    linked_symbol: (() => {
      const m = $('#f_linked_market').value;
      const c = $('#f_linked_code').value.trim();
      return c ? `${m}:${c}` : '';
    })(),
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

// Asset composition pie: 现金 / 股票 / 基金 / 理财 across the WHOLE portfolio,
// with click-to-drill second-level breakdown (e.g. 股票 -> each sub-stock's share).
// 分类色统一走 CSS 变量（亮/暗两套，见 style.css --cat-*），此处存变量名供 rgb()/rgba() 拼接。
const PIE_CAT = { 理财: '--cat-wealth', 基金: '--cat-fund', 股票: '--cat-equity' };

// Top-level segments (股票/基金/理财), values already in CNY.
// 现金段已删（2026-10-10）：现金非投资持仓，资产构成饼图不再画，总盘子即「投资市值 + 理财」。
function getTopSegs(d) {
  const eq = d.equity || {};
  let stock = 0, fund = 0;
  (eq.items || []).forEach((h) => {
    const mv = h.market_value || 0; // 后端已折算为 CNY
    if (!isFund(h)) stock += mv;
    else if (isFund(h)) fund += mv;
  });
  const wealth = (d.wealth && d.wealth.total) || 0; // CNY
  const seg = { 股票: stock, 基金: fund, 理财: wealth };
  return Object.keys(seg)
    .map((k) => ({ label: k, value: seg[k], color: `rgb(var(${PIE_CAT[k]}))` }))
    .filter((s) => s.value > 0);
}

// Second-level items within a top-level category, values converted to CNY.
function getSubSegs(d, key) {
  let items = [];
  if (key === '股票' || key === '基金') {
    const cat = key === '股票' ? 'stock' : 'fund';
    items = (d.equity ? d.equity.items : []).filter((h) => (isFund(h) ? 'fund' : 'stock') === cat)
      .map((h) => ({ label: h.name || h.symbol || '未命名', value: h.market_value || 0, _item: h }));
  } else if (key === '理财') {
    items = (d.wealth ? d.wealth.products : []).map((p) => ({ label: p.name || p.code || '理财', value: toRmb(p, p.amount || 0), _item: p }));
  }
  // 仅保留正值，并按总金额从小到大排序（饼图扇区与图例均按此顺序）
  items = items.filter((s) => s.value > 0).sort((a, b) => a.value - b.value);
  const n = items.length;
  // 透明度按 10% 递减：占比越大越不透明（最大=1.0），最小不低于 0.4 以保证可见。
  // 用「同色相（分类 CSS 变量）+ 透明度阶梯」区分子项，并自动跟随亮/暗主题。
  return items.map((it, i) => {
    const op = Math.max(0.4, 1 - (n - 1 - i) * 0.1);
    return { ...it, color: `rgba(var(${PIE_CAT[key]}),${op.toFixed(2)})` };
  });
}

// 饼图目标容器：默认渲染进 #chartBody（图表弹框）。
let pieTargetSel = '#chartBody';
// Draw a pie (single-level) + legend into #chartBody.
function drawPie(segs, total, title, opts) {
  opts = opts || {};
  setPieBackArrow(null); // 顶层视图不显示返回箭头
  $('#chartTitle').textContent = title;
  if (total <= 0 || segs.length === 0) { document.querySelector(pieTargetSel).innerHTML = '<p class="u-muted">暂无数据</p>'; if (pieTargetSel === '#chartBody') openChart(); return; }
  const cx = 110, cy = 110, r = 90;
  let paths;
  if (segs.length === 1) {
    paths = `<circle cx="${cx}" cy="${cy}" r="${r}" class="pie-seg${opts.onSeg ? ' on-seg' : ''}" style="--st:${segs[0].color}"${opts.onSeg ? ` data-label="${esc(segs[0].label)}"` : ''}/>`;
  } else {
    let angle = -Math.PI / 2;
    paths = '';
    segs.forEach((s) => {
      const frac = s.value / total;
      const a2 = angle + frac * 2 * Math.PI;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      paths += `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" class="pie-seg${opts.onSeg ? ' on-seg' : ''}" style="--st:${s.color}"${opts.onSeg ? ` data-label="${esc(s.label)}"` : ''}/>`;
      angle = a2;
    });
  }
  const legend = segs.map((s) => {
    const p = (s.value / total * 100).toFixed(1);
    return `<div data-label="${esc(s.label)}" class="pie-leg-item${opts.onSeg ? ' on-seg' : ''}">
      <span class="pie-leg-swatch" style="--bg:${s.color}"></span>
      <span>${esc(s.label)}</span><span class="u-bold">¥${fmt(s.value)} (${p}%)</span></div>`;
  }).join('');
  const hint = opts.onSeg ? `<div class="pie-hint">${opts.hint || '点击区块可查看二级细分'}</div>` : '';
  document.querySelector(pieTargetSel).innerHTML = `${hint}<div class="u-row u-wrap u-center u-gap-6">
    <div class="u-row u-wrap u-center u-gap-6"><svg width="220" height="220" viewBox="0 0 220 220">${paths}</svg></div>
    <div class="u-col u-gap-2">${legend}</div></div>`;
  if (opts.onSeg) {
    document.querySelector(pieTargetSel).querySelectorAll('[data-label]').forEach((el) => (el.onclick = () => opts.onSeg(el.dataset.label)));
  }
  if (pieTargetSel === '#chartBody') openChart();
}

async function renderPie(opts) {
  opts = opts || {};
  if (opts.target) pieTargetSel = opts.target;
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
  drawPie(segs, total, '资产构成（股票 / 基金 / 理财）', {
    onSeg: (label) => showPieDrill(label),
  });
}

// 下钻「← 返回总览」按钮：注入到弹框标题内、文本之前（资产构成弹框用 #acCompTitle，独立图表弹框用 #chartTitle）。
// 顶层视图（onBack 为空）时整体移除，空行由 CSS :empty 收起，不留空白。
function setPieBackArrow(onBack) {
  const titleSel = '#chartTitle';
  const titleEl = document.querySelector(titleSel);
  if (!titleEl) return;
  let arrow = titleEl.querySelector('.pie-back-inline');
  if (!onBack) { if (arrow) arrow.remove(); return; }
  if (!arrow) {
    arrow = document.createElement('span');
    arrow.className = 'pie-back-inline';
    titleEl.insertBefore(arrow, titleEl.firstChild);
  }
  arrow.textContent = '← 返回总览';
  arrow.title = '返回总览';
  arrow.onclick = onBack;
}

// 二级饼图（最底层，不再下钻）：环形 donut + 紧凑图例，hover 图例项 → 对应扇区高亮、其余淡化、中心显示该项信息。
function drawPieHover(segs, total, title, opts) {
  opts = opts || {};
  $('#chartTitle').textContent = title;
  const host = document.querySelector(pieTargetSel);
  if (total <= 0 || segs.length === 0) { host.innerHTML = '<p class="u-muted">暂无数据</p>'; if (pieTargetSel === '#chartBody') openChart(); return; }

  const cx = 110, cy = 110, rOut = 96, rIn = 56;
  let angle = -Math.PI / 2;
  const arcs = segs.map((s, i) => {
    const frac = s.value / total;
    const a1 = angle, a2 = angle + frac * 2 * Math.PI;
    angle = a2;
    return { s, a1, a2, frac, i };
  });

  const segPath = (o) => {
    if (o.frac >= 0.9999) {
      return `<path class="pie-seg" data-idx="${o.i}" fill-rule="evenodd" style="--st:${o.s.color}" d="M ${cx - rOut} ${cy} A ${rOut} ${rOut} 0 1 0 ${cx + rOut} ${cy} A ${rOut} ${rOut} 0 1 0 ${cx - rOut} ${cy} Z M ${cx - rIn} ${cy} A ${rIn} ${rIn} 0 1 1 ${cx + rIn} ${cy} A ${rIn} ${rIn} 0 1 1 ${cx - rIn} ${cy} Z"/>`;
    }
    const large = o.frac > 0.5 ? 1 : 0;
    const x1 = cx + rOut * Math.cos(o.a1), y1 = cy + rOut * Math.sin(o.a1);
    const x2 = cx + rOut * Math.cos(o.a2), y2 = cy + rOut * Math.sin(o.a2);
    const x3 = cx + rIn * Math.cos(o.a2), y3 = cy + rIn * Math.sin(o.a2);
    const x4 = cx + rIn * Math.cos(o.a1), y4 = cy + rIn * Math.sin(o.a1);
    return `<path class="pie-seg" data-idx="${o.i}" style="--st:${o.s.color}" d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rOut} ${rOut} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${rIn} ${rIn} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z"/>`;
  };
  const paths = arcs.map(segPath).join('');

  const legend = segs.map((s, i) => {
    const p = (s.value / total * 100).toFixed(1);
    return `<div class="legend-item u-row u-gap-2 u-sm" data-idx="${i}">
      <span class="pie-leg-swatch u-shrink-0" style="--bg:${s.color}"></span>
      <span class="u-grow u-break">${esc(s.label)}</span>
      <span class="u-bold u-shrink-0">¥${fmt(s.value)}</span>
      <span class="u-muted u-shrink-0 legend-pct">${p}%</span>
    </div>`;
  }).join('');

  // 返回总览箭头：注入弹框标题前（资产构成文本前），紧凑不占额外高度
  setPieBackArrow(opts.onBack ? opts.onBack : null);
  const centerDef = opts.center || '二级占比';
  host.innerHTML = `<div class="u-row u-wrap u-center u-gap-6">
    <svg width="220" height="220" viewBox="0 0 220 220">
      ${paths}
      <text id="pieCenter1" x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="13" class="pie-center">${esc(centerDef)}</text>
      <text id="pieCenter2" x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="12" class="chart-label">¥${fmt(total)}</text>
    </svg>
    <div class="pie-legend-scroll">${legend}</div>
  </div>`;

  const segsEls = host.querySelectorAll('.pie-seg');
  const c1 = host.querySelector('#pieCenter1'), c2 = host.querySelector('#pieCenter2');
  host.querySelectorAll('.legend-item').forEach((el) => {
    const idx = +el.dataset.idx;
    el.addEventListener('mouseenter', () => {
      segsEls.forEach((p) => { const di = +p.dataset.idx; p.classList.toggle('dim', di !== idx); p.classList.toggle('active', di === idx); });
      el.classList.add('active');
      const s = segs[idx];
      c1.textContent = esc(s.label);
      c2.textContent = (s.value / total * 100).toFixed(1) + '%';
    });
    el.addEventListener('mouseleave', () => {
      segsEls.forEach((p) => p.classList.remove('dim', 'active'));
      el.classList.remove('active');
      c1.textContent = centerDef;
      c2.textContent = '¥' + fmt(total);
    });
  });

  if (opts.onBack) {
    const b = host.querySelector('[data-back]');
    if (b) b.onclick = opts.onBack;
  }
  if (pieTargetSel === '#chartBody') openChart();
}

// Drill into a top-level category: show each sub-item's share (二级细分占比). 二级为最底层，不再下钻。
function showPieDrill(key) {
  const d = pieData || assetData || {};
  const sub = getSubSegs(d, key);
  const total = sub.reduce((a, s) => a + s.value, 0);
  drawPieHover(sub, total, `资产构成 › ${key}（二级细分占比）`, {
    onBack: () => renderPie({ target: pieTargetSel }),
    center: key,
  });
}

// ===== 彩色组合圆环（donut）=====

// 盈亏走势 / 持仓历史 的 SVG 渐变 id 序号：两个渲染容器可能同时在 DOM 中，id 必须唯一
let trendUidSeq = 0;

// 三组共用渐变：柱涨、柱跌、折线面积。注意 SVG presentation attribute 不认 var()，
// 必须写成内联 style，主题（暗/亮、五套强调色）切换才能跟随。
function trendDefs(uid) {
  return `<defs>`
    + `<linearGradient id="${uid}Up" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0%" class="grad-up-top"/>`
    + `<stop offset="100%" class="grad-up-bottom"/></linearGradient>`
    + `<linearGradient id="${uid}Down" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0%" class="grad-down-top"/>`
    + `<stop offset="100%" class="grad-down-bottom"/></linearGradient>`
    + `<linearGradient id="${uid}Area" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0%" class="grad-area-top"/>`
    + `<stop offset="100%" class="grad-area-bottom"/></linearGradient>`
    + `</defs>`;
}

// 盈亏走势 tooltip：hover 柱子显示单日/累计盈亏
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
$('#histModal').addEventListener('click', (e) => { if (e.target === $('#histModal')) { $('#histModal').hidden = true; hideTrendTip(); } });
$('#wealthHistModal').addEventListener('click', (e) => { if (e.target === $('#wealthHistModal')) { $('#wealthHistModal').hidden = true; hideTrendTip(); } });

// 已平仓记录弹框（新增 / 编辑手动补录，不入账）
$('#closedRecordModal').addEventListener('click', (e) => { if (e.target === $('#closedRecordModal')) $('#closedRecordModal').hidden = true; });
$('#cr_kind_sel').addEventListener('change', () => { $('#cr_kind').value = $('#cr_kind_sel').value; });
$('#cr_source').addEventListener('change', syncClosedSourceCustom);
$('#crCancel').addEventListener('click', () => { $('#closedRecordModal').hidden = true; });
$('#crSave').addEventListener('click', async () => {
  const id = $('#cr_id').value;
  const name = ($('#cr_name').value || '').trim();
  if (!name) { $('#crErr').textContent = '请填写名称'; return; }
  const srcSel = $('#cr_source').value;
  const source = srcSel === CR_SRC_CUSTOM
    ? ($('#cr_source_custom').value || '').trim()
    : String(srcSel || '').trim();
  if (srcSel === CR_SRC_CUSTOM && !source) { $('#crErr').textContent = '请填写自定义账户名'; return; }
  // 本金 / 收益率：空串 → null（后端写 NULL，区别于真实的 0%）
  const numOrNull = (el) => {
    const s = String(el.value == null ? '' : el.value).trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const payload = {
    kind: $('#cr_kind_sel').value,
    name,
    code: ($('#cr_code').value || '').trim(),
    amount: parseFloat($('#cr_amount').value) || 0,
    currency: normCurJS($('#cr_currency') ? $('#cr_currency').value : 'cny'),
    principal: numOrNull($('#cr_principal')),
    return_rate: numOrNull($('#cr_rate')),
    holding_days: parseInt($('#cr_days').value, 10) || 0,
    source,
    realized_at: $('#cr_realized_at').value || '',
  };
  $('#crSave').disabled = true;
  try {
    const r = id
      ? await api('/api/manual-closed/' + id, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/manual-closed', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#crErr').textContent = m; $('#crSave').disabled = false; return; }
    await loadManualClosed();
    $('#closedRecordModal').hidden = true;
    if (homeSection === 'closed') renderFiltered();
    toast('已保存', 'ok');
  } catch (e) { $('#crErr').textContent = '异常：' + e.message; }
  $('#crSave').disabled = false;
});
// —— 批量新增已平仓（纯记录，不入账）——
// 账户 + 类型 为全局（作用于本批所有行）；下方逐行填 名称 / 代码（名称联想）/ 盈亏金额 / 天数(可选)。
// 本金不在批量录入里填（数据库该字段保留，可留空）；故批量记录的「盈亏率」不予推算。
function fillCrbSourceSelect(current) {
  const sel = $('#crb_source');
  if (!sel) return;
  const cur = String(current || '').trim();
  const names = [];
  (assetSources || []).forEach((s) => {
    const n = String(s.name || '').trim();
    if (n && names.indexOf(n) < 0) names.push(n);
  });
  let html = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  html += `<option value="${CR_SRC_CUSTOM}">其他（自定义）</option>`;
  sel.innerHTML = html;
  const known = cur && names.indexOf(cur) >= 0;
  sel.value = known ? cur : (cur ? CR_SRC_CUSTOM : '');
  $('#crb_source_custom').value = cur && !known ? cur : '';
  syncCrbSourceCustom();
}
function syncCrbSourceCustom() {
  const sel = $('#crb_source');
  const row = $('#crbSourceCustomRow');
  if (!sel || !row) return;
  const isCustom = sel.value === CR_SRC_CUSTOM;
  row.hidden = !isCustom;
  if (!isCustom) $('#crb_source_custom').value = '';
}
function openBatchClosedModal() {
  fillCrbSourceSelect('');
  $('#crb_kind').value = 'stock';
  $('#crbErr').textContent = '';
  renderBatchRows(3);
  $('#closedBatchModal').hidden = false;
}
function renderBatchRows(n) {
  const grid = $('#crbGrid');
  if (!grid) return;
  let html = '<div class="batch-row head"><span>名称</span><span>代码</span><span>盈亏金额</span><span>天数</span><span></span></div>';
  for (let i = 0; i < n; i++) {
    html += `<div class="batch-row" data-idx="${i}">
      <div class="crb-name-wrap">
        <input class="crb-name" placeholder="名称 / 代码" autocomplete="off">
        <div class="crb-suggest f-suggest" hidden></div>
      </div>
      <input class="crb-code" placeholder="代码" autocomplete="off">
      <input class="crb-amount" type="number" step="0.01" placeholder="正赚负亏" autocomplete="off">
      <input class="crb-days" type="number" step="1" min="0" placeholder="天数" autocomplete="off">
      <button type="button" class="crb-del" title="删除此行">×</button>
    </div>`;
  }
  grid.innerHTML = html;
}
$('#closedBatchModal').addEventListener('click', (e) => { if (e.target === $('#closedBatchModal')) $('#closedBatchModal').hidden = true; });
$('#crb_source').addEventListener('change', syncCrbSourceCustom);
$('#crbCancel').addEventListener('click', () => { $('#closedBatchModal').hidden = true; });
$('#crbAddRow').addEventListener('click', () => {
  const grid = $('#crbGrid');
  const div = document.createElement('div');
  div.className = 'batch-row';
  div.dataset.idx = grid.querySelectorAll('.batch-row:not(.head)').length;
  div.innerHTML = '<div class="crb-name-wrap">'
    + '<input class="crb-name" placeholder="名称 / 代码" autocomplete="off">'
    + '<div class="crb-suggest f-suggest" hidden></div></div>'
    + '<input class="crb-code" placeholder="代码" autocomplete="off">'
    + '<input class="crb-amount" type="number" step="0.01" placeholder="正赚负亏" autocomplete="off">'
    + '<input class="crb-days" type="number" step="1" min="0" placeholder="天数" autocomplete="off">'
    + '<button type="button" class="crb-del" title="删除此行">×</button>';
  grid.appendChild(div);
});
// 名称联想：与新增持仓弹框一致 —— 输入防抖 220ms 请求 /api/search（全市场），
// 浮层（复用 .f-suggest 视觉）列出结果，点击即回填名称与代码。
$('#crbGrid').addEventListener('input', (e) => {
  const t = e.target;
  if (!t.classList.contains('crb-name')) return;
  const wrap = t.closest('.crb-name-wrap');
  const pop = wrap && wrap.querySelector('.crb-suggest');
  if (!pop) return;
  const q = t.value.trim();
  if (!q) { pop.hidden = true; pop.innerHTML = ''; return; }
  clearTimeout(t._crbTimer);
  t._crbTimer = setTimeout(async () => {
    try {
      const r = await api('/api/search?q=' + encodeURIComponent(q));
      if (!r.ok) { pop.hidden = true; return; }
      const d = await r.json();
      const items = (d.results || []).slice(0, 12);
      if (!items.length) { pop.hidden = true; pop.innerHTML = ''; return; }
      pop.innerHTML = items.map((it, i) =>
        `<button type="button" class="f-suggest-item" data-i="${i}">`
        + `<span class="f-si-name">${esc(it.name)}</span>`
        + `<span class="f-si-code">${esc(it.symbol)}</span>`
        + `<span class="f-si-mkt">${esc(SEARCH_MKT_TO_PF[it.market] || it.market || '')}</span>`
        + '</button>'
      ).join('');
      // fixed 定位：按输入框视口坐标对齐（摆脱 .batch-grid overflow 裁剪）
      const rect = t.getBoundingClientRect();
      pop.style.left = rect.left + 'px';
      pop.style.width = rect.width + 'px';
      pop.style.right = 'auto';
      pop.hidden = false;
      const ph = pop.offsetHeight;
      let top = rect.bottom + 6;
      if (top + ph > window.innerHeight - 8 && rect.top - ph - 6 > 8) top = rect.top - ph - 6;
      pop.style.top = top + 'px';
      pop.querySelectorAll('.f-suggest-item').forEach((b) => {
        b.onclick = (ev) => {
          ev.preventDefault();
          const it = items[Number(b.dataset.i)];
          t.value = it.name;
          const row = t.closest('.batch-row');
          const codeEl = row && row.querySelector('.crb-code');
          if (codeEl) codeEl.value = it.symbol;
          pop.hidden = true; pop.innerHTML = '';
        };
      });
    } catch (_) { pop.hidden = true; }
  }, 220);
});
// 点击批量弹框联想浮层之外时收起所有浮层（点输入框/浮层内不收起）
document.addEventListener('click', (e) => {
  if (!e.target.closest('.crb-name-wrap')) {
    document.querySelectorAll('#crbGrid .crb-suggest').forEach((p) => { if (!p.hidden) p.hidden = true; });
  }
});
// fixed 浮层在滚动时会与输入框错位，故滚动即收起
window.addEventListener('scroll', () => {
  document.querySelectorAll('#crbGrid .crb-suggest').forEach((p) => { if (!p.hidden) p.hidden = true; });
}, true);
$('#crbGrid').addEventListener('click', (e) => {
  if (e.target.classList.contains('crb-del')) {
    const grid = $('#crbGrid');
    if (grid.querySelectorAll('.batch-row:not(.head)').length <= 1) return;
    e.target.closest('.batch-row').remove();
  }
});
$('#crbSave').addEventListener('click', async () => {
  const srcSel = $('#crb_source').value;
  const source = srcSel === CR_SRC_CUSTOM ? ($('#crb_source_custom').value || '').trim() : String(srcSel || '').trim();
  if (srcSel === CR_SRC_CUSTOM && !source) { $('#crbErr').textContent = '请填写自定义账户名'; return; }
  const kind = $('#crb_kind').value;
  const rows = [...$('#crbGrid').querySelectorAll('.batch-row:not(.head)')];
  const payloads = [];
  for (const row of rows) {
    const name = (row.querySelector('.crb-name').value || '').trim();
    if (!name) continue;
    payloads.push({
      kind,
      name,
      code: (row.querySelector('.crb-code').value || '').trim(),
      amount: parseFloat(row.querySelector('.crb-amount').value) || 0,
      currency: 'cny',
      principal: null,
      return_rate: null,
      holding_days: parseInt(row.querySelector('.crb-days').value, 10) || 0,
      source,
      realized_at: '',
    });
  }
  if (!payloads.length) { $('#crbErr').textContent = '请至少填写一行名称'; return; }
  $('#crbSave').disabled = true;
  try {
    for (const p of payloads) {
      const r = await api('/api/manual-closed', { method: 'POST', body: JSON.stringify(p) });
      if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#crbErr').textContent = m; $('#crbSave').disabled = false; return; }
    }
    await loadManualClosed();
    $('#closedBatchModal').hidden = true;
    if (homeSection === 'closed') renderFiltered();
    toast('已批量保存 ' + payloads.length + ' 条', 'ok');
  } catch (e) { $('#crbErr').textContent = '异常：' + e.message; }
  $('#crbSave').disabled = false;
});

// 资金变动方向切换：选中段置 active（CSS 负责主题色/灰色），方向由 data-sign 决定
const cashSignToggle = document.getElementById('c_sign_toggle');
if (cashSignToggle) {
  cashSignToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.sign-opt');
    if (!btn) return;
    setCashSign(btn.dataset.sign);
  });
}
// 添加流水：方向切换 + 点击遮罩关闭
const flowSignToggle = document.getElementById('flow_sign_toggle');
if (flowSignToggle) {
  flowSignToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.sign-opt');
    if (!btn) return;
    flowSetSign(btn.dataset.sign);
  });
}
$('#flowModal').addEventListener('click', (e) => { if (e.target === $('#flowModal')) hideFlow(); });
// 子账户折叠选择器统一绑定（流水 / 持仓 / 理财 / 定投 / 收支五处共用）。
// 结构一律是「按钮 + .ac-pick-head/.ac-pick-body 分组 + .ac-pick-row 子账户」，
// 差异只有选中回调 —— 先前五份独立实现曾漂移出「漏判 .ac-pick-body 类名」的分支，收敛成一处即不再有第二份口径。
// cfg: { btn, panel, picker } id 后缀；onRow(row) 选中回调；markOn 选中后维护行高亮。
function bindCashPicker(cfg) {
  const btn = document.getElementById(cfg.btn + 'CashBtn');
  const panel = document.getElementById(cfg.panel + 'CashPanel');
  const picker = document.getElementById(cfg.picker + 'CashPicker');
  if (btn && panel) btn.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  if (panel) {
    panel.addEventListener('click', (e) => {
      const head = e.target.closest('.ac-pick-head');
      if (head) {
        const body = head.nextElementSibling;
        if (body) { body.hidden = !body.hidden; head.classList.toggle('open', !body.hidden); }
        return;
      }
      const row = e.target.closest('.ac-pick-row');
      if (!row) return;
      if (cfg.markOn) {
        panel.querySelectorAll('.ac-pick-row.on').forEach((r) => r.classList.remove('on'));
        row.classList.add('on');
      }
      cfg.onRow(row);
      panel.hidden = true;
    });
  }
  if (picker) document.addEventListener('click', (e) => { if (!picker.contains(e.target)) panel.hidden = true; });
}

// 添加流水：折叠选择器（新增/编辑流水弹框）
bindCashPicker({
  btn: 'flow', panel: 'flow', picker: 'flow',
  onRow: (row) => {
    // data-kind 是 'cash'/'liab'，写入 flow_cash 的值必须用它对应的单字母前缀
    const prefixed = (row.dataset.kind === 'liab' ? 'l' : 'c') + ':' + row.dataset.id;
    const a = flowAccountById(prefixed);
    if (a) selectFlowCash(prefixed, flowAccountLabel(a.kind, a.obj));
  },
});
// 添加/编辑持仓：账户·币种合并选择器（带二级子账户折叠面板，交互同「添加流水」选择器）
// editSourceId 非空时只列该父账户下的子账户（编辑模式）。
function buildHoldPicker(editSourceId) {
  const panel = document.getElementById('holdCashPanel');
  if (!panel) return;
  setPickerHTML(panel, buildFlowPicker(editSourceId == null ? null : Number(editSourceId)));
}
function holdSetSelection(acc) {
  $('#f_cash').value = acc ? acc.id : '0';
  $('#holdCashBtn').textContent = acc ? flowCashLabel(acc) : '请选择子账户';
}
// 添加/编辑持仓：账户·币种合并选择器（带二级子账户折叠面板）
bindCashPicker({
  btn: 'hold', panel: 'hold', picker: 'hold',
  onRow: (row) => {
    const c = (cashAccountsCache || []).find((x) => String(x.id) === String(row.dataset.id));
    if (c) holdSetSelection(c);
  },
});

// ---- 添加/编辑理财：账户·币种合并选择器（与「添加持仓」同一套折叠面板） ----
function wealthSetSelection(acc) {
  $('#w_cash').value = acc ? acc.id : '0';
  $('#wealthCashBtn').textContent = acc ? flowCashLabel(acc) : '请选择子账户';
}
bindCashPicker({
  btn: 'wealth', panel: 'wealth', picker: 'wealth',
  onRow: (row) => {
    const c = (cashAccountsCache || []).find((x) => String(x.id) === String(row.dataset.id));
    if (c) wealthSetSelection(c);
  },
});

// ---- 定投计划：资金子账户二级折叠选择器（选中行保持 .on 高亮） ----
bindCashPicker({
  btn: 'dca', panel: 'dca', picker: 'dca', markOn: true,
  onRow: (row) => {
    const c = (cashAccountsCache || []).find((x) => String(x.id) === String(row.dataset.id));
    if (c) dcaSetSelection(c);
  },
});

// ---- 新建/编辑收支计划：关联账户选择器（与「添加持仓/理财」同一套二级子账户折叠面板） ----
function cfSetSelection(acc) {
  $('#cf_account_id').value = acc ? acc.id : '0';
  $('#cfCashBtn').textContent = acc ? flowCashLabel(acc) : '请选择子账户';
}
bindCashPicker({
  btn: 'cf', panel: 'cf', picker: 'cf',
  onRow: (row) => {
    const c = (cashAccountsCache || []).find((x) => String(x.id) === String(row.dataset.id));
    if (c) cfSetSelection(c);
  },
});
// 负债账户选择器只有开合，无二级子账户
const cfLiabilityBtn = document.getElementById('cfLiabilityBtn');
const cfLiabilityPanel = document.getElementById('cfLiabilityPanel');
if (cfLiabilityBtn) cfLiabilityBtn.addEventListener('click', () => { if (cfLiabilityPanel) cfLiabilityPanel.hidden = !cfLiabilityPanel.hidden; });
document.addEventListener('click', (e) => {
  const lp = document.getElementById('cfLiabilityPicker');
  if (lp && !lp.contains(e.target)) { const p = document.getElementById('cfLiabilityPanel'); if (p) p.hidden = true; }
});

// ---- P&L Calendar ----
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
// 统一日期输入框：允许 - / . 分隔，归一成后端要求的 YYYY-MM-DD；空值不变
function normDateInput(el) {
  if (!el) return '';
  const v = (el.value || '').trim();
  if (!v) return '';
  const m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) el.value = m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  return el.value;
}
// 原生 <input type="date"> 空值时会显示 yyyy/mm/日 格式占位（跟随浏览器语言，无法改成英文），
// 这里通过 .date-empty 在空值时隐藏它；有值时正常显示。程序化赋值后需手动调用一次同步。
function syncDateHint(el) {
  if (!el || el.type !== 'date') return;
  el.classList.toggle('date-empty', !el.value);
}
document.querySelectorAll('input[type="date"]').forEach(syncDateHint);
['input', 'change', 'focusout'].forEach((ev) => document.addEventListener(ev, (e) => syncDateHint(e.target), true));
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sundayOf = (d) => addDays(new Date(d), -d.getDay());
const saturdayOf = (d) => addDays(new Date(d), 6 - d.getDay());
// 两个 YYYY-MM-DD 之间的整天数差（b - a），任一缺失或非法返回 0
const daysBetween = (a, b) => {
  if (!a || !b) return 0;
  const ta = Date.parse(a), tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return 0;
  return Math.round((tb - ta) / 864e5);
};

let calData = {};

// 盈亏日历弹框（原「日历 + 走势」双 Tab 已移除走势视图，仅保留日历）
async function openPnlModal() {
  // 无可见视图时，先落回首页作弹框背景
  if ($('#holdingsView').hidden && $('#assetView').hidden) {
    showHoldingsView();
  }
  const modal = document.getElementById('pnlModal');
  if (!modal) return;
  if (!window.__pnlWired) {
    window.__pnlWired = true;
    document.getElementById('pnlClose').onclick = () => { modal.hidden = true; };
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  }
  modal.hidden = false;
  const title = document.getElementById('pnlModalTitle');
  if (title) title.textContent = '盈亏日历';
  calViewDate = new Date(); // 打开时回到当月
  calSelDate = ymd(new Date()); // 每次打开都把「重色高亮」复位到今天（点其他日期可在本次会话内转移）
  await renderCalendar();
  syncCalViewToggle();
}

function showHoldingsView() {
  $('#assetView').hidden = true;
  $('#settingsView').hidden = true;
  $('#devicesView').hidden = true;
  $('#notifyView').hidden = true;
  $('#holdingsView').hidden = false;
  syncViewToggle(); // 回到主页时同步滑块选中态与白块位置
}

// ===== 首页 Dashboard（2026-10-20 tab 重构）=====
// 复用 /api/asset/overview（assetData）已有的净资产/资产分布口径，不重复请求。
async function showHomeView() {
  $('#homeView').hidden = false; // hideAllViews 后必须显式恢复，否则首页空白
  renderHomeDashboard();
}

async function renderHomeDashboard() {
  // 净资产 + 资产分布（来自 overview，已在 load() 时 fetchOverview 拉取）
  const ov = assetData || {};
  const net = ov.net_asset != null ? ov.net_asset : 0;
  const eqMV = (ov.equity && ov.equity.market_value) || 0;
  const wTotal = (ov.wealth && ov.wealth.total) || 0;
  const cTotal = (ov.cash && ov.cash.total) || 0;
  // 今日变动 = 持仓今日盈亏 + 理财今日收益（CNY）；本月变动复用 summary 的持仓本月盈亏
  const dayPnl = ((ov.equity && ov.equity.day_pnl) || 0) + ((ov.wealth && ov.wealth.today_pnl) || 0);
  const monthPnl = monthPnlCNY || 0;

  const nw = $('#homeNetWorth'); if (nw) nw.textContent = yuanOfW(net);
  const ch = $('#homeNetChanges');
  if (ch) {
    const segs = [];
    if (dayPnl) segs.push(`<span class="hc-item"><span class="hc-label">今日</span><span class="hc-val ${clsPnl(dayPnl)}">${dayPnl > 0 ? '+' : ''}${yuanOfW(dayPnl)} <em class="hc-pct">(${pct(dayPnl / Math.max(net - dayPnl, 1) * 100)})</em></span></span>`);
    if (monthPnl) segs.push(`<span class="hc-item"><span class="hc-label">本月</span><span class="hc-val ${clsPnl(monthPnl)}">${monthPnl > 0 ? '+' : ''}${yuanOfW(monthPnl)}</span></span>`);
    ch.innerHTML = segs.join('');
  }

  // 资产分布条：持仓 / 理财 / 现金（2026-10-27 起不再在首页 Hero 展示负债，
  // 净资产仍按 资产 − 负债 计算，负债明细只保留在资产页）
  const bd = $('#homeAssetBreakdown');
  if (bd) {
    const rows = [
      { label: '持仓', val: eqMV, color: 'var(--home-eq)' },
      { label: '理财', val: wTotal, color: 'var(--home-wealth)' },
      { label: '现金', val: cTotal, color: 'var(--home-cash)' },
    ];
    // 资产分布 → 芯片行（原型 hero-asset-chip）：一枚一个口径，金额右对齐读数
    bd.innerHTML = rows.map((r) => {
      const valTxt = (r.neg ? '−' : '') + yuanOfW(r.val);
      return `<span class="nw-chip"><span class="d" style="--dot-c:${r.color}"></span>${r.label} <b${r.neg ? ' class="down"' : ''}>${valTxt}</b></span>`;
    }).join('');
  }

  // 快捷功能（复用既有入口函数，避免重复实现弹框逻辑）
  const sc = $('#homeShortcuts');
  if (sc) {
    const items = [
      { ico: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="9"/>', label: '新增持仓', fn: () => openAddPick() },
      { ico: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>', label: '理财快照', fn: () => openSnapModal() },
      { ico: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>', label: '记收入', fn: async () => { await openFlowModal('in'); } },
      { ico: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', label: '记支出', fn: async () => { await openFlowModal('out'); } },
      { ico: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 9.5h16"/><path d="M8 3.2v3M16 3.2v3"/><path d="M12 11.6v4.2"/>', label: '基金定投', fn: () => openDCAPlans() },
      { ico: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', label: '新增平仓', fn: () => openBatchClosedModal() },
      // 「截图导入」入口已删除（2026-10-27）：该能力后续并入 AI 助手弹框，暂不实现，
      // 快捷区只保留已落地的操作，避免占位项点了只弹 toast。
    ];
    // 每个快捷功能取一个独立强调色（注入 --tint，仅作用于该微件子树，不影响全局强调色）
    const SC_TINTS = ['217, 165, 43', '42, 163, 155', '232, 110, 145', '56, 132, 232', '139, 92, 246', '150, 165, 180'];
    sc.innerHTML = items.map((it, i) => `<div class="shortcut tier-3" data-i="${i}" style="--tint:${SC_TINTS[i] || 'var(--tint)'}">
      <div class="shortcut-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${it.ico}</svg></div>
      <div class="shortcut-label">${it.label}</div></div>`).join('');
    sc.querySelectorAll('.shortcut').forEach((el) => {
      el.style.cursor = 'pointer';
      el.onclick = items[Number(el.dataset.i)].fn;
    });
  }

  // 最新流水（近 45 天，取最近 8 笔；复用 /api/asset/flows）+ 类型过滤胶囊
  const rf = $('#homeRecentFlows');
  if (rf) {
    rf.innerHTML = '<div class="recent-item"><div class="skeleton-line" style="--sk-w:80%"></div><div class="skeleton-line" style="--sk-w:55%"></div><div class="skeleton-line" style="--sk-w:65%"></div></div>';
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 45 * 864e5);
      const fmtD = (d) => d.toISOString().slice(0, 10);
      const r = await api(`/api/asset/flows?start=${fmtD(start)}&end=${fmtD(end)}`);
      if (r.ok) {
        const d = await r.json();
        homeRecentFlowsData = (d.flows || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
        renderRecentFlows();
      }
    } catch (_) { rf.innerHTML = '<div class="recent-item empty-hint">流水加载失败</div>'; }
  }
  // 首页「权益收益曲线」卡片：区间内每日/累计盈亏金额走势（数据复用 /api/pnl/history）
  // 用 homeRangeDays 而不是写死 30：这样切到「全部」后离开再回来，区间不会被悄悄重置成 30 天
  renderRateSpark(homeRangeDays, net);
  bindHomeRangeTabs();
  bindHomeRateMode();
}

// ===== 财务（2026-10-20 tab 重构）=====
async function showFinanceView() {
  $('#financeView').hidden = false; // hideAllViews 后必须显式恢复，否则财务页空白
  renderFinanceView();
}

// 首页最新流水：按类型过滤胶囊重渲染（全部 / 收入 / 支出 / 中性）
function renderRecentFlows() {
  const rf = $('#homeRecentFlows');
  if (!rf) return;
  const flows = homeRecentFlowsData.filter((f) => {
    if (homeRecentFilter === 'all') return true;
    const dir = finCatDir(flowCatOf(f)); // 'income' | 'expense' | 'neutral'
    const short = dir === 'income' ? 'in' : (dir === 'expense' ? 'out' : 'neutral');
    if (homeRecentFilter === 'neutral') return short === 'neutral';
    return short === homeRecentFilter;
  });
  if (!flows.length) { rf.innerHTML = '<div class="recent-item empty-hint">该类型下暂无近期流水</div>'; return; }
  rf.innerHTML = flows.map((f) => {
    const isIn = f.direction === 'in';
    const amtCls = isIn ? 'up' : 'down';
    const amt = (isIn ? '+' : '−') + moneyCurW(f.amount, f.currency);
    const dd = (f.date || '').slice(5);
    const sub = [f.name, f.ref_name].filter(Boolean).join(' · ');
    return `<div class="recent-item">
      <span class="recent-date">${dd}</span>
      <div><div class="recent-title">${cashFlowTypeTag(f)}${flowSnapshotTag(f)}</div><div class="recent-sub">${esc(sub || '')}</div></div>
      <span class="recent-amt ${amtCls}">${amt}</span></div>`;
  }).join('');
}
// 首页最新流水类型过滤胶囊（委托到容器，重渲染后依旧生效）
(function bindRecentFilter() {
  const box = document.getElementById('homeRecentFilter');
  if (!box) return;
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.rf-pill');
    if (!b) return;
    homeRecentFilter = b.dataset.rf;
    box.querySelectorAll('.rf-pill').forEach((x) => x.classList.toggle('active', x === b));
    renderRecentFlows();
  });
})();

// 所有循环计划共享一个查看月份 YYYY-MM（统一翻页：滑动任意一张，全部一起翻）；默认当前月
let cfViewYm = null;
// 按月份缓存的 doneMap：ym -> { [planId]: {...} }
const _planDoneCache = {};

// 财务页当前查看的年度（YYYY 字符串）。切换后整页（收支平衡卡 + 概览卡）按该年度重算。
let finYear = String(new Date().getFullYear());
// 财务页热力图 / 分类明细共用状态
let finMonthsData = [];          // /api/finance/summary 的 months 数组（12 月）
let finHmMonth = 0;             // 收支分析卡当前选中月份下标（0–11），同时驱动热力图与分类明细

async function renderFinanceView() {
  const kpiGrid = document.getElementById('finKpiGrid');
  const yearLabel = document.getElementById('finYearLabel');
  const heatmap = document.getElementById('finHeatmap');
  if (yearLabel) yearLabel.textContent = finYear;
  if (kpiGrid) kpiGrid.innerHTML = '';
  if (heatmap) heatmap.hidden = true;
  try {
    const year = finYear;
    // 汇总与全年流水并行拉取（月度详情需要逐笔流水做下钻）
    const [sumR, flowR] = await Promise.all([
      api(`/api/finance/summary?year=${encodeURIComponent(year)}`),
      api(`/api/asset/flows?start=${year}-01-01&end=${year}-12-31`),
    ]);
    if (flowR.ok) { const df = await flowR.json(); finFlowsCache = df.flows || []; }
    let d = null;
    if (sumR.ok) d = await sumR.json();
    if (d) {
      finMonthsData = d.months || [];
      renderFinKpis(d);
      // 年份边界禁用 prev/next（后端仅接受 2000–2999）
      const y = Number(finYear);
      const prev = document.getElementById('finYearPrev');
      const next = document.getElementById('finYearNext');
      if (prev) prev.disabled = y <= 2000;
      if (next) next.disabled = y >= 2999;
      // 收支分析卡（默认选中当前月，往年回落 12 月）：上半部分柱图 + 热力图，下半部分分类明细
      const curYm = year + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
      const curIdx = finMonthsData.findIndex((m) => m.ym === curYm);
      finHmMonth = curIdx >= 0 ? curIdx : 11;
      if (heatmap) { heatmap.hidden = false; renderFinHeatmap(); }
    } else if (kpiGrid) {
      kpiGrid.innerHTML = '<div class="kpi-card kpi-card-err">加载失败</div>';
    }
  } catch (_) {
    if (kpiGrid) kpiGrid.innerHTML = '<div class="kpi-card kpi-card-err">加载失败</div>';
  }
}

// 4 个 KPI 小卡片：年度总收入 / 总支出 / 净结余 / 储蓄率（数据来自 /api/finance/summary 的 year + save_rate）
function renderFinKpis(d) {
  const grid = document.getElementById('finKpiGrid');
  if (!grid) return;
  const yr = d.year || {};
  const inc = Number(yr.income) || 0, exp = Number(yr.expense) || 0, net = Number(yr.net) || 0;
  const rate = Math.max(-100, Math.min(100, Math.round((Number(d.save_rate) || 0) * 100)));
  const months = Number(d.months_covered) || 0;
  const netCls = net >= 0 ? '' : ' is-neg';
  const netSign = net >= 0 ? '+' : '−';
  grid.innerHTML = `
    <div class="kpi-card density-standard kpi-income">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></div>
      <div class="kpi-label">年度总收入</div>
      <div class="kpi-main"><div class="kpi-value">${moneyCurW(inc, 'cny')}</div></div>
      <div class="kpi-sub">月均 <span class="hl">${moneyCurW(inc / 12, 'cny')}</span></div>
    </div>
    <div class="kpi-card density-standard kpi-expense">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg></div>
      <div class="kpi-label">年度总支出</div>
      <div class="kpi-main"><div class="kpi-value">${moneyCurW(exp, 'cny')}</div></div>
      <div class="kpi-sub">月均 <span class="hl">${moneyCurW(exp / 12, 'cny')}</span></div>
    </div>
    <div class="kpi-card density-standard kpi-surplus">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></div>
      <div class="kpi-label">年度净结余</div>
      <div class="kpi-main"><div class="kpi-value${netCls}">${netSign}${moneyCurW(Math.abs(net), 'cny')}</div></div>
      <div class="kpi-sub">已覆盖 <span class="hl">${months.toFixed(1)} / 12</span> 月支出</div>
    </div>
    <div class="kpi-card density-standard kpi-rate">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
      <div class="kpi-label">储蓄率</div>
      <div class="kpi-main"><div class="kpi-value">${rate}%</div></div>
      <div class="kpi-sub">收入留存比例</div>
    </div>`;
}

// 年份左右切换（顶部年份切换器）：整页按所选年度重算
function changeFinYear(delta) {
  const y = Number(finYear) + delta;
  if (y < 2000 || y > 2999) return;
  finYear = String(y);
  renderFinanceView();
}

// ===== 财务页 · 年度收支分析卡（上：左月度柱 / 右子项热力图；下：当月分类明细） =====
function renderFinHeatmap() {
  renderYearBarChart();
  renderHmChips();
  renderCatTreemap();
  renderFinCatBlock();
}

// 左：12 月合并堆叠柱（收入绿在底 + 支出红在顶，总长=收入+支出）
// 柱段路径：roundTop/roundBot 分别控制上/下端是否倒圆角。
// 收入/支出两段堆叠，只有整根柱子的外端（顶/底）留圆角，两段连接处切平。
function barSegPath(x, y, w, h, r, roundTop, roundBot) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const rt = roundTop ? rr : 0, rb = roundBot ? rr : 0;
  return `M${x + rt} ${y}H${x + w - rt}` + (rt ? `A${rr} ${rr} 0 0 1 ${x + w} ${y + rt}` : '') +
    `V${y + h - rb}` + (rb ? `A${rr} ${rr} 0 0 1 ${x + w - rb} ${y + h}` : '') +
    `H${x + rb}` + (rb ? `A${rr} ${rr} 0 0 1 ${x} ${y + h - rb}` : '') +
    `V${y + rt}` + (rt ? `A${rr} ${rr} 0 0 1 ${x + rt} ${y}` : '') + 'Z';
}

// 金额格式化（CNY）：>=1万 用「万」缩写，否则整数。用于 y 轴刻度与每柱合计标签。
function barMoneyShort(v) {
  if (v <= 0) return '0';
  if (v >= 10000) {
    const w = v / 10000;
    return (w % 1 === 0 ? w.toFixed(0) : w.toFixed(1).replace(/\.0$/, '')) + '万';
  }
  return String(Math.round(v));
}
// 「漂亮」刻度步长：取最近的 1/2/2.5/5/10 × 10^n，让 y 轴网格线落在整数位。
function niceStep(raw) {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  let nf;
  if (f <= 1) nf = 1; else if (f <= 2) nf = 2; else if (f <= 2.5) nf = 2.5; else if (f <= 5) nf = 5; else nf = 10;
  return nf * base;
}
function renderYearBarChart() {
  const svg = document.getElementById('yearBarChart');
  const labels = document.getElementById('yearBarLabels');
  if (!svg || !labels) return;
  // 视口留出左侧 PAD_LEFT 给 y 轴刻度；与 CSS aspect-ratio(360/200=9/5) 保持一致。
  const W = 360, H = 200, PAD_TOP = 16, PAD_BOT = 6, PAD_LEFT = 36, PAD_RIGHT = 8, R = 2;
  const plotW = W - PAD_LEFT - PAD_RIGHT;
  const plotH = H - PAD_TOP - PAD_BOT;
  const baseY = PAD_TOP + plotH;
  const months = finMonthsData;
  if (!months.length) { svg.innerHTML = ''; labels.innerHTML = ''; return; }
  const totals = months.map((m) => (m.income || 0) + (m.expense || 0));
  const maxVal = Math.max(1, ...totals);
  // y 轴：4 等分网格，步长取整到「漂亮」值，顶线 = step×4（略高于最大值，不裁顶）。
  const step = niceStep(maxVal / 4);
  const top = step * 4;
  const slot = plotW / Math.max(1, months.length);
  const bw = slot * 0.62;
  const paths = [];
  // 网格线 + y 轴刻度标签（自下而上 0, step, 2step, 3step, 4step）
  for (let k = 0; k <= 4; k++) {
    const val = top * k / 4;
    const y = baseY - plotH * k / 4;
    paths.push(`<line class="bar-grid" x1="${PAD_LEFT}" y1="${y.toFixed(1)}" x2="${W - PAD_RIGHT}" y2="${y.toFixed(1)}"/>`);
    paths.push(`<text class="bar-tick" x="${PAD_LEFT - 5}" y="${(y + 2.6).toFixed(1)}">${barMoneyShort(val)}</text>`);
  }
  // y 轴竖线
  paths.push(`<line class="bar-axis" x1="${PAD_LEFT}" y1="${PAD_TOP}" x2="${PAD_LEFT}" y2="${baseY}"/>`);
  months.forEach((m, i) => {
    const cx = PAD_LEFT + slot * i + slot / 2;
    const total = (m.income || 0) + (m.expense || 0);
    const totalH = total / top * plotH;
    const incH = total <= 0 ? 0 : totalH * ((m.income || 0) / total);
    const expH = totalH - incH;
    const x = cx - bw / 2;
    const yExp = baseY - totalH;          // 支出段在上
    const yInc = yExp + expH;             // 收入段在下贴基线
    if (expH > 0.5) paths.push(`<path class="bar-hit bar-exp" data-mi="${i}" opacity="0.9" d="${barSegPath(x, yExp, bw, expH, R, true, incH <= 0.5)}"/>`);
    if (incH > 0.5) paths.push(`<path class="bar-hit bar-inc" data-mi="${i}" opacity="0.9" d="${barSegPath(x, yInc, bw, incH, R, expH <= 0.5, true)}"/>`);
    // 每柱合计标签（月度收支合计），选中月高亮；零值不画。
    if (total > 0.5) {
      paths.push(`<text class="bar-val${i === finHmMonth ? ' sel' : ''}" x="${cx.toFixed(1)}" y="${(yExp - 3).toFixed(1)}">${barMoneyShort(total)}</text>`);
    }
  });
  svg.innerHTML = paths.join('');
  labels.innerHTML = months.map((_, i) => `<span data-mi="${i}" class="${i === finHmMonth ? 'active' : ''}">${i + 1}</span>`).join('');
}

// 右：月份 chips（选中月决定 treemap 内容）
function renderHmChips() {
  const wrap = document.getElementById('hmChips');
  if (!wrap) return;
  wrap.innerHTML = finMonthsData.map((m, i) =>
    `<button class="hm-chip${i === finHmMonth ? ' active' : ''}" data-mi="${i}" type="button">${i + 1}月</button>`).join('');
}

// 逐笔流水折 CNY（与首页/资产页口径一致：USD/HKD 用 /api/home 下发的汇率）
function flowToCny(f) {
  const v = Math.abs(Number(f.amount) || 0);
  const c = (f.currency || 'cny').toUpperCase();
  if (c === 'USD') return v * (usdRate || 1);
  if (c === 'HKD') return v * (hkdRate || 1);
  return v;
}

// treemap 容器尺寸观察者：窗口缩放 / 布局变动后重画，避免几何过期把右侧、底部裁掉。
// 内容全是绝对定位，不会反噬容器尺寸，无重入循环；元素是静态节点，全局只建一个。
let _treemapRO = null;
function ensureTreemapRO(wrap) {
  if (_treemapRO || !wrap || typeof ResizeObserver === 'undefined') return;
  _treemapRO = new ResizeObserver(() => { renderCatTreemap(); });
  _treemapRO.observe(wrap);
}

// 右：二级子项金额热力图。一级方块=分类（面积=分类金额，+资金淡红底 / −资金淡绿底），
// 二级方块=该分类下逐笔流水细项（面积=细项金额，实色填充）。squarified treemap 两层嵌套。
// 画布高度按当月数据量动态调整：分类/细项越多越高，空月回落，避免「数据少时空一屏、数据多时挤成一团」。
function treemapHeight(nCats, nSubs, narrow) {
  // 窄屏（竖排后方块独占一行）宽度只有 300～430，高度刻意压得比桌面低，避免方块被拉成细长条
  const minH = narrow ? 200 : 300, maxH = narrow ? 360 : 540;
  const perCat = narrow ? 80 : 108;                                    // 每类至少容纳表头 + 一行细项
  const extra = Math.min(140, Math.max(0, nSubs - nCats) * 8);         // 细项比分类多时适度加高
  return Math.round(Math.max(minH, Math.min(maxH, nCats * perCat + extra)));
}
function renderCatTreemap() {
  const wrap = document.getElementById('catTreemap');
  if (!wrap) return;
  ensureTreemapRO(wrap);   // 任何路径下都挂上尺寸观察，容器就绪/变化即重画
  const m = finMonthsData[finHmMonth];
  const cur = document.getElementById('hmCurMonth');
  if (cur) cur.textContent = (finHmMonth + 1) + '月';
  const blockMonth = document.getElementById('catBlockMonth');
  if (blockMonth) blockMonth.textContent = (finHmMonth + 1) + '月';
  // 窄屏判据与 .heatmap-layout 竖排断点（880px）一致：竖排时 treemap 独占一行，高度区间收紧
  const narrow = window.innerWidth <= 880;
  if (!m || !m.items || !m.items.length) {
    wrap.style.setProperty('--tmh', (narrow ? 180 : 220) + 'px');
    wrap.innerHTML = '<div class="hm-box empty">当月暂无收支子项</div>';
    return;
  }
  const monthYm = m.ym;
  // 每个分类聚合当月逐笔流水（折 CNY）作为二级细项
  const cats = m.items.map((it) => {
    const flows = (finFlowsCache || []).filter((f) =>
      (f.date || '').slice(0, 7) === monthYm && flowCatOf(f) === it.category);
    const subs = flows.map((f) => ({
      amt: flowToCny(f),
      title: [f.ref_name, f.note, f.name].filter(Boolean).join(' · ') || finCatLabel(it.category),
    })).filter((s) => s.amt > 0);
    return { amt: Math.abs(it.amount) || 0, category: it.category, type: it.type, subs };
  }).filter((c) => c.amt > 0);
  if (!cats.length) {
    wrap.style.setProperty('--tmh', (narrow ? 180 : 220) + 'px');
    wrap.innerHTML = '<div class="hm-box empty">当月暂无收支子项</div>';
    return;
  }
  // 高度随当月数据量动态调整（会触发 ResizeObserver 重画，值不变时不会循环）
  const nSubs = cats.reduce((a, c) => a + c.subs.length, 0);
  wrap.style.setProperty('--tmh', treemapHeight(cats.length, nSubs, narrow) + 'px');
  const draw = () => {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    // 尺寸未就绪（如视图刚切走/仍隐藏）：直接返回，ResizeObserver 会在容器有尺寸后重画
    if (W <= 0 || H <= 0) return;
    const rects = squarifyTreemap(cats, 0, 0, W, H);
    wrap.innerHTML = rects.map((r) => {
      const c = r.i;
      const isInc = c.type === 'income';
      const label = finCatLabel(c.category);
      const amtStr = (isInc ? '+' : '−') + moneyCurW(c.amt, 'cny');
      // 窄块（手机竖排后分类多）放不下「名称 + 金额」：先砍金额（进 title），再砍名称，避免文字互相挤压/溢出
      const showCatAmt = r.w >= 92;
      const showCatName = r.w >= 46;
      return `<div class="hm-cat ${isInc ? 'inc' : 'exp'}${c.subs.length ? '' : ' no-subs'}" title="${esc(label + ' ' + amtStr)}" ` +
        `style="--l:${r.x.toFixed(1)}px;--t:${r.y.toFixed(1)}px;--w:${r.w.toFixed(1)}px;--h:${r.h.toFixed(1)}px;">` +
        `<div class="hm-cat-head">${showCatName ? `<span class="hm-cat-name">${esc(label)}</span>` : ''}` +
        `${showCatAmt ? `<span class="hm-cat-amt">${esc(amtStr)}</span>` : ''}</div>` +
        `<div class="hm-subs"></div></div>`;
    }).join('');
    // 二级：逐块测量 .hm-subs 实际尺寸后再切细项（表头高度由 flex 自然决定，不硬编码）
    wrap.querySelectorAll('.hm-cat').forEach((el, i) => {
      const c = rects[i] && rects[i].i;
      const box = el.querySelector('.hm-subs');
      if (!c || !box || !c.subs.length) return;
      const iw = box.clientWidth, ih = box.clientHeight;
      if (iw < 12 || ih < 12) return;
      const isInc = c.type === 'income';
      const GAP = 3;   // 细项方块间距（太小的方块不留，避免挤出负尺寸）
      const sr = squarifyTreemap(c.subs, 0, 0, iw, ih);
      // 透明度随面积（金额）映射：组内最大 → 最实，最小 → 最透；sqrt 压缩让小方块也有可辨色阶
      const maxAmt = c.subs.reduce((a, s) => Math.max(a, s.amt), 0);
      box.innerHTML = sr.map((s) => {
        const g = (s.w > GAP + 6 && s.h > GAP + 6) ? GAP : 0;
        // 只显示金额，名称/描述过长一律收进 title 悬停，避免方块内文字堆积
        // 阈值按「−¥2,352」这类最长串的实测宽度取，窄于此一律不画（手机窄屏方块普遍 40–60px）
        const showAmt = s.w >= 50 && s.h >= 18;
        const amtStr = (isInc ? '+' : '−') + moneyCurW(s.i.amt, 'cny');
        const op = maxAmt > 0 ? 0.3 + 0.62 * Math.sqrt(s.i.amt / maxAmt) : 0.6;
        const inner = showAmt ? `<span class="hm-box-amt">${esc(amtStr)}</span>` : '';
        return `<div class="hm-sub ${isInc ? 'inc' : 'exp'}" title="${esc(s.i.title + ' ' + amtStr)}" ` +
          `style="--l:${(s.x + g / 2).toFixed(1)}px;--t:${(s.y + g / 2).toFixed(1)}px;--w:${Math.max(1, s.w - g).toFixed(1)}px;--h:${Math.max(1, s.h - g).toFixed(1)}px;--op:${op.toFixed(2)};">${inner}</div>`;
      }).join('');
    });
  };
  draw();
}

// 选月（柱状图 / x 轴 / chips 共用）：热力图与下半部分分类明细同步跟随
function selectHmMonth(idx) {
  if (idx < 0 || idx >= finMonthsData.length) return;
  finHmMonth = idx;
  const chips = document.getElementById('hmChips');
  if (chips) chips.querySelectorAll('.hm-chip').forEach((c, i) => c.classList.toggle('active', i === idx));
  const labels = document.getElementById('yearBarLabels');
  if (labels) labels.querySelectorAll('span').forEach((s, i) => s.classList.toggle('active', i === idx));
  renderYearBarChart();   // 重绘柱状图
  renderCatTreemap();
  renderFinCatBlock();
}

// squarified treemap：输入 [{amt,...}]，在 (x,y,w,h) 内按面积布局，返回 {i,x,y,w,h}
function squarifyTreemap(items, x, y, w, h) {
  const total = items.reduce((s, i) => s + i.amt, 0);
  const out = [];
  if (total <= 0 || w <= 0 || h <= 0) return out;
  const scaled = items.map((i) => ({ i, area: (i.amt / total) * (w * h) })).sort((a, b) => b.area - a.area);
  let rx = x, ry = y, rw = w, rh = h, idx = 0;
  const worst = (row, len) => {
    const s = row.reduce((a, b) => a + b.area, 0);
    if (s <= 0) return Infinity;
    const mx = Math.max(...row.map((r) => r.area));
    const mn = Math.min(...row.map((r) => r.area));
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  while (idx < scaled.length) {
    const horizontal = rw >= rh;     // 沿较长边铺排，条带厚度为较短边
    const len = horizontal ? rw : rh;
    let row = [scaled[idx]]; idx++;
    while (idx < scaled.length) {
      const cand = row.concat([scaled[idx]]);
      if (worst(cand, len) <= worst(row, len)) { row = cand; idx++; } else break;
    }
    const s = row.reduce((a, b) => a + b.area, 0);
    if (horizontal) {
      const th = s / rw;
      let cx = rx;
      for (const r of row) { const ww = r.area / th; out.push({ i: r.i, x: cx, y: ry, w: ww, h: th }); cx += ww; }
      ry += th; rh -= th;
    } else {
      const tw = s / rh;
      let cy = ry;
      for (const r of row) { const hh = r.area / tw; out.push({ i: r.i, x: rx, y: cy, w: tw, h: hh }); cy += hh; }
      rx += tw; rw -= tw;
    }
  }
  return out;
}

// ===== 财务页 · 当月收支分类明细（合并进收支分析卡下半部分，跟随热力图选月） =====
function renderFinCatBlock() {
  const groups = document.getElementById('finCategoryGroups');
  if (!groups) return;
  const m = finMonthsData[finHmMonth];
  if (!m) { groups.innerHTML = '<div class="empty-hint">暂无数据</div>'; return; }
  // 分类组：基于当月子项聚合（CNY），逐笔流水从 finFlowsCache 下钻
  const monthYm = m.ym;
  const flowsOf = (cat) => (finFlowsCache || []).filter((f) =>
    (f.date || '').slice(0, 7) === monthYm && flowCatOf(f) === cat);
  const incTotal = m.income || 0, expTotal = m.expense || 0;
  const rows = (m.items || []).filter((it) => Math.abs(it.amount) > 0)
    .map((it) => {
      const isInc = it.type === 'income';
      const total = Math.abs(it.amount);
      const base = isInc ? Math.max(1, incTotal) : Math.max(1, expTotal);
      const pct = Math.round(total / base * 100);
      const flows = flowsOf(it.category);
      const detailRows = flows.map((f) => {
        const isIn = f.direction === 'in';
        const title = [f.ref_name, f.note, f.name].filter(Boolean).join(' · ') || finCatLabel(it.category);
        const acct = [f.name, f.currency ? f.currency.toUpperCase() : ''].filter(Boolean).join(' · ');
        const amt = (isIn ? '+' : '−') + moneyCurW(Math.abs(f.amount || 0), f.currency || 'cny');
        return `<div class="flow-row">
          <span class="flow-date">${(f.date || '').slice(5)}</span>
          <div class="flow-info"><div class="flow-title">${esc(title)}</div>${acct ? `<div class="flow-account">${esc(acct)}</div>` : ''}</div>
          <span class="flow-amt ${isIn ? 'income' : 'expense'}">${esc(amt)}</span>${flowSnapshotTag(f)}
        </div>`;
      }).join('') || '<div class="flow-row"><span class="flow-date"></span><div class="flow-title empty-hint">无逐笔记录</div></div>';
      return `<div class="category-group" data-dir="${it.type}">
        <div class="group-header" role="button" tabindex="0">
          <div class="group-toggle"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></div>
          <span class="cat-head-name">
            <span class="category-dot ${isInc ? 'income' : 'expense'}"></span>
            <span class="category-name">${esc(finCatLabel(it.category))}</span>
            <span class="category-count">· ${flows.length} 笔</span>
          </span>
          <span class="category-total ${isInc ? 'income' : 'expense'}">${isInc ? '+' : '−'}${moneyCurW(total, 'cny')}</span>
          <span class="category-pct">${pct}%</span>
        </div>
        <div class="group-rows-wrap"><div class="group-rows">${detailRows}</div></div>
      </div>`;
    }).join('');
  groups.innerHTML = rows || '<div class="empty-hint">当月暂无收支子项</div>';
}

// 分类组展开/折叠（事件冒泡到 document 委托）
function toggleFinGroup(header) {
  const g = header.closest('.category-group');
  if (g) g.classList.toggle('collapsed');
}

// 取该 plan 在某月是否已完成（一次性计划忽略月份；循环计划用共享查看月份）
function _planDoneAt(p, ym) {
  if (p.pattern === 'one_time') return !!cashflowDone[p.id];
  const dm = _planDoneCache[ym || cfViewYm || cfNowYm];
  return !!(dm && dm[p.id]);
}

const FP_PREV_SVG = '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>';
const FP_NEXT_SVG = '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
const _fpCardYm = {};         // 每张循环卡独立维护一个查看月份，箭头单独前后切换

function ymShift(ym, delta) {
  const [y, m] = (ym || '').split('-').map(Number);
  const d = new Date(y || 2000, (m || 1) - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function ymLabel(ym) { const [y, m] = (ym || '').split('-'); return y + '/' + (m || ''); }
function sleepMs(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 某月的完成状态（带缓存，缺失才请求）
async function ensurePlanDoneYm(ym) {
  if (!ym || _planDoneCache[ym]) return;
  try {
    const r = await api('/api/cashflow/plans?month=' + ym);
    if (r.ok) {
      const d = await r.json();
      const done = {};
      const raw = d.done || {};
      Object.keys(raw).forEach((k) => { done[Number(k)] = raw[k]; });
      _planDoneCache[ym] = done;
    }
  } catch (_) { /* 拉失败按空处理 */ }
  if (!_planDoneCache[ym]) _planDoneCache[ym] = {};
}

// 单张月卡的内容：一个「计划 × 月份」
function fpRowHTML(p, ym) {
  const isRecurring = p.pattern !== 'one_time';
  const isIn = p.type === 'income';
  const dotCls = isIn ? 'income' : 'expense';
  const amtCur = curSymbolJS(p.currency || 'cny');
  const amt = Math.abs(Number(p.amount) || 0);
  const meta = p.pattern === 'one_time'
    ? (p.one_time_date ? `一次性 · ${p.one_time_date}` : '一次性计划')
    : `每月 ${cfSortDay(p)} 日`;
  const liabTag = (p.type === 'expense' && p.liability_mode === 'incur') ? '<span class="cf-tag">新负债</span>'
    : (p.liability_id ? '<span class="cf-tag">负债</span>' : '');
  // 月份信息：金额下方、卡片最右；只用淡化字色，无底色无主题色无箭头
  const monthPill = isRecurring ? `<span class="fp-month-pill" data-ym="${ym}">${ymLabel(ym)}</span>` : '';
  return `<div class="fp-row">
      <span class="plan-dot ${dotCls}"></span>
      <div class="fp-main">
        <div class="plan-title">${esc(p.title || '')}${liabTag} ${finCatBadge(p.category || (isIn ? 'other_in' : 'other_out'))}</div>
        <div class="plan-meta">${esc(meta)}</div>
      </div>
      <div class="fp-side">
        <span class="plan-amt ${dotCls}">${isIn ? '+' : '-'}${amtCur}${amt.toFixed(2)}</span>
        ${monthPill}
      </div>
    </div>`;
}

// 右侧圆形 icon：未完成=铅笔编辑；已完成=对勾（不置灰）。计划级控件，不属于某一月，故放卡堆外
function fpActHTML(p, ym) {
  const done = _planDoneAt(p, ym);
  return done
    ? `<button class="fp-act fp-done" data-act="cf-edit" data-id="${p.id}" title="已完成 · 点击编辑计划" aria-label="已完成"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></button>`
    : `<button class="fp-act" data-act="cf-edit" data-id="${p.id}" title="编辑计划" aria-label="编辑计划"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>`;
}

// 整卡内容：recurring = 单月视图 + 左右翻月箭头（各卡独立）；one_time = 单卡，无箭头
function fpCardHTML(p) {
  const isRecurring = p.pattern !== 'one_time';
  if (!isRecurring) {
    return `<div class="fp-row">${fpRowHTML(p, '')}</div>${fpActHTML(p, '')}`;
  }
  const ym = _fpCardYm[p.id] || cfViewYm || cfNowYm;
  return `<button class="fp-nav-btn fp-prev" data-act="fp-prev" data-id="${p.id}" aria-label="上一月" title="上一月">${FP_PREV_SVG}</button>`
       + `<div class="fp-content">${fpRowHTML(p, ym)}</div>`
       + fpActHTML(p, ym)
       + `<button class="fp-nav-btn fp-next" data-act="fp-next" data-id="${p.id}" aria-label="下一月" title="下一月">${FP_NEXT_SVG}</button>`;
}

// ---- 收支计划卡片：每张 recurring 卡 = 单月视图，左右箭头各自独立前后切换 ----
// 切换只做简单的滑入/淡出过渡，不再堆叠。每张卡维护自己的查看月份 _fpCardYm[id]。

// 单张卡翻到上/下一月：先按方向滑出，取数到位后换内容并滑入
async function fpNav(cardEl, id, dir) {
  if (cardEl.dataset.fpNavBusy === '1') return;
  cardEl.dataset.fpNavBusy = '1';
  try {
    const p = (cashflowPlans || []).find((x) => x.id === Number(id));
    if (!p) return;
    const cur = _fpCardYm[id] || cfViewYm || cfNowYm;
    const nextYm = ymShift(cur, dir);
    const ready = ensurePlanDoneYm(nextYm);            // 与滑出动画并行取数
    const content = cardEl.querySelector('.fp-content');
    if (!content) return;
    content.classList.add(dir < 0 ? 'fp-out-prev' : 'fp-out-next');
    await Promise.all([ready, sleepMs(130)]);
    _fpCardYm[id] = nextYm;
    content.innerHTML = fpRowHTML(p, nextYm);
    content.classList.remove('fp-out-prev', 'fp-out-next');
    content.classList.add(dir < 0 ? 'fp-in-prev' : 'fp-in-next');
    // 编辑按钮完成态随月份变化
    const act = cardEl.querySelector('.fp-act');
    if (act) act.outerHTML = fpActHTML(p, nextYm);
    setTimeout(() => content.classList.remove('fp-in-prev', 'fp-in-next'), 200);
  } finally {
    delete cardEl.dataset.fpNavBusy;
  }
}

// 渲染整个计划列表：一张 plan-item 对应一个计划（事件走 document 级委托，无需逐卡绑定）
async function renderPlanList(box) {
  if (!box) return;
  const list = cashflowPlans || [];
  if (!list.length) {
    box.innerHTML = '<div class="plan-empty empty-hint">暂无收支计划 · 点上方「＋ 新增收支计划」建立</div>';
    return;
  }
  await prefetchPlanMonths();                          // 先把相邻月份完成态取齐，避免显示成铅笔
  box.innerHTML = list.map((p) => `<div class="plan-item${p.pattern !== 'one_time' ? ' fp-deck' : ''}" data-id="${p.id}">${fpCardHTML(p)}</div>`).join('');
}

// 预拉各卡当前月 ±1 的完成状态（按 ym 全局缓存，箭头切换即时生效）
async function prefetchPlanMonths() {
  const need = new Set();
  need.add(cfViewYm || cfNowYm);
  for (const id in _fpCardYm) {
    const y = _fpCardYm[id];
    need.add(y); need.add(ymShift(y, 1)); need.add(ymShift(y, -1));
  }
  const miss = [...need].filter((ym) => !_planDoneCache[ym]);
  if (miss.length) await Promise.all(miss.map(ensurePlanDoneYm));
}

// 计划卡交互：翻月箭头 / 编辑 icon（document 级委托，卡片重渲染后仍生效）
document.addEventListener('click', (e) => {
  const card = e.target.closest ? e.target.closest('#assetPlanList .plan-item') : null;
  if (!card) return;
  const navBtn = e.target.closest('.fp-nav-btn');
  if (navBtn) {
    fpNav(card, navBtn.dataset.id, navBtn.classList.contains('fp-prev') ? -1 : 1);
    return;
  }
  const actBtn = e.target.closest('.fp-act');
  if (actBtn) {
    openCashflowModal((cashflowPlans || []).find((p) => p.id === Number(actBtn.dataset.id)));
  }
});

// 财务页收支分析卡交互（document 级委托，重渲染后依旧生效）
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t.closest) return;
  // 月度柱 / x 轴标签 / 月份 chip → 选月（热力图与分类明细同步）
  const bar = t.closest('#yearBarChart .bar-hit');
  if (bar) { selectHmMonth(Number(bar.dataset.mi)); return; }
  const xl = t.closest('#yearBarLabels span');
  if (xl) { selectHmMonth(Number(xl.dataset.mi)); return; }
  const hmChip = t.closest('#hmChips .hm-chip');
  if (hmChip) { selectHmMonth(Number(hmChip.dataset.mi)); return; }
  // 分类组展开 / 折叠
  const gh = t.closest('#finCategoryGroups .group-header');
  if (gh) { toggleFinGroup(gh); return; }
  // 分类明细块整体折叠 / 展开（默认展开，点击标题行切换）
  const catHead = t.closest('#finCatBlock .fin-cat-head');
  if (catHead) {
    const blk = document.getElementById('finCatBlock');
    if (blk) {
      const willOpen = blk.classList.contains('collapsed');
      blk.classList.toggle('collapsed', !willOpen);
      catHead.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    }
    return;
  }
  // 顶部年份切换器：‹ / ›
  const yPrev = t.closest('#finYearPrev');
  if (yPrev) { changeFinYear(-1); return; }
  const yNext = t.closest('#finYearNext');
  if (yNext) { changeFinYear(1); return; }
});

// ---- 收支语义分类（与 internal/db/fincat.go BuiltinFinCats 同款，改这里同步改 Go）----
// 方向：income=收入 / expense=支出 / neutral=中性（投资活动、内部划转、融资借贷，不计收支）
const FIN_CATS = [
  { key: 'salary', label: '工资薪金', dir: 'income' },
  { key: 'business', label: '经营收入', dir: 'income' },
  { key: 'invest_div', label: '投资分红', dir: 'income' },
  { key: 'invest_int', label: '投资利息', dir: 'income' },
  { key: 'gain', label: '落袋收益', dir: 'income' },
  { key: 'other_in', label: '其他收入', dir: 'income' },
  { key: 'living', label: '日常消费', dir: 'expense' },
  { key: 'housing', label: '居住支出', dir: 'expense' },
  { key: 'capex', label: '资本开支', dir: 'expense' },
  { key: 'debt', label: '负债偿还', dir: 'expense' },
  { key: 'tax', label: '税费', dir: 'expense' },
  { key: 'insurance', label: '保险保障', dir: 'expense' },
  { key: 'edu_health', label: '教育医疗', dir: 'expense' },
  { key: 'fee', label: '投资费用', dir: 'expense' },
  { key: 'other_out', label: '其他支出', dir: 'expense' },
  { key: 'invest', label: '投资活动', dir: 'neutral' },
  { key: 'transfer', label: '内部划转', dir: 'neutral' },
  { key: 'financing', label: '融资借贷', dir: 'neutral' },
];
// 用户自定义分类（settings flow_categories，P3）：与内置分类合并进选择器与统计
let customFlowCats = [];
async function loadCustomFlowCats() {
  try {
    const r = await api('/api/settings/flow_categories');
    if (r.ok) {
      const d = await r.json();
      let ls = [];
      try { ls = JSON.parse(d.payload || '[]'); } catch (_) { ls = []; }
      customFlowCats = (Array.isArray(ls) ? ls : []).filter((c) => c && c.key);
    }
  } catch (_) { customFlowCats = []; }
}
function finCatDef(key) {
  const b = FIN_CATS.find((c) => c.key === key);
  if (b) return b;
  const c = (customFlowCats || []).find((x) => x.key === key);
  return c ? { key: c.key, label: c.label || c.key, dir: c.dir || 'expense' } : null;
}
function finCatLabel(key) {
  const d = finCatDef(key);
  return d ? d.label : (key || '其他');
}
function finCatDir(key) {
  const d = finCatDef(key);
  return d ? d.dir : 'neutral';
}
// 某方向可选分类（内置 + 自定义，按内置序在前）
function finCatOptions(dir) {
  const builtin = FIN_CATS.filter((c) => c.dir === dir);
  const custom = (customFlowCats || []).filter((c) => (c.dir || 'expense') === dir)
    .map((c) => ({ key: c.key, label: c.label || c.key, dir: c.dir || 'expense' }));
  return builtin.concat(custom);
}
// 存量/空分类兜底：按流水 type 推导（后端已批量回填，这里仅防御旧缓存）
function autoCatOfFlow(type, amount) {
  const inCats = { dividend: 'invest_div', mcp_dividend: 'invest_div', interest: 'invest_int', deposit_interest: 'invest_int', fee: 'fee' };
  if (inCats[type]) return inCats[type];
  if (['adjust_buy', 'adjust_sell', 'dca_buy', 'mcp_buy', 'mcp_sell', 'wealth_deposit', 'wealth_redeem', 'wealth_clear', 'wealth_reverse', 'mcp_subscribe', 'mcp_redeem', 'deposit_out', 'deposit_back'].includes(type)) return 'invest';
  if (['transfer_in', 'transfer_out', 'transfer_rollback'].includes(type)) return 'transfer';
  if (type === 'loan') return 'financing';
  if (type === 'repay') return 'debt';
  return (amount || 0) >= 0 ? 'other_in' : 'other_out';
}
function flowCatOf(f) {
  return f && f.category ? f.category : autoCatOfFlow(f ? f.type : '', f ? f.amount : 0);
}
// 分类徽标（色点 + 标签）：收入红、支出绿（涨红跌绿），中性灰
function finCatBadge(key, cls) {
  const dir = finCatDir(key);
  const tone = dir === 'income' ? 'in' : (dir === 'expense' ? 'out' : 'neu');
  return `<span class="flow-tag cat ${tone} ${cls || ''}">${esc(finCatLabel(key))}</span>`;
}

// brand-nav 已从 header 移除，点击回首页职责交给主导航 pills（首页 pill）

// ESC 键：从任意二级页（资产/速算/日历）返回主页
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const tag = (t.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  // 「/」聚焦筛选（设计系统：快捷聚焦搜索框）
  if (e.key === '/' && !typing) {
    const fi = document.getElementById('homeFilterInput');
    if (fi) { e.preventDefault(); fi.focus(); }
    return;
  }
  if (e.key !== 'Escape') return;
  // 弹框优先（含通知弹框），ESC 直接关闭
  const openModals = document.querySelectorAll('.modal:not([hidden])');
  if (openModals.length) {
    openModals.forEach((m) => { m.hidden = true; });
    hideTrendTip();   // 关闭任意弹框时收起可能残留的悬停浮框（如持仓盈亏曲线的 pinned tooltip）
    return;
  }
  const inSubView = !$('#homeView').hidden || !$('#holdingsView').hidden || !$('#assetView').hidden || !$('#financeView').hidden
    || !$('#settingsView').hidden || !$('#devicesView').hidden || !$('#notifyView').hidden;
  if (inSubView) {
    navigate('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
$('#calPrev').onclick = () => {
  if (calView === 'year') { calViewYear--; drawCalYear(); }
  else { calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1); drawCalMonth(); }
};
$('#calNext').onclick = () => {
  if (calView === 'year') { calViewYear++; drawCalYear(); }
  else { calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1); drawCalMonth(); }
};
// 盈亏日历：月 / 年 视图切换胶囊（样式同修改弹框补仓计算）
document.querySelectorAll('#calViewToggle .vt-btn').forEach((b) => {
  b.onclick = () => {
    calView = b.dataset.cview;
    syncCalViewToggle();
    if (calView === 'year') drawCalYear();
    else drawCalMonth();
  };
});
function syncCalViewToggle() {
  document.querySelectorAll('#calViewToggle .vt-btn').forEach((x) => x.classList.toggle('active', x.dataset.cview === calView));
  positionIndicatorFor('calViewToggle', 'calViewIndicator');
  setTimeout(() => positionIndicatorFor('calViewToggle', 'calViewIndicator'), 0);
}
// 盈亏日历：金额 / 收益率 口径切换（右侧 ⇄ 文本标签，可一直切换）
$('#calMetricToggle').onclick = () => {
  calMetric = calMetric === 'amount' ? 'rate' : 'amount';
  const btn = $('#calMetricToggle');
  if (btn) btn.textContent = calMetric === 'rate' ? '⇄ 盈亏率' : '⇄ 盈亏金额';
  drawCal();
};
// 按当前视图（月/年）重绘
function drawCal() {
  if (calView === 'year') drawCalYear();
  else drawCalMonth();
}

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
      calView = 'month';
      calViewDate = new Date(calJumpYear, parseInt(b.dataset.m, 10) - 1, 1);
      syncCalViewToggle();
      drawCalMonth();
      $('#calJumpModal').hidden = true;
    };
  });
}

// 日历弹框：前一天 / 后一天（跳到有快照数据的前/后一个日期，便于连续浏览盈亏）
// 按钮由 openCalDay 每次渲染时重建拼入（innerHTML 会销毁旧节点，不能 append 静态元素），
// 因此用事件委托：在弹框根节点监听点击，按钮节点重建后依然可点。
$('#calModal').addEventListener('click', (e) => {
  const t = e.target.closest('#calModalPrev, #calModalNext');
  if (!t) return;
  shiftCalDay(t.id === 'calModalPrev' ? -1 : 1);
});
// 前一天/后一天按钮 HTML（拼入统计行末尾右贴；无数据日期时按钮同样渲染，不再丢失）
const CAL_NAV_HTML = '<span class="cal-nav-wrap"><button type="button" id="calModalPrev" class="btn cal-nav-btn" title="前一天">‹</button><button type="button" id="calModalNext" class="btn cal-nav-btn" title="后一天">›</button></span>';
$('#calGrid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-cell');
  if (!cell || !cell.dataset.date) return;
  // 选中态转移：整月只有这一格用重色（默认今天是选中日），点哪天就高亮哪天
  calSelDate = cell.dataset.date;
  if (calView === 'month') drawCalMonth();
  openCalDay(cell.dataset.date);
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
let calView = 'month';          // 日历视图：'month' 月盈亏 / 'year' 年各月盈亏
let calViewYear = new Date().getFullYear(); // 年视图当前查看的年份
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
// 选中日：整月唯一用「重色」高亮的格子（其余有数据日期一律浅色）。
// 默认今天；点任意日期即转移过去 —— 与支付宝盈亏日历的读法一致：
// 颜色只表达红/绿方向，幅度看数字，焦点只有一个。
let calSelDate = ymd(new Date());
let calMetric = 'amount';       // 日历展示口径：'amount' 盈亏金额 / 'rate' 真实日收益率

// 日历某日「当前口径」下的数值：金额=total_cny；收益率=total_cny / base_cny * 100
function calActiveVal(rec) {
  if (!rec) return 0;
  if (calMetric === 'rate') {
    const base = rec.base_cny || 0;
    if (base <= 0) return 0;
    return (rec.total_cny / base) * 100;
  }
  return rec.total_cny || 0;
}
// 当前口径下数值的展示文本
function calActiveFmt(v) {
  if (calMetric === 'rate') return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  return fmt(v);
}
// 月视图格子专用：格宽只有 90px（手机 45px），四位数以上带小数会被裁掉 → 取整显示。
// 完整数值仍在格子 title（悬停/长按）与月汇总里，不影响核对。
function calCellFmt(v) {
  if (calMetric === 'rate') return calActiveFmt(v);
  if (Math.abs(v) >= 1000) {
    const n = Math.round(v);
    return (n > 0 ? '+' : '') + n.toLocaleString('zh-CN');
  }
  return fmt(v);
}
async function renderCalendar() {
  const r = await api('/api/pnl/history');
  if (!r.ok) { toast('加载盈亏历史失败 (HTTP ' + r.status + ')', 'err'); return; }
  const d = await r.json();
  const hist = d.history || [];
  calData = {};
  hist.forEach((h) => { calData[h.date] = h; });
  calMaxAbs = 1;
  hist.forEach((h) => { const a = Math.abs(h.total_cny); if (a > calMaxAbs) calMaxAbs = a; });
  drawCal();
}

// 绘制 calViewDate 所在月份的网格（7 列：日 一 二 三 四 五 六）
function drawCalMonth() {
  const y = calViewDate.getFullYear();
  const m = calViewDate.getMonth();
  $('#calTitle').textContent = y + '年' + (m + 1) + '月';

  // 当月汇总：金额口径=total_cny 求和；收益率口径=月总盈亏 / 月均净资产基数
  const monthPrefix = y + '-' + String(m + 1).padStart(2, '0');
  let monthPnl = 0, monthDays = 0, monthBaseSum = 0, monthBaseDays = 0;
  for (const ds in calData) {
    if (ds.startsWith(monthPrefix)) {
      monthPnl += calData[ds].total_cny || 0;
      monthDays++;
      const b = calData[ds].base_cny || 0;
      if (b > 0) { monthBaseSum += b; monthBaseDays++; }
    }
  }
  const ms = $('#calMonthSummary');
  if (ms) {
    if (!monthDays) {
      ms.innerHTML = '<span class="cal-ms-label">本月暂无盈亏数据</span>';
    } else {
      let msCls, msVal, mark;
      if (calMetric === 'rate') {
        const avgBase = monthBaseDays ? monthBaseSum / monthBaseDays : 0;
        const rate = avgBase > 0 ? (monthPnl / avgBase) * 100 : 0;
        const rZero = Math.abs(rate) < 1e-9;
        msCls = clsPnl(rate);
        // 零值与日格口径统一：只显示「—」，不出现「—+0.00%」这种标记+数值并存的怪显示
        msVal = rZero ? '—' : (rate > 0 ? '+' : '') + rate.toFixed(2) + '%';
        mark = rZero ? '' : (rate > 0 ? '▲' : '▼');
      } else {
        const mZero = Math.abs(monthPnl) < 1e-9;
        msCls = clsPnl(monthPnl);
        msVal = mZero ? '—' : '¥' + (monthPnl > 0 ? '+' : '') + fmt(monthPnl);
        mark = mZero ? '' : (monthPnl > 0 ? '▲' : '▼');
      }
      const msLabel = calMetric === 'rate' ? '本月收益率' : '本月总盈亏';
      // 方向标记用全站统一的 ▲ / ▼ / —（跟随 up/down/flat 的涨跌色），不用彩色 emoji
      ms.innerHTML = '<span class="cal-ms-label">' + msLabel + '</span>'
        + `<span class="cal-ms-val ${msCls}">${mark}${msVal}</span>`;
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
        const v = calActiveVal(rec);
        // 零盈亏与无快照统一显示「—」（底色区分：lg-zero=有记录但平盘，lg-none=无记录）
        const isZero = !!rec && Math.abs(v) < 1e-9;
        // 有盈亏的格子不再按幅度分档：一律浅色（lg-up / lg-down 只有方向语义），
        // 选中日靠 is-sel 单独升为重色 —— 见 style.css「盈亏日历配色」段。
        let color, pnlTxt = '', showVal = false;
        if (!rec) color = 'lg-none';
        else if (isZero) { color = 'lg-zero'; pnlTxt = '—'; showVal = true; }
        else {
          color = v > 0 ? 'lg-up' : 'lg-down';
          pnlTxt = calCellFmt(v);
          showVal = true;
        }
        const isToday = cur.getTime() === today.getTime();
        const isSel = ds === calSelDate;
        const unit = calMetric === 'rate' ? '收益率' : '盈亏';
        const title = ds + (rec ? (': ' + unit + ' ' + calActiveFmt(v)) : '：无快照数据');
        const dayNum = cur.getDate();
        // 日期居中显示；盈亏金额贴底（仅在有记录的日期显示，未更新的只显示日期）
        const valHtml = showVal ? '<span class="cal-val">' + pnlTxt + '</span>' : '';
        cells += '<div class="cal-cell ' + color + (isToday ? ' cal-today' : '') + (isSel ? ' is-sel' : '') + '" data-date="' + ds + '" title="' + title + '"><span class="cal-day">' + dayNum + '</span>' + valHtml + '</div>';
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  const grid = $('#calGrid');
  grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
  grid.innerHTML = cells;
  $('#calWeekdays').classList.remove('is-hidden'); // 月视图显示星期表头
  saveCalMonth();
}

// 年视图：展示 calViewYear 的 12 个月，每格 = 当月汇总（金额口径=total_cny 求和；收益率口径=月总盈亏/月均净资产基数）
function drawCalYear() {
  const y = calViewYear;
  $('#calTitle').textContent = y + '年';
  // 各月汇总（与月视图口径一致）
  const monthAgg = [];
  for (let m = 1; m <= 12; m++) {
    const prefix = y + '-' + String(m).padStart(2, '0');
    let pnl = 0, days = 0, baseSum = 0, baseDays = 0;
    for (const ds in calData) {
      if (ds.startsWith(prefix)) {
        pnl += calData[ds].total_cny || 0;
        days++;
        const b = calData[ds].base_cny || 0;
        if (b > 0) { baseSum += b; baseDays++; }
      }
    }
    monthAgg.push({ m, pnl, days, avgBase: baseDays ? baseSum / baseDays : 0 });
  }
  // 着色：与月视图同一套两态（浅色表方向，重色只给「当前」那一格），不再按绝对值分档
  const curMonth = new Date().getMonth() + 1;
  const curYear = new Date().getFullYear();
  let cells = '';
  for (let m = 1; m <= 12; m++) {
    const a = monthAgg[m - 1];
    const v = calMetric === 'rate' ? (a.avgBase > 0 ? a.pnl / a.avgBase * 100 : 0) : a.pnl;
    let color;
    const isZero = a.days > 0 && Math.abs(v) < 1e-9;
    if (a.days === 0) color = 'lg-none';
    else if (isZero) color = 'lg-zero';
    else color = v > 0 ? 'lg-up' : 'lg-down';
    // 当年的当前月 = 年视图里的「今天」，用重色（其它月份一律浅色）
    const isSel = color !== 'lg-none' && color !== 'lg-zero' && y === curYear && m === curMonth;
    // 与日格口径统一：无记录 / 零盈亏都显示「—」
    const valTxt = (a.days === 0 || isZero) ? '—' : calActiveFmt(v);
    cells += `<div class="cal-cell cal-year-cell ${color}${isSel ? ' is-sel' : ''}" data-month="${m}">
      <span class="cal-day">${m}月</span>
      <span class="cal-val">${valTxt}</span>
    </div>`;
  }
  const grid = $('#calGrid');
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)'; // 4 列 × 3 行，方格更紧凑
  grid.innerHTML = cells;
  $('#calWeekdays').classList.add('is-hidden'); // 年视图隐藏星期表头
  grid.querySelectorAll('[data-month]').forEach((c) => {
    c.onclick = () => {
      calView = 'month';
      calViewDate = new Date(calViewYear, parseInt(c.dataset.month, 10) - 1, 1);
      syncCalViewToggle();
      drawCalMonth();
    };
  });
  // 年汇总写进 calMonthSummary
  const ms = $('#calMonthSummary');
  if (ms) {
    let yearPnl = 0, yearBaseSum = 0, yearBaseDays = 0;
    monthAgg.forEach((a) => { yearPnl += a.pnl; if (a.avgBase > 0) { yearBaseSum += a.avgBase; yearBaseDays++; } });
    let msCls, msVal, mark, label;
    if (calMetric === 'rate') {
      const avgBase = yearBaseDays ? yearBaseSum / yearBaseDays : 0;
      const rate = avgBase > 0 ? yearPnl / avgBase * 100 : 0;
      msCls = clsPnl(rate);
      msVal = (rate >= 0 ? '+' : '') + rate.toFixed(2) + '%';
      mark = rate > 0 ? '▲' : '▼';
      label = '本年收益率';
    } else {
      msCls = clsPnl(yearPnl);
      msVal = '¥' + (yearPnl >= 0 ? '+' : '') + fmt(yearPnl);
      mark = yearPnl > 0 ? '▲' : '▼';
      label = '本年总盈亏';
    }
    ms.innerHTML = '<span class="cal-ms-label">' + label + '</span><span class="cal-ms-val ' + msCls + '">' + mark + msVal + '</span>';
  }
}

// 盈亏明细已删除「币种」列：原始币种改以符号（¥ / $ / HK$）走在代码前，列数更少且不丢信息。
function calCurSym(cur) {
  const c = String(cur || 'cny').toLowerCase();
  const label = c === 'usd' ? 'USD' : (c === 'hkd' ? 'HKD' : 'CNY');
  return `<span class="cal-cur" title="原始币种 ${label}">${curSymbolJS(c)}</span>`;
}

function openCalDay(date) {
  calModalCurDate = date;
  const rec = calData[date];
  $('#calModalDate').textContent = date + ' 盈亏明细';
  if (!rec) {
    $('#calModalBody').innerHTML = '<div class="u-row u-wrap u-gap-3 u-mb-2"><p class="u-muted">该日无快照数据。</p>' + CAL_NAV_HTML + '</div>';
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
      rows = '<div class="cal-detail-wrap"><table class="cal-detail-tbl"><thead><tr><th>代码</th><th>名称</th><th class="num">盈亏 (CNY)</th></tr></thead><tbody>' +
        syms.map((s) => {
          // 优先用快照时折算的 CNY 值；旧快照无该字段则用当前汇率回退折算
          const cny = (typeof s.pnl_cny === 'number') ? s.pnl_cny : toRmb({ currency: s.currency }, s.pnl);
          return '<tr><td class="cal-code">' + calCurSym(s.currency) + (s.symbol || '') + '</td><td>' + (s.name || '') + '</td><td class="num ' + clsPnl(cny) + '">' + fmtPnl(cny) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>';
      syms.forEach((s) => { const c = (typeof s.pnl_cny === 'number') ? s.pnl_cny : toRmb({ currency: s.currency }, s.pnl); equityCNY += c; });
    } else rows = '<p class="u-muted">无个股明细。</p>';
    // 理财收益（已合并进 total_cny）。代码列与持仓明细对齐；旧快照不含 code 时按产品名回查当前产品。
    const wts = det.by_wealth || [];
    if (wts.length) {
      const codeByName = {};
      (((assetData || {}).wealth || {}).products || []).forEach((p) => { if (p.name && p.code) codeByName[p.name] = p.code; });
      wRows = '<div class="cal-detail-wrap u-mt-2"><table class="cal-detail-tbl"><thead><tr><th>代码</th><th>理财</th><th class="num">盈亏 (CNY)</th></tr></thead><tbody>' +
        wts.map((w) => {
          const code = w.code || codeByName[w.name] || '';
          return '<tr><td class="cal-code">' + (code ? calCurSym(w.currency) + code : '<span class="u-muted">—</span>') + '</td><td>' + (w.name || '') + '</td><td class="num ' + clsPnl(w.pnl_cny) + '">' + fmtPnl(w.pnl_cny) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>';
      wts.forEach((w) => { wealthCNY += (typeof w.pnl_cny === 'number') ? w.pnl_cny : 0; });
    }
  } catch (e) { rows = '<p class="u-danger">明细解析失败</p>'; }
  const dayRate = (rec.base_cny && rec.base_cny > 0) ? (rec.total_cny / rec.base_cny * 100) : null;
  $('#calModalBody').innerHTML = `
    <div id="calSumRow" class="u-row u-wrap u-gap-6 u-mb-3">
      <div><div class="cal-sub">盈亏 (CNY)</div><div class="value ${clsPnl(v)}">${fmtPnl(v)}</div></div>
      <div><div class="cal-sub">收益率</div><div class="value ${dayRate == null ? '' : clsPnl(dayRate)}">${dayRate == null ? '—' : (dayRate >= 0 ? '+' : '') + dayRate.toFixed(2) + '%'}</div></div>
      <div><div class="cal-sub">权益盈亏 (CNY)</div><div class="value ${clsPnl(equityCNY)}">${fmtPnl(equityCNY)}</div></div>
      <div><div class="cal-sub">理财盈亏 (CNY)</div><div class="value ${clsPnl(wealthCNY)}">${fmtPnl(wealthCNY)}</div></div>
      ${CAL_NAV_HTML}
    </div>${rows}${wRows}`;
  $('#calModal').hidden = false;
}

// ---- AI 总结：HTML 转义 + Markdown 渲染 ----
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// 轻量 Markdown → 安全 HTML（覆盖 AI 总结常见语法：标题/加粗/斜体/列表/代码块/行内代码/引用/链接/分隔线/段落）。
// 先整体 HTML 转义再施加标记，杜绝 XSS；链接仅允许 http(s)。
function renderMarkdown(md) {
  if (md == null) return '';
  const src = String(md).replace(/\r\n/g, '\n');
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (t) => t
    .replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const isTableSep = (s) => {
    const t = s.trim();
    if (!t.includes('|')) return false;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    return cells.length >= 1 && cells.every((c) => /^:?-{1,}:?$/.test(c));
  };
  const splitRow = (s) => {
    let t = s.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|') && t.length) t = t.slice(0, -1);
    return t.split('|').map((c) => c.trim());
  };
  const renderTable = (header, aligns, rows) => {
    let t = '<table><thead><tr>';
    header.forEach((c, idx) => { t += '<th' + (aligns[idx] ? ' class="ta-' + aligns[idx] + '"' : '') + '>' + inline(esc(c)) + '</th>'; });
    t += '</tr></thead><tbody>';
    rows.forEach((row) => {
      t += '<tr>';
      header.forEach((_, idx) => { t += '<td' + (aligns[idx] ? ' class="ta-' + aligns[idx] + '"' : '') + '>' + inline(esc(row[idx] != null ? row[idx] : '')) + '</td>'; });
      t += '</tr>';
    });
    return t + '</tbody></table>';
  };
  const lines = src.split('\n');
  let html = '';
  let i = 0;
  let listType = null;
  const listItems = [];
  const flush = () => {
    if (listType) {
      html += '<' + listType + '>' + listItems.map((it) => '<li>' + inline(esc(it)) + '</li>').join('') + '</' + listType + '>';
      listType = null; listItems.length = 0;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>';
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html += '<hr>'; i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':'), r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i]) && !isTableSep(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      html += renderTable(header, aligns, rows);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); const lv = h[1].length; html += '<h' + lv + '>' + inline(esc(h[2])) + '</h' + lv + '>'; i++; continue; }
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      html += '<blockquote>' + inline(esc(buf.join(' '))) + '</blockquote>';
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { if (listType !== 'ul') { flush(); listType = 'ul'; } listItems.push(ul[1]); i++; continue; }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { if (listType !== 'ol') { flush(); listType = 'ol'; } listItems.push(ol[1]); i++; continue; }
    if (/^\s*$/.test(line)) { flush(); i++; continue; }
    flush();
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+\.\s|```)/.test(lines[i]) &&
      !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    html += '<p>' + inline(esc(buf.join(' '))) + '</p>';
  }
  flush();
  return html;
}
// Export a full snapshot of ALL asset data (持仓/股票/基金/理财/现金/负债) to JSON.
// 勾选「完整迁移」时额外导出：收支计划、来源账户(含元数据)、AI配置、应用设置、净值历史。
async function exportHoldingsJSON() {
  const full = !!(document.getElementById('fullMigrateChk') && document.getElementById('fullMigrateChk').checked);
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
  const total = holdings.length + wealth.length + cash.length + liability.length;
  if (!total) { toast('暂无可导出的数据', 'err'); return; }

  const payload = {
    exported_at: new Date().toISOString(),
    rates: { usd_cny: usdRate, hkd_cny: hkdRate },
    summary: {
      holding_count: holdings.length,        // 股票 + 基金
      wealth_count: wealth.length,           // 理财
      cash_count: cash.length,               // 现金
      liability_count: liability.length,     // 负债
    },
    holdings: holdings,     // 股票 + 基金完整明细
    wealth: wealth,         // 理财
    cash: cash,             // 现金
    liability: liability,   // 负债
    asset_overview: overview, // 全量快照（含各分类汇总与净资产），确保不丢任何字段
  };

  if (full) {
    // 完整迁移：补齐收支计划 / 存款 / 来源 / AI配置 / 设置 / 净值历史
    const [pResp, sResp, aResp, nResp, phResp, depResp] = await Promise.all([
      api('/api/cashflow/plans'),
      api('/api/asset/sources'),
      api('/api/ai/settings'),
      api('/api/notify/settings'),
      api('/api/pnl/history'),
      api('/api/asset/deposits'),
    ]);
    try { const d = await pResp.json(); if (d && Array.isArray(d.plans)) payload.cashflow_plans = d.plans; } catch (_) {}
    try { const d = await depResp.json(); if (d && Array.isArray(d.deposits)) payload.deposits = d.deposits.map((x) => ({ name: x.name, amount: x.amount, currency: x.currency, rate: x.rate, cash_account_id: 0, start_date: x.start_date, end_date: x.end_date, status: 'active', note: x.note })); } catch (_) {}
    try { const d = await sResp.json(); if (d && Array.isArray(d.sources)) payload.sources = d.sources; } catch (_) {}
    try { const d = await aResp.json(); if (d && Object.keys(d).length) payload.ai_config = d; } catch (_) {}
    // 设置接口返回的 payload 是 JSON 文本，导出时解析为真正的数组/对象，避免导入再被二次字符串化
    const parsePayload = (s) => { try { return JSON.parse(s); } catch (_) { return s; } };
    const settings = {};
    try { const d = await nResp.json(); if (d && Object.keys(d).length) settings.notify = d; } catch (_) {}
    if (Object.keys(settings).length) payload.settings = settings;
    try { const d = await phResp.json(); if (d && Array.isArray(d.history)) payload.pnl_history = d.history; } catch (_) {}
    payload.migration = 'full';
    payload.version = 2;
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '持仓与资产数据_' + (full ? '完整迁移_' : '') + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const extra = full ? '（完整迁移：含收支计划/来源/AI配置/设置/净值历史）' : '';
  toast('数据已导出：持仓 ' + holdings.length + ' / 理财 ' + wealth.length + ' / 现金 ' + cash.length + ' 条' + extra, 'ok');
}

// ---- AI 配置（模型 / 提示词模板 / MCP）+ 内置 AI 助手聊天面板 ----
let aiCfg = { api_key: '', model: 'deepseek-v4-pro', base_url: 'https://api.deepseek.com', templates: [] };
let aiSelIdx = 0;
let aiModelIdx = 0; // 当前选中的模型配置下标（settings 面板，models 数组）
let aiChatModelIdx = 0; // AI 助手聊天面板选中的模型下标（独立维护，不与设置面板互相回写）

function defaultAITemplates() {
  return [
    { name: '诙谐幽默', content: '你是一位喜欢拿用户持仓开涮、但数据从不乱编的财经段子手。请基于下面「我的持仓数据」，用诙谐、幽默、带点调侃（可以适度玩梗、使用表情符号）的口吻，给我写一份专属的「持仓体检报告」。\n要求：\n1. 先来一句风趣的总体定调（赚麻了还是绿油油）；\n2. 挑几个有代表性的持仓点评一下，夸就夸到位，亏就损到位，但数字必须准确；\n3. 用轻松的方式点出风险或槽点；\n4. 结尾给一句毒舌又实在的寄语。\n不要说教，多用口语，篇幅适中（300~500字）。\n\n我的持仓数据如下：\n{{DATA}}' },
    { name: '专业视角', content: '你是一名严谨、客观、专业的投资顾问。请基于下面的「我的持仓数据」，用专业、结构化、条理清晰的视角，做一份持仓分析报告。\n要求：\n1. 组合概览：总资产、总盈亏及收益率、CNY/USD 市值分布；\n2. 结构分析：股票与基金的占比、各市场分布、单一标的集中度风险；\n3. 今日表现：今日盈亏与今日盈亏率的整体与个股情况；\n4. 风险提示：结合回撤、集中度、币种敞口给出客观判断；\n5. 配置建议：基于以上数据给出 2~3 条可执行的优化建议。\n语言专业克制，避免夸张表述，可适度使用分点与小标题，篇幅 400~600字。\n\n我的持仓数据如下：\n{{DATA}}' },
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
  renderTplSelect(); // 之前漏调 → AI 设置的「提示词模板」下拉为空、模板名/内容不回填
  // AI 助手聊天面板的模型下拉与设置面板共享 aiCfg.models
  renderAiChatModelSelect();
  loadMcpConfig(); // 预拉取 MCP 参数（切到对应子页时也会再拉一次）
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
    // 设置里改了模板名 / 增删了模型配置，总结面板的下拉立即跟随
    renderAiChatModelSelect();
  } catch (e) {
    $('#aiErr').textContent = '保存异常：' + e.message;
  }
}

// AI 事件绑定
$('#ai_save').onclick = aiSaveSettings;
$('#ai_tpl_sel').onchange = (e) => selectTpl(parseInt(e.target.value, 10));
// 增删模板后同步刷新总结面板的模板下拉；splice 会让后续下标左移，选中的下标必须跟着挪，
// 否则「下拉选中的模板」与「实际取到的模板」会错位（越界由 renderAiChatModelSelect 兜底钳位）。
$('#ai_tpl_new').onclick = () => {
  aiCfg.templates.push({ name: '新模板' + (aiCfg.templates.length + 1), content: '请基于以下我的持仓数据，给出总结：\n{{DATA}}' });
  aiSelIdx = aiCfg.templates.length - 1;
  renderTplSelect();
  $('#ai_tpl_name').focus();
};
$('#ai_tpl_del').onclick = () => {
  if (aiCfg.templates.length <= 1) { toast('至少保留一个模板', 'err'); return; }
  const k = aiSelIdx;
  aiCfg.templates.splice(k, 1);
  aiSelIdx = Math.max(0, k - 1);
  renderTplSelect();
};
// 多模型配置：切换 / 新增 / 删除（同样要同步刷新总结面板的模型下拉）
$('#ai_model_sel').onchange = (e) => selectModel(parseInt(e.target.value, 10));
$('#ai_model_new').onclick = () => {
  syncModelFromInputs();
  aiCfg.models.push({ name: '新模型' + (aiCfg.models.length + 1), model: 'deepseek-v4-pro', api_key: '', base_url: 'https://api.deepseek.com' });
  aiModelIdx = aiCfg.models.length - 1;
  renderModelSelect();
  renderAiChatModelSelect();
  $('#ai_cfg_name').focus();
};
$('#ai_model_del').onclick = () => {
  if (aiCfg.models.length <= 1) { toast('至少保留一个模型配置', 'err'); return; }
  const k = aiModelIdx;
  aiCfg.models.splice(k, 1);
  aiModelIdx = Math.max(0, k - 1);
  renderModelSelect();
  renderAiChatModelSelect();
};
$('#ai_toggleKey').onclick = () => {
  const inp = $('#ai_apikey');
  if (inp.type === 'password') { inp.type = 'text'; $('#ai_toggleKey').textContent = '隐藏'; }
  else { inp.type = 'password'; $('#ai_toggleKey').textContent = '显示'; }
};
$('#ai_tpl_sel').onchange = (e) => selectTpl(parseInt(e.target.value, 10));
// ai_export_json 已迁至「账本管理」抽屉（见 wireUserUI 中绑定）

// ---- 数据导入（格式与导出一致，入库当前账本）----
let pendingImport = null;
// ai_import_json 已迁至「账本管理」抽屉（见 wireUserUI 中绑定）
$('#importFile').onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = ''; // 允许重复选择同一文件
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const lists = ['holdings', 'wealth', 'cash', 'liability'];
    if (!lists.some((k) => Array.isArray(data[k]) && data[k].length)) {
      toast('文件不是有效的导出数据（缺少 holdings/wealth 等数组）', 'err');
      return;
    }
    pendingImport = data;
    const counts = lists.map((k) => `${k} ${(data[k] || []).length}`).join(' / ');
    const extra = [];
    if (Array.isArray(data.cashflow_plans) && data.cashflow_plans.length) extra.push(`收支计划 ${data.cashflow_plans.length}`);
    if (data.ai_config) extra.push('AI配置 1');
    if (data.settings) extra.push('设置');
    if (data.calc_inputs) extra.push('计算器');
    if (Array.isArray(data.pnl_history) && data.pnl_history.length) extra.push(`净值历史 ${data.pnl_history.length}`);
    const btn = $('#confirmOk');
    btn.textContent = '导入';
    btn.classList.remove('danger');
    $('#confirmTitle').textContent = '确认导入';
    $('#confirmMsg').textContent = `将导入：${counts}${extra.length ? '；' + extra.join(' / ') : ''}。已存在的同名记录会自动跳过，是否继续？`;
    $('#confirmModal').hidden = false;
  } catch (err) { toast('文件解析失败：' + err.message, 'err'); }
};

// ---- 理财历史盈亏弹框（每日盈亏与审计合并，无 tab）----

// 历史盈亏弹框 2 段切换：amount 盈亏金额曲线 / tx 交易记录表格（加减仓+分红，2026-10-20 起移除「盈亏率」分段）。
// 切换分段不重新请求：曲线与记录各自缓存。
let histSeg = 'amount';
let histPnlData = null;    // /pnl-history 响应缓存
let histTxsCache = null;   // /transactions 响应缓存（tx 分段懒加载，回退后置空重拉）
let histHistId = 0;        // 当前弹框持仓 id
let histHistCur = '¥';     // 曲线货币前缀（¥ / USD / HK$）

async function openHoldingHistory(id) {
  $('#histModal').hidden = false;
  histHistId = Number(id);
  histSeg = 'amount';
  syncHistSegBar();
  histPnlData = null;
  histTxsCache = null;
  $('#histTxBody').hidden = true;
  $('#histTxBody').innerHTML = '';
  $('#histChartBody').hidden = false;
  $('#histChartBody').innerHTML = '<p class="u-muted u-py-2">加载中…</p>';
  const r = await api('/api/holdings/' + id + '/pnl-history');
  if (!r.ok) { $('#histChartBody').innerHTML = '<p class="u-danger">加载失败 (HTTP ' + r.status + ')</p>'; return; }
  const d = await r.json();
  histPnlData = d;
  const h = d.holding || {};
  histHistCur = ((d.currency || '').toUpperCase() === 'USD' ? 'USD ' : (d.currency || '').toUpperCase() === 'HKD' ? 'HK$ ' : '¥');
  $('#histTitle').textContent = (h.name || '') + '（' + (h.symbol || '') + '）历史盈亏';
  // 已清仓：曲线后端已按清仓日截断，标题后补清仓日期，避免"为什么这几天没数据"的疑问
  const old = document.getElementById('histClosedTip');
  if (old) old.remove();
  if (d.holding && d.holding.closed) {
    const tip = document.createElement('div');
    tip.id = 'histClosedTip';
    tip.className = 'hist-closed-tip';
    const last = (d.series && d.series.length) ? d.series[d.series.length - 1].date : '';
    tip.textContent = d.holding.closed_date
      ? ('已清仓 · 曲线截至 ' + (last || d.holding.closed_date) + '，此后行情不再计入持仓盈亏')
      : '已清仓 · 曲线已截止至清仓日';
    $('#histTitle').insertAdjacentElement('afterend', tip);
  }
  renderHistSeg();
}

// 分段胶囊 active 态同步
function syncHistSegBar() {
  const bar = $('#histSegBar');
  if (bar) bar.querySelectorAll('button[data-seg]').forEach((x) => x.classList.toggle('active', x.dataset.seg === histSeg));
}

// 按当前分段渲染：amount → 盈亏走势曲线；nav → 历史净值表格；tx → 交易记录表格
function renderHistSeg() {
  const chart = $('#histChartBody'), tx = $('#histTxBody'), nav = $('#histNavBody');
  if (!chart || !tx || !nav || !histPnlData) return;
  const isAmount = histSeg === 'amount';
  const isNav = histSeg === 'nav';
  const isTx = histSeg === 'tx';
  chart.hidden = !isAmount;
  tx.hidden = !isTx;
  nav.hidden = !isNav;
  if (isAmount) { chart.innerHTML = ''; renderHistChart(histPnlData, histHistCur, 'amount'); }
  else if (isNav) { syncHistNavRangeBar(); renderHistNavTable(); }
  else if (isTx) { renderHistTxTable(); }
}

// 历史净值段状态：时间段（7/30/0/自定义）+ 自定义起止；默认近 7 天
let histNavRange = 7;
let histNavFrom = '';
let histNavTo = '';

// 历史净值表格：复用 /api/holdings/:id/pnl-history 的 series（已含 close/涨跌幅/盈亏金额/累计盈亏），
// 按时间段控件过滤后展示「日期 / 净值·股价 / 涨跌幅 / 盈亏金额 / 累计盈亏」。
function renderHistNavTable() {
  const body = $('#histNavTable');
  if (!body || !histPnlData) return;
  const sAll = (histPnlData.series || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  let rows = sAll;
  if (histNavRange === 'custom') {
    rows = sAll.filter((x) => (!histNavFrom || x.date >= histNavFrom) && (!histNavTo || x.date <= histNavTo));
  } else if (histNavRange > 0) {
    const last = sAll.length ? sAll[sAll.length - 1].date : '';
    if (last) {
      const dt = new Date(last);
      dt.setDate(dt.getDate() - histNavRange + 1);
      const cutFrom = dt.toISOString().slice(0, 10);
      rows = sAll.filter((x) => x.date >= cutFrom);
    }
  }
  const cur = histHistCur || '¥';
  const head = '<thead><tr><th>日期</th><th class="num">净值·股价</th><th class="num">涨跌幅</th>'
    + '<th class="num">盈亏金额</th><th class="num">累计盈亏</th></tr></thead>';
  if (!rows.length) { body.innerHTML = '<p class="u-muted u-py-2">该区间无数据</p>'; return; }
  // 展示倒序：从最新开始（区间过滤仍基于升序 sAll，这里仅反转展示）
  rows = rows.slice().reverse();
  const trs = rows.map((x) => {
    const pct = x.day_pnl_pct;
    const pctTxt = (pct == null || isNaN(pct)) ? '—' : ((pct >= 0 ? '+' : '') + pct.toFixed(2) + '%');
    const pctCls = (pct == null || isNaN(pct)) ? 'flat' : clsPnl(pct);
    const day = x.day_pnl || 0;
    const tot = x.total_pnl || 0;
    // 净值·股价固定 4 位小数（基金净值与股价均需 4 位精度，整数位后不足补零）
    const navTxt = (x.close == null || isNaN(x.close)) ? '—' : Number(x.close).toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return '<tr>'
      + '<td>' + esc(x.date) + '</td>'
      + '<td class="num">' + navTxt + '</td>'
      + '<td class="num ' + pctCls + '">' + pctTxt + '</td>'
      + '<td class="num ' + clsPnl(day) + '">' + (day >= 0 ? '+' : '') + cur + fmt(day) + '</td>'
      + '<td class="num ' + clsPnl(tot) + '">' + (tot >= 0 ? '+' : '') + cur + fmt(tot) + '</td>'
      + '</tr>';
  }).join('');
  body.innerHTML = '<table class="hist-nav-table">' + head + '<tbody>' + trs + '</tbody></table>';
}

// 分段切换（静态元素，绑定一次）
$('#histSegBar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-seg]');
  if (!b || b.dataset.seg === histSeg) return;
  histSeg = b.dataset.seg;
  syncHistSegBar();
  renderHistSeg();
});

// 历史净值段：时间段控件（30/90/0/自定义），复用 pnl-history 的 series 前端过滤。
$('#histNavRangeBar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-range]');
  if (!b) return;
  const v = b.dataset.range;
  if (v === 'custom') {
    histNavRange = 'custom';
    const sAll = (histPnlData.series || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (sAll.length) { histNavFrom = sAll[0].date; histNavTo = sAll[sAll.length - 1].date; $('#histNavFrom').value = histNavFrom; $('#histNavTo').value = histNavTo; }
  } else {
    histNavRange = Number(v);
  }
  syncHistNavRangeBar();
  renderHistNavTable();
});
$('#histNavFrom').addEventListener('change', () => { histNavFrom = $('#histNavFrom').value || ''; renderHistNavTable(); });
$('#histNavTo').addEventListener('change', () => { histNavTo = $('#histNavTo').value || ''; renderHistNavTable(); });

// 同步历史净值段范围胶囊 active 态 + 自定义区间显隐
function syncHistNavRangeBar() {
  const bar = $('#histNavRangeBar');
  if (bar) bar.querySelectorAll('button[data-range]').forEach((x) => x.classList.toggle('active', x.dataset.range === String(histNavRange)));
  const customRow = $('#histNavCustomRow');
  if (customRow) customRow.hidden = (histNavRange !== 'custom');
}

// 回退等操作后重拉曲线 + 交易记录（保留当前分段）
async function reloadHistData() {
  if (!histHistId) return;
  try {
    const [rp, rt] = await Promise.all([
      api('/api/holdings/' + histHistId + '/pnl-history'),
      api('/api/holdings/' + histHistId + '/transactions'),
    ]);
    if (rp.ok) histPnlData = await rp.json();
    histTxsCache = rt.ok ? await rt.json() : null;
    renderHistSeg();
  } catch (_) { /* 弹框数据刷新失败不打断主流程 */ }
}

// 交易记录分段：加减仓 + 分红合并为一张表（原卡片视图改表格，2026-10-20）。
// 列口径：DIV 行 价格列=折算每股、盈亏列=净入账（分红总额−费用）；SELL 的盈亏列=已实现盈亏，BUY 无盈亏。
function renderHistTxTable() {
  const body = $('#histTxBody');
  if (!body) return;
  if (!histTxsCache) {
    body.innerHTML = '<p class="u-muted u-py-2">加载中…</p>';
    api('/api/holdings/' + histHistId + '/transactions').then(async (r) => {
      if (!r.ok) { body.innerHTML = '<p class="u-danger">记录加载失败</p>'; return; }
      histTxsCache = await r.json();
      if (histSeg === 'tx') renderHistTxTable();
    }).catch(() => { body.innerHTML = '<p class="u-danger">记录加载异常</p>'; });
    return;
  }
  const d = histTxsCache;
  const h = (histPnlData && histPnlData.holding) || {};
  const txs = d.transactions || [];
  // 头部口径沿用原卡片视图：实现盈亏=只有减仓才落袋；加仓浮动盈亏=当前持仓的浮动盈亏（与列表同源）
  let html = '<div class="adj-realized">累计实现盈亏：<b>' + histHistCur + fmt(d.realized_total || 0) + '</b>';
  if ((h.quantity || 0) > 0) html += `<span class="adj-float ${clsPnl(h.pnl)}">｜加仓浮动盈亏：<b>${histHistCur}${fmt(h.pnl)}</b>${h.pnl_pct != null ? ` <small>(${pct(h.pnl_pct)})</small>` : ''}</span>`;
  html += '</div>';
  if (!txs.length) { body.innerHTML = html + '<div class="adj-empty">暂无记录</div>'; return; }
  html += '<table class="asset-table"><thead><tr>' +
    '<th>类型</th><th>日期</th><th class="num">数量/份额</th><th class="num" title="交易=成交价；分红=折算每股">价格/每股</th>' +
    '<th class="num" title="交易=成交金额；分红=分红总额">金额</th><th class="num">费用</th>' +
    '<th class="num" title="减仓=已实现盈亏；分红=净入账（分红总额−费用）">盈亏/净入账</th>' +
    '<th>备注</th><th>操作</th></tr></thead><tbody>';
  for (const t of txs) {
    const reverted = (t.reverted === 1 || t.reverted === true);
    const isDiv = t.tx_type === 'DIV';
    const isReinvest = t.tx_type === 'REINVEST';
    const tag = t.tx_type === 'BUY' ? '<span class="adj-tag buy">加仓</span>'
      : isDiv ? '<span class="adj-tag div">分红</span>'
      : isReinvest ? '<span class="adj-tag reinvest">红利再投</span>'
      : '<span class="adj-tag sell">减仓</span>';
    const net = (Number(t.amount) || 0) - (Number(t.fee) || 0);
    const pnlCell = isDiv
      ? `<span class="${clsPnl(net)}">${fmt(net)}</span>`
      : t.tx_type === 'SELL' ? `<span class="${clsPnl(t.realized_pnl)}">${fmtPnl(t.realized_pnl)}</span>`
      : isReinvest ? '<span class="u-muted">再投 +' + fmt(t.quantity) + ' 份</span>'
      : '<span class="u-muted">—</span>';
    const op = reverted ? '<span class="u-muted">已回退</span>'
      : actBtn('undo', `data-revert="${t.id}"`, '回退该笔交易（还原份额/成本价与资金账户，减仓还会撤销已实现盈亏）');
    html += '<tr>' +
      `<td>${tag}</td>` +
      `<td class="u-sm u-muted">${t.created_at ? t.created_at.slice(0, 10) : '—'}</td>` +
      `<td class="num">${fmt(t.quantity)}</td>` +
      `<td class="num">${fmt(t.price)}</td>` +
      `<td class="num">${fmt(t.amount)}</td>` +
      `<td class="num u-muted">${t.fee ? fmt(t.fee) : '—'}</td>` +
      `<td class="num">${pnlCell}</td>` +
      `<td class="u-sm note-cell" title="${esc(t.note || '')}">${t.note ? esc(t.note) : '<span class="u-muted">—</span>'}</td>` +
      `<td class="row-actions">${op}</td>` +
      '</tr>';
  }
  html += '</tbody></table>';
  body.innerHTML = html;
  body.querySelectorAll('[data-revert]').forEach((b) => {
    b.onclick = () => revertAdjTx(histHistId, Number(b.dataset.revert));
  });
}

// 每日盈亏与审计合并：按 date 取 audit 最新一条，作为操作列（撤销/删除）的数据来源
function buildWealthAuditMap(rows) {
  wealthHistAuditMap = {};
  // audit 已按 created_at 倒序（新→旧），首次出现即该 date 的最新快照状态
  for (const a of (rows || [])) {
    if (!wealthHistAuditMap[a.date]) wealthHistAuditMap[a.date] = a;
  }
}

// 撤销 / 删除该日快照：委托到表格容器，重渲染后按钮仍生效
function bindWealthHistActions(scope) {
  scope.querySelectorAll('[data-undo]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r2 = await api('/api/asset/wealth/snapshots/undo', { method: 'POST', body: JSON.stringify({ audit_id: Number(b.dataset.undo) }) });
        if (!r2.ok) { let m = '撤销失败'; try { const d2 = await r2.json(); if (d2 && d2.error) m = d2.error; } catch (_) {} toast(m, 'err'); b.disabled = false; return; }
        toast('已撤销', 'ok');
        await reloadWealthHist(); // 重新拉取并合并审计（保留当前范围）
      } catch (e) { toast('撤销异常：' + e.message, 'err'); b.disabled = false; }
    };
  });
  scope.querySelectorAll('[data-del-date]').forEach((b) => {
    b.onclick = () => {
      pendingSnapDelete = { wealth_id: currentWealthHistId, date: b.dataset.delDate };
      $('#confirmTitle').textContent = '删除该日快照';
      $('#confirmMsg').textContent = '确认删除 ' + b.dataset.delDate + ' 的这条持仓记录？删除后仍可在本表撤销。';
      $('#confirmOk').textContent = '删除';
      $('#confirmOk').classList.add('danger');
      $('#confirmModal').hidden = false;
    };
  });
  scope.querySelectorAll('[data-edit-date]').forEach((b) => {
    b.onclick = () => openWealthSnapEdit(b.dataset.editDate);
  });
}

// 编辑某日理财快照：修正持仓金额 / 净存入 / 分红（用于分红导致净值跳降后回填分红，校正历史曲线）。
function openWealthSnapEdit(date) {
  const row = (wealthHistAllRows || []).find((r) => r.date === date);
  if (!row) { toast('未找到该日记录', 'err'); return; }
  const p = (assetData.wealth.products || []).find((x) => x.id === currentWealthHistId) || {};
  $('#whEditHint').textContent = (p.name || ('理财 #' + currentWealthHistId)) + ' · ' + date + '（分红填现金分红金额，红利再投资留 0）';
  $('#whEditAmt').value = round2(row.amount || 0);
  $('#whEditCf').value = round2(row.cashflow || 0);
  $('#whEditDiv').value = round2(row.dividend || 0);
  $('#whEditModal').dataset.date = date;
  $('#whEditModal').hidden = false;
}
$('#whEditCancel').onclick = () => { $('#whEditModal').hidden = true; };
$('#whEditSave').onclick = async () => {
  const date = $('#whEditModal').dataset.date;
  if (!date) return;
  const amount = Number($('#whEditAmt').value || 0);
  const cashflow = Number($('#whEditCf').value || 0);
  const dividend = Number($('#whEditDiv').value || 0);
  if (amount < 0) { toast('持仓金额不能为负', 'err'); return; }
  try {
    const r = await api('/api/asset/wealth/snapshots', { method: 'POST', body: JSON.stringify({ date, items: [{ wealth_id: currentWealthHistId, amount, cashflow, dividend }] }) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
    $('#whEditModal').hidden = true;
    toast('已保存', 'ok');
    await reloadWealthHist();
  } catch (e) { toast('异常：' + e.message, 'err'); }
};

// 理财每日盈亏弹框：时间范围筛选（近30/90天·全部·自定义），纯前端按 date 过滤、后端零改动
$('#whRangeBar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-range]');
  if (!b) return;
  const v = b.dataset.range;
  if (v === 'custom') {
    wealthHistRange = 'custom';
    const all = wealthHistAllRows;
    if (all.length) {
      $('#whFrom').value = all[0].date;
      $('#whTo').value = all[all.length - 1].date;
      wealthHistCustomFrom = all[0].date;
      wealthHistCustomTo = all[all.length - 1].date;
    }
  } else {
    wealthHistRange = Number(v);
    wealthHistShown = 500;
  }
  syncWealthRangeBar();
  renderWealthHistTable();
});
$('#whFrom').addEventListener('change', () => { wealthHistCustomFrom = $('#whFrom').value || null; renderWealthHistTable(); });
$('#whTo').addEventListener('change', () => { wealthHistCustomTo = $('#whTo').value || null; renderWealthHistTable(); });

// （持仓历史不再渲染每日表格；曲线悬停/点按柱子弹框展示，见 drawPnlCurve / showHistTip）

// 复用全局盈亏走势的 SVG 双轴风格：单日盈亏柱状（左轴，红涨绿跌）+ 累计盈亏折线（右轴）
// 持仓历史盈亏 / 理财每日盈亏 共用绘制器（数据结构统一为 { date, day_pnl, total_pnl }）。
// 这两处此前各写一份近乎相同的 SVG 逻辑，改视觉时极易只改一半（曾导致柱子静默不渲染），
// 合并后只需改这一处。视觉规格见 docs/ui-design-spec.md §3.11。
// mode='rate' 时画「累计盈亏率」折线（series 的 total_pnl_pct / day_pnl_pct，%）——历史盈亏弹框
// 盈亏率分段复用同一绘制器，仅取值口径与 Y 轴/tooltip 格式化不同。
function drawPnlCurve(s, cur, markers, closedInfo, closedDetail, mode) {
  const isRate = mode === 'rate';
  // 取值口径：金额=total_pnl；比率=total_pnl_pct（后端缺该字段时退化为 0）
  const valOf = isRate ? (x) => (x.total_pnl_pct != null ? x.total_pnl_pct : 0) : (x) => (x.total_pnl || 0);
  const body = $('#histChartBody');
  if (!s || s.length === 0) { body.innerHTML = '<p class="u-muted">暂无历史数据。</p>'; return; }
  // 全量默认绘制：单屏最多容纳 ~60 个行情点（604px ÷ 10px/点），超出即横向滚动
  // （移动端原生手势、桌面滚轮映射，无翻页状态）。每个行情点保证最小 10px 宽度，
  // 悬停热区可点、x 轴标签不糊。
  const W = 720, H = 236, mL = 58, mR = 58, mT = 16, mB = 34;  // 2026-10-15 压低画布高度（原 356）
  const plotH = H - mT - mB;
  const n = s.length;
  const SLOT_MIN = 10;
  const fitW = W - mL - mR;
  const Wfull = (n * SLOT_MIN > fitW) ? (mL + mR + n * SLOT_MIN) : W;
  const plotW = Wfull - mL - mR;
  const vals = s.map(valOf);
  // Y 轴自适应（C 方案）：不再强制以 0 为中心。全负或全正时曲线能铺满整个绘图区，
  // 纵向分辨率翻倍；0 落在范围内才画零轴线。
  let vLo = Math.min(...vals), vHi = Math.max(...vals);
  if (!isFinite(vLo) || !isFinite(vHi)) { vLo = 0; vHi = 1; }
  if (vHi - vLo < 1e-9) { vHi = vLo + 1; vLo -= 1; }
  const vPad = (vHi - vLo) * 0.12;
  vLo -= vPad; vHi += vPad;
  // 0 参与定界则保留零轴，让「盈亏由负转正」仍可读；否则曲线不跨零（纯趋势）
  const hasZero = vLo <= 0 && vHi >= 0;
  const yOf = (v) => mT + plotH - ((v - vLo) / (vHi - vLo)) * plotH;
  const yLine = yOf;
  const zeroY = yOf(0);
  const slot = plotW / n;
  const uid = 'th' + (++trendUidSeq);
  const linePts = [];
  let line = '', area = '', dots = '', hotspots = '';
  s.forEach((x, i) => {
    const cx = mL + (i + 0.5) * slot;
    const ly = yLine(valOf(x));
    // 交互热区：覆盖整列，hover 显示金额；坐标带上供悬停指示线定位
    hotspots += `<rect class="trend-hot" data-i="${i}" data-x="${cx.toFixed(2)}" data-y="${ly.toFixed(2)}"`
      + ` x="${(mL + i * slot).toFixed(2)}" y="${mT}" width="${slot.toFixed(2)}" height="${plotH}" fill="transparent"/>`;
    linePts.push([cx, ly]);
    // 2026-10-15：去掉单日盈亏柱状，只保留累计盈亏折线 + 悬停读数（单日盈亏在 tooltip 里仍可见）
    line += `${(i === 0 ? 'M' : 'L')} ${cx.toFixed(2)} ${ly.toFixed(2)} `;
    // 只在最新一天画实心圆点：逐点信息交给悬停指示点
    if (i === n - 1) {
      dots += `<circle cx="${cx.toFixed(2)}" cy="${ly.toFixed(2)}" r="3.4"`
        + ` class="chart-dot"/>`;
    }
  });
  // 面积：渐变填充（基线取绘图区底部 —— Y 轴已自适应，零轴可能落在图区外）
  if (linePts.length) {
    const baseY = mT + plotH;
    let ap = `M ${linePts[0][0].toFixed(2)} ${baseY.toFixed(2)} `;
    linePts.forEach((p) => { ap += `L ${p[0].toFixed(2)} ${p[1].toFixed(2)} `; });
    ap += `L ${linePts[linePts.length - 1][0].toFixed(2)} ${baseY.toFixed(2)} Z`;
    area = `<path d="${ap}" fill="url(#${uid}Area)" stroke="none"/>`;
  }
  // 交易点标记：BUY=B（红）/ SELL=S（绿），就近对齐到最近的行情点，画竖虚线 + 圆角小徽标。
  // 徽标放柱区顶部（零轴上方一侧）而不是折线上方，避免与折线/最新点圆点叠字。
  const dateIdx = new Map();
  s.forEach((x, i) => { if (!dateIdx.has(x.date)) dateIdx.set(x.date, i); });
  const usedSlot = new Set();
  const txAt = new Array(n).fill(null);   // 每个行情点关联的交易（用于 tooltip 显示成交明细）
  let mk = '';
  (markers || []).forEach((mk2) => {
    let idx = dateIdx.has(mk2.date) ? dateIdx.get(mk2.date) : -1;
    if (idx < 0) { // 就近取当天之前最近的点（交易日晚于/非交易日时兜底）
      for (let i = 0; i < n; i++) { if (s[i].date <= mk2.date) idx = i; else break; }
    }
    if (idx < 0) return;
    if (!txAt[idx]) txAt[idx] = mk2;
    let slotUsed = idx;
    while (usedSlot.has(slotUsed) && slotUsed > 0) slotUsed--; // 同日多笔交易错开一格，避免徽标完全重叠
    usedSlot.add(slotUsed);
    const cx = mL + (slotUsed + 0.5) * slot;
    const isBuy = mk2.type === 'BUY';
    const label = isBuy ? 'B' : 'S';
    // 徽标贴着折线点：点在零轴**上方**（盈利区）→ 徽标画在点上方；点在零轴下方（亏损区）→ 画在点下方。
    // 统一放图区顶部会与折线脱节、且多笔交易时挤成一排没有落点。
    const py = linePts[slotUsed][1];
    const above = py <= zeroY;
    const my = above ? py - 15 : py + 15;
    mk += `<g class="chart-marker${isBuy ? ' mk-buy' : ' mk-sell'}">`
      + `<rect x="${(cx - 8).toFixed(2)}" y="${(my - 7).toFixed(2)}" width="16" height="14" rx="4"/>`
      + `<text x="${cx.toFixed(2)}" y="${(my + 3.5).toFixed(2)}" text-anchor="middle" font-size="9" font-weight="700">${label}</text>`
      + `<title>${mk2.date} ${isBuy ? '买入' : '卖出'} ${mk2.type}${mk2.price ? ' @' + fmt(mk2.price) : ''}${mk2.note ? '（' + mk2.note + '）' : ''}</title>`
      + `</g>`;
  });
  // 已清仓：不在曲线上画徽标；hover 清仓日（或末点）仍弹出「清仓落袋」详情块
  // （累计收益 / 持仓天数 / 收益率 …）。
  const defs = trendDefs(uid);
  // 折线双层：底层粗而极淡做柔光，上层细实线定形
  const lineEl = `<path d="${line}" fill="none" stroke-linejoin="round" stroke-linecap="round"`
    + ` class="chart-line-glow"/>`
    + `<path d="${line}" fill="none" stroke-linejoin="round" stroke-linecap="round"`
    + ` class="chart-line"/>`;
  const cursor = `<line class="trend-cursor" x1="0" y1="${mT}" x2="0" y2="${(mT + plotH).toFixed(2)}" visibility="hidden"`
    + ` class="chart-guide"/>`
    + `<circle class="trend-cursor-dot" cx="0" cy="0" r="4" visibility="hidden"`
    + ` class="chart-dot"/>`;
  // x 轴标签按像素间距取步长（~60px 一个），全量数据横向滚动时标签密度保持均匀
  const xLabelStep = Math.max(1, Math.ceil(60 / slot));
  // 末位标签只在与前一个标签拉开足够间距时才补，否则会出现「09-08 09-10」叠字
  const lastTick = Math.floor((n - 1) / xLabelStep) * xLabelStep;
  let xlabels = '';
  s.forEach((x, i) => {
    if (i % xLabelStep === 0 || (i === n - 1 && n - 1 - lastTick >= 2)) {
      const cx = mL + (i + 0.5) * slot;
      xlabels += `<text x="${cx.toFixed(2)}" y="${H - 14}" font-size="11" text-anchor="middle"`
        + ` class="chart-label">${x.date.slice(5)}</text>`;
    }
  });
  // Y 轴自适应（C 方案）：刻度取全量数据的实际 min/max，左右两轴都标同一组值；
// 零轴只在 0 落在 [vLo,vHi] 内时绘制 —— 否则「全负」标的不会挤在下半区。
// 比率口径：带符号 + 固定 2 位小数 + %（形状对齐 fmtPnl/pct 约定）
const fv = isRate ? (v) => (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%' : (v) => fmt(v);
  const yLabels = `
    <text x="${mL - 8}" y="${(mT + 4).toFixed(2)}" font-size="11" text-anchor="end" class="chart-label-up">${fv(vHi)}</text>
    <text x="${mL - 8}" y="${(mT + plotH + 4).toFixed(2)}" font-size="11" text-anchor="end" class="chart-label-down">${fv(vLo)}</text>
    <text x="${Wfull - mR + 8}" y="${(mT + 4).toFixed(2)}" font-size="11" text-anchor="start" class="chart-label-cum">${fv(vHi)}</text>
    <text x="${Wfull - mR + 8}" y="${(mT + plotH + 4).toFixed(2)}" font-size="11" text-anchor="start" class="chart-label-cum">${fv(vLo)}</text>`
    + (hasZero ? `<text x="${mL - 8}" y="${(zeroY + 4).toFixed(2)}" font-size="11" text-anchor="end" class="chart-label">0</text>
    <text x="${Wfull - mR + 8}" y="${(zeroY + 4).toFixed(2)}" font-size="11" text-anchor="start" class="chart-label">0</text>` : '');
  const q1 = (mT + plotH * 0.25).toFixed(2), q3 = (mT + plotH * 0.75).toFixed(2);
  const grid = `<line x1="${mL}" y1="${q1}" x2="${Wfull - mR}" y2="${q1}" class="chart-hline"/>`
    + `<line x1="${mL}" y1="${q3}" x2="${Wfull - mR}" y2="${q3}" class="chart-hline"/>`
    + (hasZero ? `<line x1="${mL}" y1="${zeroY.toFixed(2)}" x2="${Wfull - mR}" y2="${zeroY.toFixed(2)}" class="chart-zero"/>` : '');
  const legend = `
    <div class="chart-legend">
      <span><span class="chart-line-key"></span>${isRate ? '累计盈亏率' : '累计盈亏'}</span>
      ${(markers && markers.length) ? '<span><span class="chart-marker-key mk-buy"></span>B 买入</span><span><span class="chart-marker-key mk-sell"></span>S 卖出</span>' : ''}
    </div>`;
  body.innerHTML = `
    <div class="chart-curve-wrap">
    <svg width="${Wfull}" height="${H}" viewBox="0 0 ${Wfull} ${H}">
      ${defs}${grid}${area}${cursor}${mk}
      ${lineEl}
      ${dots}${yLabels}${xlabels}${hotspots}
    </svg></div>${legend}`;
  // 横向滚动：默认定位到最新一天（最右）；桌面滚轮纵向增量映射为横向滚动（仅在有溢出时拦截）
  const wrapEl = body.querySelector('.chart-curve-wrap');
  if (wrapEl) {
    wrapEl.scrollLeft = wrapEl.scrollWidth;
    wrapEl.addEventListener('wheel', (e) => {
      if (wrapEl.scrollWidth <= wrapEl.clientWidth + 1) return;
      wrapEl.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }
  // 绑定柱子交互热区 tooltip + 悬停指示线/指示点；支持桌面悬停 / 触屏点按（点击固定，再次点击或点空白区取消）
  const curEl = body.querySelector('.trend-cursor');
  const curDot = body.querySelector('.trend-cursor-dot');
  let pinnedI = -1;
  const focusBar = (i) => {
    const r2 = body.querySelectorAll('.trend-hot')[i];
    const cx = r2.dataset.x, cy = r2.dataset.y;
    if (curEl) { curEl.setAttribute('x1', cx); curEl.setAttribute('x2', cx); curEl.setAttribute('visibility', 'visible'); }
    if (curDot) { curDot.setAttribute('cx', cx); curDot.setAttribute('cy', cy); curDot.setAttribute('visibility', 'visible'); }
  };
  // 清仓落袋块挂载点：优先精确匹配清仓日；清仓日若没有行情点（常见——清仓后该标的停止更新报价，
  // 序列末点早于清仓日），则退化为「曲线末点」，因为末点之后就是清仓，语义仍然成立。
const closedTipFor = (i) => {
  if (!closedDetail) return null;
  if (closedDetail.date === s[i].date) return closedDetail;
  if (i === n - 1) return Object.assign({}, closedDetail, { date: s[i].date, realClosedDate: closedDetail.date, isLast: true });
  return null;
};
  body.querySelectorAll('.trend-hot').forEach((r) => {
    const i = +r.dataset.i;
    r.addEventListener('mouseenter', (e) => {
      if (pinnedI !== -1) return;
      focusBar(i);
      showHistTip(e, s[i], cur, closedTipFor(i), txAt[i], isRate);
    });
    r.addEventListener('mousemove', moveTrendTip);
    r.addEventListener('mouseleave', () => {
      if (curEl) curEl.setAttribute('visibility', 'hidden');
      if (curDot) curDot.setAttribute('visibility', 'hidden');
      if (pinnedI === -1) hideTrendTip();
    });
    r.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pinnedI === i) { pinnedI = -1; hideTrendTip(); }
      else { pinnedI = i; focusBar(i); showHistTip(e, s[i], cur, closedTipFor(i), txAt[i], isRate); moveTrendTip(e); }
    });
  });
  // 点击曲线图空白区取消固定（触屏再次点按时收起浮框）
  const svgEl = body.querySelector('svg');
  if (svgEl) svgEl.addEventListener('click', () => { if (pinnedI !== -1) { pinnedI = -1; hideTrendTip(); } });
}

// 持仓历史盈亏：series 已含 day_pnl / total_pnl，直接交给共用绘制器（mode 决定金额/比率口径）
function renderHistChart(d, cur, mode) {
  const h = d.holding || {};
  const ci = h.closed ? { closed: true, closedDate: h.closed_date } : null;
  drawPnlCurve(d.series || [], cur, d.markers || [], ci, d.closed_info || null, mode);
}

// 历史盈亏曲线 tooltip：悬停/点按柱子显示单日盈亏、涨跌幅、累计盈亏等。
// isRate（盈亏率分段）：主行改展示 涨跌幅 / 累计收益率（%），金额行保留作辅助信息。
// 所有金额一律带货币符号（cur0 已含 ¥ / USD / HK$ 前缀）。
// closedInfo 命中当前点时（清仓日）追加「清仓落袋」区块：累计收益 / 持仓天数 / 收益率 / 成本 / 成交价。
function showHistTip(e, x, cur, closedInfo, tx, isRate) {
  let tip = document.getElementById('trendTip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'trendTip'; tip.className = 'trend-tip'; document.body.appendChild(tip); }
  const cur0 = cur || '¥';
  const day = (x.day_pnl !== undefined ? x.day_pnl : (x.pnl || 0));
  const cum = (x.total_pnl !== undefined ? x.total_pnl : (x.cum_pnl || 0));
  const cls = day > 0 ? 't-up' : day < 0 ? 't-down' : 't-muted';
  const cumCls = cum > 0 ? 't-up' : cum < 0 ? 't-down' : 't-muted';
  const money = (v) => cur0 + fmt(v);
  let html = '<div class="t-date">' + x.date + '</div>';
  if (isRate) {
    const dayP = (x.day_pnl_pct != null ? x.day_pnl_pct : 0);
    const cumP = (x.total_pnl_pct != null ? x.total_pnl_pct : 0);
    const pCls = dayP > 0 ? 't-up' : dayP < 0 ? 't-down' : 't-muted';
    const cPCls = cumP > 0 ? 't-up' : cumP < 0 ? 't-down' : 't-muted';
    html += '<div class="t-row"><span>涨跌幅</span><span class="' + pCls + '">' + pct(dayP) + '</span></div>'
      + '<div class="t-row"><span>累计收益率</span><span class="' + cPCls + '">' + pct(cumP) + '</span></div>'
      + '<div class="t-row"><span>盈亏</span><span class="' + cls + '">' + (day > 0 ? '+' : '') + money(day) + '</span></div>';
  } else {
    html += '<div class="t-row"><span>盈亏</span><span class="' + cls + '">' + (day > 0 ? '+' : '') + money(day) + '</span></div>';
    if (x.day_pnl_pct !== undefined && x.day_pnl_pct !== null)
      html += '<div class="t-row"><span>涨跌幅</span><span class="' + cls + '">' + pct(x.day_pnl_pct) + '</span></div>';
  }
  html += '<div class="t-row"><span>累计盈亏</span><span class="' + cumCls + '">' + (cum > 0 ? '+' : '') + money(cum) + '</span></div>';
  if (x.total_pnl_pct !== undefined && x.total_pnl_pct !== null)
    html += '<div class="t-row"><span>累计涨跌幅</span><span class="' + cumCls + '">' + pct(x.total_pnl_pct) + '</span></div>';
  if (x.market_value !== undefined && x.market_value !== null)
    html += '<div class="t-row"><span>市值</span><span>' + money(x.market_value) + '</span></div>';
  if (x.close !== undefined && x.close !== null)
    html += '<div class="t-row"><span>收盘价</span><span>' + money(x.close) + '</span></div>';
  // 成交明细块：该点当天有买入/卖出时显示（成本价 / 数量 / 成交金额 / 手续费 / 备注）
  if (tx) {
    const isBuy = tx.type === 'BUY';
    html += '<div class="t-sep"></div>'
      + '<div class="t-row t-head"><span>' + (isBuy ? '买入成交' : '卖出成交') + '</span><span>' + tx.date + '</span></div>'
      + '<div class="t-row"><span>成交价</span><span>' + money(tx.price) + '</span></div>'
      + '<div class="t-row"><span>数量</span><span>' + fmt(tx.quantity) + '</span></div>'
      + '<div class="t-row"><span>成交金额</span><span>' + money(tx.amount) + '</span></div>'
      + (tx.fee ? '<div class="t-row"><span>手续费</span><span>' + money(tx.fee) + '</span></div>' : '')
      + (tx.note ? '<div class="t-row"><span>备注</span><span>' + esc(tx.note) + '</span></div>' : '');
  }
  // 清仓日：改用「落袋」口径单独成块，避免与逐日浮盈口径混淆
  if (closedInfo && (closedInfo.date === x.date || x.isLast)) {
    const rCls = closedInfo.realized_pnl > 0 ? 't-up' : closedInfo.realized_pnl < 0 ? 't-down' : 't-muted';
    html += '<div class="t-sep"></div>'
      + '<div class="t-row t-head"><span>清仓落袋</span><span>清仓日 ' + (closedInfo.realClosedDate || closedInfo.date) + '</span></div>'
      + '<div class="t-row"><span>累计收益</span><span class="' + rCls + '">' + (closedInfo.realized_pnl > 0 ? '+' : '') + money(closedInfo.realized_pnl) + '</span></div>'
      + '<div class="t-row"><span>成本金额</span><span>' + money(closedInfo.cost_amount) + '</span></div>'
      + '<div class="t-row"><span>收益率</span><span class="' + rCls + '">' + pct(closedInfo.return_rate) + '</span></div>'
      + '<div class="t-row"><span>持仓天数</span><span>' + (closedInfo.holding_days > 0 ? closedInfo.holding_days + ' 天' : '—') + '</span></div>'
      + '<div class="t-row"><span>成交价</span><span>' + money(closedInfo.sell_price) + '</span></div>';
  }
  tip.innerHTML = html;
  tip.classList.add('show');
  moveTrendTip(e);
}

// 应用入口：静默自动登录后直接进入（登录界面已移除）
boot();

// ===================== 资产全景模块 =====================
let assetData = null;       // /api/asset/overview 响应
let pieData = null;          // 最近一次绘制「资产构成」饼图所用的总览数据，供二级下钻使用
let assetSources = [];       // 资产来源缓存（供下拉）
let pendingAssetDel = null;   // { type, id }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===== 行内操作图标字典 + 按钮工厂（规范见 docs/ui-design-spec.md §3.3.1）=====
// 统一 16px 线性描边、一律 currentColor。新增操作先在此登记，不要在模板里现写 SVG。
const ACT_ICONS = {
  edit: '<path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5l-1 3Z"/><path d="M14.5 6.5 17.5 9.5"/>',
  hist: '<path d="M3.5 16.5 8.5 11l4 3 7.5-7.5"/><path d="M15 6.5h5.5V12"/>',
  del: '<path d="M4.5 7h15"/><path d="M9.5 7V4.6h5V7"/><path d="M6.5 7l1 12.4h9l1-12.4"/><path d="M10.2 10.8v5.6M13.8 10.8v5.6"/>',
  adjust: '<path d="M8 20.5v-17"/><path d="M4.5 8 8 3.5 11.5 8"/><path d="M16 3.5v17"/><path d="M12.5 16 16 20.5 19.5 16"/>',
  analysis: '<circle cx="11" cy="11" r="6.2"/><path d="M15.6 15.6 20.5 20.5"/><path d="M8.4 12.4l2-2 1.6 1.6 2-2.6"/>',
  transfer: '<path d="M4 8.5h12.5"/><path d="M13.5 5.5 16.5 8.5 13.5 11.5"/><path d="M20 15.5H7.5"/><path d="M10.5 12.5 7.5 15.5 10.5 18.5"/>',
  redeem: '<path d="M12 4v12.5"/><path d="M7 11.5 12 16.5 17 11.5"/><path d="M4.5 20h15"/>',
  // 理财减仓/清仓：资金「流出」——向上箭头穿出托盘（redeem 向下箭头+底线易被读成"存入"）。
  exit: '<path d="M12 20.5V8"/><path d="M7.5 12.5 12 8l4.5 4.5"/><path d="M4.5 4h15"/>',
  // 更新/刷新：环形箭头（原 snapshot 是"向下入托盘"，看不出"更新"语义）。
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  addSub: '<circle cx="12" cy="12" r="8.4"/><path d="M12 8.4v7.2M8.4 12h7.2"/>',
  toggle: '<path d="M9.5 6 15.5 12 9.5 18"/>',
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  snapshot: '<path d="M12 3.8v10.4"/><path d="M8 10.2 12 14.2 16 10.2"/><path d="M4.6 16.6v2.2a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-2.2"/>',
  pnl: '<path d="M4.5 19.5V10M9.8 19.5V5M15.1 19.5v-6.5M20.4 19.5V8"/>',
  undo: '<path d="M4.5 10.5A8 8 0 1 1 6.8 16.6"/><path d="M4.5 5.5v5h5"/>',
  receipt: '<path d="M6 2.5h12l-3 2 3 2v15l-3-2-3 2-3-2-3 2V6.5l3-2-3-2Z"/><path d="M9 7.5h6M9 11.5h6"/>',
  // v3 图标字典扩充：把原先散落在 UI 文案里的彩色 emoji（警告三角 / 火花 / 机器人 / 对勾 / 铅笔 / 上传下载）
  // 收回同一套线性 SVG，全部走 currentColor 跟随主题色，尺寸与 stroke 与上面 15 个既有图标保持一致（stroke 1.7）。
  warn: '<path d="M12 4.4 20.8 19.6H3.2L12 4.4Z"/><path d="M12 10.2v4.2M12 16.9v.1"/>',
  check: '<path d="M5 12.6 9.6 17.2 19 7.2"/>',
  inbox: '<path d="M3.4 13.4h4.2l1.6 3h5.6l1.6-3h4.2"/><path d="M6.2 5.6h11.6l2.8 7.8v4.6a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6v-4.6l2.8-7.8Z"/>',
  bot: '<rect x="4.6" y="8.2" width="14.8" height="10.8" rx="3.2"/><circle cx="9.6" cy="13.2" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.4" cy="13.2" r="1.2" fill="currentColor" stroke="none"/><path d="M12 8.2V5"/><circle cx="12" cy="3.8" r="1.2"/>',
  spark: '<path d="M13.4 3.6 6.4 13.6h4.4l-.6 6.8 7.4-10.2h-4.6l.4-6.6Z"/>',
  upload: '<path d="M12 14.4V3.8"/><path d="M8 7.8 12 3.8 16 7.8"/><path d="M4.6 16.6v2.2a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-2.2"/>',
  note: '<rect x="4.6" y="4" width="14.8" height="16" rx="2.2"/><path d="M8.6 9h6.8M8.6 12.8h6.8M8.6 16.6h4.2"/>',
  // 收支计划：日历（与 hero 收支卡 data-icon="calendar" 同款线性风格）
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.4"/><path d="M3.5 10h17M8 3.6v3M16 3.6v3"/>',
  // 理财净值：价格标签（净值 = 单位净值），用于「刷新净值」按钮
  nav: '<path d="M4 4h7l9 9-7 7-9-9V4Z"/><circle cx="8.4" cy="8.4" r="1.3"/>',
};
function actIcon(name) {
  return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ACT_ICONS[name] || '') + '</svg>';
}
// 行内操作按钮：attrs 放事件委托钩子（data-*），label 同时作 title 与 aria-label 兜底。
// opts.count 会在右上角挂计数徽标（如子账户数量），避免计数挤进按钮文字撑变列宽。
function actBtn(icon, attrs, label, opts) {
  opts = opts || {};
  return '<button type="button" class="row-act' + (opts.danger ? ' danger' : '') + (opts.cls ? ' ' + opts.cls : '') + '"'
    + (attrs ? ' ' + attrs : '')
    + ' title="' + esc(label) + '" aria-label="' + esc(label) + '">'
    + actIcon(icon)
    + (opts.count ? '<span class="act-cnt">' + esc(String(opts.count)) + '</span>' : '')
    + '</button>';
}
const money = (n) => '¥' + fmt(n == null ? 0 : n);
// clsPnl 已定义在文件上方，这里不再重复。pnlTxt 保留供局部使用。
const pnlTxt = (n) => (n >= 0 ? '+' : '') + money(n);
function curSymbolJS(cur) {
  cur = (cur || '').toLowerCase();
  if (cur === 'usd' || cur === '$') return '$';
  if (cur === 'hkd' || cur === 'hk$') return 'HK$';
  return '¥';
}
const moneyCur = (n, cur) => curSymbolJS(cur) + fmt(n == null ? 0 : n);
// 币种归一：只认 cny / hkd / usd，未知值与空串一律 cny（存量数据新增列前为空串）。
// 声明为 function 以便提升：已平仓弹框等文件后段的逻辑也能用。
function normCurJS(cur) {
  const c = String(cur || '').toLowerCase();
  return (c === 'usd' || c === 'hkd') ? c : 'cny';
}

async function showAssetView() {
  $('#holdingsView').hidden = true;
  $('#assetView').hidden = false;
  // 关闭可能打开的弹框（盈亏分析）与二级视图（工具/设置）
  $('#pnlModal').hidden = true;
  $('#settingsView').hidden = true;
  await loadAsset();
}

// 设置页面（2026-10-29 瘦身）：只剩外观主题 / 收支分类 / AI 配置 / 数据管理。
// 绑定设备 → #/devices，通知推送 → #/notify，两块高频内容由右上角个人菜单直达。
async function showSettingsView() {
  $('#holdingsView').hidden = true;
  $('#assetView').hidden = true;
  $('#settingsView').hidden = false;
  await loadAISettings(); // AI 页签的模型/模板/MCP 参数回填
  await loadFinCatSettings(); // 收支分类：自定义分类编辑
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 绑定设备（高频）：当前账本 / 设备列表 / 加设备 / 邀请家人 / 操作 PIN
async function showDevicesView() {
  $('#devicesView').hidden = false;
  await loadAuthDevices();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 通知推送（高频常切）：推送频率 / 待还款提醒 / 钉钉 / 邮箱渠道
async function showNotifyView() {
  $('#notifyView').hidden = false;
  await loadNotifySettings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
// 2026-10-18：设置页已改为语义分组常驻结构，旧 tab 转发逻辑移除。

// ---- AI 设置（设置页「AI」页签）→ MCP 参数 子面板 ----
function switchAiSubTab(tab) {
  const isModel = tab === 'model';
  $('#aiSubTabModel').classList.toggle('active', isModel);
  $('#aiSubTabMcp').classList.toggle('active', !isModel);
  $('#aiSubPanelModel').hidden = !isModel;
  $('#aiSubPanelMcp').hidden = isModel;
  if (!isModel) loadMcpConfig();
}
$('#aiSubTabModel').onclick = () => switchAiSubTab('model');
$('#aiSubTabMcp').onclick = () => switchAiSubTab('mcp');

async function loadMcpConfig() {
  try {
    const r = await api('/api/mcp/config');
    if (!r.ok) return;
    const d = await r.json();
    const c = d.config || {};
    $('#mcp_enabled').checked = !!c.enabled;
    $('#mcp_transport').value = c.transport || 'http';
    $('#mcp_http_addr').value = c.http_addr || '';
    $('#mcp_token').value = c.token || '';
    $('#mcp_server_name').value = c.server_name || '';
    $('#mcp_server_version').value = c.server_version || '';
    renderMcpClientJson();
    refreshMcpStatus();
  } catch (e) { /* 忽略，MCP 配置非关键 */ }
}

function buildMcpClientJson() {
  const transport = ($('#mcp_transport').value || 'http');
  const host = ($('#mcp_host').value || '').trim();
  const exe = ($('#mcp_exe_path').value || '').trim() || 'portfolio';
  if (transport === 'stdio') {
    return { mcpServers: { portfolio: { command: exe, args: ['mcp'] } } };
  }
  let addr = ($('#mcp_http_addr').value || '').trim() || ':9988';
  let url;
  if (addr.startsWith(':')) {
    url = 'http://' + (host || '127.0.0.1') + addr + '/mcp';
  } else {
    url = 'http://' + addr + '/mcp';
  }
  const token = ($('#mcp_token').value || '').trim();
  const node = { url: url };
  if (token) node.headers = { Authorization: 'Bearer ' + token };
  return { mcpServers: { portfolio: node } };
}

function renderMcpClientJson() {
  const el = $('#mcp_client_json');
  if (!el) return;
  try {
    el.textContent = JSON.stringify(buildMcpClientJson(), null, 2);
  } catch (e) {
    el.textContent = '';
  }
}

function buildMcpServerJson() {
  return {
    enabled: $('#mcp_enabled').checked,
    transport: $('#mcp_transport').value || 'http',
    http_addr: ($('#mcp_http_addr').value || '').trim(),
    token: $('#mcp_token').value || '',
    server_name: ($('#mcp_server_name').value || '').trim() || 'portfolio-mcp',
    server_version: ($('#mcp_server_version').value || '').trim() || '1.0.0',
  };
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg || '已复制到剪贴板', 'ok');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(okMsg || '已复制到剪贴板', 'ok'); }
    catch (_) { toast('复制失败，请手动复制', 'err'); }
    document.body.removeChild(ta);
  }
}

$('#mcp_transport').onchange = renderMcpClientJson;
$('#mcp_host').oninput = renderMcpClientJson;
$('#mcp_exe_path').oninput = renderMcpClientJson;
$('#mcp_http_addr').oninput = renderMcpClientJson;
$('#mcp_copy_client').onclick = () => copyText(JSON.stringify(buildMcpClientJson(), null, 2), '客户端配置已复制');
// 鉴权令牌：一键生成随机令牌
$('#mcp_gen_token').onclick = () => {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  const t = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  $('#mcp_token').value = t;
  renderMcpClientJson();
};
// 鉴权令牌：小眼睛显示/隐藏
$('#mcp_token_toggle').onclick = () => {
  const inp = $('#mcp_token');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('#mcp_token_toggle').classList.toggle('show', show);
};
// 重启 MCP 服务（HTTP 模式：平滑重启受管 HTTP 传输，无需重启整个 Web 服务）
$('#mcp_restart').onclick = async () => {
  $('#mcpErr').textContent = '';
  try {
    const r = await api('/api/mcp/restart', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { $('#mcpErr').textContent = d.error || '重启失败'; return; }
    toast('MCP 服务已重启', 'ok');
    refreshMcpStatus();
  } catch (e) { $('#mcpErr').textContent = '重启异常：' + e.message; }
};
// 查询 MCP 服务运行状态并更新状态圆点
async function refreshMcpStatus() {
  const dot = $('#mcpStatusDot'), txt = $('#mcpStatusText');
  if (!dot) return;
  try {
    const r = await api('/api/mcp/status');
    if (!r.ok) return;
    const d = await r.json();
    dot.classList.remove('ok', 'bad', 'off');
    if (!d.enabled) { dot.classList.add('off'); txt.textContent = 'MCP 未启用'; }
    else if (d.running) { dot.classList.add('ok'); txt.textContent = 'MCP 服务运行中'; }
    else { dot.classList.add('bad'); txt.textContent = 'MCP 服务未运行' + (d.error ? '：' + d.error : ''); }
  } catch (e) {
    dot.classList.remove('ok', 'bad', 'off');
    dot.classList.add('bad');
    txt.textContent = '状态获取失败';
  }
}
$('#mcp_save').onclick = async () => {
  const cfg = buildMcpServerJson();
  $('#mcpErr').textContent = '';
  try {
    const r = await api('/api/mcp/config', { method: 'PUT', body: JSON.stringify(cfg) });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      $('#mcpErr').textContent = d.error || '保存失败';
      return;
    }
    toast('MCP 设置已保存（HTTP 模式请点击「重启 MCP 服务」生效）', 'ok');
  } catch (e) {
    $('#mcpErr').textContent = '保存异常：' + e.message;
  }
};

$('#addCalc').onclick = calcAdd;
$('#addClear').onclick = () => {
  ['addOldPrice','addOldQty','addNewQty','addAmount','addFee','addNewPrice'].forEach(id => { $('#'+id).value = ''; });
  $('#addMode').value = 'qty';
  $('#addSide').value = 'buy';
  renderAdjModePills();
  renderAdjSidePills();
  syncAdjModeUI();
  syncAdjSideUI();
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
  $('#confirmMsg').textContent = '将把这笔操作作为一笔「' + sideLabel + '」交易计入「' + name + '」：' + sideLabel + ' ' + fmtCat(lastAdd.q1, calcCat) + ' 份 × ¥' + fmtCat(lastAdd.p1, calcCat)
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
  hideTrendTip();   // 关闭弹框（含自动注入的 ✕）时收起可能残留的悬停浮框
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
const SRC_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-va-icon"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
// 资产全景来源类型图标：银行=地标建筑、证券=K线蜡烛、软件=显示器；平台复用 SRC_ICON 分层图标
const BANK_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-va-icon"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>';
const SEC_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-va-icon"><path d="M9 5v4"/><path d="M9 19v-2"/><path d="M9 9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/><path d="M15 3v2"/><path d="M15 21v-4"/><path d="M15 11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/><path d="M21 7v3"/><path d="M21 17v2"/><path d="M21 11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/></svg>';
const SOFTWARE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-va-icon"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
const SRC_TYPE_ICON = { bank: BANK_ICON, securities: SEC_ICON, software: SOFTWARE_ICON, platform: SRC_ICON };
function srcTypeIcon(t) { return SRC_TYPE_ICON[t] || SRC_ICON; }
// 来源/账户图标（通用）：按 id 查来源名称+类型，复用 accountLogo 的「品牌色 monogram」逻辑；
// 命中内置银行券商 → 品牌色首字卡；否则回退类型图标。首页持仓 / 理财分组头与资产页账户卡共用，保证图标一致。
function srcLogo(sid) {
  const s = assetSources.find((x) => x.id === sid);
  if (!s) return `<span class="src-ico">${SRC_ICON}</span>`;
  return accountLogo(s.name, s.type);
}
// 账户 logo：按名称内置常见银行/券商的「品牌色 + 单字/缩写」monogram，替换统一类型图标。
// 命中 → 品牌色小卡；未命中 → 回退类型图标(srcTypeIcon)。
// 用文字缩写而非官方 SVG：规避商标风险与包体膨胀；如需真实 logo 可在此扩展为内联 SVG。
const BANK_LOGOS = [
  // 中资银行
  { k: ['招商', 'cmb', '招行'], t: '招', c: '#e60012' },
  { k: ['工商', 'icbc'], t: '工', c: '#c8102e' },
  { k: ['建设', 'ccb'], t: '建', c: '#004ea2' },
  { k: ['中国银行', '中银', 'boc'], t: '中', c: '#c8102e' },
  { k: ['农业', 'abc'], t: '农', c: '#009944' },
  { k: ['交通', 'bocom'], t: '交', c: '#006c84' },
  { k: ['平安', 'pingan'], t: '平', c: '#e60012' },
  { k: ['浦发'], t: '浦', c: '#0066b3' },
  { k: ['兴业'], t: '兴', c: '#007a3d' },
  { k: ['民生'], t: '民', c: '#0072bc' },
  { k: ['中信'], t: '信', c: '#c8102e' },
  { k: ['广发'], t: '广', c: '#c8102e' },
  { k: ['南京', 'nanjing'], t: '南', c: '#0a3d8f' },
  // 港/海外银行
  { k: ['汇丰', 'hsbc'], t: '汇', c: '#db0011' },
  { k: ['恒生', 'hangseng', 'hang seng'], t: '恒', c: '#00a650' },
  { k: ['众安', 'za', 'za bank'], t: 'ZA', c: '#ff6a00' },
  { k: ['天星', 'livi'], t: '星', c: '#16b8a8' },
  { k: ['东亚', 'bea'], t: '东', c: '#00467f' },
  { k: ['渣打', 'standard chartered', 'sc bank'], t: '渣', c: '#1a4f9c' },
  // 券商/平台
  { k: ['富途', 'futu'], t: '富', c: '#ee2a24' },
  { k: ['老虎', 'tiger'], t: '虎', c: '#fc6521' },
  { k: ['盈立', 'usmart'], t: '盈', c: '#2b6cff' },
  { k: ['雪盈', '雪球', 'snowball'], t: '雪', c: '#e6162d' },
  { k: ['华泰', 'htsc'], t: '华', c: '#0033a0' },
  { k: ['东方财富', 'eastmoney'], t: '东', c: '#e62129' },
  { k: ['同花顺'], t: '同', c: '#1aa260' },
  { k: ['长桥', 'longbridge'], t: '长', c: '#1f6feb' },
  { k: ['微牛', 'webull'], t: '牛', c: '#00b85c' },
  { k: ['银河', 'galaxy'], t: '银', c: '#c8102e' },
  { k: ['国君', 'guotai'], t: '君', c: '#0a4ea2' },
  { k: ['海通'], t: '海', c: '#0a4ea2' },
  { k: ['蚂蚁', '支付宝', 'alipay'], t: '支', c: '#1677ff' },
  { k: ['微信', 'wechat'], t: '微', c: '#07c160' },
  { k: ['paypal'], t: 'PP', c: '#003087' },
  { k: ['币安', 'binance'], t: 'BN', c: '#a87b08' },
  { k: ['盈透', 'interactive', 'ibkr'], t: 'IB', c: '#3b6fd4' },
  { k: ['嘉信', 'schwab'], t: '嘉', c: '#199ad6' },
  { k: ['robinhood', '罗宾汉'], t: 'RH', c: '#00a63a' },
  { k: ['firstrade', '第一证券'], t: '第', c: '#c8102e' },
  { k: ['moomoo'], t: 'M', c: '#ee2a24' },
];
function accountLogo(name, type) {
  const n = String(name || '').toLowerCase();
  for (const b of BANK_LOGOS) {
    if (b.k.some((x) => n.includes(x))) {
      return `<span class="src-ico src-logo" style="--logo-c:${b.c}" title="${esc(name)}">${b.t}</span>`;
    }
  }
  // 未命中内置列表 → 取账户名首字作 monogram（中性色），保证所有账户都有图标卡片，不再回退抽象类型图标
  const ch = String(name || '').trim().charAt(0);
  if (ch) return `<span class="src-ico src-logo" style="--logo-c:var(--cat-other-c)" title="${esc(name)}">${ch}</span>`;
  return `<span class="src-ico">${srcTypeIcon(type)}</span>`;
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
  const P1 = roundByCat(parseFloat($('#addNewPrice').value), calcCat);   // 净值/现价按类别精度（基金 4 位）
  const el = $('#addResult');
  const mode = $('#addMode').value;
  const side = $('#addSide').value || 'buy';
  const verb = side === 'sell' ? '减仓' : '补仓';
  const dirLabel = side === 'sell' ? '卖出' : '买入';
  // 重置「计入持仓」按钮状态，待计算成功后再启用
  lastAdd = null;
  const applyBtn = $('#addApply');
  if (applyBtn) applyBtn.disabled = true;
  const fee = Number.isFinite(f) ? f : 0;
  if (![P0, Q0, P1].every(Number.isFinite)) {
    return;
  }
  if (Q0 <= 0) {
    el.innerHTML = '<span class="tool-empty">原持仓数量需大于 0</span>';
    return;
  }
  // 第一步：按买卖方向 + 计算方式，算出本次交易数量 Q1 与描述（买卖双方通用）
  // 份额按类别精度归整（基金、股票 4 位小数，其余 2 位）：基金份额是 4 位口径，
  // 按金额补仓时 份额 = 金额 ÷ 净值 必须归整，否则会带出 float64 全精度尾巴
  // （459.1368337924701）污染持仓数量与摊薄成本。
  let Q1, addDesc;
  if (mode === 'amount') {
    const X = parseFloat($('#addAmount').value);
    if (!Number.isFinite(X) || X <= 0) {
      el.innerHTML = `<span class="tool-empty">请填写有效的${verb}金额（大于 0）</span>`;
      return;
    }
    if (X <= fee) {
      el.innerHTML = `<span class="tool-empty">${verb}金额需大于${dirLabel}手续费</span>`;
      return;
    }
    Q1 = roundByCat((X - fee) / P1, calcCat);   // 买入费从金额中扣除 → 实际份额；卖出=净回款换得份额
    addDesc = `按金额${verb} ¥${fmt(X)} → ${dirLabel} ${fmtCat(Q1, calcCat)} 份（已扣${dirLabel}费 ¥${fmt(fee)}）`;
  } else {
    Q1 = roundByCat(parseFloat($('#addNewQty').value), calcCat);
    if (!Number.isFinite(Q1) || Q1 <= 0) {
      el.innerHTML = `<span class="tool-empty">请填写有效的${verb}数量（大于 0）</span>`;
      return;
    }
    addDesc = `按数量${verb} ${fmtCat(Q1, calcCat)} 份 × ¥${fmtCat(P1, calcCat)} + ${dirLabel}费 ¥${fmt(fee)}`;
  }
  // 卖出（减仓）：按剩余持仓 + 实现盈亏口径，不再并入成本
  if (side === 'sell') {
    if (Q1 > Q0) {
      el.innerHTML = `<span class="tool-empty">卖出数量（${fmtCat(Q1, calcCat)}）不能超过当前持仓（${fmtCat(Q0, calcCat)}）</span>`;
      return;
    }
    const remainingQty = Q0 - Q1;                       // 减仓后剩余份额
    const realized = (P1 - P0) * Q1 - fee;              // 实现盈亏 = (卖价−成本)×数量 − 卖出费
    const rPct = P0 > 0 ? (P1 - P0) / P0 * 100 : 0;     // 单笔收益率
    const sign = clsPnl(realized);
    const proceeds = Q1 * P1 - fee;                     // 实际回款（入账现金账户）
    let html = '';
    html += `<div class="res-main ${sign}">本次实现盈亏：¥${fmt(Math.abs(realized))} ${realized >= 0 ? '盈利' : '亏损'}（收益率 ${pct(rPct)}）</div>`;
    html += `<div class="res-row">剩余数量 <b>${fmtCat(remainingQty, calcCat)}</b>　｜　回款 <b>¥${fmt(proceeds)}</b></div>`;
    el.innerHTML = html;
    lastAdd = { q1: Q1, p1: P1, fee: fee, mode: mode, side: side };
    if (applyBtn) applyBtn.disabled = false;
    return;
  }
  // 买入（加仓）：合并口径（数量相加、买入费进成本），与原逻辑一致
  let costAdd;
  if (mode === 'amount') {
    costAdd = parseFloat($('#addAmount').value);        // 合并成本按实际投入金额计
  } else {
    costAdd = Q1 * P1 + fee;                            // 买入费计入合并成本
  }
  const Q = Q0 + Q1;                           // 合并持仓数量
  const costBasis = Q0 * P0 + costAdd;          // 合并总成本（costAdd 已含买入费或按投入金额计）
  const avgCost = costBasis / Q;                // 合并持仓成本（每份）
  const marketValue = Q * P1;                   // 以补仓现价为盈亏基准
  const pnl = marketValue - costBasis - fee;    // 再扣卖出费 → 净盈亏
  const pctVal = costBasis > 0 ? pnl / costBasis * 100 : 0;
  const sign = clsPnl(pnl);
  let html = '';
  html += `<div class="res-main ${sign}">补仓后盈亏（净）：¥${fmt(Math.abs(pnl))} ${pnl >= 0 ? '盈利' : '亏损'}（${pct(pctVal)}）</div>`;
  html += `<div class="res-row">合并数量 <b>${fmtCat(Q, calcCat)}</b>　｜　合并成本 <b>${fmtCat(avgCost, calcCat)}</b>/份</div>`;
  el.innerHTML = html;
  // 记录本次有效方案，供「计入持仓」使用
  lastAdd = { q1: Q1, p1: P1, fee: fee, mode: mode, side: side };
  if (applyBtn) applyBtn.disabled = false;
}

async function loadAsset() {
  try {
    const r = await api('/api/asset/overview');
    if (!r.ok) { toast('资产总览加载失败 (HTTP ' + r.status + ')', 'err'); return; }
    assetData = await r.json();
    await loadSourcesCache();
    renderAssetTab();
  } catch (e) {
    toast('资产加载异常：' + e.message, 'err');
    return;
  }
  // 首页同步（2026-10-09 理财迁首页）：理财增删改/录入/资金变动后都会走 loadAsset，
  // 首页「全部 / 理财」两种口径下总市值卡含理财段、理财视图还承载管理区 → 重渲染首页。
  const hv = document.getElementById('holdingsView');
  if (hv && !hv.hidden && catFilter.has && (catFilter.has('wealth') || catFilter.size === 0)) renderFiltered();
}

async function loadSourcesCache() {
  try {
    const r = await api('/api/asset/sources');
    if (r.ok) { const d = await r.json(); assetSources = d.sources || []; }
  } catch (_) {}
}

// 账户归属地域：cn/hk/us（2026-10-16 由境内/境外二值改版）。色与币种对齐（CN=金/HK=靛蓝/US=蓝绿）。
const AS_REG_COLOR = { cn: 'var(--primary)', hk: 'rgb(var(--cat-hk))', us: 'rgb(var(--cat-us))' };
// 地域中英文对照：指标条与表格分组标题共用（英文按规范写作 Mainland China / Hong Kong, China）
const REGION_META = {
  cn: { zh: '中国大陆', en: 'Mainland China', code: 'CN' },
  hk: { zh: '中国香港', en: 'Hong Kong, China', code: 'HK' },
  us: { zh: '美国', en: 'United States', code: 'US' },
};
// 占比文案：分母 ≤0 时不给无意义的百分比
const pctOf = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) + '%' : '—');
// 金额带符号：负数写成 -¥1,234.56（¥ 在负号之后，避免 ¥-1,234 的错位读法）
const yuanOf = (v) => (Number(v) < 0 ? '-¥' : '¥') + fmt(Math.abs(Number(v) || 0));
// 地域归一：兼容存量 domestic/overseas 与大小写混写，输出 cn/hk/us（与后端 NormRegion 一致）
const normRegionJS = (r) => {
  switch (String(r || '').toLowerCase()) {
    case 'hk': case 'overseas': return 'hk';
    case 'us': return 'us';
    default: return 'cn'; // cn / domestic / 空
  }
};
// 账户标识脱敏：保留首 4 + 尾 4、中间掩码（如 6225 •••• 1234）；不足 8 位只显尾 4（•••• 8842）
function maskIdent(no) {
  no = String(no || '').trim();
  if (!no) return '';
  if (no.length <= 8) return '•••• ' + no.slice(-4);
  return no.slice(0, 4) + ' •••• ' + no.slice(-4);
}

// 资产页：合并资产概览 + 资产摘要为一张卡。
// 顶部 KPI（总资产 | 负债 | 净资产）+ 中部横向 4 组对比（类别 donut / 区域 / 币种 / 净值结构）。
// 其下子 tab [账户|流水|负债]（复用滑动块）。
function renderAssetTab() {
  const body = $('#assetTabBody');
  if (!body) return;
  const acctCount = (assetSources || []).length;
  // 「现金」tab 计数 = 有余额的现金账户数（账户常年有一批 0 余额占位，计数只数真有钱的）
  const cashLiveCount = (assetData?.cash?.items || []).filter((it) => Number(it.amount || 0) !== 0).length;

  // 从 assetData 取数（全部折算 CNY 比较）
  const eqMV = Number(assetData?.equity?.market_value || 0);
  const wTotal = Number(assetData?.wealth?.total || 0);
  const cTotal = Number(assetData?.cash?.total || 0);
  const lTotal = Number(assetData?.liability?.total || 0);
  const totalA = eqMV + wTotal + cTotal;
  const net = totalA - lTotal;
  const regA = assetData?.region_assets || {};
  const regL = assetData?.region_liabilities || {};
  const curA = assetData?.currency_assets || {};

  // === 类别 donut（持仓 / 理财 / 现金）===
  const catSegs = [
    { name: '持仓', value: eqMV, color: 'rgb(var(--cat-equity))' },
    { name: '理财', value: wTotal, color: 'rgb(var(--cat-fund))' },
    { name: '现金', value: cTotal, color: 'rgb(var(--cat-cash))' },
  ].filter((s) => s.value > 0.01);
  const catTotal = catSegs.reduce((a, s) => a + s.value, 0);
  const donutHtml = catTotal > 0 ? donutSvg(catSegs, catTotal, '总资产', yuanOfW(catTotal), 42, 9) : '';
  const donutLegend = catSegs.map((s) => {
    const pct = catTotal > 0 ? (s.value / catTotal * 100).toFixed(1) : '0';
    return `<div class="asset-ov-legend-row"><span class="legend-dot" style="--bg:${s.color}"></span><span>${s.name}</span><span class="legend-val">${pct}% · ${yuanOfW(s.value)}</span></div>`;
  }).join('');

  // === 区域对比（CN / HK / US）===
  // 地域标签与 REGION_META 同口径：港澳台一律带国家名（中国香港），不与「中国」并列成两个地区。
  const regionNames = { cn: '中国', hk: '中国香港', us: '美股' };
  const regionKeys = ['cn', 'hk', 'us'].filter((k) => (regA[k] || 0) > 0 || (regL[k] || 0) > 0)
    .concat(Object.keys(regA).filter((k) => !['cn', 'hk', 'us'].includes(k) && (regA[k] || 0) > 0));
  const regionMax = Math.max(1, ...regionKeys.map((k) => Math.max(regA[k] || 0, regL[k] || 0)));
  const regionBars = regionKeys.map((k) => {
    const a = regA[k] || 0, l = regL[k] || 0;
    const aw = (a / regionMax * 100).toFixed(1);
    const lw = (l / regionMax * 100).toFixed(1);
    const pctA = totalA > 0 ? (a / totalA * 100).toFixed(1) : '0';
    return `<div class="cmp-row">
      <div class="cmp-name">${regionNames[k] || k}</div>
      <div class="cmp-bars">
        <div class="cmp-bar cmp-bar-asset" style="--w:${aw}%" title="资产 ${yuanOfW(a)} · ${pctA}%"></div>
        <div class="cmp-bar cmp-bar-liab" style="--w:${lw}%" title="负债 ${yuanOfW(l)}"></div>
      </div>
      <div class="cmp-val">${yuanOfW(a)}</div>
    </div>`;
  }).join('') || '<div class="asset-empty">无区域数据</div>';

  // === 币种对比（CNY / HKD / USD）===
  const curNames = { cny: '人民币', hkd: '港币', usd: '美元' };
  const curKeys = ['cny', 'hkd', 'usd'].filter((k) => (curA[k] || 0) > 0)
    .concat(Object.keys(curA).filter((k) => !['cny', 'hkd', 'usd'].includes(k) && (curA[k] || 0) > 0));
  const curMax = Math.max(1, ...curKeys.map((k) => curA[k] || 0));
  // 注意：--cat-* 是 rgb 三元组（如 255,159,10），颜色条必须用 rgb(var(--cat-*)) 包裹，
  // 直接把 var(--cat-*) 塞进 --bc 会让 background 变成非法值（"255,159,10"）导致颜色条全空。
  const curColors = { cny: 'rgb(var(--cat-equity))', hkd: 'rgb(var(--cat-fund))', usd: 'rgb(var(--cat-cash))' };
  const curBars = curKeys.map((k) => {
    const v = curA[k] || 0;
    const pct = totalA > 0 ? (v / totalA * 100).toFixed(1) : '0';
    const w = (v / curMax * 100).toFixed(1);
    const col = curColors[k] || '';
    return `<div class="cmp-row">
      <div class="cmp-name">${curNames[k] || k}</div>
      <div class="cmp-bars"><div class="cmp-bar cmp-bar-cur" style="--w:${w}%${col ? `;--bc:${col}` : ''}"></div></div>
      <div class="cmp-val">${yuanOfW(v)} · ${pct}%</div>
    </div>`;
  }).join('') || '<div class="asset-empty">无币种数据</div>';

  // === 资产 vs 负债 vs 净资产（迷你横向对比）===
  const triMax = Math.max(totalA, lTotal, Math.abs(net), 1);
  const triHtml = `
    <div class="cmp-row"><div class="cmp-name cmp-name-asset">资产</div><div class="cmp-bars"><div class="cmp-bar cmp-bar-asset" style="--w:${(totalA / triMax * 100).toFixed(1)}%"></div></div><div class="cmp-val">${yuanOfW(totalA)}</div></div>
    <div class="cmp-row"><div class="cmp-name cmp-name-liab">负债</div><div class="cmp-bars"><div class="cmp-bar cmp-bar-liab" style="--w:${(lTotal / triMax * 100).toFixed(1)}%"></div></div><div class="cmp-val">${yuanOfW(lTotal)}</div></div>
    <div class="cmp-row"><div class="cmp-name cmp-name-net">净资产</div><div class="cmp-bars"><div class="cmp-bar cmp-bar-net ${net < 0 ? 'neg' : ''}" style="--w:${(Math.abs(net) / triMax * 100).toFixed(1)}%"></div></div><div class="cmp-val ${clsPnl(net)}">${yuanOfW(net)}</div></div>`;

  // === 4 张独立小卡（原型场景 D 的扁平版）：构成 / 区域 / 币种 / 净值结构 ===
  // 主数字各自取该维度最关心的一项：总资产 / 海外占比 / 外币占比 / 净资产。
  // 占比一律走 pctOf（不带正负号）——pct() 是给涨跌用的，会给正数加 "+"。
  const hkA = Number(regA.hk || 0), usA = Number(regA.us || 0), cnA = Number(regA.cn || 0);
  const cnyA = Number(curA.cny || 0);

  // 资产构成卡主数字 = 持仓市值（股票+基金，折 CNY）；圆环中心显示总资产。
  body.innerHTML = `
    <div class="kpi-head">
      <span class="kpi-head-label">资产概览</span>
      <span class="kpi-head-hint">全部折算 CNY</span>
    </div>
    <div class="kpi-row cols-flat asset-kpi-row">
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-fund"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 3v9h9"/></svg></div>
        <div class="kpi-label">资产构成</div>
        <div class="kpi-main"><div class="kpi-value">${yuanOfW(eqMV)}</div></div>
        <div class="kpi-sub">持仓市值 · 股票与基金，折算 CNY</div>
        <div class="kpi-extra asset-cmp-body asset-cmp-donut">${donutHtml}<div class="asset-ov-legend">${donutLegend}</div></div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-cash"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg></div>
        <div class="kpi-label">资产区域</div>
        <div class="kpi-main"><div class="kpi-value">${pctOf(hkA + usA, totalA)}</div></div>
        <div class="kpi-sub">海外占比 · 中国 <span class="hl">${pctOf(cnA, totalA)}</span></div>
        <div class="kpi-extra asset-cmp-body">${regionBars}</div>
        <div class="asset-cmp-legend-2"><span><i class="lg-sq lg-asset"></i>资产</span><span><i class="lg-sq lg-liab"></i>负债</span></div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-pct"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9h6M9 13h6M12 9.5V17"/></svg></div>
        <div class="kpi-label">资产币种</div>
        <div class="kpi-main"><div class="kpi-value">${pctOf(totalA - cnyA, totalA)}</div></div>
        <div class="kpi-sub">外币占比 · 人民币 <span class="hl">${pctOf(cnyA, totalA)}</span></div>
        <div class="kpi-extra asset-cmp-body">${curBars}</div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-equity"><svg viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M7 21V11M12 21V4M17 21v-7"/></svg></div>
        <div class="kpi-label">净值结构</div>
        <div class="kpi-main"><div class="kpi-value ${net < 0 ? 'down' : ''}">${yuanOfW(net)}</div></div>
        <div class="kpi-sub">负债 <span class="hl">${yuanOfW(lTotal)}</span> · 负债率 <span class="hl">${pctOf(lTotal, totalA)}</span></div>
        <div class="kpi-extra asset-cmp-body">${triHtml}</div>
      </div>
    </div>
    <div class="sub-tabs asset-subtabs" id="assetSubTabs">
      <button class="sub-tab active" data-sub="accounts" type="button">账户<span class="sub-tab-count" id="assetAcctCount">${acctCount}</span></button>
      <button class="sub-tab" data-sub="cash" type="button">现金<span class="sub-tab-count">${cashLiveCount}</span></button>
      <button class="sub-tab" data-sub="flows" type="button">流水</button>
      <button class="sub-tab" data-sub="cashflow" type="button">收支</button>
    </div>
    <div class="asset-subpanel active" data-sub="accounts" id="assetPanelAccounts"></div>
    <div class="asset-subpanel" data-sub="cash" id="assetPanelCash"></div>
    <div class="asset-subpanel" data-sub="flows" id="assetPanelFlows"></div>
    <div class="asset-subpanel" data-sub="cashflow" id="assetPanelCashflow"></div>`;

  // 账户面板、现金 / 流水 / 收支面板
  renderSources($('#assetPanelAccounts'));
  renderAssetCashPanel($('#assetPanelCash'));
  renderAssetFlowsPanel($('#assetPanelFlows'));
  renderAssetCashflowPanel($('#assetPanelCashflow'));

  // 子 tab 切换绑定
  bindAssetSubTabs();
}

// 环形图 SVG：复用资产分类色（rgb(var(--cat-*))），经 --sc 自定义属性注入（SVG 属性不解析 var()）。
function donutSvg(segs, total, centerLabel, centerVal, r, sw) {
  r = r || 38; sw = sw || 12;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const rings = segs.map((s) => {
    const len = s.value / total * C;
    const dash = len.toFixed(2) + ' ' + (C - len).toFixed(2);
    const off = (-offset).toFixed(2);
    offset += len;
    return '<circle class="asset-donut-seg" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="' + sw + '" stroke-dasharray="' + dash + '" stroke-dashoffset="' + off + '" transform="rotate(-90 50 50)" style="--sc:' + s.color + '"/>';
  }).join('');
  return '<svg viewBox="0 0 100 100" class="asset-donut">' +
    '<circle class="asset-donut-track" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="' + sw + '"/>' + rings +
    '<text class="donut-cap" x="50" y="46" text-anchor="middle">' + centerLabel + '</text>' +
    '<text class="donut-total" x="50" y="58" text-anchor="middle">' + centerVal + '</text>' +
    '</svg>';
}

// 资产页「流水」子面板：复用 /api/asset/flows（近 180 天），表格沿用现金流样式；
// 行内「回退」复用后端 rollback，回退后原地刷新本面板（不与理财历史弹框耦合）。
// 资产页「流水」子面板：首次加载全量（近 180 天）入 assetFlowsCache，之后用 paintFlows 按工具条筛选/区间重渲染。
// 资产页「现金」子面板（2026-10-29）：回答「现金都散落在哪儿」。
// 只读展示 —— 增删改仍在「账户」tab，这里不重复做管理入口。
// 排序与占比统一按折 CNY（港币/美元账户不能拿原币直接跟人民币比大小），
// 条形按「相对最大账户」归一（同资产区域卡的 cmp-bar），满格=最集中的那一处。
let cashShowZero = false;   // 零余额账户默认收起（17 个账户里常年有 6 个是 0）
// 三个子 tab 共用的合计条：{ k 标签, v 数值, s 说明, tone 语义色类(up/down) }。
// tone 交给全局 .up/.down（涨红跌绿），别在这里写颜色字面量。
function assetSumHTML(items) {
  return '<div class="asset-sum">' + items.filter(Boolean).map((it) =>
    '<div class="asset-sum-item"><span class="asset-sum-k">' + it.k + '</span>' +
    '<span class="asset-sum-v' + (it.tone ? ' ' + it.tone : '') + '">' + it.v + '</span>' +
    (it.s ? '<span class="asset-sum-s">' + it.s + '</span>' : '') + '</div>').join('') + '</div>';
}
// 带符号金额：正数 +¥x，负数 −¥x（流水行同一套符号，和 yuanOfW 的 '-¥' 区分开）
const signedYuanW = (n) => (n >= 0 ? '+' : '−') + yuanOfW(Math.abs(Number(n) || 0));
function renderAssetCashPanel(body) {
  if (!body) return;
  const items = (assetData?.cash?.items || []).map((it) => {
    const cur = String(it.currency || 'cny').toLowerCase();
    return { ...it, cur, cny: cnyOf(Number(it.amount || 0), cur) };
  });
  if (!items.length) {
    body.innerHTML = '<p class="u-muted">还没有现金账户。到「账户」tab 给银行 / 券商添加子账户后，这里会按机构列出余额分布。</p>';
    return;
  }
  const total = Number(assetData?.cash?.total || 0) || items.reduce((a, x) => a + x.cny, 0);
  const live = items.filter((x) => Math.abs(x.cny) > 0.005).sort((a, b) => Math.abs(b.cny) - Math.abs(a.cny));
  const zero = items.filter((x) => Math.abs(x.cny) <= 0.005);
  const maxCny = Math.max(1, ...live.map((x) => Math.abs(x.cny)));
  const srcCount = new Set(live.map((x) => x.source_id)).size;
  const fxCny = items.filter((x) => x.cur !== 'cny' && x.cur !== 'rmb').reduce((a, x) => a + x.cny, 0);
  const top = live[0];
  const topPct = top && total > 0 ? Math.abs(top.cny) / total * 100 : 0;

  let html = assetSumHTML([
    { k: '现金合计', v: yuanOfW(total), s: '折 CNY' },
    { k: '分布', v: srcCount + ' 家机构', s: live.length + ' / ' + items.length + ' 个账户有余额' },
    top ? { k: '最集中的一处', v: topPct.toFixed(1) + '%', s: esc(top.source_name || '') } : null,
    { k: '外币占比', v: (total > 0 ? fxCny / total * 100 : 0).toFixed(1) + '%', s: 'HKD / USD 折 CNY' },
  ]);

  // 「RMB账户」「…子账户」「余额」这类名字只是占位，后面再挂一遍反而把机构名挤走
  const genericName = (n) => !n || n === '余额' || /账户$/.test(n);
  const rowOf = (x) => {
    const isFx = x.cur !== 'cny' && x.cur !== 'rmb';
    const pct = total > 0 ? Math.abs(x.cny) / total * 100 : 0;
    const w = Math.min(100, Math.abs(x.cny) / maxCny * 100).toFixed(1);
    const sub = (!genericName(x.name) && x.name !== x.source_name) ? '<span class="cash-sub">· ' + esc(x.name) + '</span>' : '';
    return '<tr' + (Math.abs(x.cny) <= 0.005 ? ' class="is-zero"' : '') + '>' +
      '<td><div class="cash-acct"><span class="cash-src">' + esc(x.source_name || '未分类') + '</span>' + sub + '</div></td>' +
      '<td><span class="cash-cur">' + x.cur.toUpperCase() + '</span></td>' +
      '<td class="num">' + moneyCur(x.amount || 0, x.cur) + '</td>' +
      '<td class="num">' + (isFx ? money(x.cny) : '<span class="u-muted">—</span>') + '</td>' +
      '<td class="num"><div class="cash-share"><span class="cash-share-bar"><i style="--w:' + w + '%"></i></span>' +
        '<span class="cash-pct">' + pct.toFixed(1) + '%</span></div></td>' +
      '</tr>';
  };
  const rows = live.concat(cashShowZero ? zero : []).map(rowOf).join('');

  html += '<div class="card asset-flow-card cash-card"><table class="asset-table cash-tbl">' +
    '<thead><tr><th>账户</th><th>币种</th><th class="num">余额</th><th class="num">折 CNY</th><th class="num">占现金</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';

  if (zero.length) {
    html += '<div class="cash-zero"><button class="cash-zero-toggle" type="button" id="cashZeroBtn">' +
      (cashShowZero ? '收起' : '另有') + ' ' + zero.length + ' 个零余额账户' + (cashShowZero ? '' : '，点此展开') +
      '</button></div>';
  }
  body.innerHTML = html;
  const zb = body.querySelector('#cashZeroBtn');
  if (zb) zb.onclick = () => { cashShowZero = !cashShowZero; renderAssetCashPanel(body); };
}

async function renderAssetFlowsPanel(body) {
  if (!body) return;
  if (!assetFlowsCache.length) {
    body.innerHTML = '<p class="u-muted">加载中…</p>';
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 180 * 864e5);
      const fmtD = (d) => d.toISOString().slice(0, 10);
      const r = await api('/api/asset/flows?start=' + fmtD(start) + '&end=' + fmtD(end));
      if (!r.ok) { body.innerHTML = '<p class="u-muted">流水加载失败</p>'; return; }
      const d = await r.json();
      assetFlowsCache = (d.flows || []).slice().sort((a, b) => a.date < b.date ? 1 : -1);
    } catch (_) { body.innerHTML = '<p class="u-muted">流水加载失败</p>'; return; }
  }
  paintFlows(body);
}

// 资产页流水：复用原型 holding-toolbar（类型 chips + 区间下拉）实时过滤，避免重复请求。
function paintFlows(body) {
  if (!body) return;
  let list = assetFlowsCache;
  if (flowRangeDays > 0) {
    const cutoff = new Date(Date.now() - flowRangeDays * 864e5).toISOString().slice(0, 10);
    list = list.filter((f) => (f.date || '') >= cutoff);
  }
  if (flowTypeFilter !== 'all') list = list.filter((f) => flowMatch(f, flowTypeFilter));

  // 合计跟随当前筛选（类型 chips + 区间），与表格里的行严格同源：
  // 多币种统一折 CNY（cnyOf），否则美元流水会被当人民币直接相加。
  let inSum = 0, outSum = 0, inCnt = 0, outCnt = 0;
  list.forEach((f) => {
    const v = cnyOf(Number(f.amount) || 0, normCurJS(f.currency));
    if (v >= 0) { inSum += v; inCnt += 1; } else { outSum += -v; outCnt += 1; }
  });
  const net = inSum - outSum;
  const rangeLabel = flowRangeDays === 7 ? '近 7 天' : flowRangeDays === 365 ? '近 1 年' : '近 30 天';

  let html = assetSumHTML([
    { k: '笔数', v: list.length + ' 笔', s: rangeLabel },
    { k: '入账合计', v: yuanOfW(inSum), s: inCnt + ' 笔', tone: 'up' },
    { k: '支出合计', v: yuanOfW(outSum), s: outCnt + ' 笔', tone: 'down' },
    { k: '净额', v: signedYuanW(net), s: '入账 − 支出', tone: clsPnl(net) },
  ]);

  html += '<div class="holding-toolbar"><div class="filter-group" id="flowChips">' +
    toolbarChip('all', '全部', flowTypeFilter === 'all') +
    toolbarChip('in', '入账', flowTypeFilter === 'in') +
    toolbarChip('out', '支出', flowTypeFilter === 'out') +
    toolbarChip('dividend', '分红', flowTypeFilter === 'dividend') +
    toolbarChip('trade', '买卖', flowTypeFilter === 'trade') +
    toolbarChip('invest', '投资', flowTypeFilter === 'invest') +
    toolbarChip('transfer', '转账', flowTypeFilter === 'transfer') +
    '</div><select class="sort-select" id="flowRange">' +
    toolbarOpt('7', '近7天', flowRangeDays === 7) +
    toolbarOpt('30', '近30天', flowRangeDays === 30) +
    toolbarOpt('365', '近1年', flowRangeDays === 365) +
    '</select></div>';

  if (!list.length) {
    html += '<p class="u-muted">该范围内暂无资金流水。</p>';
    body.innerHTML = html;
  } else {
    const rows = list.map((f) => {
      const amt = f.amount || 0;
      const cls = clsPnl(amt);
      const snap = !!f.snapshot;
      const undoBtn = snap ? '' : actBtn('undo', 'data-afrb="' + f.id + '"', '回退该笔资金变动');
      return '<tr' + (snap ? ' class="snap-flow"' : '') + '><td>' + esc((f.date || '').slice(5)) + '</td><td>' + cashFlowTypeTag(f) + finCatBadge(flowCatOf(f)) + flowSourceTag(f.source) + flowSnapshotTag(f) + '</td>' +
        '<td class="num ' + cls + '">' + (amt >= 0 ? '+' : '−') + moneyCurW(Math.abs(amt), f.currency) + '</td>' +
        '<td class="note-cell" title="' + esc(f.note || '') + '">' + esc(f.note || '') + '</td>' +
        '<td class="row-actions">' + undoBtn + '</td></tr>';
    }).join('');
    html += '<div class="card asset-flow-card"><table class="asset-table flow-hist"><thead><tr><th>日期</th><th>类型</th><th class="num">金额</th><th>说明</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    body.innerHTML = html;
  }
  body.querySelectorAll('[data-afrb]').forEach((b) => { b.onclick = () => rollbackAssetFlow(Number(b.dataset.afrb), body); });
  const chips = body.querySelector('#flowChips');
  if (chips) chips.querySelectorAll('.filter-chip').forEach((b) => { b.onclick = () => { flowTypeFilter = b.dataset.cat; paintFlows(body); }; });
  const rng = body.querySelector('#flowRange');
  if (rng) rng.onchange = () => { flowRangeDays = parseInt(rng.value, 10) || 30; paintFlows(body); };
}

// 流水类型粗分类映射（全部/入账/支出/分红/买卖/投资/转账；投资与转账按语义分类判定）
function flowMatch(f, t) {
  const amt = Number(f.amount || 0);
  if (t === 'in') return amt >= 0;
  if (t === 'out') return amt < 0;
  if (t === 'dividend') return f.type === 'dividend' || flowCatOf(f) === 'invest_div';
  if (t === 'trade') return ['adjust_buy', 'adjust_sell', 'mcp_buy', 'mcp_sell'].includes(f.type);
  if (t === 'invest') return flowCatOf(f) === 'invest';
  if (t === 'transfer') return flowCatOf(f) === 'transfer';
  return true;
}

// 资产页「收支」子面板：迁移自财务页的收支计划卡片（新增按钮 + 卡片列表），复用同一 cashflow 弹框。
// 取代原「负债」表格：负债的增删改仍走「账户」子面板下的子账户/负债折叠行。
async function renderAssetCashflowPanel(body) {
  if (!body) return;
  // 财务页已移除收支计划，此处独立加载（含关联账户名缓存）
  await loadCashflow();
  // 统一查看月份：所有循环计划一起翻；并预填当前月完成态缓存，避免卡片先显示成铅笔
  cfViewYm = cashflowMonth || cfNowYm;
  _planDoneCache[cashflowMonth || cfNowYm] = cashflowDone;
  const plans = cashflowPlans || [];
  // 合计只算「循环」计划：一次性计划挂在具体日期上，混进「每月收入」会把单月总额抬高。
  // 金额统一折 CNY（计划可设港币/美元），与表格里的原币显示互不影响。
  const rec = plans.filter((p) => p.pattern !== 'one_time');
  const one = plans.filter((p) => p.pattern === 'one_time');
  const sumOf = (type) => rec.filter((p) => p.type === type)
    .reduce((a, p) => a + cnyOf(Math.abs(Number(p.amount) || 0), normCurJS(p.currency)), 0);
  const incSum = sumOf('income');
  const expSum = sumOf('expense');
  const netSum = incSum - expSum;
  const cntOf = (type) => rec.filter((p) => p.type === type).length;
  const sumHTML = plans.length ? assetSumHTML([
    { k: '每月收入', v: yuanOfW(incSum), s: cntOf('income') + ' 项循环', tone: 'up' },
    { k: '每月支出', v: yuanOfW(expSum), s: cntOf('expense') + ' 项循环', tone: 'down' },
    { k: '每月结余', v: signedYuanW(netSum), s: incSum > 0 ? '留存 ' + (netSum / incSum * 100).toFixed(0) + '%' : '收入 − 支出', tone: clsPnl(netSum) },
    { k: '计划', v: plans.length + ' 项', s: '循环 ' + rec.length + ' / 一次性 ' + one.length },
  ]) : '';
  body.innerHTML = `
    <div class="asset-cashflow">
      ${sumHTML}
      <div class="section-title">收支计划</div>
      <button class="plan-add-btn plan-add-btn-block" id="assetPlanAddBtn" type="button"><span class="plan-add-plus">+</span> 新增收支计划</button>
      <div class="plan-list" id="assetPlanList"></div>
    </div>`;
  const addBtn = document.getElementById('assetPlanAddBtn');
  if (addBtn) addBtn.onclick = () => openCashflowModal();
  await renderPlanList(document.getElementById('assetPlanList'));
}

// 资产页流水回退：复用后端 POST /api/asset/flows/cash/:id/rollback，回退后原地刷新本面板。
async function rollbackAssetFlow(id, body) {
  openConfirm({
    title: '回退该笔资金变动',
    msg: '将记一笔反向流水冲正账户余额，原记录保留（审计友好）。是否继续？',
    okText: '回退', danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/asset/flows/cash/' + id + '/rollback', { method: 'POST' });
        if (!r.ok) { let m = '回退失败'; try { const dd = await r.json(); if (dd && dd.error) m = dd.error; } catch (_) {} toast(m, 'err'); return; }
        toast('已回退该笔资金变动', 'ok');
        assetFlowsCache = [];
        await renderAssetFlowsPanel(body);
      } catch (e) { toast('回退异常：' + e.message, 'err'); }
    }
  });
}

// 资产子 tab 切换（原型下划线样式，无滑动白块）
function bindAssetSubTabs() {
  const tabs = document.getElementById('assetSubTabs');
  if (!tabs) return;
  tabs.querySelectorAll('.sub-tab').forEach((b) => {
    b.onclick = () => {
      tabs.querySelectorAll('.sub-tab').forEach((x) => x.classList.toggle('active', x === b));
      const sub = b.dataset.sub;
      document.querySelectorAll('#assetTabBody .asset-subpanel').forEach((p) => p.classList.toggle('active', p.dataset.sub === sub));
    };
  });
}

// 资产页页内工具条已删除：盈亏日历入口上提至首页「收益率」卡，资产构成入口上提至首页「总市值」卡，
// 资产页页内工具条已删除：盈亏日历入口上提至首页「收益率」卡，资产构成入口上提至首页「总市值」卡。
// 原全局 header 工具条（资产工具 / 资产全景 / 通知渠道）已迁至常驻主导航，同样不再需要。

function assetDel(type, id) {
  const msg = {
    source: '确认删除该账户？关联记录会保留账户名快照，但账户本身不可恢复。',
    wealth: '确认删除该理财？其每日录入记录一并删除，不可恢复。',
    cash: '确认删除该子账户？不可恢复。',
    liability: '确认删除该负债？不可恢复。',
  }[type] || '确认删除？';
  pendingAssetDel = { type, id };
  $('#confirmMsg').textContent = msg;
  $('#confirmModal').hidden = false;
}

// ---- 资产来源 ----
// 表格行展开指示箭头（展开态旋转 180°）
const SC_CHEV = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

// 主币种：账户只有一个币种时直接显示；多币种时取折 CNY 后金额最大的那个，
// 其余用「+n」计数表示（币种列只有 52px，列全了反而读不清）
function srcPrimaryCur(subs, s) {
  const set = [...new Set(subs.map((c) => (c.currency || 'cny').toLowerCase()))];
  if (!set.length) {
    const one = String(s.currencies || 'cny').split(',')[0].trim().toLowerCase() || 'cny';
    return { text: one.toUpperCase(), title: '' };
  }
  if (set.length === 1) return { text: set[0].toUpperCase(), title: '' };
  const sums = {};
  subs.forEach((c) => { const k = (c.currency || 'cny').toLowerCase(); sums[k] = (sums[k] || 0) + toRmb(c, Number(c.amount) || 0); });
  const best = set.slice().sort((a, c) => (sums[c] || 0) - (sums[a] || 0))[0];
  return { text: best.toUpperCase() + ' +' + (set.length - 1), title: set.map((c) => c.toUpperCase()).join(' / ') };
}
function renderSources(body) {
  const list = assetSources;
  // 表格里子行是独立 <tr>，用 data-sub 标记所属账户；重渲染后据此恢复展开集合，
  // 避免编辑/转账等操作触发全局刷新时把已展开的子行收回去。
  const openSubs = new Set();
  body.querySelectorAll('.atbl tr[data-sub]:not([hidden])').forEach((tr) => { if (tr.dataset.sub) openSubs.add(String(tr.dataset.sub)); });
  const prevScroll = body.scrollTop;
  // 「添加收支」「添加流水」入口已删（2026-10-22）：与首页功能重复——收支计划新建收敛到资产页「收支」子面板
  // 「＋ 新增收支计划」（#assetPlanAddBtn），流水录入收敛到首页「快捷功能 · 记收入/记支出」，均复用同一弹框。
  let html = `<div class="asset-section-head"><h3>账户（${list.length}）</h3><div class="sec-actions"><button class="btn icon-btn asset-add" id="balanceSyncBtn" type="button" title="一键更新余额" aria-label="一键更新余额">${actIcon('refresh')}</button><button class="btn icon-btn asset-add" id="addSourceBtn" title="添加账户" aria-label="添加账户">${actIcon('plus')}</button></div></div>`;
  // 一张卡承载账户主表；横向滚动由 .as-main 接管。指标条摘要头已迁出为独立「资产摘要」卡。
  html += `<div class="as-card tier-1"><div class="as-main">`;
  if (!list.length) html += emptyStateHTML({ icon: EMPTY_ICONS.bank, title: '还没有账户', desc: '先添加一个银行、证券或软件，开始记录你的资产。', btnLabel: '＋ 添加账户', btnAttrs: 'data-empty-add="source"' });
  else {
    // 按账户归属地域（cn/hk/us）分组：地域是账户的属性，不做持仓级拆分。
    // 组内按关联资金从大到小，金额右对齐在同一 x 轴上才可比大小。
    const typeOf = (s) => (s.type === 'securities' || s.type === 'software' || s.type === 'platform') ? s.type : 'bank';
    const typeName = { bank: '银行', securities: '证券', software: '软件', platform: '平台' };
    const groups = ['cn', 'hk', 'us']
      .map((r) => ({ r, items: list.filter((s) => normRegionJS(s.region) === r).sort((a, b) => (b.funds_cny || 0) - (a.funds_cny || 0)) }))
      .filter((g) => g.items.length);
    html += `<table class="atbl"><colgroup><col><col class="c-ty"><col class="c-cur"><col class="c-bal"><col class="c-share"><col class="c-cnt"><col class="c-op"></colgroup>`;
    html += `<thead><tr><th>账户</th><th>类型</th><th>币种</th><th class="num">余额 (CNY)</th><th class="num">占比</th><th class="num">子账户</th><th></th></tr></thead><tbody>`;
    for (const g of groups) {
      const gsum = g.items.reduce((a, s) => a + (Number(s.funds_cny) || 0), 0);
      const m = REGION_META[g.r] || { zh: g.r.toUpperCase(), en: '', code: g.r.toUpperCase() };
      html += `<tr class="grp"><td colspan="7"><div class="gh">` +
        `<span class="gdot" style="--rgc:${AS_REG_COLOR[g.r] || 'rgb(var(--cat-other))'}"></span>` +
        `<span class="gn">${m.zh}</span><span class="ge">${m.en}</span>` +
        `<span class="gc">${g.items.length} 个账户</span><span class="gsum"${wanTitle(gsum, '¥')}>${yuanOfW(gsum)}</span></div></td></tr>`;
      for (const s of g.items) {
        const subs = cashListOf(s.id);
        const libs = liabListOf(s.id);
        const subCnt = subs.length + libs.length;
        const v = Number(s.funds_cny) || 0;
        const share = gsum > 0 ? v / gsum * 100 : 0;
        const cur = srcPrimaryCur(subs, s);
        const ident = maskIdent(s.account_no);
        const open = openSubs.has(String(s.id));
        html += `<tr class="row${open ? ' open' : ''}" data-row="${s.id}" title="点击查看子账户">` +
          `<td><div class="acc"><span class="chev">${SC_CHEV}</span><span class="alg">${accountLogo(s.name, typeOf(s))}</span>` +
            `<span class="an">${esc(s.name)}</span>${ident ? `<span class="aid">${esc(ident)}</span>` : ''}</div></td>` +
          `<td class="ty">${typeName[typeOf(s)]}</td>` +
          `<td class="cur"${cur.title ? ` title="${esc(cur.title)}"` : ''}>${esc(cur.text)}</td>` +
          `<td class="num${v < 0 ? ' neg' : (v === 0 ? ' zero' : '')}"${v === 0 ? '' : wanTitle(v, '¥')}>${v === 0 ? '—' : yuanOfW(v)}</td>` +
          `<td class="share" style="--p:${Math.max(0, share).toFixed(1)}%">${share.toFixed(1)}%</td>` +
          `<td class="num qty">${subCnt || '—'}</td>` +
          `<td class="op">` +
            `${actBtn('addSub', `data-act="add-sub" data-id="${s.id}"`, '添加子账户或负债')}` +
            `${actBtn('edit', `data-act="edit-source" data-id="${s.id}"`, '编辑账户')}` +
            `${actBtn('del', `data-act="del-source" data-id="${s.id}"`, '删除账户', { danger: true })}` +
          `</td></tr>`;
        html += cashSubTrHtml(s.id, open);
      }
    }
    html += `</tbody></table>`;
  }
  html += `</div></div>`;
  body.innerHTML = html;
  body.scrollTop = prevScroll;
  $('#addSourceBtn').onclick = () => openAssetSourceModal(null);
  // 「添加收支 / 添加流水」按钮已删（2026-10-22，与首页重复）：入口见首页财务视图「＋ 新增收支计划」与「快捷功能 · 记收入/记支出」
  $('#balanceSyncBtn').onclick = () => openBalanceSyncModal();
  // 账户级操作（操作列常驻，不再收进 kebab 菜单）
  body.querySelectorAll('[data-act="edit-source"]').forEach((b) => b.onclick = () => openAssetSourceModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="del-source"]').forEach((b) => b.onclick = () => assetDel('source', Number(b.dataset.id)));
  body.querySelectorAll('[data-act="add-sub"]').forEach((b) => b.onclick = () => openCashModal(null, Number(b.dataset.id)));
  // 行展开/收起：整行（除操作列）都是点击区；子行是同一 tbody 内的独立 <tr>
  body.querySelectorAll('.atbl tr.row').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('td.op')) return;
      const id = tr.dataset.row;
      const open = !tr.classList.contains('open');
      tr.classList.toggle('open', open);
      const tb = tr.parentNode;
      if (tb) tb.querySelectorAll('tr[data-sub="' + id + '"]').forEach((r) => { r.hidden = !open; });
    });
  });
  // 负债行的历史/编辑/删除（历史=余额变动：增加贷款/还款）
  body.querySelectorAll('[data-act="lb-hist"]').forEach((b) => b.onclick = () => openFlowHistory('liab', Number(b.dataset.id)));
  body.querySelectorAll('[data-act="edit-lb"]').forEach((b) => b.onclick = () => openLiabilityModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="del-lb"]').forEach((b) => b.onclick = () => assetDel('liability', Number(b.dataset.id)));
  bindCashActions(body);
}

function openAssetSourceModal(id) {
  const s = id ? assetSources.find((x) => x.id === id) : null;
  $('#assetSourceTitle').textContent = s ? '编辑账户' : '添加账户';
  $('#as_id').value = s ? s.id : '';
  $('#as_name').value = s ? s.name : '';
  $('#as_type').value = s ? s.type : 'bank';
  $('#as_region').value = s ? normRegionJS(s.region) : 'cn';
  $('#as_account_no').value = s ? (s.account_no || '') : '';
  $('#as_note').value = s ? (s.note || '') : '';
  // 标识标签随地域联动：CN=银行卡号，HK/US=账户号码
  setAssetIdentLabel($('#as_region').value);
  // 币种多选：编辑按已保存集合勾选，新增默认勾选 CNY
  const curs = (s ? (s.currencies || '') : 'cny').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  document.querySelectorAll('#as_currencies input[type="checkbox"]').forEach((cb) => { cb.checked = curs.includes(cb.value); });
  $('#assetSourceErr').textContent = '';
  $('#assetSourceModal').hidden = false;
}
// 账户弹框标识输入标签随地域切换（CN=银行卡号 / HK·US=账户号码）
function setAssetIdentLabel(region) {
  const lbl = $('#as_account_label');
  if (!lbl) return;
  lbl.textContent = region === 'cn' ? '银行卡号' : '账户号码';
}
const asRegionEl = $('#as_region');
if (asRegionEl) asRegionEl.onchange = () => setAssetIdentLabel(asRegionEl.value);
$('#assetSourceForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#as_id').value ? Number($('#as_id').value) : 0;
  const currencies = [...document.querySelectorAll('#as_currencies input[type="checkbox"]:checked')].map((cb) => cb.value).join(',');
  const payload = { name: $('#as_name').value.trim(), type: $('#as_type').value, region: $('#as_region').value, currencies, account_no: $('#as_account_no').value.trim(), note: $('#as_note').value.trim() };
  if (!payload.name) { $('#assetSourceErr').textContent = '名称不能为空'; return; }
  if (!payload.currencies) { $('#assetSourceErr').textContent = '请至少勾选一个币种'; return; }
  try {
    const r = id ? await api('/api/asset/sources/' + id, { method: 'PUT', body: JSON.stringify(payload) })
                 : await api('/api/asset/sources', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#assetSourceErr').textContent = m; return; }
    $('#assetSourceModal').hidden = true;
    await loadAsset();
  } catch (err) { $('#assetSourceErr').textContent = '异常：' + err.message; }
};

// ---- 理财 ----
// 任意理财金额折算成 CNY（总金额 / 今日收益 / 累计收益通用）
function wCny(p, v) {
  const a = Number(v) || 0;
  const c = (p.currency || 'cny').toLowerCase();
  if (c === 'usd') return a * (usdRate || 1);
  if (c === 'hkd') return a * (hkdRate || 1);
  return a;
}
// 悬停 tooltip：非 CNY 币种显示"约 ¥xx"（CNY 币种返回空，不重复显示）
function wRmbTitle(p, v) {
  const c = (p.currency || 'cny').toLowerCase();
  if (c === 'cny') return '';
  return ` title="约 ¥${fmt(wCny(p, v))}"`;
}

// 理财 KPI（渲染进顶部 #wealthKpiBody，与持仓/平仓 KPI 同一位置互换显示）。
// 口径：市值/收益一律折 CNY（多币种不能直接相加，与表格「合计」列一致）；
// 年化用单利 = 累计收益 ÷ 本金 ÷ 加权持有天数 × 365（本金近似 = 市值 − 累计收益），
// 与表格「年化」列同口径，只是这里按持仓金额加权汇总成一个组合级数字。
function renderWealthKpi() {
  const el = document.getElementById('wealthKpiBody');
  if (!el) return;
  const all = (assetData && assetData.wealth ? assetData.wealth.products : []) || [];
  const live = all.filter((p) => !p.archived);
  const dead = all.filter((p) => p.archived);
  let mv = 0, day = 0, cum = 0, dayW = 0;
  for (const p of live) {
    const amt = Number(p.amount) || 0;
    mv += wCny(p, amt);
    day += wCny(p, Number(p.today_pnl) || 0);
    cum += wCny(p, Number(p.cum_pnl) || 0);
    dayW += (Number(p.holding_days) || 0) * amt;
  }
  const principal = mv - cum;                       // 本金近似（同表格年化口径）
  const wDays = mv > 0 ? Math.round(dayW / mv) : 0; // 金额加权持有天数
  const cumRate = principal > 0.005 ? cum / principal * 100 : null;
  const annRate = (cumRate != null && wDays > 0) ? cumRate * 365 / wDays : null;
  // 今日收益占市值只有千分之几，pctOf 的 1 位小数会全被抹成 0.1%／0.0%，这里给 2 位
  const dayPct = mv > 0.005 ? (day / mv * 100).toFixed(2) + '%' : '—';

  el.innerHTML = `<div class="kpi-row cols-anchor">
      <div class="kpi-card density-standard anchor">
        <div class="kpi-icon kpi-ico-equity"><svg viewBox="0 0 24 24"><path d="M3 7h18l-2 13H5L3 7Z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></svg></div>
        <div class="kpi-label">理财市值</div>
        <div class="kpi-main"><div class="kpi-value">${yuanOfW(mv)}</div></div>
        <div class="kpi-sub">在持 <span class="hl">${live.length}</span> 款${dead.length ? ` · 已清仓 <span class="hl">${dead.length}</span> 款` : ''}</div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-up"><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg></div>
        <div class="kpi-label">今日收益</div>
        <div class="kpi-main"><div class="kpi-value ${clsPnl(day)}">${day > 0 ? '+' : ''}${yuanOfW(day)}</div></div>
        <div class="kpi-sub">占市值 <span class="hl">${dayPct}</span></div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-down"><svg viewBox="0 0 24 24"><path d="M3 7l6 6 4-4 8 8"/><path d="M14 17h7v-7"/></svg></div>
        <div class="kpi-label">累计收益</div>
        <div class="kpi-main"><div class="kpi-value ${clsPnl(cum)}">${cum > 0 ? '+' : ''}${yuanOfW(cum)}</div></div>
        <div class="kpi-sub">累计收益率 <span class="hl ${clsPnl(cumRate)}">${cumRate == null ? '—' : (cumRate >= 0 ? '+' : '') + cumRate.toFixed(2) + '%'}</span></div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-pct"><svg viewBox="0 0 24 24"><path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg></div>
        <div class="kpi-label">年化收益</div>
        <div class="kpi-main"><div class="kpi-value ${clsPnl(annRate)}">${annRate == null ? '—' : (annRate >= 0 ? '+' : '') + annRate.toFixed(2) + '%'}</div></div>
        <div class="kpi-sub">加权持有 ${wDays ? wDays + ' 天' : '—'}</div>
      </div>
    </div>`;
}

function renderWealth(body) {
  renderWealthKpi(); // 顶部 KPI 与表格同源（assetData.wealth），任何一次重渲染都同步刷新
  let raw = (assetData.wealth || {}).products || [];
  if (wealthCatFilter === 'nav') raw = raw.filter((p) => (Number(p.nav) || 0) > 0);
  else if (wealthCatFilter === 'other') raw = raw.filter((p) => (Number(p.nav) || 0) <= 0);
  const w = [...raw].sort((a, b) => Number(b.amount) - Number(a.amount)); // 按金额从大到小
  // 「更新理财持仓」已上移到首页顶部操作条（#wealthSnapBtn）；「添加理财」收敛到顶部 #addBtn。
  // 「批量刷新净值」按钮及前端逻辑已删（2026-10-19）：自动/批量刷新净值尚未支持，后端接口保留。
  // 计数（理财（N））已上提到切换条右侧 #tblDesc，此处不再单独渲染头，避免与切换条分两行。
  let html = '';
  if (!w.length) html += emptyStateHTML({ icon: EMPTY_ICONS.wallet, title: '还没有理财', desc: '添加第一笔理财，每日净值自动录入并计入资产全景。', btnLabel: '＋ 添加第一笔理财', btnAttrs: 'data-empty-add="wealth"' });
  else html += renderWealthTable(w);
  body.innerHTML = html;
  body.querySelectorAll('[data-act="edit-wealth"]').forEach((b) => b.onclick = () => openWealthModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="wealth-hist"]').forEach((b) => b.onclick = () => openWealthHistory(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="wealth-nav"]').forEach((b) => b.onclick = () => openWealthNavModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="enable-wealth"]').forEach((b) => b.onclick = () => enableWealthRow(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="reduce-wealth"]').forEach((b) => b.onclick = () => openReduceWealth(Number(b.dataset.id)));
  bindCopyDelegation(body);
}

// 首页跟随式理财区块（renderWealthInline）已移除（2026-10-19）：理财统一由顶部「理财」切换进入 #homeWealthBox，不再在持仓下方跟随展示。

// 理财表格视图（账户分组折叠，样式复用持仓来源分组）：按 source_id 分组，组头显示账户名 + 款数 + 合计金额，
// 悬停展开单日/累计收益。行内不再重复账户列（账户已是组头），其余列沿用原口径。
function renderWealthTable(w) {
  const groups = new Map();
  for (const p of w) {
    const sid = p.source_id || 0;
    if (!groups.has(sid)) groups.set(sid, { sid, name: p.source_name || (sid === 0 ? '未分组' : '账户' + sid), items: [] });
    groups.get(sid).items.push(p);
  }
  // 仓位分母：同(来源,币种)理财金额合计；多币种各自成池，避免跨币种相加产生无意义占比
  const wPool = {};
  for (const p of w) {
    const k = (p.source_id || 0) + ':' + normCur(p.currency);
    wPool[k] = (wPool[k] || 0) + (Number(p.amount) || 0);
  }
  const arr = [...groups.values()].sort((a, b) =>
    b.items.reduce((s, p) => s + wCny(p, p.amount), 0) - a.items.reduce((s, p) => s + wCny(p, p.amount), 0));
  return `<div class="wealth-groups">` + arr.map((g) => {
    // 组内多币种时不合计（不同币种不能直接相加），组头显式说明而不是显示误导性的 ¥0
    const curs = [...new Set(g.items.map((p) => p.currency || 'cny'))];
    const single = curs.length === 1;
    const sum = single ? wCny(g.items[0], g.items.reduce((s, p) => s + Number(p.amount || 0), 0)) : 0;
    const dayPnl = single ? g.items.reduce((s, p) => s + Number(p.today_pnl || 0), 0) : 0;
    const cumPnl = single ? g.items.reduce((s, p) => s + Number(p.cum_pnl || 0), 0) : 0;
    // 累计收益率 = 累计收益 ÷ 实际投入本金（≈ 当前市值 − 累计收益）；多币种组无单一口径，置 0 由下方分段展示
    const cumRate = (single && (sum - cumPnl) > 0) ? cumPnl / (sum - cumPnl) * 100 : 0;
    // 多币种组按各自币种分段列出，避免只给一个合计让用户以为漏了其他币种的金额
    const mixLines = single ? '' : curs.map((c) => {
      const same = g.items.filter((p) => (p.currency || 'cny') === c);
      const amt = same.reduce((s, p) => s + Number(p.amount || 0), 0);
      return `<span${wanTitle(amt, curSymbolJS(c))}>${curSymbolJS(c)}${fmtWan(amt)}</span>`;
    }).join(' + ');
    // 多币种时收益同样按币种分段（各币种独立，不跨币种相加）
    const mixPnlLines = single ? '' : curs.map((c) => {
      const same = g.items.filter((p) => (p.currency || 'cny') === c);
      const d = same.reduce((s, p) => s + Number(p.today_pnl || 0), 0);
      const m = same.reduce((s, p) => s + Number(p.cum_pnl || 0), 0);
      return `<span${wanTitle(d, curSymbolJS(c))}>${curSymbolJS(c)}${d >= 0 ? '+' : ''}${fmtWan(d)}</span> / <span${wanTitle(m, curSymbolJS(c))}>${m >= 0 ? '+' : ''}${fmtWan(m)}</span>`;
    }).join('　');
    const rows = g.items.map((p, i) => {
      const pnl = p.today_pnl || 0;
      const cum = p.cum_pnl || 0;
      const arch = !!p.archived;
      // 仓位：占同(来源,币种)理财合计比例，动态宽度颜色条（同资产页账户列表「占比」）
      const wKey = (p.source_id || 0) + ':' + normCur(p.currency);
      const wPoolSum = wPool[wKey] || 0;
      const wPos = wPoolSum > 0 ? (Number(p.amount) || 0) / wPoolSum * 100 : 0;
      // 单利年化 = 累计收益 ÷ 当前持仓 ÷ 持有天数 × 365（当前持仓近似本金；已清仓/无天数不计算）
      const days = Number(p.holding_days || 0);
      const base = Number(p.amount || 0);
      const ann = (!arch && days > 0 && base > 0.005) ? (cum / base) / days * 365 * 100 : null;
      return `<tr${arch ? ' class="wealth-archived"' : ''}>
      <td class="name-cell"><span class="wn-idx">${i + 1}</span><span class="name-cap"><span class="name-clickable" title="${esc(p.name)}">${esc(p.name)}</span></span><span class="cur-badge">${curSymbolJS(p.currency)}</span>${arch ? '<span class="cur-badge wb-archived" title="已清仓停用：保留历史收益，可启用或删除">已清仓</span>' : ''}</td>
      <td class="wn-code">${esc(p.code || '—')}</td>
      <td class="num"${wanTitle(p.amount || 0, curSymbolJS(p.currency))}>${moneyCurW(p.amount || 0, p.currency)}</td>
      <td class="num share${wPoolSum > 0 ? '' : ' is-empty'}"${wPoolSum > 0 ? ` style="--p:${wPos.toFixed(1)}%"` : ''} title="占该账户同币种理财合计比例${wPoolSum > 0 ? ' ' + wPos.toFixed(2) + '%' : ''}">${wPoolSum > 0 ? wPos.toFixed(2) + '%' : '—'}</td>
      <td class="num ${clsPnl(pnl)}"${wRmbTitle(p, pnl)}><span${wanTitle(pnl, curSymbolJS(p.currency))}>${(pnl >= 0 ? '+' : '')}${moneyCurW(pnl, p.currency)}</span></td>
      <td class="num ${clsPnl(cum)}"${wRmbTitle(p, cum)} title="累计收益"><span${wanTitle(cum, curSymbolJS(p.currency))}>${(cum >= 0 ? '+' : '')}${moneyCurW(cum, p.currency)}</span><small> (${p.cum_return_rate == null ? '—' : pct(p.cum_return_rate)})</small></td>
      <td class="num ${clsPnl(ann)}" title="单利年化 = 累计收益 ÷ 当前持仓 ÷ 持有天数 × 365（当前持仓近似本金）">${ann === null ? '—' : pct(ann)}</td>
      <td class="num u-sm u-muted" title="从首次录入快照起算">${days > 0 ? days + '天' : '—'}</td>
      <td class="num" title="${p.nav_updated_at ? ('净值更新于 ' + esc(p.nav_updated_at)) : '尚未录入净值（净值型产品可在 App 查看后点「净值」录入，或由基金码自动抓取）'}">${p.nav > 0 ? fmt(p.nav) : '<span class="u-muted">—</span>'}</td>
      <td class="row-act-cell">
        ${actBtn('edit', `data-act="edit-wealth" data-id="${p.id}"`, '编辑')}
        ${actBtn('hist', `data-act="wealth-hist" data-id="${p.id}"`, '每日盈亏')}
        ${actBtn('nav', `data-act="wealth-nav" data-id="${p.id}"`, '刷新净值')}
        ${arch
          ? actBtn('refresh', `data-act="enable-wealth" data-id="${p.id}"`, '启用')
          : actBtn('exit', `data-act="reduce-wealth" data-id="${p.id}"`, '赎回')}
      </td>
    </tr>`;
    }).join('');
    return `<div class="collapsible source-group holdings-group wealth-group" data-sid="${g.sid}">
      <div class="collapse-hat holdings-group-head">
        <span class="hat-title">${srcLogo(g.sid)} ${esc(g.name)} <span class="hat-count">${g.items.length} 款</span></span>
        <span class="hat-side">
          <span class="hat-stat hat-stat-mv" title="${single ? '该账户理财合计市值（折合人民币）' : '该账户下存在多种币种，此处按币种分段列出，不折算合计'}"><span class="hat-stat-lbl">${single ? '合计' : '多币种'}</span><b${single ? wanTitle(sum, '¥') : ' class="mix-amt"'}>${single ? '¥' + fmtWan(sum) : mixLines}</b></span>
          <span class="hat-side-extra" title="${single ? '该账户今日 / 累计收益合计' : '多币种账户按币种分段：今日 / 累计收益，不跨币种相加'}">
            ${single ? `
            <span class="hat-stat" title="该账户今日收益合计"><span class="hat-stat-lbl">今日</span><b class="${clsPnl(dayPnl)}"${wanTitle(dayPnl, '¥')}>${fmtWanPnl(dayPnl)}</b></span>
            <span class="hat-stat" title="该账户累计收益合计"><span class="hat-stat-lbl">累计收益</span><b class="${clsPnl(cumPnl)}"${wanTitle(cumPnl, '¥')}>${fmtWanPnl(cumPnl)} <small>(${pct(cumRate)})</small></b></span>` : `<span class="hat-stat hat-stat-mix" title="按币种分段：今日 / 累计收益"><span class="hat-stat-lbl">今日/累计</span><b class="mix-amt">${mixPnlLines}</b></span>`}
          </span>
          <span class="hat-chevron">▾</span>
        </span>
      </div>
      <div class="collapse-body source-group-body">
        <div class="subtable-wrap"><table class="asset-table holdings-subtable wealth-subtable">
        <thead><tr><th>名称</th><th>代码</th>
        <th class="num" title="当前金额（折人民币）">市值</th><th class="num" title="占该账户同币种理财合计比例">仓位</th><th class="num">今日收益</th><th class="num" title="累计收益金额">累计收益</th><th class="num">年化</th>
        <th class="num">持有天数</th><th class="num">最新净值</th><th>操作</th>
        </tr></thead><tbody>${rows}</tbody>
        </table></div></div></div>`;
  }).join('') + `</div>`;
}

// 理财行内操作：重新启用已清仓停用的产品（恢复参与每日持仓录入）
async function enableWealthRow(id) {
  try {
    const r = await api(`/api/asset/wealth/${id}/enable`, { method: 'POST' });
    if (!r.ok) { let m = '启用失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
    await loadAsset();
    toast('已重新启用，可在「更新理财持仓」里继续录入', 'ok');
  } catch (err) { toast('异常：' + err.message, 'err'); }
}

// 理财行内操作：永久删除（产品与其每日盈亏/审计记录一并删除，不可恢复）
async function delWealthRow(id) {
  const p = ((assetData.wealth || {}).products || []).find((x) => x.id === id);
  const name = p ? (p.name || ('#' + id)) : ('#' + id);
  const amt = p ? Number(p.amount || 0) : 0;
  const cur = p ? (p.currency || 'cny') : 'cny';
  const warn = amt > 0.005 ? `该理财仍有持仓 ${moneyCur(amt, cur)}，删除后这部分资产将从总资产中直接消失。` : '';
  openConfirm({
    title: '永久删除理财',
    msg: `${warn}确认永久删除「${name}」？其每日盈亏与审计记录将一并删除，不可恢复。`,
    okText: '删除', danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/asset/wealth/' + id, { method: 'DELETE' });
        if (!r.ok) { let m = '删除失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
        await loadAsset();
        toast(`已永久删除「${name}」`, 'ok');
      } catch (err) { toast('异常：' + err.message, 'err'); }
    },
  });
}

// 理财行内操作：赎回——打开「赎回」弹框（部分赎回或全额清仓）。
// 弹框含：赎回金额（默认=剩余持仓，即清仓）、赎回金额入账账户（默认同来源同币种余额最大子账户，即「买入时选择的账户」代理）、操作行内永久删除按钮。
let reduceWealthId = 0;
async function openReduceWealth(id) {
  reduceWealthId = id;
  const p = ((assetData.wealth || {}).products || []).find((x) => x.id === id);
  if (!p) return;
  const cur = p.currency || 'cny';
  const remain = Number(p.amount || 0);
  $('#wrTitle').textContent = '赎回 · ' + (p.name || ('#' + id));
  const amt = $('#wr_amount');
  amt.value = remain > 0 ? remain : '';
  amt.max = String(remain);
  // 入账账户下拉：仅列同来源、同币种子账户；默认余额最大者（与清仓回落口径一致，作为「买入时选择的账户」代理）
  const list = (cashAccountsCache || []).filter((c) => Number(c.source_id) === Number(p.source_id) && String(c.currency).toLowerCase() === String(cur).toLowerCase());
  const sel = $('#wr_cash_id');
  if (!list.length) {
    sel.innerHTML = '<option value="0">（无同账户同币种子账户）</option>';
    sel.disabled = true;
  } else {
    sel.disabled = false;
    const def = list.slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
    sel.innerHTML = list.map((c) => `<option value="${c.id}">${esc(c.name)}（${curSymbolJS(cur)}${fmt(c.amount || 0)}）</option>`).join('');
    sel.value = String(def.id);
  }
  $('#wrErr').textContent = '';
  $('#wealthReduceModal').hidden = false;
}
$('#wealthReduceForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = reduceWealthId;
  const p = ((assetData.wealth || {}).products || []).find((x) => x.id === id);
  if (!p) return;
  const cur = p.currency || 'cny';
  const remain = Number(p.amount || 0);
  const amt = round2(parseFloat($('#wr_amount').value) || 0);
  const cashId = Number($('#wr_cash_id').value) || 0;
  if (amt <= 0.005) { $('#wrErr').textContent = '赎回金额必须大于 0'; return; }
  if (amt > remain + 0.005) { $('#wrErr').textContent = '赎回金额不能超过剩余持仓'; return; }
  if (cashId <= 0) { $('#wrErr').textContent = '请选择赎回金额入账账户'; return; }
  const full = amt >= remain - 0.005;
  try {
    const r = await api('/api/asset/wealth/' + id + '/reduce', { method: 'POST', body: JSON.stringify({ amount: amt, cash_account_id: cashId }) });
    if (!r.ok) { let m = '赎回失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#wrErr').textContent = m; return; }
    $('#wealthReduceModal').hidden = true;
    await loadAsset();
    toast(full ? `「${p.name}」已清仓` : `已赎回 ${moneyCurW(amt, cur)}`, 'ok');
  } catch (err) { $('#wrErr').textContent = '异常：' + err.message; }
};
$('#wrCancel').onclick = () => { $('#wealthReduceModal').hidden = true; };
$('#wrDelete').onclick = () => { $('#wealthReduceModal').hidden = true; delWealthRow(reduceWealthId); };

let wealthCum0 = 0; // 编辑理财打开时的累计收益原值（输入框已移除，PUT 时回传防清零）
async function openWealthModal(id) {
  await loadSourcesCache();
  await loadCashAccounts();
  let w = null;
  if (id) { const r = await api('/api/asset/wealth'); if (r.ok) { const d = await r.json(); w = (d.wealth || []).find((x) => x.id === id); } }
  $('#wealthTitle').textContent = w ? '编辑理财' : '添加理财';
  $('#w_id').value = w ? w.id : '';
  $('#w_name').value = w ? w.name : '';
  $('#w_code').value = w ? (w.code || '') : '';
  // 账户·币种：合并选择器（二级子账户折叠面板，交互同「添加持仓」）。编辑时预选同 (来源, 币种) 的子账户；新增默认第一个子账户。
  setPickerHTML($('#wealthCashPanel'), buildFlowPicker());
  const presetAcc = w
    ? (cashAccountsCache || []).find((c) => Number(c.source_id) === Number(w.source_id) && String(c.currency).toLowerCase() === String(w.currency).toLowerCase())
    : (cashAccountsCache || [])[0];
  wealthSetSelection(presetAcc);
  // 累计收益已无输入框：由每日盈亏快照自动累计；编辑时回传原值，避免 PUT 全量更新清零
  wealthCum0 = w ? Number(w.cum_pnl || 0) : 0;
  $('#w_note').value = w ? (w.note || '') : '';
  $('#w_nav').value = w ? (w.nav ? w.nav : '') : '';
  $('#w_shares').value = w ? (w.shares ? w.shares : '') : '';
  $('#wealthErr').textContent = '';
  $('#wealthModal').hidden = false;
}
$('#wealthForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#w_id').value ? Number($('#w_id').value) : 0;
  // 账户·币种：从所选子账户派生 source_id + currency（与「添加持仓」一致）
  const selCash = (cashAccountsCache || []).find((x) => String(x.id) === String($('#w_cash').value));
  if (!selCash) { $('#wealthErr').textContent = '请选择账户（子账户）'; return; }
  const wNav = parseFloat($('#w_nav').value);
  const wShares = parseFloat($('#w_shares').value);
  const payload = { name: $('#w_name').value.trim(), code: $('#w_code').value.trim(), source_id: Number(selCash.source_id) || 0, currency: selCash.currency, cum_pnl: wealthCum0, note: $('#w_note').value.trim(), nav: isNaN(wNav) ? 0 : wNav, shares: isNaN(wShares) ? 0 : wShares };
  if (!payload.name) { $('#wealthErr').textContent = '名称不能为空'; return; }
  try {
    const r = id ? await api('/api/asset/wealth/' + id, { method: 'PUT', body: JSON.stringify(payload) })
                 : await api('/api/asset/wealth', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#wealthErr').textContent = m; return; }
    $('#wealthModal').hidden = true;
    await loadAsset();
  } catch (err) { $('#wealthErr').textContent = '异常：' + err.message; }
};

// 刷新净值：手动录入最新净值（银行理财从 App 查看后填；基金码产品亦可在此手动覆盖）。
// 后端按 金额 = 份额 × 净值 自动重算持仓金额与每日盈亏；无份额时优先复用已有份额，其次由最新快照金额反推。
async function openWealthNavModal(id) {
  let w = null;
  try {
    const r = await api('/api/asset/wealth');
    if (r.ok) { const d = await r.json(); w = (d.wealth || []).find((x) => x.id === id); }
  } catch (_) {}
  if (!w) { toast('未找到该理财', 'err'); return; }
  $('#wn_id').value = w.id;
  $('#wealthNavTitle').textContent = '刷新净值 · ' + w.name;
  $('#wn_nav').value = w.nav ? w.nav : '';
  $('#wn_shares').value = w.shares ? w.shares : '';
  $('#wealthNavErr').textContent = '';
  $('#wealthNavModal').hidden = false;
}
$('#wealthNavForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#wn_id').value ? Number($('#wn_id').value) : 0;
  if (!id) { $('#wealthNavErr').textContent = '缺少理财 ID'; return; }
  const nav = parseFloat($('#wn_nav').value);
  const shares = parseFloat($('#wn_shares').value);
  if (!nav || nav <= 0) { $('#wealthNavErr').textContent = '请填写有效净值'; return; }
  try {
    const r = await api('/api/asset/wealth/' + id + '/nav', {
      method: 'POST',
      body: JSON.stringify({ nav: nav, shares: isNaN(shares) ? 0 : shares }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { $('#wealthNavErr').textContent = d.error || '保存失败'; return; }
    $('#wealthNavModal').hidden = true;
    await loadAsset();
    const cur = (d.wealth && d.wealth.currency) || 'cny';
    toast(`净值已更新 ${fmt(nav)}（金额 ${moneyCur(d.amount || 0, cur)}）`, 'ok');
  } catch (err) { $('#wealthNavErr').textContent = '异常：' + err.message; }
};

// 批量自动刷新净值前端入口已删（2026-10-19，功能未支持）；后端 /api/asset/wealth/nav/refresh 保留。

// ---- 子账户（现金）----
// 现金已并入「账户」tab：作为各账户的子账户，在来源行下方折叠显示。
function cashListOf(sourceId) {
  return ((assetData.cash || {}).items || [])
    .filter((c) => Number(c.source_id) === Number(sourceId))
    .sort((a, b) => toRmb(b, b.amount || 0) - toRmb(a, a.amount || 0));
}

// 负债同样挂在来源（账户）下，作为子账户在「账户」tab 的折叠行里展示
function liabListOf(sourceId) {
  return ((assetData.liability || {}).items || [])
    .filter((l) => Number(l.source_id) === Number(sourceId))
    .sort((a, b) => (b.amount || 0) - (a.amount || 0));
}

// 账户卡展开抽屉：子账户 / 负债统一为「名称 · 币种 · 金额 · 操作」四段的行列表。
// 名称取自数据层 Cash.Name / Liability.Name（此前未渲染，同币种多子账户无法区分）；
// 两类同时存在时才插入分段小标题，只有一类时不加冗余标题。
// 操作按钮常驻（不做 hover 才显）：抽屉空间充足，且触屏无 hover 会永久丢掉入口。
// 账户表内展开的子账户/负债行（2026-10-17：由卡片抽屉的 flex 列表改为表格行，
// 与账户行共用同一套列宽，金额落在同一个 x 轴上才可比大小）。
// 两类并存时插「子账户 / 负债」分段小标题；只有负债时也插，避免无名负数字行。
function cashSubTrHtml(sourceId, open) {
  const items = cashListOf(sourceId);
  const libs = liabListOf(sourceId);
  const h = open ? '' : ' hidden';
  if (!items.length && !libs.length)
    return '<tr class="srow" data-sub="' + sourceId + '"' + h + '><td colspan="7"><div class="sub-empty">该账户暂无子账户，点右侧「＋」添加（弹框里勾选「负债」即建负债）。</div></td></tr>';
  const seg = items.length > 0 && libs.length > 0;
  let html = '';
  if (seg) html += '<tr class="shead" data-sub="' + sourceId + '"' + h + '><td colspan="7"><span class="sl">子账户</span></td></tr>';
  for (const c of items) {
    const cur = (c.currency || 'cny').toLowerCase();
    const nm = (c.name || '').trim() || (c.type || '').trim() || ('子账户 #' + c.id);
    html += '<tr class="srow" data-sub="' + sourceId + '"' + h + '>' +
      '<td><span class="sn" title="' + esc(nm) + '">' + esc(nm) + '</span>' +
        (c.excluded ? '<span class="sn-excl" title="日常开销账户：不计入再平衡（既不算现金类也不算总市值）">日常</span>' : '') + '</td>' +
      '<td class="ty"></td>' +
      '<td class="cur">' + cur.toUpperCase() + '</td>' +
      '<td class="num"' + wanTitle(Number(c.amount) || 0, curSymbolJS(cur)) + '>' + moneyCurW(Number(c.amount) || 0, cur) + '</td>' +
      '<td class="share"></td><td class="num qty"></td>' +
      '<td class="op">' +
        actBtn('hist', 'data-act="cash-hist" data-id="' + c.id + '"', '资金变动历史') +
        actBtn('edit', 'data-act="edit-cash" data-id="' + c.id + '"', '编辑') +
        actBtn('transfer', 'data-act="cash-transfer" data-id="' + c.id + '"', '转入其他子账户') +
        actBtn('del', 'data-act="del-cash" data-id="' + c.id + '"', '删除', { danger: true }) +
      '</td></tr>';
  }
  if (libs.length) html += '<tr class="shead" data-sub="' + sourceId + '"' + h + '><td colspan="7"><span class="sl">负债</span></td></tr>';
  for (const l of libs) {
    const cur = (l.currency || 'cny').toLowerCase();
    const nm = (l.name || '').trim() || (l.type || '').trim() || ('负债 #' + l.id);
    // 负债金额以负数红字呈现（库中存正数，合计时扣减）；分段标题已说明性质，行内不再重复标记
    html += '<tr class="srow" data-sub="' + sourceId + '"' + h + '>' +
      '<td><span class="sn" title="' + esc(nm) + '">' + esc(nm) + '</span></td>' +
      '<td class="ty"></td>' +
      '<td class="cur">' + cur.toUpperCase() + '</td>' +
      '<td class="num neg"' + wanTitle(Number(l.amount) || 0, '-' + curSymbolJS(cur)) + '>-' + moneyCurW(Number(l.amount) || 0, cur) + '</td>' +
      '<td class="share"></td><td class="num qty"></td>' +
      '<td class="op">' +
        actBtn('hist', 'data-act="lb-hist" data-id="' + l.id + '"', '余额变动历史（增加贷款/还款）') +
        actBtn('edit', 'data-act="edit-lb" data-id="' + l.id + '"', '编辑') +
        actBtn('del', 'data-act="del-lb" data-id="' + l.id + '"', '删除', { danger: true }) +
      '</td></tr>';
  }
  return html;
}

function bindCashActions(root) {
  root.querySelectorAll('[data-act="edit-cash"]').forEach((b) => b.onclick = () => openCashModal(Number(b.dataset.id)));
  root.querySelectorAll('[data-act="del-cash"]').forEach((b) => b.onclick = () => assetDel('cash', Number(b.dataset.id)));
  root.querySelectorAll('[data-act="cash-hist"]').forEach((b) => b.onclick = () => openFlowHistory('cash', Number(b.dataset.id)));
  root.querySelectorAll('[data-act="cash-transfer"]').forEach((b) => b.onclick = () => openCashTransfer(Number(b.dataset.id)));
}

// 子账户/负债 资金变动历史：复用「理财盈亏历史」弹框（含时间范围筛选：近30/90天·全部·自定义），
// 不再用独立现金弹框。kind='cash' 展示 日期/类型/变动/说明；kind='liab' 额外带「变动后余额」列。
async function openFlowHistory(kind, id) {
  wealthHistMode = (kind === 'liab') ? 'liab' : 'cash';
  wealthHistKind = wealthHistMode;
  const url = (kind === 'liab') ? ('/api/asset/liabilities/' + id + '/flows') : ('/api/asset/cash/' + id + '/flows');
  try {
    const r = await api(url);
    if (!r.ok) { toast('加载失败 (HTTP ' + r.status + ')', 'err'); return; }
    const d = await r.json();
    const acc = d.account || d.liability || {};
    wealthHistLiab = d.liability || null;
    const flows = d.flows || [];
    wealthHistAllRows = flows;
    flowHistCtx = { kind, id };
    // 流水默认显示全部（时间跨度可能很长），并清空自定义区间；用户可用范围栏收窄
    wealthHistRange = 0; wealthHistCustomFrom = null; wealthHistCustomTo = null;
    $('#whFrom').value = ''; $('#whTo').value = '';
    $('#wealthHistTitle').textContent = (acc.name || ((kind === 'liab' ? '负债 #' : '子账户 #') + id)) + ' · 资金变动历史';
    // 流水无审计快照：单表直接渲染（每日盈亏弹框已无 tab，资金变动复用同一表格体）
    $('#wealthHistModal').hidden = false;
    syncWealthRangeBar();
    renderWealthHistTable();
  } catch (err) { toast('异常：' + err.message, 'err'); }
}

function cashFlowTypeTag(f) {
  const t = typeof f === 'object' ? f.type : f;
  const amt = typeof f === 'object' ? (f.amount || 0) : 0;
  if (t === 'manual') {
    if (amt > 0) return '<span class="flow-tag in">手工存入</span>';
    if (amt < 0) return '<span class="flow-tag out">手工取出</span>';
    return '<span class="flow-tag manual">手工调整</span>';
  }
  switch (t) {
    // 「一键更新余额」批量对账产生的流水（见 internal/api/flows.go balanceSync）
    case 'manual_adjust': return '<span class="flow-tag manual">手动调整</span>';
    case 'adjust_buy': return '<span class="flow-tag out">加仓付款</span>';
    case 'adjust_sell': return '<span class="flow-tag in">减仓回款</span>';
    case 'transfer_out': return '<span class="flow-tag out">转出</span>';
    case 'transfer_in': return '<span class="flow-tag in">转入</span>';
    case 'transfer_rollback': return '<span class="flow-tag manual">回滚</span>';
    case 'wealth_deposit': return '<span class="flow-tag out">理财存入</span>';
    case 'deposit': return amt >= 0 ? '<span class="flow-tag in">存入</span>' : '<span class="flow-tag out">取出</span>';
    case 'wealth_redeem': return '<span class="flow-tag in">理财回款</span>';
    case 'wealth_clear': return '<span class="flow-tag in">清仓回款</span>';
    case 'wealth_reverse': return '<span class="flow-tag manual">理财冲正</span>';
    case 'dividend': return '<span class="flow-tag in">分红入账</span>';
    case 'fee': return '<span class="flow-tag manual">费用</span>';
    case 'loan': return '<span class="flow-tag in">借入</span>';
    case 'repay': return '<span class="flow-tag out">还款</span>';
    // 一次性还款（/api/asset/cash/repay-liability）：现金侧出账 + 负债侧减记各一条，
    // 列表层已在 db.ListFlows 去重，只剩现金这条，类型标签也补齐在这里。
    case 'repay_liability': return '<span class="flow-tag out">还款</span>';
    case 'repay_rollback': return '<span class="flow-tag manual">还款冲正</span>';
    case 'dca_buy': return '<span class="flow-tag out">定投扣款</span>';
    // 收支计划完成/撤销所记的真实流水（见 internal/api/cashflow.go recordPlanTransaction / reversePlanTransaction）
    case 'cf_income': return '<span class="flow-tag in">计划入账</span>';
    case 'cf_repay': return '<span class="flow-tag out">计划还款</span>';
    case 'cf_reverse': return '<span class="flow-tag manual">计划冲正</span>';
    // 存款（见 internal/api/deposits.go）：存入扣款 / 到期本金回流 / 利息入账
    case 'deposit_out': return '<span class="flow-tag out">存款存入</span>';
    case 'deposit_back': return '<span class="flow-tag in">存款支取</span>';
    case 'deposit_interest': return '<span class="flow-tag in">存款利息</span>';
    // 流水表「回退」按钮产生的反向流水（见 internal/api/flows.go rollbackFlow）
    case 'rollback': return '<span class="flow-tag manual">回退冲正</span>';
    // MCP 服务写入的流水（见 internal/mcp/tools.go，type 前缀 mcp_，并带 source=mcp 标签）
    case 'mcp_buy': return '<span class="flow-tag out">加仓付款</span>';
    case 'mcp_sell': return '<span class="flow-tag in">减仓回款</span>';
    case 'mcp_dividend': return '<span class="flow-tag in">分红入账</span>';
    case 'mcp_deposit': return '<span class="flow-tag in">存入</span>';
    case 'mcp_withdraw': return '<span class="flow-tag out">取出</span>';
    case 'mcp_subscribe': return '<span class="flow-tag out">理财申购</span>';
    case 'mcp_redeem': return '<span class="flow-tag in">理财赎回</span>';
    default: return esc(t || '-');
  }
}

// 流水来源标签：由 MCP 服务写入的流水打高亮标签（见 cash_flow.source / ListFlows 的兜底推断）
function flowSourceTag(src) {
  return src === 'mcp' ? '<span class="flow-tag src-mcp" title="由 MCP 服务写入">MCP</span>' : '';
}

// 仅快照标签：勾选「仅快照」记录的流水（计入汇总分析，不改动账户真实余额）
function flowSnapshotTag(f) {
  const snap = typeof f === 'object' ? !!f.snapshot : false;
  return snap ? '<span class="flow-tag snap" title="仅快照：计入汇总分析，不计入账户真实出入账">快照</span>' : '';
}

// 现金账户转账（仅同币种之间），写入 transfer_out / transfer_in 两条流水。
async function openCashTransfer(fromId) {
  const list = ((assetData.cash || {}).items || []);
  const src = list.find((x) => x.id === fromId);
  if (!src) { toast('找不到源账户', 'err'); return; }
  $('#ct_from_id').value = String(fromId);
  $('#ct_from_name').value = `${src.name}（余额 ${moneyCur(src.amount || 0, src.currency)} ${src.currency}）`;
  // 仅同币种、非自身账户可作为转入方
  const targets = list.filter((x) => x.id !== fromId && (x.currency || '').toUpperCase() === (src.currency || '').toUpperCase());
  const sel = $('#ct_to_id');
  sel.innerHTML = targets.length
    ? targets.map((x) => `<option value="${x.id}">${esc(x.name)}（${esc(x.source_name || '')}）</option>`).join('')
    : '<option value="">（暂无同币种账户）</option>';
  $('#ct_amount').value = '';
  $('#ct_note').value = '';
  $('#cashTransferErr').textContent = '';
  $('#cashTransferTitle').textContent = `从「${src.name}」转入其它账户`;
  $('#cashTransferModal').hidden = false;
}
$('#ctCancel').onclick = () => { $('#cashTransferModal').hidden = true; };
$('#cashTransferForm').onsubmit = async (e) => {
  e.preventDefault();
  const fromId = Number($('#ct_from_id').value || 0);
  const toId = Number($('#ct_to_id').value || 0);
  const amount = Number($('#ct_amount').value || 0);
  const note = ($('#ct_note').value || '').trim();
  if (!fromId || !toId) { $('#cashTransferErr').textContent = '请选择转入账户'; return; }
  if (fromId === toId) { $('#cashTransferErr').textContent = '源账户与目标账户不能相同'; return; }
  if (!(amount > 0)) { $('#cashTransferErr').textContent = '请输入大于 0 的转账金额'; return; }
  const submit = $('#ctSubmit');
  submit.disabled = true;
  try {
    const r = await api('/api/asset/cash/transfer', { method: 'POST', body: JSON.stringify({ from_id: fromId, to_id: toId, amount, note }) });
    if (!r.ok) {
      let m = '转账失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {}
      $('#cashTransferErr').textContent = m;
      return;
    }
    $('#cashTransferModal').hidden = true;
    await loadAsset();
    toast('转账完成', 'ok');
  } catch (err) {
    $('#cashTransferErr').textContent = '异常：' + err.message;
  } finally {
    submit.disabled = false;
  }
};

// 账户弹框（子账户 / 负债统一）：一个复选框标记「是负债」，不再分 tab。
// 新增与编辑都能改这个复选框；编辑时换性质走后端 /api/asset/accounts/convert 安全转换
// （仅在原记录没有资金流水、也没有被收支计划引用时才允许）。
let acctEdit = null; // 编辑中的原记录 { kind,id,name,type,currency,amount,source_id,note }；null=新增

function acctIsLiab() { const b = $('#c_is_liab'); return !!(b && b.checked); }

// 币种下拉候选：子账户币种只能取自「所属账户已勾选币种」（一个子账户一种币种）；
// 编辑态把当前币种并入候选，避免保存时被静默改掉。全局入口（无父账户上下文）才列全部三种。
const ACCT_CURS = [['cny', 'CNY'], ['hkd', 'HKD'], ['usd', 'USD']];
function parseCurList(s) {
  const out = String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => x === 'cny' || x === 'hkd' || x === 'usd');
  return out.length ? out : ['cny'];
}
function renderAcctCurrencyOptions(srcId, keepCur) {
  const sel = $('#c_currency');
  if (!sel) return;
  const src = (assetSources || []).find((s) => String(s.id) === String(srcId));
  const allow = src ? parseCurList(src.currencies) : ['cny', 'hkd', 'usd'];
  if (keepCur && allow.indexOf(keepCur) < 0) allow.push(keepCur);
  sel.innerHTML = ACCT_CURS.filter(([v]) => allow.indexOf(v) >= 0).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  sel.value = keepCur && allow.indexOf(keepCur) >= 0 ? keepCur : allow[0];
}

// 资金变动方向切换（存入/取出）：选中段主题色、未选中灰色，由 CSS 控制
function setCashSign(sign) {
  document.querySelectorAll('#c_sign_toggle .sign-opt').forEach((b) => b.classList.toggle('active', b.dataset.sign === sign));
}

// 按「是负债」+ 是否编辑态刷新表单的显隐与文案
function applyAcctKind() {
  const isLiab = acctIsLiab();
  const editing = !!acctEdit;
  // 正在换性质（子账户 ⇄ 负债）：余额原样搬过去，不能再叠加增减，故收起变动区
  const converting = editing && acctEdit.kind !== (isLiab ? 'liability' : 'cash');
  // 余额标签：新增=当前余额 / 编辑子账户=改为新余额 / 编辑负债=改为新欠款余额
  $('#c_amount_cap').textContent = !editing
    ? (isLiab ? '当前欠款余额' : '当前余额')
    : (isLiab ? '改为新欠款余额' : '改为新余额');
  // 变动区：编辑态一律提供 —— 子账户 = ± 存入/取出，负债 = ± 借入/还款；
  // 下方「说明」就是这一笔变动流水的备注。只有换性质时收起（那时余额是搬运而非增减）。
  const showDelta = editing && !converting;
  $('#c_delta_row').hidden = !showDelta;
  $('#c_adj_note_row').hidden = !showDelta;
  if (!showDelta) { $('#c_delta').value = ''; $('#c_adj_note').value = ''; }
  // 变动区文案随性质切换
  $('#c_delta_cap').textContent = isLiab ? '欠款变动' : '资金变动';
  $('#c_sign_toggle').setAttribute('aria-label', isLiab ? '借入或还款' : '存入或取出');
  $('#c_adj_note_cap').textContent = isLiab ? '说明（欠款变动备注，可选）' : '说明（资金变动备注，可选）';
  $('#c_adj_note').placeholder = isLiab ? '如 提前还款 / 周转借入' : '如 发工资 / 还信用卡';
  $('#cashTitle').textContent = (editing ? '编辑' : '添加') + (isLiab ? '负债' : '子账户');
  // 日常开销标记只对子账户有意义（负债不参与再平衡，无需该开关）
  const exclRow = $('#c_excluded_row');
  if (exclRow) exclRow.hidden = isLiab;
}

// 所属账户下拉：按最新来源列表重建
function renderAcctSourceOptions() {
  const sel = $('#c_source');
  sel.innerHTML = assetSources.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') || '<option value="">（请先添加账户）</option>';
}

// 把一条记录（或空=新增）填进统一表单；srcIdLocked>0 表示新增时锁定入口父账户（只读）
function fillAcctForm(kind, rec, srcIdLocked) {
  acctEdit = rec ? {
    kind, id: rec.id, name: rec.name || '', type: rec.type || '',
    currency: rec.currency || 'cny', amount: Number(rec.amount || 0),
    source_id: Number(rec.source_id || 0), note: rec.note || '',
    excluded: !!rec.excluded,
  } : null;
  const srcId = rec ? Number(rec.source_id || 0) : (Number(srcIdLocked) || 0);
  $('#c_is_liab').checked = kind === 'liability';
  // 负债没有「日常开销」概念，勾上「负债」时整行由 applyAcctKind 隐藏
  $('#c_excluded').checked = rec ? !!rec.excluded : false;
  $('#c_name').value = rec ? (rec.name || '') : '';
  // 编辑态带入已有余额：值等于原余额视为「未改动」，可直接改用 ± 资金
  $('#c_amount').value = rec ? round4(rec.amount) : '';
  $('#c_note').value = rec ? (rec.note || '') : '';
  $('#c_delta').value = '';
  $('#c_adj_note').value = ''; // 资金变动说明是逐笔交易的备注，每次打开清空，不残留脏数据
  setCashSign('in');
  // 所属账户：编辑与「从账户行进入的新增」都锁定只读；空状态全局入口才给下拉
  const fallback = srcId || (assetSources[0] ? assetSources[0].id : '');
  $('#c_source').value = assetSources.some((s) => String(s.id) === String(fallback)) ? fallback : '';
  const locked = !!rec || Number(srcIdLocked) > 0;
  const s = assetSources.find((x) => String(x.id) === String($('#c_source').value));
  $('#c_source_fix').value = s ? s.name : '—';
  $('#c_source_fix_row').hidden = !locked;
  $('#c_source_sel_row').hidden = locked;
  // 币种下拉：仅列所属账户已勾选币种（编辑态并入当前币种），随父账户选择联动
  renderAcctCurrencyOptions(Number($('#c_source').value) || 0, rec ? (rec.currency || 'cny') : '');
  applyAcctKind();
}

// 「是负债」复选框：切换即刷新表单（新增与编辑都可改）
const cIsLiabEl = $('#c_is_liab');
if (cIsLiabEl) cIsLiabEl.onchange = applyAcctKind;
// 父账户下拉变化（仅全局入口可改）：币种候选随已勾选币种联动
const cSrcEl = $('#c_source');
if (cSrcEl) cSrcEl.onchange = () => renderAcctCurrencyOptions(Number(cSrcEl.value) || 0, $('#c_currency').value);
async function openCashModal(id, presetSourceId) {
  await loadSourcesCache();
  renderAcctSourceOptions();
  let c = null;
  if (id) {
    // 编辑子账户：所属账户固定为操作按钮所在行，可改名称/类型/币种/备注与余额
    const r = await api('/api/asset/cash');
    if (r.ok) { const d = await r.json(); c = (d.cash || []).find((x) => x.id === id); }
  }
  $('#cashErr').textContent = '';
  fillAcctForm('cash', c, presetSourceId);
  $('#cashModal').hidden = false;
}
$('#cashForm').onsubmit = async (e) => {
  e.preventDefault();
  const isLiab = acctIsLiab();
  const kind = isLiab ? 'liability' : 'cash';
  const name = $('#c_name').value.trim();
  if (!name) { $('#cashErr').textContent = '名称不能为空'; return; }
  // 类型字段已移除（统一表单不再录入）；编辑时保留原记录的 type（存量数据不动），新增为空
  const type = acctEdit ? (acctEdit.type || '') : '';
  const currency = $('#c_currency').value || 'cny';
  const note = $('#c_note').value.trim();
  const amountRaw = $('#c_amount').value.trim();

  // ① 编辑时改了性质（子账户 ⇄ 负债）：两张表 id 空间独立，换表只能新建+删除，
  //    走后端安全转换（无流水、无收支计划引用才允许），失败时原样保留、不产生半成品。
  if (acctEdit && acctEdit.kind !== kind) {
    if (amountRaw === '' || isNaN(Number(amountRaw))) { $('#cashErr').textContent = '余额格式不正确'; return; }
    try {
      const r = await api('/api/asset/accounts/convert', { method: 'POST', body: JSON.stringify({
        kind: acctEdit.kind, id: acctEdit.id, name, type, currency, amount: round4(Number(amountRaw)), note,
      }) });
      if (!r.ok) { let m = '转换失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#cashErr').textContent = m; return; }
      $('#cashModal').hidden = true;
      await loadAsset();
      toast(kind === 'liability' ? '已转为负债' : '已转为子账户', 'ok');
    } catch (err) { $('#cashErr').textContent = '异常：' + err.message; }
    return;
  }

  // ② 编辑且性质未变：按原性质保存
  if (acctEdit) {
    if (kind === 'liability') {
      // 欠款余额：可直接改成新值，也可用 ± 借入/还款 做增量（两者只能填一个，与子账户一致）。
      // 「＋」= 借入（欠款增加）、「－」= 还款（欠款减少）。
      const deltaRaw = $('#c_delta').value.trim();
      const amtIsSet = amountRaw !== '' && Number(amountRaw) !== acctEdit.amount;
      if (amtIsSet && deltaRaw !== '') { $('#cashErr').textContent = '「改为新欠款余额」与「± 欠款变动」只能填一个'; return; }
      let newAmount = acctEdit.amount;
      if (amtIsSet) {
        if (amountRaw === '-' || isNaN(Number(amountRaw))) { $('#cashErr').textContent = '欠款余额格式不正确'; return; }
        newAmount = Number(amountRaw);
      } else if (deltaRaw !== '') {
        const amt = Math.abs(Number(deltaRaw));
        const sign = (document.querySelector('#c_sign_toggle .sign-opt.active') || {}).dataset?.sign || 'in';
        newAmount = acctEdit.amount + (sign === 'out' ? -amt : amt);
      }
      if (newAmount < 0) { $('#cashErr').textContent = '欠款余额不能为负（还款金额超过了当前欠款）'; return; }
      try {
        const r = await api('/api/asset/liabilities/' + acctEdit.id, { method: 'PUT', body: JSON.stringify({
          name, type, source_id: acctEdit.source_id,
          amount: round4(newAmount), currency, note,
          flow_note: $('#c_adj_note').value.trim(),
        }) });
        if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#cashErr').textContent = m; return; }
        $('#cashModal').hidden = true;
        await loadAsset();
        const diff = round4(newAmount - acctEdit.amount);
        const tail = diff > 0 ? '，欠款 +' + money(diff) : (diff < 0 ? '，欠款 -' + money(-diff) : '');
        toast('已更新负债' + tail, 'ok');
      } catch (err) { $('#cashErr').textContent = '异常：' + err.message; }
      return;
    }
    await submitCashEdit(name, type, currency, note, amountRaw, $('#c_excluded').checked);
    return;
  }

  // ③ 新增：子账户与负债共用同一套字段，只是落到不同的表
  // 子账户必须填余额；负债允许留空（新建信用卡/待确认负债可先记 0，之后再补）
  if (amountRaw === '' && kind !== 'liability') { $('#cashErr').textContent = '余额不能为空'; return; }
  const payload = {
    name, type, currency, note,
    amount: round4(Number(amountRaw || 0)),
    source_id: Number($('#c_source').value) || 0,
    excluded: !isLiab && $('#c_excluded').checked,
  };
  try {
    let r;
    if (kind === 'cash') {
      r = await api('/api/asset/cash', { method: 'POST', body: JSON.stringify(payload) });
    } else {
      r = await api('/api/asset/liabilities', { method: 'POST', body: JSON.stringify(payload) });
    }
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#cashErr').textContent = m; return; }
    $('#cashModal').hidden = true;
    await loadAsset();
    toast(kind === 'liability' ? '已添加负债' : '已添加子账户', 'ok');
  } catch (err) { $('#cashErr').textContent = '异常：' + err.message; }
};

// 编辑子账户：名称/类型/币种/备注走全量 PUT；余额支持「改为新余额」（自动折算 delta）或「± 资金」增量
async function submitCashEdit(name, type, currency, note, amountRaw, excluded) {
  const deltaRaw = $('#c_delta').value.trim();
  // 预填原余额后：值等于原余额视为「未改动」，不算有效输入，方便直接用 ± 资金
  const amtIsSet = amountRaw !== '' && Number(amountRaw) !== acctEdit.amount;
  if (amtIsSet && deltaRaw !== '') { $('#cashErr').textContent = '「改为新余额」与「± 资金」只能填一个'; return; }
  let delta = 0;
  if (deltaRaw !== '') {
    const amt = Math.abs(Number(deltaRaw));
    const sign = (document.querySelector('#c_sign_toggle .sign-opt.active') || {}).dataset?.sign || 'in';
    delta = Math.round((sign === 'out' ? -amt : amt) * 100) / 100;
  }
  let deltaVia = 'delta'; // 记录用哪种方式改的余额（提示文案用）
  if (amtIsSet) {
    if (amountRaw === '-' || isNaN(Number(amountRaw))) { $('#cashErr').textContent = '新余额格式不正确'; return; }
    delta = Math.round((Number(amountRaw) - acctEdit.amount) * 100) / 100;
    deltaVia = 'set';
  }
  const nameChanged = name !== (acctEdit.name || '');
  const curChanged = currency !== acctEdit.currency; // 只改币种、余额不变也要能保存
  const typeChanged = type !== (acctEdit.type || '');
  const noteChanged = note !== (acctEdit.note || '');
  const exclChanged = !!excluded !== !!acctEdit.excluded; // 只改「日常开销」标记也要能保存
  if (!nameChanged && !curChanged && !typeChanged && !noteChanged && !exclChanged && !delta) { $('#cashErr').textContent = '没有需要保存的修改（修改名称/货币/类型/备注/日常开销标记、改新余额或填写 ± 资金）'; return; }
  try {
    if (nameChanged || curChanged || typeChanged || noteChanged || exclChanged) {
      // 全量 PUT：未展示的字段回传原值；amount 传原值，余额变动由下方 adjust 增量处理
      const rp = await api('/api/asset/cash/' + acctEdit.id, { method: 'PUT', body: JSON.stringify({
        name, currency, type, note, amount: acctEdit.amount,
        source_id: acctEdit.source_id, excluded: !!excluded,
      }) });
      if (!rp.ok) { let m = '保存失败'; try { const d = await rp.json(); if (d && d.error) m = d.error; } catch (_) {} $('#cashErr').textContent = m; return; }
    }
    if (delta) {
      // 流水备注：用户填写优先；「改为新余额」方式未填时标注；都为空则后端兜底「手工存入/手工取出」
      const adjNote = $('#c_adj_note').value.trim();
      let n = adjNote;
      if (!n && deltaVia === 'set') n = '改为新余额';
      const r = await api('/api/asset/cash/adjust', { method: 'POST', body: JSON.stringify({ cash_id: acctEdit.id, delta, note: n }) });
      if (!r.ok) { let m = '资金调整失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#cashErr').textContent = m; return; }
    }
    $('#cashModal').hidden = true;
    await loadAsset();
    const balTxt = deltaVia === 'set' ? '余额已改为新值' : (delta > 0 ? '已存入现金' : '已取出现金');
    const metaChanged = nameChanged || curChanged || typeChanged || noteChanged || exclChanged;
    toast(metaChanged && delta ? '已更新资料，' + balTxt : (metaChanged ? '已更新子账户资料' : balTxt), 'ok');
  } catch (err) { $('#cashErr').textContent = '异常：' + err.message; }
}

// ---------------- 添加流水（选任意子账户，按父账户折叠分组） ----------------
// 子账户显示标签：父账户·子账户（币种余额）
function flowCashLabel(c) {
  const cur = c.currency === 'usd' ? '＄' : (c.currency === 'hkd' ? 'HK＄' : '¥');
  const src = (assetSources || []).find((s) => Number(s.id) === Number(c.source_id));
  const prefix = src ? src.name + ' · ' : '';
  return `${prefix}${c.name}（${cur}${fmt(c.amount || 0)}）`;
}
// ===== 账户下拉搜索（所有 .ac-picker-panel 共用）=====
// 面板内容统一经 setPickerHTML 注入：顶部加一条 sticky 搜索框，输入即按账户名过滤，
// 免去账户多时逐组展开翻找。过滤只改 DOM 的 hidden，不重建节点，选中态不受影响。
function pickSearchHTML() {
  return '<div class="ac-pick-search-wrap">' +
    '<svg class="ac-pick-search-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.58-3.58"/></svg>' +
    '<input type="text" class="ac-pick-search" placeholder="搜索账户" autocomplete="off" spellcheck="false" aria-label="搜索账户">' +
    '</div>';
}
// bodyHTML 无分组（即空态提示）时不加搜索框，避免对着「暂无账户」还让用户搜
function setPickerHTML(panel, bodyHTML) {
  if (!panel) return;
  if (!bodyHTML || bodyHTML.indexOf('ac-pick-group') < 0) { panel.innerHTML = bodyHTML || ''; return; }
  panel.innerHTML = pickSearchHTML() + bodyHTML + '<div class="ac-picker-empty ac-pick-none ac-hide">没有匹配的账户</div>';
}
// 过滤：账户名命中→保留该行；分组名命中→该组全部保留。
// 注意不能用 hidden 属性：.ac-pick-row / .ac-pick-body 都是 display:flex（作者样式压过
// UA 的 [hidden]{display:none}，本项目老坑），必须走 .ac-hide 类。
function filterPickPanel(inp) {
  const panel = inp.closest('.ac-picker-panel');
  if (!panel) return;
  const q = (inp.value || '').trim().toLowerCase();
  let shown = 0;
  panel.querySelectorAll('.ac-pick-group').forEach((g) => {
    const head = g.querySelector('.ac-pick-head');
    const headHit = !!q && !!head && head.textContent.toLowerCase().indexOf(q) >= 0;
    let rows = 0;
    g.querySelectorAll('.ac-pick-row').forEach((r) => {
      const ok = !q || headHit || r.textContent.toLowerCase().indexOf(q) >= 0;
      r.classList.toggle('ac-hide', !!q && !ok);
      if (q && ok) rows++;
    });
    const groupShow = !q || headHit || rows > 0;
    g.classList.toggle('ac-hide', !groupShow);
    if (groupShow) shown++;
  });
  const none = panel.querySelector('.ac-pick-none');
  if (none) none.classList.toggle('ac-hide', !q || shown > 0);
}
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t || !t.classList || !t.classList.contains('ac-pick-search')) return;
  filterPickPanel(t);
});
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t || !t.classList || !t.classList.contains('ac-pick-search')) return;
  // 选择器大多在 <form> 内：回车不能提交表单
  if (e.key === 'Enter') e.preventDefault();
});
// 有些面板是常驻节点（只切 hidden，不重渲染）：每次点开都把上次的关键字清掉，
// 免得下次打开还停在上次的过滤结果上。capture 阶段确保早于按钮自身的展开逻辑。
document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('.ac-picker-btn') : null;
  if (!btn) return;
  const panel = btn.parentElement ? btn.parentElement.querySelector('.ac-picker-panel') : null;
  if (!panel) return;
  const inp = panel.querySelector('.ac-pick-search');
  if (inp && inp.value) { inp.value = ''; filterPickPanel(inp); }
}, true);
// 折叠面板：每个父账户一组，点击表头展开/收起其子账户。
// libs = 负债账户列表（仅「添加流水」弹框传入，与现金账户合并进同一下拉；其余选择器不传=只列现金）。
// 注意：data-id 必须保持「原始账户 id」，其它选择器（持仓/理财/定投/划转/收支计划）都按它回查
// cashAccountsCache；负债 row 另带 data-kind="liab" 供「添加流水」用 kind+id 组合区分。
function buildFlowPicker(filterSourceId, filterCurrency, libs) {
  const accs = (cashAccountsCache || []).filter((c) => {
    if (filterSourceId != null && Number(c.source_id) !== Number(filterSourceId)) return false;
    if (filterCurrency && String(c.currency).toLowerCase() !== String(filterCurrency).toLowerCase()) return false;
    return true;
  });
  const liabList = (libs || []).filter((l) => {
    if (filterSourceId != null && Number(l.source_id) !== Number(filterSourceId)) return false;
    if (filterCurrency && String((l.currency || 'cny').toLowerCase()) !== String(filterCurrency).toLowerCase()) return false;
    return true;
  });
  const bySrc = {};
  accs.forEach((c) => { const g = bySrc[c.source_id] = bySrc[c.source_id] || { cash: [], liab: [] }; g.cash.push(c); });
  liabList.forEach((l) => { const g = bySrc[l.source_id] = bySrc[l.source_id] || { cash: [], liab: [] }; g.liab.push(l); });
  const sources = (assetSources || []).filter((s) => bySrc[s.id]);
  if (!sources.length) return `<div class="ac-picker-empty">${filterSourceId == null ? '暂无账户，请先在「账户」中添加' : '该账户下暂无账户，请先在「账户」中添加'}</div>`;
  return sources.map((s) => {
    const g = bySrc[s.id];
    const cashRows = g.cash.map((c) => {
      const cur = c.currency === 'usd' ? '＄' : (c.currency === 'hkd' ? 'HK＄' : '¥');
      return `<button type="button" class="ac-pick-row" data-id="${c.id}" data-kind="cash">${esc(c.name)}<span class="ac-pick-bal">${cur}${fmt(c.amount || 0)}</span></button>`;
    }).join('');
    const liabRows = g.liab.map((l) => {
      const cur = curSymbolJS(l.currency || 'cny');
      return `<button type="button" class="ac-pick-row liab" data-id="${l.id}" data-kind="liab">${esc(l.name)}<span class="ac-pick-bal">${cur}${fmt(l.amount || 0)} 负债</span></button>`;
    }).join('');
    const cnt = g.cash.length + g.liab.length;
    return `<div class="ac-pick-group"><button type="button" class="ac-pick-head" data-src="${s.id}">${esc(s.name)}<span class="ac-pick-cnt">${cnt}</span><span class="ac-pick-chev">▾</span></button><div class="ac-pick-body" hidden>${cashRows}${liabRows}</div></div>`;
  }).join('');
}
// 解析下拉选中的账户（前缀 c:/l:）：返回 {kind:'cash'|'liab', obj} 或 null。
// 注意 m[1] 是单字母 c/l，不能拿去和 'liab' 比（曾因此选中负债账户静默无反应）。
function flowAccountById(prefixed) {
  const m = /^([cl]):(\d+)$/.exec(prefixed || '');
  if (!m) return null;
  const id = Number(m[2]);
  if (m[1] === 'l') {
    const l = (flowLibsCache || []).find((x) => Number(x.id) === id);
    return l ? { kind: 'liab', obj: l } : null;
  }
  const c = (cashAccountsCache || []).find((x) => Number(x.id) === id);
  return c ? { kind: 'cash', obj: c } : null;
}
function flowAccountLabel(kind, obj) {
  const src = (assetSources || []).find((s) => Number(s.id) === Number(obj.source_id));
  const prefix = src ? src.name + ' · ' : '';
  if (kind === 'liab') return `${prefix}${obj.name}（负债 ${curSymbolJS(obj.currency || 'cny')}${fmt(obj.amount || 0)}）`;
  return flowCashLabel(obj);
}
function selectFlowCash(id, label) {
  $('#flow_cash').value = id;
  $('#flowCashBtn').textContent = label || '请选择子账户';
  $('#flowCashPanel').hidden = true;
  syncFlowAccountUI(); // 负债账户隐藏「仅快照」「收支分类」
}
function flowSetSign(sign) {
  document.querySelectorAll('#flow_sign_toggle .sign-opt').forEach((b) => b.classList.toggle('active', b.dataset.sign === sign));
  const hid = document.getElementById('flow_sign');
  if (hid) hid.value = sign;
  renderFlowCatChips();
  syncFlowAccountUI();
}

// 根据所选账户类型同步弹框：负债账户无「仅快照」、也无「收支分类」（后端按 loan/repay 自动归类），
// 故选负债时隐藏这两行；现金账户始终显示。
function syncFlowAccountUI() {
  const a = flowAccountById($('#flow_cash').value);
  const isLiab = !!(a && a.kind === 'liab');
  const snapRow = document.getElementById('flowSnapRow');
  if (snapRow) snapRow.hidden = isLiab;
  const catRow = document.getElementById('flowCatRow');
  if (catRow) catRow.hidden = isLiab;
  const lbl = document.querySelector('#flowForm label[for="flow_delta"]');
  if (lbl) lbl.textContent = isLiab ? '借入 / 还款' : '资金变动';
}
// 收支分类 chips：按方向（存入=收入类 / 取出=支出类）渲染，默认选中第一项
function renderFlowCatChips() {
  const box = document.getElementById('flowCatChips');
  if (!box) return;
  const sign = (document.getElementById('flow_sign') || {}).value || 'in';
  const dir = sign === 'out' ? 'expense' : 'income';
  const opts = finCatOptions(dir);
  const cur = document.getElementById('flow_cat').value;
  const keep = opts.some((o) => o.key === cur) ? cur : (opts[0] ? opts[0].key : '');
  box.innerHTML = opts.map((o) =>
    `<button type="button" class="cat-opt${o.key === keep ? ' on' : ''}" data-v="${o.key}">${esc(o.label)}</button>`).join('');
  document.getElementById('flow_cat').value = keep;
  box.querySelectorAll('.cat-opt').forEach((b) => {
    b.onclick = () => {
      box.querySelectorAll('.cat-opt').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      document.getElementById('flow_cat').value = b.dataset.v;
    };
  });
}
function hideFlow() { const m = document.getElementById('flowModal'); if (m) m.hidden = true; }
async function openFlowModal(sign) {
  await loadSourcesCache();
  await loadCashAccounts();
  await loadCustomFlowCats();
  // 负债账户（与现金账户合并进同一下拉）
  let libs = ((assetData && assetData.liability) || {}).items || [];
  if (!libs.length) {
    try { const r = await api('/api/asset/liabilities'); if (r.ok) { const d = await r.json(); libs = d && Array.isArray(d.liabilities) ? d.liabilities : []; } } catch (_) {}
  }
  flowLibsCache = libs || [];
  setPickerHTML($('#flowCashPanel'), buildFlowPicker(null, null, flowLibsCache));
  // 默认选中余额最大的现金子账户（与后端兜底口径一致；负债账户不作为默认）
  const acc = pickFallbackCash(cashAccountsCache);
  $('#flow_cash').value = acc ? 'c:' + acc.id : '0';
  $('#flowCashBtn').textContent = acc ? flowCashLabel(acc) : '请选择子账户';
  $('#flow_delta').value = '';
  $('#flow_note').value = '';
  $('#flow_cat').value = '';
  const fd = document.getElementById('flow_date');
  if (fd) fd.value = ''; // 留空 = 今天，由后端兜底
  $('#flowErr').textContent = '';
  const snapCb = document.getElementById('flow_snapshot');
  if (snapCb) snapCb.checked = false;
  flowSetSign(sign === 'out' ? 'out' : 'in');
  $('#flowModal').hidden = false;
}

// 还款到负债 picker 已移除：负债账户直接并入「子账户」下拉（前缀 l:），由后端按账户类型自动记。
$('#flowForm').onsubmit = async (e) => {
  e.preventDefault();
  const rawId = $('#flow_cash').value || '0';
  const pm = /^([cl]):(\d+)$/.exec(rawId);
  if (!pm) { $('#flowErr').textContent = '请选择子账户'; return; }
  const kind = pm[1], accId = Number(pm[2]);
  const amt = round4(Math.abs(Number($('#flow_delta').value || 0)));
  if (!amt) { $('#flowErr').textContent = '金额不能为空'; return; }
  const sign = (document.getElementById('flow_sign') || {}).value || 'in';
  const note = $('#flow_note').value.trim();
  const delta = round4((sign === 'out' ? -amt : amt));
  try {
    if (kind === 'l') {
      // 选中负债账户：后台按账户类型自动记 loan（借入/债务增）/ repay（还款/债务减）
      const r = await api('/api/asset/liability/adjust', { method: 'POST', body: JSON.stringify({ liability_id: accId, delta, note }) });
      if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#flowErr').textContent = m; return; }
      const d = await r.json();
      hideFlow();
      await loadAsset();
      toast(d && d.type === 'repay' ? '已还款至 ' + (d.liability || '负债') : '已借入 ' + (d.liability || '负债'), 'ok');
    } else {
      // 选中现金账户：手动调账（可勾选「仅快照」）
      const snapEl = document.getElementById('flow_snapshot');
      const snapshot = !!(snapEl && snapEl.checked);
      const category = document.getElementById('flow_cat').value || '';
      // 补录历史流水（截图识别出来的日期可能不是今天）；留空由后端按今天落
      const flowDate = (document.getElementById('flow_date') || {}).value || '';
      const r = await api('/api/asset/cash/adjust', { method: 'POST', body: JSON.stringify({ cash_id: accId, delta, note, category, snapshot, date: flowDate }) });
      if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#flowErr').textContent = m; return; }
      hideFlow();
      await loadAsset();
      toast(snapshot ? '已记录快照（不计入账户余额）' : (delta > 0 ? '已存入流水' : '已取出流水'), 'ok');
    }
  } catch (err) { $('#flowErr').textContent = '异常：' + err.message; }
};

// ---- 一键更新余额（资产页 · 账户 tab）----
// 弹框按来源分组列出所有现金子账户 + 负债账户，直接填「查到的真实余额」批量对账：
// 后端逐项 diff，现金差额记 manual_adjust 流水（标签「手动调整」），负债按 借入/还款 记流水并同步余额。
// 留空的输入框 = 不调整。流水页签里编辑/删除这些流水依旧联动余额（复用既有 updateFlow 链路）。
function bsRowHtml(kind, id, opts) {
  // kind: 'cash' | 'liab'；opts: {name, sub, cur, amount}
  const inputAttrs = kind === 'cash' ? `data-cash="${id}"` : `data-liab="${id}"`;
  const curCls = kind === 'liab' ? ' down' : '';
  return `<div class="bsync-row">
    <div class="bsync-info">
      <span class="bsync-name">${opts.name}</span>
      <span class="bsync-sub">${esc(opts.sub || '')}</span>
    </div>
    <span class="bsync-bal${curCls}" title="当前余额">${kind === 'liab' ? '-' : ''}${moneyCur(opts.amount || 0, opts.cur)}</span>
    <input class="bsync-input" type="number" step="0.01" ${inputAttrs} data-old="${opts.amount || 0}" placeholder="不变" inputmode="decimal" />
  </div>`;
}

async function openBalanceSyncModal() {
  await loadSourcesCache();
  await loadCashAccounts();
  // 负债列表：loadAsset 已随 overview 载入；直接进来（无缓存）时兜底拉一次接口
  let libs = ((assetData && assetData.liability) || {}).items || [];
  if (!libs.length) {
    try { const r = await api('/api/asset/liabilities'); if (r.ok) { const d = await r.json(); libs = d.liabilities || []; } } catch (_) {}
  }
  const srcName = (id) => ((assetSources || []).find((s) => Number(s.id) === Number(id)) || {}).name || '';
  const cashList = [...(cashAccountsCache || [])].sort((a, b) => (srcName(a.source_id) + a.name).localeCompare(srcName(b.source_id) + b.name, 'zh-Hans-CN'));
  const libList = [...(libs || [])].sort((a, b) => (srcName(a.source_id) + a.name).localeCompare(srcName(b.source_id) + b.name, 'zh-Hans-CN'));
  let html = '';
  // 现金子账户：按来源分组（与账户表分组口径一致），行内显示 币种符号 + 当前余额
  let lastSrc = null;
  cashList.forEach((c, i) => {
    const sid = Number(c.source_id);
    if (sid !== lastSrc) {
      lastSrc = sid;
      html += `<div class="bsync-grp">${esc(srcName(sid) || ('来源 #' + sid))}</div>`;
    }
    html += bsRowHtml('cash', c.id, {
      name: esc(c.name || ''),
      sub: (c.currency || '').toUpperCase(),
      cur: c.currency, amount: c.amount,
    });  });
  // 负债账户：单列一组，余额按欠款口径显示负数，填「还欠多少」（正值）
  if (libList.length) {
    html += `<div class="bsync-grp">负债</div>`;
    libList.forEach((l) => {
      html += bsRowHtml('liab', l.id, {
        name: esc(l.name || ''),
        sub: srcName(l.source_id),
        cur: l.currency, amount: l.amount,
      });
    });
  }
  if (!cashList.length && !libList.length) {
    html = '<p class="empty">暂无账户，先在账户页签添加。</p>';
  }
  $('#bsBody').innerHTML = html;
  $('#bs_note').value = '';
  $('#bsHint').textContent = '';
  $('#bsErr').textContent = '';
  // 输入即统计「将更新的账户数」，空值/与当前一致不计
  const syncHint = () => {
    let n = 0;
    document.querySelectorAll('#bsBody .bsync-input').forEach((inp) => {
      if (inp.value === '') return;
      const v = Number(inp.value);
      if (Number.isFinite(v) && Math.abs(v - Number(inp.dataset.old || 0)) >= 0.005) n++;
    });
    $('#bsHint').textContent = n ? `将更新 ${n} 个账户，各记 1 笔「手动调整」流水` : '';
  };
  document.querySelectorAll('#bsBody .bsync-input').forEach((inp) => { inp.oninput = syncHint; });
  $('#balanceSyncModal').hidden = false;
}
function hideBalanceSync() { const m = document.getElementById('balanceSyncModal'); if (m) m.hidden = true; }

$('#balanceSyncForm').onsubmit = async (e) => {
  e.preventDefault();
  const items = [];
  document.querySelectorAll('#bsBody [data-cash]').forEach((inp) => {
    if (inp.value === '') return;
    const v = Number(inp.value);
    if (!Number.isFinite(v)) return;
    items.push({ cash_id: Number(inp.dataset.cash), amount: round2(v) });
  });
  document.querySelectorAll('#bsBody [data-liab]').forEach((inp) => {
    if (inp.value === '') return;
    const v = Number(inp.value);
    if (!Number.isFinite(v)) return;
    items.push({ liability_id: Number(inp.dataset.liab), amount: round2(v) });
  });
  if (!items.length) { $('#bsErr').textContent = '没有填入任何余额（留空 = 不调整）'; return; }
  const submit = $('#bsSubmit');
  submit.disabled = true;
  try {
    const r = await api('/api/asset/balance/sync', { method: 'POST', body: JSON.stringify({ items, note: $('#bs_note').value.trim() }) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} $('#bsErr').textContent = m; return; }
    const d = await r.json();
    hideBalanceSync();
    await loadAsset();
    toast(d.changed ? `已更新 ${d.changed} 个账户，流水已记「手动调整」` : '余额无变化', 'ok');
  } catch (err) { $('#bsErr').textContent = '异常：' + err.message; }
  finally { submit.disabled = false; }
};
(() => {
  const m = document.getElementById('balanceSyncModal');
  if (!m) return;
  m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
  const c = document.getElementById('bsCancel');
  if (c) c.onclick = hideBalanceSync;
})();

let currentWealthHistId = 0;

// 理财每日盈亏弹框：全量快照（后端一次性返回，前端按时间范围过滤，零后端改动）
let wealthHistAllRows = [];
let wealthHistRange = 90;        // 30 / 90 / 0(全部) / 'custom'
let wealthHistShown = 500;       // 「全部」模式下已渲染条数（加载更多逐步追加）
let wealthHistCustomFrom = null, wealthHistCustomTo = null;
// 资金变动历史复用理财盈亏弹框：'wealth' = 理财每日盈亏；'cash' / 'liab' = 子账户/负债流水（无审计 tab）
let wealthHistMode = 'wealth';
let wealthHistKind = 'cash';
let wealthHistLiab = null;       // 负债流水渲染「变动后余额」需要币种
let wealthHistAuditMap = {};     // 审计并入每日盈亏：date → 该 date 最新一条审计记录（撤销/删除按钮来源）

// N 天前的日期字符串（YYYY-MM-DD，可直接字符串比较）
function ymdAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

// 按当前范围过滤全量快照（rows 已按 date ASC）
function filterWealthRows(rows) {
  if (wealthHistRange === 0) return rows;
  if (wealthHistRange === 'custom') {
    return rows.filter((r) => {
      if (wealthHistCustomFrom && r.date < wealthHistCustomFrom) return false;
      if (wealthHistCustomTo && r.date > wealthHistCustomTo) return false;
      return true;
    });
  }
  const cutoff = ymdAgo(wealthHistRange);
  return rows.filter((r) => r.date >= cutoff);
}

// 同步范围胶囊 active 态 + 自定义区间显隐
function syncWealthRangeBar() {
  const bar = $('#whRangeBar');
  if (bar) bar.querySelectorAll('button[data-range]').forEach((x) => {
    x.classList.toggle('active', x.dataset.range === String(wealthHistRange));
  });
  const row = $('#whCustomRow');
  if (row) row.hidden = wealthHistRange !== 'custom';
}

function renderWealthHistTable() {
  const body = $('#wealthHistTable');
  if (!body) return;
  // 子账户/负债流水复用本弹框：切到流水渲染（同样支持时间范围筛选，无审计操作列）
  if (wealthHistMode !== 'wealth') { renderFlowHistTable(body); return; }
  const filtered = filterWealthRows(wealthHistAllRows);
  if (!filtered.length) { body.innerHTML = '<p class="empty">所选范围内暂无录入记录。</p>'; return; }
  const LIMIT = 500;
  const isAll = wealthHistRange === 0;
  const view = (isAll && wealthHistShown < filtered.length) ? filtered.slice(0, wealthHistShown) : filtered;
  const hasMore = isAll && wealthHistShown < filtered.length;
  // 审计记录已并入本表：末列「操作」= 该 date 最新可撤销快照的 撤销 / 删除 按钮
  let html = '<table class="asset-table"><thead><tr><th>日期</th><th class="num">持仓金额</th><th class="num">净存入</th><th class="num">分红</th><th class="num">盈亏</th><th class="num">累计盈亏</th><th>操作</th></tr></thead><tbody>';
  for (const r2 of view) {
    const p = r2.pnl || 0, cum = r2.cum_pnl || 0;
    const a = wealthHistAuditMap[r2.date];
    let ops = '';
    ops += actBtn('edit', `data-edit-date="${r2.date}"`, '编辑该日持仓金额/净存入/分红');
    if (a && a.action !== 'undo') {
      ops += actBtn('undo', `data-undo="${a.id}"`, '撤销该操作并冲正子账户');
      if (a.action === 'upsert') ops += actBtn('del', `data-del-date="${a.date}"`, '删除该日快照', { danger: true });
    }
    const div = r2.dividend || 0;
    html += `<tr><td>${r2.date}</td><td class="num">${money(r2.amount || 0)}</td><td class="num">${money(r2.cashflow || 0)}</td>
      <td class="num ${div > 0 ? 'up' : ''}">${div > 0 ? '+' + money(div) : '—'}</td>
      <td class="num ${clsPnl(p)}">${pnlTxt(p)}</td><td class="num ${clsPnl(cum)}">${pnlTxt(cum)}</td>
      <td class="row-actions">${ops}</td></tr>`;
  }
  html += '</tbody></table>';
  if (hasMore) {
    html += `<div class="wh-more"><button id="whLoadMore" class="btn" type="button">加载更多（已显示 ${view.length} / 共 ${filtered.length} 条）</button></div>`;
  }
  body.innerHTML = html;
  bindWealthHistActions(body);
  const more = $('#whLoadMore');
  if (more) more.onclick = () => { wealthHistShown += LIMIT; renderWealthHistTable(); };
}

// 子账户/负债流水历史：复用理财盈亏弹框的表格体 + 时间范围筛选。
// 流水同样带 date 字段，filterWealthRows 按当前范围（近30/90天·全部·自定义）过滤即可。
// 末列「操作」= 回退（记一笔反向流水冲正余额，原流水保留，见 internal/api/flows.go rollbackFlow）；
// 「说明」列优先展示并放宽，表格可向右滑动查看操作列。已回退的流水不再提供按钮。
function renderFlowHistTable(body) {
  const filtered = filterWealthRows(wealthHistAllRows);
  if (!filtered.length) { body.innerHTML = '<p class="empty">所选范围内暂无资金变动记录。</p>'; return; }
  const rb = buildRolledBackSet(wealthHistAllRows);
  const opCell = (f) => {
    if (f.snapshot) return '<span class="u-muted">仅快照</span>';
    if (f.ref_type === 'rollback') return '<span class="u-muted">—</span>';
    if (isRolledBack(f, rb)) return '<span class="u-muted">已回退</span>';
    return actBtn('undo', `data-rollback="${f.id}"`, '回退该笔资金变动（记一笔反向流水冲正余额）');
  };
  if (wealthHistKind === 'liab') {
    // 负债：变动符号与余额同向（增加贷款=负、还款=正），额外展示「变动后余额」
    const l = wealthHistLiab || {};
    const liabBal = (v) => (v > 0 ? '-' : '') + moneyCur(Math.abs(v || 0), l.currency);
    let html = '<table class="asset-table flow-hist"><thead><tr><th>日期</th><th>类型</th><th class="num">变动</th><th class="num">变动后余额</th><th>说明</th><th>操作</th></tr></thead><tbody>';
    for (const f of filtered) {
      const isLoan = f.type === 'loan';
      html += `<tr><td>${esc(f.date)}</td><td><span class="adj-tag ${isLoan ? 'buy' : 'sell'}">${isLoan ? '增加贷款' : '还款'}</span></td>
        <td class="num ${isLoan ? 'down' : 'up'}">${isLoan ? '-' : '+'}${money(f.amount || 0)}</td>
        <td class="num down">${liabBal(f.balance)}</td><td class="note-cell" title="${esc(f.note || '')}">${esc(f.note || '')}</td>
        <td class="row-actions">${opCell(f)}</td></tr>`;
    }
    html += '</tbody></table>';
    body.innerHTML = html;
  } else {
    let html = '<table class="asset-table flow-hist"><thead><tr><th>日期</th><th>类型</th><th class="num">变动</th><th>说明</th><th>操作</th></tr></thead><tbody>';
    for (const f of filtered) {
      const amt = f.amount || 0;
      const note = esc(f.note || '');
      html += `<tr class="${f.snapshot ? 'snap-flow' : ''}"><td>${esc(f.date)}</td><td>${cashFlowTypeTag(f)}${flowSourceTag(f.source)}${flowSnapshotTag(f)}</td>
        <td class="num ${clsPnl(amt)}">${(amt >= 0 ? '+' : '')}${money(amt)}</td>
        <td class="note-cell" title="${note}">${note}</td>
        <td class="row-actions">${opCell(f)}</td></tr>`;
    }
    html += '</tbody></table>';
    body.innerHTML = html;
  }
  body.querySelectorAll('[data-rollback]').forEach((b) => {
    b.onclick = () => rollbackFlowRow(Number(b.dataset.rollback));
  });
}

// 判定一笔流水是否已回退：同列表中存在 ref_type='rollback'&ref_id=该ID 的反向流水（现金），
// 或存在 note 形如「回退：「<原note 或 流水#id>」」的反向流水（负债，其反向流水不写 ref_id）。
function buildRolledBackSet(rows) {
  const rb = new Set();
  for (const g of (rows || [])) {
    if (g.ref_type === 'rollback' && g.ref_id) rb.add(Number(g.ref_id));
    const m = (g.note || '').match(/^回退：「(.+)」$/);
    if (m) rb.add('note:' + m[1]);
  }
  return rb;
}
function isRolledBack(f, rb) {
  if (!f) return false;
  if (rb.has(Number(f.id))) return true;
  const label = (f.ref_name && f.ref_name !== '') ? f.ref_name : (f.note ? f.note : ('流水#' + f.id));
  return rb.has('note:' + label);
}

// 资金变动回退：复用后端 POST /api/asset/flows/:kind/:id/rollback（kind=cash|liability）
let flowHistCtx = null; // { kind, id } 供回退后原地刷新
async function rollbackFlowRow(id) {
  openConfirm({
    title: '回退该笔资金变动',
    msg: '将记一笔反向流水冲正账户余额，原记录保留（审计友好）。是否继续？',
    okText: '回退', danger: true,
    onOk: async () => {
      const kindParam = (wealthHistKind === 'liab') ? 'liability' : 'cash';
      try {
        const r = await api('/api/asset/flows/' + kindParam + '/' + id + '/rollback', { method: 'POST' });
        if (!r.ok) { let m = '回退失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
        toast('已回退该笔资金变动', 'ok');
        await reloadFlowHistory();
      } catch (err) { toast('异常：' + err.message, 'err'); }
    },
  });
}
async function reloadFlowHistory() {
  if (!flowHistCtx) return;
  const url = (flowHistCtx.kind === 'liab') ? ('/api/asset/liabilities/' + flowHistCtx.id + '/flows') : ('/api/asset/cash/' + flowHistCtx.id + '/flows');
  try {
    const r = await api(url);
    if (!r.ok) { toast('刷新失败 (HTTP ' + r.status + ')', 'err'); return; }
    const d = await r.json();
    wealthHistLiab = d.liability || null;
    wealthHistAllRows = d.flows || [];
    renderWealthHistTable();
  } catch (err) { toast('异常：' + err.message, 'err'); }
}

// 拉取每日盈亏 + 审计快照（合并为单表）。resetRange=true 重置为默认近90天（打开弹框用）；
// resetRange=false 保留当前范围与已加载条数（撤销/删除后原地刷新用）
async function loadWealthHistData(id, resetRange) {
  const [rh, ra] = await Promise.all([
    api('/api/asset/wealth/' + id + '/history'),
    api('/api/asset/wealth/' + id + '/audit'),
  ]);
  if (!rh.ok) { toast('加载失败 (HTTP ' + rh.status + ')', 'err'); return false; }
  const d = await rh.json();
  wealthHistAllRows = d.rows || [];
  let auditRows = [];
  if (ra.ok) { const da = await ra.json(); auditRows = da.rows || []; }
  buildWealthAuditMap(auditRows);
  if (resetRange) {
    wealthHistRange = 90; wealthHistShown = 500;
    wealthHistCustomFrom = null; wealthHistCustomTo = null;
    $('#whFrom').value = ''; $('#whTo').value = '';
  }
  return true;
}

// 撤销/删除后原地刷新（保留当前范围），不重开弹框、不重置范围
async function reloadWealthHist() {
  const ok = await loadWealthHistData(currentWealthHistId, false);
  if (!ok) return;
  syncWealthRangeBar();
  renderWealthHistTable();
}

async function openWealthHistory(id) {
  currentWealthHistId = id;
  wealthHistMode = 'wealth';
  try {
    // 标题：优先取理财名称
    let title = '理财每日盈亏';
    if (assetData && assetData.wealth && Array.isArray(assetData.wealth.products)) {
      const p = assetData.wealth.products.find((x) => x.id === id);
      if (p) title = (p.name || ('理财 #' + id)) + ' 每日盈亏';
    }
    $('#wealthHistTitle').textContent = title;
    $('#wealthHistModal').hidden = false;
    const ok = await loadWealthHistData(id, true);
    if (!ok) return;
    syncWealthRangeBar();
    renderWealthHistTable();
  } catch (err) { toast('异常：' + err.message, 'err'); }
}

// ---- 负债 ----
// 负债列表在「账户」tab 的子账户折叠行展示；新增/编辑走与子账户**同一套统一表单**，
// 靠弹框顶部的「负债」复选框区分（该复选框在编辑态也可改，改动即走后端安全转换）。

// 负债编辑：填进统一表单（新增负债统一从「＋子账户」入口勾选「是负债」进入）
async function openLiabilityModal(id, presetSourceId) {
  await loadSourcesCache();
  renderAcctSourceOptions();
  let l = null;
  if (id) {
    const r = await api('/api/asset/liabilities');
    if (r.ok) { const d = await r.json(); l = (d.liabilities || []).find((x) => x.id === id); }
  }
  $('#cashErr').textContent = '';
  if (l) {
    fillAcctForm('liability', l);
  } else {
    // 新增负债：所属账户锁定为入口父账户；无父账户上下文时沿用当前下拉选中项
    const srcLock = presetSourceId || Number($('#c_source').value) || (assetSources[0] ? assetSources[0].id : 0);
    fillAcctForm('liability', null, srcLock);
  }
  $('#cashModal').hidden = false;
}

// ---- 每日持仓金额录入（自动算每日盈亏） ----
// assetSnapBtn 已上移到首页顶部操作条（#wealthSnapBtn，绑定见文件上方「添加」按钮一段）

// ---- 通知渠道 / 设置页 ----
// 2026-10-18 重构：原「通知」卡片内「风险偏好 / 推送策略 / AI」三 tab 已拆为
// 系统设置页的语义分组（通知推送 / AI 配置 / 外观主题 / 收支分类），各面板常驻可见，
// 不再需要 tab 切换。风险偏好（资产类型标签）已移除设置页 UI（2026-10-22），
// 后端 /api/settings/asset_type_labels 仍保留并供持仓编辑多选 chip 使用。
// ---- 收支分类（自定义，P3）：与内置分类合并进选择器与统计 ----
function renderFinCatList() {
  const box = document.getElementById('finCatList');
  if (!box) return;
  const list = customFlowCats || [];
  box.innerHTML = list.length
    ? list.map((c, i) => `<div class="fincat-row" data-i="${i}">
        <input class="fincat-label" value="${esc(c.label || '')}" maxlength="12" placeholder="分类名称" />
        <select class="fincat-dir">
          <option value="expense"${(c.dir || 'expense') === 'expense' ? ' selected' : ''}>支出</option>
          <option value="income"${c.dir === 'income' ? ' selected' : ''}>收入</option>
        </select>
        <button type="button" class="btn btn-sm fin-cat-del" data-i="${i}" title="删除">删除</button>
      </div>`).join('')
    : '<div class="empty-hint">暂无自定义分类（内置分类已覆盖常见场景）</div>';
  box.querySelectorAll('.fin-cat-del').forEach((b) => {
    b.onclick = () => { customFlowCats.splice(Number(b.dataset.i), 1); renderFinCatList(); };
  });
}
async function loadFinCatSettings() {
  await loadCustomFlowCats();
  renderFinCatList();
}
(function bindFinCatSettings() {
  const addBtn = document.getElementById('finCatAddBtn');
  if (addBtn) addBtn.onclick = () => {
    const labelEl = document.getElementById('finCatNewLabel');
    const label = (labelEl.value || '').trim();
    if (!label) { toast('先填分类名称', 'err'); return; }
    const dir = document.getElementById('finCatNewDir').value || 'expense';
    customFlowCats.push({ key: 'c' + Date.now().toString(36), label, dir });
    labelEl.value = '';
    renderFinCatList();
  };
  const saveBtn = document.getElementById('finCatSaveBtn');
  if (saveBtn) saveBtn.onclick = async () => {
    // 从 DOM 收集行内最新编辑值（label 可改、方向可改）
    const box = document.getElementById('finCatList');
    if (box) {
      const out = [];
      box.querySelectorAll('.fincat-row').forEach((r) => {
        const i = Number(r.dataset.i);
        const src = (customFlowCats || [])[i];
        if (!src) return;
        const label = (r.querySelector('.fincat-label').value || '').trim();
        out.push({ key: src.key, label: label || src.label || src.key, dir: r.querySelector('.fincat-dir').value || 'expense' });
      });
      customFlowCats = out;
    }
    try {
      const r = await api('/api/settings/flow_categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: JSON.stringify(customFlowCats) })
      });
      if (r.ok) { toast('收支分类已保存', 'ok'); await loadCustomFlowCats(); renderFinCatList(); }
      else { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); }
    } catch (e) { toast('保存失败：' + e.message, 'err'); }
  };
})();

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
    const cf = d.cashflow_reminder || {};
    $('#cfReminderEnabled').checked = !!cf.enabled;
    $('#cfReminderHour').value = (typeof cf.hour === 'number') ? cf.hour : 7;
    $('#cfReminderMinute').value = (typeof cf.minute === 'number') ? cf.minute : 0;
  } catch (e) { /* 忽略，使用默认值 */ }
  refreshChannelCollapse(); // 折叠态跟随服务端启用状态：未启用的渠道默认收起
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
    cashflow_reminder: {
      enabled: $('#cfReminderEnabled').checked,
      hour: Math.max(0, Math.min(23, parseInt($('#cfReminderHour').value, 10) || 0)),
      minute: Math.max(0, Math.min(59, parseInt($('#cfReminderMinute').value, 10) || 0)),
    },
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
// 2026-10-18：钉钉/邮箱渠道改为可折叠分组（见 index.html .nt-channel）。
// 折叠态跟随启用状态：未启用 → 收起；勾选启用 → 展开；点标题栏可手动展开/收起
// （标题栏里点开关不触发折叠，避免与「启用」语义打架）。
function refreshChannelCollapse() {
  ['dt', 'em'].forEach((chan) => {
    const box = document.getElementById(chan === 'dt' ? 'dtChannel' : 'emChannel');
    if (!box) return;
    const sw = box.querySelector('input[type="checkbox"]');
    if (sw) box.classList.toggle('collapsed', !sw.checked);
  });
}
(function bindNotifyChannels() {
  ['dt', 'em'].forEach((chan) => {
    const box = document.getElementById(chan === 'dt' ? 'dtChannel' : 'emChannel');
    if (!box) return;
    const head = box.querySelector('.nt-chan-head');
    const sw = box.querySelector('input[type="checkbox"]');
    if (sw) sw.addEventListener('change', () => box.classList.toggle('collapsed', !sw.checked));
    if (head) head.addEventListener('click', (e) => {
      if (e.target.closest('.switch')) return; // 开关自行处理，不冒泡到标题栏
      box.classList.toggle('collapsed');
    });
  });
})();
// 2026-10-18：AI 配置等分组改为可折叠（默认收起，见 index.html .collapsible.collapsed）。
// 点标题栏切换 .collapsed；描述行与正文的显隐、箭头旋转由 CSS 处理。
(function bindSettingsCollapse() {
  document.querySelectorAll('#settingsView .settings-group.collapsible > .settings-group-title').forEach((title) => {
    title.addEventListener('click', () => {
      title.closest('.settings-group').classList.toggle('collapsed');
    });
  });
})();
// 2026-10-18：原「通知」卡片三 tab 已拆为设置页语义分组，tab 切换逻辑移除。

// 盈亏日历弹框的关闭/遮罩点击已在 openPnlModal 内绑定，此处无需重复

async function openSnapModal() {
  await loadAsset();
  await loadCashAccounts();
  // 与理财卡片列表保持相同顺序（按原币持仓金额从大到小）；
  // 已清仓停用（archived）的产品不参与持仓更新（取出：在②今日净存入填负数）
  const raw = ((assetData.wealth || {}).products || []).filter((p) => !p.archived);
  const w = [...raw].sort((a, b) => Number(b.amount) - Number(a.amount));
  if (!w.length) { toast('请先在「理财」里添加一个产品', 'err'); return; }
  const today = ymd(new Date());
  const body = $('#snapBody');
  // 按来源（银行 / 账户）分组：同一家机构的产品收进同一个框，逐行录入时便于对照。
  // 分组只加一层外壳，.snap-row 结构保持不变 —— #snapSave 的 querySelectorAll('.snap-row')
  // 与 snapCfSync 的 closest('.snap-row') 都不依赖层级，能继续跨组正确采集。
  const groups = [];
  const gmap = new Map();
  w.forEach((p) => {
    const key = p.source_id ? 's' + p.source_id : 'other';
    let g = gmap.get(key);
    if (!g) { g = { name: p.source_name || '未归属账户', items: [] }; gmap.set(key, g); groups.push(g); }
    g.items.push(p);
  });
  // 组序按组内首行（即该组金额最大的一笔）从大到小，组内沿用原金额序，整体阅读顺序与改动前一致
  groups.sort((a, b) => Number(b.items[0].amount || 0) - Number(a.items[0].amount || 0));
  const rowHtml = (p) => {
    const amount = Number(p.amount || 0);
    // 今日已录净存入（绝对值语义，data-cf0 仅用于提交时合成累计值，不在输入框回显）。
    // 输入框每次打开归零：填的是「本次资金变动」（正数存入 / 负数取出），提交时加上已录值合成今日累计 —— 避免带入上次输入造成误改。
    const cfToday = Number(p.cashflow_today || 0);
    // 建仓态：首次新增 或 清仓后重建（持仓金额=0）。此类产品今日持仓全部来自净存入，
    // 首日盈亏应计为 0 —— 故「今日持仓金额」由「今日净存入」派生且禁用，避免二者脱节产生 Phantom 盈亏；
    // 且今日净存入一旦录入（cfToday>0）即锁定，今日不可再填（防止重复建仓）。
    const opening = amount <= 0.005;
    const cfLocked = opening && cfToday > 0.005;
    const amtAttrs = `type="number" step="0.01" min="0" class="sr-amt" id="amt-${p.id}" data-id="${p.id}" data-cur="${p.currency || 'cny'}" data-base="${round2(amount)}" data-cf0="${cfToday}" value="${round2(amount)}"`;
    const amtOninput = opening ? '' : ' oninput="clampDecimals(this,2);this.dataset.touched=1"';
    const amtTitle = opening ? ' title="建仓态自动等于今日净存入，无需手动填（首日盈亏计为 0）"' : '';
    const amtPlaceholder = opening ? '自动＝今日净存入' : '今天收盘后的总市值';
    const cfMin = opening ? ' min="0"' : '';
    const cfAttrs = `type="number" step="0.01"${cfMin} class="sr-cf" id="cf-${p.id}" data-id="${p.id}" value="0"`;
    const cfOninput = cfLocked ? '' : ' oninput="clampDecimals(this,2);snapCfSync(this)"';
    const cfTitle = cfLocked
      ? '今日已录入建仓净存入，今日不可再填；如需调整请到该理财「每日盈亏 → 审计记录」撤销'
      : (opening
        ? '建仓/重建投入金额：持仓金额会自动等于此值（首日盈亏计为 0）'
        : '本次资金变动：正数=存入（自动从同来源同币种余额最大子账户扣款），负数=取出（回款自动入账该子账户）；每次打开弹框从 0 开始');
    const cfPlaceholder = cfLocked ? '已锁定（今日已建仓）' : (opening ? '建仓/重建投入金额' : '正数=存入，负数=取出');
    const amtLabel = opening ? '① 今日持仓金额（＝净存入）' : '① 今日持仓金额';
    const cfLabel = cfLocked ? '② 今日净存入（已锁定）' : '② 今日净存入';
    const openHint = opening
      ? `<small class="sr-open-hint">${cfLocked ? '今日已建仓，净存入已锁定' : '建仓态：持仓金额自动等于净存入，首日盈亏计 0'}</small>` : '';
    return `
    <div class="snap-row">
      <div class="sr-name">${esc(p.name)} <span class="cur-badge">${curSymbolJS(p.currency)}</span><small>上次持仓 ${moneyCur(p.amount || 0, p.currency)}${cfToday ? `｜今日已录净存入 ${cfToday > 0 ? '+' : ''}${moneyCur(cfToday, p.currency)}` : ''}</small>${openHint}</div>
      <div class="sr-fields">
        <div class="sr-field">
          <label class="sr-label" for="amt-${p.id}">${amtLabel} ${curSymbolJS(p.currency)}</label>
          <input ${amtAttrs}${opening ? ' disabled' : ''}${amtOninput}${amtTitle} placeholder="${amtPlaceholder}">
        </div>
        <div class="sr-field">
          <label class="sr-label" for="cf-${p.id}">${cfLabel} ${curSymbolJS(p.currency)}</label>
          <input ${cfAttrs}${cfLocked ? ' disabled' : ''}${cfOninput} placeholder="${cfPlaceholder}" title="${cfTitle}">
        </div>
        <div class="sr-field">
          <label class="sr-label" for="div-${p.id}">③ 今日分红 ${curSymbolJS(p.currency)}</label>
          <input type="number" step="0.01" min="0" class="sr-div" id="div-${p.id}" data-id="${p.id}" value="0" placeholder="现金分红填此（红利再投资填 0）" title="现金分红：净值因分红跳降，填此金额后今日盈亏不再误计为亏损；红利再投资份额增加、金额不变，留 0 即可">
        </div>
      </div>
    </div>`;
  };
  body.innerHTML = groups.map((g) => {
    // 单币种直接合计；多币种按人民币折算后也显示「合计」总额（不跨币种相加，仅给出整体市值参考）
    const curs = [...new Set(g.items.map((p) => p.currency || 'cny'))];
    const sum = curs.length === 1
      ? moneyCur(g.items.reduce((s, p) => s + Number(p.amount || 0), 0), curs[0])
      : moneyCur(g.items.reduce((s, p) => s + wCny(p, Number(p.amount || 0)), 0), 'cny');
    const sumLabel = '合计 ' + sum;
    return `<div class="snap-group">
      <div class="sg-head"><span class="sg-name">${esc(g.name)}</span><span class="sg-meta">${g.items.length} 款 ｜ ${sumLabel}</span></div>
      <div class="sg-body">${g.items.map(rowHtml).join('')}</div>
    </div>`;
  }).join('');
  $('#snapModal').dataset.date = today;
  $('#snapModal').hidden = false;
}

// 净存入联动持仓金额：输入框每次打开归零，填的是「本次资金变动」（正数存入 / 负数取出），
// 未手动改过持仓金额时，今日持仓 = 上次值 + 本次变动，避免「存入未计入持仓 → 今日盈亏把存入全额算成收益」
// （取出同理：回款不计入今日盈亏）；持仓一旦手动修改即停止联动。
// 资金账户不提供选择：存入扣款 / 取出入账均走后端 resolveCashAccount 自动回落
//（同来源、同币种、余额最大的子账户）。
function snapCfSync(input) {
  const row = input.closest('.snap-row');
  const amt = row && row.querySelector('.sr-amt');
  if (amt && !amt.dataset.touched) {
    const v = Number(amt.dataset.base || 0) + Number(input.value || 0);
    amt.value = round2(v);
  }
}
$('#snapSave').onclick = async () => {
  const date = $('#snapModal').dataset.date || ymd(new Date());
  const items = [];
  const diff = [];
  // 用 for...of 而非 forEach：校验失败时 return 需真正中止整个保存流程（forEach 回调 return 只跳过单行）
  for (const row of $('#snapBody').querySelectorAll('.snap-row')) {
    const amtInput = row.querySelector('.sr-amt');
    if (amtInput.value === '') continue;
    const id = Number(amtInput.dataset.id);
    const amount = Number(amtInput.value);
    // 输入框填的是「本次资金变动」（正数存入 / 负数取出）；提交时加上今日已录值，合成后端要求的今日累计绝对值
    const cfInput = Number(row.querySelector('.sr-cf').value || 0);
    const divInput = Number(row.querySelector('.sr-div').value || 0);
    const old = ((assetData.wealth || {}).products || []).find((p) => p.id === id);
    const oldAmt = old ? Number(old.amount || 0) : 0;
    const oldCf = old ? Number(old.cashflow_today || 0) : 0;   // 今日已录净存入（绝对值语义）
    const prevAmt = old ? Number(old.prev_amount || 0) : 0;    // 前一快照金额（盈亏预览基线）
    const opening = oldAmt <= 0.005;                            // 建仓态：净存入只允许正数（投入）
    if (cfInput < -0.005 && opening) {
      toast(`「${old ? old.name : ('#' + id)}」建仓态净存入不能为负`, 'err');
      return;
    }
    if (cfInput < -0.005 && Math.abs(cfInput) > oldAmt + 0.005) {
      toast(`「${old ? old.name : ('#' + id)}」取出金额超过当前持仓（上限 ${moneyCur(oldAmt, old ? old.currency : 'cny')}）`, 'err');
      return;
    }
    const cashflow = Math.round((oldCf + cfInput) * 100) / 100; // 今日累计净存入（提交值）
    const cfDelta = cfInput;                                     // 本次实际资金变动
    // 资金账户不选：传 0 由后端 resolveCashAccount 回落同来源、同币种、余额最大子账户
    const cashAccountID = 0;
    let cashName = '';
    if (Math.abs(cfDelta) >= 0.005) {
      // 账户去向（同来源同币种余额最大子账户）已在弹框顶部的说明里交代，行内只留方向 + 今日累计，
      // 避免这一列被长附注撑成两行、把 4 列表格挤歪
      cashName = (cfDelta > 0 ? '自动扣款' : '自动入账')
        + (cfDelta > 0
          ? (oldCf > 0.005 ? ` · 今日累计 +${moneyCur(cashflow, old.currency)}` : '')
          : (oldCf < -0.005 ? ` · 今日累计 ${moneyCur(cashflow, old.currency)}` : ''));
    }
    // 今日盈亏预览：新持仓 − 前一快照 − 今日累计净存入 + 今日分红（与后端口径一致；负净存入天然不计入今日盈亏）
    const pnlPreview = Math.round((amount - prevAmt - cashflow + divInput) * 100) / 100;
    // 只提交有变化的行：金额与上次不同，或本次有资金变动（存入或取出）。
    // 未变化的行不进 items —— 避免整批保存时把未编辑的产品也 upsert+写审计（产生「旧值空→新值」冗余审计记录）。
    if (Math.abs(amount - oldAmt) > 0.005 || Math.abs(cfDelta) >= 0.005 || Math.abs(divInput) >= 0.005) {
      items.push({ wealth_id: id, amount, cashflow, dividend: divInput, cash_account_id: cashAccountID });
      diff.push({ name: old ? old.name : ('#' + id), currency: old ? old.currency : 'cny', oldAmt, amount, cfInput, cashflow, divInput, pnl: pnlPreview, cashName });
    }
  }
  if (!items.length) { toast('数值未变化，无需保存', 'err'); return; }
  renderSnapConfirm(date, diff, items);
};

let pendingSnapSave = null;
function renderSnapConfirm(date, diff, items) {
  pendingSnapSave = { date, items };
  const body = $('#snapConfirmBody');
  body.innerHTML = `<p class="snap-hint">请核对以下 ${diff.length} 项的本次资金变动与今日盈亏预览，确认无误后保存。净存入正数=存入（自动从同来源同币种余额最大子账户扣款），负数=取出（回款自动入账该子账户）；保存后若录错，可到该理财「每日盈亏 → 审计记录」里一键撤销或删除。</p>
    <table class="asset-table"><thead><tr><th>理财</th><th class="num">本次净存入</th><th class="num">今日分红</th><th class="num">今日盈亏（预览）</th></tr></thead><tbody>
    ${diff.map((d) => `<tr><td>${esc(d.name)}</td><td class="num ${d.cfInput >= 0 ? 'up' : 'down'}">${d.cfInput >= 0 ? '+' : ''}${moneyCur(d.cfInput, d.currency)}${d.cashName ? `<div class="snap-cash-note">${esc(d.cashName)}</div>` : ''}</td><td class="num">${d.divInput > 0 ? '+' : ''}${moneyCur(d.divInput, d.currency)}</td><td class="num ${clsPnl(d.pnl)}">${d.pnl >= 0 ? '+' : ''}${moneyCur(d.pnl, d.currency)}</td></tr>`).join('')}
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

// ── 技术分析 ──────────────────────────────────────────
let analysisGenId = 0; // 防止并发打开时旧请求覆盖新请求渲染

async function openAnalysis(id) {
  const myGen = ++analysisGenId;
  const modal = $('#analysisModal');
  const body = $('#analysisBody');
  // 打开即重置标题与时间，避免残留上一次标的的信息
  $('#analysisTitle').textContent = '技术分析（加载中…）';
  const tsPre = document.getElementById('analysisTime');
  if (tsPre) tsPre.textContent = '';
  body.innerHTML = '<div class="analysis-loading"><span class="ana-spinner" aria-hidden="true"></span> 正在获取技术分析数据…</div>';
  modal.hidden = false;
  try {
    const r = await api('/api/holdings/' + id + '/analysis');
    if (myGen !== analysisGenId) return; // 已有更新的请求，放弃本次渲染
    if (!r.ok) {
      let msg = '获取技术分析失败 (HTTP ' + r.status + ')';
      try { const e = await r.json(); if (e.error) msg += '：' + e.error; } catch (_) {}
      $('#analysisTitle').textContent = '技术分析';
      body.innerHTML = '<div class="analysis-err">' + msg + '</div>';
      return;
    }
    const d = await r.json();
    if (myGen !== analysisGenId) return;
    const a = d.analysis;
    if (a.error) {
      $('#analysisTitle').textContent = '技术分析';
      body.innerHTML = '<div class="analysis-err">' + a.error + '</div>';
      return;
    }
    // 基金：仅当后端未返回指标（未关联股票代码/数据不足）时才提示不支持；
    // 有关联代码且分析成功的基金应正常渲染。
    if (isFund(a) && !(a.series && a.series.length)) {
      $('#analysisTitle').textContent = '技术分析';
      body.innerHTML = '<div class="analysis-err">该基金未设置关联股票代码，不支持技术分析</div>';
      return;
    }
    // 标题固定为「技术分析」；标的名称已置于 K 线卡片右上角
    $('#analysisTitle').textContent = '技术分析';
    renderAnalysis(a);
    const tsEl = document.getElementById('analysisTime');
    if (tsEl) tsEl.textContent = (a.market ? a.market + ' · ' : '') + '周期 1d · 数据截至 ' + (a.generated_at || '—');
  } catch (e) {
    if (myGen !== analysisGenId) return;
    $('#analysisTitle').textContent = '技术分析';
    body.innerHTML = '<div class="analysis-err">异常：' + e.message + '</div>';
  }
}

// 迷你K线（纯SVG蜡烛图，使用分析接口返回的已有日K线数据组装）
// patMap: { [date]: [{name, dir}] } —— 命中形态的日期→形态列表，用于悬停提示（不在蜡烛上加外边框）
// 缩放：zoom 越大可见根数越少、蜡烛越大（1×=全部；上限约 12 根），拖拽平移翻页（右拖看更早 / 左拖看更近）
let klState = null; // { bars, patMap, name, zoom, zoomMax, win, pages, page }
const KL_W = 600;   // 主图 viewBox 宽（klRenderWindow / crosshair 定位共用）
const KL_SUB_H = 44; // 副图指标 viewBox 高（MACD/KDJ/BOLL/RSI 共用）
// 副图指标下拉切换（默认 MACD）：KDJ(9,3,3)/BOLL(20,2)/RSI(14)/VOL 均由窗口内日K线前端实时计算。
// VOL 原为独立成交量块（2026-10-18 合并进本下拉，副图区只保留一个指标位）。
const KL_SUB_INDS = [
  { v: 'macd', lbl: 'MACD' },
  { v: 'kdj', lbl: 'KDJ' },
  { v: 'boll', lbl: 'BOLL' },
  { v: 'rsi', lbl: 'RSI' },
  { v: 'vol', lbl: 'VOL' },
];
let klInd = 'macd';  // 当前副图指标（klineMiniHTML 每次打开重置为默认）
let klDragMoved = false; // 拖拽平移后抑制紧随的 click，避免误触钉子态 tooltip
let klDragAt = 0;       // 最近一次拖拽结束时间戳（click 吞的时间窗判断）
// bars: 日K线序列；patMap: 九转标号 { [date]: [{type, seq}] }；name: 标的名称（渲染到卡片头行右上角）
const KL_MAX_BARS = 260; // 迷你K线上限：最近约 1 年交易日（与后端 analysisSeriesCap 口径一致）
function klineMiniHTML(bars, patMap, name) {
  // 万根长历史（上市二三十年的 A 股）会让缩放档数达 800+（滚轮永远到不了最大档切折线），
  // 且逐档重渲染上万根 SVG 蜡烛卡顿；迷你图定位是技术速览，只留最近约 1 年
  if (bars.length > KL_MAX_BARS) bars = bars.slice(-KL_MAX_BARS);
  const total = bars.length;
  const zMax = Math.max(1, Math.floor(total / 12)); // 最大放大档：仅约 12 根，单根即为清晰独立 K 线
  klState = { bars, patMap, name: name || '', zoom: 1, zoomMax: zMax, page: 0, win: total, pages: 1 };
  klInd = 'macd'; // 每次打开弹框重置为默认指标（下拉记住上次选择会跨越标的，不合理）
  return klRenderWindow();
}

// 当前窗口数据 + 几何（klRenderWindow 与副图重绘 klRenderSub 共用，避免两处各算一份）
function klWinGeo() {
  const { bars, page } = klState;
  const win = klState.win || Math.min(bars.length, 60);
  const end = bars.length - page * win;
  const data = bars.slice(Math.max(0, end - win), end);
  const n = data.length;
  const W = KL_W, H = 168, OX = 2, AXW = 0; // 取消右侧 Y 轴占位带，主图与副图共享全宽 x 轴（等宽对齐）
  const PW = W - OX - AXW;
  const step = PW / n;
  return { data, n, W, H, OX, AXW, PW, step, cw: Math.max(1.5, step * 0.62) };
}

// 渲染当前 klState.page 对应的窗口（窗口大小 = round(total/zoom)，拖拽平移/缩放时整块替换重绑）
function klRenderWindow() {
  const { bars, patMap, page } = klState;
  const total = bars.length;
  const win = Math.max(12, Math.min(total, Math.round(total / klState.zoom)));
  const pages = Math.max(1, Math.floor((total - win) / win) + 1);
  klState.win = win; klState.pages = pages;
  // 缩小（蜡烛变小、一屏塞进更多数据）到蜡烛不可读时自动切收盘折线，放大回可读根数即恢复蜡烛：
  // 按可见根数判定（阈值 100：约 100 根时蜡烛宽仅 ~4px，再密就只能看折线），用户双击仍可手动切换
  const lineMode = win > 100;
  const geo = klWinGeo();
  const data = geo.data;
  if (!data.length) return '';
  const n = geo.n;
  const { W, H, OX, AXW, PW, step, cw } = geo;
  let hi = -Infinity, lo = Infinity;
  data.forEach((b) => { if (b.High > hi) hi = b.High; if (b.Low < lo) lo = b.Low; });
  if (!(hi > lo)) { hi = lo + 1; }
  const pad = (hi - lo) * 0.08; hi += pad; lo -= pad;
  // 几何（W/H/OX/AXW/PW/step/cw）由 klWinGeo 统一给出：右侧 AXW 为 Y 轴刻度带，
  // 蜡烛/MA/虚线整体缩进 OX，副图与主图共享同一 x 轴缩放
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const up = 'kl-up', down = 'kl-down';
  // 压力位 / 支撑位：可视区间内极值（根据已有日K线数据组装，不新增条目）
  let res = -Infinity, sup = Infinity;
  data.forEach((b) => { if (b.High > res) res = b.High; if (b.Low < sup) sup = b.Low; });
  let body = '';
  // 压力位虚线（上）
  if (res > lo && res < hi) body += '<line x1="' + OX + '" y1="' + y(res).toFixed(2) + '" x2="' + (OX + PW) + '" y2="' + y(res).toFixed(2) + '" stroke="#f59e0b" stroke-width="0.9" stroke-dasharray="5 3"/>';
  // 支撑位虚线（下）
  if (sup > lo && sup < hi) body += '<line x1="' + OX + '" y1="' + y(sup).toFixed(2) + '" x2="' + (OX + PW) + '" y2="' + y(sup).toFixed(2) + '" stroke="#38bdf8" stroke-width="0.9" stroke-dasharray="5 3"/>';
  data.forEach((b, i) => {
    const x = OX + i * step + step / 2;
    const isUp = b.Close >= b.Open;
    const col = isUp ? up : down;
    const yO = y(b.Open), yC = y(b.Close);
    const top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yO - yC));
    const px = (x / W * 100).toFixed(2);
    const py = (yC / H * 100).toFixed(2);
    const td = (patMap && patMap[b.Date]) || [];
    const tdAttr = td.length ? ' data-td="' + td.map((t) => t.type + '~' + t.seq).join('|') + '"' : '';
    let mark = '';
    if (!lineMode && td.length) {
      const t = td[0]; // 每根K线最多一个九转标号
      const numColor = t.type === 'downside' ? 'kl-td-down' : 'kl-td-up'; // 下跌九转红，上涨九转绿
      const gap = 6;
      const numY = Math.max(12, y(b.High) - gap);
      const fontSize = t.seq === 9 ? 12 : 10; // 第9根放大
      const fontWeight = t.seq === 9 ? 'bold' : 'bold';
      mark = '<text class="kl-tdmark ' + numColor + '" x="' + x.toFixed(2) + '" y="' + numY.toFixed(2) + '" font-size="' + fontSize + '" font-weight="' + fontWeight + '" text-anchor="middle" dominant-baseline="bottom">' + t.seq + '</text>';
    }
    body += '<g class="kc" data-d="' + esc(b.Date) + '" data-c="' + b.Close.toFixed(2) + '" data-pc="' + (i > 0 ? data[i - 1].Close.toFixed(2) : '') + '" data-dir="' + (isUp ? 'up' : 'down') + '" data-px="' + px + '" data-py="' + py + '"' + tdAttr + '>';
    body += '<line class="kl-wick ' + col + '" x1="' + x.toFixed(2) + '" y1="' + y(b.High).toFixed(2) + '" x2="' + x.toFixed(2) + '" y2="' + y(b.Low).toFixed(2) + '" stroke-width="1"/>';
    body += '<rect class="kl-body ' + col + '" x="' + (x - cw / 2).toFixed(2) + '" y="' + top.toFixed(2) + '" width="' + cw.toFixed(2) + '" height="' + hgt.toFixed(2) + '"/>';
    body += '<rect class="kl-hit" x="' + (OX + i * step).toFixed(2) + '" y="0" width="' + step.toFixed(2) + '" height="' + H + '" fill="rgba(0,0,0,0)"/>';
    body += mark;
    body += '</g>';
  });
  // 收盘价折线（折线图模式显示，蜡烛图模式隐藏）：与蜡烛共享同一坐标缩放
  let linePts = '';
  data.forEach((b, i) => {
    linePts += (i ? ' ' : '') + (OX + i * step + step / 2).toFixed(2) + ',' + y(b.Close).toFixed(2);
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
      const x = (OX + i * step + step / 2).toFixed(2);
      const yv = y(avg).toFixed(2);
      pts += (pts ? ' ' : '') + x + ',' + yv;
    });
    if (pts) body += '<polyline points="' + pts + '" fill="none" stroke="' + ma.color + '" stroke-width="1.2" stroke-linejoin="round" opacity="0.75"/>';
  });

  // 副图指标（下拉切换，默认 MACD）：与主图共享 x 轴几何；klRenderSub 只换本体不动下拉框
  const sub = klSubChart(klInd, data, geo);

  const last = data[data.length - 1].Close;
  const yLast = y(last);
  body += '<line x1="' + OX + '" y1="' + yLast.toFixed(2) + '" x2="' + (OX + PW) + '" y2="' + yLast.toFixed(2) + '" stroke="#94a3b8" stroke-width="0.8" stroke-dasharray="3 3"/>';
  // 窗口日期区间（MM-DD~MM-DD），拖拽平移时随之更新
  const range = data[0].Date.slice(5).replace(/-/g, '/') + '~' + data[data.length - 1].Date.slice(5).replace(/-/g, '/');
  // 主图与副图共享全宽 x 轴（OX..OX+PW，无右侧 Y 轴占位带），保证 BOLL/KDJ 等副图指标与蜡烛图等宽对齐
  // crosshair 竖线：默认隐藏，悬停/钉住某列时由 bindKlineMini 定位
  body += '<line class="kl-crosshair" x1="0" y1="0" x2="0" y2="' + H + '" visibility="hidden"/>';
  // 缩放/模式切换已手势化（原 +/− 与「折线」按钮已删）：触屏双指捏合=缩放、
  // 双指轻点=蜡烛⇄折线；桌面 Ctrl/⌘+滚轮=缩放、双击=蜡烛⇄折线。
  // 手势反馈徽标（kl-zoom-tip）绝对定位于图表右上角，约 1s 后淡出。
  // 头部：指标下拉(左) + 标的名称与区间(右)；副图指标下拉切换（MACD/KDJ/BOLL/RSI/VOL），
  // 切换时 klRenderSub 只重绘 label/svg 与 meta 对应项，保留下拉焦点，不整块重渲染。
  const subOpts = KL_SUB_INDS.map((x) => '<option value="' + x.v + '"' + (x.v === klInd ? ' selected' : '') + '>' + x.lbl + '</option>').join('');
  const nameEsc = esc(klState.name || '');
  return '<div class="kline-mini' + (lineMode ? ' mode-line' : '') + '">'
    + '<div class="kl-head"><select class="kl-ind-sel" aria-label="切换副图指标">' + subOpts + '</select>'
    + '<span class="kl-name">' + (nameEsc ? nameEsc + ' ' : '') + '<span class="kl-range">' + range + '</span></span></div>'
    + '<div class="klwrap">'
    + '<div class="kl-label"><span class="kl-title">' + (lineMode ? '收盘折线' : '日K线') + '</span><span class="kl-ma1">MA5</span><span class="kl-ma2">MA10</span><span class="kl-ma3">MA20</span></div>'
    + '<span class="kl-zoom-tip" hidden></span>'
    + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + body + '</svg>'
    + '<div class="kline-mini-tip" hidden></div></div>'
    + '<div class="kl-sub"><span class="kl-sub-label">' + sub.label + '</span>'
    + '<svg viewBox="0 0 ' + W + ' ' + KL_SUB_H + '" preserveAspectRatio="none">' + sub.body + '</svg></div>'
    + '<div class="kline-mini-meta"><span class="kl-res">压力 ' + res.toFixed(2) + '</span><span class="kl-sup">支撑 ' + sup.toFixed(2) + '</span><span class="kl-sub-meta ' + sub.meta.cls + '">' + sub.meta.text + '</span><span class="' + (last >= data[0].Open ? 'up' : 'down') + '">最新 ' + last.toFixed(2) + '</span></div></div>';
}

// 窗口重渲染：整块替换后重绑交互（缩放 / 拖拽平移共用）
function klRerender() {
  const cur = document.querySelector('#analysisBody .kline-mini');
  if (!cur) return;
  const holder = document.createElement('div');
  holder.innerHTML = klRenderWindow();
  const fresh = holder.firstElementChild;
  if (!fresh) return;
  cur.replaceWith(fresh);
  bindKlineMini(fresh);
}
// 拖拽平移翻页：右拖=看更早、左拖=看更近；越界静默夹取（原左右箭头已删，见 klRenderWindow）
function klApplyPage(target) {
  if (!klState) return;
  const t = Math.max(0, Math.min(klState.pages - 1, target));
  if (t === klState.page) return;
  klState.page = t;
  klRerender();
}

// 副图指标计算与渲染（下拉切换，默认 MACD）：与主图共享 x 轴几何（step/cw/OX/PW 来自 klWinGeo）。
// MACD(12,26,9)=零轴红绿柱；KDJ(9,3,3)=K/D/J 三线 + 20/80 参考虚线；
// BOLL(20,2)=上/中/下三轨（色与主图压力/支撑虚线呼应）；RSI(14)=Wilder 平滑单线 + 30/50/70 参考虚线。
// 全部由窗口内日K线前端实时计算（后端指标表只出终值，不出序列），红涨绿跌。
function klSubChart(ind, data, geo) {
  const { step, cw, OX, PW } = geo;
  // 用完整日K序列 + 窗口左侧 LB 根预热，避免 BOLL/RSI/KDJ 在窗口左端出现空段（与主图蜡烛不对齐的留白）
  const bars = klState.bars;
  const win = klState.win;
  const page = klState.page;
  const end = bars.length - page * win;
  const start = Math.max(0, end - win);
  const LB = 30; // 预热长度：覆盖 MACD(26)/BOLL(20)/KDJ(9)/RSI(14) 的初始化
  const cs = Math.max(0, start - LB);
  klState.subCs = cs; // full[0] 对应的全局下标：tooltip 按 gi-cs 取该根K线的指标值
  const full = bars.slice(cs, end);
  const nFull = full.length;
  const k0 = start - cs; // 窗口首根在 full 中的下标
  const closes = full.map((b) => b.Close);
  const xOfK = (k) => OX + (k - k0) * step + step / 2; // full 下标 → 视图 x（仅 k>=k0 可见）
  // 折线工具：仅绘窗口可见部分（k>=k0），不足周期/预热段自动跳过；颜色/线宽按指标区分
  const lineFull = (arr, color, yv, w) => {
    let pts = '';
    arr.forEach((v, k) => { if (k < k0 || v == null) return; pts += (pts ? ' ' : '') + xOfK(k).toFixed(2) + ',' + yv(v).toFixed(2); });
    return pts ? '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="' + (w || 1.1) + '" stroke-linejoin="round" opacity="0.85"/>' : '';
  };
  const guides = (levels, yv) => levels.map((lv) =>
    '<line x1="' + OX + '" y1="' + yv(lv).toFixed(2) + '" x2="' + (OX + PW) + '" y2="' + yv(lv).toFixed(2) + '" stroke="#64748b" stroke-width="0.6" stroke-dasharray="4 3" opacity="0.35"/>').join('');
  if (ind === 'kdj') {
    // KDJ(9,3,3)：RSV=(C-L9)/(H9-L9)*100，K=(2K'+RSV)/3，D=(2D'+K)/3，J=3K-2D；K/D 初值 50
    let k = 50, d = 50;
    const K = [], D = [], J = [];
    for (let i = 0; i < nFull; i++) {
      let h9 = -Infinity, l9 = Infinity;
      for (let j = Math.max(0, i - 8); j <= i; j++) { if (full[j].High > h9) h9 = full[j].High; if (full[j].Low < l9) l9 = full[j].Low; }
      const rsv = h9 > l9 ? (closes[i] - l9) / (h9 - l9) * 100 : 50;
      k = (2 * k + rsv) / 3; d = (2 * d + k) / 3;
      K.push(k); D.push(d); J.push(3 * k - 2 * d);
    }
    const yv = (v) => KL_SUB_H - (Math.max(0, Math.min(100, v)) / 100) * KL_SUB_H; // J 可越界，显示时夹取
    const body = guides([20, 80], yv) + lineFull(J, '#94a3b8', yv) + lineFull(K, '#f59e0b', yv) + lineFull(D, '#a78bfa', yv);
    const j = J[nFull - 1];
    klState.subSeries = K.map((_, k) => ({ k: K[k], d: D[k], j: J[k] })); // tooltip 用：每根K线的 K/D/J
    return { label: 'KDJ(9,3,3)', body, meta: { text: 'KDJ J ' + j.toFixed(1), cls: j > 80 ? 'down' : j < 20 ? 'up' : 'neu' } };
  }
  if (ind === 'boll') {
    // BOLL(20,2)：中轨=MA20，上/下轨=中轨±2×标准差；纵轴按窗口内三轨极值归一
    const P = 20;
    const MID = [], UP = [], DN = [];
    for (let i = 0; i < nFull; i++) {
      if (i + 1 < P) { MID.push(null); UP.push(null); DN.push(null); continue; }
      let s = 0; for (let j = i - P + 1; j <= i; j++) s += closes[j];
      const mid = s / P;
      let sq = 0; for (let j = i - P + 1; j <= i; j++) sq += (closes[j] - mid) * (closes[j] - mid);
      const sd = Math.sqrt(sq / P);
      MID.push(mid); UP.push(mid + 2 * sd); DN.push(mid - 2 * sd);
    }
    let bLo = Infinity, bHi = -Infinity;
    for (let k = k0; k < nFull; k++) { if (UP[k] == null) continue; if (DN[k] < bLo) bLo = DN[k]; if (UP[k] > bHi) bHi = UP[k]; }
    if (!(bHi > bLo)) { bLo -= 1; bHi += 1; }
    const yb = (v) => KL_SUB_H - ((v - bLo) / (bHi - bLo)) * KL_SUB_H;
    const body = lineFull(UP, '#f59e0b', yb) + lineFull(MID, '#94a3b8', yb) + lineFull(DN, '#38bdf8', yb);
    const last = closes[nFull - 1], up = UP[nFull - 1], dn = DN[nFull - 1];
    const pos = (up != null && dn != null) ? (last - dn) / (up - dn) : 0.5;
    const posTxt = pos > 0.8 ? 'BOLL 上轨' : pos > 0.5 ? 'BOLL 中上轨' : pos > 0.2 ? 'BOLL 中下轨' : 'BOLL 下轨';
    klState.subSeries = MID.map((_, k) => (UP[k] == null ? null : { up: UP[k], mid: MID[k], dn: DN[k] })); // tooltip 用：上/中/下轨
    return { label: 'BOLL(20,2)', body, meta: { text: posTxt, cls: pos > 0.5 ? 'up' : 'down' } };
  }
  if (ind === 'rsi') {
    // RSI(14) Wilder 平滑：首段用 SMA 播种，之后 avg=(prev*13+cur)/14；与指标表 RSI(14) 同口径
    const P = 14;
    let ag = 0, al = 0;
    const RV = [];
    for (let i = 1; i < nFull; i++) {
      const ch = closes[i] - closes[i - 1];
      const g = Math.max(0, ch), l = Math.max(0, -ch);
      if (i <= P) { ag += g; al += l; if (i === P) RV[i] = al > 0 ? 100 - 100 / (1 + ag / al) : 100; }
      else { ag = (ag * (P - 1) + g) / P; al = (al * (P - 1) + l) / P; RV[i] = al > 0 ? 100 - 100 / (1 + ag / al) : 100; }
    }
    const yv = (v) => KL_SUB_H - (v / 100) * KL_SUB_H;
    const body = guides([30, 50, 70], yv) + lineFull(RV, '#a78bfa', yv, 1.2);
    const v = RV[nFull - 1];
    klState.subSeries = []; // RV 是稀疏数组（预热段未赋值），补齐为定长含 null 的序列供 tooltip 取值
    for (let k = 0; k < nFull; k++) klState.subSeries.push(RV[k] == null ? null : RV[k]);
    if (v == null) return { label: 'RSI(14)', body: '', meta: { text: 'RSI 数据不足', cls: 'neu' } };
    return { label: 'RSI(14)', body, meta: { text: v > 70 ? 'RSI 超买' : v < 30 ? 'RSI 超卖' : 'RSI ' + v.toFixed(0), cls: v > 70 ? 'down' : v < 30 ? 'up' : 'neu' } };
  }
  if (ind === 'vol') {
    // VOL 合并进副图区（2026-10-18 起，原独立成交量块删除）：柱色随当天涨跌，附 5 日均量线
    const H = KL_SUB_H;
    const vols = full.map((b) => (isFinite(b.Volume) ? b.Volume : 0));
    let vMax = 0; for (let k = k0; k < nFull; k++) { if (vols[k] > vMax) vMax = vols[k]; }
    if (!(vMax > 0)) vMax = 1;
    const vy = (v) => H - 2 - (v / vMax) * (H - 4);
    const upFill = 'var(--up)', downFill = 'var(--down)';
    let body = '';
    for (let k = k0; k < nFull; k++) {
      const x = xOfK(k);
      const col = full[k].Close >= full[k].Open ? upFill : downFill;
      const y0 = vy(vols[k]);
      body += '<rect x="' + (x - cw / 2).toFixed(2) + '" y="' + y0.toFixed(2) + '" width="' + cw.toFixed(2) + '" height="' + (H - y0).toFixed(2) + '" class="kl-bar ' + (col === upFill ? 'up' : 'down') + '" opacity="0.7"/>';
    }
    let vPts = '';
    for (let k = k0; k < nFull; k++) {
      if (k - k0 + 1 < 5) continue;
      let s = 0; for (let j = k - 4; j <= k; j++) s += vols[j];
      vPts += (vPts ? ' ' : '') + xOfK(k).toFixed(2) + ',' + vy(s / 5).toFixed(2);
    }
    if (vPts) body += '<polyline points="' + vPts + '" fill="none" stroke="#94a3b8" stroke-width="1" opacity="0.85"/>';
    klState.subSeries = vols.slice(); // tooltip 用：该根成交量
    return { label: 'VOL', body, meta: { text: 'VOL ' + fmtVol(vols[nFull - 1] || 0), cls: 'neu' } };
  }
  // 默认 MACD(12,26,9)：DIF=EMA12-EMA26，DEA=EMA9(DIF)，柱=2*(DIF-DEA)，零轴红涨绿跌
  const emaGen = (period) => { const kf = 2 / (period + 1); let prev = closes[0]; return closes.map((c) => (prev = c * kf + prev * (1 - kf))); };
  const e12 = emaGen(12), e26 = emaGen(26);
  const dif = closes.map((_, i) => e12[i] - e26[i]);
  let dprev = dif[0];
  const dea = dif.map((v) => (dprev = v * (2 / 10) + dprev * (8 / 10)));
  const hist = dif.map((v, i) => (v - dea[i]) * 2);
  let mAbs = 0; for (let k = k0; k < nFull; k++) { const a = Math.abs(hist[k]); if (a > mAbs) mAbs = a; }
  if (!(mAbs > 0)) mAbs = 1;
  const zeroY = KL_SUB_H / 2;
  let body = '<line x1="' + OX + '" y1="' + zeroY + '" x2="' + (OX + PW) + '" y2="' + zeroY + '" stroke="#64748b" stroke-width="0.8" opacity="0.5"/>';
  for (let k = k0; k < nFull; k++) {
    const h = Math.max(0.8, Math.abs(hist[k]) / mAbs * (KL_SUB_H / 2 - 2));
    const x = xOfK(k);
    body += '<rect x="' + (x - cw / 2).toFixed(2) + '" y="' + (zeroY - h).toFixed(2) + '" width="' + cw.toFixed(2) + '" height="' + h.toFixed(2) + '" class="kl-bar ' + (hist[k] >= 0 ? 'up' : 'down') + '" opacity="0.85"/>';
  }
  const lastH = hist[nFull - 1];
  klState.subSeries = dif.map((_, k) => ({ dif: dif[k], dea: dea[k], hist: hist[k] })); // tooltip 用：DIF/DEA/柱
  return { label: 'MACD(12,26,9)', body, meta: { text: 'MACD ' + lastH.toFixed(2), cls: lastH >= 0 ? 'up' : 'down' } };
}

// 副图指标切换：只重绘副图 label/svg 与底部 meta 对应项（下拉框本身不换，焦点不丢；
// 不整块重渲染——主图的钉住/悬停/翻页状态不会被清掉）
function klRenderSub() {
  const mini = document.querySelector('#analysisBody .kline-mini');
  if (!mini || !klState) return;
  const geo = klWinGeo();
  if (!geo.data.length) return;
  const sub = klSubChart(klInd, geo.data, geo);
  const box = mini.querySelector('.kl-sub');
  if (box) {
    const lab = box.querySelector('.kl-sub-label');
    if (lab) lab.textContent = sub.label;
    const svg = box.querySelector('svg');
    if (svg) svg.innerHTML = sub.body;
  }
  const metaEl = mini.querySelector('.kline-mini-meta .kl-sub-meta');
  if (metaEl) { metaEl.textContent = sub.meta.text; metaEl.className = 'kl-sub-meta ' + sub.meta.cls; }
}

// 选中K线时副图指标的当根数值（追加进 kline-mini-tip）：klSubChart 渲染时已缓存
// 与完整日K序列对齐的指标值（klState.subSeries，基准下标 subCs），按全局下标取该根数值
function klSubTipText(gi) {
  if (!klState || !klState.subSeries) return '';
  const k = gi - (klState.subCs || 0);
  const arr = klState.subSeries;
  if (k < 0 || k >= arr.length) return '';
  const v = arr[k];
  const label = (KL_SUB_INDS.find((x) => x.v === klInd) || {}).lbl || klInd;
  if (v == null) return '<div class="kl-tip-sub">' + label + ' —</div>';
  if (klInd === 'kdj') return '<div class="kl-tip-sub">KDJ K ' + v.k.toFixed(1) + ' / D ' + v.d.toFixed(1) + ' / J ' + v.j.toFixed(1) + '</div>';
  if (klInd === 'boll') return '<div class="kl-tip-sub">BOLL 上 ' + v.up.toFixed(2) + ' / 中 ' + v.mid.toFixed(2) + ' / 下 ' + v.dn.toFixed(2) + '</div>';
  if (klInd === 'rsi') return '<div class="kl-tip-sub">RSI ' + v.toFixed(1) + (v > 70 ? '（超买）' : v < 30 ? '（超卖）' : '') + '</div>';
  if (klInd === 'vol') return '<div class="kl-tip-sub">VOL ' + fmtVol(v) + '</div>';
  return '<div class="kl-tip-sub">MACD DIF ' + v.dif.toFixed(2) + ' / DEA ' + v.dea.toFixed(2) + ' / 柱 ' + v.hist.toFixed(2) + '</div>';
}

// 手势反馈徽标（缩放档位 / 模式名）：浮动在图表右上角，约 .9s 后淡出。
// 模块级而非 bind 闭包内——klZoom 会整块重渲染（徽标节点被替换），必须在重渲染后再取当前节点显示
function klShowTip(text) {
  const wrap = document.querySelector('#analysisBody .kline-mini .klwrap');
  const ztip = wrap && wrap.querySelector('.kl-zoom-tip');
  if (!ztip) return;
  ztip.textContent = text;
  ztip.hidden = false;
  ztip.classList.add('show');
  clearTimeout(ztip._kt);
  ztip._kt = setTimeout(() => { ztip.classList.remove('show'); ztip.hidden = true; }, 900);
}

// 缩放：调整每页K线数据量（1×=60根，手势在 1×~3× 间连续/分档切换）。
// 手势入口：触屏双指捏合（klPinch）与桌面 Ctrl/⌘+滚轮（klWheelZoom），越界静默夹取
function klZoom(delta) {
  if (!klState) return;
  klState.zoom = Math.min(klState.zoomMax, Math.max(1, klState.zoom + delta));
  klState.page = 0;
  klRerender();
  klShowTip(klState.win + ' 根'); // 重渲染后当前节点已是新的，此时显示才不会瞬间被替换掉
}

// 迷你K线交互：悬停预览 / 点击固定显示 日期+收盘价；再次点击或点空白取消。
// 缩放与蜡烛⇄折线切换均为手势（按钮已删）：双指捏合/Ctrl+滚轮=缩放，双击/双指轻点=切换模式
function bindKlineMini(root) {
  const wrap = root.querySelector('.klwrap');
  if (!wrap) return;
  // 副图指标下拉切换（MACD/KDJ/BOLL/RSI，默认 MACD）：只重绘副图本体，主图交互状态不丢
  const indSel = root.querySelector('.kl-ind-sel');
  if (indSel) indSel.addEventListener('change', () => { klInd = indSel.value; klRenderSub(); });
  const tip = wrap.querySelector('.kline-mini-tip');
  let pinned = null, hover = null, tipTimer = null;
  let downG = null; // pointerdown 时命中的蜡烛列：指针捕获后 click 的 target 会上移到 wrap，不能信 e.target
  // 蜡烛图 ⇄ 收盘折线切换（手势入口：双击 / 双指轻点）
  function toggleMode() {
    const mini = wrap.closest('.kline-mini');
    if (!mini) return;
    const line = mini.classList.toggle('mode-line');
    const title = wrap.querySelector('.kl-title');
    if (title) title.textContent = line ? '收盘折线' : '日K线';
    klShowTip(line ? '收盘折线' : '日K线');
    pinned = null; clearSel(); hideTip(); hover = null;
  }
  let lastPtrType = 'mouse'; // 触屏双击由部分浏览器模拟为 dblclick，仅鼠标响应该事件（触屏走双指轻点）
  wrap.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (lastPtrType !== 'mouse') return;
    toggleMode();
  });
  function showTip(g, stay) {
    const c = Number(g.dataset.c);
    let html = '<div class="kl-tip-d">' + esc(g.dataset.d) + '</div>';
    const pc = g.dataset.pc ? Number(g.dataset.pc) : 0;
    if (pc > 0) {
      const pct = (c - pc) / pc * 100;
      html += '<div class="kl-tip-c ' + (pct >= 0 ? 'up' : 'down') + '">涨跌幅 ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%</div>';
    }
    html += '<div class="kl-tip-c ' + g.dataset.dir + '">收盘 ' + c.toFixed(2) + '</div>';
    // 当根副图指标数值（BOLL 三轨 / RSI / KDJ / MACD / VOL，随下拉切换）：按日期定位全局下标取值
    const gi = klState ? klState.bars.findIndex((b) => b.Date === g.dataset.d) : -1;
    if (gi >= 0) html += klSubTipText(gi);
    const td = g.dataset.td;
    if (td) {
      td.split('|').forEach((seg) => {
        const parts = seg.split('~');
        const type = parts[0], seq = parts[1];
        const cls = type === 'downside' ? 'up' : 'down';
        const label = type === 'downside' ? '下跌九转' : '上涨九转';
        const note = seq === '9' ? ' ★反转信号' : '';
        html += '<div class="kl-tip-pat ' + cls + '">' + label + ' 第' + seq + '天' + note + '</div>';
      });
    }
    tip.innerHTML = html;
    tip.style.transform = 'none';
    tip.hidden = false;
    // 悬停态 3 秒后自动隐藏，避免遮挡 K 线；pin(点击钉住)态 stay=true 常驻
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    if (!stay) tipTimer = setTimeout(hideTip, 3000);
    // 以 SVG 本体为定位上下文：.klwrap 上方还有标签/工具行，用 wrap 高度会把 tooltip 纵向拉偏
    const svgBox = wrap.querySelector('svg');
    const wx = svgBox ? svgBox.getBoundingClientRect() : wrap.getBoundingClientRect();
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
  function hideTip() { if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; } tip.hidden = true; hover = null; setCrosshair(null); }
  function clearSel() { wrap.querySelectorAll('.kc.sel').forEach((x) => x.classList.remove('sel')); }
  // crosshair 竖线 + 悬停列高亮：竖线在 SVG 最顶层（CSS pointer-events:none，不挡命中）；
  // 列底色复用每列的 kl-hit 命中层（比选中态 .sel 的橙淡）
  const cross = wrap.querySelector('.kl-crosshair');
  function setCrosshair(g) {
    wrap.querySelectorAll('.kc.hov').forEach((x) => x.classList.remove('hov'));
    if (!g) { if (cross) cross.setAttribute('visibility', 'hidden'); return; }
    g.classList.add('hov');
    if (!cross) return;
    const xv = parseFloat(g.dataset.px) / 100 * KL_W; // data-px 是相对主图 viewBox 宽的百分比
    cross.setAttribute('x1', xv.toFixed(2));
    cross.setAttribute('x2', xv.toFixed(2));
    cross.setAttribute('visibility', 'visible');
  }
  wrap.addEventListener('mousemove', (e) => {
    if (pinned) return;
    const g = e.target.closest('.kc');
    if (g) { if (hover !== g.dataset.d) { showTip(g); hover = g.dataset.d; } setCrosshair(g); }
    else if (hover) { hideTip(); hover = null; }
  });
  wrap.addEventListener('click', (e) => {
    const g = downG; downG = null;
    if (klDragMoved) {
      klDragMoved = false;
      // 拖拽刚结束（含 UP 拖出图表边界的情况）：吞掉，不触发 pin
      if (performance.now() - klDragAt < 600) return;
    }
    if (!g) { pinned = null; clearSel(); hideTip(); hover = null; return; }
    if (pinned === g.dataset.d) { pinned = null; clearSel(); hideTip(); hover = null; }
    else { pinned = g.dataset.d; clearSel(); g.classList.add('sel'); showTip(g, true); hover = g.dataset.d; setCrosshair(g); }
  });
  // 原生拖拽会抢走 pointer 会话（dragstart → pointercancel，翻页监听全部失效）：
  // 九转数字等 SVG <text> 可选中，按下移动即触发 dragstart。dragstart 可 cancel
  // 且不影响 click 生成（保住点击钉住）；蓝色选区由 CSS user-select:none 兜底
  wrap.addEventListener('dragstart', (e) => e.preventDefault());
  // 指针会话（统一平移 / 捏合缩放 / 双指轻点）：
  //  · 单指（或鼠标）水平拖拽 = 平移翻页（右拖=更早、左拖=更近，每屏 1/4 为一页）
  //  · 双指捏合 = 缩放（1×~3×，松手时按捏合比例落档）
  //  · 双指轻点（双指按下即松开、几乎无位移）= 蜡烛⇄折线切换
  // 水平手势归图表（CSS touch-action: pan-y），垂直仍滚页面
  const ptrs = new Map(); // pointerId -> {x, y, t}
  let pan = null, pinch = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    lastPtrType = e.pointerType || 'mouse';
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (ptrs.size >= 2) {
      // 第二指落下：取消平移会话，转入捏合/轻点判定。
      // 注意顺序：endPan 会从 ptrs 删除平移指针，必须先删再解构，否则 b 为 undefined
      if (pan) endPan();
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: klState ? klState.zoom : 1, moved: false, t0: performance.now() };
      return;
    }
    downG = e.target.closest('.kc'); // 供 click 判定命中列（捕获后 e.target 不可信；须早于 pages 早退）
    if (!klState || klState.pages <= 1) return;
    // 指针捕获：移出 SVG 后 pointermove/up 仍送达本 wrap，拖拽不中断；cancel 时自动释放
    let pid = e.pointerId;
    try { wrap.setPointerCapture(pid); } catch (_) {}
    const startX = e.clientX, startPage = klState.page;
    klDragMoved = false;
    wrap.classList.add('kl-dragging');
    pan = { startX, startPage, pid };
    // window 监听必须跟随会话注册/注销（放在 bind 里会被首次 endPan 摘掉，之后拖拽全失效）；
    // 同时挂 pointercancel：浏览器接管手势（如原生 pinch）时也要收尾
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
  function endPan() {
    if (!pan) return;
    // 不从 ptrs 删除 pan.pid：正常收尾时 wrap 的 pointerup 已先行删除；
    // 而「第二指落下」场景下第一指仍真实按下，删了会让 ptrs.size<2，捏合/轻点永远建不起来
    try { if (wrap.hasPointerCapture(pan.pid)) wrap.releasePointerCapture(pan.pid); } catch (_) {}
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (wrap.isConnected) wrap.classList.remove('kl-dragging');
    pan = null;
    if (klDragMoved) klDragAt = performance.now(); // click 吞的时间窗（UP 出界时 click 目标可能上移）
  }
  function onMove(ev) {
    if (!pan) return; // 兜底：会话已收尾（如翻页重渲染后迟到的 move）
    const dx = ev.clientX - pan.startX;
    if (Math.abs(dx) > 8) { klDragMoved = true; hideTip(); }
    if (!klDragMoved) return;
    const unit = Math.max(40, wrap.clientWidth / 4);
    klApplyPage(pan.startPage + Math.round(dx / unit));
    if (!wrap.isConnected) endPan(); // 已翻页重渲染（节点被替换），收尾本次会话
  }
  function onUp() { endPan(); }
  // 捏合/轻点的 move 与 up 在 wrap 上收（双指均落在图表内才触发；捕获不适用于多指场景）
  wrap.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: ptrs.get(e.pointerId).t });
    if (!pinch || ptrs.size < 2 || !klState) return;
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.d0 > 0 && Math.abs(d - pinch.d0) > 12) pinch.moved = true;
    if (!pinch.moved) return;
    const nz = Math.min(klState.zoomMax, Math.max(1, Math.round(pinch.z0 * d / pinch.d0)));
    if (nz !== klState.zoom) {
      klState.zoom = nz;
      const w = Math.max(12, Math.min(klState.bars.length, Math.round(klState.bars.length / nz)));
      klShowTip(w + ' 根');
    }
  });
  wrap.addEventListener('pointerup', (e) => {
    ptrs.delete(e.pointerId);
    if (!pinch || ptrs.size >= 2) return;
    if (ptrs.size === 0) {
      // 双指均已松开：终结本次捏合/轻点
      const wasMoved = pinch.moved, z0 = pinch.z0, t0 = pinch.t0;
      pinch = null;
      if (!wasMoved && performance.now() - t0 < 300) toggleMode(); // 双指轻点：无位移且 <300ms
      else if (klState && klState.zoom !== z0) klZoom(0);           // 捏合已改 zoom，落档重渲染
    }
    // 一指先松：保留 pinch（含 t0），等第二指松开再终结，避免漏判轻点
  });
  wrap.addEventListener('pointercancel', (e) => {
    ptrs.delete(e.pointerId);
    if (pinch && ptrs.size < 2) pinch = null;
  });
  // 桌面缩放：滚轮即缩放（与主流 K 线工具一致），preventDefault 阻止页面/持仓表格滚动
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    klZoom(e.deltaY < 0 ? 1 : -1); // 档位徽标由 klZoom 在重渲染后统一显示
  }, { passive: false });
  wrap.addEventListener('mouseleave', () => { hideTip(); });
}

// ── 神奇九转（TD序列）检测 ──────────────────────────────
// 基于分析接口返回的日K线(series)做纯前端九转序列检测，无需后端改动。
// 下跌九转：连续9日收盘价<4日前收盘价 → 底部反转（看涨）
// 上涨九转：连续9日收盘价>4日前收盘价 → 顶部反转（看跌）
// 序列中断后重新计数，超9根重置。
function detectMagicNineTurn(bars) {
  if (!bars || bars.length < 13) return [];
  const out = [];
  let downCount = 0, upCount = 0;
  for (let i = 4; i < bars.length; i++) {
    const b = bars[i];
    if (b.Close < bars[i - 4].Close) {
      downCount++;
      upCount = 0;
      if (downCount >= 1 && downCount <= 9) {
        out.push({
          idx: i,
          date: b.Date,
          type: 'downside',
          seq: downCount,
          desc: '下跌九转第' + downCount + '天' + (downCount === 9 ? '（底部反转信号）' : '')
        });
      }
      if (downCount > 9) downCount = 0;
    } else if (b.Close > bars[i - 4].Close) {
      upCount++;
      downCount = 0;
      if (upCount >= 1 && upCount <= 9) {
        out.push({
          idx: i,
          date: b.Date,
          type: 'upside',
          seq: upCount,
          desc: '上涨九转第' + upCount + '天' + (upCount === 9 ? '（顶部反转信号）' : '')
        });
      }
      if (upCount > 9) upCount = 0;
    } else {
      downCount = 0;
      upCount = 0;
    }
  }
  return out;
}

function fmtVol(v) {
  if (!isFinite(v) || v <= 0) return '—';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return Math.round(v).toString();
}
// 技术分析弹框：纯 K 线视图（主图蜡烛 + 副图指标/成交量，可下拉切换）。
// 指标 / 策略 / 回测 / 估值 / 概览等面板已移除（2026-10-18），弹框只承载 K 线本身。
function renderAnalysis(a) {
  let tdAllMap = {};
  if (a.series && a.series.length) {
    // 全序列九转用于迷你K线标号：左右翻页（更早起区间）时也能实时标记，不局限于近 60 根；
    // 仅标 6~9 转有效信号
    detectMagicNineTurn(a.series).filter((p) => p.seq >= 6).forEach((p) => { (tdAllMap[p.date] = tdAllMap[p.date] || []).push(p); });
  }
  let html = '';
  if (a.series && a.series.length) {
    html += klineMiniHTML(a.series, tdAllMap, a.name);
  } else {
    html += '<div class="analysis-err">暂无K线数据</div>';
  }
  $('#analysisBody').innerHTML = html;
  bindKlineMini($('#analysisBody'));
}

// ── 弹框关闭 ──────────────────────────────────────────

$('#analysisModal').addEventListener('click', (e) => { if (e.target === $('#analysisModal')) { $('#analysisModal').hidden = true; } });

// ===== 多账本：账本切换 / 账本管理（底部抽屉） =====
// 当前账本 ID 持久化在 localStorage('pf_user')；api() 会在请求头注入 X-User-Id。
let allUsersCache = [];

function setUserText(name) {
  const t = document.getElementById('userNameText');
  if (t) t.textContent = name || '默认';
}

// ===== 右上角个人菜单（2026-10-27）=====
// 设置项从主导航迁入此处（导航回落 5 项）；面板样式对齐 PanWatch 的 AccountMenu：
// 头像触发 + 右侧下拉 + 分组小标题 + 发丝线分隔 + 激活项右侧打勾。
// 账本切换直接列在面板内（点即生效），新增/删除等重操作仍走「管理账本」抽屉。
function acctMenuEls() {
  return {
    menu: document.getElementById('acctMenu'),
    pop: document.getElementById('acctPop'),
    btn: document.getElementById('userBtn'),
  };
}
function renderAcctUsers() {
  const list = document.getElementById('acctUserList');
  if (!list) return;
  if (!allUsersCache.length) { list.innerHTML = '<div class="acct-empty">暂无账本</div>'; return; }
  const curId = localStorage.getItem('pf_user');
  list.innerHTML = allUsersCache.map((u) => {
    const on = String(u.id) === String(curId);
    return `<button class="acct-item acct-user${on ? ' active' : ''}" type="button" data-act="switch-user" data-id="${u.id}">`
      + '<span class="acct-dot" aria-hidden="true"></span>'
      + `<span class="acct-uname">${escapeHtml(u.name)}</span>`
      + '<span class="acct-check" aria-hidden="true">✓</span></button>';
  }).join('');
}
// 主题勾选态与 <html data-theme> 同步（头部快捷按钮、设置页开关、菜单三处共用一个事实源）
function syncAcctTheme() {
  const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  document.querySelectorAll('#acctPop .acct-item[data-act="theme"]').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === cur);
  });
}
async function openAcctMenu() {
  const { menu, pop, btn } = acctMenuEls();
  if (!pop) return;
  pop.hidden = false;
  if (btn) btn.setAttribute('aria-expanded', 'true');
  if (menu) menu.classList.add('open');
  renderAcctUsers();
  syncAcctTheme();
  if (!allUsersCache.length) { allUsersCache = await fetchUsers(); renderAcctUsers(); }
}
function closeAcctMenu() {
  const { menu, pop, btn } = acctMenuEls();
  if (pop) pop.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (menu) menu.classList.remove('open');
}
function toggleAcctMenu() {
  const { pop } = acctMenuEls();
  if (!pop) return;
  if (pop.hidden) openAcctMenu(); else closeAcctMenu();
}
// 面板交互：事件委托，重渲染账本列表后仍生效
function onAcctPopClick(e) {
  const item = e.target.closest('[data-act]');
  if (!item) return;
  const act = item.dataset.act;
  if (act === 'switch-user') {
    closeAcctMenu();
    const curId = localStorage.getItem('pf_user');
    if (String(item.dataset.id) !== String(curId)) switchUser(item.dataset.id);
  } else if (act === 'theme') {
    const next = item.dataset.theme === 'light' ? 'light' : 'dark';
    localStorage.setItem('pf_theme', next);
    applyTheme(next);
    const sw = document.getElementById('themeSwitch');
    if (sw) sw.checked = (next === 'dark');
    syncAcctTheme();
  } else if (act === 'settings') {
    closeAcctMenu();
    navigate('settings');
  } else if (act === 'devices') {
    closeAcctMenu();
    navigate('devices');
  } else if (act === 'notify') {
    closeAcctMenu();
    navigate('notify');
  } else if (act === 'pnl-cal') {
    closeAcctMenu();
    openPnlModal();
  } else if (act === 'manage-users') {
    closeAcctMenu();
    openUserSheet();
  } else if (act === 'logout') {
    closeAcctMenu();
    doLogout();
  }
}
function bindAcctMenu() {
  const { btn, pop, menu } = acctMenuEls();
  if (btn) btn.onclick = (e) => { e.stopPropagation(); toggleAcctMenu(); };
  if (pop) {
    pop.onclick = onAcctPopClick;
    // 面板内点击不冒泡到 document，否则会被「点外部关闭」立刻收起
    pop.addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', (e) => {
    if (!menu || !pop || pop.hidden) return;
    if (!menu.contains(e.target)) closeAcctMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAcctMenu();
  });
}

async function fetchUsers() {
  try {
    const r = await fetch('/api/users');
    if (!r.ok) return [];
    const d = await r.json();
    return d.users || [];
  } catch (e) { return []; }
}

// 启动 / 刷新时解析当前账本：以服务端会话为准；pf_user 仅作展示镜像（旧脚本仍可读）。
async function initUser() {
  const st = (authState.authed || authState.mode) ? authState : (await fetchSession());
  if (st) authState = st;
  allUsersCache = (authState.users || []).map((u) => ({ id: u.id, name: u.name }));
  if (authState.user) {
    localStorage.setItem('pf_user', String(authState.user.id));
    setUserText(authState.user.name);
  } else {
    setUserText('默认');
  }
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
  setUserText(cur ? cur.name : '默认');
}

function renderUserList(users, curId, statsMap) {
  const list = document.getElementById('userList');
  if (!list) return;
  if (!users.length) { list.innerHTML = '<div class="user-empty">暂无账本</div>'; return; }
  const canDelete = users.length > 1;
  // 「能否切换」必须以**会话授权**为准（authState.users 来自 session_users），
  // 不能用 allUsersCache —— 那是 /api/users 的全量列表，恒为真，会让未接入本设备的账本
  // 也亮出「切换」，点下去只换来一条 403。会话还没取到时退化为可切（保持旧行为）。
  const grantedIds = new Set((authState.users || []).map((g) => String(g.id)));
  const hasGrantInfo = grantedIds.size > 0;
  list.innerHTML = users.map((u) => {
    const isCur = String(u.id) === String(curId);
    const cnt = (statsMap[u.id] != null ? statsMap[u.id] : 0);
    const granted = !hasGrantInfo || grantedIds.has(String(u.id));
    const switchable = !isCur && granted;
    const delBtn = canDelete
      ? `<button class="btn danger ur-del" type="button" data-act="delete" data-id="${u.id}" data-name="${escapeHtml(u.name)}" title="删除账本" aria-label="删除账本">${actIcon('del')}</button>`
      : `<button class="btn danger ur-del" type="button" disabled title="至少保留一个账本" aria-label="至少保留一个账本">${actIcon('del')}</button>`;
    // 整行即热区：data-act 挂在行上，点名字/空白都能切；行内删除按钮的 data-act 优先命中
    return `
    <div class="user-row ${isCur ? 'active' : ''}${switchable ? ' is-switchable' : ''}" data-id="${u.id}"
         ${switchable ? 'data-act="switch" role="button" tabindex="0"' : ''}>
      <div class="ur-main">
        <div class="ur-name">${escapeHtml(u.name)}${isCur ? ' <span class="ur-cur">当前</span>' : ''}</div>
        <div class="ur-meta">${cnt} 条数据${granted || isCur ? '' : ' · 本设备未接入'}</div>
      </div>
      <div class="ur-actions">
        ${switchable ? '<span class="ur-go">切换</span>' : ''}
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
  // 认证层：切换 = 服务端把会话的激活账本换掉，仅限本设备已授权的账本
  try {
    const r = await api('/api/session/switch', { method: 'POST', body: JSON.stringify({ user_id: Number(id) }) });
    if (!r.ok) {
      let m = '切换失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (e) {}
      toast(m, 'err');
      // 403 = 本设备没这个账本的授权：本地把它摘掉并重绘，别让同一行还能再点一次
      if (r.status === 403) {
        authState.users = (authState.users || []).filter((g) => String(g.id) !== String(id));
        await refreshUsers();
      }
      return;
    }
    const st = await r.json();
    authState = st;
    localStorage.setItem('pf_user', String(st.user.id));
    setUserText(st.user.name);
    allUsersCache = (st.users || []).map((u) => ({ id: u.id, name: u.name }));
    renderAcctUsers();
    calData = {};  // 清空权益曲线(pnl/history)缓存，切换账本后重新拉取，否则复用上一账本数据导致近30日曲线不刷新
    closeUserSheet();
    await load();
    await loadAsset();
    await loadAISettings();
    toast('已切换到账本：' + st.user.name, 'ok');
  } catch (e) { toast('切换账本失败：' + e.message, 'err'); }
}

async function addUser() {
  const inp = document.getElementById('userNameInput');
  const name = (inp && inp.value || '').trim();
  if (!name) { toast('请输入账本名称', 'err'); return; }
  try {
    const r = await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      let m = '新增失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {}
      toast(m, 'err');
      return;
    }
    const d = await r.json().catch(() => ({}));
    if (inp) inp.value = '';
    // 服务端建账本时会把它授权给本设备（grantSessionUser），本地同步进会话授权表，
    // 否则新行会一直显示「本设备未接入」、点了也切不过去
    if (d && d.id) authState.users = (authState.users || []).concat([{ id: d.id, name }]);
    toast('已新增账本：' + name, 'ok');
    await refreshUsers();
  } catch (e) { toast('新增异常：' + e.message, 'err'); }
}

let pendingClearUserId = null;
function clearUserData() {
  const curId = localStorage.getItem('pf_user');
  if (!curId) { toast('未选择账本', 'err'); return; }
  pendingClearUserId = curId;
  $('#confirmTitle').textContent = '清空当前账本数据';
  $('#confirmMsg').textContent = '确认清空当前账本的全部数据（持仓 / 资产全景 / 计算器 / AI 配置 / 历史等）？此操作不可恢复。';
  $('#confirmModal').hidden = false;
}

let pendingDeleteUserId = null;
let pendingDeleteName = '';
function deleteUser(id, name) {
  pendingDeleteUserId = Number(id);
  pendingDeleteName = name || '';
  const msg = document.getElementById('userDeleteMsg');
  if (msg) msg.textContent = '确认删除账本「' + name + '」及其全部数据？删除后该账本的所有数据将被清空，且不可恢复。';
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
    const r = await api('/api/users/' + id, { method: 'DELETE' });
    if (!r.ok) {
      let m = '删除失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {}
      toast(m + ' (HTTP ' + r.status + ')', 'err');
      return;
    }
    toast('已删除账本：' + name, 'ok');
    // 若删除的是当前账本，自动切到剩余首个账本
    const curId = localStorage.getItem('pf_user');
    if (String(curId) === String(id)) {
      const users = await fetchUsers();
      const next = users.length ? users[0] : null;
      if (next) { localStorage.setItem('pf_user', String(next.id)); setUserText(next.name); }
    }
    await load();
    await loadAsset();
    await loadAISettings();
    await refreshUsers();
  } catch (e) { toast('删除异常：' + e.message, 'err'); }
}

// 账本切换相关 UI
(function wireUserUI() {
  // 头像按钮 -> 个人菜单（内部含「管理账本」入口打开弹框）
  bindAcctMenu();
  // 弹框：点遮罩关闭（.modal 铺满全屏，点到卡片以外即 e.target 是 #userSheet 本身）；
  // Esc 由全局 keydown 统一处理（.modal:not([hidden])），右上角 ✕ 由 injectModalClose 自动注入
  const sheet = document.getElementById('userSheet');
  if (sheet) sheet.onclick = (e) => { if (e.target === sheet) closeUserSheet(); };
  const addBtn = document.getElementById('userAddBtn');
  if (addBtn) addBtn.onclick = addUser;
  // 新增框回车即提交（弹框里输完名字下意识敲回车，不该还去点按钮）
  const nameInput = document.getElementById('userNameInput');
  if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUser(); } });
  const clearBtn = document.getElementById('userClearBtn');
  if (clearBtn) clearBtn.onclick = clearUserData;
  // 数据导出/导入（原资产全景工具栏迁入，功能不变）
  const exportBtn = document.getElementById('ai_export_json');
  if (exportBtn) exportBtn.onclick = confirmExport;
  const importBtn = document.getElementById('ai_import_json');
  if (importBtn) importBtn.onclick = () => { document.getElementById('importFile').click(); };
  const list = document.getElementById('userList');
  if (list) {
    list.addEventListener('click', onUserListClick);
    // 行可键盘操作：Tab 到行上按 Enter / 空格 = 切换（行内删除按钮自己会响应，跳过）
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.ur-actions')) return;
      const row = e.target.closest('.user-row[data-act="switch"]');
      if (!row) return;
      e.preventDefault();
      switchUser(row.dataset.id);
    });
  }
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

// 初始路由：认证通过后才执行（见 boot → enterApp）；闸门期间不渲染任何视图。
if (authReady) applyRoute();

// ============================================================
// 收支计划（月度待入账 / 待还款）：首页紧凑卡片 + 资产全景编辑入口 + 待还款提醒
// ============================================================
let cashflowPlans = [];        // 当前账本全部计划
let cashflowDone = {};         // { plan_id: {done_at, actual_amount} }，key 为数字 id
let cashflowMonth = '';        // 当前展示的月份 YYYY-MM
// 当前月份 YYYY-MM（用于「截止日期」到期判断）
const cfNowYm = (function () { const d = new Date(); const m = String(d.getMonth() + 1).padStart(2, '0'); return d.getFullYear() + '-' + m; })();
// 计划是否仍有效：无截止日期=长期有效；有截止日期则当月需 <= 截止月
function cfPlanActive(p, ym) {
  if (p.pattern === 'one_time') {
    // 一次性计划仅在归属日期所在月出现
    return !!p.one_time_date && p.one_time_date.slice(0, 7) === (ym || '');
  }
  if (!p.end_date) return true;
  return (ym || '') <= p.end_date.slice(0, 7);
}
let cashflowLiabilities = [];  // 编辑弹框内「关联负债」下拉用
// 卡片视图状态：bars=柱状图（默认）/ table=表格；记忆到 localStorage（pf_cf_view）
let cfViewMode = (function () { try { return localStorage.getItem('pf_cf_view') === 'table' ? 'table' : 'bars'; } catch (_) { return 'bars'; } })();
// 切换按钮图标：单色线性极简（stroke 1.9 / round），与站内 icon-btn 同风格。
// 按钮图标显示「点击后切换到」的目标视图：柱状图态显示表格 icon，表格态显示柱状图 icon。
const CF_ICON_TABLE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><path d="M3.5 10h17M9.5 10v9.5M15.5 10v9.5"/></svg>';
const CF_ICON_BARS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="M7.5 16v-4.5M12 16V8M16.5 16v-6.5"/></svg>';

async function loadCashflow() {
  try {
    await loadCashAccounts(); // 卡片需展示关联账户名，确保缓存就绪
    const r = await api('/api/cashflow/plans');
    if (!r.ok) return;
    const d = await r.json();
    cashflowPlans = d.plans || [];
    cashflowMonth = d.month || '';
    // 后端 map key 为字符串，这里归一成数字 key 便于匹配
    const done = {};
    const raw = d.done || {};
    Object.keys(raw).forEach((k) => { done[Number(k)] = raw[k]; });
    cashflowDone = done;
  } catch (e) {
    // 静默失败，不阻塞首页渲染
  }
  renderCashflowCard();
}
// 柱状图排序用：返回 1..31 日的数字，用于稳定排序（pending/done 切换不跳序）
function cfSortDay(p) {
  if (p.pattern === 'one_time' && p.one_time_date) {
    const d = p.one_time_date.split('-');
    return Number(d[2]) || 1;
  }
  return Number(p.day_of_month) || 1;
}
// 截止日小字：返回 { day, soon }
// day：截止日在当月的「日」数字（一次性计划取 one_time_date 的日；循环计划取当月 cashflowMonth 的 day_of_month）
// soon：当月截止日距今 <= 2 天（含提前 2 天、当天、以及过期未完成，均为红），否则默认灰。
function cfDueInfo(p) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let target, day;
  if (p.pattern === 'one_time' && p.one_time_date) {
    const d = p.one_time_date.split('-');
    const y = Number(d[0]), m = Number(d[1]) - 1, dd = Number(d[2]);
    target = new Date(y, m, dd); target.setHours(0, 0, 0, 0);
    day = dd;
  } else {
    const dm = Number(p.day_of_month) || 1;
    day = dm;
    const parts = (cashflowMonth || cfNowYm).split('-');
    const y = Number(parts[0]), mo = Number(parts[1]) - 1;
    target = new Date(y, mo, dm); target.setHours(0, 0, 0, 0);
  }
  const diff = Math.round((target - now) / 86400000);
  const soon = diff <= 2; // 提前 2 天、当天、过期未完成，均标红
  return { day, soon };
}
// v3.6：收支计划 → SVG 柱状图。每个计划一根柱子，收入红色、支出绿色，按日排序。
// listEl：cf-list 容器，用于测实际宽度做动态布局
function renderCfBars(plans, listEl) {
  if (!plans || !plans.length) {
    // 空态：与全局 emptyAddBtn 同款 .btn 样式的「添加收支计划」按钮，点击弹出新建弹框
    // （复用 openCashflowModal(null)，与账户区标题行「添加收支」按钮一致）；删除旧的小号「＋ 添加」链接
    return emptyStateHTML({ icon: EMPTY_ICONS.plan, title: '还没有收支计划', desc: '新建一笔月度收支计划，自动追踪预算执行与结余。', btnLabel: '＋ 添加收支计划', btnAttrs: 'id="cfQuickAdd"' });
  }
  // 提取日数字 + 排序
  const bars = plans.map((p) => {
    let day;
    if (p.pattern === 'one_time' && p.one_time_date) {
      day = Number(p.one_time_date.split('-')[2]) || 1;
    } else {
      day = Number(p.day_of_month) || 1;
    }
    return {
      id: p.id, day,
      amount: Math.abs(Number(p.amount) || 0),
      isIncome: p.type === 'income',
      done: !!cashflowDone[p.id],
      title: p.title || '',
      currency: p.currency || 'cny',
    };
  // 稳定排序：先按「日」排，同日再用 id 兜底，避免标记完成后 pending/done 分组互换导致同日柱子跳序
  }).sort((a, b) => (a.day - b.day) || (a.id - b.id));

  const H = 100;     // 总高固定（撑满 cf-list flex:1）
  const padTop = 16, padBot = 20;   // padTop 给柱顶金额小字留空间（字号 7.5→10 后需再+2）
  const chartH = H - padTop - padBot;
  const maxV = Math.max(...bars.map((b) => b.amount), 1);
  const incomeColor = 'var(--up)';
  const expenseColor = 'var(--down)';
  // 柱顶金额小字：¥1.1k 紧凑格式（按各柱币种取符号；>=1000 才带 k，否则整数）
  const kfmt = (v, cur) => {
    const sym = curSymbolJS(cur);
    if (v >= 1000) {
      const k = v / 1000;
      return sym + (k >= 100 ? Math.round(k) : k.toFixed(1)) + 'k';
    }
    return sym + Math.round(v);
  };

  // 动态测容器宽度：优先用 getBoundingClientRect，否则估算
  let containerW = 280;
  try { if (listEl) { const r = listEl.getBoundingClientRect(); if (r.width > 0) containerW = Math.round(r.width); } } catch (_) {}
  // 窄屏最小宽
  containerW = Math.max(200, containerW);

  // 根据柱子数量和容器宽算每柱 slot（柱宽+间距）
  const minBarW = 16, maxBarW = 30;       // 柱宽范围（v3.6 加宽）
  const slot = Math.floor((containerW - 16) / bars.length);  // 每柱可用空间（减去左右各 8px padding）
  const barW = Math.max(minBarW, Math.min(maxBarW, slot - 4));  // 柱宽 = slot - 4px gap
  const gap = Math.max(2, slot - barW);                          // 实际间距
  const contentW = bars.length * (barW + gap) - gap;              // 柱子总宽（不含 padding）
  const sidePad = Math.max(8, Math.floor((containerW - contentW) / 2));  // 左右相等 padding 让柱子居中
  const W = Math.max(containerW, contentW + sidePad * 2);        // SVG 总宽（至少容器宽，多则滚动）

  let x = sidePad;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="cf-bars">`];
  // 基线
  parts.push(`<line x1="0" y1="${padTop + chartH}" x2="${W}" y2="${padTop + chartH}" stroke="rgba(var(--tint),.15)" stroke-width="1"/>`);
  // 折线：柱顶中点连成趋势线（先画线再画柱，保证柱子压在线之上）
  const pts = [];
  bars.forEach((b) => {
    const h = Math.max(2, (b.amount / maxV) * chartH);
    pts.push({ cx: x + barW / 2, cy: padTop + chartH - h });
    x += barW + gap;
  });
  if (pts.length > 1) {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`).join(' ');
    parts.push(`<path class="cf-trend" d="${d}" fill="none" stroke="currentColor" stroke-opacity=".38" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  x = sidePad;
  bars.forEach((b, idx) => {
    const h = Math.max(2, (b.amount / maxV) * chartH);
    const y = padTop + chartH - h;
    const fill = b.isIncome ? incomeColor : expenseColor;
    const opacity = b.done ? 'fill-opacity="0.4"' : '';
    parts.push(`<rect class="cf-bar" data-id="${b.id}" x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" ry="2" fill="${fill}" ${opacity} title="${esc(b.title)} ${b.isIncome ? '＋' : '－'}${curSymbolJS(b.currency)}${fmt(b.amount)} / ${b.day}日"/>`);
    // 柱顶金额小字（￥1.1k 格式）；字号 7.5→10（原偏小几乎看不清）。满高柱 y 贴近 padTop，文字基线 y-4 仍在 viewBox 内
    parts.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${fill}" opacity="0.9">${kfmt(b.amount, b.currency)}</text>`);
    parts.push(`<text x="${x + barW / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5">${b.day}日</text>`);
    // 柱顶中点圆点：与折线衔接（描边色走 CSS 类，SVG 属性里的 var() 兼容性不稳）
    parts.push(`<circle class="cf-dot-top" cx="${pts[idx].cx.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${fill}" stroke-width="1.4" ${b.done ? 'opacity="0.45"' : ''}/>`);
    x += barW + gap;
  });
  parts.push('</svg>');
  return parts.join('');
}
// v3.7：表格视图。与柱状图共用同一份 ordered 数据（已完成置灰 + 删除线，与列表行 cf-done 同语言）；
// 行点击 = 柱子点击，走同一个确认框（cfOpenPlanConfirm）。空态复用「＋ 添加收支计划」按钮。
function renderCfTable(plans) {
  if (!plans || !plans.length) {
    return emptyStateHTML({ icon: EMPTY_ICONS.plan, title: '还没有收支计划', desc: '新建一笔月度收支计划，自动追踪预算执行与结余。', btnLabel: '＋ 添加收支计划', btnAttrs: 'id="cfQuickAdd"' });
  }
  const rows = plans.map((p) => {
    const done = !!cashflowDone[p.id];
    const isIncome = p.type === 'income';
    const sign = isIncome ? '＋' : '－';
    const amtCls = isIncome ? 'cf-amt-in' : 'cf-amt-out';
    const liabTag = (p.type === 'expense' && p.liability_mode === 'incur') ? '<span class="cf-tag">新负债</span>'
      : (p.liability_id ? '<span class="cf-tag">负债</span>' : '');
    const due = cfDueInfo(p);
    return `<tr class="cf-tr${done ? ' cf-done' : ''}" data-id="${p.id}">
      <td class="cf-t-name"><span class="cf-ellip">${esc(p.title)}</span>${liabTag}</td>
      <td class="num cf-amt ${amtCls}">${sign}${curSymbolJS(p.currency || 'cny')}${fmt(p.amount)}</td>
      <td class="num cf-t-day${due.soon ? ' due-soon' : ''}">${due.day}日</td>
    </tr>`;
  }).join('');
  return `<table class="cf-table">
    <tbody>${rows}</tbody>
  </table>`;
}
// 柱子 / 表格行共用的点击确认框：标记完成 ⇄ 撤销完成 / 编辑收支
function cfOpenPlanConfirm(id) {
  const idNum = Number(id);
  const p = cashflowPlans.find((x) => x.id === idNum);
  if (!p) return;
  const done = !!cashflowDone[idNum];
  const sign = p.type === 'income' ? '＋' : '－';
  let day;
  if (p.pattern === 'one_time' && p.one_time_date) day = Number(p.one_time_date.split('-')[2]) || 1;
  else day = Number(p.day_of_month) || 1;
  const line2 = `${sign}${curSymbolJS(p.currency || 'cny')}${fmt(Math.abs(Number(p.amount) || 0))} · ${day}日`;
  openConfirm({
    title: p.title || '收支计划',
    msg: `${line2}`,
    okText: done ? '撤销完成' : '标记完成',
    cancelText: '编辑收支',
    danger: done,
    onOk: () => cfToggle(idNum),
    onCancel: () => openCashflowModal(p),
  });
}
function renderCashflowCard() {
  const card = document.getElementById('cashflowCard');
  const list = document.getElementById('cfList');
  if (!card || !list) return;
  // 首页紧凑卡片展示「当月仍有效」的计划；已完成的不再隐藏，而是整体置灰 + 单选框选中效果（可回看/撤销）。
  // （已过截止日期且仍未完成的仍不显示）
  const monthPlans = cashflowPlans.filter((p) => cfPlanActive(p, cashflowMonth))
    .sort((a, b) => cfSortDay(a) - cfSortDay(b));
  const pendingPlans = monthPlans.filter((p) => !cashflowDone[p.id]);
  const donePlans = monthPlans.filter((p) => cashflowDone[p.id]);
  const rowHtml = (p) => {
    const done = !!cashflowDone[p.id];
    const isIncome = p.type === 'income';
    const sign = isIncome ? '＋' : '－';
    const amtCls = isIncome ? 'cf-amt-in' : 'cf-amt-out';
    const cur = curSymbolJS(p.currency || 'cny');
    const liabTag = (p.type === 'expense' && p.liability_mode === 'incur') ? '<span class="cf-tag">新负债</span>'
      : (p.liability_id ? '<span class="cf-tag">负债</span>' : '');
    const due = cfDueInfo(p);
    const dueHtml = `<span class="cf-due${due.soon ? ' due-soon' : ''}" title="截止日（每月该日到期）"><i class="cf-dot"></i>${due.day}日</span>`;
    const checkInner = done
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'
      : '';
    return `<div class="cf-row${done ? ' cf-done' : ''}" data-id="${p.id}">
      <button class="cf-check" data-act="cf-toggle" data-id="${p.id}" title="${done ? '撤销完成' : '标记完成并记账'}" aria-label="${done ? '撤销完成' : '标记完成并记账'}" aria-checked="${done}">${checkInner}</button>
      <div class="cf-main">
        <div class="cf-name">${esc(p.title)} ${dueHtml}${liabTag}</div>
      </div>
      <div class="cf-amt ${amtCls}">${sign}${cur}${fmt(p.amount)}</div>
      <button class="cf-edit" data-act="cf-edit" data-id="${p.id}" title="编辑" aria-label="编辑">${actIcon('edit')}</button>
    </div>`;
  };
  // 净收支：当月全部计划（含已完成）的收入和 − 支出和；已完成/未完成只是执行状态
  const allInSum = monthPlans.filter((p) => p.type === 'income').reduce((s, p) => s + (p.amount || 0), 0);
  const allOutSum = monthPlans.filter((p) => p.type === 'expense').reduce((s, p) => s + (p.amount || 0), 0);
  const net = allInSum - allOutSum;
  card.hidden = false;
  const sub = document.getElementById('cfSub');
  if (sub) {
    sub.innerHTML = `净 <b class="${clsPnl(net)}">${net >= 0 ? '＋' : '－'}${curSymbolJS('cny')}${fmt(Math.abs(net))}</b>`;
  }
  const monthEl = document.getElementById('cfMonth');
  if (monthEl) monthEl.textContent = cashflowMonth || '';
  const netEl = document.getElementById('cfNet');
  if (netEl) {
    netEl.className = 'cf-net ' + (clsPnl(net));
    netEl.textContent = `${net >= 0 ? '＋' : '－'}${curSymbolJS('cny')}${fmt(Math.abs(net))}`;
  }
  // 右上角视图切换按钮：图标 = 点击后切换到的目标视图
  const tg = document.getElementById('cfViewToggle');
  if (tg) {
    tg.innerHTML = cfViewMode === 'table' ? CF_ICON_BARS : CF_ICON_TABLE;
    tg.title = cfViewMode === 'table' ? '切换为柱状图' : '切换为表格';
    tg.setAttribute('aria-label', tg.title);
    tg.onclick = () => {
      cfViewMode = cfViewMode === 'table' ? 'bars' : 'table';
      try { localStorage.setItem('pf_cf_view', cfViewMode); } catch (_) {}
      renderCashflowCard();
    };
  }
  // 全部当月计划 → SVG 柱状图 / 表格（按 cfViewMode；空态也在渲染函数里统一处理）
  const ordered = pendingPlans.concat(donePlans);
  list.classList.toggle('cf-list-table', cfViewMode === 'table');
  list.innerHTML = cfViewMode === 'table' ? renderCfTable(ordered) : renderCfBars(ordered, list);
  // 空态：添加按钮；有数据：柱子/表格行点击 → openConfirm 让用户选「编辑 / 标记完成」
  const qa = document.getElementById('cfQuickAdd');
  if (qa) qa.onclick = () => openCashflowModal(null);
  list.querySelectorAll('.cf-bar').forEach((el) => {
    el.onclick = () => cfOpenPlanConfirm(el.dataset.id);
  });
  list.querySelectorAll('.cf-tr').forEach((el) => {
    el.onclick = () => cfOpenPlanConfirm(el.dataset.id);
  });
}

// 勾选「标记完成」：已完成则直接撤销（冲正记账）；未完成一律弹金额框确认实际金额。
function cfToggle(id) {
  const done = cashflowDone[id];
  if (done) { doCfToggle(id); return; }
  const p = (cashflowPlans || []).find((x) => x.id === Number(id)) || {};
  openCfAmtModal(id, p);
}

// 完成金额弹窗：完成计划时确认实际金额（预填计划金额，可改；填 0 = 本月跳过不记账）。
// 记账账户由计划预设的子账户自动扣/入（未预设则用该币种余额最大的子账户），此处不再让用户选账户。
function openCfAmtModal(id, p, ym) {
  const m = document.getElementById('cfAmtModal');
  document.getElementById('cfAmtTitle').textContent = '完成计划';
  const inp = document.getElementById('cfAmtInput');
  inp.value = (p.amount && p.amount > 0) ? round4(p.amount) : '';
  document.getElementById('cfAmtErr').textContent = '';
  m.hidden = false;
  inp.focus();
  const ok = document.getElementById('cfAmtOk');
  const cancel = document.getElementById('cfAmtCancel');
  ok.onclick = async () => {
    const v = round4(parseFloat(inp.value) || 0);
    if (v < 0) { document.getElementById('cfAmtErr').textContent = '金额不能为负'; return; }
    m.hidden = true;
    await doCfToggle(id, v, ym);
    await refreshAssetCashflowPanel();
  };
  cancel.onclick = () => { m.hidden = true; };
}

async function doCfToggle(id, actualAmount, ym) {
  ym = ym || cashflowMonth || cfNowYm;
  // 完成态按目标月取：非当前月（各卡独立翻月看到的月份）要查 _planDoneCache，不能只看 cashflowDone
  const doneMap = (ym === cashflowMonth) ? cashflowDone : (_planDoneCache[ym] || {});
  const done = !!doneMap[id];
  const completing = !done;
  const url = (done ? '/api/cashflow/plans/' + id + '/uncomplete' : '/api/cashflow/plans/' + id + '/complete') + '?ym=' + encodeURIComponent(ym || '');
  const opts = { method: 'POST' };
  const body = {};
  if (completing && actualAmount !== undefined) body.actual_amount = actualAmount;
  if (Object.keys(body).length) opts.body = JSON.stringify(body);
  try {
    const r = await api(url, opts);
    if (!r.ok) { let m = '操作失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
    toast(done ? '已撤销完成并冲正记账' : (actualAmount === 0 ? '已标记跳过（不记账）' : '已完成并记入真实出入账'), 'ok');
    await loadCashAccounts();  // 账户余额可能已变化
    await loadCashflow();
    // 非当前月的完成态缓存失效后重拉，避免卡片仍显示旧的勾选态
    if (ym !== cashflowMonth) { delete _planDoneCache[ym]; await ensurePlanDoneYm(ym); }
  } catch (e) {
    toast('异常：' + e.message, 'err');
  }
}

// 方向 × 模式 选项（胶囊用短标签，详情靠标题表达）
// 模式简化为「每月 / 一次性」两项：原「固定 vs 浮动」的区分已无必要——
// 完成计划时统一弹「实际金额」框（预填计划金额，可改、可 0 跳过），两类行为一致。
// 存储值沿用 recurring_fixed（=每月）/ one_time，历史 recurring_variable 数据按每月兼容读取。
const CF_PATTERN_SHORT = {
  recurring_fixed: '每月',
  recurring_variable: '每月', // 历史值兼容：按每月展示
  one_time: '一次性',
};
const CF_PATTERNS = {
  income: [
    { v: 'recurring_fixed', t: '每月' },
    { v: 'one_time', t: '一次性' },
  ],
  expense: [
    { v: 'recurring_fixed', t: '每月' },
    { v: 'one_time', t: '一次性' },
  ],
};
function cfPatternPillsHTML(type) {
  return (CF_PATTERNS[type] || []).map((o) => `<button type="button" class="at-chip-toggle" data-v="${o.v}">${CF_PATTERN_SHORT[o.v]}</button>`).join('');
}

// ---- 编辑弹框 ----
async function openCashflowModal(p) {
  const isEdit = !!(p && p.id);
  await loadSourcesCache(); // 二级下拉（子账户 / 负债）按来源分组需要
  await loadCustomFlowCats();
  document.getElementById('cf_id').value = isEdit ? p.id : '';
  const type = isEdit ? p.type : 'income';
  document.getElementById('cf_type').value = type;
  document.getElementById('cf_category').value = isEdit ? (p.category || '') : '';
  // 方向胶囊
  document.querySelectorAll('#cfTypePills button').forEach((b) => b.classList.toggle('on', b.dataset.v === type));
  // 模式胶囊
  const patBox = document.getElementById('cfPatternPills');
  patBox.innerHTML = cfPatternPillsHTML(type);
  patBox.dataset.type = type;
  // 归一化历史 pattern：recurring_variable 已并入「每月」(recurring_fixed)
  const normPat = (v) => (v === 'recurring_variable' ? 'recurring_fixed' : v);
  const defPat = (isEdit && p.pattern) ? normPat(p.pattern) : (CF_PATTERNS[type][0] ? CF_PATTERNS[type][0].v : '');
  patBox.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === defPat);
    b.onclick = () => {
      patBox.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      document.getElementById('cf_pattern').value = b.dataset.v;
      syncCfForm();
    };
  });
  document.getElementById('cf_pattern').value = defPat;
  document.getElementById('cf_title').value = isEdit ? p.title : '';
  document.getElementById('cf_day').value = isEdit ? (p.day_of_month || 1) : 1;
  const otd = document.getElementById('cf_one_time_date');
  if (otd) otd.value = isEdit ? (p.one_time_date || '') : '';
  document.getElementById('cf_amount').value = isEdit ? round4(p.amount) : '';
  const edEl = document.getElementById('cf_end_date');
  if (edEl) { edEl.value = isEdit ? (p.end_date || '') : ''; syncDateHint(edEl); }
  document.getElementById('cf_note').value = isEdit ? (p.note || '') : '';
  document.getElementById('cf_account_id').value = isEdit ? (p.account_id || 0) : 0;
  document.getElementById('cf_liability_mode').value = isEdit ? (p.liability_mode || (p.type === 'expense' ? 'repay' : '')) : (type === 'expense' ? 'repay' : '');
  document.getElementById('cfModalTitle').textContent = isEdit ? '编辑收支计划' : '新建收支计划';
  document.getElementById('cfErr').textContent = '';
  await loadCashAccounts();
  setPickerHTML($('#cfCashPanel'), buildFlowPicker());
  cfSetSelection(isEdit && p.account_id ? (cashAccountsCache || []).find((x) => x.id === p.account_id) : null);
  await loadLiabilitiesForCf();
  renderCfLiabilitySelect(isEdit ? p.liability_id : 0);
  syncCfForm();
  renderCfDoneBtn(p, isEdit);   // 「标记完成 / 撤销完成」落在保存按钮左侧
  document.getElementById('cashflowModal').hidden = false;
}

// 完成态按钮所处的月份：循环计划用该卡当前查看月（各卡独立翻月），一次性计划用归属月。
function cfDoneYmOf(p) {
  if (!p) return cfViewYm || cashflowMonth || cfNowYm;
  if (p.pattern === 'one_time') return (p.one_time_date || '').slice(0, 7) || cfViewYm || cashflowMonth || cfNowYm;
  return _fpCardYm[p.id] || cfViewYm || cashflowMonth || cfNowYm;
}

// 编辑弹框内的完成态按钮：已完成→「撤销完成」（反向流水冲正当初的真实出入账），
// 未完成→「标记完成」（先确认实际金额，再记真实出入账）。仅编辑态出现（新建无从谈完成）。
// 落在 .modal-actions 的「保存」左侧；样式跟随项目审美：ghost / danger-soft，保存保持唯一 primary。
function renderCfDoneBtn(p, isEdit) {
  const slot = document.getElementById('cfDoneBtnSlot');
  if (!slot) return;
  if (!isEdit) { slot.innerHTML = ''; return; }
  const ym = cfDoneYmOf(p);
  const done = _planDoneAt(p, ym);
  slot.innerHTML = `<button class="btn${done ? ' danger-soft' : ''}" type="button" id="cfDoneBtn">${done ? '撤销完成' : '标记完成'}</button>`;
  const btn = document.getElementById('cfDoneBtn');
  if (!btn) return;
  btn.onclick = async () => {
    if (done) {
      openConfirm({
        title: '撤销完成',
        msg: '将记一笔反向流水冲正该计划产生的出入账，并清除完成记录。是否继续？',
        okText: '撤销', danger: true,
        onOk: async () => {
          document.getElementById('cashflowModal').hidden = true;
          await doCfToggle(p.id, undefined, ym);
          await refreshAssetCashflowPanel();
        },
      });
    } else {
      document.getElementById('cashflowModal').hidden = true;
      openCfAmtModal(p.id, p, ym);
    }
  };
}

// 完成 / 撤销后原地刷新资产页收支面板（账户余额与完成态已由 doCfToggle→loadCashflow 更新）
async function refreshAssetCashflowPanel() {
  const body = document.getElementById('assetPanelCashflow');
  if (body) await renderAssetCashflowPanel(body);
}

// 根据方向/模式显隐字段，并推导负债方式（incur 仅支出一次性，其余 repay）。
function syncCfForm() {
  const type = document.getElementById('cf_type').value;
  const patBox = document.getElementById('cfPatternPills');
  if (patBox.dataset.type !== type) {
    patBox.innerHTML = cfPatternPillsHTML(type);
    patBox.dataset.type = type;
    const defPat = CF_PATTERNS[type][0] ? CF_PATTERNS[type][0].v : '';
    patBox.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === defPat);
      b.onclick = () => {
        patBox.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        document.getElementById('cf_pattern').value = b.dataset.v;
        syncCfForm();
      };
    });
    document.getElementById('cf_pattern').value = defPat;
  }
  const pat = document.getElementById('cf_pattern').value;
  const isOneTime = pat === 'one_time';
  const isExp = type === 'expense';
  document.getElementById('cfDayWrap').hidden = isOneTime;
  document.getElementById('cfDateWrap').hidden = !isOneTime;
  document.getElementById('cfLiabilityWrap').style.display = (isExp && !isOneTime) ? '' : 'none';
  document.getElementById('cfEndWrap').style.display = isOneTime ? 'none' : '';
  // 子账户字段按方向改名：支出=还款账户，入账=入账账户
  const cap = document.getElementById('cfCashCap');
  if (cap) cap.textContent = isExp ? '还款账户' : '入账账户';
  // 负债方式：支出+一次性→产生新负债(incur)，其余→还款已有(repay)
  document.getElementById('cf_liability_mode').value = (isExp && isOneTime) ? 'incur' : 'repay';
  // 分类胶囊：方向决定候选集；当前选择不合法时回落该方向第一项
  renderCfCatPills(document.getElementById('cf_category').value);
}

// 收支计划分类胶囊（收入=收入类 / 支出=支出类，含自定义分类）
function renderCfCatPills(selected) {
  const box = document.getElementById('cfCatPills');
  if (!box) return;
  const type = document.getElementById('cf_type').value || 'income';
  const dir = type === 'expense' ? 'expense' : 'income';
  const opts = finCatOptions(dir);
  const keep = opts.some((o) => o.key === selected) ? selected : (opts[0] ? opts[0].key : '');
  box.innerHTML = opts.map((o) =>
    `<button type="button" class="at-chip-toggle${o.key === keep ? ' on' : ''}" data-v="${o.key}">${esc(o.label)}</button>`).join('');
  document.getElementById('cf_category').value = keep;
  box.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      box.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      document.getElementById('cf_category').value = b.dataset.v;
    };
  });
}

async function loadLiabilitiesForCf() {
  try {
    const r = await api('/api/asset/liabilities');
    if (!r.ok) { cashflowLiabilities = []; return; }
    const d = await r.json();
    // 无负债时后端返回 {"liabilities":null}（Go 的 nil slice 序列化为 null），
    // 旧写法 (d.liabilities || d) 会把整个响应对象当数组，导致下游 .filter/.find 报
    // "filter is not a function"；统一收敛为数组，空数据账户也能正常打开弹框。
    const arr = (d && Array.isArray(d.liabilities)) ? d.liabilities : (Array.isArray(d) ? d : []);
    cashflowLiabilities = arr;
  } catch (_) { cashflowLiabilities = []; }
}

function buildLiabilityPicker() {
  const liabs = (cashflowLiabilities || []).filter((l) => (l.amount || 0) > 0); // 仅显示仍有欠款的负债
  const bySrc = {};
  liabs.forEach((l) => { (bySrc[l.source_id] = bySrc[l.source_id] || []).push(l); });
  const sources = (assetSources || []).filter((s) => bySrc[s.id] && bySrc[s.id].length);
  let html = '';
  if (sources.length) {
    html += sources.map((s) => {
      const rows = bySrc[s.id].map((l) =>
        `<button type="button" class="ac-pick-row" data-v="${l.id}">${esc(l.name)}<span class="ac-pick-bal">${curSymbolJS(l.currency || 'cny')}${fmt(l.amount || 0)}</span></button>`
      ).join('');
      return `<div class="ac-pick-group"><button type="button" class="ac-pick-head" data-src="${s.id}">${esc(s.name)}<span class="ac-pick-cnt">${bySrc[s.id].length}</span><span class="ac-pick-chev">▾</span></button><div class="ac-pick-body" hidden>${rows}</div></div>`;
    }).join('');
  }
  return html;
}

function renderCfLiabilitySelect(selId) {
  const panel = document.getElementById('cfLiabilityPanel');
  const btn = document.getElementById('cfLiabilityBtn');
  if (!panel || !btn) return;
  setPickerHTML(panel, buildLiabilityPicker());
  const setVal = (v, label) => {
    document.getElementById('cf_liability_id').value = v;
    btn.textContent = label || '不关联';
    panel.querySelectorAll('.ac-pick-row').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  };
  panel.querySelectorAll('.ac-pick-head').forEach((h) => {
    h.onclick = () => { const body = h.nextElementSibling; if (body) body.hidden = !body.hidden; };
  });
  panel.querySelectorAll('.ac-pick-row').forEach((b) => {
    b.onclick = () => { setVal(b.dataset.v, b.textContent.trim()); panel.hidden = true; };
  });
  const sel = (cashflowLiabilities || []).find((l) => String(l.id) === String(selId));
  setVal(selId ? String(selId) : '0', sel ? sel.name : '不关联');
}

// ---- 事件绑定 ----
// 方向胶囊：切换时重建模式胶囊并联动显隐字段
const cfTypePills = document.getElementById('cfTypePills');
if (cfTypePills) cfTypePills.querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    cfTypePills.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    document.getElementById('cf_type').value = b.dataset.v;
    syncCfForm();
  };
});
const cashflowForm = document.getElementById('cashflowForm');
if (cashflowForm) cashflowForm.onsubmit = async (e) => {
  e.preventDefault();
  const id = document.getElementById('cf_id').value ? Number(document.getElementById('cf_id').value) : 0;
  const cfType = document.getElementById('cf_type').value;
  const cfPat = document.getElementById('cf_pattern').value;
  const accId = Number(document.getElementById('cf_account_id').value) || 0;
  const liabMode = document.getElementById('cf_liability_mode').value || 'repay';
  const liabId = (cfType === 'expense' && liabMode === 'repay') ? (Number(document.getElementById('cf_liability_id').value) || 0) : 0;
  const oneTimeDate = cfPat === 'one_time' ? (normDateInput(document.getElementById('cf_one_time_date')) || '') : '';
  // 币种自动取所选子账户自带币种（无下拉）：负债优先→关联子账户→余额最大的子账户→cny
  let currency = 'cny';
  if (liabId) {
    const lb = (cashflowLiabilities || []).find((x) => x.id === liabId);
    if (lb && lb.currency) currency = lb.currency;
  } else if (accId) {
    const ac = (cashAccountsCache || []).find((x) => x.id === accId);
    if (ac && ac.currency) currency = ac.currency;
  } else {
    const def = pickFallbackCash(cashAccountsCache);
    if (def && def.currency) currency = def.currency;
  }
  const dayOfMonth = cfPat === 'one_time'
    ? (oneTimeDate ? Math.min(31, Math.max(1, parseInt(oneTimeDate.split('-')[2], 10) || 1)) : 1)
    : Math.min(31, Math.max(1, parseInt(document.getElementById('cf_day').value, 10) || 1));
  const payload = {
    type: cfType,
    pattern: cfPat,
    title: document.getElementById('cf_title').value.trim(),
    day_of_month: dayOfMonth,
    one_time_date: oneTimeDate,
    amount: round4(parseFloat(document.getElementById('cf_amount').value) || 0),
    currency: currency,
    account_id: accId,
    liability_id: liabId,
    liability_mode: cfType === 'expense' ? liabMode : '',
    category: document.getElementById('cf_category').value || '',
    end_date: normDateInput(document.getElementById('cf_end_date')) || '',
    note: document.getElementById('cf_note').value.trim(),
  };
  if (!payload.title) { document.getElementById('cfErr').textContent = '名称不能为空'; return; }
  if (cfPat === 'one_time' && !oneTimeDate) { document.getElementById('cfErr').textContent = '一次性计划需填写具体日期'; return; }
  // 金额允许 0（仅作预计，完成时确认实际金额，可改 / 可 0 跳过）；不能为负
  if (payload.amount < 0) { document.getElementById('cfErr').textContent = '金额不能为负'; return; }
  if (cfType === 'expense' && liabMode === 'incur' && accId <= 0) { document.getElementById('cfErr').textContent = '产生新负债需关联一个子账户'; return; }
  try {
    const r = id
      ? await api('/api/cashflow/plans/' + id, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/cashflow/plans', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} document.getElementById('cfErr').textContent = m; return; }
    document.getElementById('cashflowModal').hidden = true;
    toast('已保存', 'ok');
    await loadCashflow();
    await refreshAssetCashflowPanel();   // 资产页收支卡片反映新标题/金额/账户
  } catch (err) {
    document.getElementById('cfErr').textContent = '异常：' + err.message;
  }
};
const cashflowModalEl = document.getElementById('cashflowModal');
if (cashflowModalEl) cashflowModalEl.addEventListener('click', (e) => { if (e.target === cashflowModalEl) cashflowModalEl.hidden = true; });
const cfAmtModalEl = document.getElementById('cfAmtModal');
if (cfAmtModalEl) cfAmtModalEl.addEventListener('click', (e) => { if (e.target === cfAmtModalEl) cfAmtModalEl.hidden = true; });

// ============================================================================
// 存款（定期存款 / 大额存单）：首页「存款」分段视图
// 新增时从子账户扣款（投资活动流水）；到期后必须「确认落袋」才把本金+利息入账，
// 利息落 invest_int（被动收入）。表格列：名称 / 金额 / 账户 / 起息日 / 到期时间 / 利率 / 预计利息 / 状态 / 操作
// ============================================================================
let depositsCache = [];
let depositSettleId = 0;

async function loadDeposits() {
  try {
    const r = await api('/api/asset/deposits');
    if (!r.ok) { depositsCache = []; return []; }
    const d = await r.json();
    depositsCache = (d.deposits || []).slice();
  } catch (_) { depositsCache = []; }
  return depositsCache;
}

// 存款 KPI（渲染进顶部 #depositKpiBody，与其它 tab 的 KPI 同一位置互换显示）。
// 口径：只统计未落袋（存期中/待落袋）的本金与预计利息；已落袋的计入「已落袋利息」小字。
// 加权利率按本金加权（10 万@3% + 1 万@1.5% 的实际收益率应偏向前者，不能简单算术平均）。
function renderDepositKpi() {
  const el = document.getElementById('depositKpiBody');
  if (!el) return;
  const list = depositsCache || [];
  const live = list.filter((d) => d.status !== 'settled');
  const done = list.filter((d) => d.status === 'settled');
  let principal = 0, expInt = 0, rateW = 0, doneInt = 0;
  for (const d of live) {
    const amt = Number(d.amount) || 0;
    principal += wCny(d, amt);
    expInt += wCny(d, Number(d.expected_interest) || 0);
    rateW += amt * (Number(d.rate) || 0);
  }
  for (const d of done) doneInt += wCny(d, Number(d.actual_interest) || 0);
  const avgRate = principal > 0.005 ? rateW / live.reduce((s, d) => s + (Number(d.amount) || 0), 0) : null;
  const rates = live.map((d) => Number(d.rate) || 0).filter((r) => r > 0);
  const maxRate = rates.length ? Math.max(...rates) : null;
  const minRate = rates.length ? Math.min(...rates) : null;
  // 30 天内到期：只算未落袋的，避免已落袋的旧记录被重复提醒
  const today = new Date();
  const horizon = new Date(today.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  const soon = live.filter((d) => d.end_date && d.end_date >= todayStr && d.end_date <= horizon);
  const soonAmt = soon.reduce((s, d) => s + wCny(d, Number(d.amount) || 0), 0);

  el.innerHTML = `<div class="kpi-row cols-anchor">
      <div class="kpi-card density-standard anchor">
        <div class="kpi-icon kpi-ico-equity"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 11h18"/><circle cx="12" cy="11" r="2.5"/></svg></div>
        <div class="kpi-label">存款本金</div>
        <div class="kpi-main"><div class="kpi-value">${yuanOfW(principal)}</div></div>
        <div class="kpi-sub">存期中 <span class="hl">${live.length}</span> 笔${done.length ? ` · 已落袋 <span class="hl">${done.length}</span> 笔` : ''}</div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-up"><svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></div>
        <div class="kpi-label">预计利息</div>
        <div class="kpi-main"><div class="kpi-value up">${expInt > 0 ? '+' : ''}${yuanOfW(expInt)}</div></div>
        <div class="kpi-sub">已落袋利息 <span class="hl">${yuanOfW(doneInt)}</span></div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon kpi-ico-pct"><svg viewBox="0 0 24 24"><path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg></div>
        <div class="kpi-label">加权利率</div>
        <div class="kpi-main"><div class="kpi-value">${avgRate == null ? '—' : avgRate.toFixed(2) + '%'}</div></div>
        <div class="kpi-sub">${maxRate == null ? '暂无存期中存款' : `最高 <span class="hl">${maxRate.toFixed(2)}%</span> · 最低 <span class="hl">${minRate.toFixed(2)}%</span>`}</div>
      </div>
      <div class="kpi-card density-standard">
        <div class="kpi-icon"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg></div>
        <div class="kpi-label">30 天内到期</div>
        <div class="kpi-main"><div class="kpi-value">${soon.length || '—'}${soon.length ? '<span class="kpi-unit">笔</span>' : ''}</div></div>
        <div class="kpi-sub">${soon.length ? `合计 <span class="hl">${yuanOfW(soonAmt)}</span>` : '暂无临期'}</div>
      </div>
    </div>`;
}

function renderDeposits(box) {
  renderDepositKpi(); // 顶部 KPI 与表格同源（depositsCache），任何一次重渲染都同步刷新
  if (!box) return;
  const list = depositsCache || [];
  const head = `<div class="asset-section-head"><h3>存款（${list.length}）</h3><div class="sec-actions"><button class="btn icon-btn asset-add" id="depAddBtn" type="button" title="新增存款" aria-label="新增存款">${actIcon('plus')}</button></div></div>`;
  if (!list.length) {
    box.innerHTML = head + emptyStateHTML({
      icon: EMPTY_ICONS.deposit,
      title: '还没有存款',
      desc: '添加第一笔定期存款 / 大额存单，到期确认后利息自动计入被动收入。',
      btnLabel: '＋ 添加第一笔存款',
      btnAttrs: 'data-empty-add="deposit"',
    });
    const add = box.querySelector('#depAddBtn');
    if (add) add.onclick = () => openDepositModal(null);
    const ea = box.querySelector('[data-empty-add="deposit"]');
    if (ea) ea.onclick = () => openDepositModal(null);
    return;
  }
  const rows = list.map((d) => {
    const cur = curSymbolJS(d.currency || 'cny');
    const settled = d.status === 'settled';
    const status = settled
      ? `<span class="flow-tag cat neu">已落袋</span>`
      : (d.matured ? `<span class="flow-tag cat out">待落袋</span>` : `<span class="flow-tag cat in">存期中</span>`);
    const interest = settled ? (d.actual_interest || 0) : (d.expected_interest || 0);
    const acct = [d.account_name, d.source_name].filter(Boolean).join(' · ') || '—';
    const ops = settled
      ? ''
      : `<button class="row-act" data-dep-settle="${d.id}" title="确认落袋（本金+利息入账）" aria-label="确认落袋">${actIcon('check')}</button>
         <button class="row-act" data-dep-edit="${d.id}" title="编辑" aria-label="编辑">${actIcon('edit')}</button>
         <button class="row-act danger" data-dep-del="${d.id}" title="删除（提前支取，本金退回账户）" aria-label="删除">${actIcon('trash')}</button>`;
    return `<tr>
      <td><div class="hold-name">${esc(d.name || '')}</div>${d.note ? `<div class="hold-code">${esc(d.note)}</div>` : ''}</td>
      <td class="num">${cur}${fmt(d.amount || 0)}</td>
      <td>${esc(acct)}</td>
      <td class="num">${esc(d.start_date || '—')}</td>
      <td class="num">${esc(d.end_date || '—')}${!settled && d.matured ? ' <span class="dep-due">已到期</span>' : ''}</td>
      <td class="num">${(d.rate || 0).toFixed(2)}%</td>
      <td class="num">${cur}${fmt(interest)}</td>
      <td>${status}</td>
      <td class="row-actions">${ops}</td>
    </tr>`;
  }).join('');
  box.innerHTML = head + `<div class="card asset-flow-card"><table class="asset-table dep-table"><thead><tr>
    <th>名称</th><th class="num">金额</th><th>账户</th><th class="num">起息日</th><th class="num">到期时间</th><th class="num">利率</th><th class="num">${'预计利息'}</th><th>状态</th><th class="num">操作</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  const add = box.querySelector('#depAddBtn');
  if (add) add.onclick = () => openDepositModal(null);
  box.querySelectorAll('[data-dep-edit]').forEach((b) => { b.onclick = () => openDepositModal(depositsCache.find((x) => String(x.id) === b.dataset.depEdit)); });
  box.querySelectorAll('[data-dep-del]').forEach((b) => { b.onclick = () => deleteDeposit(Number(b.dataset.depDel)); });
  box.querySelectorAll('[data-dep-settle]').forEach((b) => { b.onclick = () => openDepositSettle(Number(b.dataset.depSettle)); });
}

async function refreshDeposits() {
  await loadDeposits();
  renderDeposits(document.getElementById('homeDepositBox'));
  // 存款视图数量徽标同步
  const vt = document.getElementById('viewToggle');
  const db2 = vt ? vt.querySelector('[data-count="deposits"]') : null;
  if (db2) db2.textContent = (depositsCache || []).length;
}

function openDepositModal(d) {
  const isEdit = !!(d && d.id);
  document.getElementById('dep_id').value = isEdit ? d.id : '';
  document.getElementById('depModalTitle').textContent = isEdit ? '编辑存款' : '新增存款';
  document.getElementById('dep_name').value = isEdit ? (d.name || '') : '';
  document.getElementById('dep_amount').value = isEdit ? round4(d.amount) : '';
  document.getElementById('dep_rate').value = isEdit ? (d.rate || 0) : '';
  document.getElementById('dep_start').value = isEdit ? (d.start_date || '') : new Date().toISOString().slice(0, 10);
  document.getElementById('dep_end').value = isEdit ? (d.end_date || '') : '';
  document.getElementById('dep_note').value = isEdit ? (d.note || '') : '';
  document.getElementById('depErr').textContent = '';
  // 子账户下拉：全部现金子账户（币种标注）
  const sel = document.getElementById('dep_account');
  const accs = cashAccountsCache || [];
  sel.innerHTML = accs.length
    ? accs.map((a) => `<option value="${a.id}">${esc(a.name || '')}（${esc(a.source_name || '')} · ${curSymbolJS(a.currency || 'cny')}${fmt(a.amount || 0)}）</option>`).join('')
    : '<option value="">（暂无子账户，请先到资产页添加）</option>';
  if (isEdit && d.cash_account_id) sel.value = String(d.cash_account_id);
  else {
    const def = pickFallbackCash(accs);
    if (def) sel.value = String(def.id);
  }
  document.getElementById('depositModal').hidden = false;
}

$('#depositForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = document.getElementById('dep_id').value ? Number(document.getElementById('dep_id').value) : 0;
  const payload = {
    name: document.getElementById('dep_name').value.trim(),
    amount: round4(parseFloat(document.getElementById('dep_amount').value) || 0),
    rate: round4(parseFloat(document.getElementById('dep_rate').value) || 0),
    start_date: document.getElementById('dep_start').value || '',
    end_date: document.getElementById('dep_end').value || '',
    cash_account_id: Number(document.getElementById('dep_account').value) || 0,
    note: document.getElementById('dep_note').value.trim(),
  };
  const err = document.getElementById('depErr');
  if (!payload.name) { err.textContent = '名称不能为空'; return; }
  if (!(payload.amount > 0)) { err.textContent = '金额必须大于 0'; return; }
  if (!payload.start_date || !payload.end_date) { err.textContent = '起息日与到期时间必填'; return; }
  if (payload.end_date <= payload.start_date) { err.textContent = '到期时间必须晚于起息日'; return; }
  if (!payload.cash_account_id) { err.textContent = '请选择扣款 / 落袋子账户'; return; }
  try {
    const r = id
      ? await api('/api/asset/deposits/' + id, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/asset/deposits', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { let m = '保存失败'; try { const dd = await r.json(); if (dd && dd.error) m = dd.error; } catch (_) {} err.textContent = m; return; }
    document.getElementById('depositModal').hidden = true;
    toast('已保存', 'ok');
    await refreshDeposits();
    await loadAsset(); // 子账户余额已变（扣款/落袋）
  } catch (e2) { err.textContent = '异常：' + e2.message; }
};

async function deleteDeposit(id) {
  const d = (depositsCache || []).find((x) => x.id === id);
  if (!d) return;
  if (d.status === 'settled') { toast('已落袋的存款不可删除', 'err'); return; }
  if (!confirm(`删除存款「${d.name}」将按提前支取处理：本金 ${curSymbolJS(d.currency)}${fmt(d.amount)} 退回账户「${d.account_name || ''}」，继续？`)) return;
  try {
    const r = await api('/api/asset/deposits/' + id, { method: 'DELETE' });
    if (!r.ok) { let m = '删除失败'; try { const dd = await r.json(); if (dd && dd.error) m = dd.error; } catch (_) {} toast(m, 'err'); return; }
    toast('已删除并退回本金', 'ok');
    await refreshDeposits();
    await loadAsset();
  } catch (e) { toast('异常：' + e.message, 'err'); }
}

function openDepositSettle(id) {
  const d = (depositsCache || []).find((x) => x.id === id);
  if (!d || d.status === 'settled') return;
  depositSettleId = id;
  const cur = curSymbolJS(d.currency || 'cny');
  document.getElementById('depSettleDesc').innerHTML =
    `「${esc(d.name)}」到期：本金 <b>${cur}${fmt(d.amount)}</b> + 利息 将入账到「${esc(d.account_name || '')}」。<br>利息预填按年利率 ${(d.rate || 0).toFixed(2)}% × ${d.days || 0} 天估算，可改为实际利息；确认才落账。`;
  document.getElementById('depSettlePrincipal').value = cur + fmt(d.amount);
  document.getElementById('depSettleInterest').value = round4(d.expected_interest || 0);
  document.getElementById('depSettleErr').textContent = '';
  document.getElementById('depositSettleModal').hidden = false;
}

$('#depSettleOk').onclick = async () => {
  const interest = round4(parseFloat(document.getElementById('depSettleInterest').value) || 0);
  if (interest < 0) { document.getElementById('depSettleErr').textContent = '利息不能为负'; return; }
  try {
    const r = await api('/api/asset/deposits/' + depositSettleId + '/settle', { method: 'POST', body: JSON.stringify({ actual_interest: interest }) });
    if (!r.ok) { let m = '落袋失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} document.getElementById('depSettleErr').textContent = m; return; }
    document.getElementById('depositSettleModal').hidden = true;
    toast('已落袋：本金+利息入账', 'ok');
    await refreshDeposits();
    await loadAsset();
  } catch (e) { document.getElementById('depSettleErr').textContent = '异常：' + e.message; }
};
$('#depSettleCancel').onclick = () => { document.getElementById('depositSettleModal').hidden = true; };
$('#depCancel').onclick = () => { document.getElementById('depositModal').hidden = true; };
const depositSettleModalEl = document.getElementById('depositSettleModal');
if (depositSettleModalEl) depositSettleModalEl.addEventListener('click', (e) => { if (e.target === depositSettleModalEl) depositSettleModalEl.hidden = true; });
const depositModalEl = document.getElementById('depositModal');
if (depositModalEl) depositModalEl.addEventListener('click', (e) => { if (e.target === depositModalEl) depositModalEl.hidden = true; });

// ============================================================================
// AI 助手：聊天面板（入口 = 顶栏「AI 助手」按钮 #aiChatTopBtn）
// ----------------------------------------------------------------------------
// 会话落在后端（/api/ai/chats，按账本隔离），消息走 /api/ai/chat：
// 后端按 OpenAI function-calling 协议把「MCP 已对接的账本工具」与「持仓分析工具」
// 交给模型调用，因此助手既能查账本、记流水，也能做技术分析 / 买卖判断 / 持仓总结。
// ============================================================================

const aiChatState = { chats: [], curId: 0, msgs: [], busy: false, inited: false };
// 截图识别（纯 OCR）：OCR 引擎单例 worker，识别结果直接写进工作区（不进对话、不落库）
let aiOcrWorker = null;
let aiOcrEnginePromise = null;
// 打开截图识别时复用面板头部（标题换成「截图识别」），关闭后还原原先的标题 / 副标题
let aiOcrTitleBak = '';
let aiOcrSubBak = '';

// 聊天面板的模型下拉：与「设置 → AI」共享 aiCfg.models，但选中下标独立。
function renderAiChatModelSelect() {
  const sel = document.getElementById('aiChatModel');
  if (!sel) return;
  if (!Array.isArray(aiCfg.models) || !aiCfg.models.length) {
    aiCfg.models = [{ name: '默认', model: 'deepseek-v4-pro', api_key: '', base_url: 'https://api.deepseek.com' }];
  }
  if (aiChatModelIdx >= aiCfg.models.length || aiChatModelIdx < 0) aiChatModelIdx = 0;
  sel.innerHTML = aiCfg.models.map((m, i) => {
    const label = (m.name || ('模型' + (i + 1))) + (m.model ? ' · ' + m.model : '');
    return '<option value="' + i + '">' + esc(label) + '</option>';
  }).join('');
  sel.value = String(aiChatModelIdx);
}

// 取聊天面板当前选中的模型配置；Key 取所选模型自己的，
// 仅当所选正是设置面板正在编辑的那条时优先用输入框（刚填未保存也能立刻生效）。
function getAiChatModel() {
  if (!Array.isArray(aiCfg.models) || !aiCfg.models.length) return null;
  const i = (aiChatModelIdx >= 0 && aiChatModelIdx < aiCfg.models.length) ? aiChatModelIdx : 0;
  const m = aiCfg.models[i] || {};
  const editing = (aiChatModelIdx === aiModelIdx);
  const boxKey = ($('#ai_apikey') ? $('#ai_apikey').value : '').trim();
  const localKey = (aiCfg.models.length === 1) ? ((localStorage.getItem('pf_ai_key') || '').trim() || (aiCfg.api_key || '').trim()) : '';
  return {
    name: m.name || '默认',
    model: (m.model || '').trim() || 'deepseek-chat',
    base_url: (m.base_url || '').trim() || 'https://api.deepseek.com',
    api_key: (m.api_key || '').trim() || (editing ? boxKey : '') || localKey,
  };
}

function aiChatPanelEl() { return document.getElementById('aiChatPanel'); }

function aiChatOpen() {
  const p = aiChatPanelEl();
  if (!p) return;
  p.hidden = false;
  p.classList.add('open');
  if (!aiChatState.inited) { aiChatState.inited = true; aiChatLoadList(); }
  const inp = document.getElementById('aiChatInput');
  if (inp) setTimeout(() => inp.focus(), 60);
}

function aiChatClose() {
  const p = aiChatPanelEl();
  if (p) {
    aiOcrClose();
    p.hidden = true; p.classList.remove('open'); p.classList.remove('side-open');
    if (p.classList.remove('fullscreen')) {
      const btn = document.getElementById('aiChatFullscreen');
      if (btn) {
        btn.title = '全屏'; btn.setAttribute('aria-label', '全屏');
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>';
      }
    }
  }
}

function aiChatToggle() {
  const p = aiChatPanelEl();
  if (!p) return;
  if (p.hidden) aiChatOpen(); else aiChatClose();
}

// ---- 会话列表 ----
async function aiChatLoadList() {
  try {
    const r = await api('/api/ai/chats');
    if (!r.ok) return;
    const d = await r.json();
    aiChatState.chats = d.chats || [];
  } catch (_) { aiChatState.chats = []; }
  aiChatRenderList();
}

function aiChatRenderList() {
  const box = document.getElementById('aiChatList');
  if (!box) return;
  if (!aiChatState.chats.length) {
    box.innerHTML = '<p class="acp-empty">还没有对话，点头部的「＋」开始。</p>';
    return;
  }
  box.innerHTML = aiChatState.chats.map((c) => {
    const on = Number(c.id) === Number(aiChatState.curId) ? ' active' : '';
    return '<div class="acp-item' + on + '" data-id="' + c.id + '">'
      + '<span class="acp-item-title" title="' + esc(c.title || '新对话') + '">' + esc(c.title || '新对话') + '</span>'
      + '<button class="acp-item-edit" type="button" data-edit="' + c.id + '" title="重命名" aria-label="重命名">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>'
      + '</button>'
      + '<button class="acp-item-del" type="button" data-del="' + c.id + '" title="删除该对话" aria-label="删除该对话">✕</button>'
      + '</div>';
  }).join('');
}

// ---- 会话重命名 ----
async function aiChatRename(id, newTitle) {
  const t = (newTitle || '').trim();
  if (!t) return;
  try {
    const r = await api('/api/ai/chats/' + id, { method: 'PUT', body: JSON.stringify({ title: t }) });
    if (!r.ok) { toast('重命名失败', 'err'); return; }
    // 更新本地 state
    const c = aiChatState.chats.find((x) => Number(x.id) === Number(id));
    if (c) c.title = t;
    // 如果改的是当前选中的会话，同步 sub 标题
    if (Number(aiChatState.curId) === Number(id)) {
      const sub = document.getElementById('aiChatSub');
      if (sub) sub.textContent = t;
    }
    aiChatRenderList();
  } catch (e) { toast('重命名异常：' + e.message, 'err'); }
}

function aiChatStartRename(item) {
  const id = item.dataset.id;
  const titleEl = item.querySelector('.acp-item-title');
  if (!titleEl || !id) return;
  const curTitle = titleEl.textContent || '';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = curTitle;
  input.className = 'acp-item-rename-input';
  input.maxLength = 60;
  // 替换 title span
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const finish = (save) => {
    const val = input.value.trim();
    // 恢复 span
    const span = document.createElement('span');
    span.className = 'acp-item-title';
    span.title = val || curTitle;
    span.textContent = val || curTitle;
    input.replaceWith(span);
    if (save && val && val !== curTitle) aiChatRename(id, val);
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  // 阻止 input 上的 click 冒泡到 item（避免触发 select）
  input.addEventListener('click', (e) => e.stopPropagation());
}

async function aiChatSelect(id) {
  aiChatState.curId = Number(id) || 0;
  aiChatRenderList();
  const box = document.getElementById('aiChatMsgs');
  const sub = document.getElementById('aiChatSub');
  if (sub) {
    const c = aiChatState.chats.find((x) => Number(x.id) === Number(aiChatState.curId));
    sub.textContent = c ? (c.title || '新对话') : '新对话';
  }
  if (!box) return;
  box.innerHTML = '<div class="acp-loading"><span class="ana-spinner"></span></div>';
  try {
    const r = await api('/api/ai/chats/' + aiChatState.curId);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    aiChatState.msgs = d.messages || [];
  } catch (_) { aiChatState.msgs = []; }
  aiChatRenderMsgs();
}

async function aiChatNew() {
  // 窄屏：先收起会话抽屉、退出截图识别工作区，否则新会话被盖住看不见
  const pn = aiChatPanelEl();
  if (pn) pn.classList.remove('side-open');
  aiOcrClose();
  try {
    const r = await api('/api/ai/chats', { method: 'POST', body: JSON.stringify({ title: '新对话' }) });
    if (!r.ok) { toast('创建会话失败', 'err'); return; }
    const d = await r.json();
    await aiChatLoadList();
    await aiChatSelect(d.id);
    const inp = document.getElementById('aiChatInput');
    if (inp) { inp.value = ''; inp.focus(); }
  } catch (e) { toast('创建会话异常：' + e.message, 'err'); }
}

async function aiChatDelete(id) {
  const c = aiChatState.chats.find((x) => Number(x.id) === Number(id));
  openConfirm({
    title: '删除对话',
    msg: '确认删除对话「' + (c ? (c.title || '新对话') : id) + '」？该对话的全部消息将一并删除，不可恢复。',
    okText: '删除',
    danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/ai/chats/' + id, { method: 'DELETE' });
        if (!r.ok) { toast('删除失败', 'err'); return; }
        if (Number(aiChatState.curId) === Number(id)) {
          aiChatState.curId = 0;
          aiChatState.msgs = [];
          aiChatRenderMsgs();
          const sub = document.getElementById('aiChatSub');
          if (sub) sub.textContent = '新对话';
        }
        await aiChatLoadList();
        toast('已删除对话', 'ok');
      } catch (e) { toast('删除异常：' + e.message, 'err'); }
    },
  });
}

// ---- 消息区 ----
function aiFmtTime(ts) {
  if (!ts) return '';
  // 后端存的是 "YYYY-MM-DD HH:mm:ss"，Safari 不认空格，替换成 T
  let d = ts instanceof Date ? ts : new Date(String(ts).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // 非当天显示完整日期
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function aiChatRenderMsgs() {
  const box = document.getElementById('aiChatMsgs');
  if (!box) return;
  if (!aiChatState.msgs.length) {
    box.innerHTML = '<div class="acp-welcome">'
      + '<p class="acp-welcome-h">你好，我是持仓侠 AI 助手</p>'
      + '<p class="acp-welcome-p">我能直接读你的账本（持仓 / 理财 / 账户 / 现金），也能按你的指令记一笔流水。</p>'
      + '<ul class="acp-suggest">'
      + '<li data-q="帮我总结一下当前持仓">帮我总结一下当前持仓</li>'
      + '<li data-q="我的持仓里技术面最强和最弱的分别是哪只">技术面最强 / 最弱是哪只</li>'
      + '<li data-q="看看我的现金账户余额分布">看看现金账户余额分布</li>'
      // 动作型胶囊：不发消息，直接打开截图识别工作区（data-ocr 由 click 委托分流）
      + '<li class="acp-suggest-act" data-ocr="1">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg>'
      + '识别账单 / 持仓截图</li>'
      + '</ul>'
      + '<p class="acp-welcome-note">涉及买卖判断的结论仅供参考，不构成投资建议。</p>'
      + '</div>';
    return;
  }
  box.innerHTML = aiChatState.msgs.map((m) => {
    const timeHtml = m.created_at ? '<div class="ai-time">' + aiFmtTime(m.created_at) + '</div>' : '';
    if (m.role === 'user') {
      return '<div class="ai-msg user">' + timeHtml + '<div class="ai-bubble">' + esc(m.content) + '</div><div class="ai-avatar user-avatar">我</div></div>';
    }
    if (m.role === 'assistant') {
      return '<div class="ai-msg ai">' + timeHtml + '<div class="ai-avatar">AI</div><div class="ai-bubble md">' + renderMarkdown(m.content) + '</div></div>';
    }
    if (m.role === 'pending') {
      return '<div class="ai-msg ai"><div class="ai-avatar">AI</div><div class="ai-bubble acp-typing">'
        + '<span class="acp-dot"></span><span class="acp-dot"></span><span class="acp-dot"></span></div></div>';
    }
    // 本地图片消息（截图识别）已随输入区选图按钮一并移除，这里只保留纯文本三种角色
    return '';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function aiChatSetBusy(on) {
  aiChatState.busy = on;
  const b = document.getElementById('aiChatSend');
  if (b) { b.disabled = on; b.textContent = on ? '思考中…' : '发送'; }
  if (on) { const e = document.getElementById('aiChatErr'); if (e) e.textContent = ''; }
}

async function aiChatSend() {
  if (aiChatState.busy) return;
  const inp = document.getElementById('aiChatInput');
  const text = (inp ? inp.value : '').trim();
  if (!text) { toast('请输入内容', 'err'); return; }
  const m = getAiChatModel();
  if (!m || !m.api_key) {
    const e = document.getElementById('aiChatErr');
    if (e) e.textContent = '未配置 API Key：请到「设置 → AI → 模型与提示词」填写并保存。';
    toast('未配置 API Key', 'err');
    return;
  }
  inp.value = '';
  // 本地先渲染用户消息 + 思考中占位，等后端返回再补助手消息
  aiChatState.msgs = aiChatState.msgs.filter((x) => x.role !== 'pending');
  aiChatState.msgs.push({ role: 'user', content: text, created_at: new Date() });
  aiChatState.msgs.push({ role: 'pending', content: '' });
  aiChatRenderMsgs();
  aiChatSetBusy(true);
  try {
    const r = await api('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        chat_id: Number(aiChatState.curId) || 0,
        api_key: m.api_key,
        model: m.model,
        base_url: m.base_url,
        message: text,
      }),
    });
    const d = await r.json().catch(() => ({}));
    aiChatState.msgs = aiChatState.msgs.filter((x) => x.role !== 'pending');
    if (!r.ok) {
      const e = document.getElementById('aiChatErr');
      if (e) e.textContent = d.error || ('请求失败 HTTP ' + r.status);
      aiChatRenderMsgs();
      return;
    }
    aiChatState.msgs.push({ role: 'assistant', content: d.content || '', created_at: new Date() });
    aiChatRenderMsgs();
    if (!aiChatState.curId && d.chat_id) aiChatState.curId = Number(d.chat_id);
    if (d.title) {
      const sub = document.getElementById('aiChatSub');
      if (sub) sub.textContent = d.title;
    }
    await aiChatLoadList(); // 新会话落库后刷新左侧列表
    if (d.degraded) toast('该模型不支持工具调用，已按持仓上下文直接回答', 'info');
  } catch (err) {
    const e = document.getElementById('aiChatErr');
    if (e) e.textContent = '请求异常：' + err.message;
    aiChatRenderMsgs();
  } finally {
    aiChatSetBusy(false);
  }
}

// ============================================================================
// 截图识别（纯本地 OCR，不调用 AI）
// 引擎用成熟开源方案 tesseract.js（WASM + 中英混排字库）。资产不在任何境外 CDN：
// 构建时由 web/build.mjs 从 node_modules 拷进 web/dist/ocr/v<ver>/，随二进制一起
// 由本服务端同源提供，断网内网也能用；手机首次从自己服务器下一次（约 39MB），
// 之后由 HTTP immutable 缓存 + Service Worker 兜住，不会重复下载。
// 识别全程在浏览器内完成 —— 图片不上传服务器、不经过大模型。
// OCR 输出只做「结构化提示」（金额 / 余额 / 净值 / 日期 / 方向 / 可能的产品名），
// 再交给既有的流水 / 理财 / 余额对账弹框由用户确认落库（当前不自动写账）。
// ============================================================================
// ⚠ 必须与 web/package.json 里 tesseract.js 的版本一致：build.mjs 会强校验，
//   不一致直接构建失败（否则运行时会去请求不存在的版本目录 → 404）。
const AI_OCR_VER = '5.1.1';
const AI_OCR_BASE = '/ocr/v' + AI_OCR_VER;
const AI_OCR_LIB = AI_OCR_BASE + '/tesseract.min.js';
const AI_OCR_LANGS = 'chi_sim+eng';

// 状态文案写进面板副标题（工作区自己不再画标题行）；工作区未打开时不打扰会话标题。
function aiOcrStatus(msg) {
  const l = aiOcrLayerEl();
  const el = document.getElementById('aiChatSub');
  if (l && !l.hidden && el) el.textContent = msg || '本地 OCR · 不调用 AI';
  // 窄屏头部要塞两枚胶囊，副标题被隐藏（见 style.css 640 档），进度改由 facts 行兜底，
  // 否则手机端从选图到出结果之间没有任何反馈。已有识别结果（.acp-ocr-fact）时不覆盖。
  const fb = document.getElementById('aiOcrFacts');
  if (fb && msg && !fb.querySelector('.acp-ocr-fact')) fb.textContent = msg;
}

function aiOcrLoadEngine() {
  if (aiOcrEnginePromise) return aiOcrEnginePromise;
  aiOcrEnginePromise = new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(window.Tesseract); return; }
    const s = document.createElement('script');
    s.src = AI_OCR_LIB;
    s.async = true;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR 引擎加载异常')));
    s.onerror = () => {
      aiOcrEnginePromise = null;
      reject(new Error('OCR 引擎加载失败：' + AI_OCR_LIB + ' 不可达（服务端缺该版本资产，请重新部署）'));
    };
    document.head.appendChild(s);
  });
  return aiOcrEnginePromise;
}

async function aiOcrEnsureWorker() {
  const T = await aiOcrLoadEngine();
  if (aiOcrWorker) return aiOcrWorker;
  try {
    aiOcrWorker = await T.createWorker(AI_OCR_LANGS, 1, {
      // 三个路径全部指向本项目同源目录，createWorker 不再回落到 jsdelivr / tessdata。
      workerPath: AI_OCR_BASE + '/worker.min.js',
      corePath: AI_OCR_BASE,
      langPath: AI_OCR_BASE + '/lang',
      logger: (m) => {
        if (!m) return;
        const pct = Math.round((m.progress || 0) * 100);
        if (m.status === 'recognizing text') aiOcrStatus('正在识别文字… ' + pct + '%');
        else if (m.status.indexOf('traineddata') >= 0) aiOcrStatus('正在加载识别字库（首次约 39MB，之后本地缓存）… ' + pct + '%');
        else aiOcrStatus('正在初始化识别内核… ' + pct + '%');
      },
    });
  } catch (e) {
    // 失败后必须清掉单例，否则永远无法重试。
    aiOcrWorker = null;
    aiOcrEnginePromise = null;
    throw new Error('识别内核/字库加载失败：' + ((e && e.message) || e) + '（首次需自本机服务端下载约 39MB）');
  }
  return aiOcrWorker;
}

function aiOcrReadFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('图片读取失败'));
    fr.readAsDataURL(file);
  });
}

// 识别前放大图片 —— 这不是画质优化，是准确率的分水岭。
// 手机截图多为 390–430px 宽、正文 12–13px，汉字笔画糊在一起时 chi_sim 会整段误判成拉丁串：
// 实测同一条流水截图，原图认成「(=) Esl / 白 BI / ER BEXEEREE」，放大 2 倍后变成
// 「交通 -5.00 / 餐饮 -16.00 / 鸡鸣汤包(仙鹤门店)」。放大 3 倍反而开始丢小数点，故封顶 3 倍。
// 目标：把短图拉到 ~900px 宽（tesseract 舒适行高 30–40px），原图已够宽则不缩放。
function aiOcrPreprocess(file) {
  return new Promise((resolve) => {
    if (!file || !/^image\//.test(String(file.type || ''))) { resolve(file); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    img.onload = () => {
      try {
        const w0 = img.naturalWidth || 0;
        const scale = w0 > 0 ? Math.min(3, 900 / w0) : 1;
        if (!(scale > 1.02)) { done(file); return; }
        const c = document.createElement('canvas');
        c.width = Math.round(w0 * scale);
        c.height = Math.round((img.naturalHeight || 0) * scale);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((blob) => done(blob || file), 'image/png');
      } catch (_) { done(file); }
    };
    img.onerror = () => done(file);
    img.src = url;
  });
}

// OCR 文本 → 结构化提示。命中不了就留空，交给用户手填，不做"猜也得猜一个"的幻觉填充。
// ---- 产品名识别：OCR 文本归一化 + 候选行打分 + 与账本已有名称的模糊匹配 ----
// 两个坑（2026-10-28 用真实截图实测确认）：
//   ① 直接取第一行当名称，拿到的往往是「持有产品 / 按持有市值」这类表头；
//   ② tesseract 的 chi_sim 会在汉字之间插空格，并把全角「（）」认成「{}」「)(」，
//      所以「整行 substring 匹配」必然失败。这里统一归一化后再按最长公共子序列打分。

// 归一化：只保留可比较的字符（去空白、标点、连接符；括号/形近符号统一成半角）
function ocrNorm(s) {
  return String(s || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（{［\[]/g, '(')
    .replace(/[）}］\]]/g, ')')
    .replace(/[-—–－_ـ·•.\/\\|]/g, '')
    .replace(/[“”"'’‘`~!@#$%^&*+=,，、。:：;；?？!！¢¥]/g, '')
    .trim();
}

// 展示用清洗：去掉汉字之间的碎空格，括号统一全角（更贴近账本里的写法）
function ocrNameDisplay(raw) {
  return String(raw || '')
    .replace(/\s+/g, '')
    .replace(/[({［\[]/g, '（')
    .replace(/[)}］\]]/g, '）')
    .replace(/^[-,，、:：]+|[-,，、:：]+$/g, '')
    .slice(0, 40);
}

// 最长公共子序列长度（名字都很短，O(n·m) 足够）
function ocrLcsLen(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  let prev = new Uint16Array(m + 1);
  let cur = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cur[j] = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const t = prev; prev = cur; cur = t; cur.fill(0);
  }
  return prev[m];
}

// 相似度 0~1：公共子序列 / 较长串长度（对「多认了几个字」「少认了几个字」都不敏感）
function ocrNameScore(a, b) {
  const x = ocrNorm(a);
  const y = ocrNorm(b);
  if (!x || !y) return 0;
  return ocrLcsLen(x, y) / Math.max(x.length, y.length);
}

// 包含式命中（原名或归一化后任一方向包含即可）——给账户名这类「短名」用
function nameLooseHit(key, name) {
  const k = String(key || '').trim();
  const n = String(name || '').trim();
  if (!k || !n) return false;
  if (n.indexOf(k) >= 0 || k.indexOf(n) >= 0) return true;
  const kn = ocrNorm(k);
  const nn = ocrNorm(n);
  return !!kn && !!nn && (nn.indexOf(kn) >= 0 || kn.indexOf(nn) >= 0);
}

// 表头 / 字段名 / 风险提示行：这些不是产品名
const OCR_NAME_NOISE = /持有产品|持有市值|按持有|累计收益|日收益|昨日收益|单位净值|最新净值|参考市值|市值|收益|余额|可用|金额|份额|产品有风险|投资须谨慎|非存款|活钱管理|总资产|资产|时间|状态|确认|买入|卖出|赎回|费率|日期|序号|操作|详情|全部|持仓|排序/;
// 理财/存款类产品的常见构词：命中越多越像产品名
const OCR_NAME_HINT = /理财|基金|计划|号|版|银行|现金|宝|债|存单|信托|资管|集合|净值型|投资|成长|稳健|稳富|安心|天天/g;

// 按「汉字数 + 语义词」给每行打分，返回最像产品名的候选（最多 4 个，按分排序）
function aiOcrNameCandidates(text) {
  const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const raw of lines) {
    const norm = ocrNorm(raw);
    if (norm.length < 4) continue;                          // 太短：多半是「美元」「收益」这类标签
    const han = (norm.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (han < 3) continue;                                  // 中文太少：数字行 / 英文标签
    if (OCR_NAME_NOISE.test(norm)) continue;                 // 表头 / 字段名 / 提示语
    const hint = (norm.match(OCR_NAME_HINT) || []).length;
    let score = Math.min(han, 12) + Math.min(hint * 3, 9);
    if (norm.length > 28) score -= (norm.length - 28) * 1.2; // 过长：多半整行糊在一起
    out.push({ text: ocrNameDisplay(raw), norm: norm, score: score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 4);
}

// 理财/基金截图的「持有市值」：表格版式常是「数字在上、表头在下」
// （4,757.24 换行后才是「持有市值(美元) 累计收益 日收益(10-27)」），
// 所以不能只用「标签在前」的正向抓取，要能从含标签的行往邻行找数字。
// 邻行里的日期（10-27）、百分比、序号必须先剔掉，否则会把「27」当成金额。
function aiOcrHolding(t) {
  const s = String(t || '').replace(/(\d)\s*,\s*(\d)/g, '$1,$2'); // 「4 , 757.24」→「4,757.24」
  // 只剔「日期形态」的数字：10-27 / 10/27 / 10月27 / 2026-10-27。
  // 分隔符里不能含「.」—— 否则 4,757.24 会被当成「757 月 24」整段删掉（曾踩）。
  const dateRe = /\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}|\d{1,2}\s*[-/月]\s*\d{1,2}(?![\d,.])/g;
  const grab = (line) => {
    const clean = String(line).replace(dateRe, ' ').replace(/[(（][^)）]*[)）]/g, ' ');
    const nums = (clean.match(/\d[\d,]*(?:\.\d+)?/g) || [])
      .map((x) => parseFloat(x.replace(/,/g, '')))
      .filter((v) => isFinite(v) && v > 0 && !(v >= 1900 && v <= 2100 && Number.isInteger(v)));
    return nums.length ? Math.max.apply(null, nums) : null;
  };
  const lines = s.split('\n').map((x) => x.trim()).filter(Boolean);
  // tesseract 的 chi_sim 会在汉字之间插空格（「持 有 市 值」），标签判定必须先挤掉所有空白
  const KW = /持有市值|持仓市值|持有金额|持仓金额|总市值|市值/;
  for (let i = 0; i < lines.length; i++) {
    if (!KW.test(lines[i].replace(/\s+/g, ''))) continue;
    const same = grab(lines[i]);
    if (same != null) return same;
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
      const v = grab(lines[j]);
      if (v != null) return v;
    }
    for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
      const v = grab(lines[j]);
      if (v != null) return v;
    }
  }
  return null;
}

function aiOcrParse(text) {
  // 千分位被 OCR 用空格隔开（「4 , 757.24」）会让数字在后面的正则里断成两截，先归一化
  const t = String(text || '').replace(/(\d)\s*,\s*(\d)/g, '$1,$2');
  const f = { amount: null, balance: null, nav: null, holding: null, date: '', out: false, name: '', names: [] };
  const near = (kw) => {
    const m = new RegExp(kw + '[^\\d\\n]{0,10}(-?\\d[\\d,]*\\.?\\d*)').exec(t);
    if (!m) return null;
    const v = parseFloat(String(m[1]).replace(/,/g, ''));
    return isFinite(v) ? Math.abs(v) : null;
  };
  f.nav = near('(?:单位净值|最新净值|净值)');
  f.balance = near('(?:可用余额|账户余额|当前余额|余额)');
  f.amount = near('(?:交易金额|发生额|变动金额|金额|合计|总计)');
  f.holding = aiOcrHolding(t);
  if (f.amount == null && f.balance == null) {
    // 兜底：取文本里最大的非年份数字（银行/券商截图里金额通常是页面上最大的数）
    const nums = (t.match(/\d[\d,]*\.?\d*/g) || [])
      .map((s) => parseFloat(String(s).replace(/,/g, '')))
      .filter((v) => isFinite(v) && v > 0 && v < 1e9 && !(v >= 1900 && v <= 2100 && Number.isInteger(v)));
    if (nums.length) f.amount = Math.max.apply(null, nums);
  }
  const dm = /(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/.exec(t) || /(\d{1,2})[-/月](\d{1,2})/.exec(t);
  if (dm) {
    const y = dm[1].length === 4 ? dm[1] : String(new Date().getFullYear());
    const p = (n) => String(n).padStart(2, '0');
    f.date = y + '-' + p(dm[dm.length - 2]) + '-' + p(dm[dm.length - 1]);
  }
  f.out = /支出|转出|付款|支付|消费|扣款|还款|取出|买入/.test(t);
  // 名称不再取「第一行」，而是按打分挑最像产品名的那行（见 aiOcrNameCandidates）
  const cands = aiOcrNameCandidates(t);
  f.names = cands.map((c) => c.text);
  f.name = f.names[0] || '';
  // 批量流水：记账本类截图一次能出多条，单条录入会逼用户重复操作 N 遍
  f.flows = aiOcrFlows(t);
  return f;
}

// ---- 流水列表解析（批量录入）----
// 记账本 / 银行 App 的明细页结构高度一致：
//   10 月 27 日 昨天   出 21.00  入 0.00     ← 日期分隔行（带当日合计，不是流水）
//   交通 -5.00                              ← 分类 + 金额（左侧图标常被认成「网」「口」等噪声）
//   18:28 | 南京市栖霞区停车设施管…          ← 时间 + 商户
// 解析按「日期行切上下文 → 金额行建记录 → 紧随的时间行补备注」推进；
// 认不出的行一律跳过，绝不猜：漏一条让用户手补，比凭空造一条账更糟。
const OCR_FLOW_CATS = [
  [/交通|出行|打车|地铁|公交|停车|加油|高铁|机票|火车|滴滴/, 'living'],
  [/餐饮|美食|外卖|咖啡|奶茶|超市|购物|日用|娱乐|电影|生活|便利|水果|零食|餐|饮|食/, 'living'],
  [/房租|物业|水电|燃气|宽带|居住|家政/, 'housing'],
  [/医院|药|医疗|体检|诊所|教育|学费|培训|书店|文具/, 'edu_health'],
  [/保险/, 'insurance'],
  [/还款|信用卡|房贷|车贷|分期|借呗|花呗/, 'debt'],
  [/税/, 'tax'],
  [/工资|薪|奖金|报销/, 'salary'],
  [/分红|利息|收益|理财|基金/, 'invest_div'],
];
function aiOcrFlowCat(raw) {
  // chi_sim 会在每个汉字后插空格（「人 交 通」），先挤掉空白再匹配，否则连「交通」都命中不了
  const s = String(raw || '').replace(/\s+/g, '');
  for (const [re, key] of OCR_FLOW_CATS) if (re.test(s)) return key;
  return 'other_out';
}

// 分类文本清洗：左侧图标会被认成「人」「白」「(0)」等噪声，去掉空白后取最后一段汉字
function aiOcrCatWord(pre) {
  const s = String(pre || '').replace(/\s+/g, '');
  const segs = s.match(/[\u4e00-\u9fa5]{1,8}/g);
  return segs && segs.length ? segs[segs.length - 1] : '';
}

// 备注清洗：去列表截断的省略号、首尾噪声符号，并挤掉汉字/括号之间的碎空格
// （「南 京 市 栖 霞 区」→「南京市栖霞区」；英文商户名里的空格原样保留）
function aiOcrNoteClean(s) {
  const t = String(s || '')
    .replace(/\.{2,}|…+/g, '')
    .replace(/^[|丨\s:：,，-]+|[|丨\s]+$/g, '')
    .trim();
  return t.replace(/([\u4e00-\u9fa5（）()])\s+(?=[\u4e00-\u9fa5（）()])/g, '$1').slice(0, 60);
}

function aiOcrFlows(text) {
  const pad = (n) => String(n).padStart(2, '0');
  let year = new Date().getFullYear();
  let date = '';
  let last = null;
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    // 悬浮按钮 / 底部导航等界面噪声
    if (/记\s*[-—一]?\s*笔|明\s*细\s*统\s*计|全部类型|总\s*支\s*出/.test(l)) continue;
    const ym = /(20\d{2})\s*年/.exec(l);
    if (ym) year = Number(ym[1]);
    // ① 日期分隔行：切日期上下文；行内「出 xx 入 xx」是当日合计，不是流水
    const dm = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(l);
    if (dm) {
      date = year + '-' + pad(Number(dm[1])) + '-' + pad(Number(dm[2]));
      last = null;
      continue;
    }
    if (!date) continue;
    // ② 时间 + 商户行：给上一条流水补备注
    const tm = /^[^\d:]{0,4}(\d{1,2}):(\d{2})\s*[|丨]?\s*(.+)$/.exec(l);
    if (tm && last && !last.note) {
      last.time = pad(Number(tm[1])) + ':' + pad(Number(tm[2]));
      last.note = aiOcrNoteClean(tm[3]);
      last = null;
      continue;
    }
    // ③ 分类 + 金额行：行尾必须是带两位小数的金额
    const am = /^(.*?)([-+])?\s*(\d[\d,]*\.\d{2})\s*$/.exec(l);
    if (!am) continue;
    const amt = Number(String(am[3]).replace(/,/g, ''));
    if (!isFinite(amt) || amt <= 0) continue; // 0.00 只是占位
    // 日期没认出来时，「出 3.80 入 0.00」这类汇总行会落到这里，按双金额特征剔掉
    if (/出\s*[\d,]+\.\d{2}/.test(l) && /[入A]\s*[\d,]+\.\d{2}/.test(l)) continue;
    const catRaw = aiOcrCatWord(am[1]);
    last = { date, time: '', cat: aiOcrFlowCat(catRaw), catRaw, amount: am[2] === '-' ? -amt : amt, note: '' };
    out.push(last);
  }
  return out;
}

function aiOcrFactsHtml(f) {
  // 多条流水（记账本/银行明细）走批量录入，此时「产品/净值/余额」这些持仓语义字段全是误判，不展示
  if (f.flows && f.flows.length >= 2) {
    const dates = [...new Set(f.flows.map((r) => r.date))].sort();
    const out = f.flows.reduce((s, r) => s + (r.amount < 0 ? r.amount : 0), 0);
    return (
      '<span class="acp-ocr-fact">流水 <b>' + f.flows.length + ' 条</b></span>' +
      '<span class="acp-ocr-fact">日期 <b>' + esc(dates[0].slice(5)) + ' ~ ' + esc(dates[dates.length - 1].slice(5)) + '</b></span>' +
      '<span class="acp-ocr-fact">支出合计 <b>' + fmt(Math.abs(out)) + '</b></span>'
    );
  }
  const chips = [];
  if (f.name) chips.push('产品 <b>' + esc(f.name) + '</b>');
  if (f.holding != null) chips.push('持有市值 <b>' + f.holding + '</b>');
  if (f.amount != null && f.amount !== f.holding) chips.push('金额 <b>' + f.amount + '</b>');
  if (f.balance != null) chips.push('余额 <b>' + f.balance + '</b>');
  if (f.nav != null) chips.push('净值 <b>' + f.nav + '</b>');
  if (f.date) chips.push('日期 <b>' + esc(f.date) + '</b>');
  chips.push('方向 <b>' + (f.out ? '支出' : '收入') + '</b>');
  return chips.map((c) => '<span class="acp-ocr-fact">' + c + '</span>').join('');
}

function aiOcrFirstLine(text) {
  const l = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
  return l.slice(0, 60);
}

// 把识别到的「今日持仓金额」预填进「更新理财持仓」（= 理财快照，POST /api/asset/wealth/snapshots）
// 的对应行。只预填不提交：快照写入会联动现金账户、并影响当日盈亏与审计记录，必须用户确认。
async function aiOcrPrefillSnap(w, amt) {
  await openSnapModal(); // 内部已 await loadAsset()，行 id 为 amt-<wealth_id> / cf-<wealth_id>
  const amtEl = document.getElementById('amt-' + w.id);
  if (!amtEl) {
    toast('「' + w.name + '」不在持仓更新列表里（可能已清仓停用）', 'err');
    return;
  }
  const row = amtEl.closest('.snap-row');
  const cfEl = document.getElementById('cf-' + w.id);
  if (amtEl.disabled) {
    // 建仓态：持仓金额由「今日净存入」派生且输入框禁用 → 填净存入，金额自动跟随
    if (!cfEl || cfEl.disabled) {
      toast('「' + w.name + '」今日已建仓，如需调整请到「每日盈亏 → 审计记录」撤销', 'info');
      return;
    }
    cfEl.value = String(round2(amt));
    snapCfSync(cfEl);
  } else {
    amtEl.value = String(round2(amt));
    amtEl.dataset.touched = '1'; // 已手工填入，阻止净存入联动把它覆盖回「上次值 + 本次变动」
  }
  if (row) {
    row.classList.add('ocr-hit');
    row.scrollIntoView({ block: 'center' });
  }
  const focusEl = amtEl.disabled ? cfEl : amtEl;
  if (focusEl) setTimeout(() => { try { focusEl.focus(); focusEl.select(); } catch (_) {} }, 80);
  // 文案保持一行内：手机上 toast 会压在弹框标题上，产品名已由高亮行指明，不必重复
  toast('已填入今日持仓 ' + moneyCur(amt, w.currency) + '，核对后保存', 'ok');
}

// 三个引导动作：只负责「带着识别结果打开对应弹框并预填」，写库仍由用户点确认。
async function aiOcrGuide(act, text) {
  const f = aiOcrParse(text);
  if (act === 'flow') {
    // 多条流水（记账本 / 银行明细截图）→ 走批量确认表格；单条才走原来的添加流水弹框
    if (f.flows && f.flows.length >= 2) { await openFlowBatchModal(f.flows); return; }
    await openFlowModal(f.out ? 'out' : 'in');
    const d = document.getElementById('flow_delta');
    const v = f.amount != null ? f.amount : f.balance;
    if (d && v != null) d.value = String(v);
    const dd = document.getElementById('flow_date');
    if (dd && f.date) dd.value = f.date; // 补录历史流水：日期跟截图走，不落成今天
    const n = document.getElementById('flow_note');
    // 说明用识别到的产品名（已清洗空格/括号），比原始第一行更可读
    if (n) n.value = '截图识别：' + (f.name || aiOcrFirstLine(text));
    return;
  }
  if (act === 'wealth') {
    // /api/home 的 wealth 是 { products: [...] }；/api/asset/wealth 的 wealth 是数组，两者都兜住
    let list = ((assetData && assetData.wealth) || {}).products || ((assetData && assetData.wealth) || {}).items || [];
    if (!list.length) {
      try { const r = await api('/api/asset/wealth'); if (r.ok) { const d = await r.json(); list = (d && d.wealth) || []; } } catch (_) {}
    }
    // 候选名逐个跟账本里的理财比相似度，取最高分；低于阈值宁可当没匹配上，
    // 也不要因为「都含理财两个字」就张冠李戴。
    const cands = (f.names && f.names.length ? f.names : (f.name ? [f.name] : [])).filter(Boolean);
    let hit = null;
    let best = 0;
    for (const c of cands) {
      for (const w of list) {
        const s = ocrNameScore(c, (w && w.name) || '');
        if (s > best) { best = s; hit = w; }
      }
    }
    if (hit && best < 0.62) hit = null;
    if (hit) {
      // 持仓截图给的是「持有市值」→ 走理财快照的今日持仓金额，而不是净值
      const amt = f.holding != null ? f.holding : f.amount;
      if (amt != null && amt > 0) { await aiOcrPrefillSnap(hit, amt); return; }
      await openWealthNavModal(hit.id);
      const navEl = document.getElementById('wn_nav');
      if (navEl && f.nav != null) navEl.value = String(f.nav);
      else toast('已匹配「' + hit.name + '」，未识别到持仓金额或净值，请手动填入', 'info');
      return;
    }
    await openWealthModal(0);
    const nameEl = document.getElementById('w_name');
    if (nameEl && f.name) nameEl.value = f.name;
    const navEl2 = document.getElementById('w_nav');
    if (navEl2 && f.nav != null) navEl2.value = String(f.nav);
    toast('未匹配到已有理财，已打开新增理财', 'info');
    return;
  }
  if (act === 'balance') {
    await openBalanceSyncModal();
    const v = f.balance != null ? f.balance : f.amount;
    if (v == null) { toast('未识别到余额数字，请在弹框里手动填写', 'info'); return; }
    const key = (f.name || '').trim();
    let acc = key ? (cashAccountsCache || []).find((c) => nameLooseHit(key, c && c.name)) : null;
    if (!acc) acc = pickFallbackCash(cashAccountsCache);
    const inp = acc ? document.querySelector('.bsync-input[data-cash="' + acc.id + '"]') : null;
    if (inp) { inp.value = String(v); inp.focus(); }
    else toast('未匹配到账户，请在弹框里选择后填写 ' + v, 'info');
  }
}

function aiOcrLayerEl() { return document.getElementById('aiOcrLayer'); }

// ---- 批量流水确认弹框 ----
// 截图一次能出 N 条，逐条开弹框录入等于让用户重做一遍手工记账。
// 这里把识别结果铺成可勾选、可改的表格，确认后按「日期从旧到新」逐条写入：
// 顺序影响余额校验（先花后花 vs 先花后收），逆序会让本不该失败的记录报余额不足。
let fbState = [];

function fbCatOptionsHtml(cur) {
  const seen = new Set();
  const opts = [];
  for (const o of finCatOptions('expense').concat(finCatOptions('income'))) {
    if (seen.has(o.key)) continue;
    seen.add(o.key);
    opts.push(`<option value="${esc(o.key)}"${o.key === cur ? ' selected' : ''}>${esc(o.label)}</option>`);
  }
  return opts.join('');
}

function fbRowsHtml() {
  return fbState.map((r, i) => `
    <div class="fb-row" data-i="${i}">
      <input class="fb-on" type="checkbox" checked aria-label="录入这一条">
      <span class="fb-date">${esc(String(r.date || '').slice(5))}</span>
      <select class="fb-cat" aria-label="收支分类">${fbCatOptionsHtml(r.cat)}</select>
      <input class="fb-amt" type="number" step="0.01" value="${Number(r.amount || 0).toFixed(2)}" aria-label="金额">
      <input class="fb-note" value="${esc(r.note || r.catRaw || '')}" placeholder="说明" aria-label="说明">
    </div>`).join('');
}

// 从 DOM 读当前值（DOM 是唯一真源，避免每次输入都重渲染把焦点弄丢）
function fbCollect() {
  const rows = [];
  document.querySelectorAll('#fbRows .fb-row').forEach((el) => {
    if (!el.querySelector('.fb-on').checked) return;
    const src = fbState[Number(el.dataset.i)] || {};
    const amount = Math.round(Number(el.querySelector('.fb-amt').value || 0) * 100) / 100;
    if (!amount) return;
    rows.push({
      date: src.date,
      time: src.time || '',
      amount,
      cat: el.querySelector('.fb-cat').value,
      note: el.querySelector('.fb-note').value.trim(),
    });
  });
  return rows;
}

function fbUpdateSum() {
  const rows = fbCollect();
  const out = rows.reduce((s, r) => s + (r.amount < 0 ? r.amount : 0), 0);
  const inn = rows.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
  const el = document.getElementById('fbSum');
  if (el) el.textContent = `勾选 ${rows.length} 条 · 支出 ${fmt(Math.abs(out))} · 收入 ${fmt(inn)}`;
}

async function openFlowBatchModal(flows) {
  if (!flows || !flows.length) { toast('没有识别到流水', 'err'); return; }
  await loadCashAccounts();
  fbState = flows.map((f) => ({ ...f }));
  // 默认账户：记账本截图基本来自支付宝/微信/零钱这类日常账户；直接「余额最大」会选到公积金、
  // 定期存款这种明显不该记日常消费的账户。先按名字找日常账户，否则从非储蓄类账户里选余额最大的。
  const list = cashAccountsCache || [];
  const daily = list.find((c) => /支付宝|微信|零钱|余额宝|现金|日常|花呗/.test(String(c.name || '')));
  const notDaily = /公积金|社保|医保|定期|理财|基金|股票|投资|保证金|冻结/;
  const pool = list.filter((c) => !notDaily.test(String(c.name || '') + String(c.note || '')));
  const acc = daily || pickFallbackCash(pool.length ? pool : list);
  const sel = document.getElementById('fb_cash');
  sel.innerHTML = (cashAccountsCache || []).map((c) =>
    `<option value="${c.id}"${acc && Number(c.id) === Number(acc.id) ? ' selected' : ''}>${esc(flowCashLabel(c))}</option>`).join('');
  if (!sel.innerHTML) { toast('还没有现金子账户，请先在资产页新建', 'err'); return; }
  const box = document.getElementById('fbRows');
  box.innerHTML = fbRowsHtml();
  box.oninput = fbUpdateSum;
  box.onchange = fbUpdateSum;
  document.getElementById('fbErr').textContent = '';
  fbUpdateSum();
  document.getElementById('flowBatchModal').hidden = false;
}

async function fbSubmit() {
  const cashId = Number(document.getElementById('fb_cash').value || 0);
  if (!cashId) { document.getElementById('fbErr').textContent = '请选择子账户'; return; }
  const rows = fbCollect();
  if (!rows.length) { document.getElementById('fbErr').textContent = '没有勾选任何流水'; return; }
  rows.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const btn = document.getElementById('fbSave');
  btn.disabled = true;
  let ok = 0;
  let err = '';
  for (const r of rows) {
    const res = await api('/api/asset/cash/adjust', {
      method: 'POST',
      body: JSON.stringify({
        cash_id: cashId,
        delta: r.amount,
        note: r.note || '截图批量录入',
        category: r.cat,
        date: r.date,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      err = (d && d.error) || '写入失败';
      break;
    }
    ok++;
  }
  btn.disabled = false;
  if (err) {
    document.getElementById('fbErr').textContent = `已写入 ${ok} 条，第 ${ok + 1} 条失败：${err}`;
    await loadAsset();
    return;
  }
  document.getElementById('flowBatchModal').hidden = true;
  await loadAsset();
  toast(`已录入 ${ok} 条流水`, 'ok');
}

if (document.getElementById('fbSave')) document.getElementById('fbSave').onclick = fbSubmit;
if (document.getElementById('fbCancel')) {
  document.getElementById('fbCancel').onclick = () => { document.getElementById('flowBatchModal').hidden = true; };
}

function aiOcrReset() {
  const drop = document.getElementById('aiOcrDrop');
  const res = document.getElementById('aiOcrResult');
  if (drop) drop.hidden = false;
  if (res) res.hidden = true;
  const ta = document.getElementById('aiOcrText');
  if (ta) ta.value = '';
  const fb = document.getElementById('aiOcrFacts');
  if (fb) fb.innerHTML = '';
  aiOcrStatus('');
}

function aiOcrOpen() {
  const p = aiChatPanelEl();
  if (p && p.hidden) aiChatOpen();
  if (p) p.classList.remove('side-open'); // 窄屏：进工作区前先收起会话抽屉
  const l = aiOcrLayerEl();
  if (!l) return;
  // 标题复用面板头部：把「AI 助手」换成「截图识别」，副标题显示引擎状态
  const titleEl = document.getElementById('aiChatTitle');
  const subEl = document.getElementById('aiChatSub');
  if (titleEl && !aiOcrTitleBak) aiOcrTitleBak = titleEl.textContent;
  if (subEl && !aiOcrSubBak) aiOcrSubBak = subEl.textContent;
  if (titleEl) titleEl.textContent = '截图识别';
  l.hidden = false;
  aiOcrReset();
}

function aiOcrClose() {
  const l = aiOcrLayerEl();
  if (!l || l.hidden) return;
  l.hidden = true;
  // 还原面板头部（会话标题 / 副标题）
  const titleEl = document.getElementById('aiChatTitle');
  const subEl = document.getElementById('aiChatSub');
  if (titleEl && aiOcrTitleBak) titleEl.textContent = aiOcrTitleBak;
  if (subEl && aiOcrSubBak) subEl.textContent = aiOcrSubBak;
  aiOcrTitleBak = '';
  aiOcrSubBak = '';
}

// 识别一张图并填充工作区（右上角「截图识别」入口）
async function aiOcrHandleFile(file) {
  if (!file) return;
  if (!/^image\//.test(String(file.type || ''))) { toast('请选择图片文件', 'err'); return; }
  const layer = aiOcrLayerEl();
  if (layer) layer.hidden = false;
  const drop = document.getElementById('aiOcrDrop');
  const res = document.getElementById('aiOcrResult');
  const ta = document.getElementById('aiOcrText');
  const fb = document.getElementById('aiOcrFacts');
  const img = document.getElementById('aiOcrImg');
  if (drop) drop.hidden = true;
  if (res) res.hidden = false;
  if (ta) ta.value = '';
  if (fb) fb.innerHTML = '';
  let dataUrl = '';
  try { dataUrl = await aiOcrReadFile(file); } catch (err) { toast(err.message, 'err'); return; }
  if (img) img.src = dataUrl;
  try {
    const w = await aiOcrEnsureWorker();
    aiOcrStatus('正在识别文字…');
    // 先放大再识别：手机截图正文只有 12–13px，原图直喂会把整行汉字认成拉丁字母（见 aiOcrPreprocess）
    const { data } = await w.recognize(await aiOcrPreprocess(file));
    const txt = ((data && data.text) || '').trim();
    if (ta) ta.value = txt;
    if (fb) fb.innerHTML = txt ? aiOcrFactsHtml(aiOcrParse(txt)) : '';
    aiOcrStatus(txt ? '识别完成' : '未识别到文字');
    if (!txt) toast('未识别到文字，换一张更清晰的截图试试', 'err');
  } catch (err) {
    aiOcrStatus('识别失败');
    toast('OCR 失败：' + (err && err.message ? err.message : err), 'err');
  }
}

// ---- 事件绑定（全部走 document 级委托，避免动态节点绑不上） ----
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest('#aiChatFullscreen')) {
    const p = aiChatPanelEl();
    if (p) {
      const fs = p.classList.toggle('fullscreen');
      const btn = document.getElementById('aiChatFullscreen');
      if (btn) {
        btn.title = fs ? '退出全屏' : '全屏';
        btn.setAttribute('aria-label', fs ? '退出全屏' : '全屏');
        btn.innerHTML = fs
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>';
      }
    }
    return;
  }
  if (t.closest('#aiChatClose')) { aiChatClose(); return; }
  if (t.closest('#aiChatNew')) { aiChatNew(); return; }
  if (t.closest('#aiChatSend')) { aiChatSend(); return; }
  // ---- 截图识别（纯 OCR）----
  if (t.closest('#aiChatOcr')) { aiOcrOpen(); return; }
  if (t.closest('#aiChatSideClose')) {
    const p2 = aiChatPanelEl();
    if (p2) p2.classList.remove('side-open');
    return;
  }
  if (t.closest('#aiOcrClose')) { aiOcrClose(); return; }
  if (t.closest('#aiOcrPick')) { const fi = document.getElementById('aiOcrFile'); if (fi) fi.click(); return; }
  if (t.closest('#aiOcrClear')) { aiOcrReset(); return; }
  const ocrAct = t.closest('[data-ocr-act]');
  if (ocrAct) {
    const fromLayer = document.getElementById('aiOcrText');
    aiOcrGuide(ocrAct.dataset.ocrAct, fromLayer ? fromLayer.value : '');
    return;
  }
  if (t.closest('#aiChatListToggle')) {
    const p = aiChatPanelEl();
    if (p) p.classList.toggle('side-open');
    return;
  }
  // 手机端抽屉：打开时点击侧栏以外的面板区域（聊天区/建议项/输入区）→ 只收起抽屉，面板保留
  const panelNow = aiChatPanelEl();
  if (panelNow && !panelNow.hidden && panelNow.classList.contains('side-open')
      && !t.closest('.acp-side') && !t.closest('#aiChatListToggle')) {
    panelNow.classList.remove('side-open');
    return;
  }
  const sug = t.closest('.acp-suggest li');
  if (sug) {
    // 动作型胶囊（截图识别）：不是提问，直接开工作区，别把文案填进输入框
    if (sug.dataset.ocr) { aiOcrOpen(); return; }
    const inp = document.getElementById('aiChatInput');
    if (inp) { inp.value = sug.dataset.q || ''; inp.focus(); }
    return;
  }
  const item = t.closest('.acp-item');
  if (item) {
    const del = t.closest('.acp-item-del');
    if (del && del.dataset.del) { aiChatDelete(del.dataset.del); return; }
    const edit = t.closest('.acp-item-edit');
    if (edit) { aiChatStartRename(item); return; }
    // 从「聊天记录」切会话：若正在截图识别工作区，先退回聊天区（还原面板标题）
    aiOcrClose();
    if (item.dataset.id) aiChatSelect(item.dataset.id);
    // 手机端：选中会话后顺手收起抽屉（桌面端无 side-open 类，不受影响）
    const pp = aiChatPanelEl();
    if (pp) pp.classList.remove('side-open');
    return;
  }
  // 点击面板之外：收起，避免遮挡主界面
  // 注意：顶栏「AI 助手」入口 #aiChatTopBtn 必须排除，
  // 否则它 opener 的 click 冒泡到此处会被误判为「外部点击」把刚打开的面板又关掉。
  const p = aiChatPanelEl();
  if (p && !p.hidden && !t.closest('.ai-chat-panel') && !t.closest('#aiChatTopBtn') && !t.closest('.modal')) {
    aiChatClose();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // 截图识别工作区优先响应 Esc（它盖在聊天区之上，应先收它而不是整个面板）
  const ol = aiOcrLayerEl();
  if (ol && !ol.hidden) { aiOcrClose(); return; }
  const p = aiChatPanelEl();
  if (!p || p.hidden) return;
  if (document.querySelectorAll('.modal:not([hidden])').length) return; // 弹框优先关闭
  if (p.classList.contains('fullscreen')) {
    p.classList.remove('fullscreen');
    const btn = document.getElementById('aiChatFullscreen');
    if (btn) {
      btn.title = '全屏';
      btn.setAttribute('aria-label', '全屏');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>';
    }
    return;
  }
  aiChatClose();
});

(function initAiChatInput() {
  const inp = document.getElementById('aiChatInput');
  if (inp) {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        aiChatSend();
      }
    });
  }
  const sel = document.getElementById('aiChatModel');
  if (sel) sel.onchange = () => { aiChatModelIdx = parseInt(sel.value, 10) || 0; };
})();

// 截图识别的图片入口：两个隐藏 file input + 粘贴 + 拖拽，最终都汇到 OCR / 发送图片两个函数。
(function initAiChatOcr() {
  const bindFile = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const f = el.files && el.files[0];
      if (f) fn(f);
      el.value = ''; // 允许连续选同一张图
    });
  };
  bindFile('aiOcrFile', aiOcrHandleFile);

  // 粘贴截图：工作区开着 → 直接识别；焦点在聊天输入框 → 先打开工作区再识别
  // （截图识别唯一入口是面板头部的 #aiChatOcr，粘图只是快捷方式，统一落到同一工作区）
  document.addEventListener('paste', (e) => {
    const items = ((e.clipboardData || {}).items) || [];
    let img = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.kind === 'file' && /^image\//.test(String(it.type || ''))) { img = it.getAsFile(); break; }
    }
    if (!img) return;
    const layer = aiOcrLayerEl();
    if (layer && !layer.hidden) { e.preventDefault(); aiOcrHandleFile(img); return; }
    const p = aiChatPanelEl();
    const inp = document.getElementById('aiChatInput');
    if (p && !p.hidden && inp && e.target === inp) { e.preventDefault(); aiOcrOpen(); aiOcrHandleFile(img); }
  });

  // 拖拽进工作区投放区（整层可接，不必精确落在虚线框上）
  const zone = document.getElementById('aiOcrLayer');
  const drop = document.getElementById('aiOcrDrop');
  if (zone) {
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      if (drop) drop.classList.add('is-over');
    }));
    zone.addEventListener('dragleave', () => { if (drop) drop.classList.remove('is-over'); });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (drop) drop.classList.remove('is-over');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) aiOcrHandleFile(f);
    });
  }
})();


/* ============================================================================
 * 基金定投（DCA）
 * 计划只排期不动账；每一期由用户确认后才加仓 + 扣款，成交价/份额可改、可撤销。
 * ========================================================================== */
const DCA_INTERVALS = [
  { v: 'daily', t: '每日' },
  { v: 'weekly', t: '每周' },
  { v: 'biweekly', t: '每两周' },
  { v: 'monthly', t: '每月' },
  { v: 'quarterly', t: '每季' },
];
let dcaPlans = [];
let dcaCurPlan = null;      // 记录弹框当前计划
let dcaCurRecords = [];
let dcaEditing = null;      // 计划弹框正在编辑的计划（null=新建）
let dcaInterval = 'monthly';
let dcaExecRec = null;      // 执行弹框当前期次
let dcaExecMode = 'exec';   // exec | edit

const dcaIvLabel = (v) => (DCA_INTERVALS.find((x) => x.v === v) || { t: '每月' }).t;
const dcaCur = (p) => curSymbolJS(p.currency || 'CNY');

async function loadDCA() {
  try {
    const r = await api('/api/dca/plans');
    if (!r.ok) return;
    const d = await r.json();
    dcaPlans = d.plans || [];
  } catch (e) { /* 静默 */ }
  // 仅在计划列表弹框打开时重绘（首页已无常驻卡片）
  const pm = document.getElementById('dcaPlansModal');
  if (pm && !pm.hidden) renderDCAPlans();
}

// 定投计划列表（顶部操作条 #dcaBtn 入口）
async function openDCAPlans() {
  await loadDCA();
  renderDCAPlans();
  document.getElementById('dcaPlansModal').hidden = false;
}

function renderDCAPlans() {
  const list = document.getElementById('dcaPlansBody');
  if (!list) return;
  const actives = dcaPlans.filter((p) => p.status !== 'ended');
  const ended = dcaPlans.filter((p) => p.status === 'ended');
  const all = actives.concat(ended);
  if (!all.length) {
    list.innerHTML = '<div class="dca-empty">还没有定投计划</div>';
    return;
  }
  list.innerHTML = all.map((p) => {
    const st = p.status === 'ended' ? 'ended' : (p.pending_count > 0 && p.status === 'active' ? 'due' : 'ok');
    const tag = p.status === 'ended' ? '<span class="dca-tag paused">已结束</span>'
      : p.status === 'paused' ? '<span class="dca-tag paused">已暂停</span>'
        : (p.pending_count > 0 ? '<span class="dca-tag due">' + p.pending_count + ' 期待确认</span>' : '');
    const next = p.status === 'ended' ? '—' : (p.next_date ? (Number(p.next_date.slice(5, 7)) + '/' + Number(p.next_date.slice(8, 10))) : '—');
    return '<div class="dca-row ' + st + '" data-id="' + p.id + '">'
      + '<div class="dca-main">'
      + '<div class="dca-name">' + esc(p.holding_name || '—') + ' ' + tag + '</div>'
      + '<div class="dca-meta">' + dcaCur(p) + fmt(p.amount) + ' · ' + dcaIvLabel(p.interval) + ' · 下次 ' + next + '</div>'
      + '</div>'
      + '<button class="cf-edit" data-act="dca-edit" data-id="' + p.id + '" title="编辑计划" aria-label="编辑计划">' + actIcon('edit') + '</button>'
      + '</div>';
  }).join('');
  list.querySelectorAll('.dca-row').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('[data-act="dca-edit"]')) {
        const p = dcaPlans.find((x) => x.id === Number(el.dataset.id));
        document.getElementById('dcaPlansModal').hidden = true;
        openDCAModal(p);
        return;
      }
      document.getElementById('dcaPlansModal').hidden = true;
      openDCAHist(Number(el.dataset.id));
    };
  });
}

// ---------------- 计划弹框 ----------------
async function openDCAModal(p) {
  dcaEditing = p || null;
  await loadCashAccounts();
  await loadSourcesCache(); // 供资金子账户下拉显示所属账户名
  const sel = document.getElementById('dcaHolding');
  const hs = (allHoldings || []).slice().sort((a, b) => (isFund(a) ? -1 : 0) - (isFund(b) ? -1 : 0));
  sel.innerHTML = hs.map((h) => '<option value="' + h.id + '">' + esc(h.name) + (h.symbol ? ' · ' + esc(h.symbol) : '') + '</option>').join('')
    + '<option value="0">＋ 新建基金…</option>';
  dcaInterval = p ? p.interval : 'monthly';
  document.getElementById('dcaTitle').textContent = p ? '编辑定投计划' : '新建定投计划';
  if (p) sel.value = String(p.holding_id);
  else if (hs.length) sel.value = String(hs[0].id);
  toggleDCANew();
  document.getElementById('dcaAmount').value = p ? round2(p.amount) : '';
  document.getElementById('dcaMax').value = p && p.max_amount > 0 ? round2(p.max_amount) : '';
  document.getElementById('dcaDay').value = p ? (p.day_of_month || 1) : 1;
  document.getElementById('dcaStart').value = p ? (p.start_date || '') : todayStr();
  document.getElementById('dcaEnd').value = p ? (p.end_date || '') : '';
  document.getElementById('dcaNote').value = p ? (p.note || '') : '';
  document.getElementById('dcaFeeRate').value = p && p.fee_rate > 0 ? round4(p.fee_rate) : '';
  renderDCAInterval();
  fillDCACash(p);
  document.getElementById('dcaErr').textContent = '';
  document.getElementById('dcaModal').hidden = false;
}

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + dd;
}

function renderDCAInterval() {
  const box = document.getElementById('dcaInterval');
  if (!box) return;
  box.innerHTML = DCA_INTERVALS.map((x) => '<button class="dca-pill' + (dcaInterval === x.v ? ' active' : '') + '" type="button" data-iv="' + x.v + '">' + x.t + '</button>').join('');
  box.querySelectorAll('.dca-pill').forEach((b) => {
    b.onclick = () => { dcaInterval = b.dataset.iv; renderDCAInterval(); };
  });
  const dayRow = document.getElementById('dcaDayRow');
  if (dayRow) dayRow.hidden = !(dcaInterval === 'monthly' || dcaInterval === 'quarterly');
}

// 标的选「＋ 新建基金…」时露出搜索框；切回已有标的则收起。
// 两个分支都做重置：确保「已选标的」确认条（dcaNewPicked）只在用户从联想列表
// 点选完成后才出现——进入/离开新建模式时若残留上次的选中态，会让人误以为已填好。
function resetDCANew() {
  dcaNewPicked = null;
  const ids = ['dcaNewSearch', 'dcaNewName', 'dcaNewSymbol'];
  ids.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  const picked = document.getElementById('dcaNewPicked');
  if (picked) { picked.hidden = true; picked.innerHTML = ''; }
  const box = document.getElementById('dcaSuggest');
  if (box) { box.hidden = true; box.innerHTML = ''; }
}
function toggleDCANew() {
  const sel = document.getElementById('dcaHolding');
  const box = document.getElementById('dcaNewBox');
  if (!sel || !box) return;
  box.hidden = sel.value !== '0';
  resetDCANew();
}

// 资金子账户：二级折叠选择器（同「添加持仓 · 账户币种」）。只列与标的同账户（银行/证券）同币种的子账户；
// 无匹配时退化为全部真实账户，绝不回退虚拟项。
function dcaSetSelection(acc) {
  const hid = document.getElementById('dcaCash');
  if (hid) hid.value = acc ? acc.id : '0';
  const btn = document.getElementById('dcaCashBtn');
  if (btn) btn.textContent = acc ? flowCashLabel(acc) : '请选择子账户';
}
function fillDCACash(p) {
  const panel = document.getElementById('dcaCashPanel');
  if (!panel) return;
  const hidEl = Number(document.getElementById('dcaHolding').value) || (p ? p.holding_id : 0);
  const h = (allHoldings || []).find((x) => x.id === hidEl);
  const src = h ? Number(h.source_id || 0) : 0;
  const cur = h ? String(h.currency || '').toLowerCase() : '';
  const match = (c) => (!src || Number(c.source_id) === src) && (!cur || String(c.currency).toLowerCase() === cur);
  let fSrc = src || null;
  let fCur = cur || null;
  let accs = (cashAccountsCache || []).filter(match);
  if (!accs.length) { fSrc = null; fCur = null; accs = (cashAccountsCache || []).slice(); }
  setPickerHTML(panel, accs.length
    ? buildFlowPicker(fSrc, fCur)
    : '<div class="ac-picker-empty">暂无可用子账户，请先在「账户」中添加</div>');
  const wanted = p && p.cash_account_id ? String(p.cash_account_id) : '';
  const preset = (wanted && accs.find((c) => String(c.id) === wanted))
    || pickFallbackCash(accs) || null;
  dcaSetSelection(preset);
  // 展开时标出当前选中项
  if (preset) {
    const row = panel.querySelector('.ac-pick-row[data-id="' + preset.id + '"]');
    if (row) row.classList.add('on');
  }
}

// 新增基金：名称/代码联动搜索（复用 /api/search，选中即回填名称+代码，与持仓弹框一致）
let dcaNewPicked = null;
function wireDcaSearch() {
  const inp = document.getElementById('dcaNewSearch');
  const box = document.getElementById('dcaSuggest');
  if (!inp || !box) return;
  let timer = null;
  const hide = () => { box.hidden = true; };
  inp.addEventListener('input', () => {
    const q = inp.value.trim();
    dcaNewPicked = null;
    document.getElementById('dcaNewPicked').hidden = true;
    document.getElementById('dcaNewPicked').innerHTML = '';
    document.getElementById('dcaNewName').value = q;     // 未从联想选中时，暂用输入文本当名称
    document.getElementById('dcaNewSymbol').value = '';
    if (timer) clearTimeout(timer);
    if (!q) { hide(); box.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api('/api/search?q=' + encodeURIComponent(q));
        if (!r.ok) { hide(); return; }
        const d = await r.json();
        const items = (d.results || []).filter((it) => (it.category || 'stock') === 'fund').slice(0, 12);
        if (!items.length) { hide(); box.innerHTML = ''; return; }
        box.innerHTML = items.map((it, i) => (
          '<button type="button" class="f-suggest-item" data-i="' + i + '">'
          + '<span class="f-si-name">' + esc(it.name) + '</span>'
          + '<span class="f-si-code">' + esc(it.symbol) + '</span>'
          + '<span class="f-si-mkt">' + esc(SEARCH_MKT_TO_PF[it.market] || it.market || '') + '</span>'
          + '</button>'
        )).join('');
        box.hidden = false;
        box.querySelectorAll('.f-suggest-item').forEach((b) => {
          b.onclick = (ev) => { ev.preventDefault(); pickDcaSuggestion(items[Number(b.dataset.i)]); };
        });
      } catch (_) { hide(); }
    }, 220);
  });
  inp.addEventListener('focus', () => { if (box.innerHTML) box.hidden = false; });
  document.addEventListener('click', (e) => {
    if (!box.hidden && e.target !== inp && !box.contains(e.target)) hide();
  });
}
function pickDcaSuggestion(it) {
  dcaNewPicked = { name: it.name, symbol: it.symbol };
  document.getElementById('dcaNewName').value = it.name;
  document.getElementById('dcaNewSymbol').value = it.symbol;
  document.getElementById('dcaNewSearch').value = it.name + ' · ' + it.symbol;
  document.getElementById('dcaSuggest').hidden = true;
  document.getElementById('dcaSuggest').innerHTML = '';
  const picked = document.getElementById('dcaNewPicked');
  picked.hidden = false;
  picked.innerHTML = '<span>' + esc(it.name) + ' <b>' + esc(it.symbol) + '</b></span><button type="button" class="df-picked-x" type="button" title="清除">×</button>';
  picked.querySelector('.df-picked-x').onclick = () => {
    dcaNewPicked = null;
    document.getElementById('dcaNewSearch').value = '';
    document.getElementById('dcaNewName').value = '';
    document.getElementById('dcaNewSymbol').value = '';
    picked.hidden = true;
    picked.innerHTML = '';
  };
}

async function saveDCAPlan() {
  const errEl = document.getElementById('dcaErr');
  errEl.textContent = '';
  const holdingID = Number(document.getElementById('dcaHolding').value) || 0;
  const amount = parseFloat(document.getElementById('dcaAmount').value) || 0;
  const max = parseFloat(document.getElementById('dcaMax').value) || 0;
  if (!holdingID && !(document.getElementById('dcaNewName').value || '').trim()) { errEl.textContent = '请选择标的或填写新基金名称'; return; }
  if (amount <= 0) { errEl.textContent = '每期金额必须大于 0'; return; }
  const payload = {
    holding_id: holdingID,
    amount,
    interval: dcaInterval,
    day_of_month: parseInt(document.getElementById('dcaDay').value, 10) || 1,
    start_date: document.getElementById('dcaStart').value || '',
    end_date: document.getElementById('dcaEnd').value || '',
    max_amount: max,
    fee_rate: parseFloat(document.getElementById('dcaFeeRate').value) || 0,
    cash_account_id: Number(document.getElementById('dcaCash').value) || 0,
    note: document.getElementById('dcaNote').value.trim(),
  };
  if (!holdingID) {
    payload.create_holding = {
      name: document.getElementById('dcaNewName').value.trim(),
      symbol: document.getElementById('dcaNewSymbol').value.trim(),
      category: 'fund',
      market: '',
    };
  }
  if (dcaEditing) payload.status = dcaEditing.status;
  const r = await api(dcaEditing ? '/api/dca/plans/' + dcaEditing.id : '/api/dca/plans', {
    method: dcaEditing ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { errEl.textContent = d.error || '保存失败'; return; }
  document.getElementById('dcaModal').hidden = true;
  toast(dcaEditing ? '已更新定投计划' : '已创建定投计划', 'ok');
  await loadDCA();
  if (dcaEditing) await load();
}

// ---------------- 记录弹框 ----------------
async function openDCAHist(planId) {
  const r = await api('/api/dca/plans/' + planId + '/records');
  if (!r.ok) { toast('加载定投记录失败', 'err'); return; }
  const d = await r.json();
  dcaCurPlan = d.plan || dcaPlans.find((x) => x.id === planId) || null;
  dcaCurRecords = d.records || [];
  renderDCAHist();
  document.getElementById('dcaHistModal').hidden = false;
}

function renderDCAHist() {
  const p = dcaCurPlan;
  if (!p) return;
  document.getElementById('dcaHistTitle').textContent = (p.holding_name || '定投') + ' 定投记录';
  const head = document.getElementById('dcaHistHead');
  if (head) {
    const stTxt = p.status === 'paused' ? '已暂停' : (p.status === 'ended' ? '已结束' : '进行中');
    const dayTag = (p.interval === 'monthly' || p.interval === 'quarterly') ? ' ' + (p.day_of_month || 1) + '日' : '';
    head.innerHTML = '<span class="dh-item"><i>每期</i>' + dcaCur(p) + fmt(p.amount) + '</span>'
      + '<span class="dh-item"><i>间隔</i>' + dcaIvLabel(p.interval) + dayTag + '</span>'
      + '<span class="dh-item"><i>已投</i>' + (p.done_count || 0) + ' 期 / ' + dcaCur(p) + fmt(p.done_amount || 0) + '</span>'
      + '<span class="dh-item"><i>状态</i>' + stTxt + '</span>'
      + (p.max_amount > 0 ? '<span class="dh-item"><i>限购</i>≤ ' + dcaCur(p) + fmt(p.max_amount) + '</span>' : '')
      + (p.end_date ? '<span class="dh-item"><i>截止</i>' + esc(p.end_date) + '</span>' : '');
  }
  const body = document.getElementById('dcaHistBody');
  if (!dcaCurRecords.length) {
    body.innerHTML = '<div class="dca-empty">暂无期次记录</div>';
  } else {
    body.innerHTML = dcaCurRecords.map((r) => {
      const stCls = r.status === 'done' ? 'done' : (r.status === 'skipped' ? 'skipped' : 'pending');
      const stTxt = r.status === 'done' ? '已投' : (r.status === 'skipped' ? '已跳过' : '待确认');
      const amt = r.status === 'done' ? (r.actual_amount || 0) : (r.amount || 0);
      const detail = r.status === 'done'
        ? dcaCur(p) + fmt(amt) + '｜价 ' + round4(r.price) + '｜份额 ' + round4(r.quantity) + (r.fee > 0 ? '｜费 ' + round2(r.fee) : '')
        : dcaCur(p) + fmt(amt) + (r.note ? '｜' + esc(r.note) : '');
      const acts = r.status === 'done'
        ? '<button class="btn btn-sm" data-act="dca-modify" data-id="' + r.id + '">修改</button>'
          + '<button class="btn btn-sm" data-act="dca-revert" data-id="' + r.id + '">撤销</button>'
        : '<button class="btn btn-sm" data-act="dca-exec" data-id="' + r.id + '">' + (r.status === 'skipped' ? '执行' : '确认') + '</button>'
          + '<button class="btn btn-sm" data-act="dca-skip" data-id="' + r.id + '">' + (r.status === 'skipped' ? '恢复' : '跳过') + '</button>';
      return '<div class="dh-row ' + stCls + '">'
        + '<div class="dh-main">'
        + '<div class="dh-date">' + esc(r.plan_date) + '<span class="dh-seq">第' + r.seq + '期</span><span class="dh-st ' + stCls + '">' + stTxt + '</span></div>'
        + '<div class="dh-detail">' + detail + '</div>'
        + '</div>'
        + '<div class="dh-acts">' + acts + '</div>'
        + '</div>';
    }).join('');
    body.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.id);
        const rec = dcaCurRecords.find((x) => x.id === id);
        const act = b.dataset.act;
        if (act === 'dca-exec' || act === 'dca-modify') openDCAExec(rec, act === 'dca-modify' ? 'edit' : 'exec');
        else if (act === 'dca-skip') dcaSkip(id);
        else if (act === 'dca-revert') dcaRevert(id);
      };
    });
  }
  const stBtn = document.getElementById('dcaHistStatus');
  if (stBtn) stBtn.textContent = p.status === 'paused' ? '恢复' : (p.status === 'ended' ? '重启' : '暂停');
  const delBtn = document.getElementById('dcaHistDelete');
  if (delBtn) delBtn.hidden = p.status === 'ended';
}

async function dcaSkip(id) {
  const r = await api('/api/dca/records/' + id + '/skip', { method: 'POST' });
  if (!r.ok) { const d = await r.json().catch(() => ({})); toast(d.error || '操作失败', 'err'); return; }
  toast('已更新', 'ok');
  await refreshDCAHist();
}

async function dcaRevert(id) {
  openConfirm({
    title: '撤销该期定投',
    msg: '将回滚本次加仓份额与资金扣款，记录退回待确认。',
    okText: '撤销',
    danger: true,
    onOk: async () => {
      const r = await api('/api/dca/records/' + id + '/revert', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || '撤销失败', 'err'); return; }
      toast('已撤销', 'ok');
      await loadCashAccounts();
      await load();
      await refreshDCAHist();
    },
  });
}

// 刷新当前记录弹框内容（计划 + 期次）
async function refreshDCAHist() {
  const p = dcaCurPlan;
  if (!p) return;
  const r = await api('/api/dca/plans/' + p.id + '/records');
  if (!r.ok) return;
  const d = await r.json();
  dcaCurPlan = d.plan || p;
  dcaCurRecords = d.records || [];
  renderDCAHist();
  await loadDCA();
}

// ---------------- 执行 / 修改弹框 ----------------
function openDCAExec(rec, mode) {
  if (!rec) return;
  dcaExecRec = rec;
  dcaExecMode = mode || 'exec';
  const h = (allHoldings || []).find((x) => x.id === rec.holding_id);
  const p = dcaCurPlan || {};
  document.getElementById('dcaExecTitle').textContent = mode === 'edit' ? '修改该期成交' : '确认该期定投';
  const priceEl = document.getElementById('dcaExecPrice');
  const qtyEl = document.getElementById('dcaExecQty');
  const amtEl = document.getElementById('dcaExecAmt');
  const feeEl = document.getElementById('dcaExecFee');
  priceEl.value = mode === 'edit' ? round4(rec.price) : round4(h && h.current_price > 0 ? h.current_price : 0);
  feeEl.value = mode === 'edit' ? round2(rec.fee) : round2((rec.amount || 0) * ((p.fee_rate || 0) / 100));
  amtEl.value = round2(mode === 'edit' ? (rec.actual_amount || 0) : (rec.amount || 0));
  syncDCAQtyFromAmt();
  document.getElementById('dcaExecHint').textContent = esc(rec.plan_date) + ' · 第' + rec.seq + '期 · ' + esc(p.holding_name || '');
  document.getElementById('dcaExecErr').textContent = '';
  document.getElementById('dcaExecModal').hidden = false;
  qtyEl.oninput = () => syncDCAAmtFromQty();
  amtEl.oninput = () => syncDCAQtyFromAmt();
  priceEl.oninput = () => syncDCAQtyFromAmt();
  feeEl.oninput = () => syncDCAQtyFromAmt();
}

function syncDCAQtyFromAmt() {
  const price = parseFloat(document.getElementById('dcaExecPrice').value) || 0;
  const amt = parseFloat(document.getElementById('dcaExecAmt').value) || 0;
  const fee = parseFloat(document.getElementById('dcaExecFee').value) || 0;
  const q = price > 0 ? (amt - fee) / price : 0;
  document.getElementById('dcaExecQty').value = q > 0 ? round4(q) : '';
}
function syncDCAAmtFromQty() {
  const price = parseFloat(document.getElementById('dcaExecPrice').value) || 0;
  const qty = parseFloat(document.getElementById('dcaExecQty').value) || 0;
  const fee = parseFloat(document.getElementById('dcaExecFee').value) || 0;
  document.getElementById('dcaExecAmt').value = round2(qty * price + fee);
}

async function submitDCAExec() {
  const errEl = document.getElementById('dcaExecErr');
  errEl.textContent = '';
  const price = parseFloat(document.getElementById('dcaExecPrice').value) || 0;
  const qty = parseFloat(document.getElementById('dcaExecQty').value) || 0;
  const fee = parseFloat(document.getElementById('dcaExecFee').value) || 0;
  if (price <= 0) { errEl.textContent = '成交价必须大于 0'; return; }
  if (qty <= 0) { errEl.textContent = '份额必须大于 0'; return; }
  const rec = dcaExecRec;
  const url = dcaExecMode === 'edit' ? '/api/dca/records/' + rec.id : '/api/dca/records/' + rec.id + '/execute';
  const r = await api(url, {
    method: dcaExecMode === 'edit' ? 'PUT' : 'POST',
    body: JSON.stringify({ price, quantity: qty, fee }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { errEl.textContent = d.error || '操作失败'; return; }
  document.getElementById('dcaExecModal').hidden = true;
  toast(dcaExecMode === 'edit' ? '已按新成交价重记' : '已记入持仓与资金账户', 'ok');
  await loadCashAccounts();
  await load();
  await refreshDCAHist();
}

// ---------------- 计划状态 / 删除 ----------------
async function dcaToggleStatus() {
  const p = dcaCurPlan;
  if (!p) return;
  if (p.status === 'active') {
    openConfirm({
      title: '暂停定投',
      msg: '暂停后不再生成新的待确认期次（应对限购 / 暂停申购 / 关门）。已生成的期次仍可确认。',
      okText: '暂停',
      onOk: () => doDCAStatus(p.id, 'paused'),
    });
  } else {
    doDCAStatus(p.id, 'active');
  }
}

async function doDCAStatus(id, st) {
  const r = await api('/api/dca/plans/' + id + '/status', { method: 'POST', body: JSON.stringify({ status: st }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { toast(d.error || '操作失败', 'err'); return; }
  toast(st === 'paused' ? '已暂停' : '已恢复', 'ok');
  await refreshDCAHist();
}

async function dcaDeletePlan() {
  const p = dcaCurPlan;
  if (!p) return;
  openConfirm({
    title: '删除定投计划',
    msg: '已执行过的计划不能删除（资金链路需留痕），可改为暂停或结束。',
    okText: '删除',
    danger: true,
    onOk: async () => {
      const r = await api('/api/dca/plans/' + p.id, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || '删除失败', 'err'); return; }
      document.getElementById('dcaHistModal').hidden = true;
      toast('已删除', 'ok');
      await loadDCA();
    },
  });
}

// ---------------- 事件绑定（静态元素） ----------------
(function bindDCA() {
  const h = document.getElementById('dcaHolding');
  if (h) h.onchange = () => { toggleDCANew(); fillDCACash(null); };
  wireDcaSearch(); // 新增基金：名称/代码联动搜索（仅绑定一次）
  const save = document.getElementById('dcaSave');
  if (save) save.onclick = () => saveDCAPlan();
  const cancel = document.getElementById('dcaCancel');
  if (cancel) cancel.onclick = () => { document.getElementById('dcaModal').hidden = true; };
  const he = document.getElementById('dcaHistEdit');
  if (he) he.onclick = () => { document.getElementById('dcaHistModal').hidden = true; openDCAModal(dcaCurPlan); };
  const hs = document.getElementById('dcaHistStatus');
  if (hs) hs.onclick = () => dcaToggleStatus();
  const hd = document.getElementById('dcaHistDelete');
  if (hd) hd.onclick = () => dcaDeletePlan();
  const eo = document.getElementById('dcaExecOk');
  if (eo) eo.onclick = () => submitDCAExec();
  const ec = document.getElementById('dcaExecCancel');
  if (ec) ec.onclick = () => { document.getElementById('dcaExecModal').hidden = true; };
})();

// ===== 再平衡（2026-10-27 重新引入）=====
// 口径（经确认）：股票 / 基金 / 理财 / 现金 四大类，不细到 asset_type 行业标签。
// 市值、权重、偏离、建议金额全部由 GET /api/rebalance 在服务端算好，
// 前端只负责呈现 + 勾选 + 记录，避免两边各算一套导致数字对不上。
// 注：RB_CLASS_LABEL / RB_CLASS_COLOR / rbData / rbPicked / rbHistoryLogs
// 已在文件顶部 VIEWS 之后声明（那里必须早于同步执行的 applyRoute()）。
// 动作文案按类别区分：理财在实务里叫「赎回/申购」，现金叫「转出/补入」，
// 只有股票/基金才说「卖出/买入」。后端只给 sell|buy 语义，措辞在前端落地。
function rbActionLabel(key, action) {
  if (action === 'none') return '—';
  if (key === 'cash') return action === 'sell' ? '转出' : '补入';
  if (key === 'wealth') return action === 'sell' ? '赎回' : '申购';
  return action === 'sell' ? '卖出' : '买入';
}

async function showRebalanceView() {
  const v = document.getElementById('rebalanceView');
  if (v) v.hidden = false; // hideAllViews 后必须显式恢复，否则页面空白
  await loadRebalance();
}

async function loadRebalance() {
  const body = document.getElementById('rbDriftBody');
  const loading = '<tr><td colspan="6"><div class="rb-act-empty">计算中…</div></td></tr>';
  if (body && !rbData) body.innerHTML = loading;
  if (!rbData) setRbActualLoading();
  try {
    // 两条接口并行：配置偏离（此刻快照）+ 本期兑现（区间实测）。兑现失败不阻塞主表。
    const [r, ra] = await Promise.all([
      api('/api/rebalance'),
      api('/api/rebalance/actual?period=' + encodeURIComponent(rbPeriod)).catch(() => null),
    ]);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    rbData = await r.json();
    rbActual = ra && ra.ok ? await ra.json() : null;
    // 默认勾选全部偏离项，用户可逐项取消（记录时只存勾选的）
    rbPicked = new Set((rbData.buckets || []).filter((b) => b.action !== 'none').map((b) => b.key));
    renderRebalance();
    loadRbHistory();
  } catch (e) {
    if (body) body.innerHTML = '<tr><td colspan="6"><div class="rb-act-empty">再平衡计算失败：' + esc(e.message) + '</div></td></tr>';
  }
}

// 只换周期时不必重拉 /api/rebalance：配置部分与区间无关，重渲染两张卡即可。
async function loadRbActual(period) {
  rbPeriod = period || rbPeriod;
  const box = document.getElementById('rbActualBody');
  if (box) box.innerHTML = '<tr><td colspan="8"><div class="rb-act-empty">计算中…</div></td></tr>';
  try {
    const r = await api('/api/rebalance/actual?period=' + encodeURIComponent(rbPeriod));
    rbActual = r.ok ? await r.json() : null;
  } catch (_) {
    rbActual = null;
  }
  if (rbData) renderRbKpi();
  renderRbActual();
  renderRbTop();
}

// —— 再平衡页渲染（2026-10-27 v2：叠加收益维度）——
// 收益三个口径全部由服务端算好（GET /api/rebalance 的 returns 对象），前端只负责呈现。
// 这里不重新计算，避免两边算法漂移导致 KPI 与表格对不上。
const rbYuan = (v) => (Number(v) < 0 ? '−¥' : '¥') + Math.abs(Math.round(Number(v) || 0)).toLocaleString('en-US');
const rbSignedYuan = (v) => {
  const n = Math.round(Number(v) || 0);
  if (n === 0) return '¥0';
  return (n < 0 ? '−¥' : '+¥') + Math.abs(n).toLocaleString('en-US');
};
const rbFixed = (v, d = 2) => (Number(v) || 0).toFixed(d);
const rbPP = (v, d = 2) => {
  const n = Number(v) || 0;
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d) + 'pp';
};
// 带符号百分比（收益率用；pp 用 rbPP，两者语义不同不能混）
const rbSignedPct = (v, d = 2) => {
  const n = Number(v) || 0;
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d) + '%';
};
const rbActCls = (v) => (Number(v) > 0 ? 'up' : Number(v) < 0 ? 'down' : '');
// 兑现率：预期金额极小时（如某类月预期仅 ¥67）比例会飙到四位数，直接截断而不是显示 1468%
const rbHitTxt = (exp, hit) => {
  if (!(Number(exp) > 0.005)) return '—';
  const h = Number(hit) || 0;
  if (h > 999) return '≥999%';
  if (h < -999) return '≤−999%';
  return rbFixed(h, 0) + '%';
};

function renderRebalance() {
  if (!rbData) return;
  renderRbKpi();
  renderRbInsight();
  renderRbDrift();
  renderRbActual();
  renderRbTop();
  const up = document.getElementById('rbUpdated');
  if (up) {
    const cfg = rbData.config || {};
    const days = Number(rbData.days_since);
    const interval = Number(rbData.interval_days) || 0;
    // caption 一行承载三件事：目标何时保存、距上次多久、是否超期。
    // 文案要短：这一行与右侧两个按钮抢宽度，过长会被压到裁切。
    let txt = cfg.updated_at
      ? '目标更新于 ' + String(cfg.updated_at).slice(0, 10)
      : '默认目标 · 未按偏好调整';
    let overdue = false;
    if (days >= 0) {
      txt += ' · 距上次 ' + days + ' 天';
      if (interval > 0 && days > interval) {
        txt += '（超期 ' + (days - interval) + ' 天）';
        overdue = true;
      }
    } else {
      txt += ' · 尚无再平衡记录';
    }
    up.textContent = txt;
    up.classList.toggle('is-overdue', overdue);
    up.title = overdue
      ? `已超过建议间隔 ${interval} 天，建议尽快复查配置`
      : cfg.updated_at
        ? '目标权重最后保存于 ' + String(cfg.updated_at)
        : '当前使用内置默认目标（股票 15 / 基金 30 / 理财 40 / 现金 15），点右上角「配置」按自己的偏好调整';
  }
}

function renderRbKpi() {
  const grid = document.getElementById('rbKpiBody');
  if (!grid) return;
  const buckets = rbData.buckets || [];
  const rt = rbData.returns || {};
  const total = Number(rbData.total_cny) || 0;
  const pending = buckets.filter((b) => b.action !== 'none');
  const need = Number(rbData.need_cny) || 0;

  // —— 本期兑现（区间实测）：接口失败或区间无数据时整行降级为「—」，
  //    绝不用 0 冒充，否则「本期真实收益 ¥0」会被读成「一分没赚」。
  const act = rbActual || {};
  const hasAct = Number(act.begin_cny) > 0 && (act.buckets || []).length > 0;
  const realA = Number(act.real_cny) || 0;
  const expA = Number(act.exp_cny) || 0;
  const gapA = Number(act.gap_cny) || 0;
  const planA = Number(act.plan_cny) || 0;
  const hitA = Number(act.hit_rate) || 0;
  const clsOf = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const valOr = (v, txt) => (hasAct ? `<span class="${clsOf(v)}">${txt}</span>` : '—');

  // 现金是子账户（数量多且意义弱），副标题只列持仓/理财件数
  const countText = buckets.filter((b) => b.key !== 'cash' && b.count > 0)
    .map((b) => `${b.label} ${b.count}`).join(' · ') || '暂无在持资产';

  const md = rbData.max_drift;
  const maxText = md ? (md.drift > 0 ? '+' : '−') + Math.abs(Number(md.drift)).toFixed(1) + '%' : '—';
  const maxSub = md ? `${md.label} · ${md.drift > 0 ? '超配' : '低配'}` : '各类均在目标区间';

  grid.innerHTML = `
    <div class="kpi-card density-standard">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M12 6.6v10.8"/><path d="M8.4 9.6h7.2M8.4 14.4h7.2"/></svg></div>
      <div class="kpi-label">组合总市值</div>
      <div class="kpi-main"><div class="kpi-value">${total > 0 ? moneyCurW(total, 'cny') : '—'}</div></div>
      <div class="kpi-sub">${hasAct
        ? `本期 <b class="${clsOf(realA)}">${rbSignedYuan(realA)}</b> · ${rbSignedPct(Number(act.real_pct) || 0)}`
        : esc(countText)}</div>
    </div>
    <div class="kpi-card density-standard" title="本期真实收益 = 期末市值 − 期初市值 − 期间净申购，含浮盈 / 已实现 / 分红票息。与上方配置表的年化口径不同">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 3 6-7"/><path d="M14 8h4v4"/></svg></div>
      <div class="kpi-label">本期真实收益</div>
      <div class="kpi-main"><div class="kpi-value">${valOr(realA, rbSignedYuan(realA))}</div></div>
      <div class="kpi-sub">${hasAct ? `折年化 <b>${rbFixed(act.real_ann_pct)}%</b> · ${Number(act.days) || 0} 天` : '暂无区间数据'}</div>
    </div>
    <div class="kpi-card density-standard" title="按当前各类权重 × 该类假设年化折算到本期天数；计划基准 = 若按目标权重配置本可赚多少">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M4 12h6"/><path d="M14 12h6"/><circle cx="12" cy="12" r="2.4"/></svg></div>
      <div class="kpi-label">本期预期收益</div>
      <div class="kpi-main"><div class="kpi-value">${hasAct ? rbYuan(expA) : '—'}</div></div>
      <div class="kpi-sub">${hasAct ? `计划基准（目标配置）<b>${rbYuan(planA)}</b>` : '暂无区间数据'}</div>
    </div>
    <div class="kpi-card density-standard" title="兑现偏差 = 真实 − 预期。正=同类跑赢假设（选品/票息），负=跑输；兑现率 >100% 即跑赢">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 3.6 21 20H3Z"/><path d="M12 9.4v4.2"/><path d="M12 16.6h.01"/></svg></div>
      <div class="kpi-label">兑现偏差</div>
      <div class="kpi-main"><div class="kpi-value">${valOr(gapA, rbSignedYuan(gapA))}</div></div>
      <div class="kpi-sub">${hasAct
        ? `${expA > 0.005 ? '兑现率 <b>' + rbHitTxt(expA, hitA) + '</b> · ' : ''}${rbPP(Number(act.gap_pp) || 0)}`
        : '暂无区间数据'}</div>
    </div>
    <div class="kpi-card density-standard">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M4 7h11"/><path d="M18 7h2"/><path d="M4 12h5"/><path d="M12 12h8"/><path d="M4 17h9"/><path d="M16 17h4"/></svg></div>
      <div class="kpi-label">待调整金额</div>
      <div class="kpi-main"><div class="kpi-value">${rbYuan(need)}</div></div>
      <div class="kpi-sub">${pending.length ? pending.length + ' 类超阈值 · 买卖两侧等额' : '无需调仓'}</div>
    </div>`;
}

// 收益结论条：把「偏保守还是偏激进 / 差多少钱 / 主因是哪类 / 执行后怎么变」压成一句话。
// 这是整页最该被读到的结论 —— 比 KPI 数字更能回答「这次要不要动」。
function renderRbInsight() {
  const box = document.getElementById('rbInsight');
  if (!box) return;
  const buckets = rbData.buckets || [];
  const rt = rbData.returns || {};
  const total = Number(rbData.total_cny) || 0;
  if (!buckets.length || !(total > 0)) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  // 点击最右侧关闭按钮即可临时收起该提示（不记忆状态，下次刷新仍会显示）
  box.onclick = (e) => { if (e.target.closest('.rb-insight-close')) box.hidden = true; };
  const ex = Number(rt.excess_pct) || 0;
  const top = buckets.slice().sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))[0];
  const topWord = top ? (top.drift > 0 ? '超配' : '低配') : '';
  const icoCheck = '<svg class="rb-insight-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const icoUp = '<svg class="rb-insight-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l5-5 4 3 6-7"/><path d="M14 8h4v4"/></svg>';
  const icoWarn = '<svg class="rb-insight-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.4 17a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
  const closeBtn = '<button class="rb-insight-close" type="button" aria-label="关闭提示" title="关闭提示">✕</button>';

  if (Math.abs(ex) < 0.05) {
    box.className = 'rb-insight';
    box.innerHTML = icoCheck + `<div class="rb-insight-body">当前配置与目标基本一致：预期年化 <b>${rbFixed(rt.ret_actual)}%</b>（<b>${rbYuan(rt.cur_amt)}</b>/年），超额收益率 <b>${rbPP(ex)}</b>。按纪律定期复查即可，不必为收益调仓。</div>` + closeBtn;
    box.hidden = false;
    return;
  }
  if (ex < 0) {
    box.className = 'rb-insight';
    box.innerHTML = icoUp + `<div class="rb-insight-body">当前配置比目标<b>保守 ${Math.abs(ex).toFixed(2)}pp</b>：预期年化 <b>${rbFixed(rt.ret_actual)}%</b>，低于目标配置的 <b>${rbFixed(rt.ret_target)}%</b>，一年少 <b>${rbYuan(-rt.excess_amt)}</b>。
      主因是 <b>${esc(top.label)}${topWord}</b>（${rbSignedYuan(top.contrib)}）。执行建议后收益补齐到 <b>${rbFixed(rt.ret_target)}%</b>，代价是波动敞口由 <b>${rbFixed(rt.vol_actual, 1)}%</b> 升至 <b>${rbFixed(rt.vol_target, 1)}%</b>。</div>` + closeBtn;
    box.hidden = false;
    return;
  }
  box.className = 'rb-insight is-warn';
  box.innerHTML = icoWarn + `<div class="rb-insight-body">当前配置比目标<b>激进 ${ex.toFixed(2)}pp</b>：预期年化 <b>${rbFixed(rt.ret_actual)}%</b>，高于目标配置 <b>${rbFixed(rt.ret_target)}%</b>，一年多 <b>${rbYuan(rt.excess_amt)}</b>。
    这部分超额来自 <b>${esc(top.label)}${topWord}</b>（${rbSignedYuan(top.contrib)}）的权重漂移，不是选股能力。执行再平衡意味着<b>主动让出这部分收益</b>，把波动敞口从 <b>${rbFixed(rt.vol_actual, 1)}%</b> 降回 <b>${rbFixed(rt.vol_target, 1)}%</b>。</div>` + closeBtn;
  box.hidden = false;
}

// —— 主卡左：占比圆环（2026-10-29 取代原来的配置条）——
// 段 = 该类实际占比（合计 100%），段内再分两截：实色 = 目标以内的部分，浅色 = 超出的部分。
// 于是「有没有超配」不用读数字 —— 段尾出现浅色就是超配，整段实色就是低配或达标。
// 段间留 2° 空隙当分割线（不描边：描边颜色浅了看不见、深了像多出一条数据）。
function rbArcPath(cx, cy, r, a0, a1) {
  const pt = (a) => {
    const rad = (a - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function renderRbRing(buckets) {
  const box = document.getElementById('rbRing');
  if (!box) return;
  const S = 200, C = S / 2, R = 78, W = 26, GAP = 2;
  const arcs = [];
  let cur = 0;
  buckets.forEach((b) => {
    const w = Math.max(0, Number(b.weight) || 0);
    const t = Math.max(0, Number(b.target) || 0);
    const span = w * 3.6;
    const g = Math.min(GAP, span / 4);       // 极细小类不留缝，否则整段被吃掉
    const a0 = cur + g;
    const a1 = cur + span - g;
    cur += span;
    if (a1 <= a0) return;
    const c = RB_CLASS_COLOR[b.key] || 'var(--text-faint)';
    // 实色截到「目标占比」为止；实际 < 目标时整段实色（没有超配那截）
    const solid = a0 + (a1 - a0) * (w > 0 ? Math.min(w, t) / w : 0);
    arcs.push(`<path d="${rbArcPath(C, C, R, a0, solid)}" stroke="${c}" stroke-width="${W}" fill="none"/>`);
    if (a1 - solid > 0.05) {
      const d = rbArcPath(C, C, R, solid, a1);
      arcs.push(`<path d="${d}" stroke="#fff" stroke-width="${W}" fill="none"/>`);
      arcs.push(`<path d="${d}" stroke="${c}" stroke-opacity="${RB_LITE_ALPHA}" stroke-width="${W}" fill="none"/>`);
    }
  });
  const need = Number(rbData.need_cny) || 0;
  box.innerHTML = `<svg class="rb-ring-svg" viewBox="0 0 ${S} ${S}" role="img"
      aria-label="四类资产实际占比圆环，段尾浅色表示超配">
      <circle cx="${C}" cy="${C}" r="${R}" stroke="var(--bg-soft)" stroke-width="${W}" fill="none"/>
      ${arcs.join('')}
    </svg>
    <div class="rb-ring-mid">
      <span class="k">待调整</span>
      <b class="v">${need > 0 ? rbYuan(need) : '—'}</b>
    </div>`;
}

// —— 主表：一行 = 一个判断（2026-10-27 由「左条形图 + 右明细表」两栏合并）——
// 原来两栏把同一份四类数据画了两遍，行节奏也不同，来回对照很累；现在条形嵌进「配置」列，
// 「建议」列就地勾选（勾选集合决定「记录」时写进快照的 actions）。
function renderRbDrift() {
  const body = document.getElementById('rbDriftBody');
  const foot = document.getElementById('rbDriftFoot');
  if (!body) return;
  const buckets = rbData.buckets || [];
  const rt = rbData.returns || {};
  const total = Number(rbData.total_cny) || 0;
  if (!buckets.length || !(total > 0)) {
    body.innerHTML = '<tr><td colspan="6"><div class="rb-act-empty">暂无资产数据</div></td></tr>';
    if (foot) foot.innerHTML = '';
    renderRbRing([]);
    return;
  }
  renderRbRing(buckets);
  const pend = buckets.filter((b) => b.action !== 'none');
  body.innerHTML = buckets.map((b) => {
    const d = Number(b.drift) || 0;
    const none = b.action === 'none';
    const cls = none ? 'ok' : (d > 0 ? 'over' : 'under');
    const on = rbPicked.has(b.key);
    // 建议列：可勾选的「动作 + 金额」。勾掉=这次不打算执行，记录时不进快照。
    const pick = none
      ? '<span class="rb-act none">—</span>'
      : `<label class="rb-act-pick${on ? '' : ' off'}">
           <input type="checkbox" data-key="${b.key}"${on ? ' checked' : ''}>
           <span class="rb-act ${b.action}">${rbActionLabel(b.key, b.action)}</span>
           <span class="rb-act-amt">${rbYuan(Math.abs(b.amount))}</span>
         </label>`;
    return `<tr>
      <td data-l="类别"><span class="rb-cat"><span class="rb-dot" style="--rb-c:${RB_CLASS_COLOR[b.key]}"></span>${esc(b.label)}</span></td>
      <td class="rb-alloc" data-l="实际 / 目标" title="实际 ${rbFixed(b.weight, 1)}% · 目标 ${b.target}%"><span class="rb-alloc-vals"><b>${rbFixed(b.weight, 1)}%</b><i>/ ${b.target}%</i></span></td>
      <td class="num" data-l="偏离"><span class="rb-drift ${cls}">${none ? '容差内' : (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '%'}</span></td>
      <td class="num" data-l="年化">${rbFixed(b.exp, 1)}%</td>
      <td class="num rb-imp" data-l="收益影响">${rbSignedYuan(b.contrib)}</td>
      <td class="num" data-l="建议">${pick}</td>
    </tr>`;
  }).join('');

  body.querySelectorAll('input[data-key]').forEach((el) => {
    el.onchange = () => {
      const k = el.dataset.key;
      if (el.checked) rbPicked.add(k); else rbPicked.delete(k);
      const row = el.closest('.rb-act-pick');
      if (row) row.classList.toggle('off', !el.checked);
    };
  });

  if (foot) {
    // 合计行自解释：配置列给「实际合计 / 目标合计」、年化列给加权目标、建议列给要换手多少钱，
    // 不回看表头也知道每个数字是什么（合计行是唯一不需要对齐表头的行）。
    const sumW = buckets.reduce((a, b) => a + (Number(b.weight) || 0), 0);
    const need = Number(rbData.need_cny) || 0;
    foot.innerHTML = `<tr>
      <td>合计</td>
      <td class="rb-alloc"><span class="rb-alloc-vals"><b>${rbFixed(sumW, 1)}%</b><i>/ 100%</i></span></td>
      <td class="num">—</td>
      <td class="num">加权 ${rbFixed(rt.ret_target)}%</td>
      <td class="num rb-imp">${rbSignedYuan(rt.excess_amt)}</td>
      <td class="num">${need > 0 ? '换手 ' + rbYuan(need) : '—'}</td>
    </tr>`;
  }

  const note = document.getElementById('rbNote');
  if (note) {
    const cfg = rbData.config || {};
    const pend = buckets.filter((b) => b.action !== 'none');
    const thr = cfg.drift_alert != null ? cfg.drift_alert : 1;
    // 日常开销账户被剔除时必须写出来 —— 否则用户对比资产页会发现「现金少了一截」以为算漏了
    const exclN = Number(rbData.cash_excluded_n) || 0;
    const exclTxt = exclN
      ? `其中 ${exclN} 个「日常开销」子账户（${rbYuan(Number(rbData.cash_excluded_amt) || 0)}）已剔除，既不计入现金类也不计入总市值。`
      : '';
    note.textContent = (pend.length
      ? `共 ${pend.length} 类偏离超过 ${thr}pp；买卖金额天然配平（合计为 0）。`
      : `四类均在 ${thr}pp 容差内，本期无需调仓。`) + exclTxt +
      `「收益影响」= 该类偏离 × 总市值 × 该类年化，四类相加等于组合超额收益 ${rbSignedYuan(rt.excess_amt)}/年。` +
      `年化为假设值，不是承诺收益；波动率为简单加权（未计相关性），仅作方向参考。` +
      `本表是年化机会成本，与下方「本期兑现」的区间实测口径不同，两处金额不可相加。`;
  }
}

// ===== 本期兑现：真实 vs 预期（2026-10-29）=====
// 数据全部来自 /api/rebalance/actual（服务端已算好四类聚合、归因与 Top），前端只做呈现与几何。
// 与上方配置表的区别必须一眼看得出：那张表是年化假设，这张是区间实测。
function setRbActualLoading() {
  const body = document.getElementById('rbActualBody');
  if (body) body.innerHTML = '<tr><td colspan="8"><div class="rb-act-empty">计算中…</div></td></tr>';
  const foot = document.getElementById('rbActualFoot');
  if (foot) foot.innerHTML = '';
}

function renderRbActual() {
  const body = document.getElementById('rbActualBody');
  const foot = document.getElementById('rbActualFoot');
  const note = document.getElementById('rbActualNote');
  const range = document.getElementById('rbPeriodRange');
  if (!body) return;
  const a = rbActual;
  if (range) range.textContent = a ? `${a.from} → ${a.to} · ${a.days} 天` : '';
  if (!a || !(Number(a.begin_cny) > 0) || !(a.buckets || []).length) {
    body.innerHTML = `<tr><td colspan="8"><div class="rb-act-empty">${a ? '区间内没有可对比的期初市值，换个周期看看' : '本期兑现计算失败'}</div></td></tr>`;
    if (foot) foot.innerHTML = '';
    if (note) note.textContent = '';
    renderRbActualChart();
    renderRbActualAttr();
    return;
  }

  // 偏差幅度条按最大 |偏差金额| 归一；最小 4% 保证极小偏差也能被看见
  const maxGap = Math.max(1, ...a.buckets.map((b) => Math.abs(Number(b.gap_cny) || 0)));
  const cell2 = (main, sub) => `<span class="rb-twol"><b>${main}</b><i>${sub}</i></span>`;

  body.innerHTML = a.buckets.map((b) => {
    const real = Number(b.real_cny) || 0;
    const exp = Number(b.exp_cny) || 0;
    const gap = Number(b.gap_cny) || 0;
    const hit = Number(b.hit_rate) || 0;
    const netIn = Number(b.net_in_cny) || 0;
    const w = Math.max(4, Math.min(50, (Math.abs(gap) / maxGap) * 48));
    const partial = b.quality === 'partial'
      ? `<span class="rb-act-tag" title="${esc((b.note || '数据不完整') + (Number(b.days) > 0 && Number(b.days) < Number(a.days) ? ` · 仅覆盖 ${b.days}/${a.days} 天` : ''))}">估算</span>` : '';
    return `<tr>
      <td><span class="rb-cat"><span class="rb-dot" style="--rb-c:${RB_CLASS_COLOR[b.key] || 'var(--text-faint)'}"></span>${esc(b.label)}${partial}</span></td>
      <td class="num">${cell2(rbYuan(b.end_cny), rbYuan(b.begin_cny))}</td>
      <td class="num">${Math.abs(netIn) < 0.5 ? '<span class="rb-act-none">—</span>' : `<span class="${rbActCls(netIn)}">${rbSignedYuan(netIn)}</span>`}</td>
      <td class="num">${cell2(`<span class="${rbActCls(real)}">${rbSignedYuan(real)}</span>`, rbSignedPct(b.real_pct))}</td>
      <td class="num">${cell2(rbYuan(exp), rbFixed(b.exp_pct) + '%')}</td>
      <td class="num">${cell2(`<span class="${rbActCls(gap)}">${rbSignedYuan(gap)}</span>`, rbPP(b.gap_pp))}</td>
      <td class="num"><span class="rb-dev"><span class="rb-dev-axis"></span><span class="rb-dev-fill ${gap >= 0 ? 'pos' : 'neg'}" style="--w:${w.toFixed(1)}%"></span></span></td>
      <td class="num"><span class="rb-rate-pill ${exp > 0.005 ? (hit >= 100 ? 'hi' : 'lo') : 'mid'}">${rbHitTxt(exp, hit)}</span></td>
    </tr>`;
  }).join('');

  if (foot) {
    const hit = Number(a.hit_rate) || 0;
    const expA = Number(a.exp_cny) || 0;
    const gapA = Number(a.gap_cny) || 0;
    foot.innerHTML = `<tr>
      <td>合计</td>
      <td class="num">${cell2(rbYuan(a.end_cny), rbYuan(a.begin_cny))}</td>
      <td class="num">${Math.abs(Number(a.net_in_cny) || 0) < 0.5 ? '—' : rbSignedYuan(a.net_in_cny)}</td>
      <td class="num">${cell2(`<span class="${rbActCls(a.real_cny)}">${rbSignedYuan(a.real_cny)}</span>`, rbSignedPct(a.real_pct))}</td>
      <td class="num">${cell2(rbYuan(a.exp_cny), rbFixed(a.exp_pct) + '%')}</td>
      <td class="num">${cell2(`<span class="${rbActCls(gapA)}">${rbSignedYuan(gapA)}</span>`, rbPP(a.gap_pp))}</td>
      <td class="num">—</td>
      <td class="num"><span class="rb-rate-pill ${expA > 0.005 ? (hit >= 100 ? 'hi' : 'lo') : 'mid'}">${rbHitTxt(expA, hit)}</span></td>
    </tr>`;
  }

  if (note) {
    const notes = (a.notes || []).join('');
    note.textContent = `真实收益 = 期末市值 − 期初市值 − 期间净申购 + 分红票息；预期 = 期初市值 × 该类假设年化 × ${a.days}/365。`
      + `兑现率 = 真实 ÷ 预期，>100% 为跑赢假设；合计行按「期初市值加权」而非各行简单平均。` + notes;
  }
  renderRbActualChart();
  renderRbActualAttr();
}

function renderRbActualChart() {
  const box = document.getElementById('rbActualChart');
  const lg = document.getElementById('rbActualLegend');
  if (!box) return;
  const s = (rbActual && rbActual.series) || [];
  if (s.length < 2) {
    box.innerHTML = '<div class="rb-act-empty">区间太短，暂无曲线</div>';
    if (lg) lg.innerHTML = '';
    return;
  }
  const W = 640, H = 190, L = 48, R = 12, T = 12, B = 24;
  const nums = [];
  s.forEach((p) => { nums.push(Number(p.real) || 0, Number(p.exp) || 0); });
  let mn = Math.min(0, ...nums);
  let mx = Math.max(0, ...nums);
  if (mx - mn < 1) mx = mn + 1;
  const pad = (mx - mn) * 0.12;
  mn -= pad; mx += pad;
  const X = (i) => L + (W - L - R) * (i / (s.length - 1));
  const Y = (v) => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
  const rv = (p) => Number(p.real) || 0;
  const ev = (p) => Number(p.exp) || 0;

  // 尾部跳变：净值/快照不日更时，末点用当前市值、前一点用最近可得价，中间会掉一截。
  // 这一段改用虚线 —— 让「数据没更新」在视觉上就是断的，而不是像一次真实暴跌。
  const tailDash = ((rbActual.buckets || []).some((b) => b.quality === 'partial')) && s.length > 2;
  const solid = tailDash ? s.slice(0, -1) : s;
  const realLine = solid.map((p, i) => `${X(i).toFixed(1)},${Y(rv(p)).toFixed(1)}`).join(' ');
  const expLine = s.map((p, i) => `${X(i).toFixed(1)},${Y(ev(p)).toFixed(1)}`).join(' ');
  // 面积 = 真实线正向 + 预期线逆向（闭合后就是「累计超额」那块）
  const area = `M${X(0).toFixed(1)},${Y(rv(s[0])).toFixed(1)} `
    + s.map((p, i) => `L${X(i).toFixed(1)},${Y(rv(p)).toFixed(1)}`).join(' ')
    + ' ' + s.map((p, i) => `L${X(s.length - 1 - i).toFixed(1)},${Y(ev(s[s.length - 1 - i])).toFixed(1)}`).join(' ') + ' Z';

  const last = s[s.length - 1];
  const realUp = rv(last) >= 0;
  const realColor = realUp ? 'var(--up)' : 'var(--down)';
  // 4 条网格 + 值标签
  const ticks = [];
  for (let k = 0; k <= 3; k++) {
    const v = mn + (mx - mn) * (k / 3);
    ticks.push(`<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${W - R}" y2="${Y(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`
      + `<text x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" fill="var(--text-faint)" font-size="10">${fmt(Math.round(v))}</text>`);
  }
  const xl = [0, Math.floor((s.length - 1) / 2), s.length - 1];
  const xLabels = xl.map((i) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === s.length - 1 ? 'end' : 'middle'}" fill="var(--text-faint)" font-size="10">${esc(String(s[i].date).slice(5))}</text>`).join('');

  box.innerHTML = `<svg class="rb-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="本期真实与预期累计收益曲线">
    <defs><linearGradient id="rbActGap" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(var(--tint), .26)"/><stop offset="100%" stop-color="rgba(var(--tint), .02)"/>
    </linearGradient></defs>
    ${ticks.join('')}
    <path d="${area}" fill="url(#rbActGap)"/>
    <polyline points="${expLine}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>
    <polyline points="${realLine}" fill="none" stroke="${realColor}" stroke-width="2" stroke-linejoin="round"/>
    ${tailDash ? `<line x1="${X(s.length - 2).toFixed(1)}" y1="${Y(rv(s[s.length - 2])).toFixed(1)}" x2="${X(s.length - 1).toFixed(1)}" y2="${Y(rv(last)).toFixed(1)}" stroke="${realColor}" stroke-width="2" stroke-dasharray="3 3" opacity=".8"/>` : ''}
    <circle cx="${X(s.length - 1).toFixed(1)}" cy="${Y(rv(last)).toFixed(1)}" r="3" fill="${realColor}"/>
    <circle cx="${X(s.length - 1).toFixed(1)}" cy="${Y(ev(last)).toFixed(1)}" r="2.5" fill="var(--text-muted)"/>
    ${xLabels}
  </svg>`;

  if (lg) {
    const gap = Number(rbActual.gap_cny) || 0;
    // 净值/快照不日更时曲线会走平台，末点又用当前市值 → 尾部会有一次跳变。
    // 与其让用户以为是 bug，不如在图例里直接说清。
    const hasGap = ((rbActual.buckets || []).some((b) => b.quality === 'partial'));
    lg.innerHTML = `<span class="k"><i class="ln" style="--ln:${realColor}"></i>真实累计 ${rbSignedYuan(last.real)}</span>
      <span class="k"><i class="ln dash"></i>预期 ${rbYuan(last.exp)}</span>
      <span class="k"><i class="ln gap"></i>累计超额 <b class="${rbActCls(gap)}">${rbSignedYuan(gap)}</b></span>
      ${hasGap ? '<span class="rb-chart-note">部分净值未日更，曲线尾段走平、末点按当前市值</span>' : ''}`;
  }
}

function renderRbActualAttr() {
  const box = document.getElementById('rbActualAttr');
  const hint = document.getElementById('rbAttrHint');
  if (!box) return;
  const a = rbActual;
  if (!a || !(Number(a.begin_cny) > 0)) {
    box.innerHTML = '';
    if (hint) hint.textContent = '';
    return;
  }
  const alloc = Number(a.alloc_cny) || 0;
  const sel = Number(a.select_cny) || 0;
  // 相对计划 = real − plan（不是 gap_cny！gap_cny 是 real − exp，两者差一个「配置偏离」）
  const vsPlan = a.plan_gap_cny != null ? Number(a.plan_gap_cny) || 0 : (Number(a.real_cny) || 0) - (Number(a.plan_cny) || 0);
  const plan = Number(a.plan_cny) || 0;
  const real = Number(a.real_cny) || 0;
  const begin = Number(a.begin_cny) || 0;

  // 配置项的主导类别：|实际权重 − 目标权重| 最大者，用一句人话点出来
  const tgtOf = {};
  ((rbData && rbData.buckets) || []).forEach((b) => { tgtOf[b.key] = Number(b.target) || 0; });
  let topKey = null;
  let topDiff = 0;
  (a.buckets || []).forEach((b) => {
    const w = begin > 0 ? (Number(b.begin_cny) / begin) * 100 : 0;
    const d = w - (tgtOf[b.key] || 0);
    if (Math.abs(d) > Math.abs(topDiff)) { topDiff = d; topKey = b.key; }
  });
  const topWord = topKey
    ? `${RB_CLASS_LABEL[topKey] || topKey}${topDiff > 0 ? '超配' : '低配'} ${Math.abs(topDiff).toFixed(1)}pp`
    : '各类权重接近目标';

  // 兑现项：按贡献金额排序，取前 3 类拼成一句
  const parts = (a.buckets || [])
    .slice()
    .sort((x, y) => Math.abs(Number(y.gap_cny) || 0) - Math.abs(Number(x.gap_cny) || 0))
    .slice(0, 3)
    .map((b) => `${b.label} ${rbSignedYuan(b.gap_cny)}`)
    .join(' · ');

  if (hint) hint.textContent = `基准 = 计划 ${rbYuan(plan)}`;
  box.innerHTML = `
    <div class="rb-attr-item">
      <div class="rb-attr-k">① 配置偏离</div>
      <div class="rb-attr-v ${rbActCls(alloc)}">${rbSignedYuan(alloc)}</div>
      <div class="rb-attr-s">${esc(topWord)}；权重漂移相对计划基准的机会成本，不是选品能力。</div>
    </div>
    <div class="rb-attr-item">
      <div class="rb-attr-k">② 兑现超额（选品 / 票息）</div>
      <div class="rb-attr-v ${rbActCls(sel)}">${rbSignedYuan(sel)}</div>
      <div class="rb-attr-s">${esc(parts || '—')}</div>
    </div>
    <div class="rb-attr-item sum">
      <div class="rb-attr-k">③ 相对计划合计</div>
      <div class="rb-attr-v ${rbActCls(vsPlan)}">${rbSignedYuan(vsPlan)}</div>
      <div class="rb-attr-s">真实 ${rbYuan(real)} − 计划 ${rbYuan(plan)}；① + ② 恒等于 ③。</div>
    </div>`;
}

function renderRbTop() {
  const box = document.getElementById('rbTopList');
  const note = document.getElementById('rbTopNote');
  const hint = document.getElementById('rbTopHint');
  if (!box) return;
  const a = rbActual;
  const top = (a && a.top) || [];
  if (hint) hint.textContent = a ? `本期 ${a.label || ''} · 按收益绝对值排序` : '本期真实收益来源';
  if (!top.length) {
    box.innerHTML = '<div class="rb-act-empty">本期暂无标的级收益数据</div>';
    if (note) note.textContent = '';
    return;
  }
  const totalReal = Number(a.real_cny) || 0;
  box.innerHTML = `<div class="rb-top-list">` + top.map((t) => {
    const pnl = Number(t.pnl_cny) || 0;
    return `<div class="rb-top-row">
      <span class="rb-top-name">
        <span class="rb-dot" style="--rb-c:${RB_CLASS_COLOR[t.key] || 'var(--text-faint)'}"></span>
        <span class="t">${esc(t.name)}</span>
        ${t.symbol ? `<span class="s">${esc(t.symbol)}</span>` : ''}
      </span>
      <span class="rb-top-v ${rbActCls(pnl)}">${rbSignedYuan(pnl)}</span>
      <span class="rb-top-p">${rbSignedPct(t.pct)}</span>
    </div>`;
  }).join('') + '</div>';

  if (note) {
    // 集中度：Top 合计占本期收益的比例。收益为 0 或负时不硬算，避免出现负分母的百分比
    const sum = top.reduce((acc, t) => acc + (Number(t.pnl_cny) || 0), 0);
    const share = totalReal > 0 ? Math.round((Math.max(0, sum) / totalReal) * 100) : null;
    note.textContent = share == null
      ? `本期合计为 ${rbSignedYuan(totalReal)}，Top ${top.length} 项合计 ${rbSignedYuan(sum)}。`
      : `Top ${top.length} 项合计 ${rbSignedYuan(sum)}，占本期收益 ${share}%。单只超过 30% 集中度时值得复查，但这里不给交易建议。`;
  }
}

async function loadRbHistory() {
  try {
    const r = await api('/api/rebalance/history?limit=12');
    if (!r.ok) return;
    const d = await r.json();
    rbHistoryLogs = d.logs || [];
    renderRbHistory();
  } catch (_) { /* 历史失败不影响主计算 */ }
}

function renderRbHistory() {
  const box = document.getElementById('rbHistory');
  if (!box) return;
  if (!rbHistoryLogs.length) {
    box.innerHTML = '<div class="rb-hist-empty">还没有记录。调整后点右上角「记录」，之后这里会留下每次的配置快照与当时的收益假设。</div>';
    return;
  }
  box.innerHTML = '<div class="rb-hist-list">' + rbHistoryLogs.map((l) => {
    const mix = (l.actual || []).map((a) => `${RB_CLASS_LABEL[a.key] || a.key} ${Number(a.pct).toFixed(0)}%`).join(' · ');
    // 快照里存了「记录时勾选了哪些动作」，不展示出来「勾选」就没有任何可观察效果。
    const acts = (l.actions || [])
      .filter((a) => a && a.action && a.action !== 'none')
      .map((a) => `${rbActionLabel(a.key, a.action)}${a.label || RB_CLASS_LABEL[a.key] || a.key} ${rbYuan(Math.abs(Number(a.amount) || 0))}`)
      .join(' · ');
    const md = Number(l.max_drift) || 0;
    // 收益率列 = 当时实际 / 当时目标。两者都来自落库快照，不会因为今天改了假设而变形。
    const rtA = Number(l.ret_actual) || 0;
    const rtT = Number(l.ret_target) || 0;
    const hasRet = rtA !== 0 || rtT !== 0;
    return `<div class="rb-hist-row">
      <span class="rb-hist-date">${esc(l.date)}</span>
      <span class="rb-hist-mix">
        <span>${esc(mix)}</span>
        ${acts ? `<span class="rb-hist-acts">已记录 ${esc(acts)}</span>` : ''}
      </span>
      <span class="rb-hist-total">${moneyCurW(l.total_cny, 'cny')}</span>
      <span class="rb-hist-ret">${hasRet ? `<b>${rbFixed(rtA)}%</b> / ${rbFixed(rtT)}%` : '—'}</span>
      <span class="rb-hist-drift">${(md > 0 ? '+' : md < 0 ? '−' : '') + Math.abs(md).toFixed(1)}%</span>
    </div>`;
  }).join('') + '</div>';
}

// —— 目标配置与收益假设弹框 ——
// 每类三个参数：目标权重 / 预期年化 / 预期波动。三者都只是「假设」，改完立刻在下方试算，
// 不必保存就能看到「目标收益率会变成多少」—— 避免用户在弹框里盲填。
// 与服务端 defaultRebalanceConfig / rbDefaultExp / rbDefaultVol 保持一致，改动时两处同步。
const RB_DEFAULT = {
  pct: { stock: 15, fund: 30, wealth: 40, cash: 15 },
  exp: { stock: 8, fund: 6, wealth: 2.8, cash: 1.2 },
  vol: { stock: 22, fund: 16, wealth: 2, cash: 0.6 },
};
// 预设只改权重，收益/波动假设沿用当前值（假设是对资产类别的判断，不该被配置风格覆盖）
const RB_PRESETS = {
  cons: { stock: 10, fund: 20, wealth: 60, cash: 10 },
  bal: { stock: 15, fund: 30, wealth: 40, cash: 15 },
  aggr: { stock: 30, fund: 40, wealth: 25, cash: 5 },
};

function rbSetInputs() {
  return Array.from(document.querySelectorAll('#rbTgtInputs input[data-f]'));
}

// 从弹框读出一份完整配置（targets 数组按 RB_CLASS_LABEL 顺序）
function rbReadCfg() {
  const o = { pct: {}, exp: {}, vol: {} };
  rbSetInputs().forEach((el) => {
    const f = el.dataset.f;
    const k = el.dataset.k;
    const raw = el.value === '' ? 0 : Number(el.value);
    o[f][k] = Number.isFinite(raw) ? raw : 0;
  });
  const freq = (document.getElementById('rbFreqSel') || {}).value || 'monthly';
  const thrRaw = Number((document.getElementById('rbDriftThr') || {}).value);
  const goalRaw = (document.getElementById('rbGoalPct') || {}).value;
  const goal = goalRaw === '' || goalRaw == null ? null : Number(goalRaw);
  return {
    targets: Object.keys(RB_CLASS_LABEL).map((k) => ({
      key: k,
      pct: Math.max(0, Math.min(100, o.pct[k] || 0)),
      exp: Math.max(0, Math.min(50, o.exp[k] || 0)),
      vol: Math.max(0, Math.min(80, o.vol[k] || 0)),
    })),
    freq,
    drift_alert: Number.isFinite(thrRaw) && thrRaw > 0 ? thrRaw : 1,
    goal_pct: goal != null && Number.isFinite(goal) && goal > 0 ? goal : null,
  };
}

// 弹框内联动：合计校验 + 试算预览 + 预设高亮
function rbSyncSetForm() {
  const cfg = rbReadCfg();
  const sum = cfg.targets.reduce((a, t) => a + t.pct, 0);
  const sumEl = document.getElementById('rbTgtSum');
  if (sumEl) {
    sumEl.textContent = (Math.round(sum * 100) / 100) + '%';
    sumEl.className = Math.abs(sum - 100) < 0.01 ? 'ok' : 'bad';
  }
  const save = document.getElementById('rbSetSave');
  if (save) save.disabled = Math.abs(sum - 100) > 0.01;

  // 试算：用实际权重（来自 rbData.buckets）套用弹框里的假设，保存前就能看到收益变化
  const buckets = (rbData && rbData.buckets) || [];
  const total = Number(rbData && rbData.total_cny) || 0;
  const byKey = {};
  cfg.targets.forEach((t) => { byKey[t.key] = t; });
  let retT = 0, volT = 0, retA = 0, volA = 0;
  cfg.targets.forEach((t) => {
    retT += t.pct / 100 * t.exp;
    volT += t.pct / 100 * t.vol;
  });
  buckets.forEach((b) => {
    const t = byKey[b.key];
    if (!t) return;
    retA += (Number(b.weight) || 0) / 100 * t.exp;
    volA += (Number(b.weight) || 0) / 100 * t.vol;
  });
  const pv = document.getElementById('rbPreview');
  if (pv) {
    pv.innerHTML = `
      <div class="rb-pv-box">
        <div class="rb-pv-k">目标配置预期年化</div>
        <div class="rb-pv-v">${rbFixed(retT)}%</div>
        <div class="rb-pv-s">${rbYuan(total * retT / 100)}/年 · 波动 ${rbFixed(volT, 1)}%</div>
      </div>
      <div class="rb-pv-box">
        <div class="rb-pv-k">当前配置预期年化</div>
        <div class="rb-pv-v">${rbFixed(retA)}%</div>
        <div class="rb-pv-s">${rbYuan(total * retA / 100)}/年 · 波动 ${rbFixed(volA, 1)}%</div>
      </div>`;
  }
  const goalAmt = document.getElementById('rbGoalAmt');
  if (goalAmt) {
    goalAmt.textContent = cfg.goal_pct == null
      ? '留空则只看配置内生的预期收益'
      : '≈ ' + rbYuan(total * cfg.goal_pct / 100) + '/年';
  }
  // 预设高亮：权重完全命中某个预设才点亮
  document.querySelectorAll('#rbPresets .rb-chip').forEach((c) => {
    const p = RB_PRESETS[c.dataset.preset];
    const hit = p && Object.keys(p).every((k) => Math.abs((byKey[k] ? byKey[k].pct : -1) - p[k]) < 0.01);
    c.classList.toggle('is-on', !!hit);
  });
}

function openRbSettings() {
  if (!rbData) return;
  const box = document.getElementById('rbTgtInputs');
  if (!box) return;
  const cfg = rbData.config || {};
  const cur = {};
  ((cfg.targets) || []).forEach((t) => {
    cur[t.key] = { pct: Number(t.pct) || 0, exp: Number(t.exp) || 0, vol: Number(t.vol) || 0 };
  });
  const keys = Object.keys(RB_CLASS_LABEL);
  box.innerHTML = `
    <div class="rb-pgrid-h">类别</div>
    <div class="rb-pgrid-h">权重</div>
    <div class="rb-pgrid-h">年化</div>
    <div class="rb-pgrid-h">波动</div>` +
    keys.map((k) => {
      const c = cur[k] || { pct: 0, exp: 0, vol: 0 };
      return `
      <div class="rb-pgrid-name"><span class="rb-dot" style="--rb-c:${RB_CLASS_COLOR[k]}"></span>${RB_CLASS_LABEL[k]}</div>
      <input type="number" min="0" max="100" step="1" data-f="pct" data-k="${k}" value="${c.pct}" aria-label="${RB_CLASS_LABEL[k]} 目标权重">
      <input type="number" min="0" max="50" step="0.1" data-f="exp" data-k="${k}" value="${c.exp}" aria-label="${RB_CLASS_LABEL[k]} 预期年化">
      <input type="number" min="0" max="80" step="0.1" data-f="vol" data-k="${k}" value="${c.vol}" aria-label="${RB_CLASS_LABEL[k]} 预期波动">`;
    }).join('');
  rbSetInputs().forEach((el) => { el.oninput = rbSyncSetForm; });

  const f = document.getElementById('rbFreqSel');
  if (f) f.value = cfg.freq || 'monthly';
  const th = document.getElementById('rbDriftThr');
  if (th) th.value = cfg.drift_alert != null ? cfg.drift_alert : 1;
  const g = document.getElementById('rbGoalPct');
  if (g) g.value = cfg.goal_pct == null ? '' : cfg.goal_pct;
  rbSyncSetForm();
  document.getElementById('rbSettingsModal').hidden = false;
}

async function saveRbSettings() {
  const cfg = rbReadCfg();
  const sum = cfg.targets.reduce((a, t) => a + t.pct, 0);
  if (Math.abs(sum - 100) > 0.01) {
    toast('目标权重合计必须为 100%（当前 ' + (Math.round(sum * 100) / 100) + '%）', 'err');
    return;
  }
  const btn = document.getElementById('rbSetSave');
  if (btn) btn.disabled = true;
  try {
    const r = await api('/api/settings/rebalance_targets', {
      method: 'PUT',
      body: JSON.stringify({ payload: cfg }),
    });
    if (!r.ok) {
      let m = '保存失败';
      try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {}
      toast(m, 'err');
      return;
    }
    // 合并原「记录」按钮语义：保存配置时一并落一份再平衡快照（勾选的偏离项，未勾选则记全部偏离项）。
    // 记录失败不影响配置已保存——纯 best-effort，不阻塞保存主流程。
    let logged = false;
    try {
      const drifted = (rbData.buckets || []).filter((b) => b.action !== 'none');
      const chosen = drifted.filter((b) => rbPicked.has(b.key));
      const acts = chosen.length ? chosen : drifted;
      if (acts.length) {
        await api('/api/rebalance/log', {
          method: 'POST',
          body: JSON.stringify({ actions: acts.map((b) => ({ key: b.key })) }),
        });
        logged = true;
      }
    } catch (_) { /* 记录失败不影响配置已保存 */ }
    document.getElementById('rbSettingsModal').hidden = true;
    toast(logged ? '配置已保存并记录本次再平衡' : '目标与收益假设已保存', 'ok');
    rbData = null;
    await loadRebalance();
  } catch (e) { toast('保存失败：' + e.message, 'err'); }
  finally { if (btn) btn.disabled = false; }
}

(function bindRebalanceUI() {
  const s = document.getElementById('rbSettingsBtn');
  if (s) s.onclick = openRbSettings;
  const close = () => { const m = document.getElementById('rbSettingsModal'); if (m) m.hidden = true; };
  ['rbSetClose'].forEach((id) => { const b = document.getElementById(id); if (b) b.onclick = close; });
  // 点击遮罩空白处关闭抽屉（卡片本身不触发）
  const modal = document.getElementById('rbSettingsModal');
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  const sv = document.getElementById('rbSetSave');
  if (sv) sv.onclick = saveRbSettings;
  const rs = document.getElementById('rbSetReset');
  if (rs) rs.onclick = () => {
    // 恢复默认：三类参数一起回默认（只重置权重会让「默认权重 + 上次的假设」变成四不像）
    rbSetInputs().forEach((el) => {
      const k = el.dataset.k;
      const f = el.dataset.f;
      el.value = RB_DEFAULT[f] && RB_DEFAULT[f][k] != null ? RB_DEFAULT[f][k] : 0;
    });
    const th = document.getElementById('rbDriftThr');
    if (th) th.value = 1;
    const g = document.getElementById('rbGoalPct');
    if (g) g.value = '';
    rbSyncSetForm();
  };
  // 预设：只改权重，不动收益假设
  document.querySelectorAll('#rbPresets .rb-chip').forEach((c) => {
    c.onclick = () => {
      const p = RB_PRESETS[c.dataset.preset];
      if (!p) return;
      rbSetInputs().forEach((el) => {
        if (el.dataset.f !== 'pct') return;
        if (p[el.dataset.k] != null) el.value = p[el.dataset.k];
      });
      rbSyncSetForm();
    };
  });
  ['rbGoalPct', 'rbDriftThr'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.oninput = rbSyncSetForm;
  });
  const fq = document.getElementById('rbFreqSel');
  if (fq) fq.onchange = rbSyncSetForm;
  // 本期兑现的周期切换：只重拉 /api/rebalance/actual —— 配置偏离是「此刻快照」，与区间无关。
  document.querySelectorAll('#rbPeriods .rb-chip').forEach((c) => {
    c.onclick = () => {
      const p = c.dataset.period || 'last';
      if (p === rbPeriod) return;
      rbPeriod = p;
      document.querySelectorAll('#rbPeriods .rb-chip').forEach((x) => x.classList.toggle('is-on', x === c));
      loadRbActual(p);
    };
  });
})();

// ============================================================
// 认证层（2026-10-28）：登录闸门 / 添加设备与邀请 / 操作 PIN
// 后端口径见 internal/api/auth.go：会话 Cookie + 一次性配对码。
// ============================================================

// ---- 闸门 ----
function showAuthGate(st) {
  authReady = false;
  if (!authReturnHash) authReturnHash = location.hash || '';
  const gate = document.getElementById('authGate');
  if (!gate) return;
  gate.hidden = false;
  document.getElementById('authClaim').hidden = true;
  document.getElementById('authPair').hidden = true;
  document.getElementById('authReadonly').hidden = true;
  if (!st) {
    document.getElementById('authSub').textContent = '无法连接服务器，请稍后刷新重试';
    return;
  }
  if (st.mode === 'readonly') {
    document.getElementById('authSub').textContent = '演示环境 · 只读';
    document.getElementById('authReadonly').hidden = false;
    return;
  }
  if (st.mode === 'claim') {
    document.getElementById('authSub').textContent = '首次接入 · 认领已有账本';
    renderAuthClaim(st);
    document.getElementById('authClaim').hidden = false;
    return;
  }
  document.getElementById('authSub').textContent = '本设备尚未接入';
  document.getElementById('authCode').value = '';
  document.getElementById('authPairErr').textContent = '';
  document.getElementById('authPair').hidden = false;
  // 邀请链接深链：/#/pair?t=<secret>，直接发起配对
  const m = (location.hash || '').match(/[?&]t=([A-Za-z0-9_-]+)/);
  if (m) doPair(m[1]);
  else setTimeout(() => document.getElementById('authCode').focus(), 60);
}

function renderAuthClaim(st) {
  const users = st.users || [];
  // 预选：有数据的账本全选；全都为空则选第一个
  const withData = users.filter((u) => u.count > 0);
  const pre = new Set((withData.length ? withData : users.slice(0, 1)).map((u) => String(u.id)));
  document.getElementById('authUserList').innerHTML = users.map((u) => `
    <label class="auth-user-opt">
      <input type="checkbox" data-id="${u.id}" ${pre.has(String(u.id)) ? 'checked' : ''}>
      <span>${escapeHtml(u.name)}</span>
      <span class="auth-user-cnt">${u.count || 0} 条数据</span>
    </label>`).join('');
  document.getElementById('authRename').value = '';
  document.getElementById('authClaimErr').textContent = '';
}

async function doClaim() {
  const ids = Array.from(document.querySelectorAll('#authUserList input:checked')).map((i) => Number(i.dataset.id));
  if (!ids.length) { document.getElementById('authClaimErr').textContent = '请至少勾选一个账本'; return; }
  const rename = (document.getElementById('authRename').value || '').trim();
  const btn = document.getElementById('authClaimBtn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/session/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_ids: ids, rename_to: rename }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { document.getElementById('authClaimErr').textContent = d.error || ('认领失败 (HTTP ' + r.status + ')'); return; }
    onAuthed(d);
  } catch (e) {
    document.getElementById('authClaimErr').textContent = '网络异常：' + e.message;
  } finally { btn.disabled = false; }
}

async function doPair(code) {
  code = (code || document.getElementById('authCode').value || '').trim();
  if (!code) { document.getElementById('authPairErr').textContent = '请输入配对码'; return; }
  const btn = document.getElementById('authPairBtn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/session/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { document.getElementById('authPairErr').textContent = d.error || '配对失败'; return; }
    onAuthed(d);
  } catch (e) {
    document.getElementById('authPairErr').textContent = '网络异常：' + e.message;
  } finally { btn.disabled = false; }
}

async function onAuthed(st) {
  const back = authReturnHash && /^#\/(home|invest|holdings|asset|finance|rebalance|settings)$/.test(authReturnHash) ? authReturnHash : '';
  authReturnHash = '';
  document.getElementById('authGate').hidden = true;
  if (back && location.hash !== back) location.hash = back;
  else if ((location.hash || '').startsWith('#/pair')) location.hash = '#/home';
  await enterApp(st);
}

async function doLogout() {
  try { await api('/api/session/logout', { method: 'POST', body: '{}' }); } catch (e) { /* 会话可能已失效 */ }
  pinCache = '';
  authState = { authed: false, mode: '', user: null, users: [], read_only: false, has_pin: false };
  document.getElementById('app').hidden = true;
  localStorage.removeItem('pf_user');
  showAuthGate(await fetchSession());
}

// ---- 设置页：登录与设备 ----
function deviceLabel(ua) {
  if (!ua) return '未知设备';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

async function loadAuthDevices() {
  const wrap = document.getElementById('deviceList');
  if (!wrap) return;
  try {
    const st = await fetchSession();
    if (st) authState = st;
    if (!authState.authed) { wrap.innerHTML = '<div class="auth-hint">未登录</div>'; return; }
    const r = await api('/api/session/devices');
    if (!r.ok) { wrap.innerHTML = '<div class="auth-hint">读取失败</div>'; return; }
    const d = await r.json();
    const list = d.devices || [];
    if (!list.length) { wrap.innerHTML = '<div class="auth-hint">暂无其他设备</div>'; }
    else {
      wrap.innerHTML = list.map((s) => `
        <div class="device-row" data-id="${s.id}">
          <span class="device-name">${escapeHtml(deviceLabel(s.ua))}</span>
          ${s.current ? '<span class="device-badge">本机</span>' : ''}
          <span class="device-ua" title="${escapeHtml(s.ua || '')}">${escapeHtml(s.ua || '')}</span>
          <span class="device-seen">${escapeHtml((s.last_seen || '').slice(5, 16))}</span>
          ${s.current ? '' : `<button class="btn btn-sm device-revoke" type="button" data-id="${s.id}">吊销</button>`}
        </div>`).join('');
      // 两段式确认：第一次点变「确认吊销」，再点才执行（免开确认弹框）
      wrap.querySelectorAll('.device-revoke').forEach((btn) => {
        btn.onclick = async () => {
          if (btn.dataset.armed !== '1') {
            btn.dataset.armed = '1';
            btn.textContent = '确认吊销';
            setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = '吊销'; } }, 4000);
            return;
          }
          const r2 = await api('/api/session/devices/' + btn.dataset.id, { method: 'DELETE' });
          if (r2.ok) { toast('已吊销该设备，其 Cookie 立即失效', 'ok'); loadAuthDevices(); }
          else toast('吊销失败', 'err');
        };
      });
    }
    document.getElementById('authCurName').textContent = authState.user ? authState.user.name : '—';
    updatePinState(!!authState.has_pin);
  } catch (e) {
    if (e.message !== 'unauthenticated') wrap.innerHTML = '<div class="auth-hint">读取失败</div>';
  }
}

// ---- 出码：添加设备 / 邀请家人 ----
async function genPairCode(scope, payload) {
  const r = await api('/api/session/code', { method: 'POST', body: JSON.stringify({ scope, ...(payload || {}) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (!(d && d.pin_required)) toast(d.error || '出码失败', 'err'); return null; }
  return d;
}

function openPairCodeModal(info, isInvite) {
  document.getElementById('pairCodeTitle').textContent = isInvite ? '邀请码' : '配对码';
  document.getElementById('pairCodeValue').textContent = info.code || '······';
  document.getElementById('pairCodeHint').textContent = isInvite
    ? '把该码发给对方：在对方自己的设备上打开本站，输入此码即可接入。'
    : '在要接入的新设备上打开本站，输入此码即可接入本账本。';
  const sec = info.expires_in || 300;
  const ttl = sec >= 3600 ? (sec / 3600) + ' 小时' : Math.max(1, Math.round(sec / 60)) + ' 分钟';
  document.getElementById('pairCodeMeta').textContent = '有效期 ' + ttl + '，仅可使用一次';
  document.getElementById('pairCodeModal').hidden = false;
}

function openInviteModal() {
  const sel = document.getElementById('inviteUser');
  sel.innerHTML = (authState.users || []).map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');
  sel.disabled = true;
  document.getElementById('inviteName').value = '';
  document.getElementById('inviteErr').textContent = '';
  document.getElementById('inviteModal').hidden = false;
}

function updatePinState(has) {
  const el = document.getElementById('pinState');
  if (el) el.textContent = has ? '已设置' : '未设置（建议设置）';
}

// ---- 操作 PIN 弹框（promise 化，api() 自动调用）----
let pinResolve = null;
function promptPIN() {
  return new Promise((resolve) => {
    pinResolve = resolve;
    document.getElementById('pinPromptInput').value = '';
    document.getElementById('pinPromptErr').textContent = '';
    document.getElementById('pinPromptModal').hidden = false;
    setTimeout(() => document.getElementById('pinPromptInput').focus(), 50);
  });
}
function closePIN(val) {
  const modal = document.getElementById('pinPromptModal');
  if (modal) modal.hidden = true;
  if (pinResolve) { const fn = pinResolve; pinResolve = null; fn(val); }
}

// ---- 绑定 ----
(function wireAuthUI() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('authClaimBtn', doClaim);
  on('authPairBtn', () => doPair());
  on('authRoBtn', () => { document.getElementById('authGate').hidden = true; enterApp(authState); });
  const codeInput = document.getElementById('authCode');
  if (codeInput) codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doPair(); });
  on('authLogoutBtn', doLogout);
  on('addDeviceBtn', async () => {
    try { const d = await genPairCode('device', {}); if (d) openPairCodeModal(d, false); } catch (e) { /* 取消 PIN */ }
  });
  on('inviteMemberBtn', openInviteModal);
  on('inviteCancel', () => { document.getElementById('inviteModal').hidden = true; });
  on('inviteClose', () => { document.getElementById('inviteModal').hidden = true; });
  document.querySelectorAll('input[name="inviteMode"]').forEach((rad) => {
    rad.onchange = () => {
      const isNew = document.querySelector('input[name="inviteMode"]:checked').value === 'new';
      document.getElementById('inviteName').disabled = !isNew;
      document.getElementById('inviteUser').disabled = isNew;
    };
  });
  on('inviteOk', async () => {
    const isNew = document.querySelector('input[name="inviteMode"]:checked').value === 'new';
    const payload = isNew
      ? { name: (document.getElementById('inviteName').value || '').trim() }
      : { user_id: Number(document.getElementById('inviteUser').value) };
    if (isNew && !payload.name) { document.getElementById('inviteErr').textContent = '请填写新账本名称'; return; }
    try {
      const d = await genPairCode('invite', payload);
      if (d) { document.getElementById('inviteModal').hidden = true; openPairCodeModal(d, true); }
    } catch (e) { document.getElementById('inviteErr').textContent = e.message; }
  });
  on('pairCodeClose', () => { document.getElementById('pairCodeModal').hidden = true; });
  on('pairCodeDone', () => { document.getElementById('pairCodeModal').hidden = true; });
  on('pairCodeCopy', () => {
    const code = (document.getElementById('pairCodeValue').textContent || '').trim();
    if (!code || code === '······') { toast('没有可复制的配对码', 'err'); return; }
    // 复用通用复制：secure context 走 clipboard，否则降级 execCommand（局域网 IP 非 https 时仍能复制）
    copyText(code, '已复制配对码');
  });
  on('pinPromptCancel', () => closePIN(null));
  on('pinPromptClose', () => closePIN(null));
  on('pinPromptOk', () => {
    const v = (document.getElementById('pinPromptInput').value || '').trim();
    if (!/^\d{4,6}$/.test(v)) { document.getElementById('pinPromptErr').textContent = 'PIN 需为 4–6 位数字'; return; }
    closePIN(v);
  });
  const pinInput = document.getElementById('pinPromptInput');
  if (pinInput) pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('pinPromptOk').click(); });
  on('pinSaveBtn', async () => {
    const oldPin = (document.getElementById('pinOld').value || '').trim();
    const newPin = (document.getElementById('pinNew').value || '').trim();
    if (newPin && !/^\d{4,6}$/.test(newPin)) { toast('PIN 需为 4–6 位数字', 'err'); return; }
    try {
      const r = await api('/api/session/pin', { method: 'POST', body: JSON.stringify({ pin: newPin, old_pin: oldPin }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || '保存失败', 'err'); return; }
      document.getElementById('pinOld').value = '';
      document.getElementById('pinNew').value = '';
      authState.has_pin = d.has_pin;
      updatePinState(d.has_pin);
      toast(d.has_pin ? '操作 PIN 已保存' : '操作 PIN 已关闭', 'ok');
    } catch (e) { toast('保存失败：' + e.message, 'err'); }
  });
})();
