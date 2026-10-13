# 持仓侠 UI 设计规范

> **v3.1 · 2026-10-10 · 设计规范（已定案）**
> 落地文件：`web/style.css`（**唯一样式真源**）、`web/index.html`（零样式）、`web/app.js`（仅主题变量注入）
> 变更摘要：v3.0 → v3.1 — **Hero Banner 首屏视觉锚点 + 背景氛围层增强 + 卡片 hover 升级**

---

## 0.1 本轮（v3.1）定案

| 议题 | 结论 |
|---|---|
| 首屏锚点 | **新增 Hero Banner**：header 下方全局可见的品牌横幅（静态品牌文案 + 动态 mini sparkline 预览），不跟随 view 的 hidden 切换 |
| 背景层 | **三团光晕 + mask 网格**：body::before 从单团改三团（主色/紫/绿），body::after 加 mask 径向淡出的超细网格（只在上半屏光晕区显，底部表格密集区自然隐） |
| 卡片 hover | **只升 shadow + 边框色亮**，移除 transform translateY 位移（§3.2 「高度靠阴影不靠位移」的严格执行） |
| Hero 字号 | **32px**（桌面，v3.7 由 44px 下调：标题与标语合并一行后不再需要超大字号压场；32/4=8 仍落 4px 网格），手机 28px（`--fs-2xl`） |
| 语义约束 | Hero 独立视觉层的网格叠加合法（spec §3.6.2 说「网格层已移除」指页面全局背景层，不阻止独立区块内部的装饰网格） |
| font-size 取值上限 | v3 原 ≤9 → **v3.1 ≤10**（新增 Hero 大字号；v3.7 该档取值 44px → 32px，档数不变） |
| Hero sparkline 数据 | 复用 `/api/pnl/history` 的 calData，与收益率卡同数据源、同请求，近 30 天累计盈亏曲线 |

**与 v3.0 的关系**：完全兼容增量升级——所有 token、组件类名、lint 规则保留，仅追加新层与新规范章节。

---

## 0. 本轮（v3）定案

| 议题 | 结论 |
|---|---|
| 质感路线 | **保留科技玻璃**（毛玻璃 + 角光 + 回弹缓动），不复刻 Material 的纯扁平；但**光效只收强度**，不做风格切换 |
| 像素基准 | **4px 网格**：间距 / 尺寸 / 圆角全部落在 4 的倍数上，整体更紧凑 |
| 圆角 | 由 `6 / 10 / 16 / 22` 收敛为 **`4 / 8 / 12 / 16`**（落到 4px 网格） |
| 字号 | 由 **20 种取值**收敛为 **7 档** |
| 控件高度 | 由 `28/30/32/34/36` 五档横跳收敛为 **3+1 档**：`24 / 28 / 32 / 36` |
| 图标 | **emoji 只允许出现在「内容表达」处**（盈亏日历情绪脸）；界面图标一律内联 SVG + `currentColor` |
| 语义色 | 资产分类色**移出红/绿色域**，与「涨红跌绿」解耦（红不再既表示涨又表示负债） |
| 光影 | **去彩色辉光**：`--sh-2` 与按钮悬停阴影改中性；玻璃强度 `blur 8→6px`、`saturate 120%→110%`；角光透明度 `.11→.07` |

**与 ezbookkeeping 的关系**：借用它的「约束纪律」（一套 token 贯穿全站），**不引入 Vuetify**——保留纯原生前端 + `go:embed` 单二进制的轻量卖点。

---

## 1. 设计原则

**移植的是结构规则，不是配色。**

1. **层级决定形状** —— 圆角/阴影按「控件 → 卡片 → 浮层」三级取值，不按元素随手取。
2. **描线优先于色块** —— 面的边界用 1px 描线表达；实色块只留给主操作与选中态。
3. **眉标统一次级文字** —— 表头、表单标签、卡片小标题统一走 `.eyebrow` 规格（11–12px / 字距 .5px / muted）。
4. **高度靠阴影，不靠位移** —— 悬停提升阴影层级。
5. **提示条优于告警块** —— 用「淡底 + inset 描线 + 色点」承载提示，不用整块饱和色。
6. **数字等宽对齐** —— 所有金额、百分比、日期必须 `tabular-nums`。
7. **同层只用一种材质** —— 卡片与表格不同时挂 `backdrop-filter`。
8. **网格即约束**（v3 新增）—— 一切间距与尺寸落 4px 网格，禁止出现 `7px / 10px / 14px / 18px` 这类"看着差不多"的值。
9. **唯一样式真源**（v3 新增）—— `index.html` 里不得出现 `<style>`；`app.js` 里不得出现 `style="..."`（动态值一律 `el.style.setProperty('--x', v)`）。

---

## 2. Token 层（唯一定义处：`style.css` 的 `:root`）

### 2.0 v3 新增 token 一览（4px 网格）

```css
/* 间距（4px 基准） */
--sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
--sp-5: 20px; --sp-6: 24px; --sp-8: 32px;

/* 控件高度（3 + 1 档） */
--h-1: 24px;  /* 微型：徽标 / 标签 / 微型按钮 */
--h-2: 28px;  /* 紧凑：表格行内图标按钮 */
--h-3: 32px;  /* 默认：按钮 / 输入框 / 分段控件 */
--h-4: 36px;  /* 触屏：主表单 / 移动端最小可点区 */

/* 字号（7 档） */
--fs-xs: 11px;   --fs-sm: 12px;  --fs-md: 13px;  --fs-base: 14px;
--fs-lg: 16px;   --fs-xl: 20px;  --fs-2xl: 28px;
```

### 2.1 表面

| 令牌 | 暗色 | 亮色 | 用途 |
|---|---|---|---|
| `--bg` | `#0a0e14` | `#f4f6f9` | 页面底 |
| `--bg-card` | `rgba(20,26,36,.82)` | `rgba(255,255,255,.85)` | 卡片 / 表格 / 工具卡（毛玻璃） |
| `--bg-card-solid` | `#141a24` | `#ffffff` | 弹窗 / 下拉 / 悬浮层（不透明） |
| `--bg-input` | `rgba(255,255,255,.05)` | `rgba(0,0,0,.03)` | 输入控件底 |
| `--bg-soft` | `rgba(255,255,255,.06)` | `rgba(15,23,42,.05)` | 次级按钮/片段底 |
| `--bg-hover` | `rgba(tint,.08)` | `rgba(tint,.07)` | 行/项悬停 |

### 2.2 描线

| 令牌 | 值 | 用途 |
|---|---|---|
| `--border` | 白 8% / 深 10% | 默认描线 |
| `--border-strong` | 白 16% / 深 20% | 悬停 / 强调 |
| `--row-divider` | 白 6% / 深 6% | 表格行分割 |
| `--sub-divider` | 白 10% / 深 10% | 子表横向分割 |

### 2.3 形状（v3 改为 4px 网格）

| 令牌 | v2 | **v3** | 用途 |
|---|---|---|---|
| `--r-xs` | 6px | **4px** | 微件：高度 < 28px 的徽标、标签、代码块、进度条 |
| `--r-sm` = `--btn-radius` | 10px | **8px** | 控件：按钮、输入框、图标容器 |
| `--r` = `--card-radius` | 16px | **12px** | 卡片、面板、表格外框、工具卡 |
| `--r-lg` | 22px | **16px** | 弹窗、底部抽屉、登录框 |

**允许的例外（不进 token）**：`999px`（胶囊：chip / pill / 标签页）、`50%`（圆形：圆点、头像、圆钮）、`0`（贴合容器的内表格）、`2px`（图例色块、进度条）。

### 2.4 高度（v3 改为 3+1 档）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--h-1` | 24px | 微型：徽标 / 标签 |
| `--h-2` | 28px | 紧凑：`.row-act` 行内图标按钮 |
| `--h-3` | 32px | 默认：`.btn` / `input` / `select` / 分段控件（原 `--btn-h: 34px`） |
| `--h-4` | 36px | 触屏最小可点区（`--touch`） |

`--row-h`（列表行高）由 42px 收敛为 **40px**（4px 网格）。

### 2.5 阴影与材质（保留玻璃，只收强度）

| 令牌 | 暗色 | 亮色 | 用途 |
|---|---|---|---|
| `--sh-1` | `0 2px 10px rgba(0,0,0,.24)` | `0 2px 8px rgba(15,23,42,.06)` | 静态卡片 |
| `--sh-2` | `0 8px 20px rgba(0,0,0,.34)`（**去主色辉光**） | `0 8px 18px rgba(15,23,42,.12)` | 悬停卡片 |
| `--sh-3` | `0 18px 52px rgba(0,0,0,.5)` | `0 18px 52px rgba(15,23,42,.18)` | 弹窗 / 浮层 |
| `--blur` / `--sat` | **6px / 110%**（原 8px / 120%） | 同 | 毛玻璃强度 |
| `--card-glow` | 角光 alpha **.07**（原 .11） | 角光 alpha **.07**（原 .10） | 卡片右上角光 |

> **禁止彩色辉光**：任何 `box-shadow` 不得引用 `--primary-glow`；`--primary-glow` 仅保留给「聚焦环」这类需要主色提示的场景。

### 2.6 动效

| 令牌 | 曲线 | 用途 |
|---|---|---|
| `--e` | `cubic-bezier(.4,0,.2,1)` | 通用颜色/背景过渡 |
| `--e-out` | `cubic-bezier(.16,1,.3,1)` | 入场 |
| `--e-back` | `cubic-bezier(.34,1.46,.64,1)` | 按下回弹 |

### 2.7 字号（7 档）

| 令牌 | 值 | 用途 | v2 中被归并到此档的散值 |
|---|---|---|---|
| `--fs-xs` | 11px | 眉标 / 表头 / 徽标 / 图表标注 | `9.5px`、`10px`、`11px` |
| `--fs-sm` | 12px | 次要信息 / 提示 / 表单标签 | `11.5px`、`12px`、`12.5px` |
| `--fs-md` | 13px | 正文次（全站主力） | `13px`、`13.5px` |
| `--fs-base` | 14px | 正文 / 按钮 | `14px`、`15px` |
| `--fs-lg` | 16px | 卡片标题 / 区块标题 | `16px`、`17px`、`18px` |
| `--fs-xl` | 20px | 页内大数 / 情绪脸 | `19px`、`20px`、`22px` |
| `--fs-2xl` | 28px | 总计大数 | `26px`、`28px` |

---

## 3. 组件规范

### 3.1 按钮族（只准这 5 类）

| 类 | 语义 | 底 | 字 | 悬停 | 按下 |
|---|---|---|---|---|---|
| `.btn` | 次级（默认） | ghost 底 + `--border` | `--primary` | 底变实、边框加深、上浮 1px | `scale(.96)` |
| `.btn.primary` | 主操作，**一屏 ≤1 个** | `--btn-primary` | `--on-primary` | 加深 + 阴影升级 | 再深 |
| `.btn.danger` | 破坏性 | `--btn-danger` | `#fafafa` | 加深 | 再深 |
| `.btn.icon-btn` | 纯图标 | 同 `.btn` | 同 `.btn` | 同上 | 同上 |
| `.src-chip` / `.chip` | 单选/多选筛选 | 透明 + 描线胶囊 | `--text-muted` | 底变实 | 选中 = 实心 + `--on-primary` |

共同约束：`min-height: var(--h-3)`、`border-radius: var(--btn-radius)`、`font-size: var(--fs-base)`、`transition: var(--btn-transition)`、`white-space: nowrap`。

**禁止新增按钮类**，新场景用现有变体组合。

### 3.2 卡片

- 表面 `--bg-card` + `1px solid var(--border)` + `--r` + `--sh-1`
- 悬停：**只升到 `--sh-2`，不做位移**
- 可折叠帽子：底 `rgba(255,255,255,.03)`（亮色 `#f1f3f6`），下描线 `--border`

### 3.3 表格

- `table` 自身**不带**圆角、阴影、模糊；外框由 `.table-wrap` 提供
- `th`：眉标规格（`--fs-xs`）+ 底 `rgba(255,255,255,.03)` + 下描线 `--border`
- `td`：行高 `--row-h`(40px)，下描线 `--row-divider`
- 行悬停：`--bg-hover`
- 操作列：默认 `opacity: 0`，行悬停淡入；`@media (hover: none)` 常显
- 金额/百分比列：`font-variant-numeric: tabular-nums`

**⚠ 列宽铁律：`table-layout: fixed` 下禁止用百分比表达「按内容自适应」。**
`width: 1%` 不是「尽量窄」，而是「表格宽度的 1%」——在 1388px 宽的表格里等于 **13.9px**，图标按钮会被 `td` 的 `overflow: hidden` 整颗裁掉。
操作列等需要固定占位的列**必须给像素值**（当前 `108px` = 3×28 图标 + 2×6 间距 + td padding）。只有 `table-layout: auto` 才可写 `width: 1%`。

### 3.3.1 行内操作按钮族

1. **一律纯图标**，不用文字按钮，不用 emoji。
2. **一律内联 SVG + `currentColor`**，线性描边 `stroke-width: 1.6–1.8`。
3. **尺寸 28×28**（`--h-2`），`border-radius: var(--r-xs)`，透明底；悬停 `background: var(--bg-hover)`。
4. **默认 `opacity: 0`，行悬停淡入**（每颗延迟 40ms 依次出现）；`@media (hover: none)` 下常显。
5. **语义色只三档**：默认 `--text-muted`、信息 `--primary`、危险 `--danger`。
6. **计数不写进按钮**，改右上角徽标（`.act-cnt`）。
7. **无障碍**：每颗按钮必须有 `aria-label` + `title`。
8. **不碰 `data-*` 钩子**。
9. **操作列宽度必须给像素值**。

### 3.3.2 全站图标字典（v3 扩充：从「表格行内」扩到全站）

| 语义 | 图标（key） | 色 |
|---|---|---|
| 编辑 / 修改 | `edit` 铅笔 | `--primary` |
| 历史 / 走势 | `hist` 折线图 | 默认 |
| 删除 | `del` 垃圾桶 | `--danger` |
| 加减仓 | `adjust` 上下双向箭头 | `--primary` |
| 技术分析 | `analysis` 放大镜 + 波形 | 默认 |
| 转账 | `transfer` 左右双向箭头 | 默认 |
| 减仓 / 赎回 | `redeem` 向下箭头 | 默认 |
| 添加子账户 | `addSub` 加号 | `--primary` |
| 展开 / 收起 | `toggle` 折角箭头（展开旋转 90°） | 默认 |
| 每日盈亏 | `pnl` 柱状图 | 默认 |
| 撤销 | `undo` 逆时针箭头 | 默认 |
| **日历** | `calendar` | 默认 |
| **目标 / 计划** | `target` 靶心 | 默认 |
| **机器人 / 自动** | `bot` | 默认 |
| **火花 / 触发** | `spark` 闪电 | `--primary` |
| **空状态** | `inbox` 空盒子 | `--text-muted` |
| **笔记 / 手动** | `note` 便签 | 默认 |
| **对勾** | `check` | 默认 |
| **警告** | `warn` 三角 | `--warning` |
| **空状态** | `inbox` 空盒子 | `--text-muted` |
| **上传** | `upload` 箭头入盒 | 默认 |

**彩色 emoji 白名单（唯一允许的非 SVG 图标）**：盈亏日历的情绪脸（`😊 😄 😁 😍 🙁 😟 😣 😱 😐`）——属**内容表达**（用表情代替金额传达当日情绪），不是界面图标。
除白名单外，`app.js` / `index.html` 中出现**彩色 emoji** 一律视为缺陷。

**允许的等宽文本符号**：下列字符是单色字形、跟随 `currentColor`、跨平台渲染一致，可用于紧凑控件，**不必**替换为 SVG：

| 符号 | 用途 |
|---|---|
| `★ ☆` | 默认账户标记 / 置信度星级 |
| `✕` | 关闭按钮 |
| `✓` | 命中标记 |
| `＋ －` | 紧凑的加减按钮（全角，与 `.btn` 文字混排时基线更稳） |
| `▲ ▼ —` | 涨 / 跌 / 平方向指示（`.dir-ind`、日历摘要） |
| `⇄ ‹ › ▾` | 切换、翻页、下拉指示 |

> 判定标准很简单：**它是彩色的吗？** 彩色 emoji 会跨系统变样、不跟主题色、截图/打印会变彩，必须 SVG 化；单色文本符号不会。

### 3.4 弹窗（三段式，不可拆）

| 区 | 选择器 | 规则 |
|---|---|---|
| 遮罩 | `.modal` | `rgba(0,0,0,.55)` + `blur(4px)`；`[hidden]` 时 `display: none` |
| 容器 | `.modal-card` | `--bg-card-solid` + `--r-lg`(16px) + `--sh-3`；`overflow: hidden`；`display: flex; flex-direction: column` |
| 头部 | `.modal-card > h2` | 固定，不滚动 |
| 内容 | `form` / 直接子 div | **唯一滚动区**：`flex: 1; min-height: 0; overflow-y: auto` |
| 动作区 | `.modal-actions` | `flex: 0 0 auto` 常驻底部 + `border-top`；右对齐；padding 上下对称 |

宽度档：`340px`（确认）/ `380px`（默认）/ `560px`（表单）/ `780px`（图表）。
入场：`translateY(12px) scale(.98)` → 归零。

### 3.5 输入控件

- label：眉标规格；`:focus-within` 时 label 变主色
- `input` / `select`：`box-shadow: inset 0 0 0 1px var(--border)` 代替 border；`border-radius: var(--btn-radius)`；底 `--bg-input`
- 悬停：描线加深
- **聚焦：`inset 0 0 0 1.5px var(--primary)` + `inset 0 0 0 5px var(--primary-soft)`** —— 内描线，避免被 `overflow: auto` 容器裁切
- 下拉选项：显式 `background: var(--bg-card)` / `--bg-card-solid`；`color: var(--text)`
- `::placeholder` 字号 `--fs-sm`

### 3.6 背景与材质

- 页面底 `--bg` + `body::before` 径向主色光晕（alpha 已降，见 §2.5）
- 卡片 / 表格：`--bg-card`（毛玻璃 `blur(6px) saturate(110%)`）
- 弹窗 / 下拉：`--bg-card-solid`（不透明，避免叠层发灰）
- **禁止同层叠两种材质**

### 3.6.1 圆环卡片：数值列统一对齐轴

凡「圆环 + 图例」或「大数字 + 明细行」的汇总卡，一律 **描述靠左、金额靠最右**，两侧贴卡片内容边界。

- `.pano-body` 用 `justify-content: space-between`
- 图例列序：`色点 · 名称 · 占比%` … `金额` —— **金额独占最右列**
- 占比降级为名称后的浅色小字（用 `order` 调序，不改 DOM）

### 3.6.2 卡片装饰层

**不用照片类背景图**，只用**单层角光 `background-image`**（`--card-glow`，58% 高度处淡出为全透明）。

- 应用：`.pano-sum`、`.source-group.holdings-group`、`.summary.collapsible`
- **必须用 `background-image`，不能用伪元素**（`.ps-head` 是静态元素，绝对定位的 `::before` 会盖在文字上）
- **角光必须在 58% 前淡出**，否则卡片下沿色会与普通卡片不一致
- **网格层已移除**（v2.1）：与密集表格的行线打架

### 3.6.3 弹窗内非滚动子项禁止压缩

`.modal-card` 是 flex 容器，子项默认 `flex-shrink: 1`；带 `overflow: hidden` 的子项最小尺寸会被降为 0。
头部与各类 tab 栏、动作区统一 `flex: 0 0 auto`，**只有滚动区参与收缩**。

### 3.12 Hero Banner（v3.1 新增）

**位置**：`<header>` 之后、`#holdingsView` 之前，所有 view 外层，全局可见（不跟随 `hidden` 切换）。

**结构**：左（品牌文案 + 状态 badge） + 右（mini sparkline + 趋势百分比）双栏网格，窄屏改上下堆叠。

**尺寸约束**（全落 4px 网格）：
- 整体固定 `height: 192px`（v3.7 由 220px 压缩：标题与标语合行 + 标题降字号；192/4=48）
- 左右 padding `var(--sp-6)`（24px），左右栏 gap `var(--sp-6)`（24px）
- 背景 blob `width: 320px; height: 320px` —— 80×4=320
- spark-wrap 由 flex 吃满剩余高度（无固定值）

**字号**：Hero 主标题 32px（v3.7 由 44px 下调，与右侧标语 `.hero-slogan` 同行基线对齐），手机 28px（`--fs-2xl`）。

**背景层**（三层叠加，z-index 严格分层）：
1. `.hero-bg-blob`（两个 filter:blur(72px) 的大圆形）—— z-index:0，背景光斑
2. `.hero-grid-overlay`（40px 网格 + 1.2% 透明度）—— z-index:0，装饰网格（独立区块内合法，§3.6.2 全局移除不约束子区块）
3. `.hero-content`（绝对定位铺满）—— z-index:1，内容层

**动效约束**：
- Hero hover：只升级 box-shadow + 边框色亮，**禁止 transform**（§3.2 严格执行）
- `.hero-badge-dot` 脉冲动画：`@keyframes hero-pulse` 2.4s ease-in-out infinite，scale(1)→scale(.6)
- 背景 blob 不动（纯静态 blur，无动画）

**sparkline 数据链**（复用，零额外请求）：
```
/api/pnl/history → calData → 近30日 .total_cny → cum 累计 → sparkline(cum, {w:240,h:72})
renderRateSpark() 内同时渲染 rateSpark（近20日小尺寸）和 heroSpark（近30日大尺寸）
```
颜色跟最近 30 天累计盈亏正负：红（↑）/ 绿（↓）/ neutral（平）。

**亮日主题覆盖**（`[data-theme="light"] .hero-banner`）：
- 换更透亮的浅蓝渐变底
- hero-title 用深色字（#0f172a → primary 渐变）
- blob/grid 透明度降低

### 3.7 Toast

- 位置：顶部居中 `top: 24px`；胶囊 `border-radius: 999px`
- 底：`--bg-card-solid` + `--border-strong` + `--sh-3`
- **左侧 3px 色条统一 `--primary`**（跟随主题色）
- **语义（成功/失败）由文字前的 6px 圆点承担**（默认主色 / `ok` `--success` / `err` `--danger`）

### 3.7.1 弹框底部动作区

**一律纯文字，不带图标。** 末位按钮必须带语义类（`.btn primary` 或 `.btn danger`），禁止裸 `.btn`。

### 3.8 滚动条

`--sb-thumb: rgba(148,163,184,.30)`，悬停 `.5`。**不使用主色**。

### 3.9 数字与动效

- 所有金额、百分比、日期：`font-variant-numeric: tabular-nums`
- 全局 `@media (prefers-reduced-motion: reduce)`，动画/过渡压到 `0.01ms`
- 涨跌色：**涨红跌绿**（国内惯例）

### 3.9.1 工具类（utility）层与动态值通道

**为什么不用 Tailwind**（评估结论）：

1. 本项目 DOM 由 `app.js` 模板字符串生成（779 处 `class`），其中 **64 处类名是运行时拼出来的**
   （如 `(v > 0 ? 'lg-up' : 'lg-down') + lvl`）——Tailwind JIT 的静态扫描看不见这些类名，
   只能靠 `safelist` 穷举或退回 CSS 变量；
2. 主题色由用户**运行时取任意 hex**，编译期方案无法覆盖，CSS 变量间接层必须保留；
3. utility-first 会把 CSS 体积转移到**标记体积**，而这里 DOM 不是缓存的 HTML、是每次渲染现生成的，
   与「单二进制 / 低内存」定位相悖（实测：引入 Tailwind 需重写 1281 个 `class` 属性、428 个规则块）。

**因此自建极小 utility 层**（约 40 个类，零依赖、零构建变更）：

| 前缀/族 | 内容 | 约束 |
|---|---|---|
| `.u-row` `.u-col` `.u-wrap` `.u-center` `.u-between` | 布局 | 只做 flex 组合，不含尺寸 |
| `.u-gap-1…6` `.u-mt-*` `.u-mb-*` `.u-mx-auto` `.u-py-*` | 间距 | **必须映射 `--sp-*`**，天然守 4px 网格 |
| `.u-grow` `.u-shrink-0` `.u-full` | 弹性/尺寸 | — |
| `.u-muted` `.u-faint` `.u-danger` `.u-xs…u-base` `.u-bold` `.u-num` `.u-mono` `.u-nowrap` `.u-ellipsis` `.u-lh` | 文字 | 字号一律走 `--fs-*` |
| `.u-block` `.u-pointer` `.u-va-icon` `.u-va-mid` | 其他 | — |
| `.cw-5…cw-34` | 表格列宽百分比 | 百分比是比例，不受 4px 网格约束 |
| `.ta-left` `.ta-center` `.ta-right` | 单元格对齐（Markdown 表格渲染用） | — |

**位置**：写在 `style.css` **末尾**（同优先级下源码顺序靠后者胜出，可覆盖组件类）。
**纪律**：新增工具类必须映射已有 token；**不得**出现 `u-mt-13` 这类任意值工具。

#### 动态值的唯一合法通道

模板里的动态样式**只允许写自定义属性**，具体声明留在 `style.css`：

```js
// ✅ 合法：宽度/颜色仍可被媒体查询与主题覆盖
`<span class="seg" style="--w:${p}%;--bg:${c}"></span>`
// ❌ 非法：内联具体声明无法被覆盖，且散落重复值
`<span style="width:${p}%;background:${c}"></span>`
```

CSS 侧消费：

```css
.donut          { width: var(--sz); height: var(--sz); }
.donut-seg      { stroke: var(--st); fill: none; }
.cl .dot        { background: var(--bg); }
.fill-cur       { width: var(--w); background: var(--bg); }
.fill-target    { left: var(--x); }
```

项目里已有的先例是 `--accent-rgb`（首页大卡片按主分类注入强调色）。
`check-ui.mjs` 第 8 项会**剥离 `--x: v` 后**再判断是否残留具体声明 —— 这条规则由机器保证。

### 3.10 悬挂角标（买卖信号）

**锚点必须落在它所描述的实体上**。角标挂 `.name-cap`（名称文本容器），不挂「分析」按钮。

```css
.name-cap { position: relative; display: inline-flex; flex: 0 1 auto; min-width: 0; margin-right: 14px; }
.name-cap .ana-badge { position: absolute; top: -8px; left: 100%; margin-left: -4px; }
```

- **必须用 `left: 100%`**，不能写 `right: 0` / `right: -9px`（18px 高的角标会压住名称末 ~20px 文字）
- `.name-cap` 宽度收缩到名称文字宽；图标按钮由 `.name-cell .push-right { margin-left: auto }` 推到右端
- **联动检查点**：`syncAnalysisBadge()` 靠 `btn.closest('.name-cell').querySelector('.name-cap')` 定位，勿写 `closest('.ana-wrap')`

### 3.11 趋势类图表

两处图表共用同一套视觉语言与工具函数（`trendBarPath()` / `trendDefs()`），改一处必须同步另一处。

| 项 | 规格 |
|---|---|
| 柱形 | `path` 只圆**远端**两角，零线一侧平直 |
| 柱宽 | `max(3, min(24, slot × 0.46))` |
| 柱色 | 三组渐变（`--up` .96→.58 / `--down` .58→.96 / 面积 `--cum-line` .20→0） |
| 折线 | 双层：底层 `4.5px` 透明度 .22 柔光，上层 `1.8px` 定形 |
| 圆点 | **只画最新一天**（`r=3.4`） |
| 网格 | 上下四分位各一条 `--row-divider` 淡线 + 零线 `--border-strong` |
| 渐变 id | `trendUidSeq` 自增生成，**不能写死**（`fill="url(#xxx)"` 引用不存在的渐变时 SVG 整根不绘制） |
| 配色 | 全部走 token。SVG presentation attribute **不认 `var()`**，必须写内联 `style` |

---

## 4. 颜色语义分层（v3 新增）

**规则：一个颜色槽位只承担一种语义。**

| 层级 | 含义 | 令牌 | 说明 |
|---|---|---|---|
| L1 主题色 | 品牌 / 主操作 / 选中态 | `--primary` / `--tint` / `--on-primary` | 可切换（gold / green / blue / custom） |
| L2 涨跌 | **仅用于盈亏数字与走势** | `--up` / `--down` / `--up-solid` / `--down-solid` / `*-rgb` | 涨红跌绿（国内惯例） |
| L3 资产分类 | **仅用于资产构成可视化** | `--cat-*` | v3 移出红/绿色域 |
| L4 功能色 | 成功 / 警告 / 危险 / 中性信号 | `--success` / `--warning` / `--danger` / `--signal-neu` | |

**L3 变更（v3）**：

| 分类 | v2 | **v3** | 理由 |
|---|---|---|---|
| 权益 / 股票 | 橙 `255,159,10` | **不变** | 与红绿无关 |
| 基金 | 靛 `94,92,230` | **不变** | — |
| 境外 | 紫 `191,90,242` | **不变** | — |
| 现金 | 青 `100,210,255` | **不变** | — |
| 理财 | 绿 `48,209,88` | **蓝绿 `42,163,155`**（亮色 `30,140,134`） | 移出「跌绿」色域 |
| 负债 | 红 `255,69,58` | **中性灰蓝 `138,148,166`**（亮色 `116,126,145`） | 移出「涨红」色域；负数语义由数值符号与文案承担 |

**日历色阶**独立成一组 token（v3 新增），不再散落字面量：

| 令牌 | 暗色 | 亮色 |
|---|---|---|
| `--cal-up-1..4` | `#ef4444` `#dc2626` `#b91c1c` `#7f1d1d` | `#ffe1e1` `#ffa39e` `#ff7875` `#f5222d` |
| `--cal-down-1..4` | `#4ade80` `#22c55e` `#16a34a` `#14532d` | `#e6f7e6` `#b7eb8f` `#73d13d` `#00a854` |
| `--cal-none` / `--cal-zero` | `rgba(255,255,255,.06)` / `rgba(255,255,255,.12)` | `#ebedf0` / `#d9d9d9` |

---

## 5. 收口验收指标

> 「语义色字面量」指 token 定义处（`:root` / `[data-theme="light"]` / 主题色预设 / 色板）**之外**出现的涨跌、主色、功能色色值。阴影、遮罩、中性叠加层与 `:root` 定义本身允许字面量——它们没有可复用的语义槽位，强行 token 化只会造出一堆只用一次的变量。

| 指标 | v3 目标 | **v3 实测** | 校验方式 |
|---|---|---|---|
| `index.html` 中 `<style>` 块 | 0 | **0** ✅ | `Select-String -Path web/index.html -Pattern '<style'` |
| 语义色字面量（token 定义处之外） | **0** | **0** ✅ | `Select-String ... '#f87171\|#4ade80\|#dc2626\|#16a34a' \| ? { $_.Line -notmatch '^\s*--' }` |
| `font-size` 不同取值 | ≤ 7 种 | **9 种**（7 档 + 2 个 SVG viewBox 单位）✅ | `Select-String ... 'font-size:\s*([^;}]+)'` |
| `border-radius` 非 token / 非例外取值 | ≤ 4 种 | **1 种**（`2px` ×3，图例色块）✅ | 分组统计后剔除 token 与 `999px/50%/0` |
| 4px 网格外的 `gap` / `padding` / `margin` / `width` / `height` | **0** | **0** ✅ | 网格归一脚本复查 |
| 界面用彩色 emoji | **0**（白名单外） | **0** ✅ | `Select-String -Pattern '\p{Cs}'` |
| 控件高度档位 | 4 档（24/28/32/36） | **4 档** ✅ | 人工核对 |
| 彩色辉光（`box-shadow` 引用 `--primary-glow`） | 仅允许「焦点环 / 瞬时高亮」 | **1 处**（日历「今天」高亮）✅ | `npm run lint:ui` |
| `app.js` 内联**具体**样式声明 | 0 | **0** ✅（余 28 处 `style` 全部是 `--x: v` 自定义属性注入） | `npm run lint:ui` |
| `style.css` 总行数 | — | **4700**（删 62 行内联块 + 20 行日间覆盖；新增 token、utility 层、语义类） | — |
| `dist/style.css`（min） | — | **148.6 KB**（+5.8 KB，utility 层与语义类；同期 `app.js` 由 295.7 → **291.7 KB**） | `npm run build` |

### 5.1 允许不做 token 化的例外（明确登记，避免反复误判）

| 类别 | 例子 | 理由 |
|---|---|---|
| 主题 token 定义 | `:root` / `[data-theme="light"]` / `--accent` 预设 / `.accent-swatch` | 它们**就是**字面量的唯一来源 |
| 日历 / 图表色阶定义 | `--cal-up-1..4`、`.donut-center` 的 `4.2px` | 专用色阶，已 token 化；donut 字号是 **SVG viewBox 单位**，不是 CSS px |
| 阴影与遮罩 | `rgba(0,0,0,.5)`、`rgba(15,23,42,.12)` | 无复用语义 |
| 固定深色浮层内的取值 | `.trend-tip` 的 `#bcc0c7 / #ff7875 / #95de64 / #8a8f99` | 该浮层背景恒为深色，不随主题翻转 |
| 2px 级光学值 | `gap: 2px`、`border-radius: 2px`、`1px` 描线 | 属视觉微调，不在网格体系内 |

---

