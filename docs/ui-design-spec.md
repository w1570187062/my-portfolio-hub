# 观澜 UI 设计规范

> v1.0 · 2026-09-10 · 状态：**已定案，按批次实施**
> 参考源：WorkBuddy Playbook《完整装修工作台》单体 HTML（Oat & Umber 组件库）
> 落地文件：`web/style.css`（**唯一样式真源**）、`web/index.html`（不再放业务样式）、`web/app.js`（仅负责主题变量注入）

---

## 0. 定案决策

| 议题 | 结论 |
|---|---|
| 配色 | **不移植**参考的暖纸感配色。portfolio 保持深色科技风 + 可切主题色（gold / green / blue / custom） |
| 毛玻璃 | **保留**，但降强度：`blur 12px → 8px`、`saturate 160% → 120%`；表格与卡片不再各自叠加 |
| 金额数字 | **保留 mono**，统一补 `font-variant-numeric: tabular-nums`，不引入衬线体 |
| 卡片悬停 | **去掉上浮位移**，只保留阴影升级（避免网格内相邻卡片视觉抖动） |
| 主按钮文字 | 新增 `--on-primary` 令牌。金色/绿色主题改深色字（对比度 2.2:1 → 9.4:1），蓝色保留白字 |

---

## 1. 设计原则

**移植的是结构规则，不是配色。**

1. **层级决定形状** —— 圆角/阴影按「控件 → 卡片 → 浮层」三级取值，不按元素随手取。
2. **描线优先于色块** —— 面的边界用 1px 描线表达；实色块只留给主操作与选中态。
3. **眉标统一次级文字** —— 表头、表单标签、卡片小标题统一走 `.eyebrow` 规格（11–12px / 字距 .5px / 大写 / muted）。
4. **高度靠阴影，不靠位移** —— 悬停提升阴影层级，不做 `translateY`。
5. **提示条优于告警块** —— 用「淡底 + inset 描线 + 色点」承载提示，不用整块饱和色。
6. **数字等宽对齐** —— 所有金额、百分比、日期必须 `tabular-nums`。
7. **同层只用一种材质** —— 卡片与表格不同时挂 `backdrop-filter`。

---

## 2. Token 层（唯一定义处：`style.css` 的 `:root`）

### 2.1 表面

| 令牌 | 暗色 | 亮色 | 用途 |
|---|---|---|---|
| `--bg` | `#0a0e14` | `#f4f6f9` | 页面底 |
| `--bg-card` | `rgba(20,26,36,.82)` | `rgba(255,255,255,.85)` | 卡片 / 表格 / 工具卡（毛玻璃） |
| `--bg-card-solid` | `#141a24` | `#ffffff` | 弹窗 / 下拉 / 悬浮层（不透明） |
| `--bg-input` | `rgba(255,255,255,.05)` | `rgba(0,0,0,.03)` | 输入控件底 |
| `--bg-soft` | `rgba(255,255,255,.06)` | `rgba(15,23,42,.05)` | 次级按钮/片段底（**原缺失，B1 补齐**） |
| `--bg-hover` | `rgba(tint,.08)` | `rgba(tint,.07)` | 行/项悬停 |

### 2.2 描线

| 令牌 | 值 | 用途 |
|---|---|---|
| `--border` | 白 8% / 深 10% | 默认描线 |
| `--border-strong` | 白 16% / 深 20% | 悬停 / 强调 |
| `--row-divider` | 白 6% | 表格行分割 |
| `--sub-divider` | 白 10% | 子表横向分割 |

### 2.3 形状

| 令牌 | 值 | 用途 |
|---|---|---|
| `--r-xs` | `6px` | **微件**：仅限高度 < 28px 的徽标、标签、代码块、进度条 |
| `--r-sm` = `--btn-radius` | `10px` | 控件：按钮、输入框、图标容器 |
| `--r` = `--card-radius` | `16px` | 卡片、面板、表格外框、工具卡 |
| `--r-lg` | `22px` | 弹窗、底部抽屉、登录框 |

**允许的例外（不进 token）**：`999px`（胶囊：chip / pill / 标签页）、`50%`（圆形：圆点、头像、圆钮）、`0`（贴合容器的内表格）、`2–3px`（图例色块、进度条）。

> 收敛成果：`border-radius` 的**不同取值从 19 种降到 5 种 token + 4 种例外**（token 占比从 ~30% 升到 ~88%）。

### 2.4 高度

| 令牌 | 用途 |
|---|---|
| `--sh-1` | 静态卡片 |
| `--sh-2` | 悬停卡片 |
| `--sh-3` | 弹窗 / 浮层 |

### 2.5 动效

| 令牌 | 曲线 | 用途 |
|---|---|---|
| `--e` | `cubic-bezier(.4,0,.2,1)` | 通用颜色/背景过渡 |
| `--e-out` | `cubic-bezier(.16,1,.3,1)` | 入场 |
| `--e-back` | `cubic-bezier(.34,1.46,.64,1)` | 按下回弹 |

### 2.6 主色与前景

| 令牌 | 说明 |
|---|---|
| `--tint` / `--primary` / `--primary-hover` / `--primary-active` | 主题色阶（三套预设 + custom 由 JS 注入） |
| `--primary-soft` / `--primary-glow` | 主色派生淡底 / 辉光 |
| **`--on-primary`** | **主色实心底上的文字色。新增，用于修复白字在金色底上仅 2.2:1 的对比度缺陷** |
| `--up` / `--down` | 涨跌**文字**色（红涨绿跌） |
| `--up-solid` / `--down-solid` | 涨跌**实心底**色（饱和度更高，保证白字可读），用于圆钮与角标 |
| `--up-rgb` / `--down-rgb` / `--signal-neu-rgb` | 三元组，供 `rgba(var(--up-rgb), .12)` 这类淡底使用 |
| `--signal-neu` | 中性信号色（技术分析第三色阶：涨/跌/中性） |

> **实心主色底一律用 `--on-primary` 取字色。** 已覆盖：`.btn.primary`、`.src-chip.active`、`.adj-tab.active`、
> `.atab.active`（×2）、`.ana-tab-btn.active`、`.ds-t-seg button.active`、`.pg-num.active`、`.src-badge`、
> `.hist-tabs .tab.active`、`.vr-cur`、`.cal-back:hover`、`.login-box button`、`.ur-cur`、
> `.view-toggle .vt-btn.active`（暗色走 `--on-primary`，亮色指示块是白底故走 `--text`）。
> 校验方式：`getComputedStyle` 读取；**注意 `--btn-transition` 含 200ms 颜色过渡，切换主题后必须等 1s 再取值**，
> 否则读到过渡起始帧会误判为「没生效」。

`--on-primary` 取值：

| 主题 | 暗色 | 亮色 |
|---|---|---|
| gold | `#241a06`（深色） | `#ffffff` |
| green | `#101c0a`（深色） | `#ffffff` |
| blue | `#ffffff` | `#ffffff` |
| custom | JS 按相对亮度自动择深/浅 | 同 |

---

## 3. 组件规范

### 3.1 按钮族（只准这 5 类）

| 类 | 语义 | 底 | 字 | 悬停 | 按下 |
|---|---|---|---|---|---|
| `.btn` | 次级（默认） | ghost 底 + `--border` | `--primary` | 底变实、边框加深、上浮 1.5px | `scale(.96)` |
| `.btn.primary` | 主操作，**一屏 ≤1 个** | `--btn-primary` | `--on-primary` | 加深 + 阴影升级 | 再深 |
| `.btn.danger` | 破坏性 | `--btn-danger` | `#fafafa` | 加深 | 再深 |
| `.btn.icon-btn` | 纯图标 | 同 `.btn` | 同 `.btn` | 同上 | 同上 |
| `.src-chip` / `.chip` | 单选/多选筛选 | 透明 + 描线胶囊 | `--text-muted` | 底变实 | 选中 = 实心 + `--on-primary` |

共同约束：`min-height: var(--btn-h)`、`border-radius: var(--btn-radius)`、`font-size: 13–14px`、`transition: var(--btn-transition)`、`white-space: nowrap`。

**禁止新增按钮类**，新场景用现有变体组合。

### 3.2 卡片

- 表面 `--bg-card` + `1px solid var(--border)` + `--r` + `--sh-1`
- 悬停：**只升到 `--sh-2`，不做位移**
- 可折叠帽子：底 `rgba(255,255,255,.03)`（亮色 `#f1f3f6`），下描线 `--border`

### 3.3 表格

- `table` 自身**不带**圆角、阴影、模糊；外框由 `.table-wrap` 提供（横向滚动时圆角不裂、可支持粘性表头）
- `th`：眉标规格 + 底 `rgba(255,255,255,.03)` + 下描线 `--border`
- `td`：行高 `--row-h`，下描线 `--row-divider`
- 行悬停：`--bg-hover`
- 操作列：默认 `opacity: 0`，行悬停淡入；`@media (hover: none)` 常显
- 金额/百分比列：`font-variant-numeric: tabular-nums`

**⚠ 列宽铁律：`table-layout: fixed` 下禁止用百分比表达「按内容自适应」。**
`width: 1%` 不是「尽量窄」，而是「表格宽度的 1%」——在 1388px 宽的表格里等于 **13.9px**，
图标按钮会被 `td` 的 `overflow: hidden` 整颗裁掉，表现为「操作列整个消失」。
操作列等需要固定占位的列**必须给像素值**（本页子表操作列 = `108px` = 3×28 图标 + 2×6 间距 + td padding）。
只有 `table-layout: auto`（如 `.asset-table`、`#tbl`）才可以写 `width: 1%` 表达「按内容收缩」。

### 3.3.1 行内操作按钮族（表格「操作」列统一，B3 落地）

**问题**：同一语义在四处长得不一样。

| 位置 | 现状 | 实例 |
|---|---|---|
| 首页主表 `app.js:1020` | emoji 当图标 | `📊` `✏️` `📈` `🗑️` |
| 分组子表行内 `app.js:655–656` | 带文字描线按钮 | `修改` / `分析` |
| 分组子表操作列 `app.js:673–675` | 纯文字无边框 `.row-act` | `编辑` / `历史` / `删除` |
| 资产全景各表 `app.js:4093,4238,4316+` | 描线按钮，**文字长度随数据变化** | `子账户（3）` / `＋子账户` / `每日盈亏` / `减仓` |

**统一规则**

1. **一律纯图标**，不用文字按钮，不用 emoji。
   - emoji 不可控：跨系统渲染不同、无法跟随主题色、截图/打印会变彩色。
2. **一律内联 SVG + `currentColor`**，线性描边 `stroke-width: 1.6–1.8`（与 header 图标同款）。
3. **尺寸 28×28**，`border-radius: var(--r-sm)`，透明底；悬停 `background: var(--bg-hover)`。
4. **默认 `opacity: 0`，行悬停淡入**（每颗延迟 40ms 依次出现）；`@media (hover: none)` 下常显。
5. **语义色只三档**：默认 `--text-muted`、信息 `--primary`、危险 `--danger`。禁止出现第四种。
6. **计数不写进按钮**。`子账户（3）` 的计数移到名称列或子表头，按钮只表示动作。
7. **无障碍**：每颗按钮必须有 `aria-label`，并保留 `title` 作桌面/长按兜底。
8. **不碰 `data-*` 钩子**。`data-edit` / `data-del` / `data-hist` / `data-adjust` / `data-act` 是事件委托键，改造只换标签内容与 class。
9. **操作列宽度必须给像素值**（当前 `108px` = 3×28 图标 + 2×6 间距 + td padding）。
   ⚠ 本条曾写作「`width: 1%` + `white-space: nowrap`」，在 `table-layout: fixed` 的持仓子表上直接把操作列压成
   **13.9px**、图标被 `overflow: hidden` 裁光（表现为「操作列整个消失」）。百分比列宽只在 `auto` 布局的表上可用，
   详见 §3.3 列宽铁律。

**图标字典（唯一映射，新增操作必须先登记）**

| 语义 | 图标 | 色 |
|---|---|---|
| 编辑 / 修改 | 铅笔 | `--primary` |
| 历史 / 走势 | 折线图 | 默认 |
| 删除 | 垃圾桶 | `--danger` |
| 加减仓 | 上下双向箭头 | `--primary` |
| 技术分析 | 放大镜 + 波形 | 默认 |
| 转账 | 左右双向箭头 | 默认 |
| 减仓 / 赎回 | 向下箭头 | 默认 |
| 添加子账户 | 加号 | `--primary` |
| 展开 / 收起子账户 | 折角箭头（展开时旋转 90°） | 默认 |
| 每日盈亏 | 柱状图 | 默认 |
| 撤销 | 逆时针箭头 | 默认 |

### 3.4 弹窗（三段式，不可拆）

| 区 | 选择器 | 规则 |
|---|---|---|
| 遮罩 | `.modal` | `rgba(0,0,0,.55)` + `blur(4px)`；`[hidden]` 时 `display: none` |
| 容器 | `.modal-card` | `--bg-card-solid` + `--r-lg` + `--sh-3`；`overflow: hidden`；`display: flex; flex-direction: column` |
| 头部 | `.modal-card > h2` | 固定，不滚动 |
| 内容 | `form` / 直接子 div | **唯一滚动区**：`flex: 1; min-height: 0; overflow-y: auto` |
| 动作区 | `.modal-actions` | `flex: 0 0 auto` 常驻底部 + `border-top: 1px solid var(--border)`；右对齐；padding 上下对称 |

宽度档：`340px`（确认）/ `380px`（默认）/ `560px`（表单）/ `780px`（图表）。
入场：`translateY(12px) scale(.98)` → 归零。

### 3.5 输入控件

- label：眉标规格；`:focus-within` 时 label 变主色
- `input` / `select`：`box-shadow: inset 0 0 0 1px var(--border)` 代替 border；`border-radius: var(--btn-radius)`；底 `--bg-input`
- 悬停：描线加深
- **聚焦：`inset 0 0 0 1.5px var(--primary)` + `inset 0 0 0 5px var(--primary-soft)`** —— 内描线，避免被 `overflow: auto` 容器裁切
- 下拉选项：显式 `background: var(--bg-card); color: var(--text)`

### 3.6 背景与材质

- 页面底 `--bg` + `body::before` 径向主色光晕
- 卡片 / 表格：`--bg-card`（毛玻璃 `blur(8px) saturate(120%)`）
- 弹窗 / 下拉：`--bg-card-solid`（不透明，避免叠层发灰）
- **禁止同层叠两种材质**

### 3.6.1 圆环卡片：数值列统一对齐轴

**规则**：凡「圆环 + 图例」或「大数字 + 明细行」的汇总卡，一律 **描述靠左、金额靠最右**，两侧贴卡片内容边界（padding 内沿）。

- `.pano-body` 用 `justify-content: space-between` → 圆环贴左、图例撑满右侧剩余空间（`.comp-legend { flex: 1 1 auto; max-width: none }`）
- 图例列序：`色点 · 名称 · 占比%` … `金额` —— **金额独占最右列**，与「收益率」卡的 `.pr-val` 落在同一条竖线上
- 占比降级为名称后的浅色小字（用 `order` 调序实现，不改 DOM）
- 覆盖对象（共用同一套 class，改 CSS 即三张同步）：首页「总市值」、资产全景「净资产·境内/境外」、资产全景「资产分布」

> 视觉分割轴反例：若把「占比」留在最右列，两卡的最右列语义就不同（% vs 金额），对齐线失效。

### 3.6.2 卡片装饰层

**不用照片类背景图**（数据密度高会被干扰、卡片尺寸随断点变化导致裁切点难控、亮暗两套主题要维护两张图、
还要多一次网络请求）。只用**单层角光 `background-image`**：

| 令牌 | 内容 |
|---|---|
| `--card-glow` | 右上角主题色径向光晕，**58% 高度处淡出为全透明**（暗色 11% 主色 / 亮色 10%） |

- 应用：`.pano-sum`、`.source-group.holdings-group`、`.summary.collapsible`
- **必须用 `background-image`，不能用伪元素**：`.pano-sum` 里 `.ps-head` 是静态元素，绝对定位的 `::before`
  会盖在文字上；且卡片 `overflow: visible`（圆环要穿透），伪元素也无法被圆角裁切。
- **角光必须在 58% 前淡出**：否则卡片下沿色会与普通卡片不一致（历史踩过的坑）。
- 底纹与装饰分层：`background-color: var(--bg-card)` + `background-image: var(--card-glow)`。
- **网格层已移除**（v2.1）：26px 网格与密集表格的行线/分隔线视觉打架，观感偏「工程纸」而非金融面板，
  与「背景层应当退让」原则相悖。仅保留角光。

### 3.6.3 弹窗内非滚动子项禁止压缩

`.modal-card` 是 `display:flex; flex-direction:column`，子项默认 `flex-shrink: 1`。而弹窗内多数子项带
`overflow: hidden`（如 `.adj-tabs` 为做连体胶囊），**`overflow: hidden` 会把 flex 子项的「自动最小尺寸」降为 0** ——
内容一多，tab 栏/头部就被压扁（加减仓记录多时三个 tab 变矮即此因）。

规则：头部与各类 tab 栏、动作区统一 `flex: 0 0 auto`，**只有滚动区参与收缩**：

```css
.modal-card > h2, .modal-card > .m-head, .modal-card > .cal-modal-head,
.modal-card > .hist-tabs, .modal-card > .adj-tabs, .modal-card > .ana-tabs,
.modal-card > .modal-actions, .modal-card > .m-actions,
.modal-card > button, .modal-card > p { flex: 0 0 auto; }
```

### 3.7 Toast

- 位置：顶部居中 `top: 24px`；胶囊 `border-radius: 999px`
- 底：`--bg-card-solid` + `--border-strong` + `--sh-3`；文字 `--text`
- **左侧 3px 色条统一 `--primary`**（跟随主题色）——它是最抢眼的一笔，若用语义色，切到金/绿主题时会留下一条与全站无关的杂色
- **语义（成功/失败）改由文字前的 6px 圆点承担**（`.toast::before`：默认主色 / `ok` `--success` / `err` `--danger`）
- 不用整块饱和底（浅底配白字对比度极低，且饱和块比内容抢眼）

### 3.7.1 弹框底部动作区（`.modal-actions`）

**一律纯文字，不带图标。** 全站 18 个底部动作区已核对：图标会让「取消 / 保存 / 删除」这类
通用动作显得比其语义更重，且与 §3.3.1 的「图标只用于表格行内操作」边界冲突。
（原先仅「通知渠道」弹框的「测试通知 / 保存配置」带手写内联 SVG，已移除。）

**末位按钮必须带语义类**，禁止裸 `.btn`：

| 位置 | 类 | 说明 |
|---|---|---|
| 末位（主操作） | `.btn primary` | 保存 / 确认 / 新增 / 生成 |
| 末位（破坏性） | `.btn danger` | 删除 / 清空 |
| 其余（取消等） | `.btn` | 次级 |

核对口径：`document.querySelectorAll('.modal-actions')` 每块末位按钮的 `className` 必须命中
`primary` 或 `danger`。改前 18 个块里只有 1 个满足，现已补全（15 处）。

### 3.8 滚动条

- thumb：`rgba(148,163,184,.28)`，悬停 `.42`
- **不使用主色** —— 主色滚动条比内容抢眼，与背景层该有的退让相反

### 3.9 数字与动效

- 所有金额、百分比、日期：`font-variant-numeric: tabular-nums`
- 全局补 `@media (prefers-reduced-motion: reduce)`，动画/过渡压到 `0.01ms`
- 涨跌色：**涨红跌绿**（国内惯例）。暗色 `#f87171` / `#4ade80`；亮色 `#dc2626` / `#16a34a`

### 3.10 悬挂角标（买卖信号）

**锚点必须落在它所描述的实体上**，不能挂在会隐藏的控件上。买卖信号描述的是**持仓标的**，
所以角标挂 `.name-cap`（名称文本容器），而不是「分析」按钮——按钮已改纯图标 + 默认 `opacity: 0`，
角标若继续挂在按钮上，按钮隐藏时角标就成了凭空悬浮的记号。

```css
.name-cap { position: relative; display: inline-flex; flex: 0 1 auto; min-width: 0; margin-right: 14px; }
.name-cap .ana-badge { position: absolute; top: -8px; left: 100%; margin-left: -4px; }
```

- **必须用 `left: 100%`（整体落到名称右侧）**，不能写 `right: 0` / `right: -9px`：
  18px 高的角标横向会压住名称最后 ~20px 的文字，把末尾的字盖掉。实测只回压 4px 是「骑边」的甜点值。
- `.name-cap` 宽度收缩到名称文字宽（`flex: 0 1 auto`），所以 `.name-clickable` 不能再 `flex: 1 1 auto`
  撑满整列，否则角标会落到列右端。图标按钮改由 `.name-cell .push-right { margin-left: auto }` 推到右端。
- `.row-act { flex: 0 0 auto }`：名称列里按钮不参与收缩，避免长名称把按钮压扁。
- 角标与「分析」按钮依赖 `margin-right: 14px` 保持间距；实测间距 ≥33px，不重叠。
- **联动改动检查点**：`syncAnalysisBadge()` 靠 `btn.closest('.name-cell').querySelector('.name-cap')` 定位容器，
  别再写 `closest('.ana-wrap')`（该类已废弃），否则分析完成后角标不同步。

### 3.11 趋势类图表（盈亏走势 / 持仓历史曲线）

两处图表共用同一套视觉语言与工具函数（`trendBarPath()` / `trendDefs()`），改一处必须同步另一处，
否则会出现「一侧有渐变、另一侧柱子不渲染」的半成品状态（`fill="url(#xxx)"` 引用不存在的渐变时，
SVG 会**整根不绘制**，表现为「柱子凭空消失」）。

| 项 | 规格 |
|---|---|
| 柱形 | `path` 只圆**远端**两角（正柱圆顶 / 负柱圆底），零线一侧平直，像从基线生长 |
| 柱宽 | `max(3, min(24, slot × 0.46))`，随列宽收敛并封顶 |
| 柱色 | 三组渐变（`--up` 顶部 .96→.58 / `--down` 底部 .58→.96 / 面积 `--cum-line` .20→0） |
| 折线 | 双层：底层 `4.5px` 透明度 .22 做柔光，上层 `1.8px` 定形 |
| 圆点 | **只画最新一天**（`r=3.4`），逐点信息交给悬停指示点；15 个点全画会让折线显得毛躁 |
| 网格 | 上下四分位各一条 `--row-divider` 淡线 + 零线 `--border-strong` |
| 悬停 | 竖虚线 + 折线指示点，坐标从 hotspot 的 `data-x/data-y` 读取 |
| 配色 | 全部走 token（`--up/--down/--cum-line/--text-muted`）。SVG presentation attribute **不认 `var()`**，必须写内联 `style` |
| 渐变 id | `trendUidSeq` 自增生成（`tg1`/`th2`…），两个容器可能同时在 DOM 中，id 不能写死 |

---

## 4. 现状问题清单

| # | 问题 | 证据 | 批次 |
|---|---|---|---|
| 1 | `index.html` 内联 `<style>`（75 行）与 `style.css` 双轨，且加载顺序晚于后者 → 改 CSS 会被反向覆盖 | `index.html:9–83` | B1 |
| 2 | 内联块 41 处硬编码 hex，切主题色不跟随 | `#6b7280`×8、`#fff`×4、`#e5e7eb`×4、`#e5484d`×4、`#9aa0a6`×4、`#d9a52b`×3、`#16a34a`×3、`#f4f5f7`×2、`#1f2329`×2… | B1 |
| 3 | **`--bg-soft` 从未定义，且两处 fallback 互不相同** → 暗色下 `.circ-btn` 渲染为近白色圆钮 | `index.html:16,49` 用 `#f4f5f7`；`style.css:3785` 用 `rgba(255,255,255,.04)` | B1 |
| 4 | `border-radius` 出现 19 种取值，token 形同虚设 | `8px`×25、`6px`×16、`999px`×13、`12px`×13、`10px`×9、`20px`×4… | B2 |
| 5 | 卡片悬停位移导致网格抖动 | `.card:hover { transform: translateY(-2px) }` `style.css:1311` | B2 |
| 6 | 主色实心底 + 白字对比度不足 | 金 `#d9a52b` ≈2.2:1 / 蓝 `#0a84ff` ≈3.7:1 | B2 |
| 7 | `table` 自带模糊 + 圆角 + 阴影，与 `.card` 叠加发灰；横向滚动圆角不跟随、无法做粘性表头 | `style.css:1404–1415` | B3 |
| 8 | 弹窗滚动区靠 `:not(...)` 选择器链定位，脆弱；`.modal-actions` 被内联样式重复覆盖 2 次 | `style.css:1742`、`index.html:44,52` | B3 |
| 9 | 焦点环外扩，在 `overflow: auto` 里被裁切 | `.modal-card input:focus` `style.css:1815` | B3 |
| 10 | 滚动条用主色 | `style.css:1766–1775` | B4 |
| 11 | 无 `prefers-reduced-motion` 兜底 | 两文件命中数均为 0 | B4 |

**B1/B2 期间新发现并已修复**

| 问题 | 处理 |
|---|---|
| `--bg-soft` 从未定义，且两处 fallback 互不相同（`#f4f5f7` vs `rgba(255,255,255,.04)`）→ 暗色下圆钮渲染成近白色 | 定义 `--bg-soft` 令牌 |
| `.circ-btn:not(.active):hover` 硬编码深灰字 `#4b5563`，暗色底上不可读 | 改 `var(--border-strong)` / `var(--text)` |
| 主色实心底配 `#fff` 共 **10 处**（标签页/分段控件/分页器/角标/登录按钮…），金色主题下仅 2.2:1 | 统一改 `var(--on-primary)` |
| 技术分析模块遗留**第二套红绿**（`#ff4757`/`#2ed573`/`#38bdf8`）共 43 处，与全站涨跌色不一致 | 收回 `--up`/`--down`/`--signal-neu` + `*-rgb` 三元组 |
| `.card-icon` 等图标容器的圆角取值分散 | 收敛到 `--r-sm` / `--r` |

---

## 5. 实施批次与验收

| 批次 | 内容 | 验收标准 |
|---|---|---|
| **B1** | 内联样式整体回迁 `style.css` 末尾；41 处硬编码变量化；补齐 `--bg-soft` 缺陷 | 除 `.circ-btn` 缺陷修正外，全站目视零变化 |
| **B2** | 三级 token（`--r-sm/--r/--r-lg`、`--sh-1/2/3`、`--e/--e-out/--e-back`）+ 按钮族收敛 + `--on-primary` 对比度修正 + 卡片去位移 | 按钮/卡片外观统一；金色主题主按钮字变深色 |
| **B3** | 表格去毛玻璃（外框移至 `.table-wrap`）+ **操作列统一为纯图标按钮族（§3.3.1）** + 弹窗三段式语义类 + 输入框 inset 焦点环 | 表格横向滚动/粘性表头正常；操作列只余图标且列宽不跳动；弹窗动作区常驻不随内容滚动 |
| **B4** | 背景分层降 blur + Toast 中性化 + 滚动条中性 + 数字 `tabular-nums` + `reduced-motion` | 细节一致性 |

**每批流程**：本地部署（tar → scp → `build --no-cache` → `up -d --force-recreate`，主实例 + demo）→ **用户验证** → 才 `git push`。

---

## 6. 变更记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-10 | v1.0 | 方案定案；确定毛玻璃/数字字体/卡片位移三项决策；产出 B1–B4 实施批次 |
| 2026-09-10 | v1.1 | **B1+B2 落地并本地部署**（VERSION `2d4d8c9\|2026-09-10T15-39-14+0800`）：内联样式 75 行回迁、41 处硬编码色值变量化、`--bg-soft` 缺陷修复；新增 `--r-xs/--r/--r-lg`、`--sh-1/2/3`、`--e/--e-out/--e-back`、`--on-primary`、`*-solid`、`*-rgb` 全套 token；圆角从 19 种取值收敛到 5 token + 4 例外（41+36 处替换）；按钮族收敛（悬停上浮 1.5px、按下 `scale(.96)`、回弹缓动）；卡片悬停去位移只升阴影；圆环卡片数值列对齐轴统一（3 张卡） |
| 2026-09-10 | v1.2 | 补充 §3.3.1 行内操作按钮族 + 图标字典（B3 落地）；§3.6.1 圆环卡片对齐规则 |
| 2026-09-10 | v2.0 | **B3 + B4 落地并本地部署**（VERSION `2d4d8c9\|2026-09-10T16:18:07+0800`）。见下方明细 |
| 2026-09-10 | v2.1 | 卡片网格层移除（只留角光，§3.6.2）；**修复子表操作列被 `width: 1%` 裁成 13.9px 的回归**（改 `108px` 固定值 + `min-width: 1300px`，§3.3 新增列宽铁律）；买卖信号角标锚点由「分析按钮」改挂「名称文本」（§3.10）；盈亏走势与持仓历史曲线统一升级为渐变柱/远端圆角/四分位网格/悬停指示线（§3.11） |
| 2026-09-10 | v2.2 | 三处趋势图抽成共用 `drawPnlCurve()`（新增理财每日盈亏）；弹框底部动作区统一：18 块去图标 + 15 处末位按钮补 `.btn primary`（§3.7.1）；Toast 左侧色条改跟随主题色、语义改用文字前圆点（§3.7）；删除用户抽屉里与列表重复的 `.user-current` 卡片；修正 §3.3.1 第 9 条错误的 `width: 1%` 建议 |

### v2.0 明细（B3 + B4）

**B3**
1. **表格去毛玻璃**：`table` 剥离 `background / backdrop-filter / border-radius / box-shadow / border / overflow`（原因见 CSS 内注释），外框移到 `.table-wrap`；表头改眉标规格并加 `rgba(255,255,255,.03)` 底（亮色 `#f1f3f6`）+ `--border` 下描线。
2. **操作列统一为纯图标按钮族**：新增 `.row-act`（28×28、`--r-xs`、`currentColor` SVG），加 `actIcon()` / `actBtn()` 工厂 + 13 条图标字典（`edit/hist/del/adjust/analysis/transfer/redeem/addSub/toggle/pnl/undo`）。替换 **28 + 5 处模板**，清空全部 emoji 图标（📊✏️📈🗑️⬇️ 归零）；计数改为右上角徽标（`.act-cnt`）；行悬停淡入，`.always-on`（展开控件）常显；`syncAnalysisBadge` 的选择器由 `.act-analysis` 改 `.row-act[data-ana]`。
3. **弹窗**：`.modal-card` 圆角 `--r-lg`(22px)、阴影 `--sh-3`、入场动画 `translateY(12px) scale(.98)`；遮罩 `rgba(0,0,0,.55)` + `blur(4px)`；`.modal-actions` 加 `border-top` + 上下对称 padding(20px) + 下圆角。
4. **输入框**：描线由 `border` 改 `inset box-shadow`，聚焦改 `inset 1.5px 主色 + inset 5px 主色淡底`（不再被 `overflow:auto` 裁切）。
5. **hint 缩小 + 简化**：`input::placeholder` / `textarea::placeholder` 字号降到 **12.5px**（全局），并简化 13 处长提示文本（钉钉 Webhook URL、AI 提示词、手续费、冗余「可选，」前缀等）。

**B4**
6. **毛玻璃降强度**：新增 `--blur: 8px` / `--sat: 120%`；`blur(12px) saturate(160%)` 全量替换（6 处 → token，2 处 20px → 14px，1 处 6px → 4px），`saturate(160%)` 残留归零。
7. **Toast 中性化**：改 `--bg-card-solid` 胶囊 + `--border-strong`；语义只用左侧 3px 色条（`--success`/`--danger`/`--primary`），不再整块饱和底配白字。
8. **滚动条中性**：新增 `--sb-thumb/--sb-thumb-hover/--sb-track`，页面级与弹窗内滚动条全部改中性灰，主色滚动条归零。
9. **数字等宽**：`th,td,.num,.ps-big,.pr-val,.cl b,.cl .cpct` 等统一 `font-variant-numeric: tabular-nums`。
10. **`prefers-reduced-motion` 兜底**：全局动画/过渡压到 `.01ms`，并取消 `.btn/.card/.pano-sum/.chip/.row-act` 的悬停位移。

---

## 7. 遗留待办（B5+）

- **弹窗 HTML 类名迁移（建议）**：`.m-head/.m-body/.m-actions` 已作为**语义别名**在 CSS 中生效，但 `index.html` 里 **25 个弹框仍是 `:not(...)` 链定位滚动区**（该链已加固：新增例外会同时排除 `.m-*`）。逐个换类后可删掉那条 `:not()` 链。之所以本轮没做：25 个手写结构逐个改 class 的回归风险高于当前收益，而 CSS 侧已无功能缺口。
- **`.btn.btn-icon`（卡片视图按钮）仍带文字标签**：共 4 处，属卡片内动作而非表格单元格，按 §3.3.1 的范围界定保留「图标 + 文字」。
- **`--r-xs` 与 3 级 token 的关系**：`--r-xs` 为微件补充档（高度 < 28px），并非原设计的三级之一；已在 §2.3 记录例外规则。
- **弹框 `<h2>` 标题图标不统一**：部分标题带 17×17 内联 SVG（如「通知渠道」的铃铛），部分纯文字。底部动作区已统一为纯文字，标题是否也统一待定。
- **`index.html` 有 1 处历史遗留的多余 `</div>`**（标签栈检测：比开标签多一个闭合）。浏览器容错处理，当前无可见影响，未改动以免引入回归。
