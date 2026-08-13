# portfolio 前端设计系统 · 组件与样式落地任务清单

> 适用对象：`portfolio/web/` 下的 `index.html` / `app.js` / `style.css`。
> 注意：`web/` 经 `//go:embed web` 打进二进制，任何前端改动必须 `docker compose build --no-cache && docker compose up -d --force-recreate` 才生效。
> 本清单的目标：把八方面设计规范收敛成**固定 class + CSS 变量**，禁止散落写死的色值/间距/圆角。

---

## 0. 全局 Token 收敛表（一切的基础，先做）

所有色值、间距、圆角、尺寸统一收口到 `:root`，组件只引用变量、不写死。在 `style.css` 顶部 `:root` 与 `[data-theme="light"]` 两块补齐下列变量（已有变量沿用，缺失补齐）：

```css
:root{ /* 暗色主题（默认） */
  /* 背景与文字 */
  --bg:#0f1115; --bg-card:#171a21; --bg-card-alt:#1d2129;
  --text:#e5e7eb; --text-muted:#9ca3af; --text-faint:#6b7280;
  --border:rgba(255,255,255,.08);          /* 边框 1px，不用阴影 */
  /* 涨跌与主题色（涨=红 跌=绿，国内惯例） */
  --up:#f87171; --down:#4ade80;
  --primary:#3b82f6; --primary-press:#2563eb;
  /* 间距 token（卡片三件套） */
  --card-gap:12px;   /* 卡片之间 */
  --card-pad:14px;   /* 卡内边距 */
  --section-gap:20px;/* 区块之间 */
  /* 形状与尺寸 */
  --radius:12px;                       /* 圆角统一 12px */
  --btn-h:34px; --icon-btn:36px;      /* 按钮高 / 图标按钮边长 */
  --row-h:42px;                       /* 列表行高 40-44px */
  --touch:36px;                       /* 最小可点区 */
}
[data-theme="light"]{ /* 亮色主题覆盖 */
  --bg:#f7f8fa; --bg-card:#ffffff; --bg-card-alt:#f1f3f5;
  --text:#1f2937;
  --text-muted:#6b7280;   /* ★ 浅色调深：亮色下 muted 必须到 #6b7280 保证对比度（a11y 七） */
  --text-faint:#9ca3af;
  --border:rgba(0,0,0,.08);
  --up:#dc2626; --down:#16a34a;
}
```

**断点 token（写注释锁定，不允许出现第四个值）**：
- 桌面 `≥1024px`（默认）
- 平板 `640–1023px` → `@media (max-width:1023px)`
- 手机 `<640px` → `@media (max-width:639px)`

**验收**：全局 grep 确认 `style.css` 内除 token 定义外，不再出现裸色值（如 `#171a21` 直接写在 `.xxx{...}` 规则里）、不再出现 `12px/14px/20px` 间距硬编码（改用 `--card-gap/--card-pad/--section-gap`）。

---

## 一、两级页面定位（一级=持仓列表 / 二级=资产全景等）

**约束**
- 一级页（持仓列表）：高密度操作台，信息密集、操作就近、强调效率。
- 二级页（资产全景、盈亏走势等）：中低密度报告页，字号降半档、色彩克制、留白增加、视觉权重更低。
- 所有二级页页头统一含显式「← 返回」。

**落地任务**
1. 新增页容器修饰类：默认 `.page`（一级）；二级页根节点加 `.page--secondary`。
   - `.page--secondary{ --page-fs:14px; padding-top:calc(var(--section-gap) + 4px); }`（一级用 15px，二级降半档到 14px，靠 `--page-fs` 驱动正文）。
   - 二级页强制 `--up/--down` 仅在数值/辅助层出现，报告页不滥用彩色块（色彩克制）。
2. 抽出统一页头组件（HTML 模板，所有页复用）：
   ```html
   <header class="page-head">
     <button class="icon-btn page-back" aria-label="返回">←</button>
     <h1 class="page-head__title">资产全景</h1>
     <div class="page-head__actions"><!-- 操作区：弹窗主按钮居右 --></div>
   </header>
   ```
   - 一级页可不带 `page-back`（它本身就是根）；二级页必须带。
   - 二级页 `page-head__title` 字号随 `--page-fs` 降半档。
3. `app.js`：每个二级页打开时（如 `showAssetView`）确认其根节点有 `.page--secondary` 且页头含 `.page-back`，点击 `page-back` 回到一级并恢复一级视图状态。

**涉及文件**：`style.css`（`.page/.page--secondary/.page-head*`）、`index.html`（抽页头模板）、`app.js`（二级页打开逻辑）。
**验收**：二级页正文比一级页小半档；任意二级页页头左端均有「← 返回」且可回到一级；grep 确认无第二种手写页头结构。

---

## 二、按钮规范（主/次/图标三级）

**约束**
- 三级：`主按钮 .btn-primary` / `次按钮 .btn-secondary` / `图标按钮 .icon-btn`（高 34px，图标按钮 36×36）。
- 单视图仅一个主按钮；弹窗主按钮填充主色且居右。
- 位置间隔按层级：视口级（页头右）、区块级（卡片/区内右或底部）、弹窗级（modal-foot 右对齐）、危险操作（与一般操作隔开 ≥ `--section-gap` 或用分隔线）。
- 四状态：悬停、`:active` 缩放、禁用（opacity .45 + `title`）、加载（spinner + 禁用）。

**落地任务**
1. 固定 class（禁变体）：
   ```css
   .btn{ height:var(--btn-h); padding:0 14px; border-radius:var(--radius);
         border:1px solid var(--border); background:var(--bg-card-alt);
         color:var(--text); font-size:14px; display:inline-flex; align-items:center;
         gap:6px; cursor:pointer; transition:transform .08s, background .15s; }
   .btn-primary{ background:var(--primary); border-color:var(--primary); color:#fff; }
   .btn-secondary{ background:var(--bg-card); }
   .icon-btn{ width:var(--icon-btn); height:var(--icon-btn); padding:0;
              border-radius:var(--radius); border:1px solid var(--border);
              background:var(--bg-card-alt); color:var(--text);
              display:inline-flex; align-items:center; justify-content:center; }
   /* 状态 */
   .btn:hover,.icon-btn:hover{ filter:brightness(1.08); }
   .btn:active,.icon-btn:active{ transform:scale(.97); }
   .btn:disabled,.btn.is-loading,
   .icon-btn:disabled,.icon-btn.is-loading{ opacity:.45; cursor:not-allowed; pointer-events:none; }
   .btn.is-loading::after,.icon-btn.is-loading::after{ /* spinner 12px，margin-left:6px */ }
   ```
2. 单视图唯一主按钮：约定每个 `.view`/`.page` 内至多一个 `.btn-primary`；弹窗主按钮放 `.modal-foot` 且：
   ```css
   .modal-foot{ display:flex; justify-content:flex-end; gap:8px; }
   ```
3. 危险操作类 `.btn-danger{ background:var(--down); ... }`（危险用跌绿色调或独立警示红，按需），与正常操作之间加 `margin-top:var(--section-gap)` 或 `<span class="atool-sep">` 分隔。
4. 禁用项必须有 `title`（如「行情刷新中」）；加载态加 `is-loading` 并显示 spinner，禁止在加载时重复点击（pointer-events:none 已覆盖）。

**涉及文件**：`style.css`（按钮体系）、`index.html`（替换现有手写按钮）、`app.js`（加载态切换：`btn.classList.add('is-loading')` + 结束后移除）。
**验收**：全局仅 `.btn/.btn-primary/.btn-secondary/.icon-btn/.btn-danger` 五种按钮类；每个视图主按钮 ≤1；禁用态 opacity=.45 且 hover 不触发；`:active` 可见缩放。

---

## 三、卡片规范（三间距 token + 三层结构）

**约束**
- 间距收口：`--card-gap:12px`、`--card-pad:14px`、`--section-gap:20px`。
- 卡内固定三层：标签 `.c-label` / 数值 `.c-value` / 辅助 `.c-aux`；数值字号 ≥ 标签的 1.5 倍；涨跌色**仅限**数值层与辅助层（标签层不用涨跌色）。
- 圆角统一 12px；背景两态（默认 / 交替 `--bg-card-alt`）；边框 1px、**不用阴影**。

**落地任务**
1. 固定卡片类（两底态）：
   ```css
   .card{ background:var(--bg-card); border:1px solid var(--border);
          border-radius:var(--radius); padding:var(--card-pad); }
   .card--alt{ background:var(--bg-card-alt); }   /* 两态之一，禁止第三态/阴影 */
   .cards-grid{ display:grid; gap:var(--card-gap); grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); }
   .section{ margin-bottom:var(--section-gap); }
   ```
2. 卡内三层结构（HTML 模板）：
   ```html
   <div class="card"><div class="c-label">现金</div>
     <div class="c-value">¥12,340</div>
     <div class="c-aux up">+1.2%</div></div>
   ```
   ```css
   .c-label{ font-size:13px; color:var(--text-muted); }
   .c-value{ font-size:21px; line-height:1.2; color:var(--text); margin:2px 0; } /* ≥13*1.5=19.5 */
   .c-aux{ font-size:13px; } .c-aux.up{ color:var(--up); } .c-aux.down{ color:var(--down); }
   ```
   - 涨跌色只允许出现在 `.c-value`（数值本身涨跌）与 `.c-aux`，`.c-label` 永远 `--text-muted`。
3. 卡片间距一律用 `--card-gap`；区块间距用 `--section-gap`；卡内边距用 `--card-pad`。禁止在卡片规则里写死 `padding:16px` 之类。

**涉及文件**：`style.css`（`.card/.card--alt/.cards-grid/.section/.c-*`）、`index.html`/`app.js`（持仓卡片 `renderCards`、统计卡 `renderSummary` 改用三层结构）。
**验收**：所有卡片圆角=12px、1px 边框、无 `box-shadow`；数值字号 ≥ 标签 1.5 倍；涨跌色只出现在数值/辅助层；grep 确认卡片间距全部引用 `--card-gap`。

---

## 四、列表规范（对齐 / 行高 / 骨架 / 空态）

**约束**
- 数字右对齐、文本左对齐、操作居中，表头与数据列对齐一致。
- 行高 40–44px（用 `--row-h:42px`），仅行分割线、透明度 ≤8%。
- 骨架屏替代转圈；刷新时保留旧数据并顶部显示进度条。
- 空态区分「初始无数据」与「筛选无结果」；失败态就地重试按钮。

**落地任务**
1. 表格对齐与行高：
   ```css
   .tbl{ width:100%; border-collapse:collapse; }
   .tbl th,.tbl td{ height:var(--row-h); padding:0 10px;
                    border-bottom:1px solid var(--border); } /* --border 暗色 .08 / 亮色 .08，均 ≤8% */
   .tbl th{ color:var(--text-muted); font-weight:600; text-align:left; }
   .tbl .num{ text-align:right; font-variant-numeric:tabular-nums; }
   .tbl .act{ text-align:center; }
   ```
   - 表头 `.num`/`.act` 必须与数据列同对齐类。
2. 骨架屏（首次加载，不转圈）：
   ```css
   .skeleton{ background:linear-gradient(90deg,var(--bg-card) 25%,var(--bg-card-alt) 37%,var(--bg-card) 63%);
              background-size:400% 100%; animation:sk 1.2s infinite; border-radius:6px; }
   @keyframes sk{ 0%{background-position:100% 0} 100%{background-position:-100% 0} }
   ```
   - `renderRows` 在数据未到时渲染 N 行 `.skeleton` 占位，而非 spinner。
3. 刷新保留旧数据 + 进度条：`/api/refresh` 发起时，表格保留现有行，仅在 `.list-actions` 顶部插入 `<div class="refresh-bar"><i></i></div>`（CSS 宽度动画 0→90%），完成即移除；禁止清空表格再转圈。
4. 空态双形态：
   - `.empty--initial`（首次无持仓）：引导文案 + 「➕ 添加第一笔持仓」按钮（`openModal(null)`）。
   - `.empty--filtered`（筛选无结果）：文案「没有符合筛选条件的持仓」+「清除筛选」按钮，无添加按钮。
   - 失败态 `.error-inline`：文案 + 「重试」按钮就地重发请求，不跳页。

**涉及文件**：`style.css`（`.tbl*/.skeleton/.refresh-bar/.empty--*/.error-inline`）、`app.js`（`renderRows` 骨架分支、`refreshBtn` 进度条、`renderFiltered` 空态分支）。
**验收**：数字列右对齐且表头同列同对齐；行高 42px；刷新时旧数据不丢且见进度条；空态能区分初始/筛选两种；失败态有就地重试。

---

## 五、响应式（三断点 + 移动适配）

**约束**
- 锁定三断点：`≥1024`（默认）/ `640–1023` / `<640`。
- 手机端表格转卡片；弹窗 `94vw`、限高 `90vh`、内部滚动；可点区 ≥36px。

**落地任务**
1. 在 `style.css` 顶部注释锁定断点，仅用两条 media：
   ```css
   /* BP: ≥1024 默认 | 640–1023 @media(max-width:1023px) | <640 @media(max-width:639px) */
   @media (max-width:1023px){ /* 平板：收紧卡片列数、页头换行 */ }
   @media (max-width:639px){   /* 手机：表格→卡片、弹窗 94vw */
     #tbl{ display:none; } #cards{ display:grid; }   /* 复用 P0-3 卡片视图 */
     .modal{ width:94vw; max-height:90vh; overflow:auto; }
     .btn,.icon-btn,.nav-item{ min-height:var(--touch); min-width:var(--touch); }
   }
   ```
2. 手机表格转卡片：复用已实现的 `#viewToggle` 卡片模式，在 `<640` 强制 `holdingsView='card'`（JS 在 resize 时若宽度 <640 且用户未手动切过，则渲染卡片）。
3. 弹窗统一 `.modal{ width:min(520px,94vw); max-height:90vh; overflow:auto; }`，移动端自然落到 94vw。
4. 所有可点元素（按钮、tab、角标、卡片）`min-width/height:var(--touch)` 保证 ≥36px。

**涉及文件**：`style.css`（media 块、`.modal`、touch 规则）、`app.js`（resize 监听强制卡片）。
**验收**：`<640` 时表格隐藏、卡片显示；弹窗宽度 94vw 且内部可滚动不溢出视口；任意可点元素实测 ≥36px。

---

## 六、操作路径（效率与记忆）

**约束**
- 核心路径 ≤2 击保持。
- 补「/」聚焦筛选、`Enter` 提交表单。
- 二级页记忆 tab / 日历月份 / 折叠态（localStorage）。
- 删除/重置二次确认，且文案写动作本身（如「删除该持仓？」而非「确定吗」）。

**落地任务**
1. 全局快捷键（`app.js` 顶层 `keydown`）：若 `e.key==='/'` 且当前无输入框聚焦 → `e.preventDefault()` 并 `document.getElementById('filterInput').focus()`。
2. 表单 `submit` 事件：`filterForm` / 任意内联表单监听 `submit` → 阻止默认 + 执行筛选/提交；输入框 `keydown` 监听 `Enter` 触发同一处理。
3. 二级页状态持久化（localStorage 键前缀 `pf_`）：
   - 资产全景当前 tab → `pf_asset_tab`
   - 日历视图月份 → `pf_cal_month`（已是 `calViewDate`，序列化 y/m）
   - 折叠态 → `pf_collapse_<id>`
   - 打开二级页时读取并恢复，离开时写回。
4. 确认文案规范：`confirm('删除该持仓？此操作不可撤销')` / `confirm('重置全部数据？')` —— 必须出现具体动作名词，禁止「确定执行该操作吗」。删除/重置统一走二次确认函数 `confirmDestructive(actionLabel, cb)`。

**涉及文件**：`app.js`（keydown、表单提交、状态读写、confirmDestructive）、`index.html`（表单 `id`、筛选输入 `id="filterInput"`）。
**验收**：按「/」聚焦筛选；Enter 提交表单生效；刷新后二级页 tab/月份/折叠态保留；删除/重置弹窗文案含动作本身且需二次确认。

---

## 七、a11y（可达性）

**约束**
- `--text-muted` 浅色主题调到 `#6b7280`（已在一/0 落实）。
- `:focus-visible` 加 2px 主色描边。
- 红绿处必有 `▲▼` 或 `+/-` 兜底（不靠颜色单独传达涨跌）。
- `icon-btn` 的 `aria-label` 与 `data-tip` 必须同步。

**落地任务**
1. 全局焦点描边：
   ```css
   :focus-visible{ outline:2px solid var(--primary); outline-offset:2px; border-radius:4px; }
   ```
2. 涨跌不靠色 alone：所有 `.up/.down` 渲染处同时输出方向符号——数值层用 `▲`/`▼`（或 `+`/`-`），辅助层同理；纯色块（如统计卡涨跌家数）旁必须带 `▲▼` 或文字「涨/跌/平」。
3. `icon-btn` 强制 `aria-label`（与 `data-tip` 内容一致），新增图标按钮时两属性必须同时写入；`app.js` 提供 `makeIconBtn(icon, label)` 保证同步，禁止手写只带 `data-tip` 的图标按钮。

**涉及文件**：`style.css`（`:focus-visible`）、`app.js`（`makeIconBtn`、涨跌渲染补符号）、`index.html`（既有 icon-btn 补全 aria-label）。
**验收**：键盘 Tab 焦点可见 2px 主色描边；任意红/绿元素均有 ▲▼ 或 +/- 文字兜底；全部 `icon-btn` 同时具备 `aria-label` 与 `data-tip` 且一致。

---

## 八、落地机制（把规范钉死）

**约束**
- 色值/间距/圆角全部收敛为 CSS 变量（见第 0 节）。
- 按钮三级、卡片两底、弹窗头部做成固定 class，**禁止变体**。
- 二级页共用「← 返回 + 标题 + 操作区」页头模式（见第一节）。
- 统一 modal 关闭位为 `.card-close`。

**落地任务**
1. **变量收口**：完成第 0 节后，全量排查 `style.css`、`index.html` 内联 style、`app.js` 动态注入的 style，把所有裸色值/裸间距替换为变量；建立 pre-commit grep 自检（CI 或手动）：出现 `#xxxxxx` 直接报错（token 定义块白名单除外）。
2. **固定组件类（禁变体）**：
   - 按钮仅 `.btn/.btn-primary/.btn-secondary/.icon-btn/.btn-danger` 五种，删除所有 `.xxx-btn--big`、`.blue-btn` 之类变体。
   - 卡片仅 `.card/.card--alt` 两底，删除 `.panel`、`.box`、`.widget` 等重复容器，统一改 `.card`。
   - 弹窗头部统一 `<div class="modal-head"><h3>标题</h3><button class="icon-btn card-close" aria-label="关闭">×</button></div>`，所有弹窗复用，关闭按钮永远 `.card-close` 右上角，`app.js` 统一委托 `.card-close` 关闭。
3. **二级页页头模式**：所有二级页用第一节抽取的 `.page-head` 模板，`page-back` + `page-head__title` + `page-head__actions` 三件套，不允许存在第二种页头写法。
4. **存量重构顺序**（建议提交拆分，便于回滚）：
   1. 第 0 节 Token 表 + 第 8 节变量收口（基础设施）。
   2. 按钮体系（二）→ 卡片体系（三）→ 列表体系（四）。
   3. 响应式（五）+ 操作路径（六）+ a11y（七）。
   4. 两级页头与 modal 头部统一（一 + 八的 2/3）。

**涉及文件**：`style.css`、`index.html`、`app.js` 三件套全量收敛。
**验收**：grep 确认无非 token 裸色值/裸间距；按钮类仅 5 种、卡片类仅 2 种、弹窗头部结构唯一且关闭按钮均为 `.card-close`；二级页页头结构唯一。

---

## 附：改动文件与部署清单
- **改动文件**：`web/style.css`（Token + 全部组件类）、`web/index.html`（页头模板、按钮/卡片/弹窗结构、表单 id）、`web/app.js`（快捷键、状态持久化、加载/禁用态、骨架/进度条、卡片切换、确认函数、icon-btn 同步）。
- **部署**：改完前端 → `git commit` → `./update-version.sh` → `scp` 到 `/mnt/nvme0n1-4/portfolio`（排除 `.git`/`data`）→ `docker compose build --no-cache && docker compose up -d --force-recreate` → 核验 `/api/version` 与页面 DOM。
- **灰度建议**：按第 8 节四步顺序分 4 个 commit 提交，每步独立可回滚；先在非交易时段部署，浏览器实测卡片切换 / 补仓标记 / 日历跳转 / 工具栏引导 / 空状态后再全量。
