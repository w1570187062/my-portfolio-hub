const $ = (s) => document.querySelector(s);

// ===== 主题切换（日间 / 夜间 / 跟随系统） =====
// pf_theme 存的是「模式」而不是最终主题：light | dark | system。
// system 由 prefers-color-scheme 解析成 light/dark，并在系统切换时实时跟随（做法同 PanWatch 的 useTheme）。
// 默认 dark：保持既有观感，没存过偏好的老用户不会突然变浅色。
const THEME_MODES = ['light', 'dark', 'system'];
const darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let themeMode = 'dark'; // 用户选择的模式（记忆态，事实源仍是 localStorage + dataset.theme）
function systemTheme() {
  return darkMq && darkMq.matches ? 'dark' : 'light';
}
function applyTheme(mode) {
  themeMode = THEME_MODES.includes(mode) ? mode : 'dark';
  const theme = themeMode === 'system' ? systemTheme() : themeMode; // 实际生效的主题
  document.documentElement.dataset.theme = theme;
  // 移动端地址栏 / 状态栏配色随实际主题走，否则选了日间仍是深色标题栏
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f6f9' : '#0a0e14');
  // 个人菜单里的勾选态与主题模式同步（函数声明已提升，首屏调用时查不到节点也无害）
  syncAcctTheme();
}
applyTheme(localStorage.getItem('pf_theme') || 'dark');

// 跟随系统：仅在 system 模式下响应 OS 主题变化（显式 light/dark 时忽略，不覆盖用户选择）
if (darkMq) {
  const onSchemeChange = () => { if (themeMode === 'system') applyTheme('system'); };
  if (darkMq.addEventListener) darkMq.addEventListener('change', onSchemeChange);
  else if (darkMq.addListener) darkMq.addListener(onSchemeChange); // 旧版 Safari
}

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
  // 明暗主题入口统一在右上角个人菜单（日间 / 夜间 / 跟随系统三项）；设置页的「深色模式」开关已于 2026-10-29 移除，
  // 同一功能留两套控件只会让两处状态不同步，故只保留菜单一处。
  // 这里再调一次是为了 DOM 就绪后重排勾选态（首屏那次调用时菜单节点还没解析出来）。

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
// 设置 / AI 配置 / 设备 / 通知只在右上角个人菜单里有入口，不占主导航。
const VIEWS = ['home', 'invest', 'asset', 'finance', 'settings', 'ai', 'devices', 'notify'];

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
  ['homeView', 'holdingsView', 'assetView', 'financeView', 'settingsView', 'aiView', 'devicesView', 'notifyView'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
}

// ===== 全站统一加载动画（2026-11-02）=====
// 三层机制，详见 docs/ui-design-spec.md §7.17：
//   ① 视图层 .view-fade  —— 切页瞬间整个视图淡入，消除硬切
//   ② 区块层 .rise-in    —— 数据到达后，区块逐个上浮淡入（错落由 --d 控制）
//   ③ 骨架层             —— 等待数据时的 shimmer 占位
//
// 铁律：动画只碰 opacity / transform，绝不改 height / margin ——
// 后者会触发布局重排，表格会肉眼可见地抖一下，比没有动画更糟。

// 视图层淡入：路由切换后给新视图加上。
// 用「移除 → 强制重排 → 重新加上」的写法保证重复导航（点同一个 tab）也能重播。
function playViewFade(viewEl) {
  if (!viewEl) return;
  viewEl.classList.remove('view-fade');
  void viewEl.offsetWidth;   // 强制重排，让动画能重新触发
  viewEl.classList.add('view-fade');
}

// 区块层错落上浮：给容器内的直接子区块依次加上 .rise-in。
// sel 限定「哪些元素算一个区块」（默认取直接子元素）；step 是每块的延迟增量（ms）。
// 播放时机（2026-11-02）：每个容器一次会话只播一次 ——
//   ① riseArmed：路由进入视图（applyRoute 置位）才允许播，后台数据刷新（行情轮询、
//      记一笔后 loadAsset）造成的重渲染一律不播；
//   ② risenViews（WeakSet 按容器记录）：财务这类「每次渲染整体重建 innerHTML」的页面，
//      节点永远是新的，必须按容器去重，否则每次点进导航整页重新跳一遍；
//   ③ risenEls（WeakSet 按块记录）：force 切投资页 tab 时不重播已播过的持久 hero
//      （类会被下方 animationend 摘掉，所以不能只看 class）。
// 另见下方 animationend 监听：播完立即摘类。带 animation 声明的元素在视图
// display:none→visible 切换时会被浏览器自动重启动画（纯 CSS 行为）——
// 「点进导航整页跳 N 次」的真正根源，摘干净类后 display 切换就是纯显示。
let riseArmed = true;
const risenViews = new WeakSet();
const risenEls = new WeakSet();
function playRiseIn(container, sel, step, force) {
  if (!container) return;
  if (!riseArmed && !force) return;
  if (!force && risenViews.has(container)) return;
  const list = sel ? container.querySelectorAll(sel) : container.children;
  const gap = step == null ? 40 : step;
  const targets = [];
  let i = 0;
  for (const el of list) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.hidden) continue;
    if (risenEls.has(el)) continue;
    el.style.setProperty('--d', (i * gap) + 'ms');
    targets.push(el);
    i++;
  }
  // 真正播了才消耗武装标记：空视图（如后台对隐藏投资页的刷新）不算。
  if (targets.length) {
    riseArmed = false;
    risenViews.add(container);
    // 一次性强制重排后再统一加上 class —— 否则「移除 → 立刻加回」在同一帧内
    // 不会触发重启动画，重复渲染时（比如切 tab 后重渲染同一批区块）就看不到动效。
    void targets[0].offsetWidth;
    targets.forEach((el) => { el.classList.add('rise-in'); risenEls.add(el); });
  }
}
// riseIn 播完立即摘类 + 摘延迟变量，杜绝 display 切换触发的浏览器自动重播。
document.addEventListener('animationend', (e) => {
  if (e.animationName !== 'riseIn' || !(e.target instanceof HTMLElement)) return;
  e.target.classList.remove('rise-in');
  e.target.style.removeProperty('--d');
});
function applyRoute() {
  const v = viewFromHash();
  currentNavView = v;
  riseArmed = true; // 进入新视图才允许播区块入场动画（见 playRiseIn）
  setActiveNav(v);
  hideAllViews();
  closeAcctMenu(); // 路由切换时收起个人菜单（同 PanWatch 的 route 变化即关闭）
  if (v === 'home') showHomeView();
  else if (v === 'asset') showAssetView();
  else if (v === 'finance') showFinanceView();
  else if (v === 'settings') showSettingsView();
  else if (v === 'ai') showAiView();
  else if (v === 'devices') showDevicesView();
  else if (v === 'notify') showNotifyView();
  else showHoldingsView();
  // 视图层淡入：切页瞬间整个视图淡入，消除「旧页消失 / 新页啪地出现」的硬切。
  // 放在 showXxx 之后 —— 那时才刚把 hidden 置 false，加类才会真的播。
  playViewFade(document.getElementById(viewIdOf(v)));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 路由名 → 视图容器 id（showXxxView 里各写各的，这里补一张对照表供动画层用）
function viewIdOf(v) {
  return v === 'home' ? 'homeView'
    : v === 'invest' ? 'holdingsView'
      : v === 'asset' ? 'assetView'
        : v === 'finance' ? 'financeView'
            : v === 'settings' ? 'settingsView'
              : v === 'ai' ? 'aiView'
                : v === 'devices' ? 'devicesView'
                  : v === 'notify' ? 'notifyView'
                    : 'homeView';
}
function navigate(view) {
  if (!VIEWS.includes(view)) view = 'invest';
  if (location.hash !== '#/' + view) location.hash = '/' + view; // 触发 hashchange → applyRoute
  else applyRoute(); // hash 已一致：幂等应用（重复点击同一导航）
}
window.addEventListener('hashchange', applyRoute);

// ---- 认证层（2026-10-28）：身份由 HttpOnly Cookie 决定，前端不再自报 X-User-Id ----
// 401 → 弹出认领/配对闸门；403+pin_required → 弹操作 PIN 输入框并自动重试一次；
// 403+owner_required → 账本级不可逆操作（改 PIN / 恢复码 / 转移主设备 / 删清账本 / 导入）只属主设备；
// 设备管理（改名 / 吊销他机 / 出码）自 2026-11-02 起不再看角色，由 PIN 兜底。
// role: owner=主设备（管理员）/ member=普通设备；has_recovery=是否已有恢复码（不回传明文）。
let authState = { authed: false, mode: '', user: null, users: [], read_only: false, has_pin: false, role: 'member', has_recovery: false };
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
// 金额是否为「无信息」的 0（含浮点残渣）。0 会占满一整格并被染成涨跌色，
// 噪音大于信息量；调用方把它降级成「—」。定义放在金额工具区，避免被渲染函数提前引用。
const amtIsZero = (v) => Math.abs(Number(v) || 0) < 0.005;
const ZERO_DASH = '<span class="zero-dash">—</span>';
// 盈亏专用格式：强制 2 位小数 + 显式正负号（如 +432.00 / -18.34 / 0.00）。
// 整数与小数统一成同一「形状」，配合 tabular-nums 按小数点对齐，避免整数(432)比小数(72.42)视觉更窄被看岔。
const fmtPnl = (n) => (n == null ? '' : (n > 0 ? '+' : n < 0 ? NEG : '') + Math.abs(Number(n)).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// ── 金额展示唯一入口（方案 3）────────────────────────────────────────────
// 规则：|n| ≥ 1万 → 「x.xx万」；不足万 → 千分位 + 强制 2 位小数（¥183.20，不是 ¥183.2）。
// 之所以强制 2 位：同一屏里「¥147,512.51 / ¥150,723.70」的小数位必须一致，
// 否则 tabular-nums 下整数与一位小数错半格，读者还会以为是精度不同。
// 需要精确对账的位置（导出、编辑弹窗回填）必须用原始元值，这里只做展示层转换。
// 所有金额（含计价/成本、盈亏、汇总）都走这个函数或其包装
// （moneyCurW / yuanOfW / signedMoneyW / fmtWanPnl / fmtPnl），禁止各页面自己 toFixed。
const fmtMoney = (n) => {
  const v = Number(n) || 0, a = Math.abs(v);
  return a >= 1e4 ? (v / 1e4).toFixed(2) + '万'
    : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
// 历史别名（调用点遍布全站，语义与 fmtMoney 完全一致）：保留名字，实现只此一份。
const fmtWan = fmtMoney;
// 精确元值（不压缩、强制 2 位）：只用于 title / 悬停还原、编辑弹窗回填等「需要一分不差」的位置，
// 正文一律走 fmtMoney。两者共享同一套 2 位小数规则，只是不压缩量纲。
const fmtYuanExact = (n) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// 万位压缩的盈亏版：符号 + 货币符号 + 2 位小数（+¥46.55 / −¥183.20 / ¥0.00）。
// 符号一律提到货币符号之前（此前组头只写「+10.64」，同一屏内表格行却是「+¥10.64」）。
const fmtWanPnl = (n, cur) => (n > 0 ? '+' : n < 0 ? NEG : '') + curSymbolJS(cur || 'cny') + fmtMoney(Math.abs(n));
// 万位金额悬停精确值：仅 |n| ≥ 1万 时输出 title 属性（prefix 传货币符号），配合 fmtWan 使用；
// 负数符号提到货币符号前（-¥89,000，而不是 ¥-89,000）
const wanTitle = (n, prefix) => {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1e4) return '';
  return ` title="${v < 0 ? NEG : ''}${prefix || ''}${fmtYuanExact(Math.abs(v))}"`;
};
// money / moneyCur / yuanOf 的万位压缩版（≥1万显示 x.xx万，其余同原函数）
const moneyCurW = (n, cur) => curSymbolJS(cur) + fmtWan(n == null ? 0 : n);
// 全站负号一律用 U+2212（−），不用 ASCII hyphen：中文排版下 − 与数字等宽、视觉对齐更好，
// 且历史上「−¥1.68万 / -¥6,383.45」两种字符同屏混用。此处是唯一真源，其它符号函数都复用 NEG 常量。
const NEG = '\u2212';
// yuanOfW：万位压缩版（≥1万显示 x.xx万，其余同 yuanOf 原始值）
const yuanOfW = (v) => { const n = Number(v) || 0; return (n < 0 ? NEG + '¥' : '¥') + fmtWan(Math.abs(n)) };
// 带符号货币金额（不做万位压缩）：符号一律提到货币符号之前（−¥89,000，而非 ¥-89,000），0 不带 +。
// 用于表格里的盈亏金额列，避免负数被渲染成「¥-201」这种别扭形状。
const signedCur = (v, cur) => {
  const n = Number(v) || 0;
  return (n < 0 ? NEG : n > 0 ? '+' : '') + curSymbolJS(cur) + fmt(Math.abs(n));
};
// 同上，但走万位压缩（≥1万显示 x.xx万）：分组头 / 表格里的盈亏列统一用这个，
// 避免「¥-1,240.5」这种符号落在货币符号之后的形状（落袋 / 今日 / 总盈亏都踩过）。
const signedMoneyW = (v, cur) => {
  const n = Number(v) || 0;
  return (n < 0 ? NEG : n > 0 ? '+' : '') + curSymbolJS(cur) + fmtWan(Math.abs(n));
};

// 价格类字段统一截断到 4 位小数，避免 float64 全精度（如 12.34738291）污染输入框与落库。
const round4 = (n) => { const v = Number(n); if (!isFinite(v)) return 0; return Math.round(v * 1e4) / 1e4; };
const round2 = (n) => { const v = Number(n); if (!isFinite(v)) return 0; return Math.round(v * 1e2) / 1e2; };
// 按类别保留小数：股票 / 基金 4 位（美股/部分基金现价与成本价需 4 位精度）、其余 2 位（成本价/昨收/成交价口径）
const roundByCat = (v, cat) => (cat === 'fund' || cat === 'stock' ? round4(v) : round2(v));
function fmtCat(n, cat) { return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: (cat === 'fund' || cat === 'stock') ? 4 : 2 }); }
// 试算 Tab 上下文类别（决定价格输入框保留几位小数），由 prefillAdjCalc 写入
let calcCat = 'stock';
// 负号走 NEG（U+2212）而非 ASCII hyphen：与金额列同源，同屏混用时字宽一致、不会左右错半格。
const pct = (n) => (n == null ? '' : (n > 0 ? '+' : n < 0 ? NEG : '') + Math.abs(n).toFixed(2)) + '%';
// 盈亏颜色统一入口：正=红(up)、负=绿(down)、零=灰(flat)（中国惯例涨红跌绿）。
// 分级柔化（2026-11-02 H5）：对"像收益率的小数"（|n|<100，持仓收益率/涨跌幅度 %）按深度分级降饱和度，
// 避免深套时刺眼绿放大焦虑；绝对金额（|n|≥100，如 ¥2,345 亏损）不分级，保持基础 down 色。
// 分级阈值：|n| ≥ 15 → down-deep（深套 ~45% 饱和）；|n| ≥ 5 → down-mid（中亏 ~65% 饱和）；否则 down（饱和）。
const clsPnl = (n) => {
  if (n > 0) return 'up';
  if (n === 0 || n == null) return 'flat';
  const m = Math.abs(n);
  if (m < 100) {
    if (m >= 15) return 'down down-deep';
    if (m >= 5)  return 'down down-mid';
  }
  return 'down';
};
const cat = (c) => (c === 'fund' ? '基金' : '股票');
// ── 价格展示唯一入口（方案 3）：fmtPrice，历史名 fmtNav ──────────────────
// 基金 / 理财净值：强制 4 位小数（净值本身 4 位，按 2 位展示会四舍五入失真，
// 例如 1.0163 → 1.02，与成本价、份额三者的乘积对不上）。
// 股票：最多 4 位（美股/部分场内基金现价需第 3-4 位，强制 2 位同样会失真），
// 其余（无类别上下文）按金额规则 2 位。
// 与 fmtMoney 的分工：价格是「每份」单价，不做万位压缩；金额是「总额」，≥1万压缩。
const fmtPrice = (n, kind) => {
  if (n == null) return '';
  if (kind === 'fund' || kind === 'wealth') return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if (kind === 'stock') return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
// 注：旧名 fmtNav 已全部改为 fmtPrice，全站价格只有一个入口。

// ── 流水日期唯一入口（方案 2）──────────────────────────────────────────
// 是否显示年份，取决于「这一屏有没有别的年份锚点」，而不是「是不是今年」：
//   mode 省略    → 同年「10-30」、跨年「25-10-30」。
//                  用于已有年份上下文的列表：财务「收支分类明细」（顶部年份切换器锁定整年）、
//                  资产页流水表（近 7/30/365 天，跨年窗口里老记录会自动补位）。
//   mode='year'  → 恒带两位年份「26-10-30」。首页「最新流水」专用：它只取最近几条、
//                  周围没有任何年份文字，只写「10-30」读者无从判断是哪一年。
//                  （2026-11-01 修：此前按「同年省略」处理，而实盘 71 条流水全在当年，
//                    条件永不成立 → 首页永远看不到年份，等于方案在首页没生效。）
//   mode='full'  → 一律 YYYY-MM-DD，只给 title 用。
const fmtFlowDate = (d, mode) => {
  const s = String(d || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const y = s.slice(0, 4), md = s.slice(5);
  if (mode === 'full') return s;
  if (mode === 'year' || y !== String(new Date().getFullYear())) return y.slice(2) + '-' + md;
  return md;
};
// 流水日期悬停提示：完整日期 + 记录时间（created_at 的 HH:mm；没有就只给日期）。
// 列表里日期只有 5 个字符，具体到「几分几秒」的先后顺序只能靠悬停。
const flowDateTitle = (f) => {
  if (!f) return '';
  const full = fmtFlowDate(f.date, 'full');
  const t = String(f.created_at || f.createdAt || '');
  const hm = /(\d{2}):(\d{2})/.exec(t);
  return hm ? full + ' ' + hm[1] + ':' + hm[2] : full;
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
let usdRate = 1;
let hkdRate = 1;
let snapshotDate = '';   // 最近 pnl_daily 快照日期（YYYY-MM-DD）
let monthPnlCNY = 0;     // 本月累计盈亏（CNY 折算）
let monthPnlCny = 0;     // 本月累计盈亏（CNY 原始货币）
let todayRealizedCny = 0; // 今日已实现盈亏（减仓落库，CNY 折算），并入首页「今日盈亏」
let monthPnlUsd = 0;     // 本月累计盈亏（USD 原始货币）
// 当日盈亏的「归属交易日」（后端 /api/home 与 /api/asset/overview 都给）：交易日=今天，
// 周末/法定节假日=最近一个交易日。非交易日那笔数不是今天赚的，标签必须跟着改。
let pnlDateStr = '';
let failedSymbols = {};  // symbol -> 失败原因（刷新失败持久标记）
// table | card；移动端（窄屏）默认卡片视图（表格横向溢出体验差），但不强制——允许用户手动切回表格（可横向滚动）
// 首页主区切换：持仓 / 理财（localStorage 记忆），默认持仓
let homeSection = localStorage.getItem('pf_home_section') || 'holdings';
let homeLoadError = false;  // 首页持仓数据加载失败标记（驱动 alert-triangle 空态）

// 基金判定：以是否关联基金代码（linked_symbol）为准，取代已废弃的手动分类字段 category
const isFund = (h) => !!(h && (h.category === 'fund' || (h.linked_symbol && String(h.linked_symbol).trim())));

// 投资页表头工具条状态（复用原型 holding-toolbar 的筛选 chips + 排序下拉）
let holdingsSort = 'mv';        // 持仓排序：mv 市值 | profit 盈亏 | days 持仓天数（点击表头切换，见 renderHoldingsBySource）
let holdingsSortDir = 'desc';   // 排序方向：desc 降序 | asc 升序（再次点击同一表头 toggle）
let flowRangeDays = 30;         // 资产页流水区间：365 | 30 | 7 | 0（0 = 自定义区间，见 flowRangeCustom）
let flowRangeCustom = null;     // 自定义区间 {from:'YYYY-MM-DD', to:'YYYY-MM-DD'}；仅当 flowRangeDays === 0 时生效
let homeNetVal = 0;             // 首页净资产走势区间收益率基准（= 净资产）
let flowTypeFilters = [];       // 资产页流水类型多选：in | out | dividend | trade | invest | transfer；空数组 = 全部
let assetFlowsCache = [];       // 资产页流水缓存（供筛选/区间重渲染，避免重复请求）
let assetFlowsKey = '';         // 上面这份缓存对应的取数区间标识；变了就要重新请求（'' = 尚未加载）
let homeRecentFilter = 'all';    // 首页最新流水类型过滤：all | in | out | neutral
let homeRecentFlowsData = [];    // 首页最新流水全量缓存（近 45 天最近 8 笔，供类型过滤重渲染）
let homeRateHoverData = null;    // 权益曲线 hover 弹框所需序列（由 renderRateSpark 赋值）
let homeMarqueeData = null;      // 首页跑马灯数据：{ groups, total } 来自 /api/today/brief + 收益句子）
// 跑马灯不需要展开态：hover 暂停、始终滚动）
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
  // 方案 16：AI 设置（/api/ai/settings + /api/mcp/config + /api/mcp/status）不在首屏拉，
  // 改由 showAiView() / aiChatOpen() 首次真正用到时触发（见 ensureAiSettings）。
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

// 把原始技术错误翻译成人话（HTTP 状态码 / NetworkError / 后端 message）。
// 不要向用户暴露 HTTP 裸码、e.message 原始串——那是程序员排查用的。
function humanizeErr(r, e, fallback) {
  if (r && typeof r.status === 'number') {
    switch (r.status) {
      case 401: case 403: return '会话失效，重新配对';
      case 404: return '这条记录可能不存在了';
      case 429: return '请求过于频繁，稍后重试';
      default:
        if (r.status >= 500) return '服务暂时不可用，稍后重试';
        return fallback || '请求失败';
    }
  }
  if (e) {
    const msg = (e.message || String(e)).toLowerCase();
    if (msg.includes('networkerror') || msg.includes('failed to fetch') || msg.includes('network')) return '连不上服务端，检查网络';
  }
  return fallback || '操作失败';
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
    if (!r.ok) { toast(humanizeErr(r, null, '加载失败'), 'err'); return; }
    const hd = await r.json();
    usdRate = hd.rate || 1;
    hkdRate = hd.hkd_rate || 1;
    allHoldings = hd.holdings || [];
    assetSources = hd.sources || [];
    sparkCache = hd.spark || {};
    cashBalMap = hd.cash || {};
    snapshotDate = hd.snapshot_date || '';
    monthPnlCNY = hd.month_pnl_cny || 0;
    monthPnlCny = hd.month_pnl_cny_ccy || 0;
    monthPnlUsd = hd.month_pnl_usd || 0;
    todayRealizedCny = hd.today_realized_cny || 0;
    pnlDateStr = hd.pnl_date || '';
    // 方案 16：三项互不依赖，改成并行 —— 原先串行 await 是三个串起来的往返，
    // 首屏完成时间被拖长一个 RTT 的量级。
    await Promise.all([
      loadManualClosed(),   // 已平仓页手动补录记录（不入账）
      loadCustomFlowCats(), // 自定义收支分类（设置页维护，选择器/统计共用）
      loadDeposits(),       // 存款列表（首页「存款」分段）
    ]);
    renderFiltered();
    loadCashflow(); // 首页紧凑卡片：本月收支计划（不阻塞主渲染）
    // 首屏数据就绪后，重渲染依赖 overview 的常驻视图（首页净资产/资产分布依赖 assetData；财务概览重渲染幂等）
    const _v = viewFromHash();
    if (_v === 'home') showHomeView();
    else if (_v === 'finance') showFinanceView();
  } catch (e) {
    homeLoadError = true;
    toast(humanizeErr(null, e, '加载失败'));
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
    msg: '还原份额与成本价、重新计入总资产。',
    okText: '回退（恢复持仓）', danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/holdings/' + id + '/reopen', { method: 'POST' });
        if (!r.ok) { let m = '回退失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
        await refreshClosedData();
        toast('已撤销清仓，持仓已恢复', 'ok');
      } catch (e) { toast(humanizeErr(null, e)); }
    },
  });
}

// 行情时效性标识由 header 第二行展示。

// Holdings（返回全部持仓）。
function filteredHoldings() {
  return allHoldings;
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
  const empty = document.getElementById('holdingsEmpty');
  const srcBox = document.getElementById('holdingsBySource');
  const metaBar = document.querySelector('.tbl-meta-bar');
  const wl = document.getElementById('homeWealthBox');
  const vt = document.getElementById('viewToggle');
  const closedBox = document.getElementById('closedView');

  if (metaBar) metaBar.hidden = false;

  // 每个 tab 有自己的 KPI 口径（持仓看市值/今日/本月/收益率，平仓看落袋，理财看收益/年化，
  // 存款看本金/利息/到期）。但**不能只隐藏不补位**——那样下方内容整体上移，切 tab 会有
  // 明显跳变。改为四块 KPI 在同一位置互换（结构一致、卡片数一致、高度对齐）。
  // 四个 tab 共用同一块顶部区域：只切换显隐，内容等高（眉标 + 4 张 .kpi-card），
  // 因此切换时下方内容不会位移。新增 tab 只需在这里加一项。
  applyInvestSection();

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

  // 视图级控件（行密度 / 刷新行情）渲染在子 tab 行右端，四态共用；存款态内部自行收起
  renderInvestToolbar();

  // 已平仓视图：隐藏持仓/理财，显示落袋收益汇总（行密度切换仍可用，故控件保留）
  if (homeSection === 'closed') {
    if (srcBox) srcBox.hidden = true;
    if (wl) wl.hidden = true;
    const depBoxC = document.getElementById('homeDepositBox');
    if (depBoxC) depBoxC.hidden = true;
    if (empty) empty.hidden = true;
    if (closedBox) { closedBox.hidden = false; renderClosed(closedBox, closedHoldings, closedWealth); }
    playInvestRise();
    return;
  }

  // 恢复子 tab 行（非 closed 视图）
  if (vt) vt.hidden = false;

  // 存款视图：隐藏持仓/理财区，主区域显示存款表格（renderDeposits）
  if (homeSection === 'deposits') {
    if (srcBox) srcBox.hidden = true;
    if (empty) empty.hidden = true;
    if (closedBox) closedBox.hidden = true;
    if (wl) wl.hidden = true;
    const depBox = document.getElementById('homeDepositBox');
    if (depBox) { depBox.hidden = false; renderDeposits(depBox); }
    playInvestRise();
    return;
  }

  // 理财视图：隐藏持仓区，主区域显示理财管理区（表格视图）
  if (homeSection === 'wealth') {
    if (srcBox) srcBox.hidden = true;
    if (empty) empty.hidden = true;
    if (closedBox) closedBox.hidden = true;
    // 存款盒必须一并隐藏：从「存款」切回「理财」时它不会自动收起（曾残留整张存款表）
    const depBoxW = document.getElementById('homeDepositBox');
    if (depBoxW) depBoxW.hidden = true;
    if (wl) { wl.hidden = false; renderWealth(wl); }
    playInvestRise();
    return;
  }

  // 持仓视图（默认）：隐藏理财区，按来源分组表展示
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
  playInvestRise();
}

// 投资页区块层错落上浮：切持仓/理财/存款/平仓时，让「KPI 卡片 → 主表」两块依次入场。
//
// 必须在各分支的 render* 之后调用 —— 放在 renderFiltered 开头的话，
// 主表容器还没渲染/还没取消 hidden，选中态就只剩 KPI 卡一块（实测过）。
// 四个 tab 共用同一套位置（KPI hero + 主表），所以错落结构在四态里是一致的。
function playInvestRise(force) {
  const hv = document.getElementById('holdingsView');
  if (!hv) return;
  // 只给当前可见的两个区块排错落：KPI hero（.invest-hero 里有四个互斥显隐的 hero）
  // 与主表容器。隐藏的不参与（playRiseIn 内部会跳过 hidden）。
  playRiseIn(hv, '.invest-hero, .home-wealth-box, .holdings-by-source, .closed-view', 50, force);
}

// 已平仓汇总视图：持仓(quantity<=0) + 理财(archived=1) 的系统归集，合并「手动补录」纯记录（不入账）。
// 列：名称 / 代码 / 类型 / 盈亏金额 / 盈亏% / 年化% / 来源 / 清仓时间 / 天数 / 操作。
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
  // 汇总一律折 CNY（原币 → cnyOf）：分组小计用的就是 cnyOf(金额, 币种)，
  // 早期汇总直接累加原币，导致「落袋合计 229.17 ≠ 分组小计 220.76 + 55.96」。
  closedHoldings.forEach((h) => { hTotalDays += ((h.closed_date && h.buy_date) ? daysBetween(h.buy_date, h.closed_date) : (h.holding_days || 0)); hTotalRealized += cnyOf(Number(h.realized_pnl) || 0, normCurJS(h.currency)); });
  mHold.forEach((m) => { hTotalDays += (Number(m.holding_days) || 0); hTotalRealized += mcToCny(m); });
  closedWealth.forEach((w) => { wTotalDays += (w.holding_days || 0); wTotalPnl += cnyOf(Number(w.cum_pnl) || 0, normCurJS(w.currency)); });
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
      <p class="empty-desc">清仓后标的会保留历史数据自动归入此视图；系统外的平仓可用右上角「补录平仓」批量登记。</p>
      <button class="btn primary btn-sm closed-empty-btn" type="button" data-empty-closed="1">＋ 补录平仓</button>
    </div>`;
    // 空态自带入口：入口从首页迁走后，这里是新用户唯一能看见「补录」的地方
    const eb = box.querySelector('[data-empty-closed]');
    if (eb) eb.onclick = () => openBatchClosedModal();
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
  // 单表（2026-11-02）：与持仓/理财同一结构 —— 1 个 thead + 每账户一个 tbody + 组头摘要行。
  // 旧版每账户一张表，三个账户就是三个 thead；代码列并入名称格元信息，类型保留为窄列。
  const colCount = 6;
  const thead = '<thead><tr>'
    + '<th>名称</th>'
    + '<th class="ct-type-col">类型</th>'
    + '<th class="num ct-amt" title="落袋盈亏（原币种；悬停查看折合人民币）">盈亏金额</th>'
    + '<th class="num ct-pct" title="盈亏 ÷ 本金">盈亏%</th>'
    + '<th class="num ct-days" title="持有天数">天数</th>'
    + '<th class="ht-act">操作</th>'
    + '</tr></thead>';
  let body = '';
  for (const g of arr) {
    const gpct = g.principalCny > 0 ? g.pnlCny / g.principalCny * 100 : null;
    const collapsed = closedCollapsed.has(g.name);
    body += `<tbody class="hold-grp closed-grp${collapsed ? ' is-collapsed' : ''}" data-grp="${esc(g.name)}">`
      + `<tr class="h-grp" role="button" tabindex="0" title="${collapsed ? '展开' : '收起'}该账户明细">`
      + `<td colspan="${colCount}"><div class="hg-in">`
      + `<span class="hg-l"><i class="hg-chev">▾</i>${accountLogo(g.name)}<b class="hg-name">${esc(g.name)}</b><em class="hg-count">${g.items.length} 笔</em></span>`
      + `<span class="hg-r">`
      + `<span class="hg-stat" title="该账户落袋盈亏（折合人民币）"><i>落袋</i><b class="${clsPnl(g.pnlCny)}"${wanTitle(g.pnlCny, '¥')}>${signedMoneyW(g.pnlCny, 'cny')}</b></span>`
      + (gpct != null ? `<span class="hg-stat hg-stat-rate" title="该账户盈亏率（落袋 ÷ 本金）"><i>盈亏率</i><b class="${clsPnl(gpct)}">${gpct >= 0 ? '+' : ''}${gpct.toFixed(2)}%</b></span>` : '')
      + `</span></div></td></tr>`
      + g.items.map(rowClosed).join('')
      + '</tbody>';
  }
  box.innerHTML = `<div class="holdings-sheet"><div class="subtable-wrap"><table class="asset-table holdings-table closed-table">${thead}${body}</table></div></div>`;
  bindClosedActions(box);
  bindGroupCollapse(box, closedCollapsed);
}

// 已平仓行模板（2026-11-02 单表）：名称格两行（名称 + 代码/来源口径），类型为窄列徽标。
// 手机端操作列收起，按钮改挂元信息行右侧（.hn-acts-m），与持仓/理财一致。
function rowClosed(r) {
  const pctTxt = r.pct != null ? (r.pct >= 0 ? '+' : '') + r.pct.toFixed(2) + '%' : '—';
  const pctCls = r.pct != null ? clsPnl(r.pct) : 'flat';
  const labelMap = { stock: '股票', fund: '基金', wealth: '理财' };
  const typeCls = { stock: 'ct-type-stock', fund: 'ct-type-fund', wealth: 'ct-type-wealth' }[r.ctType];
  const meta = [];
  if (r.code) meta.push(`<span class="hm-code">${esc(r.code)}</span>`);
  meta.push(r.sys ? '已清仓' : '手动补录');
  return `<tr class="ct-row ${r.sys ? (r.sysKind === 'wealth' ? 'ct-row-w' : 'ct-row-h') : 'ct-row-m'}" data-ct-type="${r.ctType}">
    <td class="h-name">
      <div class="hn-top"><span class="hn-name" title="${esc(r.name)}（${r.sys ? '已清仓' : '手动补录'}）">${esc(r.name)}</span></div>
      <div class="hn-meta">
        <span class="hn-meta-t">${meta.join(' · ')}</span>
        <span class="hn-acts-m">${r.op}</span>
      </div>
    </td>
    <td class="ct-type-col"><span class="ct-type ${typeCls}">${labelMap[r.ctType]}</span></td>
    <td class="num ct-amt ${clsPnl(r.amount)}">${signedCur(r.amount, r.currency)}</td>
    <td class="num ct-pct ${pctCls}">${pctTxt}</td>
    <td class="num ct-days">${r.days || '—'}</td>
    <td class="row-act-cell ht-act"><span class="ht-acts">${r.op}</span></td>
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
    msg: '恢复每日录入、重新计入总资产。',
    okText: '重开理财', danger: true,
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
        msg: '删除「' + (m ? m.name : '#' + id) + '」这条已平仓记录。',
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
  // 视图级控件渲染在 KPI 卡片与表格之间的工具条里（#investTools，2026-11-03 从 tab 行右端移出）。
  const bar = document.getElementById('investTools');
  if (!bar) return;
  const row = document.getElementById('investToolsRow');
  // 存款视图：存款表不参与行密度，也没有行情可刷 → 整组不渲染
  // （只藏控件不够，外层 .invest-tools-row 会留下一段空行距，所以连行一起收起）
  if (homeSection === 'deposits') {
    bar.innerHTML = '';
    bar.hidden = true;
    if (row) row.hidden = true;
    return;
  }
  bar.hidden = false;
  if (row) row.hidden = false;
  const dens = localStorage.getItem('pf_row_density') || 'standard';
  // 「刷新行情」只对证券持仓有意义：理财走净值（行内「净值」按钮逐条录入/抓取），存款是固定利率。
  const refresh = homeSection === 'holdings'
    ? '<button type="button" class="btn icon-btn inv-refresh-btn" id="invRefreshBtn" title="刷新行情（补刷漏更新的持仓数据）" aria-label="刷新行情">' + actIcon('refresh') + '</button>'
    : '';
  // 「定投计划」入口（2026-11-02 从首页快捷功能迁入）：只对证券持仓有意义 ——
  // 定投计量的是份额，理财按快照、存款按利率，都没有「每期买入」这回事。
  const dcaBtn = homeSection === 'holdings'
    ? '<button type="button" class="btn icon-btn" id="invDcaBtn" title="定投计划" aria-label="定投计划">' + actIcon('dca') + '</button>'
    : '';
  // 「补录平仓」入口（同日迁入）：系统外的平仓属平仓视图自己的事，
  // 只在切到「平仓」tab 时出现，不在首页常驻。
  const closedBtn = homeSection === 'closed'
    ? '<button type="button" class="btn icon-btn" id="invClosedBtn" title="补录平仓（批量登记系统外的平仓）" aria-label="补录平仓">' + actIcon('plus') + '</button>'
    : '';
  bar.innerHTML =
      '<div class="density-toggle" role="group" aria-label="行密度">' +
        '<button type="button" class="dt-btn' + (dens === 'compact' ? ' active' : '') + '" data-density="compact">紧凑</button>' +
        '<button type="button" class="dt-btn' + (dens === 'standard' ? ' active' : '') + '" data-density="standard">标准</button>' +
      '</div>' + dcaBtn + closedBtn + refresh;
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
  // 定投计划 / 补录平仓：两个入口从首页迁来，处理函数仍是原来的弹框（不复制逻辑）
  const dcaB = bar.querySelector('#invDcaBtn');
  if (dcaB) dcaB.onclick = () => openDCAPlans();
  const cbB = bar.querySelector('#invClosedBtn');
  if (cbB) cbB.onclick = () => openBatchClosedModal();
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
    if (!r.ok) { toast(humanizeErr(r, null, '刷新失败'), 'err'); return; }
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
    else toast('行情已更新', 'ok');
  } catch (e) {
    toast(humanizeErr(null, e, '刷新失败'));
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

// 是否展示「技术分析」入口：判据必须与后端 analysis.go 一致，
// 否则点了只会弹出「该基金未设置关联股票代码，不支持技术分析」。
// 基金（category=fund）：必须有 linked_symbol（关联代码）才有 K 线可画；其余按 symbol 判断。
function supportsAnalysis(h) {
  if (!h) return false;
  if (h.category === 'fund') return !!(h.linked_symbol && String(h.linked_symbol).trim());
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
      hint.textContent = d && d.price != null ? `${(d.date || '').slice(5)} ${fmtPrice(d.price, calcCat)}` : '';
      hint.title = d && d.price != null ? `${d.date} ${srcLabel} ${fmtPrice(d.price, calcCat)}` : '';
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

// 投资页持仓渲染（v3.8 单表）：一张卡 + 一个 thead，每来源一个 tbody（首行是组头行）。
// 组头行承载账户名与该组小计，折叠状态存在 holdCollapsed（Set<sid>），重渲染后保持。
// 持仓按 id 索引，供首页「计算」按钮快速取用成本/现价/数量（避免二次请求）
let HOLDINGS_BY_ID = {};
const holdCollapsed = new Set();
// 理财 / 平仓页折叠状态（单表后的组头也走 tbody.is-collapsed，与持仓同一套交互）
const wealthCollapsed = new Set();
const closedCollapsed = new Set();
// 组头折叠绑定（持仓 / 理财 / 平仓三张单表共用）：状态存进各自 Set，重渲染与切 tab 后保持。
// 键优先取 data-sid（账户 id），平仓表按账户名分组，用 data-grp。
function bindGroupCollapse(box, store) {
  box.querySelectorAll('tr.h-grp').forEach((tr) => {
    const toggle = () => {
      const tb = tr.parentElement;
      const key = tb.dataset.sid || tb.dataset.grp;
      if (tb.classList.toggle('is-collapsed')) store.add(key); else store.delete(key);
      tr.title = tb.classList.contains('is-collapsed') ? '展开该账户明细' : '收起该账户明细';
    };
    tr.onclick = toggle;
    tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  });
}
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
  // 非交易日（周末/法定节假日）「今日」列里是最近一个交易日的涨跌，列名跟着归属日走，
  // 否则周日看表会以为这些数字是今天产生的。
  const pdi = pnlDayInfo(pnlDateStr);
  // 单一表头（2026-11-02 A1+A2）：原先每个账户一张卡、一套 12 列表头，8 行数据要画 4 个 thead ——
  // ① 首屏 1/3 被重复列名吃掉；② 12 列固定宽合计 1512px 永远超过容器，横向滚动时
  // 盈亏列被吸右的操作列盖掉半个字（实测「+¥127.51」显示成「+¥127.5」）。
  // 现在合成一张表：1 个 thead + 每账户一个 tbody，组头行只写账户名与该组小计，不重复列名。
  // 列数 12 → 8：代码 / 成本价 / 持仓天数 收进名称格的元信息行，涨跌幅 / 收益率 收进对应
  // 数值格的副行 —— 整表统一成「主值 + 一个比率副行」的节奏，不再有的列两行有的列一行。
  // 今日列整列无内容（开盘前 / 全 0）时**整列不渲染**：一列破折号不携带信息，还占 124px 宽度。
  // 原因写在顶部 KPI 的徽章与副标里（pnlDayInfo / dayBadge），不必在表里重复一遍。
  // 注意必须不产出 <th>/<td>，只 display:none 不够 —— 表格列仍在，剩余宽度会被那一列吃掉，
  // 表现为表格右侧凭空多出一块空白（实测 395px）。
  const dayIdleAll = arr.every((g) => g.items.every((h) => pdi.preOpen || amtIsZero(toRmb(h, h.day_pnl))));
  const colCount = dayIdleAll ? 7 : 8;
  const thead = '<thead><tr>'
    + '<th>名称</th>'
    + '<th class="num ht-trend" title="近20日收盘价走势">走势</th>'
    + '<th class="num ht-price" title="现价（上）/ 涨跌幅（下）：现价相对昨收，基金为昨日净值，行情口径">现价</th>'
    + `<th class="num sortable${sortedCls('mv')} ht-mv" data-sort="mv" title="持仓市值（折人民币；悬停查看原币种市值）· 点击排序">市值</th>`
    // 列名从「仓位」改为「占资金池」：分母是「同账户同币种持仓合计 + 现金子账户余额」，
    // 不是组合总市值。叫「仓位」会被读成「占我总持仓的比例」，同一张表里还能出现多个 100%，
    // 实测一直有人按总市值去核这个数（分母差一个数量级）。
    + '<th class="num ht-share" title="占该账户同币种资金池比例：持仓市值 ÷（该账户同币种持仓合计 + 现金子账户余额），不是占总持仓的比例；无匹配现金子账户时显示 —">占资金池</th>'
    + (dayIdleAll ? '' : `<th class="num ht-day" title="${pdi.note ? esc(pdi.note) : '今日盈亏（上）/ 今日盈亏率（下，首日按买入成本计）'}">${pdi.label}${dayBadge(pdi)}</th>`)
    + `<th class="num sortable${sortedCls('profit')} ht-pnl" data-sort="profit" title="持有期总盈亏（上）/ 收益率（下）· 点击排序">盈亏</th>`
    + '<th class="ht-act">操作</th>'
    + '</tr></thead>';
  let body = '';
  for (const g of arr) {
    // 组头的「今日」与行内同口径：开盘前 / 真 0 都降级成「—」，不给 0 值数字重量
    const gDayIdle = pdi.preOpen || amtIsZero(g.dayPnl);
    const collapsed = holdCollapsed.has(String(g.sid));
    body += `<tbody class="hold-grp${collapsed ? ' is-collapsed' : ''}" data-sid="${g.sid}">`
      + `<tr class="h-grp" role="button" tabindex="0" title="${collapsed ? '展开' : '收起'}该账户明细">`
      + `<td colspan="${colCount}"><div class="hg-in">`
      + `<span class="hg-l"><i class="hg-chev">▾</i>${srcLogo(g.sid)}<b class="hg-name">${esc(g.name)}</b><em class="hg-count">${g.items.length} 只</em></span>`
      + `<span class="hg-r">`
      + `<span class="hg-stat hg-stat-mv" title="该账户持仓折合人民币市值"><i>市值</i><b${wanTitle(g.mv, '¥')}>¥${fmtWan(g.mv)}</b></span>`
      // 今日列整列不渲染时，组头也不再单挂一个「今日 —」——那是同一件事说第三遍
      + (dayIdleAll ? '' : `<span class="hg-stat hg-stat-day" title="${pdi.note ? esc(pdi.note) : '该账户今日盈亏合计'}"><i>${pdi.label}</i><b class="${gDayIdle ? '' : clsPnl(g.dayPnl)}">${gDayIdle ? '—' : signedMoneyW(g.dayPnl, 'cny')}</b></span>`)
      + `<span class="hg-stat" title="该账户累计盈亏合计"><i>总盈亏</i><b class="${clsPnl(g.pnl)}"${wanTitle(g.pnl, '¥')}>${signedMoneyW(g.pnl, 'cny')}</b></span>`
      + `</span></div></td></tr>`
      + g.items.map((h) => renderHoldRow(h, poolOf(h), pdi, dayIdleAll)).join('')
      + '</tbody>';
  }
  box.innerHTML = `<div class="holdings-sheet"><div class="subtable-wrap"><table class="asset-table holdings-table">${thead}${body}</table></div></div>`;
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
  // 组头行折叠：状态存 holdCollapsed，排序 / 刷新行情后重渲染仍保持收起
  bindGroupCollapse(box, holdCollapsed);
  // 行内事件：整表绑定一次（原先是逐分组遍历）
  box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); editHolding(b.dataset.edit); });
  box.querySelectorAll('[data-del]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); delHolding(b.dataset.del); });
  box.querySelectorAll('[data-adjust]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openAdjust(b.dataset.adjust); });
  box.querySelectorAll('[data-hist]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openHoldingHistory(b.dataset.hist); });
  box.querySelectorAll('[data-fail]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); toast(failedSymbols[b.dataset.fail] || '刷新失败', 'err'); });
  box.querySelectorAll('[data-ana]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openAnalysis(b.dataset.ana); });
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
// 持仓行模板（v3.8 单表）：名称格吃两行 —— 主行「徽标 + 名称 + 修改/分析」，
// 副行是原先单独占三列的「代码 · 成本价 · 持仓天数」。
// 数值格统一「主值 + 比率副行」：现价/涨跌幅、今日/今日率、盈亏/收益率。
// 全表同一个节奏，不再出现「有的列两行数字、有的列一行」的参差感。
function renderHoldRow(h, pool, pdi, hideDay) {
  const isFail = !!failedSymbols[h.symbol];
  const mvCny = toRmb(h, h.market_value);
  const dayCny = toRmb(h, h.day_pnl);
  const pnlCny = toRmb(h, h.pnl);
  // 已清仓：份额为 0（卖出后 holdings 保留记录）。行整体置灰，
  // 与理财表格的 wealth-archived 视觉口径一致；操作列仍可点（编辑/历史/删除）。
  const closed = (h.quantity || 0) <= 0;
  // 仓位：同(来源,币种)资金池占比
  const posPct = pool > 0 ? (Number(h.market_value) || 0) / pool * 100 : 0;
  // 今日涨跌幅：现价 vs 昨收（行情口径，红涨绿跌）。prev_close 取不到行情时显示 —。
  const chgPct = (h.prev_close > 0 && h.current_price > 0)
    ? (h.current_price - h.prev_close) / h.prev_close * 100 : null;
  const rowCls = [isFail ? 'row-failed' : '', closed ? 'holding-archived' : ''].filter(Boolean).join(' ');
  // 今日盈亏：开盘前恒为 0（还没开始，不是没赚没亏），真 0 也不该占一格颜色 → 都降级成「—」
  const dayIdle = pdi.preOpen || amtIsZero(dayCny);
  // 不再挂「已清仓」文字徽标（视觉噪音），改为整行置灰 + 名称 title 里说明清仓状态
  const nameTitle = closed ? esc(h.name) + '（已清仓：份额为 0，历史盈亏见「历史走势」，重新买入后自动恢复）' : esc(h.name);
  // 元信息行：代码 · 成本价 · 持仓天数（原本各占一列）
  const meta = [];
  if (h.symbol) meta.push(`<span class="hm-code">${esc(h.symbol)}</span>`);
  meta.push(`成本 ${fmtPrice(h.cost_price, isFund(h) ? 'fund' : 'stock')}`);
  if (h.holding_days > 0) meta.push(`${h.holding_days} 天`);
  return `<tr${rowCls ? ` class="${rowCls}"` : ''}>
    <td class="h-name">
      <div class="hn-top">
        ${isFail ? '<span class="fail-badge" data-fail="' + esc(h.symbol) + '" title="点击查看失败原因">' + actIcon('warn') + '</span>' : ''}
        ${holdTypeTag(h)}<span class="hn-name" title="${nameTitle}">${esc(h.name)}</span>
        <span class="hn-acts">
          ${actBtn('adjust', `data-adjust="${h.id}"`, '修改')}
          ${supportsAnalysis(h) ? actBtn('analysis', 'data-ana="' + h.id + '"', '技术分析') : ''}
        </span>
      </div>
      <div class="hn-meta">
        <span class="hn-meta-t">${meta.join(' · ')}</span>
        <!-- 手机端：表头与「操作」列都收起，改用元信息行右侧这三枚图标（.hn-acts-m 桌面隐藏）。
             放在元信息行而不是名称行 —— 名称行让出 116px 后只剩 8 个字可读。 -->
        <span class="hn-acts-m">
          ${actBtn('adjust', `data-adjust="${h.id}"`, '修改')}
          ${actBtn('edit', `data-edit="${h.id}"`, '编辑持仓')}
          ${actBtn('del', `data-del="${h.id}"`, '删除持仓', { danger: true })}
        </span>
      </div>
    </td>
    <td class="num ht-trend h-trend">${sparkCell(h.symbol, h.pnl)}</td>
    <td class="num ht-price">
      <div class="hp-main">${fmtPrice(h.current_price, isFund(h) ? 'fund' : 'stock')}</div>
      <div class="hp-sub ${chgPct != null ? clsPnl(chgPct) : ''}" title="${pdi.isToday ? '今日涨跌幅' : '最近一个收盘交易日的涨跌幅（可能比今日盈亏新一个美股交易日——美股在北京时间凌晨收盘，跨过了日界）'}：现价 vs 昨收${isFund(h) ? '，基金为昨日净值' : ''}">${chgPct != null ? pct(chgPct) : '—'}</div>
    </td>
    <td class="num ht-mv"${mvOrigTitle(h)}>¥${fmtWan(mvCny)}</td>
    <td class="num share ht-share${pool > 0 ? '' : ' is-empty'}"${pool > 0 ? ` style="--p:${posPct.toFixed(1)}%;--pn:${(posPct / 100).toFixed(4)}"` : ''} title="占该账户同币种资金池比例${pool > 0 ? ' ' + posPct.toFixed(2) + '%' : '；该账户无匹配现金子账户，无法算占比'}">${pool > 0 ? posPct.toFixed(2) + '%' : '—'}</td>
    ${hideDay ? '' : `<td class="num ht-day" title="${pdi.note ? esc(pdi.note) : '今日盈亏'}${h.market === '美股' && pdi.isToday ? '（美股按美东交易日归属：今天的收盘要等北京时间明天凌晨，落账后会出现在对应日期那一格，所以今天这一格暂时是 0）' : ''}${h.day_pnl_pct ? ' ' + pct(h.day_pnl_pct) : ''}（首日按买入成本计）">${dayIdle ? ZERO_DASH : `<div class="${clsPnl(h.day_pnl)}"${wanTitle(dayCny, '¥')}>${signedMoneyW(dayCny, 'cny')}</div><div class="hp-sub ${clsPnl(h.day_pnl_pct)}">${h.day_pnl_pct ? pct(h.day_pnl_pct) : ''}</div>`}</td>`}
    <td class="num ht-pnl">
      <div class="${clsPnl(h.pnl)}"${wanTitle(pnlCny, '¥')}>${signedMoneyW(pnlCny, 'cny')}</div>
      ${h.pnl_pct ? `<div class="hp-sub ${clsPnl(h.pnl)}">${pct(h.pnl_pct)}</div>` : ''}
    </td>
    <td class="row-act-cell ht-act"><span class="ht-acts">
      ${actBtn('edit', `data-edit="${h.id}"`, '编辑持仓')}
      ${actBtn('hist', `data-hist="${h.id}"`, '历史盈亏')}
      ${actBtn('del', `data-del="${h.id}"`, '删除持仓', { danger: true })}
    </span></td>
  </tr>`;
}

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
  // 始终显示理财段；分母同步含理财。
  const showWealthSeg = true;
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
  // 方案 3：市值与成本同口径（都走 fmtMoney，≥1万压缩成「x.xx万」+ 悬停还原精确元值），
  // 此前市值用 fmt（¥147,512.51）而成本也用 fmt 但值恰好一位小数（¥150,723.7），同屏小数位不一致。
  const invMv = document.getElementById('investMv');
  if (invMv) {
    invMv.textContent = '¥' + fmtMoney(totalCNY);
    invMv.title = '¥' + fmtYuanExact(totalCNY);
  }
  // 锚点卡副标：只数 + 成本（不重复卡片 4 的收益率）
  const invMvSub = document.getElementById('investMvSub');
  if (invMvSub) {
    invMvSub.innerHTML = `持仓 <span class="hl">${hs.length}</span> 只 · 成本 <span class="hl" title="¥${fmtYuanExact(totalCostCNY)}">¥${fmtMoney(totalCostCNY)}</span>`;
  }
  // 今日盈亏口径与首页「今日」一致：持仓今日盈亏 + 今日已实现（清仓/减仓）盈亏，均折 CNY
  const invDay = document.getElementById('investDayPnl');
  if (invDay) {
    // 非交易日（周末/法定节假日）这笔数其实是最近一个交易日的涨跌，抬头跟着归属日改，
    // 否则周日打开看到「今日盈亏 −9,865」会以为今天在亏。
    const di = pnlDayInfo(pnlDateStr);
    // 0 值不配 28px 主数字（2026-11-02）：开盘前（05:00–09:35）所有持仓的今日盈亏恒为 0，
    // 摆一个「¥0.00」在主视觉位会被读成没加载出来。降级成「—」+ 状态徽章，
    // 副标说明「09:30 开盘后更新」，信息量为零的 0 不再占据锚点级的视觉重量。
    const dayIdle = di.preOpen || amtIsZero(dayPnlCNY);
    // 徽章挂数值右侧而不是抬头：它标的是「这个数不新鲜」，不是「日期」，
    // 所以应当跟着数字走。抬头写 10-30 盈亏已经交代了是哪天，徽章再贴上去就是两个小 pill 挨着。
    invDay.innerHTML = (dayIdle ? ZERO_DASH : signedCur(dayPnlCNY, 'cny')) + dayBadge(di);
    invDay.className = 'kpi-value ' + (dayIdle ? '' : dpCls);
    const dayLbl = document.getElementById('investDayLabel');
    if (dayLbl) {
      dayLbl.textContent = di.isToday ? '今日盈亏' : di.md + ' 盈亏';
      dayLbl.title = di.note || '现价相对昨收的变动 + 当日已实现盈亏';
    }
    const sub = document.getElementById('investDayPct');
    // 方案 5：标注分母（持仓市值），否则与首页「今日 +0.04%（/净资产）」并排看像算错。
    if (sub) {
      if (dayIdle) {
        sub.textContent = di.preOpen ? '09:30 开盘后更新' : (di.isToday ? '今日暂无变动' : '无新数据');
        sub.className = 'kpi-sub';
        sub.title = di.note || '今日盈亏为 0';
      } else {
        sub.innerHTML = pct(dayPnlCNY / Math.max(totalCNY - dayPnlCNY, 1) * 100) + '<span class="sub-of">/持仓市值</span>';
        sub.className = 'kpi-sub ' + dpCls;
        sub.title = (di.note ? di.note + ' · ' : '') + '分母 = 期初持仓市值';
      }
    }
  }
  // 本月是否已开市：归属日不在本月 → 本月一个交易日都还没有（月初撞上周末/长假）
  const monthStarted = !pnlDateStr || pnlDateStr.slice(0, 7) === ymd(new Date()).slice(0, 7);
  const invMonth = document.getElementById('investMonthPnl');
  if (invMonth) {
    // 同「今日」：本月累计为 0 时不摆 ¥0.00，尤其在月初/开盘前它必然是 0
    const monthIdle = amtIsZero(monthPnlCNY);
    if (monthIdle) invMonth.innerHTML = ZERO_DASH;
    else invMonth.textContent = signedCur(monthPnlCNY, 'cny');
    invMonth.className = 'kpi-value ' + (monthIdle ? '' : mpCls);
    const sub = document.getElementById('investMonthPct');
    if (sub) {
      if (!monthStarted) {
        // 硬显示 0.00% 会被当成没加载出来，直接说清原因
        sub.textContent = (new Date().getMonth() + 1) + ' 月暂无交易日';
        sub.className = 'kpi-sub';
        sub.title = '本月还没开市，累计盈亏从本月第一个交易日开始计';
      } else if (monthIdle) {
        sub.textContent = '本月暂无盈亏';
        sub.className = 'kpi-sub';
        sub.title = '本月累计盈亏为 0（已开盘的交易日都还没有盈亏落账）';
      } else {
        sub.innerHTML = pct(monthPnlCNY / Math.max(totalCNY - monthPnlCNY, 1) * 100) + '<span class="sub-of">/持仓市值</span>';
        sub.className = 'kpi-sub ' + mpCls;
        sub.title = '分母 = 期初持仓市值';
      }
    }
  }
  const invPct = document.getElementById('investPct');
  if (invPct) {
    invPct.textContent = pct(totalPct);
    invPct.className = 'kpi-value ' + pCls;
  }
  // 权益曲线由首页卡片渲染（renderHomeDashboard 内 renderRateSpark）。
}

// 首页「权益收益曲线」：固定近 30 日累计权益盈亏（数据复用盈亏日历 /api/pnl/history，
// calData 已加载时不再重复请求）。X 轴按日、Y 轴为累计权益盈亏，不再支持区间/口径切换。
// v3.7：增加累计投入 dashed 参考线（后端 contrib_cny 推算），让用户直观看到"净值 vs 投入"的差距。
async function renderRateSpark(rangeDays, netVal) {
  
  
  const rDays = 30;  // 首页权益曲线固定近 30 日累计
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
      // 日期数组必须同步截断：homeRateHoverData.dates 与 cumPnl/dayPnl 按同一下标对齐，
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

      const series = cumPnl;  // 固定累计口径（硬编码 cum，不做 avg/day）
      // 真正画出来的那条：不做日均平滑，直接画累计
      const shown = series;

      // Y 轴：0 恒在轴内（盈亏分界线，正负一眼可辨）；再保一个最小跨度，
      // 免得几十块的抖动被拉成满屏暴跌。
      let axMin = Math.min(0, ...shown), axMax = Math.max(0, ...shown);
      if (axMax - axMin < 1e-9) { axMax += 1; axMin -= 1; }
      const axMid = (axMin + axMax) / 2;
      const minSpan = Math.max(120, Math.abs(base) * 0.004);
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
      const fmtAxisAmt = (v) => {
        const a = Math.abs(v);
        const sign = v < -0.5 ? '-' : (v > 0.5 ? '+' : '');
        const s = a >= 10000 ? (a / 10000).toFixed(1) + '万' : Math.round(a).toLocaleString('zh-CN');
        return sign + s;
      };
      const axSpan = axMax - axMin;
      const yTicks = [0, 1, 2, 3].map((k) => {
        const v = axMax - axSpan * k / 3;
        return { v, label: fmtAxisAmt(v) };
      });
      const dd = sortedDates.filter(Boolean);
      const mmdd = (s) => (s ? s.slice(5) : '');
      const xLabels = dd.length >= 3
        ? [mmdd(dd[0]), mmdd(dd[Math.floor((dd.length - 1) / 2)]), mmdd(dd[dd.length - 1])]
        : dd.map(mmdd);
      heroBox.innerHTML = sparkline(shown, {
        w: svgW, h: svgH, stroke: strokeColor, fill: strokeColor, axis, zero: true, smooth: true,
        axes: true, gutLeft: 36, gutBottom: 14, yTicks, xLabels,
      });

      // 趋势文案：区间累计盈亏折算为收益率（基准 = 起始权益本金）。
      // 与主序列口径解耦 —— 切到「日均/单日」时这里仍是区间累计收益率，卡片头部语义不变。
      if (heroTrend) {
        const pctV = rangePnl / base * 100;
        heroTrend.textContent = (pctV > 0 ? '+' : '') + pctV.toFixed(2) + '%';
        heroTrend.className = `hero-mini-trend ${trendCls}`;
      }

      // hover 弹框所需序列：日期 / 单日盈亏 / 累计盈亏 / 实际画的那条(shown) / 成本 / 期初本金。
      // 固定 cum 口径（硬编码，不再切换），所以弹框里 mode 固定 cum、maWin 固定 1。
      homeRateHoverData = { dates: dd, cumPnl, dayPnl, series: shown, mode: 'cum', maWin: 1, gutLeft: 36, gutBottom: 14, n: shown.length, contrib, base };
      bindHomeRateHover();
    } else if (heroBox) {
      heroBox.innerHTML = '<span class="hero-spark-empty">—</span>';
    }
  } catch (e) { /* 走势失败不影响卡片主信息 */ }
}

// 首页权益曲线 hover 弹框：鼠标在曲线上移动时定位到最近数据点，显示日期 + 持仓成本
// + 单日盈亏 + 本期累计盈亏 + 盈亏率，并画一条竖向参考线。
// 曲线画的是盈亏金额（day/cum 两口径），而成本只在弹框里出现 —— 弹框不影响 Y 轴，
// 所以「¥9.7万的本金」不会再把曲线压平；参考点的 y 按 homeRateHoverData.mode 取同一条序列。
function bindHomeRateHover() {
  const box = document.getElementById('homeRateSpark');
  const wrap = box ? box.closest('.nw-spark') : null;
  if (!box || !wrap) return;
  let tip = document.getElementById('homeRateTip');
  let guide = document.getElementById('homeRateGuide');
  if (!tip) { tip = document.createElement('div'); tip.id = 'homeRateTip'; tip.className = 'rate-tip'; tip.hidden = true; document.body.appendChild(tip); }
  if (!guide) { guide = document.createElement('div'); guide.id = 'homeRateGuide'; guide.className = 'rate-tip-guide'; guide.hidden = true; box.appendChild(guide); }
  box.onmousemove = (e) => {
    const st = homeRateHoverData;
    if (!st || st.n < 2) return;
    const r = box.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (w <= 0 || h <= 0) return;
    const xPad = Math.max(1.5, h * 0.08);
    const gutLeft = st.gutLeft || 0, gutBottom = st.gutBottom || 0;
    const plotL = xPad + gutLeft, plotR = w - xPad;
    const x = e.clientX - r.left;
    let i = Math.round((x - plotL) / (plotR - plotL) * (st.n - 1));
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
    const padY = Math.max(1.5, h * 0.12), innerH = h - padY * 2 - gutBottom;
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

// 首页权益曲线口径切换（日均 / 单日 / 累计）：只换主序列，不重新请求接口

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
  const padY = Math.max(1.5, h * 0.12);
  // v3.6: 两端 padding 和圆点半径都按 h 等比缩放，避免小容器里圆点太小/大容器里圆点太大
  const xPad = Math.max(1.5, h * 0.08);
  // 坐标轴留白：左侧给 Y 轴刻度文字、底部给 X 轴日期文字；不传时=0，不影响表格迷你图
  const gutLeft = (opts && opts.gutLeft) || 0;
  const gutBottom = (opts && opts.gutBottom) || 0;
  const plotL = xPad + gutLeft;
  const plotR = w - xPad;
  const plotT = padY;
  const plotB = h - padY - gutBottom;
  const innerH = plotB - plotT;
  const dotR = Math.max(1.2, Math.min(3.5, h * 0.06));
  const xAt = i => plotL + ((plotR - plotL) * i) / (vals.length - 1);
  const yAt = v => plotT + innerH - (innerH * (v - min)) / (max - min);
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
  const baseY = zeroIn ? yAt(0) : (gutBottom > 0 ? plotB : h);
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
  // 坐标轴（仅 axes:true）：横向淡网格 + 左侧 Y 轴金额刻度 + 底部 X 轴日期刻度。
  // 网格先画（垫在面积之下），刻度文字最后画（都落在绘图区外的留白里，不压曲线）。
  let gridEl = '', axisText = '';
  if (opts && opts.axes) {
    const tickColor = resolveColor('var(--text-muted)');
    const gridColor = resolveColor('var(--border)');
    const g = [];
    const t = [];
    for (const yt of (opts.yTicks || [])) {
      const yy = yAt(yt.v);
      g.push(`<line x1="${plotL.toFixed(2)}" y1="${yy.toFixed(2)}" x2="${plotR.toFixed(2)}" y2="${yy.toFixed(2)}" stroke="${gridColor}" stroke-width="1" stroke-dasharray="2,4" vector-effect="non-scaling-stroke"/>`);
      t.push(`<text x="${(plotL - 6).toFixed(2)}" y="${(yy + 3).toFixed(2)}" text-anchor="end" font-size="10" fill="${tickColor}">${esc(yt.label)}</text>`);
    }
    const xl = opts.xLabels || [];
    xl.forEach((lb, idx) => {
      const n = xl.length;
      let anchor = 'middle', xx = plotL + (plotR - plotL) * (n <= 1 ? 0 : idx / (n - 1));
      if (idx === 0) { anchor = 'start'; xx = plotL; }
      else if (idx === n - 1) { anchor = 'end'; xx = plotR; }
      t.push(`<text x="${xx.toFixed(2)}" y="${(h - 3).toFixed(2)}" text-anchor="${anchor}" font-size="10" fill="${tickColor}">${esc(lb)}</text>`);
    });
    gridEl = g.join('');
    axisText = t.join('');
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="${par}"${dimAttrs} class="u-block u-va-mid" role="img" aria-hidden="true">${gridEl}${area}${zeroEl}${lineEl}<circle cx="${last.split(',')[0]}" cy="${last.split(',')[1]}" r="${dotR.toFixed(1)}" fill="${strokeColor}"/>${axisText}</svg>`;
}

// 表格迷你走势单元格：线条为近30日收盘价走势，颜色按首尾收盘价对比（尾>首=涨红，否则=跌绿，
// 中国惯例涨红跌绿），无数据时显示占位符。
function sparkCell(sym, pnl) {
  const arr = (sparkCache[sym] || []).slice(-20);
  if (!arr || arr.length < 2) return '<span class="spark-empty">—</span>';
  const dir = clsPnl(arr[arr.length - 1] - arr[0]);
  const color = dir === 'down' ? 'var(--down)' : dir === 'up' ? 'var(--up)' : 'var(--text-muted)';
  return sparkline(arr, { w: 136, h: 26, stroke: color, fill: color, responsive: true });
}

// 行情由定时快照（refreshAllQuotes）自动更新。

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
  // 换了标的就换类别：新增持仓时费率阶梯要跟着出现/消失（股票没有赎回费）
  riskIsFund = selCat === 'fund';
  applyRiskFeeUI();
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
  // 止盈止损方案：编辑态异步拉取（要 basis/eval），新增态给默认「不启用」
  loadRiskForm(h);
}

// 关联基金代码行：基金判定已统一由 linked_symbol 决定，此处恒显示该行（用户可随时补录关联代码）
function toggleLinkedSymbol() {
  const row = $('#linked_symbol_row');
  if (row) row.style.display = '';
}

async function editHolding(id) {
  try {
    const r = await api('/api/holdings');
    if (!r.ok) { toast(humanizeErr(r, null, '加载持仓失败'), 'err'); return; }
    const d = await r.json();
    const h = (d.holdings || []).find((x) => x.id == id);
    if (!h) { toast('未找到该持仓', 'err'); return; }
    openModal(h);
  } catch (e) {
    toast(humanizeErr(null, e, '保存失败'));
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
    box.innerHTML = `红利再投：分红总额 <b>${fmt(total)}</b>｜按净值 ${fmtPrice(nav, isFund(h) ? 'fund' : 'stock')} 买入 <b>${fmt(newShares)}</b> 份` +
      `<br>新份额 <b>${fmt(newQty)}</b>｜新成本价 <b>${fmtPrice(newCost, isFund(h) ? 'fund' : 'stock')}</b>（份额增加、不出现金）`;
    return;
  }
  const newCost = h.cost_price - per;
  if (newCost < 0) { box.style.display = 'block'; box.innerHTML = '<span class="warn">折算每股分红超过当前成本价，成本价不能为负</span>'; return; }
  const cut = h.cost_price > 0 ? ((per / h.cost_price) * 100).toFixed(2) : '0';
  let html = `分红总额 <b>${fmt(total)}</b>｜折算每股 <b>${fmtPrice(per, isFund(h) ? 'fund' : 'stock')}</b>｜新成本价 <b>${fmtPrice(newCost, isFund(h) ? 'fund' : 'stock')}</b>` +
    `（原 ${fmtPrice(h.cost_price, isFund(h) ? 'fund' : 'stock')}，降低 ${cut}%）｜份额不变 ${fmt(h.quantity)}`;
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
    if (!r.ok) { $('#divErr').textContent = d.error || (humanizeErr(r)); return; }
    const hh = d.holding;
    if (method === 'reinvest') {
      toast(`红利再投成功：${hh.name} 新增份额（分红总额 ${fmt(d.dividend_total || 0)}）｜新成本价 ${fmtPrice(hh.cost_price, isFund(hh) ? 'fund' : 'stock')}`, 'ok');
    } else {
      const feeTxt = d.fee > 0 ? `｜费用 -${fmt(d.fee)}｜净入账 ${fmt(d.net_cash || 0)}` : '';
      toast(`分红成功：${hh.name} 入账 ${fmt(d.dividend_total || 0)}${feeTxt}｜成本价 ${fmtPrice(hh.cost_price, isFund(hh) ? 'fund' : 'stock')}`, 'ok');
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
    title: '回退这笔交易',
    msg: '还原份额、成本价与资金账户余额；减仓将撤销已实现盈亏台账。仅最新一笔可回退。',
    okText: '回退这笔交易', danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/holdings/' + id + '/transactions/' + txID + '/revert', { method: 'POST' });
        if (!r.ok) { let m = '回退失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
        toast('已回退该笔交易', 'ok');
        await loadAsset();
        // 回退会改变份额/成本与已实现盈亏 → 曲线与交易记录都要重拉（保留当前分段）
        if (histHistId === Number(id)) await reloadHistData();
      } catch (err) { toast(humanizeErr(null, err)); }
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
  $('#confirmMsg').textContent = '删除该持仓（同时删除相关交易、分红等记录）。';
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
    ? '导出完整迁移数据（持仓/理财/现金/负债/收支计划/来源账户/AI配置/应用设置/净值历史）到 JSON 文件。'
    : '导出全部资产数据（持仓/理财/现金/负债）到 JSON 文件。';
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
    try { await cb(); } catch (e) { toast(humanizeErr(null, e)); }
    return;
  }
  if (pendingApplyAdd) {
    pendingApplyAdd = false;
    $('#confirmModal').hidden = true;
    const a = lastAdd;
    const id = $('#adj_id').value;
    try {
      const r = await api('/api/holdings/' + id + '/adjust', { method: 'POST', body: JSON.stringify({ type: a.side || 'buy', quantity: a.q1, price: a.p1, fee: a.fee, cash_account_id: Number($('#add_cash_id').value) || 0, note: '调仓计入', date: normDateInput($('#add_date')) }) });
      if (!r.ok) { let m = '计入失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(humanizeErr(r, null, m), 'err'); return; }
      toast('已计入持仓（作为一笔' + (a.side === 'sell' ? '卖出' : '买入') + '交易）', 'ok');
      $('#adjustModal').hidden = true;
      await load();
    } catch (e) { toast(humanizeErr(null, e, '保存失败')); }
    resetConfirm();
    return;
  }
  if (pendingImport) {
    const data = pendingImport;
    pendingImport = null;
    $('#confirmModal').hidden = true;
    try {
      const r = await api('/api/import', { method: 'POST', body: JSON.stringify(data) });
      if (!r.ok) { let m = '导入失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(humanizeErr(r, null, m), 'err'); return; }
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
    } catch (e) { toast(humanizeErr(null, e, '导入失败')); }
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
      if (!r.ok) { let m = '清空失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(humanizeErr(r, null, m), 'err'); return; }
      toast('账本数据已清空', 'ok');
      await load();
      await loadAsset();
      await loadAISettings();
      await refreshUsers();
    } catch (e) { toast(humanizeErr(null, e, '清空失败')); }
    return;
  }
  if (pendingAssetDel) {
    const { type, id } = pendingAssetDel;
    $('#confirmModal').hidden = true;
    pendingAssetDel = null;
    const paths = { source: '/api/asset/sources/', wealth: '/api/asset/wealth/', cash: '/api/asset/cash/', liability: '/api/asset/liabilities/', cashflow: '/api/cashflow/plans/' };
    try {
      const r = await api(paths[type] + id, { method: 'DELETE' });
      if (!r.ok) { let m = '删除失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(humanizeErr(r, null, m), 'err'); return; }
    } catch (e) { toast(humanizeErr(null, e, '删除失败')); return; }
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
      if (!r.ok) { let m = '删除失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(humanizeErr(r, null, m), 'err'); return; }
      toast('已删除该日快照（可在本表撤销）', 'ok');
      // 撤销已并入「每日盈亏」单表：原地刷新合并视图（保留当前范围），再同步账户总资产
      await reloadWealthHist();
      await loadAsset();
    } catch (e) { toast(humanizeErr(null, e, '删除失败')); }
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
      toast(humanizeErr(r, null, '删除失败'), 'err');
      return;
    }
  } catch (e) {
    toast(humanizeErr(null, e, '删除失败'));
    return;
  }
  toast('已删除', 'ok');
  load();
};

// 「添加」按钮：先弹类型选择（持仓 / 理财），再打开对应弹框。
// 默认高亮跟随顶部类别胶囊 —— 胶囊停在「理财」时默认选理财，否则默认选持仓。
// 添加持仓 / 理财快照 / 记收入 / 记支出：入口保留在首页「快捷功能」卡片（见 renderHomeDashboard）。
// 定投计划 / 补录平仓已按场景归位到投资页 tab 行右端（2026-11-02，见 renderInvestToolbar）。
// 投资页原右侧按钮已按需求移除，对应入口改为：盈亏日历 / AI 助手在右上角操作区（act-group）。
$('#dcaPlansClose').onclick = () => { $('#dcaPlansModal').hidden = true; };
$('#dcaPlansNew').onclick = () => { $('#dcaPlansModal').hidden = true; openDCAModal(null); };
// 右上角操作区按钮：AI 助手（盈亏日历 2026-10-28 提为顶栏图标按钮 #pnlCalTopBtn；2026-11-01 起全宽度常驻，
// 同时删掉了个人菜单里的 pnl-cal 重复入口 —— 缩窄窗口后按钮消失、只能从下拉进，入口不统一）
const _aiTop = document.getElementById('aiChatTopBtn');
if (_aiTop) _aiTop.onclick = () => aiChatToggle();
// 盈亏日历与 AI 同款绑定（原先靠 HTML 内联 onclick，顶栏按钮化后改为统一在这里挂）
const _pnlCalTop = document.getElementById('pnlCalTopBtn');
if (_pnlCalTop) _pnlCalTop.onclick = () => openPnlModal();
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
// 行情由定时快照自动更新；批量 /api/refresh 接口仍保留供定时任务复用。

// 投资页主区切换（持仓 / 理财）：localStorage 记忆，默认持仓；下划线样式（无滑动白块）
function syncViewToggle() {
  document.querySelectorAll('#viewToggle .sub-tab').forEach((x) => x.classList.toggle('active', x.dataset.view === homeSection));
}
// 四块 KPI 只切显隐（DOM 常驻、等高，切换不位移）。抽成函数是因为它必须有两个调用点：
// renderFiltered（切 tab / 刷新数据）和 showHoldingsView（从别的页面回来）。
// 2026-11-02 修：只在高亮上记住了 homeSection，KPI 却停在 HTML 里默认的「持仓」——
// 顶部导航切走再回来，就出现「tab 是理财、卡片是持仓」的半状态。
function applyInvestSection() {
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
}
// 通用：根据指定切换器内当前 active 按钮定位滑动白块（资产/日历切换器共用）
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
    // 切 持仓/理财/存款/平仓 属显式视图切换：强制给新显形的区块播入场
    //（renderFiltered 里的常规调用不带 force，后台刷新不会重播动画）
    playInvestRise(true);
  };
});
syncViewToggle();
$('#emptyAddBtn').onclick = () => openModal(null);

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
    // 止盈止损方案随持仓一起保存（后端 Update 会原样存 risk_plan）；
    // 单独开一个保存通道会让"改了参数忘了点第二个保存"变成新的坑。
    risk_plan: JSON.stringify(riskCollectPlan()),
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
      if (!r.ok) { toast(humanizeErr(r, null, '资产总览加载失败'), 'err'); return; }
      d = await r.json();
    } catch (e) {
      toast(humanizeErr(null, e, '加载失败')); return;
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
// 右上角 ✕ 与点击遮罩均可关闭
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
  } catch (e) { $('#crErr').textContent = humanizeErr(null, e); }
  $('#crSave').disabled = false;
});
// —— 批量新增已平仓（纯记录，不入账）——
// 账户 + 类型 为全局（作用于本批所有行）；下方逐行填 名称 / 代码（名称联想）/ 盈亏金额 / 盈亏率%(可选) / 天数(可选)。
// 本金不在批量录入里填（数据库该字段保留，可留空）；填了盈亏率则直接入库，表格按填的值展示。
function manRateOrNull(el) {
  const s2 = String(el && el.value == null ? '' : el.value).trim();
  if (s2 === '') return null;
  const n = Number(s2);
  return Number.isFinite(n) ? n : null;
}
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
  let html = '<div class="batch-row head"><span>名称</span><span>代码</span><span>盈亏金额</span><span>盈亏率%</span><span>天数</span><span></span></div>';
  for (let i = 0; i < n; i++) {
    html += `<div class="batch-row" data-idx="${i}">
      <div class="crb-name-wrap">
        <input class="crb-name" placeholder="名称 / 代码" autocomplete="off">
        <div class="crb-suggest f-suggest" hidden></div>
      </div>
      <input class="crb-code" placeholder="代码" autocomplete="off">
      <input class="crb-amount" type="number" step="0.01" placeholder="正赚负亏" autocomplete="off">
      <input class="crb-rate" type="number" step="0.01" placeholder="选填" autocomplete="off">
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
    + '<input class="crb-rate" type="number" step="0.01" placeholder="选填" autocomplete="off">'
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
      return_rate: manRateOrNull(row.querySelector('.crb-rate')),
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
  } catch (e) { $('#crbErr').textContent = humanizeErr(null, e); }
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

// 当日盈亏的归属日：交易日就是今天；周末/法定节假日是最近一个交易日（后端 pnl_date 给）。
// 非交易日那笔「今日盈亏」其实不是今天赚的 —— 基金 21:00 后拿到的是上一交易日净值，
// 美股收盘后「现价−昨收」也是上一交易日，A 股/港股则休市没新价。仍标「今日」会让人
// 以为休市还在赚钱，所以标签跟着归属日走（本章 chips 与投资页 KPI 共用）。
function pnlDayInfo(dateStr) {
  const now = new Date();
  const today = ymd(now);
  const d = dateStr || today;
  const isToday = d === today;
  // 「待开盘」空窗（2026-11-02）：pnl_date 等于今天 ⇒ 今天必然是交易日
  // （非交易日后端会回落到上一个交易日）。北京 05:00（美股收盘）→ 09:35 之间
  // 全市场没有新价，所有持仓的今日盈亏恒为 0 —— 那不是「今天没赚没亏」，
  // 是「还没开始」。硬显示 ¥0.00 会被读成数据没刷新出来。
  const mins = now.getHours() * 60 + now.getMinutes();
  const preOpen = isToday && mins >= 300 && mins < 575;
  return {
    date: d,
    md: d.slice(5),
    isToday,
    preOpen,
    // chip 抬头：交易日「今日」，非交易日直接写日期（「10-30」），旁边就是金额不会误读
    label: isToday ? '今日' : d.slice(5),
    note: preOpen
      ? '尚未开盘：A股/港股 09:30 开盘，基金净值当晚更新，今日盈亏暂时为 0'
      : (isToday ? '' : `今日休市（非交易日），显示最近交易日 ${d.slice(5)} 的涨跌`),
  };
}
// 行情状态徽章：待开盘 / 休市。交易日盘中返回空串，调用方直接拼在数字后面。
// 为什么不做整页横幅 —— 横幅占首屏、滚出视口就失效，还得跟下方日期标签重复说一遍；
// 徽章就地钉在数字旁边，读到哪个数就看到哪个数的状态，且完全不吃布局空间。
function dayBadge(di) {
  if (!di) return '';
  if (di.preOpen) return '<i class="mkt-badge is-pre" title="尚未开盘：A股/港股 09:30 开盘，基金净值当晚更新">待开盘</i>';
  if (!di.isToday) return '<i class="mkt-badge is-closed" title="今日休市，该数值为最近一次收盘">休市</i>';
  return '';
}
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

// 盈亏日历弹框
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
  $('#aiView').hidden = true;
  $('#devicesView').hidden = true;
  $('#notifyView').hidden = true;
  $('#holdingsView').hidden = false;
  syncViewToggle();      // 回到主页时同步滑块选中态与白块位置
  applyInvestSection();  // 并按记住的 homeSection 恢复对应的 KPI 区块（否则停在 HTML 默认的持仓卡）
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
    // 方案 5：百分比必须标出分母。首页分母 = 净资产，投资页分母 = 持仓市值，
    // 同一个 +¥98.57 在两页是 +0.04% 与 +0.07%，不标出来并排看像数据错乱。
    // 非交易日（周末/法定节假日）这笔实时盈亏是最近一个交易日的涨跌，抬头改写成日期
    // （「10-30」），顶着「今日」会让人以为休市也在赚钱。
    const hdi = pnlDayInfo(ov.pnl_date || pnlDateStr);
    if (dayPnl) segs.push(`<span class="hc-item"><span class="hc-label"${hdi.note ? ` title="${esc(hdi.note)}"` : ''}>${hdi.label}</span><span class="hc-val ${clsPnl(dayPnl)}">${dayPnl > 0 ? '+' : ''}${yuanOfW(dayPnl)}${dayBadge(hdi)}</span></span>`);
    // 两项都是 0 → 什么都不显示会像「没加载出来」。给一条无数字的状态项，
    // 解释「不是没数据，是还没开盘 / 休市」，同时不给 0 值任何视觉重量。
    else segs.push(`<span class="hc-item is-idle" title="${esc(hdi.note || '今日盈亏为 0')}"><span class="hc-label">今日</span><span class="hc-val">${hdi.preOpen ? '待开盘 · 09:30 更新' : (hdi.isToday ? '暂无变动' : '休市 · 无新数据')}</span></span>`);
    if (monthPnl) segs.push(`<span class="hc-item"><span class="hc-label">本月</span><span class="hc-val ${clsPnl(monthPnl)}">${monthPnl > 0 ? '+' : ''}${yuanOfW(monthPnl)}</span></span>`);
    ch.innerHTML = segs.join('');
  }

  // 资产分布 chip：持仓 / 理财 / 现金 / 负债。
  // 负债必须列出（2026-10-27 曾摘掉）：净资产 = 资产 − 负债，只给三个资产项时
  // 用户把 chip 相加（14.74+6.82+8.68=30.24万）对不上净资产（27.79万），差额 2.44万无从解释。
  // 带上负号 chip 后四项相加恰好等于净资产，明细仍以资产页为准。
  const bd = $('#homeAssetBreakdown');
  if (bd) {
    const lTotal = (ov.liability && ov.liability.total) || 0;
    // 方案 12：chip 色一律引用全局分类色 token，与资产页环形图同源。
    // --cat-* 是逗号分隔的 RGB 分量（如 255,149,0），必须包 rgb()/rgba() 才能当颜色用。
    // 负债不走红绿：红=涨、绿=跌，负债既不是涨也不是跌，用警示色 --warning。
    const rows = [
      { label: '持仓', val: eqMV, color: 'rgb(var(--cat-equity))' },
      { label: '理财', val: wTotal, color: 'rgb(var(--cat-wealth))' },
      { label: '现金', val: cTotal, color: 'rgb(var(--cat-cash))' },
      { label: '负债', val: lTotal, color: 'var(--warning)', neg: true },
    ];
    // 资产分布 → 芯片行（原型 hero-asset-chip）：一枚一个口径，金额右对齐读数
    // .nw-chip-t 包住「标签 + 金额」：手机档（≤640）把它改成上下两行的竖排，
    // 这样四个芯片能在 320px 屏上挤进一行（单行文字在 320px 上放不下完整金额）。
    bd.innerHTML = rows.map((r) => {
      const valTxt = (r.neg ? '−' : '') + yuanOfW(r.val);
      return `<span class="nw-chip"><span class="d" style="--dot-c:${r.color}"></span><span class="nw-chip-t">${r.label} <b${r.neg ? ' class="down"' : ''}>${valTxt}</b></span></span>`;
    }).join('');
  }

  // 快捷功能（复用既有入口函数，避免重复实现弹框逻辑）
  const sc = $('#homeShortcuts');
  if (sc) {
    // 2026-11-02 收敛为 4 项（审读报告 P2-2）：只留每天真会点的动作。
    // 「定投计划」迁到投资页 tab 行右端（周期触发，不需要每天手动按）、
    // 「新增平仓」迁到平仓 tab 的同一位置（低频批量补录，属它自己的视图）。
    const items = [
      { ico: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="9"/>', label: '新增持仓', fn: () => openAddPick() },
      { ico: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>', label: '理财快照', fn: () => openSnapModal() },
      { ico: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>', label: '记收入', fn: async () => { await openFlowModal('in'); } },
      { ico: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', label: '记支出', fn: async () => { await openFlowModal('out'); } },
    ];
    // 每个快捷功能取一个独立强调色（注入 --tint，仅作用于该微件子树，不影响全局强调色）
    const SC_TINTS = ['217, 165, 43', '42, 163, 155', '232, 110, 145', '56, 132, 232'];
    // 必须是原生 <button>：此前用 <div> + JS 挂 cursor/onclick，
    // 结果 role/tabindex/键盘事件全没有——Tab 键走不到这些入口，屏幕阅读器也读不出是按钮。
    // cursor:pointer 由 CSS 的 .shortcut 提供，不再用 JS 写内联样式（内联只允许 --x: v）。
    sc.innerHTML = items.map((it, i) => `<button type="button" class="shortcut tier-3" data-i="${i}" style="--tint:${SC_TINTS[i] || 'var(--tint)'}">
      <span class="shortcut-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${it.ico}</svg></span>
      <span class="shortcut-label">${it.label}</span></button>`).join('');
    sc.querySelectorAll('.shortcut').forEach((el) => {
      el.onclick = items[Number(el.dataset.i)].fn;
    });
  }

  // 区块层错落上浮：首页三大区块（净资产 Hero / 快捷功能 / 最新流水）依次入场。
  // 原先只有 .networth-hero 与 .shortcut 带 hero-in，且快捷功能的延迟是写死的
  // nth-child(2)/(3)；现在统一走 playRiseIn，延迟由 --d 顺序给出。
  playRiseIn(document.querySelector('.home-dash'),
    '.networth-hero, .shortcut-grid, .recent-card', 60);

  // 最新流水（近 45 天，取最近 8 笔；复用 /api/asset/flows）+ 类型过滤胶囊
  const rf = $('#homeRecentFlows');
  if (rf) {
    rf.innerHTML = '<div class="recent-sk"><div class="skeleton-line" style="--sk-w:32%"></div><div class="skeleton-line" style="--sk-w:84%"></div><div class="skeleton-line" style="--sk-w:66%"></div></div>';
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
    } catch (_) { rf.innerHTML = '<div class="recent-empty">流水加载失败</div>'; }
  }
  // 首页「权益收益曲线」+「竖向跑马灯」（待办 + 收益总结）：两者都复用已预取的 calData
  renderRateSpark();
  loadHomeMarquee();
}

// ===== 财务（2026-10-20 tab 重构）=====
async function showFinanceView() {
  $('#financeView').hidden = false; // hideAllViews 后必须显式恢复，否则财务页空白
  renderFinanceView();
}

// 日期 → 中文星期（首页流水按天分组时挂在日期右侧）
const CN_WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function flowWeekLabel(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  return m ? CN_WEEK[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : '';
}

// 首页最新流水：按日期分组 + 竖向时间轴（2026-11-03 方案 B）
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
  const cnt = $('#homeRecentCount');
  if (cnt) cnt.textContent = flows.length ? `共 ${flows.length} 笔` : '';
  if (!flows.length) { rf.innerHTML = '<div class="recent-empty">该类型下暂无近期流水</div>'; return; }
  // 数据已按日期倒序，顺序扫一遍即可分组
  const groups = [];
  flows.forEach((f) => {
    const date = String(f.date || '').slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.items.push(f);
    else groups.push({ date, items: [f] });
  });
  rf.innerHTML = groups.map((g) => {
    // 当日净额只在组内币种一致时展示，避免跨币种直接相加得出错误数字
    const curs = [...new Set(g.items.map((f) => String(f.currency || 'cny').toLowerCase()))];
    let netHtml = `${g.items.length} 笔`;
    if (curs.length === 1) {
      const net = g.items.reduce((s, f) => s + (Number(f.amount) || 0), 0);
      const cls = net > 0 ? 'up' : (net < 0 ? 'down' : '');
      const txt = net === 0 ? moneyCurW(0, curs[0]) : (net > 0 ? '+' : NEG) + moneyCurW(Math.abs(net), curs[0]);
      netHtml = `<span class="rg-net-prefix">当日净额 </span><b class="${cls}">${txt}</b>`;
    }
    const week = flowWeekLabel(g.date);
    return `<div class="recent-group">
      <span class="rg-node"></span>
      <div class="rg-head">
        <span class="rg-date" title="${esc(fmtFlowDate(g.date, 'full'))}${week ? ' ' + week : ''}">${fmtFlowDate(g.date)}</span>
        <span class="rg-week">${week}</span>
        <span class="rg-net">${netHtml}</span>
      </div>
      <div class="rg-rows">${g.items.map((f) => {
        const isIn = f.direction === 'in';
        const amtNum = Number(f.amount) || 0;
        // 圆点按金额方向着色：入账红 / 出账绿 / 0 变动中性灰
        const dotCls = amtNum > 0 ? 'in' : (amtNum < 0 ? 'out' : 'neutral');
        const amtCls = isIn ? 'up' : 'down';
        // 金额取绝对值再拼符号：负数直接拼会变成「−¥-4,380」双负号
        const amt = amtNum === 0 ? moneyCurW(0, f.currency) : (isIn ? '+' : NEG) + moneyCurW(Math.abs(amtNum), f.currency);
        const sub = [f.name, f.ref_name].filter(Boolean).join(' · ');
        return `<div class="rg-row">
          <span class="rg-dot ${dotCls}"></span>
          <div class="rg-main">
            <div class="recent-title">${cashFlowTypeTag(f)}${flowSnapshotTag(f)}</div>
            <div class="recent-sub" title="${esc(sub || f.note || '')}">${esc(sub || f.note || '')}</div>
          </div>
          <span class="recent-amt ${amtCls}">${amt}</span>
        </div>`;
      }).join('')}</div>
    </div>`;
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

// ===== 首页单行步进跑马灯：待办 + 收益句子 =====
// 位置：nw-left 底部、资产分布芯片之下。单行步进：每隔固定秒数整条向上跳一个行高，
// 下一条从下方进入。末尾回到第一条（步进结束后瞬时复位，不用无缝循环复制）。
// hover 暂停、prefers-reduced-motion 时静止显示一条、账本切换后重新取数。

// 收益句子模板池（四套方案全混）：每条带 key 用于"不连续重复"去重，注释标注来源方案便于以后按方案开关筛掉。
// 池子构建在模块顶层，每次页面加载/切账本重建池子即可随机。亏损向已检查：不含劝解类句子。

const PNL_SENT_POOL = {
  // —— 盈利向（3 套方案共 9 条，全落地不删）——
  profit: [
    // 方案一 · 散户自嘲派
    { key: 'P-A1', tpl: `这次手没抖对 · {pnl}` },
    { key: 'P-A2', tpl: `{hold} 只 · 没瞎动就赢了 · {pnl}` },
    { key: 'P-A3', tpl: `{pos} 天红 · 原来我也能选对` },
    // 方案二 · 损行情派
    { key: 'P-B1', tpl: `行情今天终于讲点道理 · {pnl}` },
    { key: 'P-B2', tpl: `{pos} 天红 · 太阳从哪边出来的` },
    { key: 'P-B3', tpl: `市场发善心了 · {pnl}` },
    // 方案三 · 冷面旁白派
    { key: 'P-C1', tpl: `{days} 天累计 {pnl} · 还活着` },
    { key: 'P-C2', tpl: `{pos}/{days} · 股票没全绿` },
    { key: 'P-C3', tpl: `{hold} 只 · {pnl} · 不错` },
    // 方案四 · 损软件派
    { key: 'P-D1', tpl: `系统检测到 {pnl} · 请查收` },
    { key: 'P-D2', tpl: `{pos} 天红 · 我算出来的` },
    { key: 'P-D3', tpl: `{pnl} · 我没算错吧` },
  ],

  // —— 亏损向（3 套方案共 9 条，已检查：不含"别慌/稳住/别担心/正常波动"等劝解类）——
  loss: [
    // 方案一 · 散户自嘲派
    { key: 'L-A1', tpl: `又在关键点位追了 · {pnl}` },
    { key: 'L-A2', tpl: `{hold} 只 · 越扛越惨 · {pnl}` },
    { key: 'L-A3', tpl: `{neg} 天下跌 · 我果然是反向指标` },
    // 方案二 · 损行情派
    { key: 'L-B1', tpl: `行情又不做人了 · {pnl}` },
    { key: 'L-B2', tpl: `{neg} 天下跌 · 市场不讲武德` },
    { key: 'L-B3', tpl: `又被行情遛了一圈 · {pnl}` },
    // 方案三 · 冷面旁白派
    { key: 'L-C1', tpl: `{days} 天累计 {pnl} · 活着就行` },
    { key: 'L-C2', tpl: `{neg}/{days} · 绿得很坚定` },
    { key: 'L-C3', tpl: `{hold} 只 · {pnl} · 还行` },
    // 方案四 · 损软件派
    { key: 'L-D1', tpl: `系统检测到 {pnl} · 也别来找我` },
    { key: 'L-D2', tpl: `{neg} 天下跌 · 数据是对的` },
    { key: 'L-D3', tpl: `{pnl} · 我只负责显示` },
  ],

  // —— 横盘/零累计 ——
  flat: [
    { key: 'F-A1', tpl: `{days} 天 · 原地踏步` },
    { key: 'F-A2', tpl: `{pos} 红 {neg} 绿 · 没赚没亏` },
  ],

  // —— 兜底：数据不足（日历天数不够 / 持仓数为 0 / 数值异常）——
  fallback: [
    { key: 'FB-A1', tpl: `行情在路上` },
    { key: 'FB-A2', tpl: `数据还在攒` },
    { key: 'FB-A3', tpl: `等下一个行情` },
  ],
};

// 上一次抽到的 key，避免连续重复
let _hmLastSentKey = null;

// 从池子里随机抽一条，且不与上一条 key 相同
function _pickFrom(bucket) {
  if (!bucket || !bucket.length) return null;
  const n = bucket.length;
  let k = Math.floor(Math.random() * n);
  if (n > 1 && bucket[k].key === _hmLastSentKey) {
    // 抽到上一条了，换一个
    k = (k + 1 + Math.floor(Math.random() * (n - 1))) % n;
  }
  const item = bucket[k];
  _hmLastSentKey = item.key;
  return item.tpl;
}

// 把模板里的占位符换成真实值
function _fill(tpl, vars) {
  let s = tpl;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

// 主函数：根据方向 + 数据完整度选池 → 抽 → 填变量 → 返回单条字符串
function pickPnlSentence(cum30, upDays, downDays, dayCnt, holdingCount) {
  // 数据不足兜底：日历天数 < 5 或持仓数为 0 或累计数不是有限数
  const dataReady = Number.isFinite(cum30) && Math.abs(cum30) > 0.01;
  const hasDays = Number.isFinite(dayCnt) && dayCnt >= 5;
  const hasHold = Number.isFinite(holdingCount) && holdingCount > 0;

  if (!dataReady && !hasDays) {
    return _pickFrom(PNL_SENT_POOL.fallback);
  }

  const amt = yuanOfW(Math.abs(cum30));
  const sign = cum30 >= 0 ? '+' : '−';
  const pnl = cum30 === 0 ? '¥0' : `${sign}${amt}`;
  const days = hasDays ? dayCnt : '近';
  const pos = Number.isFinite(upDays) && upDays > 0 ? upDays : '几';
  const neg = Number.isFinite(downDays) && downDays > 0 ? downDays : '几';
  const hold = hasHold ? holdingCount : '几只';

  const vars = { pnl, days, pos, neg, hold };

  let bucket;
  if (!Number.isFinite(cum30) || Math.abs(cum30) < 0.01) bucket = PNL_SENT_POOL.flat;
  else if (cum30 > 0) bucket = PNL_SENT_POOL.profit;
  else bucket = PNL_SENT_POOL.loss;

  const tpl = _pickFrom(bucket);
  return tpl ? _fill(tpl, vars) : '';
}

async function loadHomeMarquee() {
  const box = $('#homeMarquee');
  if (!box) return;
  // 每次加载重置上一句 key：切账本 / 重新进首页 = 新一轮随机，不继承旧去重状态
  _hmLastSentKey = null;
  try {
    // 确保 calData 已加载（renderRateSpark 可能已拉，但这里不依赖它的执行顺序）
    if (!Object.keys(calData).length) {
      const r = await api('/api/pnl/history');
      if (r.ok) {
        const d = await r.json();
        (d.history || []).forEach((h) => { calData[h.date] = h; });
      }
    }

    // 近 30 日统计（复用 renderRateSpark 的切片逻辑）
    const sortedDates = Object.keys(calData).sort();
    let dailyPnl = sortedDates.map((ds) => {
      const v = calData[ds].equity_pnl_cny;
      return (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
    });
    if (dailyPnl.length > 30) dailyPnl.splice(0, dailyPnl.length - 30);
    dailyPnl = dailyPnl.filter((v) => v !== 0);

    let cum30 = 0, upDays = 0, downDays = 0;
    dailyPnl.forEach((v) => {
      cum30 += v;
      if (v > 0.5) upDays++;
      else if (v < -0.5) downDays++;
    });
    const holdingCount = (allHoldings || []).filter((h) => (h.quantity || 0) > 0).length;

    const sentence = pickPnlSentence(cum30, upDays, downDays, dailyPnl.length, holdingCount);

    // 拉待办（失败静默）
    let todoGroups = [];
    try {
      const r = await api('/api/today/brief');
      if (r.ok) {
        homeMarqueeData = await r.json();
        todoGroups = homeMarqueeData.groups || [];
      }
    } catch (_) { /* 静默 */ }

    // 渲染跑马灯：传 cum30 + downDays 用于「亏损+无支出待办」宽慰池判定
    renderHomeMarquee(sentence, todoGroups, cum30, downDays);
  } catch (_) {
    box.hidden = true;
  }
}

// 跑马灯步进动画：JS 驱动 transition，每次完整跳一行
let _hmTimer = null;      // 当前 step 的 timeout id
let _hmIdx = 0;           // 当前显示的 item 下标
let _hmCleanup = null;    // 上次渲染绑定的监听清理函数（重渲染前先拆）

// 跑马灯节奏常量（集中定义，别散落在多处）
const HM_INTERVAL_MS = 2500;        // 每条停驻 2.5s（短到能一眼读完，不抢视线）
const HM_STEP_TRANSITION = 'transform .3s cubic-bezier(.4,0,.2,1)';  // 行间过渡 0.3s
// 系统「减弱动态效果」：仍然轮播，只是把位移过渡换成瞬间换行（见 step 与 style.css 的 reduce 块）
const HM_REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// 装饰性 SVG 图标：16x16 viewBox，内联到每条跑马灯之前。aria-hidden（纯装饰）。
// 颜色靠 CSS class 注入（hm-ic-alert / hm-ic-repay / hm-ic-sent / ...）。
const HM_ICONS = {
  alert:    `<svg class="hm-ic hm-ic-alert" aria-hidden="true" viewBox="0 0 16 16" width="1em" height="1em"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>`,
  dca:      `<svg class="hm-ic hm-ic-dca" aria-hidden="true" viewBox="0 0 16 16" width="1em" height="1em"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6h11M5 1.5v4M11 1.5v4" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>`,
  repay:    `<svg class="hm-ic hm-ic-repay" aria-hidden="true" viewBox="0 0 16 16" width="1em" height="1em"><rect x="2" y="5" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="9" r="1.6" fill="currentColor"/><path d="M2 7h12" stroke="currentColor" stroke-width="1.4"/></svg>`,
  income:   `<svg class="hm-ic hm-ic-income" aria-hidden="true" viewBox="0 0 16 16" width="1em" height="1em"><path d="M8 2 L8 14 M3 6 L8 2 L13 6" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M3 11 L8 7 L13 11 M8 7 L8 14" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>`,
  maturity: `<svg class="hm-ic hm-ic-maturity" aria-hidden="true" viewBox="0 0 16 16" width="1em" height="1em"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 2.5 L8 7 L13.5 2.5 M8 7 V13.5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>`,
  sent:     `<svg class="hm-ic hm-ic-sent" aria-hidden="true" viewBox="0 0 16 16" width="1em" height="1em"><path d="M8 2 C12 3 14 7 13 12 C11 13 7 13 5 11 C5 7 6 4 8 2 Z" fill="currentColor"/></svg>`,
};

// 宽慰池 B（亏损 + 有收入缓冲）：点明"有收入进来"这一事实，两个事实并置
const COMFORT_INCOME_POOL = [
  `账上在跌 · 下月的收入还在路上`,
  `回撤还在 · 收支计划里还有进账`,
  `亏的这部分慢慢看 · 收入能接住`,
  `净值往下走 · 还有 {inc} 进来`,
];
// 宽慰池 A（亏损 + 无支出 + 无收入缓冲）：最低缓冲级别
const COMFORT_EMPTY_POOL = [
  `账上在跌 · 但本月没有要还的钱`,
  `回撤还在 · 这个月没有账单催你`,
  `亏的这部分慢慢看 · 至少本月不用掏钱`,
  `30 天里 {neg} 天下跌 · 没有支出项，节奏还在你手里`,
  `净值往下走 · 没地方让你现在掏腰包`,
];

function renderHomeMarquee(sentence, todoGroups, cum30, downDays) {
  const box = $('#homeMarquee');
  const track = $('#homeMarqueeTrack');
  if (!box || !track) return;

  const items = [];

  if (todoGroups.length) {
    todoGroups.forEach((g) => {
      (g.items || []).forEach((it) => {
        const label = esc(g.label || '');
        const title = esc(it.title || '');
        const sub = esc(it.sub || '');
        const amt = Number(it.amount) || 0;
        const amtText = amt > 0 ? ` · ${esc(yuanOfW(amt))}` : '';
        const icon = HM_ICONS[g.key] || HM_ICONS.alert;
        items.push({
          key: g.key,
          html: `${icon}<span class="hm-text-wrap"><span class="hm-label">${label}</span> · <span class="hm-name">${title}</span> · <span class="hm-info">${sub}${amtText}</span></span>`,
        });
      });
    });
  }

  // 待还款兜底（亏损场景按三档优先级出宽慰句）：
  //   档 1：有待还款事项 → 已在上一段 items.push 里处理，宽慰句不抢占
  //   档 2：无还款 + 亏损 + 有收入缓冲（未来收入金额 > 0） → 宽慰池 B（点明收入事实）
  //   档 3：无还款 + 亏损 + 无收入缓冲 → 宽慰池 A（两个事实并置：账面亏 + 无支出压力）
  //   档 4：非亏损 → 中性事实「本月没有待还款」
  const repayGroup = todoGroups.find((g) => g.key === 'repay');
  const repayHasItems = repayGroup && repayGroup.items && repayGroup.items.length > 0;
  if (!repayHasItems) {
    const isLoss = Number.isFinite(cum30) && cum30 < -0.01;
    const incomeGroup = todoGroups.find((g) => g.key === 'income');
    const incomeAmt = Number(incomeGroup && incomeGroup.amount) || 0;
    const hasIncome = incomeAmt > 0.01;

    if (isLoss && hasIncome && COMFORT_INCOME_POOL.length) {
      // 档 2：有收入缓冲
      const inc = yuanOfW(incomeAmt);
      const tpl = COMFORT_INCOME_POOL[Math.floor(Math.random() * COMFORT_INCOME_POOL.length)];
      const s = tpl.replaceAll('{inc}', inc);
      items.push({
        key: 'comfort-income',
        html: `${HM_ICONS.repay}<span class="hm-text-wrap"><span class="hm-sent">${esc(s)}</span></span>`,
      });
    } else if (isLoss && !hasIncome && COMFORT_EMPTY_POOL.length) {
      // 档 3：无缓冲宽慰
      const neg = Number.isFinite(downDays) && downDays > 0 ? downDays : '几';
      const tpl = COMFORT_EMPTY_POOL[Math.floor(Math.random() * COMFORT_EMPTY_POOL.length)];
      const s = tpl.replaceAll('{neg}', String(neg));
      items.push({
        key: 'comfort-loss',
        html: `${HM_ICONS.repay}<span class="hm-text-wrap"><span class="hm-sent">${esc(s)}</span></span>`,
      });
    } else {
      // 档 4：非亏损或亏损但没宽慰池 → 中性事实
      items.push({
        key: 'repay-empty',
        html: `${HM_ICONS.repay}<span class="hm-text-wrap"><span class="hm-name">本月没有待还款</span></span>`,
      });
    }
  }

  if (sentence) {
    items.push({ key: 'sent', html: `${HM_ICONS.sent}<span class="hm-text-wrap"><span class="hm-sent">${esc(sentence)}</span></span>` });
  }

  // 清理旧定时器 / 旧监听（重复渲染时避免叠加：原先每次渲染都 addEventListener，
  // 切换账本 / 反复刷新后会累积多份 handler，hover 暂停与恢复互相打架）
  const teardown = () => {
    if (_hmTimer) { clearTimeout(_hmTimer); _hmTimer = null; }
    if (_hmCleanup) { try { _hmCleanup(); } catch (_) {} _hmCleanup = null; }
  };

  if (!items.length) { teardown(); box.hidden = true; return; }
  teardown();

  // 渲染：每 div = 固定行高 + flex 行
  track.innerHTML = items.map((it) => `<div class="hm-item" data-k="${it.key}">${it.html}</div>`).join('');

  box.hidden = false;
  _hmIdx = 0;
  box._hmPaused = false;   // 重渲染时清掉上次遗留的 hover 暂停状态
  track._hmItems = items;
  track._hmRowH = 0;
  track.style.transition = 'none';
  track.style.transform = 'translateY(0)';

  // 单行高度实测后写回 CSS 变量 --hm-row-h，让 .hm-viewport 与 .hm-item 用同一个值。
  // 2026-11-02 修「刷新时文字被遮挡」：原先 viewport 是 1.6em（跟父 16px = 25.6px），
  // item 是 1.6em（跟自身 11px = 17.6px），视口比一行高 8px，必然露出下一条的半个字顶。
  // 这里再实测一次兜底 —— 字体加载完成、断点变化后行高可能变，靠 JS 覆盖变量对齐。
  const syncRowH = () => {
    const first = track.firstElementChild;
    if (!first) return 0;
    const h = Math.round(first.getBoundingClientRect().height);
    if (!h) return 0;
    if (h !== track._hmRowH) {
      track._hmRowH = h;
      box.style.setProperty('--hm-row-h', h + 'px');
    }
    track.style.transform = `translateY(${-_hmIdx * track._hmRowH}px)`;
    return h;
  };
  syncRowH();
  requestAnimationFrame(() => { syncRowH(); });   // 首帧布局可能还没稳定
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { syncRowH(); }).catch(() => {});
  }

  if (items.length <= 1) return;

  const step = () => {
    const n = track._hmItems?.length || 0;
    if (n <= 1) return;
    syncRowH();                     // 每跳前重测，避免行高变化后逐条累积错位
    _hmIdx = (_hmIdx + 1) % n;
    // 系统开了「减弱动态效果」时仍轮播，只是去掉位移过渡（瞬间换行）。
    track.style.transition = HM_REDUCED ? 'none' : HM_STEP_TRANSITION;
    track.style.transform = `translateY(${-_hmIdx * (track._hmRowH || 0)}px)`;
  };

  const onEnter = () => {
    box._hmPaused = true;
    if (_hmTimer) { clearTimeout(_hmTimer); _hmTimer = null; }
    const cs = getComputedStyle(track);
    track.style.transition = 'none';
    track.style.transform = cs.transform;
  };
  const onLeave = () => {
    box._hmPaused = false;
    track.style.transition = 'none';
    syncRowH();                     // 回到整行对齐位置（同时校正行高）
    scheduleNext();
  };
  // hover 暂停只认「真鼠标」（pointerType === 'mouse'）。
  // 不再用 (hover:hover) 媒体查询判定：安卓 WebView / 微信 X5 内核常把它判成 true，
  // 于是触摸设备也会挂上 mouseenter；而手机 tap / 滑动会合成 mouseenter、却未必派发
  // mouseleave → _hmPaused 卡在 true，跑马灯再也不动（「手机上不生效」的真正来源）。
  const onPointerEnter = (e) => { if (e.pointerType === 'mouse') onEnter(); };
  const onPointerLeave = (e) => { if (e.pointerType === 'mouse') onLeave(); };
  box.addEventListener('pointerenter', onPointerEnter);
  box.addEventListener('pointerleave', onPointerLeave);
  // 兜底：任何触摸动作都把暂停解开（某些老内核 pointerType 缺失 / 只发 mouse 合成事件）
  const onTouchStart = () => {
    if (!box._hmPaused) return;
    box._hmPaused = false;
    syncRowH();
    scheduleNext();
  };
  box.addEventListener('touchstart', onTouchStart, { passive: true });

  const scheduleNext = () => {
    if (box._hmPaused) return;
    _hmTimer = setTimeout(() => {
      if (box._hmPaused) return;
      step();
      scheduleNext();
    }, HM_INTERVAL_MS);
  };
  scheduleNext();

  // 窗口尺寸变化（跨断点字号会变）后重新对齐
  let _hmResizeT = null;
  const onResize = () => {
    if (_hmResizeT) clearTimeout(_hmResizeT);
    _hmResizeT = setTimeout(() => { _hmResizeT = null; syncRowH(); }, 120);
  };
  window.addEventListener('resize', onResize);

  _hmCleanup = () => {
    if (_hmTimer) { clearTimeout(_hmTimer); _hmTimer = null; }
    if (_hmResizeT) { clearTimeout(_hmResizeT); _hmResizeT = null; }
    window.removeEventListener('resize', onResize);
    box.removeEventListener('pointerenter', onPointerEnter);
    box.removeEventListener('pointerleave', onPointerLeave);
    box.removeEventListener('touchstart', onTouchStart);
  };
}

// 所有循环计划共享一个查看月份 YYYY-MM（统一翻页：滑动任意一张，全部一起翻）；默认当前月
let cfViewYm = null;// 按月份缓存的 doneMap：ym -> { [planId]: {...} }
const _planDoneCache = {};

// 财务页当前查看的年度（YYYY 字符串）。切换后整页（收支平衡卡 + 概览卡）按该年度重算。
let finYear = String(new Date().getFullYear());
// 财务页热力图 / 分类明细共用状态
let finMonthsData = [];          // /api/finance/summary 的 months 数组（12 月）
let finHmMonth = 0;             // 收支分析卡当前选中月份下标（0–11），同时驱动热力图与分类明细
let finMonthAutoFrom = 0;       // 方案 6：自动跳月的来源月（1–12，0 = 未发生自动跳月），用于提示文案

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
      // 收支分析卡：默认选中当前月；当前月没有记录时自动落到该年「最近有数据的月份」。
      // 方案 6：原先无条件选当前月 → 11 月初打开财务页首屏就是「当月暂无收支子项」，
      // 而数据全在 10 月，等于一进来就是空页；往年（curIdx 找不到）也不该硬跳 12 月。
      const curYm = year + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
      const curIdx = finMonthsData.findIndex((m) => m.ym === curYm);
      const monthHasData = (i) => {
        const mm = finMonthsData[i];
        return !!mm && Math.abs(Number(mm.income) || 0) + Math.abs(Number(mm.expense) || 0) > 0;
      };
      const withData = finMonthsData.map((_, i) => i).filter(monthHasData);
      const hasCur = curIdx >= 0 && monthHasData(curIdx);
      if (hasCur) {
        finHmMonth = curIdx;
        finMonthAutoFrom = 0;
      } else if (withData.length) {
        finHmMonth = Math.max(...withData);          // 最近有记录的那个月
        finMonthAutoFrom = curIdx >= 0 ? curIdx + 1 : 0; // 0 = 该年没有「当前月」这一格
      } else {
        // 整年零记录：留在当前月（往年则落到 12 月），空状态只留一处
        finHmMonth = curIdx >= 0 ? curIdx : 11;
        finMonthAutoFrom = 0;
      }
      if (heatmap) { heatmap.hidden = false; renderFinHeatmap(); }
      // 区块层错落上浮：KPI 卡片 → 热力图卡 → 分类明细卡依次入场。
      // 放在数据就绪之后 —— 骨架占位期间先播的是骨架屏动画。
      playRiseIn($('#financeView'), '.kpi-section, .fin-heatmap-card', 60);
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
  // 月均分母 = 当年「有收支流水的月份数」，不能写死 12：
  // 年中（如 10 月）按 12 摊会把月均压低约 17%，与资产页「每月支出」（循环计划口径）也对不上。
  const activeMonths = (d.months || []).filter((x) => Math.abs(Number(x.income) || 0) + Math.abs(Number(x.expense) || 0) > 0).length;
  const div = Math.max(1, activeMonths);
  const netMonth = net / div;
  // 后端的 months_covered 是「被动收入可覆盖几个月支出」，与「净结余」不是一个口径，
  // 放在净结余卡下会被读成「结余能撑几个月」——改挂到 title 里，正文让位给月均（与前后两张卡同形）。
  const passiveMonths = Number(d.months_covered) || 0;
  const netCls = net >= 0 ? '' : ' is-neg';
  const netSign = net >= 0 ? '+' : NEG;
  grid.innerHTML = `
    <div class="kpi-card density-standard kpi-income">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></div>
      <div class="kpi-label">年度总收入</div>
      <div class="kpi-main"><div class="kpi-value">${moneyCurW(inc, 'cny')}</div></div>
      <div class="kpi-sub">月均 <span class="hl">${moneyCurW(inc / div, 'cny')}</span><span class="u-muted"> · ${div} 个月</span></div>
    </div>
    <div class="kpi-card density-standard kpi-expense">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg></div>
      <div class="kpi-label">年度总支出</div>
      <div class="kpi-main"><div class="kpi-value">${moneyCurW(exp, 'cny')}</div></div>
      <div class="kpi-sub">月均 <span class="hl">${moneyCurW(exp / div, 'cny')}</span><span class="u-muted"> · ${div} 个月</span></div>
    </div>
    <div class="kpi-card density-standard kpi-surplus" title="被动收入可覆盖 ${passiveMonths.toFixed(1)} 个月支出（按当前月支出水平估算）">
      <div class="kpi-icon"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></div>
      <div class="kpi-label">年度净结余</div>
      <div class="kpi-main"><div class="kpi-value${netCls}">${netSign}${moneyCurW(Math.abs(net), 'cny')}</div></div>
      <div class="kpi-sub">月均 <span class="hl">${(netMonth >= 0 ? '+' : NEG) + moneyCurW(Math.abs(netMonth), 'cny')}</span><span class="u-muted"> · ${div} 个月</span></div>
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

// ===== 财务页 · 年度收支分析卡（左月度柱 / 右子项热力图） =====
function renderFinHeatmap() {
  renderYearBarChart();
  renderHmChips();
  renderCatTreemap();
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
// 面积型小方块（收支热力图 / 拼块）里的金额标签：只回答「大约多少」，取整 + 万位压缩。
// 这是全站唯一不按 2 位小数展示的金额位置 —— 方块宽度常在 50–90px，多出「.00」三个字符
// 就会被裁掉或挤掉分类名；精确到分的数字在下方「收支分类明细」与逐笔流水里给全。
const moneyLabelShort = (v, cur) => {
  const n = Number(v) || 0, a = Math.abs(n);
  return curSymbolJS(cur || 'cny') + (a >= 1e4 ? (n / 1e4).toFixed(2) + '万' : Math.round(n).toLocaleString('zh-CN'));
};
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
// 柱图悬停态：_barGeo 存下本次几何（指针换算要用），_barHover 记当前高亮列。
// 悬停只切 class / 挪浮层位置，绝不重绘 SVG —— 12 根柱子 + 网格每次重绘会闪。
let _barGeo = null;   // { padLeft, slot, w, topY[] }
let _barHover = -1;

// 悬浮读数浮层：柱顶不再常显 12 个合计（数字盖过柱形、小金额还贴着 0 线飘），
// 改由「整列淡底 + 引导虚线 + 2×2 读数」承担；选中月只在柱顶留一个小圆点定位。
function showBarTip(i) {
  const svg = document.getElementById('yearBarChart');
  const tip = document.getElementById('yearBarTip');
  const m = finMonthsData[i];
  if (!svg || !tip || !m || !_barGeo) return;
  if (_barHover !== i) {
    _barHover = i;
    svg.querySelectorAll('.bar-col').forEach((g) => g.classList.toggle('is-hover', Number(g.dataset.mi) === i));
    const inc = Number(m.income) || 0, exp = Number(m.expense) || 0, net = inc - exp;
    tip.innerHTML = `<div class="bar-tip-month">${i + 1} 月</div>
      <div class="bar-tip-grid">
        <span class="bar-tip-cell bar-tip-inc"><span>收入</span><b>${moneyCurW(inc, 'cny')}</b></span>
        <span class="bar-tip-cell bar-tip-exp"><span>支出</span><b>${moneyCurW(exp, 'cny')}</b></span>
        <span class="bar-tip-cell"><span>合计</span><b>${moneyCurW(inc + exp, 'cny')}</b></span>
        <span class="bar-tip-cell"><span>结余</span><b>${(net < 0 ? NEG : '+') + moneyCurW(Math.abs(net), 'cny')}</b></span>
      </div>`;
  }
  const stem = document.getElementById('barStem');
  const cx = _barGeo.padLeft + _barGeo.slot * i + _barGeo.slot / 2;
  if (stem) {
    stem.setAttribute('x1', cx.toFixed(1));
    stem.setAttribute('x2', cx.toFixed(1));
    stem.setAttribute('y2', (_barGeo.topY[i] || 0).toFixed(1));
    stem.classList.remove('is-off');
  }
  // 浮层贴在本列右侧（右侧放不下就翻到左侧），左右都不压住正在看的那根柱子
  const box = svg.getBoundingClientRect();
  const x = (cx / _barGeo.w) * box.width;
  tip.classList.add('is-on');
  const tw = tip.offsetWidth;
  let left = x + 12;
  if (left + tw > box.width - 2) left = x - tw - 12;
  tip.style.left = Math.max(2, left) + 'px';
  tip.style.top = '2px';
}

function hideBarTip() {
  const tip = document.getElementById('yearBarTip');
  const stem = document.getElementById('barStem');
  if (_barHover >= 0) {
    const svg = document.getElementById('yearBarChart');
    if (svg) svg.querySelectorAll('.bar-col.is-hover').forEach((g) => g.classList.remove('is-hover'));
    _barHover = -1;
  }
  if (tip) tip.classList.remove('is-on');
  if (stem) stem.classList.add('is-off');
}

// 指针事件绑在 svg 自身上（不是每根柱子）：柱图每次都整体重绘，
// 逐柱绑监听会随 innerHTML 一起被丢掉；委托在 svg 上则一次绑定长期有效。
function bindBarChartHover(svg) {
  if (svg.dataset.barHover === '1') return;
  svg.dataset.barHover = '1';
  svg.addEventListener('pointerover', (e) => {
    const col = e.target.closest ? e.target.closest('.bar-col') : null;
    // 触屏没有 hover 语义：按下只会走 click 选月，不弹浮层（否则浮层会赖着不走）
    if (!col || e.pointerType === 'touch') { hideBarTip(); return; }
    showBarTip(Number(col.dataset.mi));
  });
  svg.addEventListener('pointerleave', () => hideBarTip());
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
  hideBarTip();
  if (!months.length) { svg.innerHTML = ''; labels.innerHTML = ''; _barGeo = null; return; }
  const totals = months.map((m) => (m.income || 0) + (m.expense || 0));
  const maxVal = Math.max(1, ...totals);
  // y 轴：步长取「漂亮」值，顶线 = step × 等分数（略高于最大值、不裁顶）。
  // 等分数不写死 4：最大值刚过一档时（4.1 万 ÷ 4 → 步长 2 万 → 顶线 8 万），
  // 柱子只剩一半高、顶部大片空白。多试 5/6 等分取顶线最低的一套，柱形通常能长到 80%+。
  let divs = 4;
  let step = niceStep(maxVal / divs);
  for (const d of [5, 6]) {
    const s = niceStep(maxVal / d);
    if (s * d < step * divs) { step = s; divs = d; }
  }
  const top = step * divs;
  const slot = plotW / Math.max(1, months.length);
  const bw = slot * 0.62;
  const topY = [];
  const paths = [];
  // 网格线 + y 轴刻度标签（自下而上 0, step, 2step …）
  for (let k = 0; k <= divs; k++) {
    const y = baseY - plotH * k / divs;
    paths.push(`<line class="bar-grid" x1="${PAD_LEFT}" y1="${y.toFixed(1)}" x2="${W - PAD_RIGHT}" y2="${y.toFixed(1)}"/>`);
    paths.push(`<text class="bar-tick" x="${PAD_LEFT - 5}" y="${(y + 2.6).toFixed(1)}">${barMoneyShort(step * k)}</text>`);
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
    topY[i] = yExp;
    // 整列命中区：淡底铺满整个绘图高度（等宽 slot 而不留缝），
    // 指针扫过列就触发读数，不必精确压在细柱子上；也是 click 选月的落点。
    paths.push(`<g class="bar-col" data-mi="${i}">`);
    paths.push(`<rect class="bar-band" x="${(PAD_LEFT + slot * i).toFixed(1)}" y="${PAD_TOP}" width="${slot.toFixed(1)}" height="${plotH}" rx="${R}"/>`);
    if (expH > 0.5) paths.push(`<path class="bar-exp" opacity="0.9" d="${barSegPath(x, yExp, bw, expH, R, true, incH <= 0.5)}"/>`);
    if (incH > 0.5) paths.push(`<path class="bar-inc" opacity="0.9" d="${barSegPath(x, yInc, bw, incH, R, expH <= 0.5, true)}"/>`);
    // 选中月只在柱顶留一个小圆点：标位置而不读数，12 个数字不再抢视线。
    if (i === finHmMonth && total > 0.5) {
      paths.push(`<circle class="bar-sel-dot" cx="${cx.toFixed(1)}" cy="${(yExp - 5).toFixed(1)}" r="2.2"/>`);
    }
    paths.push('</g>');
  });
  // 引导虚线：悬停时从浮层垂到柱顶，把「这组数字属于哪根柱子」钉死
  svg.innerHTML = paths.join('') + `<line class="bar-stem is-off" id="barStem" x1="0" y1="${PAD_TOP}" x2="0" y2="${PAD_TOP}"/>`;
  _barGeo = { padLeft: PAD_LEFT, slot, w: W, topY };
  bindBarChartHover(svg);
  labels.innerHTML = months.map((_, i) => `<span data-mi="${i}" class="${i === finHmMonth ? 'active' : ''}">${i + 1}</span>`).join('');
}

// 空状态文案（方案 6 / 10）：区分「这个月没记录」和「整年都没记录」。
// 后者不能只说「当月暂无」，否则用户会一直按月翻找。
function finEmptyText() {
  const any = (finMonthsData || []).some((m) => (m && ((m.items || []).length > 0
    || Math.abs(Number(m.income) || 0) + Math.abs(Number(m.expense) || 0) > 0)));
  if (any) return '该月暂无收支记录，点上方月份可切换';
  return `${finYear} 年还没有收支记录，先到资产页「流水」记一笔`;
}

// 右：月份 chips（选中月决定 treemap 内容）
function renderHmChips() {
  const wrap = document.getElementById('hmChips');
  if (!wrap) return;
  wrap.innerHTML = finMonthsData.map((m, i) =>
    `<button class="hm-chip${i === finHmMonth ? ' active' : ''}" data-mi="${i}" type="button">${i + 1}月</button>`).join('');
  // 方案 6：把「为什么不是你选的月份」写明白，否则用户会以为筛选器坏了
  const hint = document.getElementById('hmAutoHint');
  if (hint) {
    if (finMonthAutoFrom) {
      hint.hidden = false;
      hint.textContent = `${finMonthAutoFrom} 月暂无记录，已为你切到 ${finHmMonth + 1} 月`;
    } else {
      hint.hidden = true;
      hint.textContent = '';
    }
  }
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
  // 窄屏判据与 .heatmap-layout 竖排断点（880px）一致：竖排时 treemap 独占一行，高度区间收紧
  const narrow = window.innerWidth <= 880;
  if (!m || !m.items || !m.items.length) {
    wrap.style.setProperty('--tmh', (narrow ? 180 : 220) + 'px');
    wrap.innerHTML = '<div class="hm-box empty">' + esc(finEmptyText()) + '</div>';
    return;
  }
  const monthYm = m.ym;
  // 每个分类聚合当月逐笔流水（折 CNY）作为二级细项
  const cats = m.items.map((it) => {
    const flows = (finFlowsCache || []).filter((f) =>
      (f.date || '').slice(0, 7) === monthYm && flowCatOf(f) === it.category);
    const subs = flows.map((f) => ({
      amt: flowToCny(f),
      title: flowTitleOf(f, finCatLabel(it.category)),
    })).filter((s) => s.amt > 0);
    // signed：正=资金流入、负=流出。分类汇总金额可能是负的（如某月落袋收益净亏损、
    // 退款大于支出的分类），方向和正负号必须按 signed 判，不能只看 type。
    const signed = it.type === 'income' ? (it.amount || 0) : -(it.amount || 0);
    return { amt: Math.abs(it.amount) || 0, signed, category: it.category, type: it.type, subs };
  }).filter((c) => c.amt > 0);
  if (!cats.length) {
    wrap.style.setProperty('--tmh', (narrow ? 180 : 220) + 'px');
    wrap.innerHTML = '<div class="hm-box empty">' + esc(finEmptyText()) + '</div>';
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
      const isInc = c.signed >= 0;
      const label = finCatLabel(c.category);
      const amtStr = (isInc ? '+' : '−') + moneyLabelShort(c.amt, 'cny');
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
      const isInc = c.signed >= 0;
      const GAP = 3;   // 细项方块间距（太小的方块不留，避免挤出负尺寸）
      const sr = squarifyTreemap(c.subs, 0, 0, iw, ih);
      // 透明度随面积（金额）映射：组内最大 → 最实，最小 → 最透；sqrt 压缩让小方块也有可辨色阶
      const maxAmt = c.subs.reduce((a, s) => Math.max(a, s.amt), 0);
      box.innerHTML = sr.map((s) => {
        const g = (s.w > GAP + 6 && s.h > GAP + 6) ? GAP : 0;
        // 只显示金额，名称/描述过长一律收进 title 悬停，避免方块内文字堆积
        // 阈值按「−¥2,352」这类最长串的实测宽度取，窄于此一律不画（手机窄屏方块普遍 40–60px）
        const showAmt = s.w >= 50 && s.h >= 18;
        const amtStr = (isInc ? '+' : '−') + moneyLabelShort(s.i.amt, 'cny');
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
  finMonthAutoFrom = 0;   // 用户手动选月 → 「已为你切到」的提示随即失效
  const chips = document.getElementById('hmChips');
  if (chips) renderHmChips();   // 重绘 chips：顺带把自动跳月提示收起来（点击走 document 委托，重建无副作用）
  const labels = document.getElementById('yearBarLabels');
  if (labels) labels.querySelectorAll('span').forEach((s, i) => s.classList.toggle('active', i === idx));
  renderYearBarChart();   // 重绘柱状图
  renderCatTreemap();
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

// 流水明细标题 = ref_name · note · name 三段拼接。
// 收尾两段同名时要去重：「手动调整」这类自指流水会拼成
// 「RMB账户 · 手动调整：¥1400.95 → ¥1401.69 · RMB账户」，首尾账户名重复纯属噪音。
function flowTitleOf(f, fallback) {
  const parts = [f.ref_name, f.note, f.name].filter(Boolean);
  if (parts.length > 1 && parts[0] === parts[parts.length - 1]) parts.pop();
  return parts.join(' · ') || (fallback || '');
}

// ===== 财务页 · 当月收支分类明细（2026-11-03 下线） =====
// 上半部分的热力图已经把「分类 → 逐笔金额」完整画出来了（.hm-cat / .hm-sub），
// 再把同一批流水按分类列一遍纯属重复（实测占整页 65% 高度，且逐笔明细没有回退能力）。
// 逐笔明细统一在资产页「流水」时间轴看。finFlowsCache 仍被 renderCatTreemap 使用，不能删。

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
  // 月度柱（整列命中区）/ x 轴标签 / 月份 chip → 选月（热力图与分类明细同步）
  const bar = t.closest('#yearBarChart .bar-col');
  if (bar) { selectHmMonth(Number(bar.dataset.mi)); return; }
  const xl = t.closest('#yearBarLabels span');
  if (xl) { selectHmMonth(Number(xl.dataset.mi)); return; }
  const hmChip = t.closest('#hmChips .hm-chip');
  if (hmChip) { selectHmMonth(Number(hmChip.dataset.mi)); return; }
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

// ── 密码框表单提交（方案 15）────────────────────────────────────────────
// <input type="password"> 不在 <form> 内会触发控制台警告，且框内回车不会提交。
// index.html 里已把 8 个密码输入框包进 <form class="pw-form" data-pwsubmit="按钮id">，
// display:contents 保证布局不变；这里统一把 submit 转成「点该区块原有的保存按钮」，
// 不重复实现保存逻辑，也不会出现一次回车触发两次请求。
document.addEventListener('submit', (e) => {
  const f = e.target && e.target.closest ? e.target.closest('form.pw-form') : null;
  if (!f) return;
  e.preventDefault();               // 阻止默认跳转（表单未声明 action 时会刷新当前页）
  const btn = document.getElementById(f.dataset.pwsubmit || '');
  if (btn) btn.click();
});

// ESC 键：从任意二级页（资产/速算/日历）返回主页
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // 弹框优先（含通知弹框），ESC 直接关闭
  const openModals = document.querySelectorAll('.modal:not([hidden])');
  if (openModals.length) {
    openModals.forEach((m) => { m.hidden = true; });
    hideTrendTip();   // 关闭任意弹框时收起可能残留的悬停浮框（如持仓盈亏曲线的 pinned tooltip）
    return;
  }
  const inSubView = !$('#homeView').hidden || !$('#holdingsView').hidden || !$('#assetView').hidden || !$('#financeView').hidden
    || !$('#settingsView').hidden || !$('#aiView').hidden || !$('#devicesView').hidden || !$('#notifyView').hidden;
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
  if (!r.ok) { toast(humanizeErr(r, null, '加载盈亏历史失败'), 'err'); return; }
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

// 盈亏明细不单列「币种」：原始币种改以符号（¥ / $ / HK$）走在代码前。
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
  let equityCNY = 0, wealthCNY = 0;
  try {
    const det = JSON.parse(rec.detail || '{}');
    const syms = det.by_symbol || [];
    const wts = det.by_wealth || [];
    // 2026-11-02：原「持仓 / 理财」两张表合并成一张。两张表各自的表头（代码 / 名称 / 盈亏）
    // 叠在同一个弹框里像两份报表，行距也被表头切碎；合表后一列到底，类型靠名称前的
    // 小徽标区分（持仓 / 理财），顶部汇总行照旧分成权益盈亏 / 理财盈亏两个数。
    const codeByName = {};
    (((assetData || {}).wealth || {}).products || []).forEach((p) => { if (p.name && p.code) codeByName[p.name] = p.code; });
    const line = (kind, codeCell, name, cny) => '<tr><td class="cal-code">' + codeCell + '</td>'
      + '<td><span class="cal-kb' + (kind === 'wealth' ? ' is-wealth' : '') + '">' + (kind === 'wealth' ? '理财' : '持仓') + '</span>' + name + '</td>'
      + '<td class="num ' + clsPnl(cny) + '">' + fmtPnl(cny) + '</td></tr>';
    const lines = [];
    syms.forEach((s) => {
      // 优先用快照时折算的 CNY 值；旧快照无该字段则用当前汇率回退折算
      const cny = (typeof s.pnl_cny === 'number') ? s.pnl_cny : toRmb({ currency: s.currency }, s.pnl);
      equityCNY += cny;
      lines.push(line('equity', calCurSym(s.currency) + (s.symbol || ''), s.name || '', cny));
    });
    // 理财收益（已合并进 total_cny）。代码列与持仓明细对齐；旧快照不含 code 时按产品名回查当前产品。
    wts.forEach((w) => {
      const code = w.code || codeByName[w.name] || '';
      const cny = (typeof w.pnl_cny === 'number') ? w.pnl_cny : 0;
      wealthCNY += cny;
      lines.push(line('wealth', code ? calCurSym(w.currency) + code : '<span class="u-muted">—</span>', w.name || '', cny));
    });
    rows = lines.length
      ? '<div class="cal-detail-wrap"><table class="cal-detail-tbl"><thead><tr><th>代码</th><th>名称</th><th class="num">盈亏 (CNY)</th></tr></thead><tbody>' + lines.join('') + '</tbody></table></div>'
      : '<p class="u-muted">无明细。</p>';
  } catch (e) { rows = '<p class="u-danger">明细解析失败</p>'; }
  const dayRate = (rec.base_cny && rec.base_cny > 0) ? (rec.total_cny / rec.base_cny * 100) : null;
  $('#calModalBody').innerHTML = `
    <div id="calSumRow" class="u-row u-wrap u-gap-6 u-mb-3">
      <div><div class="cal-sub">盈亏 (CNY)</div><div class="value ${clsPnl(v)}">${fmtPnl(v)}</div></div>
      <div><div class="cal-sub">收益率</div><div class="value ${dayRate == null ? '' : clsPnl(dayRate)}">${dayRate == null ? '—' : (dayRate >= 0 ? '+' : '') + dayRate.toFixed(2) + '%'}</div></div>
      <div><div class="cal-sub">权益盈亏 (CNY)</div><div class="value ${clsPnl(equityCNY)}">${fmtPnl(equityCNY)}</div></div>
      <div><div class="cal-sub">理财盈亏 (CNY)</div><div class="value ${clsPnl(wealthCNY)}">${fmtPnl(wealthCNY)}</div></div>
      ${CAL_NAV_HTML}
    </div>${rows}`;
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

// 方案 16 · AI 设置按需加载：首次进入 AI 页 / 打开聊天面板时才拉，之后复用同一个 Promise。
// 用 Promise 而不是布尔标记，避免「连点两次」并发发两轮请求。
let aiSettingsPromise = null;
function ensureAiSettings() {
  if (!aiSettingsPromise) aiSettingsPromise = loadAISettings().catch(() => {});
  return aiSettingsPromise;
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

// ── API Key 掩码（方案 9）────────────────────────────────────────────────
// 已保存的 Key 一律不回显明文：输入框只用于「覆盖写入」，未填时 placeholder 显示
// sk-****abcd（保留前 3 位协议前缀 + 后 4 位）。目的是让多人共用一台机器 / 投屏时
// 无法从 DOM 里翻出完整 Key（DevTools 搜 sk- 只会命中掩码）。
const maskKey = (k) => {
  const s = String(k || '').trim();
  if (!s) return '';
  // 服务端 /api/ai/settings 已经只回掩码（****abcd），原样展示，别再套一层
  if (s.startsWith('****')) return s;
  if (s.length <= 8) return '****';
  return s.slice(0, 3) + '****' + s.slice(-4);
};
// 当前选中模型中「库里已存」的 Key（仅内存，供保存时判断是否被改动；不写回 DOM）
let aiKeyStored = '';

function selectModel(i) {
  aiModelIdx = i;
  const m = aiCfg.models[i];
  if (!m) return;
  $('#ai_cfg_name').value = m.name || '';
  $('#ai_model').value = m.model || 'deepseek-v4-pro';
  // 方案 9：绝不把 api_key 写进 input.value（写了就等于明文回显）
  const inp = $('#ai_apikey');
  const key = String(m.api_key || '').trim();
  aiKeyStored = key;
  inp.value = '';
  inp.type = 'password';
  inp.placeholder = key ? maskKey(key) + '（已保存，留空不改）' : 'sk-...';
  const btn = $('#ai_toggleKey');
  if (btn) btn.textContent = key ? '重填' : '填写';
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
  // 方案 9：输入框为空 = 用户没打算改，保留原 Key；只有真填了新值才覆盖。
  const typed = $('#ai_apikey').value.trim();
  if (typed) m.api_key = typed;
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
    // 方案 9：保存后立刻把输入框复位（清空 + placeholder 换成新的掩码），
    // 保证「刚输入的明文」不会继续留在 DOM 里。
    selectModel(aiModelIdx);
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
// 方案 9：原来是「显示 / 隐藏」明文切换，一点就把完整 Key 摊在屏幕上。
// 改为「重填」：清空输入框、切到明文输入态等新值，保存后覆盖写入，全程不回读旧值。
$('#ai_toggleKey').onclick = () => {
  const inp = $('#ai_apikey');
  const btn = $('#ai_toggleKey');
  if (inp.type === 'password') {
    inp.value = '';                       // 旧值本来就不在框里，这里只是把可能刚输入的内容也清掉
    inp.type = 'text';
    inp.placeholder = aiKeyStored ? '输入新的 API Key（保存后覆盖原值）' : 'sk-...';
    btn.textContent = '隐藏';
    inp.focus();
  } else {
    inp.type = 'password';
    inp.placeholder = aiKeyStored ? maskKey(aiKeyStored) + '（已保存，留空不改）' : 'sk-...';
    btn.textContent = aiKeyStored ? '重填' : '填写';
  }
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
    $('#confirmMsg').textContent = `将导入：${counts}${extra.length ? '；' + extra.join(' / ') : ''}。同名记录自动跳过？`;
    $('#confirmModal').hidden = false;
  } catch (err) { toast(humanizeErr(null, err, '文件解析失败')); }
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
  if (!r.ok) { $('#histChartBody').innerHTML = '<p class="u-danger">' + humanizeErr(r, null, '加载失败') + '</p>'; return; }
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
    // 尚未建仓（份额为 0）的净值日：盈亏金额 / 累计盈亏不计算也不展示，只留净值供回溯。
    // buy_date 常被填早于实际首笔买入，若照算会把建仓前的净值涨跌显示成持仓盈亏。
    const held = x.held !== false;
    const pct = x.day_pnl_pct;
    // 未建仓行：涨跌幅是净值自身涨跌（行情属性，保留），但没有前一快照基准时置「—」
    const noPct = pct == null || isNaN(pct) || (!held && !pct);
    const pctTxt = noPct ? '—' : ((pct >= 0 ? '+' : '') + pct.toFixed(2) + '%');
    const pctCls = noPct ? 'flat' : clsPnl(pct);
    const day = x.day_pnl || 0;
    const tot = x.total_pnl || 0;
    const naTd = '<td class="num" title="该日尚未建仓，不计盈亏">—</td>';
    // 净值·股价固定 4 位小数（基金净值与股价均需 4 位精度，整数位后不足补零）
    const navTxt = (x.close == null || isNaN(x.close)) ? '—' : Number(x.close).toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return '<tr>'
      + '<td>' + esc(x.date) + (held ? '' : '<span class="hist-nav-na" title="该日尚未建仓">未建仓</span>') + '</td>'
      + '<td class="num">' + navTxt + '</td>'
      + '<td class="num ' + pctCls + '">' + pctTxt + '</td>'
      + (held ? '<td class="num ' + clsPnl(day) + '">' + (day >= 0 ? '+' : '') + cur + fmt(day) + '</td>' : naTd)
      + (held ? '<td class="num ' + clsPnl(tot) + '">' + (tot >= 0 ? '+' : '') + cur + fmt(tot) + '</td>' : naTd)
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
      } catch (e) { toast(humanizeErr(null, e, '撤销失败')); b.disabled = false; }
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
  } catch (e) { toast(humanizeErr(null, e)); }
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
  // 未建仓的净值日不进曲线：它们没有盈亏，画上去会把建仓前那段压成一条贴零轴的假线
  const pts = (d.series || []).filter((x) => x.held !== false);
  drawPnlCurve(pts, cur, d.markers || [], ci, d.closed_info || null, mode);
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

// 应用入口：认证先行，无有效会话时进入认领 / 配对闸门
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
  // 定投计划：日历 + 向下箭头（「每期买入」）。最初画成日历 + 加号，16px 下内部加号只剩
  // 2px、读不出来；改箭头后「按日期投入」的语义在工具栏尺寸下才立得住。
  dca: '<rect x="4" y="6.5" width="16" height="13" rx="2"/><path d="M8 4.2v3M16 4.2v3M4 10.2h16"/><path d="M12 12.4v4.6"/><path d="M9.8 14.8 12 17l2.2-2.2"/>',
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

// 设置页面（2026-10-29 两次瘦身）：只剩外观主题 / 收支分类 / 数据管理。
// 绑定设备 → #/devices，通知推送 → #/notify，AI 设置 → #/ai，三块由右上角个人菜单直达。
async function showSettingsView() {
  $('#holdingsView').hidden = true;
  $('#assetView').hidden = true;
  $('#settingsView').hidden = false;
  await loadFinCatSettings(); // 收支分类：自定义分类编辑
  loadBackupStatus();         // 方案 1：自动备份状态（不阻塞设置页渲染，失败静默隐藏）
  // 区块层错落上浮：设置页是常驻静态 DOM（分组不随数据重渲染），
  // 三个语义分组依次入场即可。
  playRiseIn($('#settingsView'), '.settings-group', 60);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 方案 1 · 自动备份状态：纯展示一行小字（上次备份时间 · 份数 · 目录）。
// 服务端每日 03:10 用 VACUUM INTO 出一份热备快照，启动时补跑当天缺的那份，
// 保留最近 30 份 + 每月 1 号永久保留。这里只读，不提供触发按钮。
async function loadBackupStatus() {
  const box = document.getElementById('backupStatus');
  if (!box) return;
  try {
    const r = await api('/api/backup/status');
    if (!r.ok) { box.hidden = true; return; }
    const d = await r.json();
    const count = Number(d.count) || 0;
    if (!count) {
      box.className = 'backup-status is-stale';
      box.innerHTML = '<span class="bs-dot"></span>还没有备份文件：服务端每日 03:10 自动备份，保留最近 30 份 + 每月 1 号那份额外保留';
      box.hidden = false;
      return;
    }
    // 超过 36 小时视为过期（日备 + 半天容差）：颜色转警示，但不弹任何提示
    const t = d.last_at ? new Date(String(d.last_at).replace(' ', 'T')) : null;
    const stale = !t || (Date.now() - t.getTime() > 36 * 3600e3);
    box.className = 'backup-status' + (stale ? ' is-stale' : '');
    box.innerHTML = '<span class="bs-dot"></span>'
      + `上次备份：${esc(d.last_at || '—')} · 共 ${count} 份`
      + (stale ? ' · <b>超过 36 小时未备份</b>' : '')
      + (d.dir ? ` · <span class="bs-dir">${esc(d.dir)}</span>` : '');
    box.hidden = false;
  } catch (_) {
    box.hidden = true;   // 老版本服务端没有该接口：不显示，不报错
  }
}

// AI 设置（低频）：模型与提示词 / MCP 参数两个子页签，原「设置页第 ③ 组」整块搬来
async function showAiView() {
  $('#aiView').hidden = false;
  await ensureAiSettings(); // 模型 / 模板 / MCP 参数回填（首次进入才拉，之后走缓存）
  playRiseIn($('#aiView'), '.settings-group', 60);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 绑定设备（高频）：当前账本 / 设备列表 / 加设备 / 邀请家人 / 操作 PIN
async function showDevicesView() {
  $('#devicesView').hidden = false;
  await loadAuthDevices();
  playRiseIn($('#devicesView'), '.settings-group', 60);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 通知推送（高频常切）：推送频率 / 待还款提醒 / 钉钉 / 邮箱渠道
async function showNotifyView() {
  $('#notifyView').hidden = false;
  await loadNotifySettings();
  playRiseIn($('#notifyView'), '.settings-group', 60);
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
    toast('MCP 设置已保存 · HTTP 模式需重启 MCP 服务生效', 'ok');
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
// 弹框底部按钮成对：只有一枚按钮（保存 / 确认 / 我已抄下…）时，在它左侧补一枚
// 无图标的「取消」，点击即关闭弹框。孤零零一枚主按钮在右下角，用户想退出只能去点
// 右上角 ✕ 或遮罩，不符合常见弹框习惯。
// 注意：只在「恰好一枚按钮」时补，已有取消/返回两枚以上的不动；补过打标记，
// 反复打开同一弹框不会越补越多。动态生成按钮的弹框由下面的 observer 兜。
function ensureModalCancel() {
  document.querySelectorAll('.modal .modal-actions').forEach((a) => {
    if (a.dataset.cancelAdded === '1') return;
    const btns = [...a.querySelectorAll('button')].filter((b) => !b.hidden);
    if (btns.length !== 1) return;
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'btn';
    c.textContent = '取消';
    c.dataset.modalCancel = '1';
    a.insertBefore(c, btns[0]);
    a.dataset.cancelAdded = '1';
  });
}
// 打开弹框时才生成按钮的（如动态渲染的确认区），靠观察 hidden 属性变化补位。
// 只监听属性、不监听 childList：表格重渲染频繁，childList 会把这里拖成热点。
let _mcRaf = 0;
const _mcObs = new MutationObserver(() => {
  if (_mcRaf) return;
  _mcRaf = requestAnimationFrame(() => { _mcRaf = 0; injectModalClose(); ensureModalCancel(); });
});
_mcObs.observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
ensureModalCancel();
document.addEventListener('click', (e) => {
  // 补出来的「取消」：走与右上角 ✕ 完全相同的关闭路径（存在的副作用如收起悬停浮框一并生效）
  const c = e.target.closest('[data-modal-cancel]');
  if (c) {
    const m = c.closest('.modal');
    if (!m) return;
    const x = m.querySelector('.card-close');
    if (x) x.click(); else m.hidden = true;
    return;
  }
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
  // 骨架占位：资产页要拉 /api/asset/overview + /api/asset/sources 两个往返，
  // 等待期原本整页空白 → 内容突然满屏。铺一组与真实布局同形的占位。
  const assetBody = $('#assetTabBody');
  if (assetBody && !assetBody.children.length) {
    assetBody.innerHTML = '<div class="skeleton-block sk-tabs"></div>'
      + '<div class="skeleton-block sk-cards"></div>'
      + '<div class="skeleton-block sk-table"></div>';
  }
  try {
    const r = await api('/api/asset/overview');
    if (!r.ok) { toast(humanizeErr(r, null, '资产总览加载失败'), 'err'); return; }
    assetData = await r.json();
    await loadSourcesCache();
    renderAssetTab();
  } catch (e) {
    toast(humanizeErr(null, e, '加载失败'));
    return;
  }
  // 任何一次资产变动后，重渲染当前可见的视图：
  // - 资产页（上面的 renderAssetTab 已处理）
  // - 投资页（持仓/理财/存款/平仓）只要 #holdingsView 可见就整体重渲染，由其内部按 homeSection
  //   决定当前显示哪一区块。
  const hv = document.getElementById('holdingsView');
  if (hv && !hv.hidden) renderFiltered();
  // 首页仪表盘（净资产 / 资产分布条含理财段）若可见也一并刷新
  const hm = document.getElementById('homeView');
  if (hm && !hm.hidden) renderHomeDashboard();
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

  body.innerHTML = `
    <!-- 视图切换条提到页面第一位（2026-11-02，与投资页统一）：
         原顺序是「KPI 卡片 → 子 tab → 表格」，选择器排在第二块，
         用户先看到一组数字才知道这页有四个子视图。现在改成
         「子 tab → KPI 卡片 → 表格」—— 与投资页（持仓/理财/存款/平仓）
         完全一致的顺序与形态：同一个 .sub-tabs 组件、同一个下划线选中态、
         同一套右端视图级控件位。 -->
    <div class="sub-tabs" id="assetSubTabs">
      <button class="sub-tab" data-sub="accounts" type="button">账户<span class="sub-tab-count" id="assetAcctCount">${acctCount}</span></button>
      <button class="sub-tab" data-sub="cash" type="button">现金<span class="sub-tab-count">${cashLiveCount}</span></button>
      <button class="sub-tab" data-sub="flows" type="button">流水</button>
      <button class="sub-tab" data-sub="cashflow" type="button">收支</button>
      <!-- 视图级控件（一键更新余额 / 添加账户）挂在 tab 行右端，由 renderSources 填充，
           只在「账户」子视图出现。2026-11-02 由账户面板顶部的独立 .asset-toolbar 并入：
           那一行左侧恒空，只有两枚图标贴在右侧，既多占 44px 又和投资页的工具条问题同源。 -->
      <span class="sub-tabs-tools" id="assetTools"></span>
    </div>
    <!-- 顶部 4 张卡随子 tab 换内容（= 当前视图的四个关键数字）。
         眉标行（kpi-head）2026-11-02 删除：与子 tab 行重复，口径信息由各视图工具条承担。 -->
    <div class="kpi-row cols-flat asset-kpi-row" id="assetKpiRow"></div>
    <div class="asset-subpanel" data-sub="accounts" id="assetPanelAccounts"></div>
    <div class="asset-subpanel" data-sub="cash" id="assetPanelCash"></div>
    <div class="asset-subpanel" data-sub="flows" id="assetPanelFlows"></div>
    <div class="asset-subpanel" data-sub="cashflow" id="assetPanelCashflow"></div>`;

  // 账户面板、现金 / 流水 / 收支面板
  renderSources($('#assetPanelAccounts'));
  renderAssetCashPanel($('#assetPanelCash'));
  renderAssetFlowsPanel($('#assetPanelFlows'));
  renderAssetCashflowPanel($('#assetPanelCashflow'));

  // 按记住的子视图统一恢复（tab 高亮 / 面板显隐 / 顶部 4 卡）。
  // 必须在面板渲染之后：面板里会在 assetSub 匹配时补刷一次自己的 KPI 口径。
  applyAssetSub(assetSub);

  // 区块层错落上浮：资产页「切换条 → 眉标 → KPI 卡 → 表格」四块依次入场。
  // 放在 applyAssetSub 之后，否则选不到 .asset-subpanel.active。
  playRiseIn(body, '.sub-tabs, .asset-kpi-row, .asset-subpanel.active', 50);

  // 子 tab 切换绑定
  bindAssetSubTabs();
}

// 资产子视图统一入口：tab 高亮 + 面板显隐 + 顶部 4 卡一起切。
// 2026-11-02 修：原先 renderAssetTab 每次都把「账户」写死成初始态，切到顶部导航
// 再回来 tab 与 KPI 一起被重置；而 assetSub 变量还留着上次的值 —— 出现
// 「变量是现金、页面显示账户」的半状态。现在渲染与点击走同一个函数。
function applyAssetSub(sub) {
  assetSub = sub || 'accounts';
  const tabs = document.getElementById('assetSubTabs');
  if (tabs) {
    tabs.querySelectorAll('.sub-tab').forEach((x) => {
      x.classList.toggle('active', x.dataset.sub === assetSub);
    });
    const tools = tabs.querySelector('.sub-tabs-tools');
    // 账户操作（更新余额 / 添加账户）只对「账户」子视图有意义
    if (tools) tools.hidden = assetSub !== 'accounts';
  }
  renderAssetKpis(assetSub);
  document.querySelectorAll('#assetTabBody .asset-subpanel').forEach((p) => {
    p.classList.toggle('active', p.dataset.sub === assetSub);
  });
}

// 卡内分段条（2026-11-02）：一条 6px 的构成条，取代原「资产结构」折叠卡里的四组迷你图。
// 段宽走 --w（百分比）、发色走 --bc（语义 token），两者都是自定义属性 ——
// 内联样式只允许自定义属性是 check-ui 第 2 条硬门。数值读 title，副标行已经给全了口径。
function kpiSegBar(segs, label) {
  const list = (segs || []).filter((s) => Number(s.value) > 0);
  const sum = list.reduce((a, s) => a + Number(s.value), 0);
  if (!(sum > 0)) return '';
  const parts = list.map((s) => {
    const p = (Number(s.value) / sum * 100).toFixed(1);
    return '<i style="--w:' + p + '%;--bc:' + s.color + '" title="' + esc(s.name) + ' ' + yuanOfW(s.value) + ' · ' + p + '%"></i>';
  }).join('');
  return '<div class="kpi-bar" role="img" aria-label="' + label + '">' + parts + '</div>';
}

// 资产页当前子视图（顶部卡片与面板同步切换）
let assetSub = 'accounts';
// 跨页跳转的目标子视图（首页「今日待办 · 待还款」→ 资产页「收支」tab）。
// 用「记下意图 + 渲染后兑现」而不是 setTimeout 点按钮：资产页是异步渲染的，
// 定时器会在慢网络下抢跑，点到一个还没绑定事件的 tab。
let pendingAssetSub = '';

// KPI 角标图标（描边风，24×24，与全站图标字典同源）
const ASSET_KPI_ICONS = {
  bars: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.4 4 5.5 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.5-4-9s1.4-6.6 4-9Z"/>',
  card: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  wallet: '<path d="M3 8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2"/><path d="M3 8v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/><path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1.1-3 2.5 1.3 2.5 3 2.5 3 1.1 3 2.5-1.3 2.5-3 2.5-3-1.1-3-2.5"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9h9Z"/>',
  up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  scale: '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7 2 14h6L5 7Z"/><path d="M19 7l-3 7h6l-3-7Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
};
// 分段条的配色：同方向多段时用同色系的不同透明度区分（红=入账/涨，绿=支出/跌）
function segToneColor(dir, i) {
  const rgb = dir === 'income' ? 'var(--up-rgb)' : 'var(--down-rgb)';
  return 'rgba(' + rgb + ',' + Math.max(0.45, 0.95 - i * 0.25).toFixed(2) + ')';
}
// 一张 KPI 卡的 HTML（结构与财务页同壳：角标 + 标签 + 主值 + 副标 + 分段条）
function assetKpiCardHTML(c) {
  return '<div class="kpi-card density-standard">'
    + '<div class="kpi-icon ' + c.ico + '"><svg viewBox="0 0 24 24">' + ASSET_KPI_ICONS[c.icon] + '</svg></div>'
    + '<div class="kpi-label">' + c.label + '</div>'
    + '<div class="kpi-main"><div class="kpi-value' + (c.tone ? ' ' + c.tone : '') + '">' + c.value + '</div></div>'
    + (c.sub ? '<div class="kpi-sub">' + c.sub + '</div>' : '')
    + kpiSegBar(c.segs, c.label)
    + '</div>';
}

// —— 四个子视图各自的四张卡 ——
// 说明：原先这些数字是每个子视图表格上方那条 .asset-sum 合计条；现在提到顶部的固定卡位里，
// 页面从「4 张卡 → tab → 又 4 个数字 → 表格」变成「4 张卡（随 tab 换内容）→ tab → 表格」。
function assetKpiCardsAccounts() {
  const eqMV = Number(assetData?.equity?.market_value || 0);
  const wTotal = Number(assetData?.wealth?.total || 0);
  const cTotal = Number(assetData?.cash?.total || 0);
  const lTotal = Number(assetData?.liability?.total || 0);
  const totalA = eqMV + wTotal + cTotal;
  const net = totalA - lTotal;
  const regA = assetData?.region_assets || {};
  const curA = assetData?.currency_assets || {};
  const hkA = Number(regA.hk || 0), usA = Number(regA.us || 0), cnA = Number(regA.cn || 0);
  const cnyA = Number(curA.cny || 0);
  const REGION_COLORS = { cn: 'rgb(var(--cat-equity))', hk: 'rgb(var(--cat-hk))', us: 'rgb(var(--cat-us))' };
  const CUR_NAMES = { cny: '人民币', hkd: '港币', usd: '美元' };
  const CUR_COLORS = { cny: 'rgb(var(--cat-equity))', hkd: 'rgb(var(--cat-fund))', usd: 'rgb(var(--cat-cash))' };
  const catSegs = [
    { name: '持仓', value: eqMV, color: 'rgb(var(--cat-equity))' },
    { name: '理财', value: wTotal, color: 'rgb(var(--cat-fund))' },
    { name: '现金', value: cTotal, color: 'rgb(var(--cat-cash))' },
  ];
  const regionSegs = Object.entries(regA).filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([k, v]) => ({ name: (REGION_META[k] || {}).zh || k.toUpperCase(), value: Number(v), color: REGION_COLORS[k] || 'var(--text-faint)' }));
  const curSegs = Object.entries(curA).filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([k, v]) => ({ name: CUR_NAMES[k] || k.toUpperCase(), value: Number(v), color: CUR_COLORS[k] || 'var(--text-faint)' }));
  return {
    cards: [
      { ico: 'kpi-ico-equity', icon: 'bars', label: '持仓市值', value: yuanOfW(eqMV),
        sub: '占总资产 <span class="hl">' + pctOf(eqMV, totalA) + '</span>', segs: catSegs },
      { ico: 'kpi-ico-pct', icon: 'globe', label: '境外资产占比', value: pctOf(hkA + usA, totalA),
        sub: '中国内地 <span class="hl">' + pctOf(cnA, totalA) + '</span> · <span class="hl">' + yuanOfW(cnA) + '</span>', segs: regionSegs },
      { ico: 'kpi-ico-cash', icon: 'card', label: '外币资产占比', value: pctOf(totalA - cnyA, totalA),
        sub: '人民币 <span class="hl">' + pctOf(cnyA, totalA) + '</span> · <span class="hl">' + yuanOfW(cnyA) + '</span>', segs: curSegs },
      // 方案 14：净资产为正不再染红（红=涨），只在为负时用警示色
      { ico: 'kpi-ico-fund', icon: 'wallet', label: '净资产', value: yuanOfW(net), tone: net < 0 ? 'is-neg' : '',
        sub: '负债 <span class="hl">' + yuanOfW(lTotal) + '</span> · 负债率 <span class="hl">' + pctOf(lTotal, totalA) + '</span>',
        segs: [{ name: '资产', value: totalA, color: 'var(--primary)' }, { name: '负债', value: lTotal, color: 'var(--warning)' }] },
    ],
  };
}

function assetKpiCardsCash() {
  const items = (assetData?.cash?.items || []).map((it) => {
    const cur = String(it.currency || 'cny').toLowerCase();
    return { ...it, cur, cny: cnyOf(Number(it.amount || 0), cur) };
  });
  const total = Number(assetData?.cash?.total || 0) || items.reduce((a, x) => a + x.cny, 0);
  const live = items.filter((x) => Math.abs(x.cny) > 0.005).sort((a, b) => Math.abs(b.cny) - Math.abs(a.cny));
  const srcCount = new Set(live.map((x) => x.source_id)).size;
  const fxCny = items.filter((x) => x.cur !== 'cny' && x.cur !== 'rmb').reduce((a, x) => a + x.cny, 0);
  const top = live[0];
  const topPct = top && total > 0 ? Math.abs(top.cny) / total * 100 : 0;
  const CUR_NAMES = { cny: '人民币', hkd: '港币', usd: '美元' };
  const CUR_COLORS = { cny: 'rgb(var(--cat-equity))', hkd: 'rgb(var(--cat-fund))', usd: 'rgb(var(--cat-cash))' };
  // 币种构成
  const curSegs = Object.entries(items.reduce((m, x) => { m[x.cur] = (m[x.cur] || 0) + Math.abs(x.cny); return m; }, {}))
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ name: CUR_NAMES[k] || k.toUpperCase(), value: v, color: CUR_COLORS[k] || 'var(--text-faint)' }));
  // 机构分布（前 5 + 其他）
  const bySrc = new Map();
  live.forEach((x) => { const n = (x.source_name || '未指定'); bySrc.set(n, (bySrc.get(n) || 0) + Math.abs(x.cny)); });
  const srcArr = [...bySrc.entries()].sort((a, b) => b[1] - a[1]);
  const PALETTE = ['rgb(var(--cat-equity))', 'rgb(var(--cat-fund))', 'rgb(var(--cat-cash))', 'rgb(var(--cat-other))', 'rgb(var(--cat-hk))'];
  const srcSegs = srcArr.slice(0, 5).map(([n, v], i) => ({ name: n, value: v, color: PALETTE[i % PALETTE.length] }));
  if (srcArr.length > 5) {
    const rest = srcArr.slice(5).reduce((a, x) => a + x[1], 0);
    srcSegs.push({ name: '其他 ' + (srcArr.length - 5) + ' 家', value: rest, color: 'var(--text-faint)' });
  }
  const cnyCash = items.filter((x) => x.cur === 'cny' || x.cur === 'rmb').reduce((a, x) => a + Math.abs(x.cny), 0);
  return {
    cards: [
      { ico: 'kpi-ico-cash', icon: 'coin', label: '现金合计', value: yuanOfW(total),
        sub: '折 CNY · <span class="hl">' + items.length + '</span> 个子账户', segs: curSegs },
      { ico: 'kpi-ico-pct', icon: 'pie', label: '分布机构', value: srcCount + ' 家',
        sub: live.length + ' / ' + items.length + ' 个账户有余额', segs: srcSegs },
      top ? { ico: 'kpi-ico-equity', icon: 'target', label: '最集中的一处', value: topPct.toFixed(1) + '%',
        sub: esc(top.source_name || ''),
        segs: [{ name: '该机构', value: Math.abs(top.cny), color: 'rgb(var(--cat-equity))' },
               { name: '其他', value: Math.max(0, total - Math.abs(top.cny)), color: 'var(--text-faint)' }] } : null,
      { ico: 'kpi-ico-cash', icon: 'globe', label: '外币占比', value: (total > 0 ? fxCny / total * 100 : 0).toFixed(1) + '%',
        sub: 'HKD / USD 折 CNY',
        segs: [{ name: '外币', value: Math.abs(fxCny), color: 'rgb(var(--cat-cash))' },
               { name: '人民币', value: cnyCash, color: 'rgb(var(--cat-equity))' }] },
    ].filter(Boolean),
  };
}

// 流水筛选文案（表头漏斗按钮的 title 与弹框勾选项共用同一份口径）
const ASSET_FLOW_FILTER_LABEL = { in: '入账', out: '支出', dividend: '分红', trade: '买卖', invest: '投资', transfer: '转账' };
// 当前筛选口径下的流水列表（KPI 与表格必须同源，故抽成同一个函数）
function currentFlowList() {
  let list = assetFlowsCache;
  if (flowRangeDays === 0 && flowRangeCustom) {
    // 自定义区间：含首尾两天，按日期字符串比较（ISO 格式可直接比大小）
    const { from, to } = flowRangeCustom;
    list = list.filter((f) => { const d = f.date || ''; return d >= from && d <= to; });
  } else if (flowRangeDays > 0) {
    const cutoff = new Date(Date.now() - flowRangeDays * 864e5).toISOString().slice(0, 10);
    list = list.filter((f) => (f.date || '') >= cutoff);
  }
  // 多选命中任意一类即保留；空数组 = 全部类型
  if (flowTypeFilters.length) list = list.filter((f) => flowTypeFilters.some((t) => flowMatch(f, t)));
  return list;
}
// 按收支分类拆分金额（前 3 类），同方向同色不同透明度
function flowCatSegs(list, dir) {
  const m = new Map();
  list.forEach((f) => {
    const key = flowCatOf(f);
    if (finCatDir(key) !== dir) return;
    const v = cnyOf(Math.abs(Number(f.amount) || 0), normCurJS(f.currency));
    m.set(key, (m.get(key) || 0) + v);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v], i) => ({ name: finCatLabel(k), value: v, color: segToneColor(dir, i) }));
}

function assetKpiCardsFlows() {
  const list = currentFlowList();
  let inSum = 0, outSum = 0, inCnt = 0, outCnt = 0;
  list.forEach((f) => {
    const v = cnyOf(Number(f.amount) || 0, normCurJS(f.currency));
    if (v >= 0) { inSum += v; inCnt += 1; } else { outSum += -v; outCnt += 1; }
  });
  const net = inSum - outSum;
  // 卡片副标只放得下一行，自定义区间用紧凑写法（09/01–11/03），完整日期在下拉 title 里
  const rangeLabel = flowRangeDays === 0
    ? flowRangeChip().replace(/^自定义 ?/, '')
    : (flowRangeDays === 7 ? '近 7 天' : flowRangeDays === 365 ? '近 1 年' : '近 30 天');
  return {
    cards: [
      { ico: 'kpi-ico-pct', icon: 'list', label: '笔数', value: list.length + ' 笔',
        sub: rangeLabel,
        segs: [{ name: '入账', value: inCnt, color: 'rgba(var(--up-rgb),.95)' },
               { name: '支出', value: outCnt, color: 'rgba(var(--down-rgb),.95)' }] },
      { ico: 'kpi-ico-up', icon: 'up', label: '入账合计', value: yuanOfW(inSum), tone: 'up',
        sub: inCnt + ' 笔', segs: flowCatSegs(list, 'income') },
      { ico: 'kpi-ico-down', icon: 'down', label: '支出合计', value: yuanOfW(outSum), tone: 'down',
        sub: outCnt + ' 笔', segs: flowCatSegs(list, 'expense') },
      // 净额含投资买卖 / 存款 / 账户互转等内部划转，不是「收支结余」
      { ico: 'kpi-ico-fund', icon: 'scale', label: '净额', value: signedYuanW(net), tone: clsPnl(net),
        sub: '含划转 / 投资，≠ 收支结余',
        segs: [{ name: '入账', value: inSum, color: 'rgba(var(--up-rgb),.95)' },
               { name: '支出', value: outSum, color: 'rgba(var(--down-rgb),.95)' }] },
    ],
  };
}

function assetKpiCardsCashflow() {
  const plans = cashflowPlans || [];
  const rec = plans.filter((p) => p.pattern !== 'one_time');
  const one = plans.filter((p) => p.pattern === 'one_time');
  const sumOf = (type) => rec.filter((p) => p.type === type)
    .reduce((a, p) => a + cnyOf(Math.abs(Number(p.amount) || 0), normCurJS(p.currency)), 0);
  const incSum = sumOf('income');
  const expSum = sumOf('expense');
  const netSum = incSum - expSum;
  const cntOf = (type) => rec.filter((p) => p.type === type).length;
  // 按计划分类拆分
  const catSegs = (type) => {
    const m = new Map();
    rec.filter((p) => p.type === type).forEach((p) => {
      const key = p.category || (type === 'income' ? 'other_in' : 'other_out');
      const v = cnyOf(Math.abs(Number(p.amount) || 0), normCurJS(p.currency));
      m.set(key, (m.get(key) || 0) + v);
    });
    const dir = type === 'income' ? 'income' : 'expense';
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v], i) => ({ name: finCatLabel(k), value: v, color: segToneColor(dir, i) }));
  };
  return {
    cards: [
      { ico: 'kpi-ico-up', icon: 'up', label: '每月收入', value: yuanOfW(incSum), tone: 'up',
        sub: cntOf('income') + ' 项循环 · 计划口径', segs: catSegs('income') },
      { ico: 'kpi-ico-down', icon: 'down', label: '每月支出', value: yuanOfW(expSum), tone: 'down',
        sub: cntOf('expense') + ' 项循环 · 计划口径', segs: catSegs('expense') },
      { ico: 'kpi-ico-fund', icon: 'scale', label: '每月结余', value: signedYuanW(netSum), tone: clsPnl(netSum),
        sub: incSum > 0 ? '留存 ' + (netSum / incSum * 100).toFixed(0) + '%' : '收入 − 支出',
        segs: [{ name: '收入', value: incSum, color: 'rgba(var(--up-rgb),.95)' },
               { name: '支出', value: expSum, color: 'rgba(var(--down-rgb),.95)' }] },
      { ico: 'kpi-ico-pct', icon: 'list', label: '计划', value: plans.length + ' 项',
        sub: '循环 ' + rec.length + ' / 一次性 ' + one.length,
        segs: [{ name: '循环', value: rec.length, color: 'rgb(var(--cat-equity))' },
               { name: '一次性', value: one.length, color: 'rgb(var(--cat-fund))' }] },
    ],
  };
}

// 把顶部卡片区按当前子视图重画
function renderAssetKpis(sub) {
  // ⚠ 这三个节点由 renderAssetTab 的模板生成、不在 index.html 里 ——
  // 死代码门禁会把「函数里引用的 id 全部不在静态 HTML 中」判成 deadRender，
  // 所以这里从 #assetTabBody（index.html 里的容器）往下按类名取，不按 id 取。
  const host = document.getElementById('assetTabBody');
  if (!host) return;
  const row = host.querySelector('.asset-kpi-row');
  if (!row) return;
  const builder = {
    accounts: assetKpiCardsAccounts,
    cash: assetKpiCardsCash,
    flows: assetKpiCardsFlows,
    cashflow: assetKpiCardsCashflow,
  }[sub] || assetKpiCardsAccounts;
  const d = builder();
  row.innerHTML = d.cards.map(assetKpiCardHTML).join('');
}

// 资产页「流水」子面板：复用 /api/asset/flows，行内「回退」复用后端 rollback，
// 回退后原地刷新本面板（不与理财历史弹框耦合）。
// 取数区间见 flowsQuery()：预设区间按近 1 年取一次入 assetFlowsCache，
// 改「区间/类型」只是本地重渲染（paintFlows）；自定义区间则按所选起止日期重新取数。
// 资产页「现金」子面板（2026-10-29）：回答「现金都散落在哪儿」。
// 只读展示 —— 增删改仍在「账户」tab，这里不重复做管理入口。
// 排序与占比统一按折 CNY（港币/美元账户不能拿原币直接跟人民币比大小），
// 条形按「相对最大账户」归一（同资产区域卡的 cmp-bar），满格=最集中的那一处。
let cashShowZero = false;   // 零余额账户默认收起（17 个账户里常年有 6 个是 0）
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
  if (assetSub === 'cash') renderAssetKpis('cash');

  // 合计条已上提为顶部 4 张卡（renderAssetKpis('cash')），这里不再重复一遍。
  let html = '';

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

// 预设区间统一按「近 1 年」取数：三个预设里最长的是 365 天，取 180 天会让「近 1 年」
// 实际只显示半年（历史遗留）。自定义区间则按用户选的起止日期取，不受这个窗口限制。
const FLOWS_FETCH_DAYS = 365;
function flowsQuery() {
  const fmtD = (d) => d.toISOString().slice(0, 10);
  if (flowRangeDays === 0 && flowRangeCustom) {
    const { from, to } = flowRangeCustom;
    return { start: from, end: to, key: 'c:' + from + ':' + to };
  }
  const end = new Date();
  const start = new Date(end.getTime() - FLOWS_FETCH_DAYS * 864e5);
  return { start: fmtD(start), end: fmtD(end), key: 'd' + FLOWS_FETCH_DAYS };
}

// 按当前区间取数（缓存命中就直接用）。返回 false 表示请求失败。
async function ensureAssetFlows() {
  const q = flowsQuery();
  if (assetFlowsKey === q.key) return true;
  const r = await api('/api/asset/flows?start=' + q.start + '&end=' + q.end);
  if (!r.ok) return false;
  const d = await r.json();
  assetFlowsCache = (d.flows || []).slice().sort((a, b) => a.date < b.date ? 1 : -1);
  assetFlowsKey = q.key;
  return true;
}

async function renderAssetFlowsPanel(body) {
  if (!body) return;
  // 区间变了才显示「加载中」，否则切筛选条件时闪一下很吵
  if (assetFlowsKey !== flowsQuery().key) body.innerHTML = '<p class="u-muted">加载中…</p>';
  let ok = false;
  try { ok = await ensureAssetFlows(); } catch (_) { ok = false; }
  if (!ok) { body.innerHTML = '<p class="u-muted">流水加载失败</p>'; return; }
  paintFlows(body);
}

// 流水类型的纯文本（分类徽标之外还要写「理财存入 / 加仓付款」这类动作名时用）。
// 唯一真源仍是 flowTypeTagRaw 的 switch，这里只把标签壳剥掉，不另抄一份映射。
const flowTypePlain = (f) => flowTypeTagRaw(f).replace(/<[^>]*>/g, '');

// 资产页流水单行（原型 a-timeline）：左轨道圆点（涨红跌绿、0 变动中性灰）、
// 标题 = 关联标的/账户名，第二行 = 日期 · 账户 · 说明，右侧金额与回退。
// 表格里「类型」那一列不再单独占列：流水说明本身就以类型词开头（「理财存入 xxx｜…」），
// 只有说明为空时才把它补进第二行，避免同一句动作在同一行里出现两次。
function flowTlRow(f, latest) {
  const amt = Number(f.amount) || 0;
  const cls = clsPnl(amt);
  const dir = amt > 0 ? 'in' : (amt < 0 ? 'out' : 'neutral');
  const title = f.ref_name || f.name || flowTypePlain(f) || '—';
  const acct = f.name && f.name !== title ? f.name : '';
  const note = String(f.note || '').trim() || flowTypePlain(f);
  const meta = [acct, note].filter(Boolean).join(' · ');
  // 金额取绝对值再拼符号：负数直接拼会变成「−¥-4,380」双负号
  const amtTxt = amt === 0 ? moneyCurW(0, f.currency) : (amt > 0 ? '+' : NEG) + moneyCurW(Math.abs(amt), f.currency);
  const undoBtn = f.snapshot ? '' : actBtn('undo', 'data-afrb="' + f.id + '"', '回退该笔资金变动', { cls: 'tl-undo' });
  return '<div class="tl-row' + (latest ? ' latest' : '') + '">' +
    '<span class="tl-rail"><span class="tl-dot ' + dir + '"></span></span>' +
    '<div class="tl-body">' +
      '<div class="tl-line1"><span class="tl-title" title="' + esc(title) + '">' + esc(title) + '</span>' +
        finCatBadge(flowCatOf(f)) + flowSnapshotTag(f) + flowSourceTag(f.source) + '</div>' +
      '<div class="tl-meta"><span class="tl-when" title="' + esc(flowDateTitle(f)) + '">' + esc(fmtFlowDate(f.date)) + '</span>' +
        '<span class="tl-sep"></span>' +
        '<span class="tl-note" title="' + esc(meta) + '">' + esc(meta) + '</span></div>' +
    '</div>' +
    '<span class="tl-amt ' + cls + '">' + amtTxt + '</span>' +
    '<span class="tl-act">' + undoBtn + '</span>' +
    '</div>';
}

// 资产页流水：区间下拉 + 类型筛选都在工具条（列表已无表头，漏斗不再挂 th）。
function paintFlows(body) {
  if (!body) return;
  const list = currentFlowList();

  // 合计条已上提为顶部 4 张卡（renderAssetKpis('flows')），这里不再重复一遍。
  // 类型筛选中时按钮直接写出已选类型，比只给漏斗图标 + 小圆点更容易读懂。
  const picked = flowTypeFilters.map((k) => ASSET_FLOW_FILTER_LABEL[k]).filter(Boolean);
  const filterTitle = picked.length ? '筛选类型：' + picked.join('、') : '筛选流水类型';
  const filterBtn = '<button type="button" class="flow-filter-btn' + (picked.length ? ' active' : '') + '" id="flowTypeFilterBtn" title="' + esc(filterTitle) + '" aria-label="' + esc(filterTitle) + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>' +
    '<span>' + esc(picked.length ? picked.join('、') : '类型') + '</span></button>';

  // 区间下拉：三个预设 + 「自定义」；自定义生效时直接把所选区间写在选项上，
  // 不必为了「现在到底筛的哪一段」再点开弹框确认。
  let html = '<div class="holding-toolbar"><div class="tl-tools">' +
    '<select class="sort-select" id="flowRange"' + (flowRangeDays === 0 ? ' title="' + esc(flowRangeText()) + '"' : '') + '>' +
    toolbarOpt('7', '近7天', flowRangeDays === 7) +
    toolbarOpt('30', '近30天', flowRangeDays === 30) +
    toolbarOpt('365', '近1年', flowRangeDays === 365) +
    toolbarOpt('0', flowRangeDays === 0 ? flowRangeChip() : '自定义…', flowRangeDays === 0) +
    '</select>' + filterBtn + '</div></div>';

  const emptyText = flowTypeFilters.length ? '当前筛选类型下暂无资金流水，点「类型」可改回全部。' : '该时间段内暂无资金流水。';
  const rows = list.length
    ? list.map((f, i) => flowTlRow(f, i === 0)).join('')
    : '<div class="tl-empty">' + emptyText + '</div>';

  html += '<div class="card asset-flow-card"><div class="flow-tl">' + rows + '</div></div>';
  body.innerHTML = html;

  body.querySelectorAll('[data-afrb]').forEach((b) => { b.onclick = () => rollbackAssetFlow(Number(b.dataset.afrb), body); });
  const filterBtnEl = body.querySelector('#flowTypeFilterBtn');
  if (filterBtnEl) filterBtnEl.onclick = () => openFlowFilterModal(body);
  const rng = body.querySelector('#flowRange');
  if (rng) {
    rng.onchange = async () => {
      const v = parseInt(rng.value, 10);
      // parseInt('0') 是 0（不是 NaN），不能沿用 `|| 30` 兜底，否则「自定义」会被读回 30 天
      if (Number.isNaN(v)) return;
      if (v === 0) { openFlowRangeModal(body, rng); return; }
      flowRangeDays = v;
      flowRangeCustom = null;
      await renderAssetFlowsPanel(body);   // 从自定义切回预设要重新取数（缓存区间不同）
    };
  }
  // 顶部卡片与列表同源：筛选 / 区间一变，卡片里的合计跟着变
  if (assetSub === 'flows') renderAssetKpis('flows');
}

// 区间的人话描述（KPI 副标 / 下拉 title / 自定义 chip 共用一套口径）
function flowRangeText() {
  if (flowRangeDays === 0 && flowRangeCustom) {
    return flowRangeCustom.from + ' 至 ' + flowRangeCustom.to;
  }
  return flowRangeDays === 7 ? '近 7 天' : flowRangeDays === 365 ? '近 1 年' : '近 30 天';
}
// 下拉里「自定义」那一项的文字：同年只写 月/日（09/01–11/03），跨年补年份（25/09/01–26/03/01）
function flowRangeChip() {
  const c = flowRangeCustom;
  if (!c) return '自定义…';
  const f = c.from || '';
  const t = c.to || '';
  const lbl = f.slice(0, 4) === t.slice(0, 4)
    ? f.slice(5).replace('-', '/') + '–' + t.slice(5).replace('-', '/')
    : f.slice(2).replace(/-/g, '/') + '–' + t.slice(2).replace(/-/g, '/');
  return '自定义 ' + lbl;
}

// 自定义时间段弹框：选起止日期后按该区间重新取数（不走 180 天全量缓存的过滤，
// 否则选到一年前会被静默筛成空列表）。
function openFlowRangeModal(body, sel) {
  const modal = $('#flowRangeModal');
  if (!modal) return;
  const from = document.getElementById('flowRangeFrom');
  const to = document.getElementById('flowRangeTo');
  const err = document.getElementById('flowRangeErr');
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  // 再次打开时回填上次选过的区间，改一半就取消也不丢；首次打开默认「近 30 天」
  const cur = flowRangeCustom || { from: monthAgo, to: today };
  from.value = cur.from;
  to.value = cur.to;
  from.max = today;
  to.max = today;
  // 程序化赋值不会触发 input/change，原生日期占位的 .date-empty 得手动同步一次，
  // 否则输入框里日期已填好、画面却是一片空白（只剩右侧日历图标）
  syncDateHint(from);
  syncDateHint(to);
  if (err) err.textContent = '';
  modal.hidden = false;
  const close = () => {
    modal.hidden = true;
    // 取消时把下拉恢复原状：否则它会停在「自定义」上，而列表其实还是旧区间
    if (sel) sel.value = String(flowRangeDays);
  };
  modal.onclick = (e) => { if (e.target === modal) close(); };
  document.getElementById('flowRangeCancel').onclick = close;
  document.getElementById('flowRangeApply').onclick = async () => {
    const f = from.value;
    const t = to.value;
    if (!f || !t) { if (err) err.textContent = '请把起始和结束日期都选上'; return; }
    if (f > t) { if (err) err.textContent = '起始日期不能晚于结束日期'; return; }
    flowRangeDays = 0;
    flowRangeCustom = { from: f, to: t };
    modal.hidden = true;
    await renderAssetFlowsPanel(body);
  };
}

// 表头漏斗打开的筛选弹框：勾选为草稿，点「完成」才落到 flowTypeFilters 并重绘
function openFlowFilterModal(body) {
  const modal = $('#flowFilterModal');
  if (!modal) return;
  const boxes = [...modal.querySelectorAll('#flowFilterChecks input[type="checkbox"]')];
  boxes.forEach((cb) => { cb.checked = flowTypeFilters.includes(cb.value); });
  modal.hidden = false;
  modal.onclick = (e) => { if (e.target === modal) modal.hidden = true; };
  modal.querySelector('#flowFilterReset').onclick = () => { boxes.forEach((cb) => { cb.checked = false; }); };
  modal.querySelector('#flowFilterApply').onclick = () => {
    flowTypeFilters = boxes.filter((cb) => cb.checked).map((cb) => cb.value);
    modal.hidden = true;
    paintFlows(body);
  };
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
  // 计划数据是异步加载的，加载完再刷新顶部卡片（当前视图是「收支」时才刷）
  if (assetSub === 'cashflow') renderAssetKpis('cashflow');
  body.innerHTML = `
    <div class="asset-cashflow">
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
    msg: '记一笔反向流水冲正账户余额，原记录保留。',
    okText: '回退', danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/asset/flows/cash/' + id + '/rollback', { method: 'POST' });
        if (!r.ok) { let m = '回退失败'; try { const dd = await r.json(); if (dd && dd.error) m = dd.error; } catch (_) {} toast(m, 'err'); return; }
        toast('已回退该笔资金变动', 'ok');
        assetFlowsCache = [];
        assetFlowsKey = '';
        await renderAssetFlowsPanel(body);
      } catch (e) { toast(humanizeErr(null, e, '回退失败')); }
    }
  });
}

// 资产子 tab 切换（原型下划线样式，无滑动白块）
function bindAssetSubTabs() {
  const tabs = document.getElementById('assetSubTabs');
  if (!tabs) return;
  tabs.querySelectorAll('.sub-tab').forEach((b) => {
    b.onclick = () => applyAssetSub(b.dataset.sub);
  });
  // 兑现跨页跳转意图（首页待办点击「待还款」）：tab 绑定完成后才能安全 click()
  if (pendingAssetSub) {
    const want = pendingAssetSub;
    pendingAssetSub = '';
    const t = tabs.querySelector(`.sub-tab[data-sub="${want}"]`);
    if (t) t.click();
  }
}

function assetDel(type, id) {
  const msg = {
    source: '删除该来源账户。关联记录会保留账户名快照。',
    wealth: '删除该理财及其每日录入记录。',
    cash: '删除该现金子账户。',
    liability: '删除该负债记录。',
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
  let html = '';
  // 2026-11-02（信息密度整改 A3）：账户面板顶部原有一条 4 项摘要条
  // （账户 N 个 / 总资产 / 负债 / 净资产），其中后三项与页面顶部 4 张 KPI 卡完全重复，
  // 第一项「账户 N 个」已由 #assetAcctCount 徽标承担 —— 整条删除，账户表直接顶到内容区顶部。
  // 「总资产 = 持仓 + 理财 + 现金」的拆分口径（全部折算 CNY）随 kpi-head 一并删除（2026-11-02）。
  // 账户操作（添加账户 / 一键更新余额）2026-11-02 由账户面板顶部那条独立工具条
  // 改挂到子 tab 行右端的 #assetTools：那一行左侧恒空、只有两枚图标贴右，
  // 与投资页 #investToolbar 是同一个毛病（控件孤立 + 白占一行）。
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
          `<td class="share" style="--p:${Math.max(0, share).toFixed(1)}%;--pn:${(Math.min(100, Math.max(0, share)) / 100).toFixed(4)}">${share.toFixed(1)}%</td>` +
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
  // 账户操作按钮挂到子 tab 行右端（#assetTools）：只在「账户」子视图出现，
  // 切到现金 / 流水 / 收支 时由 bindAssetSubTabs 隐藏。
  // ⚠ 容器不存在时（资产页尚未渲染，renderSources 被别处提前调用）必须跳过绑定，
  // 否则 $('#addSourceBtn') 取到 null 再挂 onclick 会直接抛 TypeError。
  const tools = document.getElementById('assetTools');
  if (tools) {
    tools.innerHTML = `<button class="btn icon-btn asset-add" id="balanceSyncBtn" type="button" title="一键更新余额" aria-label="一键更新余额">${actIcon('refresh')}</button><button class="btn icon-btn asset-add" id="addSourceBtn" title="添加账户" aria-label="添加账户">${actIcon('plus')}</button>`;
    $('#addSourceBtn').onclick = () => openAssetSourceModal(null);
    // 「添加收支 / 添加流水」按钮已删（2026-10-22，与首页重复）：入口见首页财务视图「＋ 新增收支计划」与「快捷功能 · 记收入/记支出」
    $('#balanceSyncBtn').onclick = () => openBalanceSyncModal();
  }
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
  // 非交易日 / 尚未录入当日快照时，今日收益恒为 ¥0 且整张表涨跌幅全 0.00%，
  // 极易被当成「数据出错」或「今天真的一分没赚」。取在持产品的最新快照日期提示截至日。
  const todayStr = new Date().toISOString().slice(0, 10);
  const latestSnap = live.reduce((a, p) => ((p.snap_date || '') > a ? p.snap_date : a), '');
  const snapStale = !!latestSnap && latestSnap < todayStr;
  const staleHint = snapStale ? `净值截至 ${latestSnap.slice(5)}` : '';

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
        <div class="kpi-main"><div class="kpi-value ${clsPnl(day)}">${signedCur(day, 'cny')}</div></div>
        <div class="kpi-sub">${staleHint ? `<span class="u-muted">${esc(staleHint)}</span>` : `占市值 <span class="hl">${dayPct}</span>`}</div>
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
  // 分类筛选（全部 / 净值型 / 其他）已于 2026-11-02 下线：它筛的是「有没有录净值」这一条实现细节，
  // 不是用户会用来找产品的维度；而且筛完只剩一行时反而让人以为数据丢了。
  const w = [...((assetData.wealth || {}).products || [])].sort((a, b) => Number(b.amount) - Number(a.amount)); // 按金额从大到小
  // 「更新理财持仓」已上移到首页顶部操作条（#wealthSnapBtn）；「添加理财」收敛到顶部 #addBtn。
  // 「批量刷新净值」按钮及前端逻辑已删（2026-10-19）：自动/批量刷新净值尚未支持，后端接口保留。
  // 计数（理财（N））已上提到切换条徽标，此处不再单独渲染头，避免与切换条分两行。
  let html = '';
  if (!w.length) html += emptyStateHTML({ icon: EMPTY_ICONS.wallet, title: '还没有理财', desc: '添加第一笔理财，每日净值自动录入并计入资产全景。', btnLabel: '＋ 添加第一笔理财', btnAttrs: 'data-empty-add="wealth"' });
  else html += renderWealthTable(w);
  body.innerHTML = html;
  bindGroupCollapse(body, wealthCollapsed);
  body.querySelectorAll('[data-act="edit-wealth"]').forEach((b) => b.onclick = () => openWealthModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="wealth-hist"]').forEach((b) => b.onclick = () => openWealthHistory(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="wealth-nav"]').forEach((b) => b.onclick = () => openWealthNavModal(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="enable-wealth"]').forEach((b) => b.onclick = () => enableWealthRow(Number(b.dataset.id)));
  body.querySelectorAll('[data-act="reduce-wealth"]').forEach((b) => b.onclick = () => openReduceWealth(Number(b.dataset.id)));
  bindCopyDelegation(body);
}

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
  // 单表（2026-11-02）：与持仓页同一结构 —— 1 个 thead + 每账户一个 tbody + 组头摘要行。
  // 旧版是「每账户一张表 + 一套表头」，三个账户就是三个 thead，12 列被压到平均 116px。
  // 「今日收益」整列无内容时整列不渲染（同持仓口径，见 spec §3.3）：一列 0 不携带信息。
  // 「净值」同理：非净值型产品（靠每日录入金额累计收益）nav 恒为 0，整列破折号不如不给。
  const dayIdleAll = arr.every((g) => g.items.every((p) => amtIsZero(p.today_pnl)));
  const navIdleAll = arr.every((g) => g.items.every((p) => !(Number(p.nav) > 0)));
  const colCount = 6 + (navIdleAll ? 0 : 1) + (dayIdleAll ? 0 : 1);
  const thead = '<thead><tr>'
    + '<th>名称</th>'
    + (navIdleAll ? '' : '<th class="num wt-nav" title="最新净值（净值型产品才有；每日收益按净值差计算）">净值</th>')
    + '<th class="num wt-mv" title="当前金额（原币种；悬停查看折合人民币。顶部 KPI 的理财市值是折 CNY 合计）">金额</th>'
    + '<th class="num wt-share" title="占该账户同币种理财合计比例，不是占理财总额的比例">占该组</th>'
    + (dayIdleAll ? '' : '<th class="num wt-day" title="今日收益：按最新净值与上一净值之差计算">今日收益</th>')
    + '<th class="num wt-cum" title="累计收益金额（上）/ 累计收益率（下）">累计收益</th>'
    + '<th class="num wt-ann" title="单利年化 = 累计收益 ÷ 当前持仓 ÷ 持有天数 × 365（当前持仓近似本金）">年化</th>'
    + '<th class="ht-act">操作</th>'
    + '</tr></thead>';
  let body = '';
  for (const g of arr) {
    // 组内多币种时不合计（不同币种不能直接相加），组头显式说明而不是显示误导性的 ¥0
    const curs = [...new Set(g.items.map((p) => p.currency || 'cny'))];
    const single = curs.length === 1;
    const sum = single ? wCny(g.items[0], g.items.reduce((s, p) => s + Number(p.amount || 0), 0)) : 0;
    const dayPnl = single ? g.items.reduce((s, p) => s + Number(p.today_pnl || 0), 0) : 0;
    const cumPnl = single ? g.items.reduce((s, p) => s + Number(p.cum_pnl || 0), 0) : 0;
    // 累计收益率 = 累计收益 ÷ 实际投入本金（≈ 当前市值 − 累计收益）；多币种组无单一口径，置 0 由分段展示
    const cumRate = (single && (sum - cumPnl) > 0) ? cumPnl / (sum - cumPnl) * 100 : 0;
    const gDayIdle = amtIsZero(dayPnl);
    // 多币种组按各自币种分段列出，避免只给一个合计让用户以为漏了其他币种的金额
    const mixLines = single ? '' : curs.map((c) => {
      const same = g.items.filter((p) => (p.currency || 'cny') === c);
      const amt = same.reduce((s, p) => s + Number(p.amount || 0), 0);
      return `<span${wanTitle(amt, curSymbolJS(c))}>${curSymbolJS(c)}${fmtWan(amt)}</span>`;
    }).join(' + ');
    const mixDayLines = single ? '' : curs.map((c) => {
      const same = g.items.filter((p) => (p.currency || 'cny') === c);
      const d = same.reduce((s, p) => s + Number(p.today_pnl || 0), 0);
      return `<span${wanTitle(d, curSymbolJS(c))}>${fmtWanPnl(d, c)}</span>`;
    }).join('　');
    const mixCumLines = single ? '' : curs.map((c) => {
      const same = g.items.filter((p) => (p.currency || 'cny') === c);
      const m = same.reduce((s, p) => s + Number(p.cum_pnl || 0), 0);
      return `<span${wanTitle(m, curSymbolJS(c))}>${fmtWanPnl(m, c)}</span>`;
    }).join('　');
    const collapsed = wealthCollapsed.has(String(g.sid));
    body += `<tbody class="hold-grp wealth-grp${collapsed ? ' is-collapsed' : ''}" data-sid="${g.sid}">`
      + `<tr class="h-grp" role="button" tabindex="0" title="${collapsed ? '展开' : '收起'}该账户明细">`
      + `<td colspan="${colCount}"><div class="hg-in">`
      + `<span class="hg-l"><i class="hg-chev">▾</i>${srcLogo(g.sid)}<b class="hg-name">${esc(g.name)}</b><em class="hg-count">${g.items.length} 款</em></span>`
      + `<span class="hg-r">`
      + `<span class="hg-stat" title="${single ? '该账户理财合计市值（折合人民币）' : '该账户下存在多种币种，按币种分段列出，不折算合计'}"><i>${single ? '合计' : '多币种'}</i><b${single ? wanTitle(sum, '¥') : ' class="mix-amt"'}>${single ? '¥' + fmtWan(sum) : mixLines}</b></span>`
      + (dayIdleAll ? '' : `<span class="hg-stat hg-stat-day" title="${single ? '该账户今日收益合计' : '多币种账户按币种分段：今日收益，不跨币种相加'}"><i>今日</i><b class="${gDayIdle ? '' : clsPnl(dayPnl)}">${single ? (gDayIdle ? '—' : fmtWanPnl(dayPnl)) : mixDayLines}</b></span>`)
      + `<span class="hg-stat hg-stat-cum" title="${single ? '该账户累计收益合计（括号内为累计收益率）' : '多币种账户按币种分段：累计收益，不跨币种相加'}"><i>累计收益</i><b class="${single ? clsPnl(cumPnl) : 'mix-amt'}"${single ? wanTitle(cumPnl, '¥') : ''}>${single ? fmtWanPnl(cumPnl) + ` <small>(${pct(cumRate)})</small>` : mixCumLines}</b></span>`
      + `</span></div></td></tr>`
      + g.items.map((p) => renderWealthRow(p, wPool, dayIdleAll, navIdleAll)).join('')
      + '</tbody>';
  }
  return `<div class="holdings-sheet"><div class="subtable-wrap"><table class="asset-table holdings-table wealth-table">${thead}${body}</table></div></div>`;
}

// 理财行模板（2026-11-02 单表）：与持仓行同一节奏 —— 名称格两行（主名 + 代码/天数），
// 数值格「主值 + 副行」，占比列走「裸数字 + 细条」，操作列吸右。
function renderWealthRow(p, wPool, hideDay, hideNav) {
  const arch = !!p.archived;
  const pnl = Number(p.today_pnl) || 0;
  const cum = Number(p.cum_pnl) || 0;
  const wKey = (p.source_id || 0) + ':' + normCur(p.currency);
  const pool = wPool[wKey] || 0;
  const wPos = pool > 0 ? (Number(p.amount) || 0) / pool * 100 : 0;
  const days = Number(p.holding_days || 0);
  const base = Number(p.amount || 0);
  // 单利年化 = 累计收益 ÷ 当前持仓 ÷ 持有天数 × 365（当前持仓近似本金；已清仓/无天数不计算）
  const ann = (!arch && days > 0 && base > 0.005) ? (cum / base) / days * 365 * 100 : null;
  const dayIdle = amtIsZero(pnl);
  const meta = [];
  if (p.code) meta.push(`<span class="hm-code">${esc(p.code)}</span>`);
  if (days > 0) meta.push(`${days} 天`);
  if (arch) meta.push('已清仓停用');
  const navTip = p.nav_updated_at ? ('净值更新于 ' + esc(p.nav_updated_at)) : '尚未录入净值（净值型产品可在 App 查看后点「净值」录入，或由基金码自动抓取）';
  return `<tr${arch ? ' class="wealth-archived"' : ''}>
    <td class="h-name">
      <div class="hn-top">
        <span class="cur-badge">${curSymbolJS(p.currency)}</span>
        <span class="hn-name" title="${esc(p.name)}${arch ? '（已清仓停用：保留历史收益，可启用或删除）' : ''}">${esc(p.name)}</span>
        <!-- 名称格不再放行内操作（2026-11-02 修）：持仓名称格放的是「修改 / 技术分析」——
             这两个操作只在名称格有，操作列没有，属于补位；理财照抄过来却是「编辑 / 刷新净值」，
             与操作列的前两枚完全重复，悬停时一行出现 6 个图标、其中 2 个是同一个动作。 -->
      </div>
      <div class="hn-meta">
        <span class="hn-meta-t">${meta.join(' · ')}</span>
        <!-- 手机端：表头与操作列收起，改用元信息行右侧图标（.hn-acts-m 桌面隐藏）。
             只放三枚高频操作，净值录入在手机上走「编辑」弹框内入口。 -->
        <span class="hn-acts-m">
          ${actBtn('edit', `data-act="edit-wealth" data-id="${p.id}"`, '编辑')}
          ${actBtn('nav', `data-act="wealth-nav" data-id="${p.id}"`, '刷新净值')}
          ${arch ? actBtn('refresh', `data-act="enable-wealth" data-id="${p.id}"`, '启用') : actBtn('exit', `data-act="reduce-wealth" data-id="${p.id}"`, '赎回')}
        </span>
      </div>
    </td>
    ${hideNav ? '' : `<td class="num wt-nav" title="${navTip}">${p.nav > 0 ? fmt(p.nav) : ZERO_DASH}</td>`}
    <td class="num wt-mv"${wanTitle(p.amount || 0, curSymbolJS(p.currency))}>${moneyCurW(p.amount || 0, p.currency)}</td>
    <td class="num share wt-share${pool > 0 ? '' : ' is-empty'}"${pool > 0 ? ` style="--p:${wPos.toFixed(1)}%;--pn:${(wPos / 100).toFixed(4)}"` : ''} title="占该账户同币种理财合计比例${pool > 0 ? ' ' + wPos.toFixed(2) + '%' : ''}">${pool > 0 ? wPos.toFixed(2) + '%' : '—'}</td>
    ${hideDay ? '' : `<td class="num wt-day">${dayIdle ? ZERO_DASH : `<span class="${clsPnl(pnl)}"${wRmbTitle(p, pnl)}>${signedMoneyW(pnl, p.currency)}</span>`}</td>`}
    <td class="num wt-cum">
      <div class="${clsPnl(cum)}"${wRmbTitle(p, cum)}>${signedMoneyW(cum, p.currency)}</div>
      <div class="hp-sub ${clsPnl(cum)}">${p.cum_return_rate == null ? '—' : pct(p.cum_return_rate)}</div>
    </td>
    <td class="num wt-ann ${ann === null ? '' : clsPnl(ann)}">${ann === null ? '—' : pct(ann)}</td>
    <td class="row-act-cell ht-act"><span class="ht-acts">
      ${actBtn('edit', `data-act="edit-wealth" data-id="${p.id}"`, '编辑')}
      ${actBtn('hist', `data-act="wealth-hist" data-id="${p.id}"`, '每日盈亏')}
      ${actBtn('nav', `data-act="wealth-nav" data-id="${p.id}"`, '刷新净值')}
      ${arch ? actBtn('refresh', `data-act="enable-wealth" data-id="${p.id}"`, '启用') : actBtn('exit', `data-act="reduce-wealth" data-id="${p.id}"`, '赎回')}
    </span></td>
  </tr>`;
}

// 理财行内操作：重新启用已清仓停用的产品（恢复参与每日持仓录入）
async function enableWealthRow(id) {
  try {
    const r = await api(`/api/asset/wealth/${id}/enable`, { method: 'POST' });
    if (!r.ok) { let m = '启用失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
    await loadAsset();
    toast('已重新启用，可在「更新理财持仓」里继续录入', 'ok');
  } catch (err) { toast(humanizeErr(null, err)); }
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
    msg: `${warn}确认永久删除「${name}」？其每日盈亏与审计记录一并删除。`,
    okText: '删除', danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/asset/wealth/' + id, { method: 'DELETE' });
        if (!r.ok) { let m = '删除失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
        await loadAsset();
        toast(`已永久删除「${name}」`, 'ok');
      } catch (err) { toast(humanizeErr(null, err)); }
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

let wealthCum0 = 0; // 编辑理财打开时的累计收益原值（PUT 时回传，防止被清零）
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
    if (!r.ok) { toast(humanizeErr(r, null, '加载失败'), 'err'); return; }
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
  } catch (err) { toast(humanizeErr(null, err)); }
}

// 流水金额符号的口径：一律是「这笔流水让该现金账户余额增加还是减少」。
// 「存款存入 −¥1.11万」最容易被读反（存入怎么会是减号），挂到类型标签上悬停可解。
const FLOW_SIGN_TIP = '金额符号 = 该笔流水对现金账户余额的影响：− 账户减少，+ 账户增加';
function cashFlowTypeTag(f) {
  return flowTypeTagRaw(f).replace('<span class="flow-tag', '<span title="' + FLOW_SIGN_TIP + '" class="flow-tag');
}
function flowTypeTagRaw(f) {
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
    case 'loan':
      // 购物/消费类负债（一次性支出「产生新负债」）本质是新增负债，不是融资借入，
      // 标签与颜色都不按收入处理（标签来自后端 listFlows 带出的负债类型）。
      if (typeof f === 'object' && /购物|消费/.test(f.liab_type || '')) return '<span class="flow-tag manual">购物负债</span>';
      return '<span class="flow-tag in">借入</span>';
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
  // 类型字段不在表单录入；编辑时保留原记录的 type（存量数据不动），新增为空
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
  const dir = sign === 'out' ? 'out' : 'in';
  flowSetSign(dir);
  // 标题跟着方向走：首页「记收入」「记支出」两个入口复用同一弹框，
  // 标题都叫「添加流水」时用户无法确认自己点的是哪一个。
  const ft = document.getElementById('flowModalTitle');
  if (ft) ft.textContent = dir === 'in' ? '记一笔收入' : '记一笔支出';
  $('#flowModal').hidden = false;
}

// 还款到负债：负债账户并入「子账户」下拉（前缀 l:），由后端按账户类型自动记。
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
      // 购物/消费类负债记「新增负债」，别把刷卡赊账叫成「增加贷款」
      const isShopping = /购物|消费/.test((l.type || ''));
      const typeLabel = isLoan ? (isShopping ? '新增负债' : '增加贷款') : '还款';
      html += `<tr><td>${esc(f.date)}</td><td><span class="adj-tag ${isLoan ? 'buy' : 'sell'}">${typeLabel}</span></td>
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
    msg: '记一笔反向流水冲正账户余额，原记录保留。',
    okText: '回退', danger: true,
    onOk: async () => {
      const kindParam = (wealthHistKind === 'liab') ? 'liability' : 'cash';
      try {
        const r = await api('/api/asset/flows/' + kindParam + '/' + id + '/rollback', { method: 'POST' });
        if (!r.ok) { let m = '回退失败'; try { const d = await r.json(); if (d && d.error) m = d.error; } catch (_) {} toast(m, 'err'); return; }
        toast('已回退该笔资金变动', 'ok');
        await reloadFlowHistory();
      } catch (err) { toast(humanizeErr(null, err)); }
    },
  });
}
async function reloadFlowHistory() {
  if (!flowHistCtx) return;
  const url = (flowHistCtx.kind === 'liab') ? ('/api/asset/liabilities/' + flowHistCtx.id + '/flows') : ('/api/asset/cash/' + flowHistCtx.id + '/flows');
  try {
    const r = await api(url);
    if (!r.ok) { toast(humanizeErr(r, null, '刷新失败'), 'err'); return; }
    const d = await r.json();
    wealthHistLiab = d.liability || null;
    wealthHistAllRows = d.flows || [];
    renderWealthHistTable();
  } catch (err) { toast(humanizeErr(null, err)); }
}

// 拉取每日盈亏 + 审计快照（合并为单表）。resetRange=true 重置为默认近90天（打开弹框用）；
// resetRange=false 保留当前范围与已加载条数（撤销/删除后原地刷新用）
async function loadWealthHistData(id, resetRange) {
  const [rh, ra] = await Promise.all([
    api('/api/asset/wealth/' + id + '/history'),
    api('/api/asset/wealth/' + id + '/audit'),
  ]);
  if (!rh.ok) { toast(humanizeErr(rh, null, '加载失败'), 'err'); return false; }
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
  } catch (err) { toast(humanizeErr(null, err)); }
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
    } catch (e) { toast(humanizeErr(null, e, '保存失败')); }
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
    // 止盈止损的独立渠道开关（缺字段时按「开」处理，与后端 loadNotifyConfig 的默认一致）
    const al = d.alerts || {};
    $('#alInbox').checked = al.inbox !== false;
    $('#alDingtalk').checked = al.dingtalk !== false;
    $('#alEmail').checked = al.email !== false;
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
    // 止盈止损独立渠道：不带上这一段后端会沿用旧值（不会重置），但显式传更符合「所见即所存」
    alerts: {
      inbox: $('#alInbox').checked,
      dingtalk: $('#alDingtalk').checked,
      email: $('#alEmail').checked,
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
    try { const d = await r.json(); m = d.error || (humanizeErr(r, null, '测试失败')); } catch (_) { m = humanizeErr(r, null, '测试失败'); }
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
  } catch (err) { toast(humanizeErr(null, err, '保存失败')); }
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
      let msg = humanizeErr(r, null, '技术分析失败');
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
const KL_SUB_H = 60; // 副图指标 viewBox 高（MACD/KDJ/BOLL/RSI 共用；与 CSS .kl-sub svg 高度同比例）
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
  const W = KL_W, H = 224, OX = 2, AXW = 0; // 取消右侧 Y 轴占位带，主图与副图共享全宽 x 轴（等宽对齐）；H 与 CSS .kline-mini svg 高度 208px 同比例（208/224≈156/168），加高不变形
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
// 主题勾选态与「模式」同步：日间/夜间/跟随系统三项互斥，只有当前模式打勾。
// 注意判据是 themeMode（模式）而非 dataset.theme（实际主题）—— 跟随系统时 dataset.theme 是解析结果，
// 拿它比对会把勾打到「日间/夜间」上。
function syncAcctTheme() {
  document.querySelectorAll('#acctPop .acct-item[data-act="theme"]').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === themeMode);
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
    const next = THEME_MODES.includes(item.dataset.theme) ? item.dataset.theme : 'dark';
    localStorage.setItem('pf_theme', next);
    applyTheme(next); // 内部已同步菜单勾选态，无需再调 syncAcctTheme
  } else if (act === 'settings') {
    closeAcctMenu();
    navigate('settings');
  } else if (act === 'ai') {
    closeAcctMenu();
    navigate('ai');
  } else if (act === 'devices') {
    closeAcctMenu();
    navigate('devices');
  } else if (act === 'notify') {
    closeAcctMenu();
    navigate('notify');
  } else if (act === 'manage-users') {
    closeAcctMenu();
    openUserSheet();
  } else if (act === 'logout') {
    closeAcctMenu();
    askLogout();
  }
}
// 退出登录二次确认（2026-10-29）：点错的代价不是重新输密码，而是本机 session 被吊销、
// 从「已接入设备」消失。所以必须显式确认，并把接回方式写清楚。
// 2026-11-02 文案更正：实例设了操作 PIN 就能用 PIN 重新登录，不再只能去另一台设备出码。
function askLogout() {
  const owner = authState && authState.role === 'owner';
  openConfirm({
    title: '退出登录',
    msg: owner
      ? '退出后本机会从「已接入设备」中移除，主设备身份会转给其他在线设备。之后可用操作 PIN 或配对码重新接回。确定退出？'
      : '退出后本机会从「已接入设备」中移除。之后可用操作 PIN（若已设置）重新接回，或让其他设备出配对码。确定退出？',
    okText: '退出登录',
    danger: true,
    onOk: doLogout,
  });
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

// ===== 止盈止损提醒（右上角铃铛 + 下拉面板，2026-10-31）=====
// 数据来自 /api/alerts（服务端收盘后扫描已落库的事件）。轮询只负责「把已有结果拉下来」，
// 60s 一次且仅在页面可见时执行 —— 扫描在服务端做，前端不需要关心行情。
let alertCache = [];
let alertUnread = 0;
let alertBusy = false;

// 类型 → 标签文案与配色类。止盈走涨色（红）、止损走跌色（绿），与全站口径一致。
function alertKindMeta(kind) {
  switch (kind) {
    case 'take_profit': return { cls: 'tp', text: '止盈' };
    case 'stop_loss': return { cls: 'sl', text: '止损' };
    case 'trailing': return { cls: 'tp', text: '移动止盈' };
    case 'psych': return { cls: 'psych', text: '心理价位' };
    case 'fee_window': return { cls: 'fee', text: '费率' };
    default: return { cls: '', text: '提醒' };
  }
}
function alertDayOf(ts) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const day = String(ts || '').slice(0, 10);
  return day === today ? '今天' : day;
}
function renderAlertList() {
  const box = document.getElementById('alertList');
  if (!box) return;
  if (!alertCache.length) {
    // 空态给一个「一键启用」入口：默认不启用是为了不擅自给存量持仓挂机械止损，
    // 但让用户逐个进弹框开关 20 只也不现实，所以留一个显式确认的批量入口。
    box.innerHTML = '<div class="alert-empty">暂无提醒<br>在持仓「高级选项 → 止盈止损」开启后，<br>收盘价触达价位时会出现在这里'
      + '<br><br><button class="btn primary btn-sm" type="button" data-act="apply-all">为全部持仓套用均衡方案</button></div>';
    return;
  }
  let html = '';
  let lastDay = '';
  alertCache.forEach((a) => {
    const day = alertDayOf(a.created_at);
    if (day !== lastDay) {
      html += `<div class="alert-day">${esc(day)}</div>`;
      lastDay = day;
    }
    const m = alertKindMeta(a.kind);
    html += `<div class="alert-item${a.read_at ? '' : ' unread'}" role="button" tabindex="0" data-aid="${a.id}" data-hid="${a.holding_id}">`
      + '<span class="alert-dot" aria-hidden="true"></span>'
      + '<span class="alert-main">'
      + `<span class="alert-t">${esc(a.title || a.name || '提醒')}</span>`
      + `<span class="alert-b">${esc(a.body || '')}</span>`
      + '<span class="alert-meta">'
      + `<span class="alert-tag ${m.cls}">${m.text}</span>`
      + `<span class="alert-name">${esc(a.name || '')}</span>`
      + `<span class="alert-time">${esc(String(a.created_at || '').slice(11, 16))}</span>`
      + '</span></span>'
      + `<button class="alert-del" type="button" data-del="${a.id}" title="删除该提醒" aria-label="删除该提醒">`
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>'
      + '</button></div>';
  });
  box.innerHTML = html;
}
function updateAlertBadge(n) {
  const b = document.getElementById('alertBadge');
  if (!b) return;
  const v = Number(n) || 0;
  b.hidden = v <= 0;
  b.textContent = v > 99 ? '99+' : String(v);
}
async function loadAlerts() {
  if (alertBusy) return;
  alertBusy = true;
  try {
    const r = await api('/api/alerts?limit=50');
    if (r.ok) {
      const d = await r.json();
      alertCache = d.items || [];
      alertUnread = Number(d.unread) || 0;
      updateAlertBadge(alertUnread);
      renderAlertList();
    }
  } catch (_) { /* 未登录/离线：保留旧数据，不打断主流程 */ }
  alertBusy = false;
}
async function markAlertsRead(ids) {
  try {
    const r = await api('/api/alerts/read', { method: 'POST', body: JSON.stringify({ ids: ids || [] }) });
    if (r.ok) {
      const d = await r.json();
      updateAlertBadge(d.unread);
      if (!ids || !ids.length) alertCache = alertCache.map((a) => ({ ...a, read_at: a.read_at || '1' }));
      else alertCache = alertCache.map((a) => (ids.includes(a.id) ? { ...a, read_at: a.read_at || '1' } : a));
      renderAlertList();
    }
  } catch (_) { /* 忽略 */ }
}
// 删除单条提醒记录（列表右侧悬停出现的垃圾桶图标）
async function deleteAlertRecord(aid) {
  try {
    const r = await api('/api/alerts/' + encodeURIComponent(aid), { method: 'DELETE' });
    if (!r.ok) throw new Error('删除失败');
    const d = await r.json();
    alertCache = alertCache.filter((a) => String(a.id) !== String(aid));
    alertUnread = Number(d.unread) || 0;
    updateAlertBadge(alertUnread);
    renderAlertList();
    toast('已删除该提醒', 'ok');
  } catch (e) {
    toast(humanizeErr(null, e, '删除提醒失败'), 'err');
  }
}
function confirmDeleteAlert(aid) {
  const a = alertCache.find((x) => String(x.id) === String(aid));
  openConfirm({
    title: '删除提醒',
    msg: `确定删除「${a && (a.title || a.name) ? (a.title || a.name) : '该提醒'}」？删除后不再出现在提醒列表。`,
    okText: '删除',
    danger: true,
    onOk: () => deleteAlertRecord(aid),
  });
}
// 打开提醒详情：列表里只有两行摘要，完整正文与触发价位在这里看全。
// 「看详情」即视为已读，但只在真的未读时才写库，避免每次点开都发一次请求。
function openAlertDetail(aid) {
  const a = alertCache.find((x) => String(x.id) === String(aid));
  const modal = document.getElementById('alertDetailModal');
  if (!a || !modal) return;
  const m = alertKindMeta(a.kind);
  const tag = document.getElementById('alertDetailTag');
  if (tag) { tag.className = 'alert-tag' + (m.cls ? ' ' + m.cls : ''); tag.textContent = m.text; }
  const time = document.getElementById('alertDetailTime');
  if (time) time.textContent = a.created_at || '';
  const title = document.getElementById('alertDetailTitle');
  if (title) title.textContent = a.title || a.name || '提醒';
  const text = document.getElementById('alertDetailText');
  if (text) text.textContent = a.body || '';
  const grid = document.getElementById('alertDetailGrid');
  if (grid) {
    const num = (v) => Number(v) || 0;
    const px = (v) => (num(v) > 0 ? num(v).toFixed(4) : '');
    const cells = [];
    if (num(a.price) > 0) cells.push(['现价', px(a.price), '']);
    if (num(a.target) > 0) cells.push(['触发价位', px(a.target), '']);
    if (num(a.cost) > 0) cells.push(['成本价', px(a.cost), '']);
    if (num(a.cost) > 0) {
      const p = num(a.pnl_pct);
      cells.push(['相对成本', (p >= 0 ? '+' : '') + p.toFixed(2) + '%', p >= 0 ? 'up' : 'down']);
    }
    // 只有场外基金才有赎回费。is_fund 由后端按持仓现算（不是事件里的冗余字段），
    // 光看 fee_pct>0 不够：历史事件存着旧值，股票也会中招。
    if (a.is_fund && num(a.fee_pct) > 0) cells.push(['赎回费率', num(a.fee_pct).toFixed(2) + '%', '']);
    grid.innerHTML = cells.map((c) => `<div class="risk-cell${c[2] ? ' ' + c[2] : ''}">`
      + `<div class="risk-cell-k">${c[0]}</div>`
      + `<div class="risk-cell-v">${c[1]}</div></div>`).join('');
  }
  const go = document.getElementById('alertDetailGo');
  if (go) { go.dataset.hid = a.holding_id || ''; go.hidden = !a.holding_id; }
  modal.hidden = false;
  if (!a.read_at) markAlertsRead([a.id]);
}
function closeAlertDetail() {
  const modal = document.getElementById('alertDetailModal');
  if (modal) modal.hidden = true;
}
// 点提醒 → 标记已读 + 跳到投资页对应持仓（不自动滚动定位：持仓行按分组重排，跳错更糟）
function openAlertTarget(hid) {
  closeAlertPop();
  markAlertsRead([]);
  if (hid) navigate('invest');
}
// 一键套用：给还没设过方案的持仓挂上「均衡」自动定价（已启用的不动），二次确认防误触
function applyAllRiskPlans() {
  openConfirm({
    title: '套用均衡方案',
    msg: '将为所有尚未启用的持仓按「均衡」预设开启自动止盈止损（止损 12% / 移动止盈回撤 8%），已设置过的持仓不受影响。价位由收盘价与技术波动算出，触发后只提醒、不自动卖出。',
    okText: '全部启用',
    onOk: async () => {
      try {
        const r = await api('/api/alerts/apply-all?preset=balanced', { method: 'POST' });
        if (!r.ok) { toast(humanizeErr(r, null, '套用失败'), 'err'); return; }
        const d = await r.json();
        toast(`已为 ${d.updated || 0} 只持仓启用止盈止损`, 'ok');
        scanAlertsNow();
      } catch (e) { toast(humanizeErr(null, e, '套用失败')); }
    },
  });
}
async function scanAlertsNow() {
  try {
    const r = await api('/api/alerts/scan', { method: 'POST' });
    if (!r.ok) { toast(humanizeErr(r, null, '检查失败'), 'err'); return; }
    const d = await r.json();
    const n = (d.items || []).filter((x) => x.inserted).length;
    toast(n > 0 ? `新增 ${n} 条提醒` : '已检查，暂无新提醒', 'ok');
    await loadAlerts();
  } catch (e) { toast(humanizeErr(null, e, '检查失败')); }
}
function openAlertPop() {
  const pop = document.getElementById('alertPop');
  const btn = document.getElementById('alertBellBtn');
  if (!pop) return;
  pop.hidden = false;
  if (btn) btn.setAttribute('aria-expanded', 'true');
  loadAlerts();
}
function closeAlertPop() {
  const pop = document.getElementById('alertPop');
  const btn = document.getElementById('alertBellBtn');
  if (pop) pop.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
function bindAlertBell() {
  const menu = document.getElementById('bellMenu');
  const pop = document.getElementById('alertPop');
  const btn = document.getElementById('alertBellBtn');
  if (!menu || !pop || !btn) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    if (pop.hidden) openAlertPop(); else closeAlertPop();
  };
  pop.addEventListener('click', (e) => e.stopPropagation());
  pop.addEventListener('click', (e) => {
    const del = e.target.closest('.alert-del');
    if (del) { e.stopPropagation(); confirmDeleteAlert(del.dataset.del); return; }
    const item = e.target.closest('.alert-item');
    if (item) { openAlertDetail(item.dataset.aid); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'scan') scanAlertsNow();
    else if (act.dataset.act === 'apply-all') applyAllRiskPlans();
    else if (act.dataset.act === 'notify') { closeAlertPop(); navigate('notify'); }
  });
  // 键盘可达：条目 Enter / Space 打开详情（删除按钮是真实 button，自带键盘行为）
  pop.addEventListener('keydown', (e) => {
    if (e.target.closest('.alert-del')) return;
    const item = e.target.closest('.alert-item');
    if (item && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openAlertDetail(item.dataset.aid);
    }
  });
  const readAll = document.getElementById('alertReadAll');
  if (readAll) readAll.onclick = (e) => { e.stopPropagation(); markAlertsRead([]); };
  // 详情弹框：关闭 / 查看持仓 / 点遮罩关闭 / Esc 关闭
  const dlg = document.getElementById('alertDetailModal');
  const dClose = document.getElementById('alertDetailClose');
  const dGo = document.getElementById('alertDetailGo');
  if (dClose) dClose.onclick = closeAlertDetail;
  if (dGo) dGo.onclick = () => {
    const hid = Number(dGo.dataset.hid) || 0;
    closeAlertDetail();
    openAlertTarget(hid);
  };
  if (dlg) dlg.addEventListener('click', (e) => { if (e.target === dlg) closeAlertDetail(); });
  document.addEventListener('click', (e) => {
    if (pop.hidden) return;
    // 点详情弹框内部不算「点到面板外」，否则看详情时列表会跟着消失
    if (dlg && !dlg.hidden && dlg.contains(e.target)) return;
    if (!menu.contains(e.target)) closeAlertPop();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (dlg && !dlg.hidden) { closeAlertDetail(); return; }
    closeAlertPop();
  });
  // 首次拉一次未读数（角标要在首屏就正确，而不是等用户点开面板）
  loadAlerts();
  setInterval(() => { if (!document.hidden) loadAlerts(); }, 60000);
}

// ===== 持仓级止盈止损方案（高级选项内，2026-10-31）=====
// 价位一律由后端算（ATR / MA60 / BOLL / 近 60-120 日高低点全在 Go 侧），前端只收集参数与展示结果。
// 理由：同一套定价公式在 JS 与 Go 各写一遍，只要有一处口径差 0.01，用户看到的价和实际触发的价就不是同一个。
// C 类份额才有「持有越短赎回费越高」这件事：7 天档最常见，其次 7+30 两档、30 天单档。
// A 类买入时已付申购费，时间层面不再有赎回费（晨星那套 158 天临界是含申购费的总成本口径），
// 所以 A 类与股票/场内 ETF 一起归到「无赎回费」，不做时间阶梯。
const RISK_FEE_TIERS = {
  c7: [{ days: 0, rate: 1.5 }, { days: 7, rate: 0 }],
  c7_30: [{ days: 0, rate: 1.5 }, { days: 7, rate: 0.5 }, { days: 30, rate: 0 }],
  c30: [{ days: 0, rate: 0.5 }, { days: 30, rate: 0 }],
  none: [{ days: 0, rate: 0 }],
};
// 旧 plan 存的是 c / a 两个键，读回来时映射到新模板，避免下拉显示空白
const RISK_FEE_ALIAS = { c: 'c7', a: 'none' };
let riskIsFund = true; // 当前弹框里的持仓是否有赎回费概念（渲染表单时由持仓类别决定）
let riskPreviewTimer = null;
let riskBusy = false;

function riskNum(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
// 收集当前表单里的方案（保存持仓时随 payload 一起提交，避免再开一个保存通道）
function riskCollectPlan() {
  const pick = (id, dft) => { const el = document.getElementById(id); return el && el.value ? el.value : dft; };
  const rawFee = pick('f_risk_fee', 'c7');
  // 非基金（股票 / 场内 ETF）一律落「无赎回费」，隐藏的下拉里残留值不能带进库
  const feeKey = riskIsFund ? (RISK_FEE_ALIAS[rawFee] || rawFee) : 'none';
  return {
    mode: pick('f_risk_mode', 'off'),
    preset: pick('f_risk_preset', 'balanced'),
    stop_price: riskNum('f_risk_stop'),
    tp1: riskNum('f_risk_tp1'),
    tp2: riskNum('f_risk_tp2'),
    tp3: riskNum('f_risk_tp3'),
    trailing_pct: riskNum('f_risk_trail'),
    break_even_pct: 0, // 留给预设默认（后端 >0 才覆盖），不在 UI 暴露
    psych_price: riskNum('f_risk_psych'),
    psych_note: (document.getElementById('f_risk_psych_note') || {}).value || '',
    fee_class: feeKey,
    fee_tiers: RISK_FEE_TIERS[feeKey] || RISK_FEE_TIERS.c7,
    fee_override: riskIsFund ? riskNum('f_risk_fee_override') : 0,
    repeat: pick('f_risk_repeat', 'once'),
    cooldown_min: 0,
    max_per_day: 3,
  };
}
function riskPctText(target, base) {
  if (!(target > 0) || !(base > 0)) return '';
  const p = ((target - base) / base) * 100;
  return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
}
// 渲染结果区（只读价卡 / 手动输入框）。manual 模式不重建 DOM，否则用户打字时输入框会被替换掉。
function renderRiskResult(mode, basis, ev, plan) {
  const grid = document.getElementById('riskGrid');
  const hint = document.getElementById('riskHint');
  if (!grid) return;
  const px = (v) => (v > 0 ? Number(v).toFixed(4) : '—');
  if (mode === 'manual') {
    if (grid.dataset.mode === 'manual') { if (hint) hint.textContent = riskHintText(basis) + noteSuffix(ev); return; }
    grid.dataset.mode = 'manual';
    const v = (x) => (x > 0 ? Number(x).toFixed(4) : '');
    const cell = (id, k, dflt, tone, note) => `<div class="risk-cell${tone ? ' ' + tone : ''}">`
      + `<div class="risk-cell-k">${k}</div>`
      + `<input id="${id}" type="number" step="0.0001" min="0" value="${v(dflt)}" placeholder="0.0000" oninput="debounceRiskPreview()">`
      + `<div class="risk-cell-d">${note}</div></div>`;
    grid.innerHTML = cell('f_risk_stop', '止损价', plan.stop_price || (ev && ev.stop_price), 'down', '跌破即提醒（不自动卖出）')
      + cell('f_risk_tp1', '止盈 1 · 减 1/3', plan.tp1 || (ev && ev.tp1), 'up', '第一档落袋')
      + cell('f_risk_tp2', '止盈 2 · 减 1/3', plan.tp2 || (ev && ev.tp2), 'up', '第二档落袋')
      + cell('f_risk_tp3', '止盈 3 · 尾仓', plan.tp3 || (ev && ev.tp3), 'up', '趋势尾仓/心理价位');
    if (hint) hint.textContent = riskHintText(basis) + noteSuffix(ev);
    return;
  }
  grid.dataset.mode = 'auto';
  const cost = basis ? basis.cost : 0;
  const items = [
    ['止损价', ev && ev.stop_price, ev && ev.stop_reason, 'down'],
    ['止盈 1 · 减 1/3', ev && ev.tp1, '距成本 ' + riskPctText(ev && ev.tp1, cost), 'up'],
    ['止盈 2 · 减 1/3', ev && ev.tp2, '距成本 ' + riskPctText(ev && ev.tp2, cost), 'up'],
    ['止盈 3 · 尾仓', ev && ev.tp3, '距成本 ' + riskPctText(ev && ev.tp3, cost), 'up'],
    ['移动止盈线', ev && ev.trailing_on ? ev.trailing_line : 0,
      ev && ev.trailing_on ? '自持仓期高点回撤触发' : '涨幅不足以支撑回撤止盈，仍由止损线保护', ''],
    ['距止盈 1', ev && ev.to_tp1_pct, (ev && ev.to_tp1_pct >= 0 ? '还需上涨 ' : '已越过 ') + Math.abs(Number(ev && ev.to_tp1_pct) || 0).toFixed(2) + '%', ''],
  ];
  grid.innerHTML = items.map((it) => `<div class="risk-cell${it[3] ? ' ' + it[3] : ''}">`
    + `<div class="risk-cell-k">${it[0]}</div>`
    + `<div class="risk-cell-v">${it[0].includes('距') ? (it[1] == null ? '—' : Number(it[1]).toFixed(2) + '%') : px(it[1])}</div>`
    + `<div class="risk-cell-d">${it[2] || ''}</div></div>`).join('');
  if (hint) hint.textContent = riskHintText(basis) + noteSuffix(ev);
}
function noteSuffix(ev) {
  return ev && ev.note ? ' · ' + ev.note : '';
}
function riskHintText(basis) {
  if (!basis) return '填写证券代码并保存后，才能按收盘价计算技术价位。';
  const days = basis.holding_days || 0;
  const fee = Number(basis.fee_pct) || 0;
  const atr = Number(basis.atr_pct) || 0;
  // 股票 / 场内 ETF 没有赎回费，提示里不提
  const head = basis.is_fund === false
    ? `持有 ${days} 天 · 日均波动 ${atr.toFixed(2)}%`
    : `持有 ${days} 天 · 当前赎回费 ${fee.toFixed(2)}% · 日均波动 ${atr.toFixed(2)}%`;
  let s = head;
  if (fee > 0 && basis.next_tier_days > 0) {
    s += `（再持有 ${basis.next_tier_days} 天降至 ${Number(basis.next_tier_rate).toFixed(2)}%）`;
  }
  s += basis.source === 'nav' ? ' · 基金按净值计算' : ' · 按日线收盘计算';
  return s;
}
// 控件填充（只在打开弹框时用；预览刷新只动结果区，不碰控件）
// 股票 / 场内 ETF 没有赎回费：整行隐藏费率阶梯与实际费率输入，
// 「提醒频率」由两列降为单列占满，避免右侧空出半格。
function applyRiskFeeUI() {
  const feeRow = document.getElementById('riskFeeRow');
  const overrideCell = document.getElementById('riskFeeOverrideCell');
  const extraRow = document.getElementById('riskFeeExtraRow');
  if (feeRow) feeRow.hidden = !riskIsFund;
  if (overrideCell) overrideCell.hidden = !riskIsFund;
  if (extraRow) extraRow.classList.toggle('f-row-single', !riskIsFund);
}
function renderRiskForm(plan, basis, ev, isFundFlag) {
  const modeEl = document.getElementById('f_risk_mode');
  if (!modeEl) return;
  riskIsFund = isFundFlag !== false;
  modeEl.value = plan.mode || 'off';
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('f_risk_preset', plan.preset || 'balanced');
  setVal('f_risk_trail', plan.trailing_pct > 0 ? plan.trailing_pct : '');
  setVal('f_risk_psych', plan.psych_price > 0 ? plan.psych_price : '');
  setVal('f_risk_psych_note', plan.psych_note || '');
  const feeCls = plan.fee_class || 'c7';
  setVal('f_risk_fee', RISK_FEE_ALIAS[feeCls] || feeCls);
  setVal('f_risk_fee_override', plan.fee_override > 0 ? plan.fee_override : '');
  setVal('f_risk_repeat', plan.repeat || 'once');
  applyRiskFeeUI();
  const body = document.getElementById('riskBody');
  const grid = document.getElementById('riskGrid');
  if (grid) grid.dataset.mode = ''; // 允许重建（切换模式时布局不同）
  if (body) body.hidden = modeEl.value === 'off';
  if (modeEl.value !== 'off') renderRiskResult(modeEl.value, basis, ev, plan);
}
function debounceRiskPreview() {
  if (riskPreviewTimer) clearTimeout(riskPreviewTimer);
  riskPreviewTimer = setTimeout(previewRisk, 350);
}
async function previewRisk() {
  const modeEl = document.getElementById('f_risk_mode');
  const body = document.getElementById('riskBody');
  if (!modeEl || !body) return;
  if (modeEl.value === 'off') { body.hidden = true; return; }
  body.hidden = false;
  const plan = riskCollectPlan();
  const idEl = document.getElementById('f_id');
  const orig = allHoldings.find((x) => String(x.id) === String(idEl ? idEl.value : ''));
  const payload = {
    symbol: (document.getElementById('f_symbol') || {}).value || '',
    name: (document.getElementById('f_name') || {}).value || '',
    category: selCat || 'stock',
    market: (document.getElementById('f_market') || {}).value || '',
    currency: 'cny',
    quantity: parseFloat((document.getElementById('f_quantity') || {}).value) || 0,
    cost_price: parseFloat((document.getElementById('f_cost_price') || {}).value) || 0,
    current_price: orig ? Number(orig.current_price) || 0 : 0,
    buy_date: (document.getElementById('f_buy_date') || {}).value || '',
    plan,
  };
  if (!payload.symbol || !(payload.cost_price > 0)) {
    renderRiskResult(modeEl.value, null, null, plan);
    return;
  }
  if (riskBusy) return;
  riskBusy = true;
  try {
    const r = await api('/api/risk/preview', { method: 'POST', body: JSON.stringify(payload) });
    if (r.ok) {
      const d = await r.json();
      renderRiskResult(modeEl.value, d.basis, d.eval, plan);
    }
  } catch (_) { /* 预览失败不打断表单填写 */ }
  riskBusy = false;
}
// 打开持仓弹框时载入方案（编辑态走接口拿 basis/eval，新增态给默认值）
async function loadRiskForm(h) {
  const modeEl = document.getElementById('f_risk_mode');
  if (!modeEl) return;
  const dft = { mode: 'off', preset: 'balanced', fee_class: 'c7', repeat: 'once', trailing_pct: 0, break_even_pct: 0, psych_price: 0 };
  // 新增持仓还没落库，只能按当前选中的类别判断；编辑态交给接口回显的 basis 更准
  const fund = h ? isFund(h) : selCat === 'fund';
  if (h) {
    try {
      const r = await api('/api/holdings/' + h.id + '/risk-plan');
      if (r.ok) {
        const d = await r.json();
        const flag = d.basis && typeof d.basis.is_fund === 'boolean' ? d.basis.is_fund : fund;
        renderRiskForm({ ...dft, ...(d.plan || {}) }, d.basis, d.eval, flag);
        return;
      }
    } catch (_) { /* 回落默认 */ }
  }
  renderRiskForm(dft, null, null, fund);
}
// 一次绑定：下拉/输入变化即重算预览
(function bindRiskBlock() {
  const wire = () => {
    const modeEl = document.getElementById('f_risk_mode');
    if (!modeEl || modeEl.dataset.wired) return;
    modeEl.dataset.wired = '1';
    modeEl.onchange = () => {
      const body = document.getElementById('riskBody');
      if (body) body.hidden = modeEl.value === 'off';
      const grid = document.getElementById('riskGrid');
      if (grid) grid.dataset.mode = '';
      if (modeEl.value !== 'off') previewRisk();
    };
    const presetEl = document.getElementById('f_risk_preset');
    if (presetEl) presetEl.onchange = () => {
      // 预设切换时把该档的移动止盈回撤灌进输入框（用户仍可再手改）
      const t = { steady: 6, balanced: 8, aggressive: 12 }[presetEl.value] || 8;
      const trail = document.getElementById('f_risk_trail');
      if (trail) trail.value = t;
      previewRisk();
    };
    ['f_risk_trail', 'f_risk_psych', 'f_risk_psych_note', 'f_risk_fee', 'f_risk_fee_override', 'f_risk_repeat'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.oninput = debounceRiskPreview;
    });
  };
  wire();
  document.addEventListener('DOMContentLoaded', wire);
})();

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
    // 按账本隔离的数据缓存全部作废，否则切换后复用上一账本的数据：
    // - assetFlowsCache / assetFlowsKey：资产页「流水」tab 命中缓存就不重新请求 → 一直显示旧账本流水
    // - homeRecentFlowsData / finFlowsCache：首页最新流水、财务页热力图细项
    // - cashflowPlans / cashflowDone / _planDoneCache / _fpCardYm：收支计划及按月完成态（计划 id 跨账本可能撞号）
    assetFlowsCache = [];
    assetFlowsKey = '';
    homeRecentFlowsData = [];
    finFlowsCache = [];
    homeMarqueeData = null;  // 跑马灯里的待办数据按账本隔离
    cashflowPlans = [];
    cashflowDone = {};
    for (const k in _planDoneCache) delete _planDoneCache[k];
    for (const k in _fpCardYm) delete _fpCardYm[k];
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
  } catch (e) { toast(humanizeErr(null, e, '新增失败')); }
}

let pendingClearUserId = null;
function clearUserData() {
  const curId = localStorage.getItem('pf_user');
  if (!curId) { toast('未选择账本', 'err'); return; }
  pendingClearUserId = curId;
  $('#confirmTitle').textContent = '清空当前账本数据';
  $('#confirmMsg').textContent = '清空当前账本全部数据（持仓/资产/计算器/AI配置/历史等）。';
  $('#confirmModal').hidden = false;
}

let pendingDeleteUserId = null;
let pendingDeleteName = '';
function deleteUser(id, name) {
  pendingDeleteUserId = Number(id);
  pendingDeleteName = name || '';
  const msg = document.getElementById('userDeleteMsg');
  if (msg) msg.textContent = '确认删除账本「' + name + '」及其全部数据？该账本全部数据将被清空。';
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
      toast(humanizeErr(r, null, m), 'err');
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
  } catch (e) { toast(humanizeErr(null, e, '删除失败')); }
}

// 账本切换相关 UI
(function wireUserUI() {
  // 头像按钮 -> 个人菜单（内部含「管理账本」入口打开弹框）
  bindAcctMenu();
  // 顶栏铃铛 -> 止盈止损提醒面板（未读数角标 + 60s 轮询）
  bindAlertBell();
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
let cashflowLiabilities = [];  // 编辑弹框内「关联负债」下拉用

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
}
// 计划日排序用：返回 1..31 日的数字（收支计划面板按月卡展示，月度计划取 day_of_month）
function cfSortDay(p) {
  if (p.pattern === 'one_time' && p.one_time_date) {
    const d = p.one_time_date.split('-');
    return Number(d[2]) || 1;
  }
  return Number(p.day_of_month) || 1;
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
    toast(humanizeErr(null, e));
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
  document.getElementById('cf_account_id').value = isEdit ? (p.account_id || 0) : 0;
  document.getElementById('cf_notify').checked = isEdit ? (p.notify !== 0) : true;
  document.getElementById('cf_liability_mode').value = isEdit ? (p.liability_mode || (p.type === 'expense' ? 'repay' : '')) : (type === 'expense' ? 'repay' : '');
  document.getElementById('cfModalTitle').textContent = isEdit ? '编辑收支计划' : '新建收支计划';
  document.getElementById('cfErr').textContent = '';
  await loadCashAccounts();
  setPickerHTML($('#cfCashPanel'), buildFlowPicker());
  cfSetSelection(isEdit && p.account_id ? (cashAccountsCache || []).find((x) => x.id === p.account_id) : null);
  await loadLiabilitiesForCf();
  renderCfLiabilitySelect(isEdit ? (p.liability_mode === 'incur' ? 'incur' : p.liability_id) : 0);
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
        msg: '记一笔反向流水冲正该计划产生的出入账，并清除完成记录。',
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
  // 支出一律显示「关联负债」：一次性支出也要能选还款负债，否则只能被记成新增负债
  document.getElementById('cfLiabilityWrap').style.display = isExp ? '' : 'none';
  document.getElementById('cfEndWrap').style.display = isOneTime ? 'none' : '';
  // 负债方式：仅显式选「产生新负债」才 incur（购物赊账、不扣现金），其余一律 repay（还款/账户扣款）。
  // 原「支出+一次性→incur」会让用户记还款时被当成新增负债，现金不扣、支出也不入账。
  const liabSel = document.getElementById('cf_liability_id').value;
  const liabMode = isExp ? (liabSel === 'incur' ? 'incur' : 'repay') : '';
  document.getElementById('cf_liability_mode').value = liabMode;
  // 子账户字段按方向/方式改名：支出=还款账户，产生新负债=负债归属账户，入账=入账账户
  const cap = document.getElementById('cfCashCap');
  if (cap) cap.textContent = isExp ? (liabMode === 'incur' ? '负债归属账户' : '还款账户') : '入账账户';
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
  // 显式「产生新负债」入口：一次性支出要记购物赊账（不扣现金）才选它；
  // 不选则按还款/账户扣款记账。
  let html = '<div class="ac-pick-group"><button type="button" class="ac-pick-row" data-v="incur">产生新负债（购物赊账）<span class="ac-pick-bal">不扣现金</span></button></div>';
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
    b.onclick = () => {
      const isIncur = b.dataset.v === 'incur';
      setVal(b.dataset.v, isIncur ? '产生新负债（购物赊账）' : b.textContent.trim());
      panel.hidden = true;
      syncCfForm();   // 切换负债方式会改变账户名与负债方式，立即回显
    };
  });
  const sel = (cashflowLiabilities || []).find((l) => String(l.id) === String(selId));
  if (String(selId) === 'incur') setVal('incur', '产生新负债（购物赊账）');
  else setVal(selId ? String(selId) : '0', sel ? sel.name : '不关联');
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
    notify: document.getElementById('cf_notify').checked ? 1 : 0,
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
  // 提示语（原 investToolbar 右侧的 toolbar-gain）合并到区头、排在新增按钮前
  const pending = list.filter((d) => d.status !== 'settled' && d.matured);
  const hint = pending.length
    ? '已到期待落袋 <b>' + pending.length + '</b> 笔 · 行内点「确认落袋」把本金+利息入账'
    : '共 <b>' + list.length + '</b> 笔 · 预计利息按「年利率 × 天数 / 365」估算';
  const head = `<div class="asset-toolbar"><div class="sec-actions"><span class="toolbar-gain dep-hint">${hint}</span><button class="btn icon-btn asset-add" id="depAddBtn" type="button" title="新增存款" aria-label="新增存款">${actIcon('plus')}</button></div></div>`;
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
      ? `<button class="row-act" disabled title="已落袋的存款本金+利息流水已入账，删除会破坏账目，故不可删" aria-label="已落袋不可删除">${actIcon('trash')}</button>`
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
      <td class="row-act-cell">${ops}</td>
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
  openConfirm({
    title: '删除存款',
    msg: `删除存款「${d.name}」将按提前支取处理：本金 ${curSymbolJS(d.currency)}${fmt(d.amount)} 退回账户「${d.account_name || ''}」。该操作不可撤销，确定删除？`,
    okText: '删除',
    danger: true,
    onOk: async () => {
      try {
        const r = await api('/api/asset/deposits/' + id, { method: 'DELETE' });
        if (!r.ok) { let m = '删除失败'; try { const dd = await r.json(); if (dd && dd.error) m = dd.error; } catch (_) {} toast(m, 'err'); return; }
        toast('已删除并退回本金', 'ok');
        await refreshDeposits();
        await loadAsset();
      } catch (e) { toast(humanizeErr(null, e)); }
    },
  });
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
  } catch (e) { document.getElementById('depSettleErr').textContent = humanizeErr(null, e); }
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
  // 方案 16：模型下拉依赖 /api/ai/settings，改为打开聊天面板时才拉（首屏不再带 3 个 AI/MCP 请求）
  ensureAiSettings();
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
  } catch (e) { toast(humanizeErr(null, e, '重命名失败')); }
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
    if (!r.ok) throw new Error(humanizeErr(r, null, 'HTTP ' + r.status));
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
  } catch (e) { toast(humanizeErr(null, e, '创建会话失败')); }
}

async function aiChatDelete(id) {
  const c = aiChatState.chats.find((x) => Number(x.id) === Number(id));
  openConfirm({
    title: '删除对话',
    msg: '删除对话「' + (c ? (c.title || '新对话') : id) + '」及其全部消息。',
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
      } catch (e) { toast(humanizeErr(null, e, '删除失败')); }
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
      if (e) e.textContent = d.error || (humanizeErr(r));
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
 * 定投计划（DCA）：基金 / 股票标的都可挂计划
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
  document.getElementById('dcaFeeAmount').value = p && p.fee_amount > 0 ? String(round2(p.fee_amount)) : '';
  renderDCAInterval();
  fillDCACash(p);
  syncDCAFeeField(); // 标的已选中，费率格按基金/股票切口径
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

// 标的选「＋ 新建基金…」时露出搜索框（新建只走基金搜索，股票直接选已有持仓）；切回已有标的则收起。
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

// 每期费用是一个**固定金额**，不做任何按费率的换算 ——
//   基金 → 申购费（渠道费率 × 每期金额，自己算一次填进来）
//   A 股 → 佣金（多数券商 5 元起步）+ 过户费，小额定投基本恒为 5 元
//   美股 → 多数券商零佣金，通常填 0；按比例算反而是凭空造出成本
// 所以这里只给「常见取值」的文字参考，不再提供按比例试算的入口。
function dcaFeeHint(h) {
  const cur = String((h && h.currency) || 'CNY').toLowerCase();
  if (!h || isFund(h)) return '申购费：渠道费率 × 每期金额，算一次填固定值';
  if (cur === 'usd') return '美股券商多为零佣金，通常填 0';
  if (String(h.market || '') === '沪深') return '佣金多为 5 元起步 + 过户费，小额定投基本恒为 5 元';
  return '按券商实际收取的固定费用填';
}

// 当前选中的标的；「＋ 新建基金…」(value=0) 归到基金口径
function currentDCAHolding() {
  const sel = document.getElementById('dcaHolding');
  const raw = sel ? String(sel.value) : '';
  if (!raw || raw === '0') return null;
  return (allHoldings || []).find((x) => String(x.id) === raw) || null;
}

function syncDCAFeeField() {
  const titleEl = document.getElementById('dcaFeeTitle');
  const hintEl = document.getElementById('dcaFeeHint');
  if (!titleEl || !hintEl) return;
  const h = currentDCAHolding();
  titleEl.textContent = '每期费用（' + curSymbolJS((h && h.currency) || 'CNY') + '）';
  hintEl.textContent = dcaFeeHint(h);
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
    fee_amount: parseFloat(document.getElementById('dcaFeeAmount').value) || 0,
    cash_account_id: Number(document.getElementById('dcaCash').value) || 0,
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
  feeEl.value = mode === 'edit' ? round2(rec.fee) : round2(p.fee_amount || 0);
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
  if (h) h.onchange = () => { toggleDCANew(); fillDCACash(null); syncDCAFeeField(); };
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
  document.getElementById('authPinLogin').hidden = true;
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
  document.getElementById('authRemember').checked = true; // 每次进闸门恢复默认：长期登录
  document.getElementById('authPair').hidden = false;
  // PIN 登录通道（2026-11-02）：实例已设操作 PIN 时展示，退出后不用专程去主设备拿配对码。
  // 2026-11-02 起**默认折叠**：主路径是配对码，PIN 是备用通道；每次进闸门都复位成折叠态，
  // 免得上次展开过就一直占着首屏（展开是临时动作，不是持久偏好）。
  const pinBox = document.getElementById('authPinLogin');
  pinBox.hidden = !st.has_pin;
  setPinLoginOpen(false);
  document.getElementById('authLoginPin').value = '';
  document.getElementById('authPinLoginErr').textContent = '';
  document.getElementById('authLoginRemember').checked = false; // PIN 登录默认会话 Cookie（不想长期登录的设备多半走这条）
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
  document.getElementById('authDevice').value = '';
  document.getElementById('authPin').value = '';
  document.getElementById('authClaimErr').textContent = '';
}

async function doClaim() {
  const ids = Array.from(document.querySelectorAll('#authUserList input:checked')).map((i) => Number(i.dataset.id));
  if (!ids.length) { document.getElementById('authClaimErr').textContent = '请至少勾选一个账本'; return; }
  const rename = (document.getElementById('authRename').value || '').trim();
  const deviceLabel = (document.getElementById('authDevice').value || '').trim();
  const pin = (document.getElementById('authPin').value || '').trim();
  if (pin && !/^\d{4,6}$/.test(pin)) { document.getElementById('authClaimErr').textContent = '操作 PIN 需为 4–6 位数字'; return; }
  const btn = document.getElementById('authClaimBtn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/session/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_ids: ids, rename_to: rename, device_label: deviceLabel, pin }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { document.getElementById('authClaimErr').textContent = d.error || (humanizeErr(r)); return; }
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
      // 登录保持（2026-11-02）：取消勾选 = 会话 Cookie，关闭浏览器即退出
      body: JSON.stringify({ code, persist: document.getElementById('authRemember').checked }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { document.getElementById('authPairErr').textContent = d.error || '配对失败'; return; }
    onAuthed(d);
  } catch (e) {
    document.getElementById('authPairErr').textContent = '网络异常：' + e.message;
  } finally { btn.disabled = false; }
}

// PIN 登录（2026-11-02）：实例已设操作 PIN 时，不用主设备出码也能进去。
// 授予全部账本、member 权限；设备管理类操作对所有设备开放（后端按 PIN 校验），
// 仍归主设备的只剩账本级不可逆操作；限流与配对同池。
// PIN 登录区展开 / 折叠（2026-11-02）。折叠态只露一行文字按钮，避免备用通道挤占首屏。
// 展开时把焦点送进 PIN 输入框：用户刚点「用它直接进入」，下一步必然是输数字。
function setPinLoginOpen(open) {
  const box = document.getElementById('authPinLogin');
  const btn = document.getElementById('authPinToggle');
  if (!box || !btn) return;
  box.classList.toggle('is-open', !!open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) setTimeout(() => { const i = document.getElementById('authLoginPin'); if (i) i.focus(); }, 180);
}

async function doPinLogin() {
  const pin = (document.getElementById('authLoginPin').value || '').trim();
  if (!/^\d{4,6}$/.test(pin)) { document.getElementById('authPinLoginErr').textContent = 'PIN 需为 4–6 位数字'; return; }
  const btn = document.getElementById('authPinLoginBtn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/session/pin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ pin, persist: !document.getElementById('authLoginRemember').checked }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { document.getElementById('authPinLoginErr').textContent = d.error || '登录失败'; return; }
    onAuthed(d);
  } catch (e) {
    document.getElementById('authPinLoginErr').textContent = '网络异常：' + e.message;
  } finally { btn.disabled = false; }
}

async function onAuthed(st) {
  // 登录成功（认领 / 配对码 / PIN 登录）后一律落到首页。
  // 2026-11-02：原先空 hash 就「不跳」、只把 #/pair 深链改 home，导致从 #/devices、
  // #/notify 这类个人菜单页进闸门的设备登录完还停在原页，看起来像没进去。
  // 现在只认「登录前明确停在某个业务页」这一种回原页的情况，其余全进 #/home。
  const BACK_OK = /^#\/(home|invest|holdings|asset|finance|settings)$/;
  const back = BACK_OK.test(authReturnHash || '') ? authReturnHash : '#/home';
  authReturnHash = '';
  document.getElementById('authGate').hidden = true;
  // replaceState 不触发 hashchange：避免与下面 enterApp 里的 applyRoute 重复渲染一次
  if (location.hash !== back) history.replaceState(null, '', back);
  await enterApp(st);
  // 认领（主设备）响应里带一次性明文恢复码：PIN 存的是哈希，忘了只能靠它重置，
  // 所以必须让用户当场抄走。还没设 PIN 的话顺带敲一次警钟。
  if (st && st.recovery) showRecovery(st.recovery, !st.has_pin);
}

async function doLogout() {
  try { await api('/api/session/logout', { method: 'POST', body: '{}' }); } catch (e) { /* 会话可能已失效 */ }
  pinCache = '';
  authState = { authed: false, mode: '', user: null, users: [], read_only: false, has_pin: false, role: 'member', has_recovery: false };
  document.getElementById('app').hidden = true;
  localStorage.removeItem('pf_user');
  showAuthGate(await fetchSession());
}

// ---- 设置页：登录与设备 ----
// 浏览器不提供「计算机名 / 系统账户名」：这类信息属指纹数据，Web 平台没有任何 API 暴露，
// navigator.platform 只给 "Win32" 这种，UA-CH 也只到平台/架构/机型（Android 才有 model）。
// 所以这里只从 UA 摘出「浏览器 大版本 · 系统」，想区分具体机器就让用户自己改名（sessions.label）。
function deviceLabel(ua) {
  if (!ua) return '未知设备';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /CrOS/.test(ua) ? 'ChromeOS'
            : /Linux/.test(ua) ? 'Linux' : '';
  // 顺序有讲究：Edge/Opera 的 UA 里也含 Chrome/，必须先匹配自己的标记再退回 Chrome
  const m = ua.match(/Edg\/(\d+)/) || ua.match(/OPR\/(\d+)/) || ua.match(/Firefox\/(\d+)/)
    || ua.match(/Chrome\/(\d+)/) || ua.match(/Version\/(\d+)[.\d]* (?:Mobile\/\S+ )?Safari/);
  let br = '';
  if (m) {
    const name = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : 'Safari';
    br = name + ' ' + m[1];
  }
  return [br, os].filter(Boolean).join(' · ') || '未知设备';
}

// 设备类型：安卓平板 UA 里没有 Mobile 标记，据此区分手机/平板
function deviceKind(ua) {
  if (!ua) return '';
  if (/iPad/.test(ua)) return '平板';
  if (/iPhone|iPod/.test(ua)) return '手机';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? '手机' : '平板';
  if (/Tablet/.test(ua)) return '平板';
  return '电脑';
}

let devRenameId = 0;

function openDeviceRename(id, label) {
  devRenameId = id;
  const input = document.getElementById('devNameInput');
  input.value = label || '';
  document.getElementById('devNameModal').hidden = false;
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

async function saveDeviceRename() {
  const v = (document.getElementById('devNameInput').value || '').trim();
  if (v.length > 20) { toast('名称最长 20 个字', 'err'); return; }
  const r = await api('/api/session/devices/' + devRenameId, { method: 'PATCH', body: JSON.stringify({ label: v }) });
  if (!r.ok) { toast('改名失败', 'err'); return; }
  document.getElementById('devNameModal').hidden = true;
  toast(v ? `已改名为「${v}」` : '已恢复自动识别名称', 'ok');
  loadAuthDevices();
}

// 当前设备是否主设备（管理员）。用函数而非变量，避免顶层初始化顺序踩 TDZ。
const isOwnerDevice = () => authState.role === 'owner';

// 按角色显示 / 隐藏管理入口（2026-11-02 调整）。
// 设备管理类操作（改名 / 吊销他机 / 添加设备 / 邀请家人）不再要求主设备身份：有操作 PIN 就能做，
// 所以 #deviceActions 对所有设备可见；仍归主设备的只剩账本级不可逆操作（改 PIN / 恢复码 / 删账本），
// 对应 #pinSection 整块。后端同步放宽（handler.go 设备路由只看 PIN），前端只是不提前藏入口。
function applyRoleUI() {
  const owner = isOwnerDevice();
  ['pinSection', 'pinTitle', 'pinRow', 'pinTools', 'pinTip'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !owner;
  });
  // 添加设备 / 邀请家人：全员可见（出码时后端要 PIN，由 api() 统一弹口令框）
  const actions = document.getElementById('deviceActions');
  if (actions) actions.hidden = false;
  const note = document.getElementById('devRoleNote');
  if (note) note.textContent = owner ? '主设备' : '普通设备';
}

async function loadAuthDevices() {
  const wrap = document.getElementById('deviceList');
  if (!wrap) return;
  // 骨架占位：拉设备列表要两次往返（先 fetchSession 再 /api/session/devices），
  // 等待期原本是一句静态「加载中…」→ 设备「啪」地出现。
  // 换成三行 shimmer 骨架：形状与真实设备行接近，切换时没有明显的形状突变。
  wrap.innerHTML = '<div class="skeleton-line" style="--sk-w:70%"></div>'
    + '<div class="skeleton-line" style="--sk-w:55%"></div>'
    + '<div class="skeleton-line" style="--sk-w:62%"></div>';
  try {
    const st = await fetchSession();
    if (st) authState = st;
    if (!authState.authed) { wrap.innerHTML = '<div class="auth-hint">未登录</div>'; return; }
    const r = await api('/api/session/devices');
    if (!r.ok) { wrap.innerHTML = '<div class="auth-hint">读取失败</div>'; return; }
    const d = await r.json();
    const list = d.devices || [];
    const owner = isOwnerDevice();
    if (!list.length) { wrap.innerHTML = '<div class="auth-hint">暂无其他设备</div>'; }
    else {
      // 两行结构：首行「名称 + 本机 / 主设备」，次行「浏览器·系统 …… 最近活跃」。
      // 次行拆两段：描述可省略号、时间 flex:none 永远完整——手机上先压描述，别把时间吃掉。
      // 描述只在改过名时才重复「浏览器·系统」（未改名时它就是标题），手机/平板才追加设备类型。
      // 按钮按角色出：改名 / 吊销他机 = 全员（吊销要 PIN）；「设为主设备」仍只给主设备看
      // （转移会降级发起方，member 发起会凭空多出一个 owner）。
      wrap.innerHTML = list.map((s) => {
        const auto = deviceLabel(s.ua);
        const kind = deviceKind(s.ua);
        const desc = s.label
          ? [auto, (kind === '手机' || kind === '平板') ? kind : ''].filter(Boolean).join(' · ')
          : kind;
        const seen = s.last_seen ? s.last_seen.slice(5, 16) : '';
        const canRename = true;                       // 改自己 → 改他机：全员（无凭据变更）
        const canRevoke = !s.current;                 // 吊销他机：全员 + PIN（主设备坏了也能清掉那台）
        const canTransfer = owner && !s.current && s.role !== 'owner'; // 转移主设备：仍属主设备
        return `
        <div class="device-row" data-id="${s.id}">
          <div class="device-main">
            <div class="device-head">
              <span class="device-name">${escapeHtml(s.label || auto)}</span>
              ${s.current ? '<span class="device-badge">本机</span>' : ''}
              ${s.role === 'owner' ? '<span class="device-badge role">主设备</span>' : ''}
            </div>
            <span class="device-meta" title="${escapeHtml(s.ua || '')}">
              <span class="device-meta-desc">${escapeHtml(desc)}</span>
              ${seen ? `<span class="device-meta-seen">${escapeHtml(seen)}</span>` : ''}
            </span>
          </div>
          <div class="device-acts">
            ${canTransfer ? `<button class="dev-act" type="button" data-act="transfer" data-id="${s.id}">设为主设备</button>` : ''}
            ${canRename ? actBtn('edit', `data-act="rename" data-id="${s.id}" data-label="${escapeHtml(s.label || '')}"`, '改名') : ''}
            ${canRevoke ? actBtn('del', `data-act="revoke" data-id="${s.id}"`, '吊销', { danger: true }) : ''}
          </div>
        </div>`;
      }).join('');
      wrap.querySelectorAll('[data-act="rename"]').forEach((btn) => {
        btn.onclick = () => openDeviceRename(Number(btn.dataset.id), btn.dataset.label || '');
      });
      // 登录保持的行内开关已删除（2026-11-02）：按钮文案「关浏览器即退出 / 改为长期登录」
      // 读起来像一句状态说明而不是操作，长在设备行里非常突兀；而「要不要长期登录」本来就该在
      // **登录那一刻**决定（闸门上的「记住这台设备」/ PIN 登录的「关闭浏览器后退出登录」）。
      // 后端 /api/session/persist 与 sessions.persist 列保留，供登录流程使用。
      // 两段式确认：第一次点把图标换成对勾（armed），再点才执行（免开确认弹框）；他机吊销额外要 PIN。
      // 2026-11-02 改图标后：不能再靠 textContent 换文案，armed 态用「图标换成对勾 + 红底描边」表达，
      // 4 秒无操作自动复位。
      wrap.querySelectorAll('[data-act="revoke"]').forEach((btn) => {
        const idle = () => {
          btn.dataset.armed = '';
          btn.classList.remove('armed');
          btn.innerHTML = actIcon('del');
          btn.title = '吊销';
          btn.setAttribute('aria-label', '吊销');
        };
        btn.onclick = async () => {
          if (btn.dataset.armed !== '1') {
            btn.dataset.armed = '1';
            btn.classList.add('armed');
            btn.innerHTML = actIcon('check');
            btn.title = '再点一次确认吊销';
            btn.setAttribute('aria-label', '再点一次确认吊销');
            setTimeout(() => { if (btn.isConnected && btn.dataset.armed === '1') idle(); }, 4000);
            return;
          }
          const r2 = await api('/api/session/devices/' + btn.dataset.id, { method: 'DELETE' });
          if (r2.ok) { toast('已吊销该设备，其 Cookie 立即失效', 'ok'); loadAuthDevices(); }
          else {
            const d2 = await r2.json().catch(() => ({}));
            toast(d2.error || '吊销失败', 'err');
            loadAuthDevices(); // 恢复按钮
          }
        };
      });
      // 转移主设备：身份一交出去本机就变普通设备，必须输 PIN 二次确认
      wrap.querySelectorAll('[data-act="transfer"]').forEach((btn) => {
        btn.onclick = async () => {
          const pin = await promptPIN();
          if (!pin) return;
          const r2 = await api('/api/session/transfer', { method: 'POST', body: JSON.stringify({ device_id: Number(btn.dataset.id), pin }) });
          const d2 = await r2.json().catch(() => ({}));
          if (!r2.ok) { toast(d2.error || '转移失败', 'err'); return; }
          const st2 = await fetchSession();
          if (st2) authState = st2;
          toast('已把主设备转给该设备，本机现在是普通设备', 'ok');
          loadAuthDevices();
        };
      });
    }
    updatePinState(!!authState.has_pin);
    applyRoleUI();
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
  // 出码时给设备起过名就带上，对方一看就知道这台机器要挂什么名字
  const nm = (info.label || '').trim();
  document.getElementById('pairCodeHint').textContent = isInvite
    ? '把该码发给对方：在对方自己的设备上打开本站，输入此码即可接入。'
    : (nm
      ? `在「${nm}」这台设备上打开本站，输入此码即可接入；接入后设备列表里就叫这个名字。`
      : '在要接入的新设备上打开本站，输入此码即可接入本账本。');
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

// ---- 恢复码（2026-10-29）----
// 明文只在两个时机拿得到：认领成功的响应、主动「重新生成」。库里存 bcrypt，服务端也拿不回来，
// 所以弹框必须让用户确认「我已抄下」。它只能在已登录的主设备上重置 PIN，不能用来加设备。
function showRecovery(code, warnNoPin) {
  document.getElementById('recoveryCode').textContent = code;
  document.getElementById('recoveryPinWarn').hidden = !warnNoPin;
  document.getElementById('recoveryModal').hidden = false;
}

async function rotateRecovery() {
  const r = await api('/api/session/recovery/rotate', { method: 'POST', body: '{}' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { toast(d.error || '生成失败', 'err'); return; }
  authState.has_recovery = true;
  showRecovery(d.recovery, false);
}

async function submitPinReset() {
  const code = (document.getElementById('pinResetCode').value || '').trim();
  const pin = (document.getElementById('pinResetNew').value || '').trim();
  const err = document.getElementById('pinResetErr');
  if (!code) { err.textContent = '请输入恢复码'; return; }
  if (!/^\d{4,6}$/.test(pin)) { err.textContent = 'PIN 需为 4–6 位数字'; return; }
  const r = await api('/api/session/pin/reset', { method: 'POST', body: JSON.stringify({ recovery: code, pin }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { err.textContent = d.error || '重置失败'; return; }
  document.getElementById('pinResetModal').hidden = true;
  authState.has_pin = true;
  authState.has_recovery = false;
  pinCache = pin; // 刚设好的 PIN 先记住，省得下一次危险操作又要输一遍
  updatePinState(true);
  toast('PIN 已重置；这份恢复码已作废，记得重新生成一份', 'ok');
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
  on('authPinLoginBtn', () => doPinLogin());
  on('authPinToggle', () => {
    const box = document.getElementById('authPinLogin');
    setPinLoginOpen(!box.classList.contains('is-open'));
  });
  on('authRoBtn', () => { document.getElementById('authGate').hidden = true; enterApp(authState); });
  const codeInput = document.getElementById('authCode');
  if (codeInput) codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doPair(); });
  // 认领屏三个可选输入框都能回车提交
  ['authRename', 'authDevice', 'authPin'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') doClaim(); });
  });
  // 退出登录按钮已从本页移除（下沉到个人菜单最底部，带二次确认），这里不再绑定
  // 「添加设备」先问名字再出码（名字可选，留空就走 UA 自动识别）
  on('addDeviceBtn', () => {
    const inp = document.getElementById('addDeviceName');
    inp.value = '';
    document.getElementById('addDeviceModal').hidden = false;
    setTimeout(() => inp.focus(), 50);
  });
  const addDeviceModal = document.getElementById('addDeviceModal');
  if (addDeviceModal) addDeviceModal.onclick = (e) => { if (e.target === addDeviceModal) addDeviceModal.hidden = true; };
  on('addDeviceCancel', () => { document.getElementById('addDeviceModal').hidden = true; });
  on('addDeviceOk', async () => {
    const label = (document.getElementById('addDeviceName').value || '').trim();
    const modal = document.getElementById('addDeviceModal');
    // 出码前先藏起本弹框：它 DOM 顺序靠后、z-index 同级，会盖住内部弹出的操作 PIN 框 / 配对码结果框
    modal.hidden = true;
    try {
      const d = await genPairCode('device', label ? { label } : {});
      if (!d) { modal.hidden = false; return; }   // 取消 PIN / PIN 错误：恢复，不吞掉已输入的名称
      openPairCodeModal(d, false);
    } catch (e) { modal.hidden = false; }          // PIN 弹框取消：恢复
  });
  const addDeviceName = document.getElementById('addDeviceName');
  if (addDeviceName) addDeviceName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('addDeviceOk').click();
  });
  on('inviteMemberBtn', openInviteModal);
  // 设备改名（.modal 的 Esc / ✕ 由全局逻辑处理，遮罩点击沿用各弹框自行绑定的惯例）
  const devNameModal = document.getElementById('devNameModal');
  if (devNameModal) devNameModal.onclick = (e) => { if (e.target === devNameModal) devNameModal.hidden = true; };
  on('devNameCancel', () => { document.getElementById('devNameModal').hidden = true; });
  on('devNameSave', saveDeviceRename);
  const devNameInput = document.getElementById('devNameInput');
  if (devNameInput) devNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveDeviceRename(); });
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
      if (d.has_pin && !authState.has_recovery) toast('操作 PIN 已保存；建议顺手「重新生成恢复码」抄一份备用', 'ok');
      else toast(d.has_pin ? '操作 PIN 已保存' : '操作 PIN 已关闭', 'ok');
    } catch (e) { toast(humanizeErr(null, e, '保存失败')); }
  });
  // ---- 恢复码 / 忘记 PIN ----
  const recModal = document.getElementById('recoveryModal');
  if (recModal) recModal.onclick = (e) => { if (e.target === recModal) recModal.hidden = true; };
  on('recoveryClose', () => { document.getElementById('recoveryModal').hidden = true; });
  on('recoveryOk', () => { document.getElementById('recoveryModal').hidden = true; });
  on('recoveryCopy', () => copyText(document.getElementById('recoveryCode').textContent, '已复制恢复码'));
  on('pinForgotBtn', () => {
    document.getElementById('pinResetCode').value = '';
    document.getElementById('pinResetNew').value = '';
    document.getElementById('pinResetErr').textContent = '';
    document.getElementById('pinResetModal').hidden = false;
    setTimeout(() => document.getElementById('pinResetCode').focus(), 50);
  });
  const pinResetEl = document.getElementById('pinResetModal');
  if (pinResetEl) pinResetEl.onclick = (e) => { if (e.target === pinResetEl) pinResetEl.hidden = true; };
  on('pinResetCancel', () => { document.getElementById('pinResetModal').hidden = true; });
  on('pinResetClose', () => { document.getElementById('pinResetModal').hidden = true; });
  on('pinResetOk', submitPinReset);
  on('recoveryRotateBtn', rotateRecovery);
})();
