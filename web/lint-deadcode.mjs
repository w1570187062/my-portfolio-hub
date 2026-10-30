#!/usr/bin/env node
/**
 * lint-deadcode.mjs —— 通用前端死代码 / 孤儿代码扫描器（零依赖，纯正则 + 引用计数）
 *
 * 为什么要有它：
 *   check-ui.mjs 第 12 项只判「CSS 有、源码无」的死 class，且是软门（构建后跑、失败不阻断）。
 *   实际还漏三类真死代码：
 *     ① CSS token 定义了但从没 var() 用；
 *     ② 顶层 JS 函数/常量全项目只出现一次（就是声明本身）；
 *     ③ 函数留着、但体内取的 DOM id 在页面里根本不存在 —— 必然空转（例：renderCashflowCard
 *        引用 #cashflowCard / #cfList 等 7 个 id，index.html 里一个都没有，整函数是死的，
 *        而它的名字在调用链里出现过，所以任何「按名字计数」的检测都抓不到）。
 *   还有一类反向 bug：JS 取了一个不存在的 id（拼错 / 元素被删）→ 运行期静默失效。
 *
 * 设计原则：
 *   · 只报不改 —— 历史事故：自动删 CSS 曾把盈亏日历 8 档底色整组删空（见 check-ui.mjs 第 17 项）。
 *     死代码删除必须由人确认，脚本只负责给出确定性的清单。
 *   · 保守优先 —— 判不准的一律放行（动态拼接、变量中转、模板字符串），宁可漏报不误报。
 *   · 通用 —— 文件路径、白名单、预算全部来自配置，默认值适配本仓库，`--config` 可指向别处。
 *
 * 用法：
 *   node lint-deadcode.mjs                  # 人类可读报告
 *   node lint-deadcode.mjs --json           # 机器可读（CI）
 *   node lint-deadcode.mjs --strict         # 预算超标即 exit 1
 *   node lint-deadcode.mjs --root ../other  # 扫别的项目
 *   node lint-deadcode.mjs --config x.json  # 覆盖配置（浅合并）
 *
 * 局限（有意为之）：
 *   · 只扫顶层无缩进声明（`function f` / `const X =` 在行首）—— 嵌套闭包不参与「孤儿」判定。
 *   · 不做 AST，正则字面量里的括号可能让函数体切片失败 → 该函数直接跳过（宁可漏报）。
 *   · 不覆盖 Go 侧：`go vet` 已管未用变量/import，未用导出符号请用 `go run golang.org/x/tools/cmd/deadcode@latest`。
 */
import { readFileSync, existsSync, statSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, def) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };

// 默认扫脚本所在目录（web/）；显式 --root 时按当前工作目录解析，便于扫别的项目
const ROOT_ARG = val('--root', null);
const ROOT = ROOT_ARG ? resolve(process.cwd(), ROOT_ARG) : SELF_DIR;
const AS_JSON = has('--json');
const STRICT = has('--strict');
const UPDATE_BASE = has('--update-baseline');
const BASE_PATH = resolve(ROOT, val('--baseline', 'deadcode-baseline.json'));

// ─────────────────────────────────────────────────────────────
// 默认配置：全部可通过 --config <file.json> 浅合并覆盖
// ─────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  // 源文件（相对 root）
  files: { css: 'style.css', js: 'app.js', html: 'index.html' },

  // 白名单：确定在用但静态分析看不见的符号
  ignore: {
    classes: [],   // 例：外部脚本注入的类
    tokens: [],    // 例：主题预设里的色板
    decls: [],     // 顶层函数/常量
    ids: ['authSettingsGroup'], // auth-shot.mjs 依赖，见 check-ui.mjs 注释
  },

  // 动态拼接豁免：类名/token/id = 某个短字面量前缀 + 不超过 N 个字符（档位/序号）
  // 例：`'lg-' + (v>0?'up':'down')` 拼出 lg-up1，源码里永远搜不到
  // 取 3 而非 4：4 会让 'cashflow'(API 路径里的小写字面量) 吃掉 cashflowCard 这类真名
  dynamicTailLen: 3,

  // 预算（0 = 零容忍）。超预算才影响 --strict 退出码。
  budgets: { deadClass: 0, deadToken: 0, orphanDecl: 0, deadRender: 0, missingId: 0, orphanId: 0 },
};

const cfgPath = val('--config', null);
let config = DEFAULT_CONFIG;
if (cfgPath) {
  const p = resolve(process.cwd(), cfgPath);
  if (!existsSync(p)) { console.error(`✗ 配置文件不存在: ${p}`); process.exit(2); }
  const user = JSON.parse(readFileSync(p, 'utf8'));
  config = {
    ...DEFAULT_CONFIG, ...user,
    files: { ...DEFAULT_CONFIG.files, ...(user.files || {}) },
    ignore: { ...DEFAULT_CONFIG.ignore, ...(user.ignore || {}) },
    budgets: { ...DEFAULT_CONFIG.budgets, ...(user.budgets || {}) },
  };
}

// ─────────────────────────────────────────────────────────────
// 读源文件（缺失即跳过该维度，不报错 —— 通用脚本要能在纯 CSS 项目里跑）
// ─────────────────────────────────────────────────────────────
const readIf = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p) || !statSync(p).isFile()) return null;
  return readFileSync(p, 'utf8');
};

const CSS_SRC = readIf(config.files.css);
const JS_SRC = readIf(config.files.js);
const HTML_SRC = readIf(config.files.html);

if (!CSS_SRC && !JS_SRC && !HTML_SRC) {
  console.error(`✗ 在 ${ROOT} 下找不到任何源文件（检查 config.files）`);
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────
// 预处理：剥注释，保留行号（把注释替换成等长空白，避免行号错位）
// ─────────────────────────────────────────────────────────────
const blankOut = (m) => m.replace(/[^\n]/g, ' ');
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blankOut);
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, blankOut);
const stripJs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, blankOut)
  // 行注释：前面不是 : 或引号/反斜杠（避免把 'http://' 当成注释开头）
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

const CSS = CSS_SRC ? stripCss(CSS_SRC) : '';
const HTML = HTML_SRC ? stripHtml(HTML_SRC) : '';
const JS = JS_SRC ? stripJs(JS_SRC) : '';

/** 全项目文本检索haystack：判定 token 是否被引用 */
const HAY = JS + '\n' + HTML + '\n' + CSS;
/** 引用池：只含代码（JS/HTML）。判「类名/ id 是否被用」绝不能算 CSS 自己 —— 定义处会自证存在 */
const CODE = JS + '\n' + HTML;

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * 两类边界，别混用：
 *   identRe —— JS 标识符（$ 是合法字符，`foo$bar` 不是 foo）
 *   tokenRe —— CSS 类名 / DOM id（合法字符集是 [\w-]，`$` 是模板串边界，不能当同名字符）
 * 混用会误判：`class="acct-item acct-user${on ? ' active' : ''}"` 里的 acct-user 后面紧跟 $，
 * 用 identRe 的 (?![\w$]) 会判成「没出现」→ 一个活类被报死。
 */
const identRe = (name) => new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`, 'g');
const tokenRe = (name) => new RegExp(`(?<![\\w-])${escapeRe(name)}(?![\\w-])`, 'g');
const countRefs = (name) => (CODE.match(identRe(name)) || []).length;
const appears = (name) => tokenRe(name).test(CODE);

/**
 * 拼接可达：id / 类名由「变量 + 前后缀字面量」拼出时，源码里只剩那半截字面量。
 * 实例：bindCashPicker 用 `document.getElementById(cfg.picker + 'CashPicker')`，
 *       配 `picker: 'hold'` → 拼出 holdCashPicker。全名在源码里搜不到，但它绝对是活的。
 * 口径：字面量长度 ≥6 且剩余长度 ≥2（'CashPicker'(10) 命中；'Title'(5) 不命中，
 *       否则 crbTitle 这种真孤儿会被放过）。
 */
const concatLits = new Set();
for (const m of CODE.matchAll(/['"`]([A-Za-z][\w-]{5,30})['"`]/g)) concatLits.add(m[1]);
const isConcat = (name) => {
  for (const lit of concatLits) {
    if (name === lit) continue;
    if (name.length - lit.length >= 2 && (name.startsWith(lit) || name.endsWith(lit))) return true;
  }
  return false;
};

/**
 * 动态拼接豁免：名字 = 源码里的某个短字面量前缀 + 少量尾巴。
 * 只认小写字母开头的字面量，且长度 ≥4，避免把 a/b/x 这类变量名当前缀。
 * 尾巴必须 ≥1：否则名字自己就是那个字面量，会把自己豁免掉（曾经 ghost / dead-one 全被自己吃掉）。
 */
const dynPrefixes = new Set();
for (const m of CODE.matchAll(/['"`]([a-z][a-z0-9-]{3,20})['"`]/g)) dynPrefixes.add(m[1]);
const isDynamic = (name) => {
  for (const p of dynPrefixes) {
    const tail = name.length - p.length;
    if (tail >= 1 && tail <= config.dynamicTailLen && name.startsWith(p)) return true;
  }
  return false;
};

const findings = { deadClass: [], deadToken: [], orphanDecl: [], deadRender: [], missingId: [], orphanId: [] };
const push = (kind, item) => findings[kind].push(item);
const ignored = (kind, name) => (config.ignore[kind] || []).includes(name);

// ─────────────────────────────────────────────────────────────
// 1. CSS 死 class：CSS 定义 → 源码（js/html）从未出现
//    与 check-ui 第 12 项同口径，但这里给全量清单而非只报个数
// ─────────────────────────────────────────────────────────────
if (CSS) {
  const defined = new Set();
  for (const m of CSS.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);
  for (const c of defined) {
    if (ignored('classes', c)) continue;
    if (appears(c) || isDynamic(c) || isConcat(c)) continue;
    push('deadClass', { name: '.' + c });
  }
}

// ─────────────────────────────────────────────────────────────
// 2. CSS 死 token：`--x:` 有定义，但全项目没有 var(--x)
// ─────────────────────────────────────────────────────────────
if (CSS) {
  const definedTokens = new Map(); // name -> line
  for (const m of CSS.matchAll(/(--[\w-]+)\s*:/g)) {
    if (!definedTokens.has(m[1])) definedTokens.set(m[1], lineOf(CSS, m.index));
  }
  const usedTokens = new Set();
  for (const m of HAY.matchAll(/var\(\s*(--[\w-]+)/g)) usedTokens.add(m[1]);
  for (const [name, line] of definedTokens) {
    if (usedTokens.has(name)) continue;
    if (ignored('tokens', name)) continue;
    // 动态拼接：var('--cat-' + x) / var(`--${x}`) 这类放行
    if (isDynamic('x' + name.slice(1)) || isDynamic(name.slice(2))) continue;
    if (/var\(\s*['"`]?--?\s*['"`$]/.test(CSS) && /--\$\{|['"`]\s*\+/.test(CSS)) {
      // 存在拼接式 var() 调用 → 该 token 前缀可能被动态命中
      const tail = name.slice(2);
      const prefix = tail.split('-')[0];
      if (new RegExp(`--?['"\`]\\s*\\+\\s*['"\`]?${escapeRe(prefix)}|${escapeRe(prefix)}-?\\.\\.\\.`).test(CSS)) continue;
    }
    push('deadToken', { name, line });
  }
}

// ─────────────────────────────────────────────────────────────
// 3. 顶层声明孤儿：`function f` / `const X =` 在行首，全项目引用次数 ≤ 1（只有声明本身）
// ─────────────────────────────────────────────────────────────
if (JS) {
  const decls = [];
  for (const m of JS.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    decls.push({ name: m[1], kind: 'function', idx: m.index });
  }
  for (const m of JS.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) {
    decls.push({ name: m[1], kind: 'variable', idx: m.index });
  }
  for (const d of decls) {
    if (ignored('decls', d.name)) continue;
    // IIFE / 自执行包装（window.x = ...）不算孤儿
    if (countRefs(d.name) > 1) continue;
    push('orphanDecl', { name: d.name, kind: d.kind, line: lineOf(JS, d.idx) });
  }
}

// ─────────────────────────────────────────────────────────────
// 4/5. DOM id 三向核对
//     idDefs  = index.html 里的 id="x" + JS 模板字符串里的 id="x"（含 ${} 的跳过）
//     refs    = getElementById('x') / querySelector('#x')
//     missingId：JS 取的 id 不存在 → 运行期静默失效（真 bug）
//     deadRender：函数体内取的 id 全部不存在 → 整函数空转（最隐蔽的一类死代码）
// ─────────────────────────────────────────────────────────────
if (JS && HTML) {
  const idDefs = new Set();
  for (const src of [HTML, JS]) {
    // id="x"（HTML 属性 / JS 模板串）· el.id = 'x' · setAttribute('id', 'x')
    for (const m of src.matchAll(/\bid\s*=\s*["']([^"'${}]+)["']/g)) idDefs.add(m[1]);
    for (const m of src.matchAll(/\.id\s*=\s*['"]([^"'${}]+)['"]/g)) idDefs.add(m[1]);
    for (const m of src.matchAll(/setAttribute\(\s*['"]id['"]\s*,\s*['"]([^"'${}]+)['"]/g)) idDefs.add(m[1]);
  }
  // 只统计静态 HTML 里真实存在的 id：JS 模板字符串里的 id 可能挂在已废弃的容器上
  // （renderCashflowCard 依赖的 #cfQuickAdd 就只由它自己那条死链里的空态模板生成）
  const staticHtmlIds = new Set();
  for (const m of HTML.matchAll(/\bid\s*=\s*["']([^"'${}]+)["']/g)) staticHtmlIds.add(m[1]);

  const refs = new Map(); // id -> 首次出现的行号（JS 内）
  // 结尾必须紧跟 `)` —— 排除 getElementById('amt-' + w.id) 这类拼接式（id 由运行期拼出）
  for (const m of JS.matchAll(/(?:getElementById\(\s*['"]([^'"]+)['"]\s*\)|querySelector(?:All)?\(\s*['"]#([\w-]+)['"]\s*\))/g)) {
    const id = m[1] || m[2];
    if (!id || /[${}]/.test(id)) continue;             // 拼接式，跳过
    if (!refs.has(id)) refs.set(id, lineOf(JS, m.index));
  }

  for (const [id, line] of refs) {
    if (idDefs.has(id) || ignored('ids', id)) continue;
    if (isDynamic(id)) continue;
    push('missingId', { name: id, line });
  }

  // 函数体切片：从 `function name(` 起做大括号配对（跳过字符串/模板/行注释）
  const bodyOf = (startIdx) => {
    const open = JS.indexOf('{', startIdx);
    if (open < 0) return null;
    let depth = 0, i = open, quote = null;
    for (; i < JS.length; i++) {
      const ch = JS[i];
      if (quote) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return JS.slice(open, i + 1); }
    }
    return null; // 配对失败（正则字面量干扰等）→ 放弃该函数，宁可漏报
  };

  for (const m of JS.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = m[1];
    if (ignored('decls', name)) continue;
    const body = bodyOf(m.index);
    if (!body) continue;
    // 函数自己 innerHTML 出来的 id（先写 id="x" 再 querySelector('#x')）→ 该 id 在体内可达
    const bodyIds = new Set();
    for (const b of body.matchAll(/\bid\s*=\s*["']([^"'${}]+)["']/g)) bodyIds.add(b[1]);
    const ids = [];
    for (const r of body.matchAll(/(?:getElementById\(\s*['"]([^'"]+)['"]\s*\)|querySelector(?:All)?\(\s*['"]#([\w-]+)['"]\s*\))/g)) {
      const id = r[1] || r[2];
      if (id && !/[${}]/.test(id) && !bodyIds.has(id)) ids.push(id);
    }
    const uniqIds = [...new Set(ids)];
    if (uniqIds.length < 2) continue;                   // 只取 1 个 id 不足以断定整函数死
    const allMissing = uniqIds.every((id) => !staticHtmlIds.has(id));
    if (!allMissing) continue;
    // 该函数自身若已判为孤儿声明，会重复出现在 orphanDecl，这里仍单列（信息更具体）
    push('deadRender', { name, line: lineOf(JS, m.index), ids: uniqIds });
  }

  // 孤儿 id：HTML 里定义，但全项目（除定义处外）无人引用
  const definedIds = new Set();
  for (const m of HTML.matchAll(/\bid\s*=\s*["']([^"'${}]+)["']/g)) definedIds.add(m[1]);
  for (const id of definedIds) {
    if (ignored('ids', id)) continue;
    // 引用形式：getElementById / querySelector / href="#x" / for="x" / aria-* / js 里的 '#x'
    const forms = [
      `#${id}`, `'${id}'`, `"${id}"`,
    ];
    const selfDef = new RegExp(`\\bid\\s*=\\s*["']${escapeRe(id)}["']`, 'g');
    const refCount = forms.reduce((n, f) => n + (HAY.match(new RegExp(escapeRe(f), 'g')) || []).length, 0)
      - (HAY.match(selfDef) || []).length;
    if (refCount > 0) continue;
    if (isDynamic(id) || isConcat(id)) continue;
    push('orphanId', { name: id });
  }
}

// ─────────────────────────────────────────────────────────────
// 存量冻结（baseline）
//   死代码是一次性清空的债，但「清完才能卡门禁」等于永远卡不上。
//   所以把当前已确认的存量记进 deadcode-baseline.json，门禁只拦**新增**：
//     新增项 > budgets → --strict 退出 1。
//   清掉一项后跑 `--update-baseline` 让它从账本里消失（账本只减不增）。
// ─────────────────────────────────────────────────────────────
let baseline = null;
if (!UPDATE_BASE && existsSync(BASE_PATH)) {
  try {
    baseline = JSON.parse(readFileSync(BASE_PATH, 'utf8'));
  } catch (e) {
    console.error(`✗ baseline 解析失败: ${BASE_PATH}（可删掉后重跑 --update-baseline）`);
    process.exit(2);
  }
}
const baseSet = (kind) => new Set((baseline && baseline[kind]) || []);
const fresh = {};  // 未记入 baseline 的新增项
for (const kind of Object.keys(findings)) {
  const known = baseSet(kind);
  fresh[kind] = findings[kind].filter((f) => !known.has(f.name));
}

if (UPDATE_BASE) {
  const snap = {};
  for (const kind of Object.keys(findings)) {
    snap[kind] = [...new Set(findings[kind].map((f) => f.name))].sort();
  }
  writeFileSync(BASE_PATH, JSON.stringify(snap, null, 2) + '\n');
  const total = Object.values(snap).reduce((n, a) => n + a.length, 0);
  console.log(`\n  baseline 已更新 -> ${BASE_PATH}（${total} 项存量已冻结）\n`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────
const GROUPS = [
  ['deadClass',  'CSS 死 class',  '定义在 CSS，源码从未出现过'],
  ['deadToken',  'CSS 死 token',  '定义了 --x，全项目没有 var(--x) 引用'],
  ['orphanDecl', 'JS 孤儿声明',   '顶层函数/常量，全项目只出现一次（就是声明本身）'],
  ['deadRender', 'JS 空转函数',   '体内取的 DOM id 全部不存在 → 必然空操作'],
  ['missingId',  'DOM id 悬空',   'JS 取了不存在的 id → 运行期静默失效'],
  ['orphanId',   'HTML 孤儿 id',  '定义了，但全项目无人按 id 引用'],
];

const over = [];
for (const [kind] of GROUPS) {
  const budget = config.budgets[kind] ?? 0;
  if (fresh[kind].length > budget) over.push({ kind, count: fresh[kind].length, budget });
}

if (AS_JSON) {
  console.log(JSON.stringify({ root: ROOT, findings, fresh, overBudget: over, strict: STRICT }, null, 2));
} else {
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
  console.log('\n  死代码扫描（deadcode lint）\n');
  console.log(`  扫描根目录  ${ROOT}`);
  console.log(`  源文件      ${[config.files.css, config.files.js, config.files.html].filter((f) => readIf(f)).join(' · ')}`);
  console.log(`  存量基线    ${baseline ? BASE_PATH.split(/[\\/]/).pop() + '（已冻结，不计入门禁）' : '无（全量计入）'}`);
  console.log('  ' + '─'.repeat(80));
  console.log('  ' + pad('类别', 20) + pad('存量', 7) + pad('新增', 7) + '门禁');
  console.log('  ' + '─'.repeat(80));
  for (const [kind, short] of GROUPS) {
    const n = findings[kind].length;
    const f = fresh[kind].length;
    const b = config.budgets[kind] ?? 0;
    console.log('  ' + pad(short, 20) + pad(String(n), 7) + pad(String(f), 7) + (f > b ? `❌ 新增 ${f} > 预算 ${b}` : `✅ ≤ ${b}`));
  }
  console.log('  ' + '─'.repeat(80));

  let anyDetail = false;
  for (const [kind, short, long] of GROUPS) {
    if (!findings[kind].length) continue;
    anyDetail = true;
    const isNew = new Set(fresh[kind].map((x) => x.name));
    console.log(`\n  ▸ ${short} —— ${long}`);
    for (const f of findings[kind].slice(0, 30)) {
      const loc = f.line ? `:${f.line}` : '';
      const extra = f.ids ? `  → 取 ${f.ids.length} 个 id 全不存在：${f.ids.slice(0, 5).join(', ')}${f.ids.length > 5 ? ' …' : ''}` : '';
      const tag = isNew.has(f.name) ? ' [新增]' : '';
      console.log(`    ${f.name}${loc}${f.kind ? `  (${f.kind})` : ''}${extra}${tag}`);
    }
    if (findings[kind].length > 30) console.log(`    … 另有 ${findings[kind].length - 30} 项（--json 取全量）`);
  }
  if (!anyDetail) console.log('\n  未发现死代码 ✅');

  const total = GROUPS.reduce((n, [k]) => n + findings[k].length, 0);
  const freshTotal = GROUPS.reduce((n, [k]) => n + fresh[k].length, 0);
  console.log(`\n  合计 ${total} 项，其中新增 ${freshTotal} 项`);
  if (over.length) console.log(`  ✗ 超出预算：${over.map((o) => `${o.kind} ${o.count}>${o.budget}`).join('、')}`);
  console.log('  注：白名单 config.ignore ｜ 动态拼接豁免 config.dynamicTailLen ｜ 冻结存量 --update-baseline\n');
}

process.exit(STRICT && over.length ? 1 : 0);
