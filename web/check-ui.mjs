/**
 * UI 一致性校验（v3 设计规范 §5 的可执行版本）
 *
 * 用法：npm run lint:ui      （在 web/ 目录下）
 *
 * 设计意图：把「统一」交给机器，而不是交给框架或人的自觉。
 * 规范文档里声明的每一条指标，这里都必须能用一条命令复核 ——
 * 历史上出现过「文档声称已回迁内联样式、实际 62 行还在反向覆盖」的事故，
 * 所以任何新增规则都应该先在这里落一条断言，再谈改代码。
 */
import { readFileSync } from 'fs';

const read = (f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

const css = read('style.css');
const js = read('app.js');
const html = read('index.html');

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const JS_LINE_COMMENT = /(^|[^:'"\\])\/\/[^\n]*/gm;

/** CSS 去掉注释，避免注释里提到的色值被误判 */
const cssBare = css.replace(CSS_COMMENT, '');
const htmlBare = html.replace(HTML_COMMENT, '');
const jsBare = js.replace(JS_LINE_COMMENT, '$1');

const results = [];
const check = (name, detail, ok, extra = '') =>
  results.push({ name, detail, ok, extra });

// ─────────────────────────────────────────────────────────────
// 1. 唯一样式真源：index.html 不得有内联 <style>
// ─────────────────────────────────────────────────────────────
{
  const n = (htmlBare.match(/<style[\s>]/gi) || []).length;
  check('index.html 内联 <style>', '必须为 0（样式唯一真源 = style.css）', n === 0, `实测 ${n} 个`);
}

// ─────────────────────────────────────────────────────────────
// 2. 语义色字面量：token 定义行之外不得出现涨跌/主色/功能色字面量
// ─────────────────────────────────────────────────────────────
{
  const SEMANTIC = /#(f87171|4ade80|dc2626|16a34a|ef4444|0a84ff|d9a52b|6f9e5e|38bdf8|f59e0b|22c55e|f97316|eab308|94a3b8|64748b)\b/gi;
  // 豁免：token 定义行（--x: …）、主题色预设选择器、色板 swatch —— 它们本身就是色值的唯一来源
  const EXEMPT = [/^\s*--/, /\[data-accent=/, /accent-swatch/];
  const hits = [];
  cssBare.split('\n').forEach((line, i) => {
    if (EXEMPT.some((re) => re.test(line))) return;
    if (SEMANTIC.test(line)) hits.push(`${i + 1}: ${line.trim().slice(0, 70)}`);
  });
  check('语义色字面量（定义行外）', '必须为 0（一律走 var(--…)）', hits.length === 0, hits.slice(0, 4).join('  |  '));
}

// ─────────────────────────────────────────────────────────────
// 3. 字号档位：不同 font-size 取值 ≤ 12（7 档 token + SVG viewBox + Hero 大字 + 特殊值）
// ─────────────────────────────────────────────────────────────
{
  const vals = [...cssBare.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim());
  // 豁免：SVG viewBox 单位（小数或 ≤4px 整数）、Hero 大字号（≥28px 的字面量）
  const EXEMPT = (v) => {
    if (!/^[\d.]+px$/.test(v)) return false; // token / var 已计入
    const n = parseFloat(v);
    if (n !== Math.floor(n)) return true;     // 小数 → SVG viewBox
    if (n <= 4) return true;                  // ≤4px 整数 → SVG viewBox / 光学微调
    if (n >= 28) return true;                 // Hero summary / pnl 大字
    return false;
  };
  const uniq = [...new Set(vals.filter((v) => !EXEMPT(v)))];
  check('font-size 取值种类', '≤ 12 种（token + 豁免 SVG viewBox + Hero 大字）', uniq.length <= 12,
    `实测 ${uniq.length} 种：${uniq.join(', ')}`);
}

// ─────────────────────────────────────────────────────────────
// 4. 圆角：非 token / 非登记例外 ≤ 4 种
// ─────────────────────────────────────────────────────────────
{
  const EXEMPT = /(var\(|999px|50%|^0$|^2px$)/;
  const vals = [...cssBare.matchAll(/border-radius:\s*([^;}]+)/g)]
    .flatMap((m) => m[1].trim().split(/\s+/))
    .filter((v) => !EXEMPT.test(v));
  const uniq = [...new Set(vals)];
  check('border-radius 非 token 取值', '≤ 4 种（例外仅 999px / 50% / 0 / 2px）', uniq.length <= 4, `实测 ${uniq.length} 种：${uniq.join(', ')}`);
}

// ─────────────────────────────────────────────────────────────
// 5. 4px 网格：间距与尺寸不得出现 4 的倍数以外的 px
//    豁免：≤6px 光学微调 / 宽高 ≤30px 的独立元素（图标/按钮视觉尺寸）
// ─────────────────────────────────────────────────────────────
{
  const PROP = /\b(gap|row-gap|column-gap|padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|height|min-height|max-height|width|min-width|max-width)\s*:\s*((?:[0-9.]+px|0)(?:\s+(?:[0-9.]+px|0))*)\s*(?=[;}])/g;
  const SIZE_PROP = /^(width|height|min-width|min-height|max-width|max-height)$/;
  const hits = [];
  for (const m of cssBare.matchAll(PROP)) {
    for (const tok of m[2].split(/\s+/)) {
      if (tok === '0') continue;
      const n = parseFloat(tok);
      if (n <= 6 || n !== Math.floor(n)) continue;      // 光学微调豁免
      if (SIZE_PROP.test(m[1]) && n <= 30) continue;    // 小元素视觉尺寸豁免
      if (n % 4 !== 0) hits.push(`${tok}（${m[1]}）`);
    }
  }
  check('4px 网格外的间距/尺寸', '必须为 0（≤6px 微调 / ≤30px 元素尺寸豁免）', hits.length === 0,
    hits.length ? hits.slice(0, 6).join(', ') + (hits.length > 6 ? ` … +${hits.length - 6} 更多` : '') : '');
}

// ─────────────────────────────────────────────────────────────
// 6. 彩色 emoji：白名单（盈亏日历情绪脸）之外必须为 0
// ─────────────────────────────────────────────────────────────
{
  const WHITELIST = new Set([...'😊😄😁😍🙁😟😣😱😐']);
  const hits = [];
  for (const [file, src] of [['app.js', jsBare], ['index.html', htmlBare]]) {
    for (const m of src.matchAll(/\p{Extended_Pictographic}/gu)) {
      if (WHITELIST.has(m[0])) continue;
      const line = src.slice(0, m.index).split('\n').length;
      hits.push(`${file}:${line} ${m[0]}`);
    }
  }
  check('彩色 emoji 作界面图标', '必须为 0（白名单：日历情绪脸）', hits.length === 0, hits.slice(0, 5).join(', '));
}

// ─────────────────────────────────────────────────────────────
// 7. 彩色辉光：box-shadow 引用 --primary-glow ≤ 1（仅保留日历「今天」瞬时高亮）
// ─────────────────────────────────────────────────────────────
{
  const n = (cssBare.match(/box-shadow:[^;}]*var\(--primary-glow\)/g) || []).length;
  check('elevation 中的彩色辉光', '≤ 1 处（仅焦点环 / 瞬时高亮）', n <= 1, `实测 ${n} 处`);
}

// ─────────────────────────────────────────────────────────────
// 8. app.js 内联样式：不得写「具体 CSS 声明」，只允许注入自定义属性（--x: v）
// ─────────────────────────────────────────────────────────────
{
  const styles = [...jsBare.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
  const bad = [];
  for (const s of styles) {
    // 去掉 --x: v 形式的自定义属性注入后，若仍残留 `prop: value`，即为非法内联声明
    const rest = s.replace(/--[\w-]+\s*:[^;]*;?/g, '').trim();
    if (/[a-z-]+\s*:/i.test(rest)) bad.push(s.slice(0, 60));
  }
  check('app.js 内联具体样式声明', '必须为 0（动态值只允许 style="--x: v"）', bad.length === 0,
    `共 ${styles.length} 处 style，其中非法 ${bad.length} 处：${bad.slice(0, 3).join(' | ')}`);
}

// ─────────────────────────────────────────────────────────────
// 9. token 存在性：四套档位 + 主题语义 token 必须在 :root 定义
// ─────────────────────────────────────────────────────────────
{
  const REQUIRED = [
    '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-8',
    '--h-1', '--h-2', '--h-3', '--h-4',
    '--fs-xs', '--fs-sm', '--fs-md', '--fs-base', '--fs-lg', '--fs-xl', '--fs-2xl',
    '--r-xs', '--r-sm', '--r', '--r-lg',
    '--up', '--down', '--up-rgb', '--down-rgb', '--danger-rgb', '--warning-rgb',
    '--cal-none', '--cal-up-soft', '--cal-down-text',
    '--cat-fund', '--cat-debt', '--cat-equity', '--cat-wealth', '--cat-cash', '--cat-other', '--cat-hk', '--cat-us',
    '--ma-1', '--ma-2', '--ma-3', '--kl-res', '--kl-sup',
    '--on-primary', '--blur', '--sat', '--row-h', '--card-bg-sticky',
  ];
  const missing = REQUIRED.filter((t) => !new RegExp(`${t}\\s*:`).test(cssBare));
  check('设计 token 定义完整', '四套档位 + 语义 token 必须在 :root 出现', missing.length === 0, missing.join(', '));
}

// ─────────────────────────────────────────────────────────────
// 10. 工具类层存在性（方案 B 的产出，避免被误删）
// ─────────────────────────────────────────────────────────────
{
  const REQUIRED = ['.u-row', '.u-col', '.u-gap-2', '.u-muted'];
  const missing = REQUIRED.filter((c) => !cssBare.includes(c));
  check('utility 层完整', '布局/间距/文字工具类（未被引用的已随死样式清除）', missing.length === 0, missing.join(', '));
}

// ─────────────────────────────────────────────────────────────
// 11. 响应式断点白名单：所有 (min|max)-width 取值必须来自核准集
//     直接把《ui-design-spec.md》§3.13 的断点集变成机器强制，
//     防止再出现孤立 639 / hero 768 未对齐 pano 880 这类漂移。
//     2026-10-28 收敛（三档制）：只适配「手机 / 平板 / 电脑」三种形态 ——
//       手机 ≤640 ｜ 平板 641–1340 ｜ 电脑 ≥1341
//     641 与 1341 是相邻档的 min-width 补位值，不是独立断点。
// ─────────────────────────────────────────────────────────────
{
  const ALLOWED = new Set([640, 641, 1340, 1341]);
  const vals = [];
  // 只在 @media 条件段里取值，避开规则体里的 flex: min-width:0 等
  for (const seg of cssBare.split('@media').slice(1)) {
    const preamble = seg.split('{', 1)[0];
    for (const m of preamble.matchAll(/(?:min|max)-width:\s*(\d+)px/g)) vals.push(parseInt(m[1], 10));
  }
  const bad = [...new Set(vals.filter((v) => !ALLOWED.has(v)))];
  const all = [...new Set(vals)].sort((a, b) => a - b);
  check('响应式断点白名单', '三档制：手机640/平板1340/电脑1341', bad.length === 0,
    bad.length ? `越界断点：${bad.join(', ')}` : `已用断点：${all.join('/')}`);
}

// ─────────────────────────────────────────────────────────────
// 12. 死 class：两层判定
//     硬门 = 类名在 app.js / index.html 中「完全没出现过」（连字符串字面量都没有）→ 必然死；
//     提示 = 严格 class 位置判定（class="…" / classList.x('…') / className=），
//            变量中转（const c = 'lg-up1' → class="… " + c）会落进提示但不阻断。
//     2026-10-28 清理前疑似未引用 251 个 → 硬门口径已归零。
// ─────────────────────────────────────────────────────────────
{
  const BUDGET = 3;
  const defined = new Set();
  for (const rule of cssBare.split('}')) {
    const sel = rule.split('{', 1)[0];
    if (!sel) continue;
    for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);
  }
  const used = new Set();
  const scan = (src) => {
    for (const m of src.matchAll(/\bclass\s*=\s*["'`]([\s\S]*?)["'`]/g)) m[1].split(/\s+/).forEach((c) => c && used.add(c));
    for (const m of src.matchAll(/\.classList\.(?:add|remove|toggle|contains)\(\s*['"]([\w-]+)['"]/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bclassName\s*=\s*["'`]([\s\S]*?)["'`]/g)) m[1].split(/\s+/).forEach((c) => c && used.add(c));
  };
  scan(jsBare); scan(htmlBare);
  const has = (c) => new RegExp('(?<![\\w-])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])').test(jsBare + htmlBare);
  // 动态拼接豁免：`color = ('lg-up' | 'lg-down') + lvl` 这类只有前缀是字面量，
  // 拼出来的 `lg-up1` 在源码里永远搜不到。收集 app.js 里的短小写字符串作为前缀，
  // 类名以它开头且只多出 4 个字符以内（档位/序号）→ 视为动态可达，不算死。
  const dynPrefix = new Set();
  for (const m of jsBare.matchAll(/['"]([a-z][a-z0-9-]{3,20})['"]/g)) dynPrefix.add(m[1]);
  const isDyn = (c) => {
    for (const p of dynPrefix) if (c.startsWith(p) && c.length - p.length <= 4) return true;
    return false;
  };
  const dead = [...defined].filter((c) => !used.has(c));
  const reallyDead = dead.filter((c) => !has(c) && !isDyn(c));
  check('死 class（硬门）', '类名必须至少在源码出现一次（≤ 3 例外）', reallyDead.length <= BUDGET,
    reallyDead.length ? '完全未出现 ' + reallyDead.length + ' 个：' + reallyDead.slice(0, 6).join(', ') : '未发现完全未出现的类');
  check('死 class（提示）', '严格 class 位置判定的未引用数（变量中转落此，不阻断）', true,
    dead.length ? dead.length + ' 个：' + dead.slice(0, 6).join(', ') : '未发现明显未引用类');
}



// ─────────────────────────────────────────────────────────────
// 13. 弹框表单行节奏：描述→控件 4px(--sp-1) / 行间距 12px(--sp-3)
//     历史事故：记流水弹框曾同时出现 12px（描述 label 与控件分离成兄弟行，
//     label 的 margin-bottom 从「行间距」变成「描述→控件」距离）、
//     8px（.sign-edit 的 gap 纵向值与控件 margin-top 双计）、
//     0px（行容器不是 label，拿不到 12px，行距直接归零）三种间距。
//     (a) 规范锚点必须存在（防误删）
//     (b) 弹框内控件的 margin-top 口径不得被局部覆盖
//     (c) 分离式描述（自身不含控件的 <label>）必须带显式描述类
// ─────────────────────────────────────────────────────────────
{
  // (a) 规范锚点：行节奏的唯一定源，删掉任何一条都会让某个弹框重新漂移
  const ANCHORS = [
    ['.modal-card label', 'margin-bottom: var(--sp-3)'],
    ['.modal-card input, .modal-card select, .modal-card textarea', 'margin-top: var(--sp-1)'],
    ['.modal-card label .ac-picker', 'margin-top: var(--sp-1)'],
    ['.sign-edit', 'gap: 0 var(--sp-2)'],
    ['.sign-edit', 'margin: 0 0 var(--sp-3)'],
    ['.sr-label', 'margin-bottom: 0'],
  ];
  // 把样式表拆成 { 选择器[], 声明体 }（@media 内规则仍能被逐条拆出，只会多一条垃圾项，无害）
  const rules = [];
  for (const chunk of cssBare.split('}')) {
    const i = chunk.indexOf('{');
    if (i < 0) continue;
    rules.push({
      sels: chunk.slice(0, i).split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
      body: chunk.slice(i + 1).replace(/\s+/g, ' '),
    });
  }
  const missing = ANCHORS.filter(([sel, decl]) => {
    // 锚点可能是多选择器规则（.modal-card input, .modal-card select, …）：逐个子选择器都要被覆盖
    const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
    return !parts.every((p) => rules.some((r) => r.sels.includes(p) && r.body.includes(decl)));
  }).map(([sel, decl]) => `${sel} { ${decl} }`);
  check('弹框行节奏 · 规范锚点', '6 条锚点规则必须存在（防误删）', missing.length === 0,
    missing.length ? '缺失：' + missing.join(' ; ') : '6/6 在位');
}

{
  // (b) 弹框内 input/select/textarea 的 margin-top 只允许锚点值或 0（显式清零），
  //     不许某个弹框单独改成 8px/16px 把「描述→控件」做出局部不一致
  const hits = [];
  let scanned = 0;
  for (const chunk of cssBare.split('}')) {
    const i = chunk.indexOf('{');
    if (i < 0) continue;
    const selPart = chunk.slice(0, i);
    if (!/\.modal-card/.test(selPart)) continue;
    if (!/\b(input|select|textarea)\b/.test(selPart)) continue;
    scanned++;
    for (const m of chunk.slice(i).matchAll(/margin-top\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (v !== 'var(--sp-1)' && v !== '0') hits.push(`${selPart.trim()} → ${v}`);
    }
  }
  check('弹框控件 margin-top 口径', '只允许 var(--sp-1) 或 0', hits.length === 0,
    hits.length ? hits.slice(0, 3).join(' | ') : `已扫描 ${scanned} 条规则`);
}

{
  // (c) 分离式描述：<label>描述</label> 自身不含控件时，它的 margin-bottom:12px
  //     会从「行间距」变成「描述→控件」距离（记流水弹框原始 bug）。
  //     必须带显式描述类（.field-label / .sr-label，margin-bottom:0），
  //     让「描述→控件」只由控件的 margin-top 独供。
  const DESC = /\bclass\s*=\s*["'][^"']*\b(?:field-label|sr-label)\b/;
  const CTL = /<input|<select|<textarea|class=["']?ac-picker/;
  const bad = [];
  for (const [file, src] of [['index.html', htmlBare], ['app.js', jsBare]]) {
    for (const m of src.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)) {
      if (CTL.test(m[2])) continue;                 // 嵌套式：描述与控件同 label，合规
      if (/\$\{/.test(m[2])) continue;              // 动态内容，静态无法判定
      if (DESC.test(m[1])) continue;                // 带显式描述类，间距由专属规则接管
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${file}:${line} «${m[2].replace(/\s+/g, ' ').trim().slice(0, 16)}»`);
    }
  }
  check('弹框分离式描述', '须带 field-label / sr-label 类（否则 12px 会变成描述→控件距离）',
    bad.length === 0, bad.length ? bad.slice(0, 4).join(', ') + (bad.length > 4 ? ` … +${bad.length - 4}` : '') : '未发现');
}

// ─────────────────────────────────────────────────────────────
// 17. 动态拼接类名的样式锚点（防误删）
//     日历格子的类名是 JS 拼出来的（`'lg-' + (v > 0 ? 'up' : 'down')` + 选中时的 `is-sel`），
//     源码里没有 `lg-up` 这种独立字面量而是拼装片段 → 死样式脚本容易整组删掉；
//     而第 12 项（CSS 有、源码无 → 死）也发现不了，因为 CSS 里已经没了。
//     这类样式只能靠锚点守住：2026-10-28 盈亏日历 8 档底色就是这样被删空的。
//     v4 起收敛为「浅色表方向 + 重色表选中」，锚点相应改为 4 条。
// ─────────────────────────────────────────────────────────────
{
  const ANCHORS = [
    ['.cal-cell.lg-up', '--cal-up-soft'],
    ['.cal-cell.lg-down', '--cal-down-soft'],
    ['.cal-cell.lg-up.is-sel', '--cal-up-strong'],
    ['.cal-cell.lg-down.is-sel', '--cal-down-strong'],
  ];
  const missing = ANCHORS.filter(([sel, tok]) => {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*background\\s*:\\s*var\\((' + tok + ')\\)');
    return !re.test(cssBare);
  }).map(([sel]) => sel);
  check('动态类名样式锚点', '日历浅色/选中重色 4 条底色必须存在（类名由 JS 拼接）', missing.length === 0,
    missing.length ? '缺失 ' + missing.length + ' 条：' + missing.join(', ') : '4/4 在位');
}

// ─────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
console.log('\n  UI 一致性校验（v3 设计规范 §5）\n');
console.log('  ' + pad('检查项', 26) + pad('要求', 34) + '结果');
console.log('  ' + '─'.repeat(78));
for (const r of results) {
  console.log('  ' + pad(r.name, 26) + pad(r.detail, 34) + (r.ok ? '✅' : '❌') + (r.extra ? '  ' + r.extra : ''));
}
const failed = results.filter((r) => !r.ok);
console.log('  ' + '─'.repeat(78));
console.log(`  ${results.length - failed.length}/${results.length} 通过\n`);
if (failed.length) {
  console.error(`  ✗ ${failed.length} 项未通过，请在 web/style.css 与 web/app.js 中修正后重跑。\n`);
  process.exit(1);
}
