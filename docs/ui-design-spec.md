# 持仓侠 UI 设计规范

> **v3.16 · 2026-11-02 · 设计规范（已定案）**
> 落地文件：`web/style.css`（**唯一样式真源**）、`web/index.html`（零样式）、`web/app.js`（仅主题变量注入）
> 变更摘要：v3.2 → v3.3 — **合并根目录 design.md：页面骨架与标题层级、纵向节奏规约（分组卡 12/24、弹框行距 12/主分组断点 20/水平 28）、弹框宽度档以代码实测修正**
> 变更摘要：v3.3 → v3.4 — **体验质感升级：卡片三级视觉层级、弹框入场动效升级、表格微交互增强、按钮物理反馈强化、空态/加载态治理、留白微纹理、亮暗主题背景微调**
> 变更摘要：v3.4 → v3.5 — **设计系统统一性审计整改（docs/design-system-audit.md）：清理冗余 padding、统一 KPI 区块间距与眉标字距、分组头字重对齐 L3、年份切换器降权；并勘误 Hero 覆盖范围（维持仅持仓/首页可见）、登记 KPI 统一组件与断点收敛为专项**
> 变更摘要：v3.5 → v3.6 — **KPI 统一组件落地（`.kpi-card` + 三档密度 + `.anchor` + 两种 row 模板）：首页 Hero / 投资 / 资产 / 财务四页卡片同源；资产页改 4 张独立小卡；财务页删标题层、年份切换并入 `.kpi-head`；响应式断点 12 → 3 档收敛（640 / 880 / 1340）**
> 变更摘要：v3.6 → v3.7（2026-11-02）— **信息密度整改 · 资产页：`density-mini` 档真正落地（spec 原已登记未实现），资产页 4 卡由 standard 降为 mini，卡内四组迷你图迁入「资产结构」折叠卡（`.asset-struct`）；删除账户面板顶部与 KPI 重复的摘要条；`kpi-foot` / `kpi-extra` 两个卡内槽位随消费者消失而下线（死类硬门要求同步删规则）**
> 变更摘要：v3.7 → v3.8（2026-11-02）— **信息密度整改 · 投资/持仓/理财/资产四表统一（B2 + A5 + A1 + A2）**：① 占比列由「整格主题色底」改为「裸数字 + 单元格底部 2px 细条」（新增无量纲通道 `--pn`）；② 零值降噪——新增 `.zero-dash`（开盘前/真 0 一律 `—`）与 `.mkt-badge` 两态（`is-pre` 待开盘 / `is-closed` 休市），并立**「整列无信息则不输出节点」**铁律；③ 持仓页 4 张分组卡合并为**单一 `.holdings-table`**（4 thead → 1，12 列 → 8 列，空列时 7 列），新增 `.hn-*` / `.hp-*` / `.h-grp` / `.hg-*` / `.ht-*` 一族；④ 操作列宽 108px → **120px**（补 `.ht-acts` 包裹层避免模板换行符撑宽截断）；⑤ 平板 1024 档收口——`.cols-anchor` 改 2×2（锚点卡不再跨行）、走势列改「零宽」隐藏（`display:none` 会让行盒窄于表宽并钳死 sticky 吸右）、`min-width` 1136 → **960**
> 变更摘要：v3.22 → v3.24（2026-11-02）— **设备页瘦身 + 主设备报废兜底（见 §7.20 二）**：删掉「绑定设备」的 `.settings-group-desc` 与 `#memberHint` 两段说明（权限已放开，说明段只是在解释不存在的限制）；后端补三条 owner 自愈 —— 拉会话状态时补 owner、`EnsureOwnerSession` 改按最近活跃选人、无主时 PIN 登录直接接管
> 变更摘要：v3.21 → v3.22（2026-11-02）— **设备行动作图标化（见 §7.20 三）**：改名 / 吊销由文字按钮改为行内操作图标（`.row-act`，铅笔 / 垃圾桶，吊销恒红），与持仓等表格的行内操作统一；两段式「确认吊销」由换文案改为换图标（对勾 + `.armed` 红底描边，4 秒复位）；「添加设备」「邀请家人」去掉加号、两枚同级按钮完全同款
> 变更摘要：v3.20 → v3.21（2026-11-02）— **登录闸门 PIN 入口折叠 + 设备管理改「有 PIN 即可」（见 §7.20）**：① PIN 登录由常驻展开改为一行折叠入口（`grid 0fr→1fr` 展开，每次进闸门复位），配对码回到唯一主路径；② 设备改名 / 吊销他机 / 出码加设备不再要求主设备身份，改由操作 PIN 兜底 —— 主设备损坏时 member 也能吊销死机、加新设备；吊销后 `EnsureOwnerSession()` 自动提升在线设备，不会卡在零主设备；改 PIN / 恢复码 / 删清账本 / 导入 / 转移身份仍属主设备
> 变更摘要：v3.19 → v3.20（2026-11-02）— **线上实测三修：tab 行右端图标组统一 / 基准指数换源 / 待还款改 7 天前瞻（见 §7.18 一）**：① `.icon-btn` 会抹掉 `.btn` 的描边与 ghost 底色，v3.18 只按 `#investTools` 补回，资产页 `#assetTools` 那两枚（一键更新余额 / 添加账户）仍是裸图标 → 作用域改为公共类 `.sub-tabs-tools`，同一个「tab 行右端图标组」不再两种长相；② 基准对比的指数源从东财 push2his 换成腾讯（`sh000300` / `us.INX` / `us.NDX`）—— 东财在家宽能跑、生产容器里持续 EOF（宿主同一 URL 200），线上整行变成「行情源不可用」；③ 待办「待还款」由「应还日已到」改为「今天 + 7 天」，否则月初四组全 0、整条 Hero 底栏按设计隐藏，用户实测就是「改造看不到效果」
> 变更摘要：v3.18 → v3.19（2026-11-02）— **理财表操作列修「赎回被裁 + 名称格重复按钮」（见 §7.19）**：① 图标组内 `.row-act` 自带的 `margin: 0 4px` 与 `.ht-acts` 的 `gap` 叠加，每颗实际占 36px —— 理财 4 枚共 156px > 132px 列宽，被 `td` 的 `overflow: hidden` 裁掉最后一枚（`赎回`：DOM 正常、悬停 `opacity` 也是 1，但几何右缘 154 超出单元格 132，点不着也看不见）；改为组内 `margin: 0` + `gap: 8px`，列宽 132 → **148px**（4×28 + 3×8 + 2×2 = 140，留 8px 给悬停底与 focus ring），`min-width` 1144 → 1160；② 理财名称格删掉照抄持仓的 `.hn-acts`（持仓那两颗是「修改 / 技术分析」——操作列没有的补位动作；理财照抄过来是「编辑 / 刷新净值」，与操作列前两枚完全重复，悬停时一行 6 个图标里 2 个是同一动作）
> 变更摘要：v3.17 → v3.18（2026-11-02）— **首页快捷功能 6 → 4，低頻入口按场景归位（见 §7.18 四）**：定投计划迁到投资页 tab 行右端（仅持仓视图）、补录平仓迁到平仓视图同一位置；平仓空态补一枚「补录平仓」按钮兜住新用户；`.shortcut` 在 ≥641 改横排（图标 + 文字同行），4 格不再读成四张空卡
> 变更摘要：v3.16 → v3.17（2026-11-02）— **首页 Hero 底栏「今日待办」+ 复盘页「基准对比」+ 操作列回归悬停展开（见 §7.18）**：① Hero 卡片内部新增一条待办 strip（`GET /api/today/brief` 一次聚合止盈止损/定投/待还款/存款到期，零项整条不渲染，点击 `grid 0fr→1fr` 展开分组清单）；② 复盘页 KPI 下方新增基准对比卡（近 1 年：我的组合 vs 沪深300 / 标普500 / 纳指100，指数日线服务端 6h 缓存，账本历史不足一年时窗口自动收缩到实际覆盖区间）；③ 持仓表操作列撤销 v3.8 的「常显」覆盖，回到 spec §3.3「默认隐藏、行悬停淡入」，并给 5 颗按钮加 40ms 逐颗延迟
> 变更摘要：v3.15 → v3.16（2026-11-02）— **全站统一加载动画（见 §7.17）**：确立三层机制 —— 视图层 `.view-fade` 淡入（切页无硬切）、区块层 `.rise-in` 错落上浮（数据到达后逐块入场）、骨架层 `.skeleton-line/.skeleton-block` shimmer 占位（等待期不再空白）；覆盖全部 9 个视图；首页原有 `hero-in` 并入 `.rise-in`（两套并存会让元素动两遍）；修好此前**实际失效**的首页骨架屏（只有高度和圆角、无背景无动画，`--sk-w` 从未被消费）
> 变更摘要：v3.14 → v3.15（2026-11-02）— **资产页卡片与表格间距（见 §7.16）**：`.asset-kpi-row` 补 `margin-bottom: var(--sp-5)`（20px）——此前卡片底部直接贴住表格上沿（实测 0～1px，四个子视图里三个如此）；流水子视图的 `.holding-toolbar` 下边距收至 12px，让「卡片 → 工具条 → 表格」读起来是一组连续控件区。**页级区块间距口径统一为 20px（--sp-5）**，与财务页 / 复盘页的 flex gap 一致
> 变更摘要：v3.13 → v3.14（2026-11-02）— **资产页子 tab 提到卡片之前（见 §7.15）**：资产页与投资页统一为「视图切换条 → KPI 卡片 → 表格」的同一顺序；子 tab 去掉 `.asset-subtabs` 专用类、直接用 `.sub-tabs` 基础样式；`.sub-tab` 补 `min-height:36px` 让带/不带计数徽标的 tab 等高（原差 1px，顶边错开）
> 变更摘要：v3.12 → v3.13（2026-11-02）— **投资页改回原型 B（见 §7.14）**：v3.12 的桌面左侧竖排栏目（原型 G）下线，投资页与资产页统一为同一套下划线横排 `.sub-tabs` —— 切换条仍在页面第一位（KPI 卡片之前），但形态与资产页的「账户/现金/流水/收支」子 tab 完全一致
> 变更摘要：v3.11 → v3.12（2026-11-02）— **投资页「选择优先」（见 §7.13）**：视图切换条从「KPI 卡片之后」提到页面第一位 —— 桌面（≥1341）`#viewToggle` 变成左侧竖排栏目（136px），平板/手机（≤1340）退回顶部横排但仍排在卡片之前；同一套 `.sub-tabs` 组件只换方向，切换逻辑与计数徽标完全复用；表格最小宽随内容区收窄（1296 → 1144）以避免表内横滚
> 变更摘要：v3.10 → v3.11（2026-11-02）— **资产页摘要合并为一段（见 §7.12）**：现金 / 流水 / 收支三个子视图原先在表格上方各有一条 `.asset-sum` 合计条，与顶部 4 张卡叠成两段摘要 —— 改为**顶部 4 张卡随子 tab 换内容**（卡位固定、口径跟着视图走），三条合计条与 `.asset-sum` 组件整体下线，表格上方只剩数据；流水筛选 chips / 区间下拉变化时卡片同步刷新（与表格严格同源）
> 变更摘要：v3.9 → v3.10（2026-11-02）— **资产页回炉（见 §7.11）**：① 顶部 4 张 KPI 卡由 `density-mini`（57px、无角标）复归 `density-standard`（136px、带语义角标），与财务 / 复盘统一；②「资产结构」折叠卡整张下线，四组迷你图改为**并入 4 张卡底部的 6px 分段条**（新增 `.kpi-bar`），构成 / 区域 / 币种 / 资产对负债四个维度仍在卡内可见，卡外不再有折叠区块；③ 账户操作（一键更新余额 / 添加账户）由账户面板顶部的独立工具条并入子 tab 行右端 `#assetTools`（与投资页 `.sub-tabs-tools` 同一套做法），切到现金 / 流水 / 收支 时自动隐藏；④ `density-mini` 整档下线，`.asset-struct` / `.cmp-*` / `.asset-ov-legend` / `.hat-title` / `.hat-side` / `.collapse-body` 等随之零引用的 CSS 规则同步删除
> 变更摘要：v3.8 → v3.9（2026-11-02）— **投资页三表收口与工具条归位（见 §7.10）**：① 独立工具条 `#investToolbar` 整行删除，行密度 + 刷新行情并入子 tab 行右端的 `.sub-tabs-tools`（省 44px 首屏高度，控件不再"浮"在表格上方）；② 理财页下线分类筛选（全部/净值型/其他）——那三个 chips 筛的是"有没有录净值"这一实现细节；③ 理财页 4 张分组卡 → **单一 `.wealth-table`**、平仓页 3 张卡 → **单一 `.closed-table`**，与持仓表同一外壳（`.holdings-sheet` + `.holdings-table`，一表一 thead）；④ 行密度紧凑档改为**收掉二级信息行**（元信息行 + 数值副行），行高 57 → 43 —— 只减内边距时每行只省 2px，开关等于摆设

---

## 0.0 本轮（v3.4）定案

**路线决策**：参考同类成熟项目的体验优化思路，采纳 **"统一视觉基底 + 保留金融语义"** 的折中方案——保留科技玻璃基底与金融场景必需的语义色（涨红跌绿、资产分类色），但在组件层级、动效、微交互上全面升级。

| 议题 | 结论 |
|---|---|
| 整体质感 | **保留玻璃基底但收强度**：`blur 6→4px`、`saturate 110%→105%`、角光 alpha `.07→.04`。卡片 hover 不再只升 shadow，改 `translateY(-2px) + --sh-2` 产生"悬浮"物理感 |
| 卡片视觉层级 | **三级 tier 体系**：① Tier-1 Hero/全景卡（带角光 + 稍深底 + 微渐变）② Tier-2 内容卡（玻璃 + 1px 细边 + hover 悬浮）③ Tier-3 工具微件（半透明 + `--r-xs` 圆角）。用 `--card-tier-1/2/3` 变量统一声明 |
| 卡片异色 | Hero/全景卡保留角光但降低饱和度（alpha `.04`），让它"有光"而不是"换色"。普通卡统一 `--bg-card` + 1px `inset` 顶部高光线（暗色下 `rgba(255,255,255,.04)`、亮色下底部），消除突兀异色 |
| 弹框入场 | 从纯 fade 升级为 `scale(.94→1) + fade(0→1)`，曲线 `--e-out`，时长 240ms。backdrop 从纯半透明改为 `rgba(0,0,0,.4)` 径向渐变到 `.6`，blur 8px。关闭按钮热区 36×36，hover 浅底圆圈 |
| 表格微交互 | 新增极浅斑马纹（暗色 `rgba(255,255,255,.018)` / 亮色 `rgba(0,0,0,.025)`）；表头底色加深 6% 提升与表体的明度差；排序列加 ▲▼ 三角指示器；行密度提供紧凑(32px)/标准(40px) 两档切换（`--row-h: 32px` ↔ `40px`） |
| 按钮物理反馈 | active 从 `scale(.96)` 收为 `scale(.98)`（当前 .96 太夸张、像塌陷），过渡从 200ms 收为 120ms（按下应快弹）；primary 按钮 focus-visible 加 `0 0 0 3px rgba(var(--tint), .20)` 外圈焦点环 |
| 空态治理 | 空数据区不再纯文字——加极简 SVG 线条插画（与项目 stroke 图标风格一致）；加载态从纯 spinner 升级为 skeleton 骨架屏（`linear-gradient` shimmer 动画 1.4s 循环） |
| 大面积留白 | 弹框 body 底部、工具页空区等大面积纯背景 → 加 3% opacity 的极浅 `radial-gradient` 装饰点（只在 Tier-1 卡和弹框出现，不铺全屏） |
| 亮暗底微调 | 暗色 `--bg: #0a0e14 → #0e1115`（稍暖稍亮，纯 #0a 太冷太黑）；亮色 `--bg-card: rgba(255,255,255,.85) → #fbfcfe`（实色 + 微蓝，半透明在亮色下容易发灰看不清） |
| 保留特色（不碰） | 涨跌红绿语义色、资产分类 6 色、Hero 卡微弱渐变、表格行 hover 高亮、导航栏毛玻璃——这些是金融场景必需的语义表达或品牌记忆点 |

**与 v3.3 的关系**：完全兼容增量升级——所有 token、组件类名保留，仅追加 tier 变量、升级现有组件的 hover/active/动效参数。

---

## 0.2 本轮（v3.5）定案（设计系统统一性审计整改）

> 依据 `docs/design-system-audit.md`（2026-10-26）的 11 项发现，本轮对设计系统做一致性收口。范围限定在「组件体系统一、布局结构、信息架构、视觉层级」；代码层 token 违规不在本轮。整改分三档：**已落地（代码已改）**、**已登记（spec 定案，待专项重构）**、**已驳回（审计建议与既有约束冲突，维持原状）**。

| 议题 | 结论 | 档位 |
|---|---|---|
| KPI 三套体系分裂 | 定案统一 `.kpi-card` 组件（density 三档 + 数字字号档 + 标签字距 .5px）；hero/invest/fin 三处渐进迁移，**不强制一次性重构**（hero 为 Tier-1 主视觉，风险高） | 已登记（目标架构） |
| Hero Banner 覆盖范围 | **维持「仅持仓/首页可见」的既有约束**（memory 后加约束优先于审计的"全局可见"建议）；spec §3.12 原文与实现不符，已勘误标注 | 已驳回（维持现状 + 勘误） |
| 页面容器 padding 冗余 | 删除 style.css 早期逐页声明（1593/1595），统一块（5830）独存 | 已落地 |
| 内容密度/留白节奏 | `.invest-kpis` gap sp-8→sp-4、margin-top 4px→sp-1；`.invest-kpi` 内部 gap 6px→sp-1；`.fin-kpi-grid` gap sp-3→sp-4（统一到 16px 区块 / 4px 内部） | 已落地 |
| 子 Tab 两套并存 | `.sub-tabs` 下划线为 within-page 子视图标准（资产/投资已用）；首页 `#viewToggle` 分段控件保留为**顶层主导航**（语义层级不同，承载计数徽标），二者计数徽标样式已对齐 | 已登记（保留分层，不强制统一） |
| 标题层级/字距 | `.nw-center-label` 字距 2px→.5px；持仓分组头 `.hat-title` 字重 600→700、字号 →`--fs-lg` 对齐 L3 | 已落地 |
| 空状态未落地 | `.empty-state` 组件已建并在 ≈6 处使用；剩余 ≈20 处 ad-hoc 文本空态列入**迁移 backlog**（不阻塞） | 已登记（部分落地 + backlog） |
| 表头背景 3 源 | `--th-bg` / `--th-bg-sticky` / `--th-bg-light` 三档语义变量已存在并接线（694/741/1814 行）；审计描述的"硬编码 #e9ecef"已修复为 `--th-bg-light` | 已落地（审计时版本滞后） |
| Hero 三栏垂直对齐 | 现行 v3.5 三栏 `align-items: stretch` + 中栏 spark-wrap 吃满剩余高度，**72px 固定已废除**，右栏与中栏等高；审计 §8 建议被现行架构覆盖 | 已落地（架构已演进） |
| 年份切换器视觉权重 | `.year-nav-btn` 28→24px(`--h-1`)，描边不变；`.year-label` 字重 600→500、字号 →`--fs-sm` | 已落地 |
| 响应式断点 12 个 | **已落地**：12 → 3 档收敛（v3.6 收至 640/880/1340，v3.7 再收至 **640/1340** 真三档），白名单同步 `web/check-ui.mjs` 第 11 项 | 已落地 |

**本轮不破坏任何既有 token、组件类名、lint 白名单；仅修正间距/字号/字距/尺寸档位与冗余声明。**

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
4. **阴影为主、位移为辅**（v3.4 修订）—— 默认悬停提升阴影层级；但卡片级悬停（非表格行）允许叠加 `translateY(-2px)` 产生"悬浮"物理感（控件/表格行仍禁位移）。
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
- **占比列（v3.8 统一）**：一律「裸数字 + 单元格底部 2px 细条」，禁止整格底色/渐变。数字降一档灰（`--text-muted` / `--text-faint`），条画在既有下内边距里（`bottom: 2px`，**不加 padding**，否则该格比同行高 4px 顶乱行距）。条宽走无量纲自定义属性 `--pn`（0~1），百分比字符串不能参与 `calc()` 乘法：

  ```css
  /* 绝对定位条：宽度直接算 */
  td.share::after { width: calc((100% - var(--sp-4)) * var(--pn, 0)); }
  /* 或 transform 条：宽度铺满后缩放 */
  .atbl td.share::after { transform: scaleX(var(--pn, 0)); transform-origin: left center; }
  ```

  JS 侧**同时注入 `--p`（带 `%`，给 `title`/调试）与 `--pn`（0~1，给宽度）**。占比无分母时（如该账户无同币种现金子账户）加 `.is-empty` 隐藏细条、数值显示 `—`。

- **⚠ 整列无信息时不输出节点（v3.8 铁律）**：全表该列都为 0 / 无值时，**不要用 `display: none` 收起**——`<th>/<td>` 仍按列宽占位，表格右侧会凭空多出一整列宽度的空白（实测 395px），且横向滚动区宽度不变。正确做法是**渲染阶段就不输出这一列的 `<th>` 与 `<td>`**（`colCount` 同步减 1，组头 `colspan` 跟着改），并给依赖 `nth-child` 的规则改用显式语义类。

- **⚠ 响应式收列只能用「零宽」，不能用 `display: none`（v3.8 补）**：列能不能输出由 JS 决定，而断点由 CSS 决定；跨断点隐藏一列时 `display: none` 会留下**列槽位空洞**——`table-layout: fixed` 下行盒的实际使用宽度小于 `table` 宽度，表现为表格右侧一条死空白（1024 档实测 252px），更隐蔽的副作用是 **sticky 操作列被「包含块 = 行」钳住**，只能停在行尾而不是滚动视口右缘，吸右直接失效。改为：

  ```css
  @media (max-width: 1340px) {
    .holdings-table :is(th, td).ht-trend { width: 0; padding-inline: 0; overflow: hidden; border: 0; }
  }
  ```

  判据：**该列在别的断点还要用 → 零宽；该列当前数据全空 → 不输出节点。**

**⚠ 列宽铁律：`table-layout: fixed` 下禁止用百分比表达「按内容自适应」。**
`width: 1%` 不是「尽量窄」，而是「表格宽度的 1%」——在 1388px 宽的表格里等于 **13.9px**，图标按钮会被 `td` 的 `overflow: hidden` 整颗裁掉。
操作列等需要固定占位的列**必须给像素值**（当前持仓 `120px` = 3×28 图标 + 2×8 间距 + 左右 2px padding；理财 4 颗同公式 = 148px）。只有 `table-layout: auto` 才可写 `width: 1%`。
操作列内容**必须包一层 `display: inline-flex` 的容器**（如 `.ht-acts`，`gap: --sp-2`）：模板字符串里按钮之间的换行/缩进空白节点会额外撑宽数 px，导致第三颗按钮被 `text-overflow: ellipsis` 截成「…」。
**容器内 `.row-act` 的 `margin` 必须清零**（`.ht-acts .row-act { margin: 0 }`）：`.row-act` 自带 `margin: 0 var(--sp-1)`，与容器 `gap` 叠加后每颗占 36px —— 3 颗的持仓表刚好挤在 120px 里没露馅，4 颗的理财表就超出 24px，被 `td` 的 `overflow: hidden` 整颗裁掉（§7.19）。

### 3.3.1 行内操作按钮族

1. **一律纯图标**，不用文字按钮，不用 emoji。
2. **一律内联 SVG + `currentColor`**，线性描边 `stroke-width: 1.6–1.8`。
3. **尺寸 28×28**（`--h-2`），`border-radius: var(--r-xs)`，透明底；悬停 `background: var(--bg-hover)`。
4. **默认 `opacity: 0`，行悬停淡入**（每颗延迟 40ms 依次出现）；`@media (hover: none)` 下常显。
5. **语义色只三档**：默认 `--text-muted`、信息 `--primary`、危险 `--danger`。
6. **计数不写进按钮**，改右上角徽标（`.act-cnt`）。
7. **无障碍**：每颗按钮必须有 `aria-label` + `title`。
8. **不碰 `data-*` 钩子**。
9. **操作列宽度必须给像素值**（v3.8 起 `120px`），内容包一层 `inline-flex` 容器吸收模板空白节点。

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

### 3.3.3 0 值降噪与行情状态徽章（v3.8 新增）

**问题**：开盘前（A股 09:30 前）/ 休市日，全站盈亏类数值都是 0。旧版一律渲染 `¥0.00` 并染成涨跌色，一屏七八个 `¥0.00`，读者分不清「确实是 0」还是「接口没返回 / 页面没加载」。

**三条处置**：

1. **`—` 替代 `¥0.00`**：`.zero-dash`（`--text-faint` + `font-weight: 400`）。判据统一走 `amtIsZero(v) = Math.abs(Number(v) || 0) < 0.005`，颜色由 `is-idle` 类整体降权，**不染涨跌色**。0 不携带方向信息。
2. **就地徽章 `.mkt-badge`**：哪个数字不新鲜，就把徽章钉在**那个数字旁边**，零占位、跟着卡片走。**不用整页横幅**——横幅占 35px 首屏、滚出视口即失效、还与下方日期标签重复。
   - `.is-pre`（待开盘）：中性灰（`--text-muted` + `rgba(var(--tint),.12)`）。只是还没开始，不是异常，**不该报警示色**。
   - `.is-closed`（休市）：琥珀（`--warning`）。休市既非涨也非跌，红绿都会被读成方向。
   - 尺寸比主数值小一档（`--fs-xs` / 16px 行高），`vertical-align: 1px`；跟在 `.kpi-value` 大字后时改用 `:has()` + flex 居中，避免沉到基线以下像下标。
3. **原因写在副标 / `title`**：如「09:30 开盘后更新」「今日休市，显示最近交易日 10-31 的涨跌」。三态判定集中在 `pnlDayInfo()` + `dayBadge()` 两个函数，页面不再各自判断。

**「整列/整块无信息」的处理顺序**：先看能不能整列不渲染（见 §3.3 铁律），退而求其次才是逐格 `—`。全列为空时连表头一起不输出，比留一列破折号更干净。

### 3.4 弹窗（三段式，不可拆）

| 区 | 选择器 | 规则 |
|---|---|---|
| 遮罩 | `.modal` | `rgba(0,0,0,.55)` + `blur(4px)`；`[hidden]` 时 `display: none` |
| 容器 | `.modal-card` | `--bg-card-solid` + `--r-lg`(16px) + `--sh-3`；`overflow: hidden`；`display: flex; flex-direction: column` |
| 头部 | `.modal-card > h2` | 固定，不滚动 |
| 内容 | `form` / 直接子 div | **唯一滚动区**：`flex: 1; min-height: 0; overflow-y: auto` |
| 动作区 | `.modal-actions` | `flex: 0 0 auto` 常驻底部 + `border-top`；右对齐；padding 上下对称 |

宽度档（v3.3 以代码实测修正）：`380px`（默认）/ `420px`（≤640 移动端上限）/ `560px`（#modal 持仓表单）/ `660px`（#calModal 日历）/ `780px`（.chart-card 图表）/ `900px`（#pnlModal 盈亏明细），一律叠 `min(…, 94vw)`。
入场：`translateY(12px) scale(.98)` → 归零。
纵向节奏（行距 / 主分组断点 / actions 对称）见 **§6.3**。

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

> **⚠ 勘误（2026-10-26）**：上述「全局可见」与当前实现不符。项目 memory 后加硬约束——「Hero banner 仅在持仓/首页展示，其他页面隐藏」。**以 memory 约束为准**，Hero 当前仅在 `#homeView` / `#holdingsView` 可见；spec 原文待修订为「首页/持仓页可见，其他页隐藏」。审计 §二 的「全局可见两档 density」建议已驳回（见 §8.3）。

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

### 3.13 响应式适配（v3.2 新增）

**目标设备（CSS px 视口）—— 三档制（2026-10-28 收敛）**：

| 形态 | 覆盖设备 | 内容视口宽 | 命中断点 |
|---|---|---|---|
| 电脑 | 桌面 1920 / 1440 / 1366 笔记本 | ≥1341 | 电脑档：全部铺开 |
| 平板 | 小米平板 6s Pro（横/竖）、iPad、1024–1340 笔记本 | 641–1340 | 平板档：塌栏 + 隐藏次要列 |
| 手机 | iPhone 17 Pro（竖 393 / 横 852）、安卓机 | ≤640 | 手机档：底部 tab 栏 + 单列 |

> **只适配这三种形态**。平板横屏（~1100–1280）与 1366 笔记本共用平板档，不再为「平板窄」单开一档 ——
> 原 880 档已并入 1340 档，原 881–1340 中档规则已删除或同化。

**核准断点集（白名单，`check-ui.mjs` 第 11 项强制）**：

`{ 640, 641, 1340, 1341 }` — 实质只有 **3 档**，641 / 1341 是相邻档的 `min-width` 补位值（不与 `max-width` 重叠），不是独立断点。

> **2026-10-28 二次收敛（v3.7）**：原 4 档（640 / 880 / 1340 + 881 补位）→ 3 档。
> 所有 `max-width: 880px` 上移到 1340；`min-width: 881px` 上移到 1341；
> `min-width: 881 and max-width: 1340` 的中档规则删除（holdings 列隐藏）或并入平板档（净值芯片紧凑档）。
> 更早的 12 → 4 档收敛见审计 §十一（2026-10-26）。

| 断点 | 形态 | 语义 |
|---|---|---|
| ≥1341 | 电脑 | 全部铺开，`#app` 内视图 `max-width:none`，持仓子表全列，`.kpi-row` 4 列/5 列 |
| 641–1340 | 平板 | 持仓子表隐藏「趋势/涨跌幅/仓位/持仓天数」4 列、Hero / pano 塌栏、`.kpi-row` 2 列（锚点卡跨整行）、热力图竖排、`modal-card` 94vw、净值芯片紧凑档 |
| ≤640 | 手机 | 底部 tab 栏、`.list-bar` 取消吸顶、`.kpi-row` 单列、表格/热力图单列、表单 2 列 |

**各设备关键行为**：

- 电脑 1920：`#app { max-width: 2200px; margin-inline: auto }` 仅在 ≥2200 带鱼屏收边，1920 等同满宽；`.list-bar` 筛选行 `position: sticky; top: 58px` 吸顶（顶栏本身已吸顶）。
- 平板：持仓子表按平板档统一隐藏 4 列，避免卡内横向滚动；1024–1340 与 641–880 表现一致（同一套规则）。
- 手机：顶部补 `env(safe-area-inset-top)` 内边距（Dynamic Island 不被遮挡）；底部 tab 栏 + `overflow-x: clip` 禁整页横滑。

**资产构成卡（`.as-comp-card` / `.as-cards` / `.asb-comprow`，v3.2 布局）**：

- 顶部统计小卡 `.as-cards`：`auto-fit minmax(180px,1fr)`，≤1100 三列、≤640 两列。
- 资产构成卡 `.as-comp-card` 满行（`grid-column:1/-1`）；内部 `.as-comp-flex` 用 `grid repeat(auto-fit,minmax(0,1fr))` 等宽子面板（无地域数据时自动退两列）。
- 三条对比（资产负债 / 按类别 / 按地域）保留各自小标题；`.asb-comprow + .asb-comprow` 加竖向分隔线 `border-left`，首/末面板去外侧 padding。
- ≤640px 回退纵向堆叠，分隔线由竖转横（`border-top`）。

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
| 香港 HK | 紫 `191,90,242` → **靛 `94,92,230`**（亮色 `78,76,200`，2026-10-16 随账户地域 cn/hk/us 改版） | 与币种 HKD 同色，跨维度联想一致 |
| 美国 US | — | **新增 蓝绿 `42,163,155`**（亮色 `30,140,134`，2026-10-16） | 与币种 USD 同色 |
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
| 响应式断点白名单 | 断点 ∈ {640,641,1340,1341}（3 档 + 2 补位） | **全部命中** ✅（实测 640/641/1340/1341，见 §3.13） | `npm run lint:ui`（第 11 项） |
| 死 class | CSS 定义类必须被引用（硬门：类名至少出现一次） | **0 报错**（严格判定的变量中转项仅提示） | `npm run lint:ui`（第 12 项） |
| `style.css` 总行数 | — | **6409**（随迭代浮动，非硬门槛；v3.2 新增断点策略与资产构成卡布局） | — |
| `dist/style.css`（min） | — | **≈190 KB（194.5 KB）**（随迭代浮动，非硬门槛） | `npm run build` |

### 5.1 允许不做 token 化的例外（明确登记，避免反复误判）

| 类别 | 例子 | 理由 |
|---|---|---|
| 主题 token 定义 | `:root` / `[data-theme="light"]` / `--accent` 预设 / `.accent-swatch` | 它们**就是**字面量的唯一来源 |
| 日历 / 图表色阶定义 | `--cal-up-1..4`、`.donut-center` 的 `4.2px` | 专用色阶，已 token 化；donut 字号是 **SVG viewBox 单位**，不是 CSS px |
| 阴影与遮罩 | `rgba(0,0,0,.5)`、`rgba(15,23,42,.12)` | 无复用语义 |
| 固定深色浮层内的取值 | `.trend-tip` 的 `#bcc0c7 / #ff7875 / #95de64 / #8a8f99` | 该浮层背景恒为深色，不随主题翻转 |
| 2px 级光学值 | `gap: 2px`、`border-radius: 2px`、`1px` 描线 | 属视觉微调，不在网格体系内 |

---

## 6. 页面骨架、标题层级与纵向节奏（v3.3 合并自根目录 design.md）

> 生效范围：`web/` 全部页面。维护约定：**改动布局间距前先读本文**；新规约落地后同步更新本文与 `web/check-ui.mjs` 校验白名单；新页面/新组件在 §6 补条目。

### 6.1 首页骨架（v3.3 定案：持仓/理财 顶层切换）

```
header（顶栏）
hero 区        ← 页面级 KPI（.hat-side 贴最右）
list-bar       ← 搜索/筛选 + 操作按钮
tbl-meta-bar   ← 左：tbl-desc「持仓（N）」；右：分段切换（.view-toggle + .vt-indicator，持仓/理财）
内容区         ← 理财 #homeWealthBox ／ 持仓 #holdingsBySource（二选一）
```

- **切换行必须位于内容区 DOM 之前**（v3.3 修复：理财表格曾渲染在切换条上方，长表格把切换条挤出视野）。
- 理财态 `tbl-desc` 留空——`renderWealth` 自带「理财（N）」小节标题，避免重复。
- DOM 顺序：`.tbl-meta-bar` → `#homeWealthBox` → `#holdingsBySource`。

### 6.2 标题层级（从严到松）

| 层级 | 元素 | 字号/字重 | 备注 |
|---|---|---|---|
| L1 页面主数字 | hero | 26~28px / 700 | 唯一大字层 |
| L2 弹框标题 | `.modal-card > h2` | `--fs-xl` / 700 | padding `24 28 12` |
| L3 分组标题 | `.settings-group-title` / `.asset-section-head h3` | `--fs-lg` / 700 | |
| L4 行描述 | `.tbl-desc` / `.settings-group-desc` | `--fs-sm` / 400 / muted | |

> **2026-10-26 对齐**：持仓分组头 `.holdings-group .collapse-hat .hat-title` 已统一为 `--fs-lg` / 700（此前 600 / `--fs-base`，低于 L3）。所有眉标字距统一 `.5px`（消除 `.nw-center-label` 的 2px 例外，见 §8.1）。

### 6.3 纵向节奏（核心规约）

**设置/AI 分组卡（`.pano-open .settings-group`）**：

```
┌ 标题   padding: 16 24 8            ┐
│ 描述   padding: 4 24 12            │  ← 标题↔描述 = 12px
│ 正文   padding: 12 24 24, 内部 gap 16 │  ← 描述↔内容 = 24px
└                                    ┘
```

- 分组与分组之间：`settings-layout` gap = `--sp-6`（24px）。
- 折叠态（`.collapsible.collapsed`）：只留标题行，标题 padding-bottom 补 `--sp-4`。
- 间距 token 语义速记：`--sp-3`(12px)=**表单行距、分组标题↔描述**；`--sp-5`(20px)=**弹框主分组断点、actions 区上下**；`--sp-6`(24px)=卡片/分组水平内边距。

**弹框（`.modal-card`）纵向节奏**：

| 部位 | 规约 |
|---|---|
| 标题 `h2` | padding `24 28 12`，`--fs-xl`/700，flex-shrink:0 |
| 滚动区 `form`/`.m-body` | padding `4 28`，flex:1 + overflow-y |
| **普通行距** | label/行容器 `margin-bottom: --sp-3`（12px），全弹框统一 |
| **主分组断点** | 首行（名称/代码联想）之后升到 20px：`#form > .f-search-label { margin-bottom: --sp-5 }` |
| actions 区 | padding `20 28`，上描线，上下 padding 必须对称（防按钮贴底被裁） |
| 水平内边距 | 28px 统一（h2/p/form/m-body/actions 同宽对齐） |

**列表/表格区**：

- `.tbl-meta-bar` 与内容区间距 16px。
- 表头 11px（`--fs-xs`）/ td 13px（`--fs-md`）/ 数值列 `td.num` mono + tabular-nums。
- **表格中性数字一律 `--text-muted`**（`td.num:not(.up):not(.down)`）；新红绿规则必须 `:not()` 排除中性。

### 6.4 组件细则（补充条目，与 §3 重复处不另立）

- badge：10px / 圆角 4 / 浅底 12% 透明度。
- **弹框显隐兜底铁律**：凡元素自带 `display` 规则（如 `display:grid` 面板），必须显式配 `[hidden]{display:none}`，否则 `hidden` 属性被类规则压过而失效。
- 动效曲线统一 `cubic-bezier(.32,.72,0,1)` 或 `var(--e)`，时长 0.12~0.2s。

### 6.5 合规校验

```bash
node --check web/app.js        # 语法
node web/check-ui.mjs          # 设计规范 12 项（含 4px 网格、语义色字面量、断点白名单）
```

新增间距必须过 4px 网格检查（§5 同款校验）。

---

## 7. v3.4 组件升级规范

> v3.4 在 v3 基底上增量升级，所有既有 token / 类名保留，仅追加新变量与新状态。

### 7.1 卡片三级视觉层级（新增）

引入 tier 体系，消除"所有卡片一个样"的扁平感：

| Tier | 适用 | 底 | 边界 | 装饰 | Hover |
|---|---|---|---|---|---|
| **Tier-1** `.card.tier-1` | Hero、资产全景、汇总 Hero 卡 | 比页面底亮一档：暗色 `rgba(22,28,38,.84)`（略亮于 `--bg-card`），亮色必须**亮于页面底** `#ffffff`（页面 `#f4f6f9`、普通卡 `#fbfcfe`） | 1px `--border`（Hero 用 `rgba(var(--tint),.14)`） | `--card-glow` 角光 alpha `.04`（v3.4 降）+ 微弱 `radial-gradient` 装饰点 | `translateY(-2px) + --sh-2` |
| **Tier-2** `.card`（默认） | 普通内容卡：持仓卡、工具卡、设置分组 | `--bg-card`（玻璃） | 1px `--border` + 顶部 inset 高光线 `rgba(255,255,255,.04)`（亮色下改底部） | 无 | `translateY(-2px) + --sh-2` |
| **Tier-3** `.card.tier-3` | 工具微件、inline 统计 chip | `--bg-soft` 半透明 | 1px `--border` | 无 | 无位移，仅阴影微升 |

**token 新增**（写入 `:root`）：

```css
/* Tier-1 专属（Tier-2/3 继续用既有 --bg-card） */
--bg-card-tier1: rgba(22, 28, 38, .84);    /* 暗色：略亮于 --bg-card（.84 vs .82） */
--bg-card-tier1-light: #ffffff;             /* 亮色：必须亮于页面底 #f4f6f9；用浅灰会低于页面明度，读成"凹陷卡" */
--card-glow-v34: radial-gradient(122% 94% at 100% 0%, rgba(var(--tint), .04) 0%, rgba(var(--tint), 0) 58%);
--card-inset-line: inset 0 1px 0 rgba(255,255,255,.04);  /* Tier-2 顶部高光线（暗色） */
--card-inset-line-light: inset 0 -1px 0 rgba(0,0,0,.05); /* Tier-2 底部高光线（亮色） */
```

### 7.2 弹框入场动效（v3.4 升级）

**遮罩 backdrop**：

```css
.modal {
  background: radial-gradient(ellipse at center, rgba(0,0,0,.40) 0%, rgba(0,0,0,.60) 100%);
  backdrop-filter: blur(8px);
}
```

**入场动画**（替代 v3.3 的纯 fade）：

```css
@keyframes modalIn {
  from { opacity: 0; transform: scale(.94); }
  to   { opacity: 1; transform: scale(1); }
}
.modal-card-enter { animation: modalIn 240ms var(--e-out); }
```

**关闭按钮**：热区从 24px → 36px（`.modal-close { width: 36px; height: 36px }`），hover 加 `background: var(--bg-hover)` + `border-radius: 50%`。

### 7.3 表格微交互（v3.4 增强）

**新增斑马纹**（极浅，不抢内容）：

```css
tbody tr:nth-child(even) { background: rgba(255,255,255,.018); }  /* 暗色 */
:root[data-theme="light"] tbody tr:nth-child(even) { background: rgba(0,0,0,.025); }
```

**表头底色加深**：从 v3.3 的 `rgba(255,255,255,.03)` → `rgba(255,255,255,.05)`，提升与表体的明度差。

**排序列指示器**：排序激活列的表头右侧加 8px ▲▼（`color: var(--primary)`），未排序列不显示。

**行密度切换**（新增）：

```css
/* 默认：标准 40px（--row-h 原值） */
/* 紧凑档：--row-h 降为 32px，字号不变，padding 上下各减 4px */
body[data-density="compact"] .holdings-subtable td { padding-top: 4px; padding-bottom: 4px; }
body[data-density="compact"] .holdings-subtable { --row-h: 32px; }
```

切换入口：表格右上角新增 `.density-toggle` 分段控件（紧凑 / 标准），`localStorage` 记忆用户选择。

### 7.4 按钮物理反馈（v3.4 调整）

| 状态 | v3.3 | v3.4 | 理由 |
|---|---|---|---|
| `:hover` | `translateY(-1.5px)` + `--btn-shadow-hover` | `translateY(-2px)` + `--btn-shadow-hover` | 与卡片悬浮统一 |
| `:active` | `scale(.96)` + 过渡 200ms | `scale(.98)` + 过渡 120ms | .96 太夸张像塌陷；按下应快弹 |
| `:focus-visible` | 无 | `box-shadow: 0 0 0 3px rgba(var(--tint), .20)` | 主按钮外圈焦点环，符合 WCAG 可访问性 |

### 7.5 空态与加载态（新增）

**空态（Empty State）**：统一 `.empty-state` 组件

```
[SVO 线条插画]      ← 120×120，stroke var(--text-faint)，与项目图标风格一致
[主标题]            ← --fs-base / var(--text-muted)
[副描述（可选）]     ← --fs-sm / var(--text-faint)
[主操作按钮（可选）]  ← .btn.primary
```

插画参考 key（与 §3.3.2 图标字典对齐）：
- 持仓空 → `inbox`（空盒子）
- 搜索无结果 → `search-x`（搜索 + 叉）
- 加载失败 → `alert-triangle`

**骨架屏（Skeleton）**：`.skeleton` 组件，shimmer 动画 1.4s 循环

```css
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.skeleton {
  background: linear-gradient(90deg,
    rgba(255,255,255,.04) 0%,
    rgba(255,255,255,.10) 50%,
    rgba(255,255,255,.04) 100%);
  background-size: 400px 100%;
  animation: shimmer 1.4s ease-in-out infinite;
  border-radius: var(--r-sm);
}
```

骨架屏应用场景：表格首次加载、弹框内容加载、Hero 数据拉取中。**已有缓存数据时不显示骨架屏，直接渲染**（避免闪烁）。

### 7.6 大面积留白填充（新增）

在 Tier-1 卡和弹框 body 底部等大面积纯背景区，加 3% opacity 极浅径向装饰点，避免"一整片死白/死黑"：

```css
/* 只在 .tier-1 卡和 .modal-card 内生效，不铺全屏 */
.tier-1::after, .modal-card::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at 20% 120%, rgba(var(--tint), .03) 0%, transparent 50%);
}
```

**禁止在页面 body 或 Tier-2/3 卡铺此纹理**——会与密集表格行线打架。

### 7.7 亮暗主题背景微调（v3.4）

| token | v3.3 | v3.4 | 理由 |
|---|---|---|---|
| `--bg`（暗色） | `#0a0e14` | `#0e1115` | 纯 #0a 太冷太黑，微提亮后毛玻璃卡的明度差更自然 |
| `--bg-card`（亮色） | `rgba(255,255,255,.85)` | `#fbfcfe`（实色 + 微蓝） | 半透明在亮色下容易透出 body 背景发灰；实色保证内容清晰度 |
| `--bg-card-solid`（暗色） | `#141a24` | `#161c26` | 与 `--bg-card`（半透明合成后）的明度差更均匀 |

**影响面**：仅 `:root` 和 `[data-theme="light"]` 两处 token 定义行，不涉及组件选择器。

---

## 7.8 统一 KPI 组件（v3.6 已落地，审计 §一）

> 原型：`tab-redesign-prototype/kpi-card-prototype.html`。四页（首页 Hero / 投资 / 资产 / 财务）与盈亏日历弹框共用同一套壳，差异只体现在**外层 row 模板**与**卡内可选可视化块**。

- **基类 `.kpi-card`**：`padding:--sp-4` / `gap:--sp-1` / `--bg-card` + 1px `--border` + `--r`；内部语义层级固定 `kpi-eyebrow → kpi-label → kpi-main(.kpi-value) → kpi-sub → kpi-extra`，用 `order` 保证 DOM 顺序可变。
- **角标 `.kpi-icon`**：绝对定位右上 32×32；语义配色统一由 `.kpi-ico-{equity|fund|cash|debt|up|down|pct}` 提供，页面不再各写一套 icon 色。
- **两档密度**：`.density-hero`（首页净资产，44px / 渐变眉标线）· `.density-standard`（默认，28px；≤640 降 `--fs-xl`）。数字字号只用 `--fs-xl / --fs-2xl` 档与既有 44px Hero 大字。
  - ~~`.density-mini`（页级摘要条专用，20px + 关角标）~~ **2026-11-02 整档下线**：资产页 4 卡降 mini 后卡高只剩 57px，与财务 / 复盘两页的 136px 标准卡并排时判若两页（用户反馈「高度骤降、风格不一」）。**要省首屏高度应该删重复内容，不能把卡变薄** —— 同日资产页的做法是删掉与 KPI 重复的摘要条、删掉横在表格上方的折叠卡，而不是压扁卡片。
  - 选档原则：**主内容就是这组数字的页**用 standard（投资/财务/复盘/资产）。同一页内不混档，全站默认只有 standard 与 hero 两档。
- **卡内槽位 `.kpi-foot` / `.kpi-extra`（2026-11-02 下线）**：二者是资产页 4 张 standard 卡的专属消费者。卡内可视化改由 `.kpi-bar`（6px 分段条，`order:5`）承担，详见 §7.11。类名零引用即须同步删 CSS 规则（check-ui 第 12 项死类硬门）。
- **加重变体 `.anchor`**：投资页锚点卡，`padding:--sp-5` + 40px 角标 + 32px 数字。
- **行模板 `.kpi-row`**：`.cols-flat`（4 等宽：财务 / 资产）· `.cols-anchor`（1.6+1+1+1：投资）。≤1340（平板档）→ **2×2**（v3.8 修正：锚点卡**不再跨整行**——跨行后剩 3 张在 2 列里排成 2+1，末行右侧空掉半格，1024 档实测每格 480px 的空洞；锚点卡的层级改由 32px 字号 + 加重 padding 维持，不靠跨度）；≤640 → `.cols-anchor` 2×2、`.cols-flat` 单列。
- **标题行 `.kpi-head`**：眉标在左 + 控件在右（年份切换），`min-height:--h-2` + `margin-bottom:--sp-3`；三页共用 → 卡片上方留白只有一处口径。
- **已废弃**：`.invest-kpis/.invest-kpi`、`.fin-kpi-card/.fin-kpi-icon/.fin-kpi-label/.fin-kpi-value/.fin-kpi-sub`、`.nw-info/.nw-networth/.networth-label/.networth-value`、`.asset-cmp-grid/.asset-cmp-cell/.asset-cmp-hd`、`.fin-page-title/.fin-page-h/.fin-page-sub`。

## 7.9 持仓单表（v3.8 已落地，信息密度整改 A1 + A2）

> 旧结构：**每个账户一张 `.holdings-subtable`**（4 个账户 = 4 个 thead + 4 段列宽规则），每张表 12 列。同一屏出现 4 条表头、用户要在 3 组「市值/占比/今日/盈亏」之间反复对照；12 列被压到平均 116px，基金全名只能截断，「代码/成本/天数」三列几乎不可读。首屏可见数据行 **0 行**。

**新结构：单一 `.holdings-table`**

- 外层 `.holdings-sheet` → `.subtable-wrap`（`overflow-x: auto`）→ `table.holdings-table`（`table-layout: fixed`，`min-width: 1296px`）。
- **一个 `<thead>`，8 列**：`名称 · 走势 · 现价 · 市值 · 占资金池 · 今日 · 盈亏 · 操作`。全列为空时「今日」不进 DOM → 7 列。
- **账户用 `<tbody class="hold-grp">` 表达**：每组首行是组头 `tr.h-grp`（`colspan` 满宽），内含 `.hg-name`（账户名）+ `.hg-count`（N 项）+ `.hg-stat`（市值 / 今日 / 总盈亏）+ `.hg-chev`。
  - 组头**不对齐表格列**，它是独立的一行摘要条（旧版组头塞进第一个 `<td>` 并被列宽挤压）；对应地，**任何依赖 `nth-child` 的规则都必须改成语义类**（`.hg-stat-day`），否则组头少一项时选择器整体错位。
  - 折叠态：`tbody.is-collapsed tr:not(.h-grp) { display: none }`，箭头 `rotate(-90deg)`；状态存 `holdCollapsed` Set，跨渲染保持。
- **列宽（§3.3 铁律：像素值）**：走势 160 / 现价 120 / 市值 140 / 占资金池 112 / 今日 124 / 盈亏 140 / 操作 120 = 916px，名称列吃剩余（1500 视口约 380px）。平板档（≤1340）走势列**宽度归零**（不是 `display:none`，见 §3.3），`min-width: 960px` —— 756 固定宽 + 名称 204，正好塞进 1024 内容宽 982，多 1px 就会多出一条 18px 横滚且组头摘要条溢出视口右缘。**邻列数字必须留够 20px 以上空隙**，否则两列大数字视觉粘连。
- **名称格两行**：`.hn-top`（`.hn-name` 全名 + 桌面端 `.hn-acts` 图标）／`.hn-meta`（`代码 · 成本 · 天数` 元信息）。数值格同理：`.hp-main`（主值）+ `.hp-sub`（比率/原币副行）。用垂直信息代替横向加列，是 12 列 → 8 列的关键。
- **手机（≤640）退化为网格卡片行**（`table` / `thead` 整体 `display: block/none`）：
  ```css
  tbody > tr:not(.h-grp) { display: grid; grid-template-columns: minmax(0,1fr) auto;
    grid-template-areas: "name pnl" "name mv"; }
  ```
  只保留名称 / 盈亏 / 市值。**隐藏列必须用 `tbody > tr > td.ht-xxx` 的高特异性**——通用 `td { display: block }` 会把 `display: none` 覆盖回去，隐藏列照旧显示并撑高行。操作图标从名称行迁到元信息行（`.hn-acts-m`），放名称行会把长基金名压到只剩 7 个字。
- **操作列悬停展开（v3.17 修正）**：v3.8 曾覆盖成 `opacity: 1` 常显，v3.17 已撤销并回到 spec §3.3 的「默认隐藏、行悬停淡入」+ 40ms 逐颗延迟；触屏仍靠 `@media (hover: none)` 常显兜底。详见 §7.18 三。
- **占比细条要单独补规则**：B2 的「裸数字 + 2px 细条」原本只写在 `.holdings-subtable` / `.atbl` 上，迁成 `.holdings-table` 后**旧选择器不再命中，细条静默消失**（页面不报错、只是少了一个 2px 装饰，极易漏检）。迁移表结构时，凡按祖先类名限定样式的列（`.share` / `.num` / 吸右操作列）都要逐条确认新宿主是否命中。
- **细条贴数字，不贴行底**：持仓行是两行文字（行高 57px），若按资产页那样钉 `bottom: 2px`，条会横在两行之间被读成「行分隔线」。改用 `top: calc(50% + 8px)`，正好落在居中数字下方 1–2px。
- 行密度切换（紧凑/标准）规则原本只挂 `.holdings-subtable`，迁移后**必须同步补 `.holdings-table`**，否则工具条开关变死按钮。⚠ 仅补内边距不够：两行内容的行高不受 padding 支配，紧凑档只省 2px。正确做法见 **§7.10 五**。

**量化结果**：thead 4 → 1，列 12 → 8，首屏数据行 0 → 8，横向溢出 `1458/1458`（无滚动），表头下移至 376px。平板 1024 档：2×2 KPI 后表头上移到 499px（原 624px，省 125px），表格 982px 零横滚，操作列右缘 1003 = 滚动视口右缘（吸右正常）。

## 7.10 投资页三表收口与工具条归位（v3.9 已落地）

> 触发：三页各自演化出不同表结构——持仓是单表，理财与平仓仍是"每账户一张卡 + 一套表头"。同时持仓页顶部还留着一整行只有一个右侧控件组的工具条。同页三个视图三种读法，用户每次切 tab 都要重新找表头。

### 一、视图级控件并入子 tab 行

- **旧**：`<div id="investToolbar" class="holding-toolbar">` 独立一行，内部只有 `margin-left:auto` 的右侧控件组 —— 左侧永远空白，既浪费 44px 首屏高度，又让控件"浮"在表格上方无所依托。
- **新**：`<span class="sub-tabs-tools" id="investTools">` 直接挂在 `#viewToggle` 内，`margin-left:auto` 贴住 tab 行右端；tab 与控件共用同一基线。
  ```css
  .sub-tabs-tools { margin-left: auto; display: flex; align-items: center; gap: var(--sp-2); }
  .sub-tabs-tools:empty { display: none; }   /* 存款态没有视图级控件，空容器自动收起、不占位 */
  ```
- **判定规则**：*只影响当前视图显示方式的设置*（行密度、刷新当前视图数据）跟视图切换器同一行；*跨视图/跨页的动作*（新增、导入导出、筛选整页数据）才独占一行，沿用 `.holding-toolbar`。
- **同类排查结论**：资产页「流水」的 `.holding-toolbar` 左侧是类型 chips、右侧是区间下拉，双端都有内容，属正常工具条；存款区头的 `.asset-toolbar` 同理。全站真正"孤立"的只有投资页这一处。
- 手机档 `.sub-tabs-tools .density-toggle { display: none }` —— 手机上每行已退化成卡片，不存在"行高"这条设置，只留刷新。

### 二、理财单表 `.wealth-table`

- **列集**：`名称 · 净值 · 金额 · 占该组 · 今日收益 · 累计收益 · 年化 · 操作`。净值 / 今日收益**整列为空（无任何产品有值）时不输出 `<th>/<td>`**（§3.3 铁律），`colCount` 与组头 `colspan` 同步减 —— demo 库里 6 条产品全无净值，若照旧输出就是白白一条 `—` 列。
- **列宽**：净值 112 / 金额 180 / 占该组 128 / 今日 128 / 累计 200 / 年化 128 / 操作 148，`min-width: 1160px`，名称列吃剩余。
- **口径注意**：理财的占比是「占该组」而不是持仓的「占资金池」——理财不走现金子账户池，标题与 title 都要写清。
- **操作列 148px**：比持仓多一枚（编辑 / 每日盈亏 / 净值 / 赎回）。**宽度必须按「颗数 × 28 + (n−1) × 8 + 4」算**，2026-11-02 曾按「多一枚就 +12px」估成 132，实际 4 枚要 140，最后一枚被裁（§7.19）。
- **名称格不放行内操作**：持仓名称格的「修改 / 技术分析」是操作列没有的补位动作，理财没有等价物，照抄就会与操作列重复（§7.19）。
- **平板（≤1340）**：净值与年化**宽度归零**（§3.3：不能 `display:none`），保住金额、占比、累计收益。
- **手机（≤640）**：`名称 + 累计收益（含收益率副行）+ 金额`，净值/占该组/今日/年化整列收起。

### 三、平仓单表 `.closed-table`

- **6 列**：`名称 · 类型 · 盈亏金额 · 盈亏% · 天数 · 操作`。**代码并入名称格元信息行**（`代码 · 已清仓/手动补录`），来源即组头账户名，不再单列 —— 旧版 7 列里「代码」「来源」两列在本视图是冗余的。
- **列宽**：类型 120 / 盈亏金额 220 / 盈亏% 152 / 天数 120 / 操作 132，`min-width: 880px`。
  - 只有 5 个数值列，`table-layout: fixed` 下**未给宽度的名称列会吃掉全部剩余**（实测 1458 视口里名称独占 897px，数字挤在最右）。把数值列放宽是在 fixed 布局里唯一有效的平衡手段；对名称列写 `width: 420px !important` 无效。
- **`.ct-type` 徽标必须显式回归**：它是「中性底 + 6px 语义色圆点」（股票橙 / 基金靛 / 理财蓝绿）。单表化时随旧列规则一起被删过一轮，徽标静默退化成裸文字 —— 这类"少一层装饰不报错"的失误只能靠截图复核。
- **手机**：隐藏类型与天数，保留 `名称 + 盈亏金额 + 盈亏%`。

### 四、组头（`tr.h-grp`）在手机只能留一个主数字

三个视图的组头各自减到一项，且**各项口径一致（都是"这个账户赚了多少"）**：

| 视图 | 桌面 | 手机（≤640） |
|---|---|---|
| 持仓 | 市值 + 今日 + 总盈亏 | **总盈亏** |
| 理财 | 合计/多币种 + 今日 + 累计收益 | **累计收益** |
| 平仓 | 落袋 + 盈亏率 | **落袋** |

- 390px 下列宽只有 350，组头这一行要塞「图标 + 账户名 + N 只/笔 + 2 个带标签的数字」——实测三项全被省略成 `平安… / ¥7.32… / -¥2,968…`，等于什么都没说。
- 配套的 flex 职责写死：`.hg-l { flex: 1 1 auto; min-width: 0; overflow: hidden }`（名称吃剩余并省略）、`.hg-count` / `.hg-r` 一律 `flex: 0 0 auto` + `nowrap`。`.hg-l` 原本只是 `inline-flex`，默认 `flex-shrink: 1`，右侧统计一挤就把账户名压成两个字。

### 五、行密度紧凑档：收「二级信息」，不是只减内边距

- 单表化后名称格是两行（名称 + 代码·成本·天数）、数值格也是两行（主值 + 比率），行高由内容撑死。只把上下内边距 8px → 4px，每行只省 **2px**（实测 57 → 55），开关等于摆设。
- 紧凑档改为**整行收起二级信息**：`.hn-meta-t` 与 `.hp-sub` 不渲染 → **57 → 43**（平仓表单行名称本就 50 → 37）。
  ```css
  body[data-density="compact"] .holdings-table .hn-meta-t,
  body[data-density="compact"] .holdings-table .hp-sub { display: none; }
  ```
- **只收 `.hn-meta-t`，不收 `.hn-meta`**：手机专用操作组 `.hn-acts-m` 就住在 `.hn-meta` 里。用户在桌面选紧凑再缩到手机窗口时，收掉整行会让三枚图标一起消失。

### 六、本轮三条"静默失败"（都不报错，只能靠度量发现）

1. **桌面列宽必须定义在响应式覆盖之前**。`.closed-table { min-width: 880px }` 原本跟着「已平仓汇总视图」章节写在文件后段（约 2860 行），与 ≤640 的 `min-width: 0` 特异性相同、位置更后 → 手机端表格仍按 880px 排版，右侧「盈亏金额 / 盈亏%」被整块推到屏外，页面只剩名称和「已清仓」两行字。凡"桌面固定宽 + 断点归零"的组合，**桌面那条必须在文件里先出现**。
2. **同一属性在多个 ≤640 区块里重复定义，后出现的静默胜出**。`.sub-tab` 的手机内边距在文件前段和后段各写了一份，后段那份是旧值 `var(--sp-2) var(--sp-3)` → 每个 tab 需要 76px 而行内只有 72px，计数徽标被挤到第二行、tab 高 50 而非 36。改完 CSS 后必须**实测**（`getComputedStyle`）而不是看源码里"我写的那条"。
3. **组头 `td[colspan]` 会跟着表格最小宽度一起溢出**。手机端组头右侧数字消失，看起来像 flex 布局问题，实际是整张表 880px 宽、组头摘要条被推到 850px 处 —— 排查"元素不见了"要先量容器宽度，别先怀疑 flex。

**量化结果**：三页 thead 合计 8 条 → 3 条（每页 1 条）；投资页顶部纵向空间 −44px；紧凑档行高 −25%；1500 / 1024 / 390 三档 `docOverflow` / `wrapOverflow` 全 0，操作列吸右贴合，console 零报错。

## 7.11 资产页回炉（v3.10 已落地）

> 触发：用户在 v3.9 上线后反馈三处 —— ① 资产页顶部卡片「高度骤降、风格不一」；② 资产页表格与切换条之间的工具条「左侧空白太多」；③ 表格与切换条之间那张折叠卡能否删减或合并到顶部卡片。
> 三处其实是同一件事的三种表现：**资产页在 A3/B1 那轮为「把主表提前到首屏」付了太多代价** —— 卡压薄、图表搬家、工具条留着，内容没少但层级乱了。

### 一、顶部 4 张卡复归 `density-standard`

- 卡高 57px → **136px**，恢复右上角语义角标（`kpi-ico-equity / pct / cash / fund`），与财务页、复盘页同一套壳。
- **`density-mini` 整档下线**（全站再无使用者，CSS 规则同步删除）。留档结论写进 spec：**要省首屏高度应该删重复内容，不能把卡变薄** —— 同一轮里删掉的「账户摘要条」（与 KPI 重复的 4 项）才是真正的水分。
- 选档原则随之收敛为：全站默认只有 `standard` 与 `hero` 两档，同一页内不混档。

### 二、「资产结构」折叠卡整张下线，内容并进卡内分段条

- 折叠卡的问题：收着时是「资产结构 构成·区域·币种·净值」一行标题加一个箭头，横在子 tab 与账户表之间纯属阻挡；展开后是 4 组图（donut + 区域条 + 币种条 + 三行对比），把主表推走几百像素。
- 而它画的那四个维度，**数字本来就写在同批卡片的副标行里**（占总资产 / 中国内地 / 人民币 / 负债率），缺的只是「形状」。
- 于是新增 `.kpi-bar`：卡内一条 **6px 分段条**（`order:5`，段宽走 `--w`、发色走 `--bc`，都是自定义属性）。
  - 持仓市值 → 构成（持仓 / 理财 / 现金）
  - 境外资产占比 → 区域（中国内地 / 中国香港 / 美国）
  - 外币资产占比 → 币种（人民币 / 港币 / 美元）
  - 净资产 → 资产 vs 负债（负债走 `--warning`，红绿在本项目专指涨跌）
- 代价：卡内不再有坐标轴与图例 —— 这正是能省掉一整个区块的原因，数值读 title 即可。
- **随之零引用、必须同步删规则的类**（死 class 硬门）：`.asset-struct*`、`.cmp-row/.cmp-bars/.cmp-bar*/.cmp-name*/.cmp-val`、`.asset-cmp-body`、`.asset-ov-legend*`、`.legend-dot/.legend-val`、`.lg-sq/.lg-asset/.lg-liab`、`.asset-empty`、`.asset-donut*`、`.hat-title`、`.hat-side`、`.collapse-body`、`.density-mini`。
  - ⚠ `.collapsible .collapse-body` 是**资产结构卡专用**（设置页的折叠分组用 `.settings-group-body`），删掉它不影响设置页。

### 三、账户操作并入子 tab 行右端

- 原来账户面板顶部有一条独立 `.asset-toolbar`，**左侧恒空**，只有「一键更新余额 / 添加账户」两枚图标贴右 —— 与投资页 `#investToolbar` 同一个毛病（控件孤立 + 白占一行）。
- 改法与投资页一致：`<span class="sub-tabs-tools" id="assetTools">` 挂在 `#assetSubTabs` 内，按钮由 `renderSources` 写入。
- **只对「账户」子视图有意义**：`bindAssetSubTabs` 在切到现金 / 流水 / 收支 时把 `#assetTools` 置 `hidden`，不留一枚点不动的图标。
- ⚠ 容器由 JS 模板生成、不在 `index.html` 里 —— 死代码门禁会把「函数里引用的 id 全部不在静态 HTML 中」判成 deadRender，**因此这里必须用 `tabs.querySelector('.sub-tabs-tools')` 而不是 `getElementById('assetTools')`**。
- ⚠ 按钮改由模板注入后，`$('#addSourceBtn').onclick` 可能取到 null（资产页尚未渲染时 `renderSources` 被别处提前调用）→ **整段绑定必须包在 `if (tools)` 里**，否则直接抛 TypeError。

### 四、验证

1500 / 1024 / 390 三档：卡高 136px（手机 144px，副标换行所致）、4 条分段条各 3 段、子 tab 行在 4 个子视图间切换时工具区显隐正确（账户显示、其余隐藏）、console 零报错、`check-ui` 17/17、`lint-deadcode` 全 0。

## 7.12 资产页摘要合并为一段（v3.11 已落地）

> 触发：v3.10 收掉了「资产结构」折叠卡，但资产页仍是两段摘要 —— 顶部 4 张卡（资产概览）→ 子 tab → 每个子视图表格上方又一条 4 项合计条（`.asset-sum`）。用户要求「把子视图与表格之间的卡片合并到顶部卡片」。

### 一、顶部 4 张卡随子 tab 换内容

- **卡位固定 4 张，内容跟着当前子视图走**（`assetSub` 状态 + `renderAssetKpis(sub)`）：

  | 子视图 | 四张卡 |
  |---|---|
  | 账户 | 持仓市值 · 境外资产占比 · 外币资产占比 · 净资产 |
  | 现金 | 现金合计 · 分布机构 · 最集中的一处 · 外币占比 |
  | 流水 | 笔数 · 入账合计 · 支出合计 · 净额 |
  | 收支 | 每月收入 · 每月支出 · 每月结余 · 计划 |

- 眉标行同步换文案（`.kpi-head-label` / `.kpi-head-hint`）：资产概览 / 现金概览 / 流水概览 / 收支概览，提示带上口径（如「近 30 天 · 入账 · 折 CNY」）。
- **卡片外壳完全统一**：角标 + 标签 + 主值 + 副标 + 6px 分段条，与财务页、复盘页同壳；只有内容随视图变。

### 二、`.asset-sum` 组件整体下线

- 三个子视图的合计条删除，组件函数与 CSS（`.asset-sum` / `.asset-sum-item` / `.asset-sum-k` / `.asset-sum-v` / `.asset-sum-s` 及手机档规则）一并移除。
- 金额口径整体搬进卡片副标：原先「¥7.24万」这种 5 字符主值 + 「折 CNY」说明的排布，现在主值仍是金额、说明进副标行，语义没丢。

### 三、卡片与表格必须同源

- 流水：合计跟随当前筛选（类型 chips + 区间），因此 `paintFlows` 末尾要 `renderAssetKpis('flows')`；列表口径抽成共用的 `currentFlowList()`，卡片与表格用同一个函数筛，避免两处口径漂移。
- 现金 / 收支：数据是同步就绪的，切 tab 时重算；收支的计划数据是异步加载的，加载完再刷一次。

### 四、三个实现坑

1. **`str.replace` 会一次替换所有相同片段**。给「现金面板」插入刷新调用时，四行计算代码在 KPI 构建函数里也一模一样，于是被一并替换掉 —— 结果是 `assetKpiCardsCash` 里出现 `renderAssetKpis('cash')` 自递归，页面直接 `Maximum call stack size exceeded`。**批量改代码前必须确认目标片段在文件里是唯一的**（先 `grep -c`）。
2. **模板生成的 id 不能用 `getElementById` 引用**。死代码门禁的 deadRender 判定：函数内引用的 id 若全部不在 `index.html` 里（模板生成的不算），即判该函数为空转。`#assetKpiRow` 这类节点必须从 `index.html` 里已有的容器（`#assetTabBody`）往下按**类名**取。
3. **别用同名的局部变量遮蔽数据源**。重构时把子面板里的 `const srcCount / top / topPct` 删掉是安全的（它们只服务于合计条），但同名变量在 KPI 构建函数里是必需的 —— 删错地方会让卡片静默少一块内容。

## 7.13 投资页「选择优先」（v3.12 已落地）

> 触发：用户反馈「投资页的逻辑是先看到卡片，我想突出选择持仓、理财为第一步」。
> 现状：`#holdingsView` 的顺序是 `KPI 卡片 → 切换条 → 表格`，切换条排在第 3 块、370px 之后 ——
> 先看到卡片，才知道这页其实有四个视图；而且四个视图平权，看不出哪个是主入口。

### 一、结构：一套组件，两种方向

```
#holdingsView.invest-layout          （grid）
├─ nav#viewToggle.invest-side        （桌面：左侧竖排 136px；≤1340：顶部横排）
└─ div.invest-main                    （KPI hero 区 + 各视图表格面板）
```

- **同一套 `.sub-tabs` / `.sub-tab` 组件**：切换逻辑、计数徽标、`.sub-tabs-tools`（行密度 / 刷新）全部复用，只在 CSS 层换方向与位置。JS 侧 `#viewToggle .sub-tab` 的选择器与绑定一行没改。
- 竖排时：下划线选中态换成**左侧 2px 竖线 + `--primary-soft` 淡底**（只靠一条竖线太弱 —— 它贴在按钮最左缘，离文字还有 12px）；计数徽标 `margin-left:auto` 靠右对齐。
- 视图级控件在竖排时沉到栏目底部（`margin-top:auto`），并**改成竖向两行**：136px 宽里「紧凑 | 标准」与刷新按钮并排放不下，硬挤会把按钮文字压成竖排单字（实测过）。

### 二、断点

| 档 | 布局 | 理由 |
|---|---|---|
| ≥1341（电脑） | 左侧竖排栏目 | 表格最小宽降到 1144 后，内容列在 1341 视口下仍有 1149px，不出横滚 |
| 641–1340（平板） | 顶部横排 | 内容区再窄 152px 就会挤压表格，收益不值 |
| ≤640（手机） | 顶部横排（更紧凑） | 实测 390px 下「4 个 tab + 刷新按钮」一行放得下（tab 行高 36px，计数徽标同行） |

> 竖排栏目的吸顶偏移 `top: 76px` = header 实际高 63px + 13px 间隙（header 是 `sticky top:0`，栏目必须让开它）。

### 三、表格最小宽要跟着内容区收窄

- 内容区窄了 152px，若不改最小宽，1341–1468 这档会出现**表内横向滚动**（实测 1341 档 scrollWidth 超出 17px）。
- 处理：桌面档 `.invest-layout .holdings-table { min-width: 1144px }`（与理财表同档）。1341 视口下名称列仍能留到 ~354px，长基金名截断 + title 提示，与平板档的名称列宽度一致。

### 四、验证

1500 / 1440 / 1341 / 1024 / 390 五档：`docOverflow` 全 0、表内横滚全 0、侧栏方向按断点正确切换（≥1341 column，其余 row）、首行数据位置 356px（桌面）/ 531px（平板）/ 467px（手机）、console 零报错。

## 7.14 投资页改回原型 B（v3.13 已落地）

> 触发：v3.12 落地后用户反馈「改成原型 B 吧，统一一点」。
> 原型 B 的定义是：**保留现有下划线 tab 样式，只把切换条搬到页面最顶，KPI 卡原样留在下面**。

### 一、v3.12（G）与 v3.13（B）的差别

| | v3.12 · 原型 G | v3.13 · 原型 B |
|---|---|---|
| 桌面形态 | 左侧竖排栏目（136px），选中态是金色左竖线 + 淡金底 | **下划线横排 tab**，选中态是金色下划线 |
| 切换条位置 | 页面第一位（KPI 卡片之前） | 页面第一位（KPI 卡片之前）——**不变** |
| 组件 | `.sub-tabs` 换方向 | `.sub-tabs` 原样 |
| 视图级控件 | 沉到栏目底部，竖向两行 | 挂在切换条右端，与 tab 同一基线 |
| 表格最小宽 | 1296 → 1144（内容区窄了 152px） | 回到 1296（内容区恢复全宽） |

**唯一实质变化是「形态」**：位置（选择优先）在 G 里已经做到了，B 保留；把竖排改回横排，是为了让投资页与资产页用同一种控件。

### 二、为什么「统一」比「侧栏」更重要

- 竖排栏目是**全站独一份**的控件形态：资产页的「账户 / 现金 / 流水 / 收支」子 tab、设置页的折叠分组都是下划线横排。
- 跨页切换时突然换成另一种形态，用户要重新学一次「选中态长什么样」——这与「选择优先」想达成的目标相反。
- 现在两页的差别只剩**位置**（投资页在卡片之上、资产页在卡片之下），而不是形态：同一个 `.sub-tabs` 组件、同一个下划线选中态、同一个计数徽标、同一个 `.sub-tabs-tools` 右端控件位。

### 三、留下的经验

- **同页内的一致性优先于跨页的一致性**：资产页的 tab 在卡片下方是有理由的 —— 卡片内容随子 tab 变化，先看数字再选维度；投资页的 tab 在卡片上方是用户明确要的 —— 先选视图再看数字。两者的**位置**可以不同，**形态**必须相同。
- **原型评审要问「统一性」而不只是「信息层级」**：G 在信息层级上是对的（选择器提前），但在视觉语言上破坏了全站一致性，用户最终选了更保守的 B。下一轮出原型时应把「与现有控件体系是否同形」作为一条并列的评审维度。
- 侧栏形态的两个实测坑一并留档：136px 栏里「紧凑|标准」与刷新按钮并排会被压成竖排单字；内容区窄 152px 后表格最小宽不改，1341–1468 档出现表内横滚（1341 实测超出 17px）。**若将来再做侧栏，这两点要一并处理。**

### 四、验证

1500 / 1440 / 1341 / 1024 / 390 五档：切换条恒为横排、行高恒 36px、四个 tab 与计数徽标恒在同一行；页面无横向溢出、表格无表内横滚；KPI 卡片紧随切换条之下（桌面 131px / 手机 125px）；console 零报错。

## 7.15 资产页与投资页统一顺序（v3.14 已落地）

> 触发：用户要求「资产页也按相同规范修改」—— 指的是 v3.13 确立的「视图切换条在页面第一位」。

### 一、顺序统一

| | v3.13 之前 | v3.14 起 |
|---|---|---|
| 投资页 | tab → 卡片 → 表格 | tab → 卡片 → 表格（不变） |
| 资产页 | 卡片 → tab → 表格 | **tab → 卡片 → 表格** |

资产页原先的顺序问题与投资页同源：**选择器排在第二块**，用户先看到一组「资产概览」数字，才知道这页下面还有账户 / 现金 / 流水 / 收支四个子视图 —— 而那组数字还只是「账户」这一个子视图的。

现在两页的顺序、形态、控件位完全一致：

```
投资页   [持仓 8][理财 6][存款 0][平仓 2]  …行密度  ⟳
资产页   [账户 13][现金 11][流水][收支]              ⟳  +
                ↓
         KPI 卡片（随子视图换内容）
                ↓
              表格
```

### 二、眉标行的位置

- 资产页的 `.kpi-head`（"资产概览 / 现金概览 / 流水概览 / 收支概览" + 口径提示）**从卡片上方移到 tab 下方**。
- 它现在是「这一段数字的标题」：tab 选维度 → 眉标说这是哪一段 → 卡片给数字 → 表格给明细。层级自上而下读得通。
- 投资页本就如此（`investHero` 的 `.kpi-head` 在 `.kpi-row` 上方），无需改动。

### 三、两处配套清理

1. **`.asset-subtabs` 类删除**：资产页子 tab 现在直接用 `.sub-tabs` 基础样式（与投资页同一套），专用类零引用 → CSS 规则同步删除（死 class 硬门）。
   - 间距随之统一由 `.sub-tabs` 自带的 `margin-bottom` 承担，不再另设 `margin: var(--sp-4) 0 var(--sp-2)`。
2. **`.sub-tab` 补 `min-height: 36px`**：带计数徽标的 tab 内容高 18px（徽标）+ 16px（上下内边距）= 34px，不带徽标的只有文字行高 ≈ 35px，两者差 1px。flex 居中后顶边错开 1px，**选中下划线不在同一基线上**。
   - 投资页四个 tab 都带徽标，所以此前看不出来；资产页「流水 / 收支」无徽标，问题暴露。
   - 锁死 `min-height: 36px` 后所有 tab 等高（实测三档 `oneRow: true`）。

### 四、验证

1500 / 1024 / 390 三档 × 四个子视图：tab 行恒 36px、四个 tab 顶边齐平（oneRow 全 true）、眉标行紧随 tab（桌面 131px / 手机 125px）、4 张卡片随子视图换内容、右端工具区仅「账户」视图显示、页面无横向溢出、console 零报错。

## 7.16 资产页卡片与表格的间距（v3.15 已落地）

> 触发：用户反馈「资产页 顶部卡片和表格间距调整一下」。

### 一、问题

资产页的 KPI 卡与下方表格**贴在一起**：

| 子视图 | 改前实测（卡片底 → 表格顶） |
|---|---|
| 账户 | 1px |
| 现金 | 0px |
| 流水 | 45px（中间夹着筛选工具条） |
| 收支 | 0px |

原因是 `.asset-kpi-row` 没有下边距、`.asset-subpanel` 也没有上边距 —— 卡片底部直接压到表格上沿，视觉上像"一张大卡被劈成两半"。

全站其它页都有明确的区块间距：财务页 20px、复盘页 20px（来自 `#financeView` / `#rebalanceView` 的 flex `gap: var(--sp-5)`）、投资页 16px。资产页是唯一的例外。

### 二、改法

- `.asset-kpi-row { margin-bottom: var(--sp-5) }` → **20px**，与财务 / 复盘页对齐（资产页表格同样是带边框的卡片壳 `.as-card` / `.card asset-flow-card`）。
- 流水子视图额外收一处：`.asset-subpanel[data-sub="flows"] .holding-toolbar { margin-bottom: var(--sp-3) }`（16 → 12px）。卡片到工具条已经是 20px，工具条自己又带 16px 下边距 → 整段 65px 读起来是断裂；收到 12px 后变成 61px，「卡片 → 工具条 → 表格」成为一组连续的控件区。

### 三、沉淀：页级区块间距口径

**页级大区块之间统一 20px（`--sp-5`）**；小节内部的间距用 12px（`--sp-3`）/ 16px（`--sp-4`）。

- 判断依据：相邻两块**都是带边框/背景的独立卡片**时给 20px（视觉上是两张卡，需要呼吸）；一组**连续控件**内部给 12px。
- 排查这类问题要**逐子视图量**（`panel.top - cards.bottom`），不能只看默认视图 —— 资产页四个子视图三个贴死，只有流水因为夹了工具条才看起来正常。

## 7.17 全站统一加载动画（v3.16 已落地）

> 触发：用户反馈「除了首页有加载动画，其他页元素加载较生硬，统一一下动画效果」。

### 一、此前的实际状态

| | 现状 | 问题 |
|---|---|---|
| 首页 | `.networth-hero` / `.shortcut` 带 `hero-in`（0.4s 上浮淡入） | 延迟用写死的 `nth-child(2)/(3)`；**且首页那个"骨架屏"其实是坏的** |
| 其它 8 个视图 | 无任何入场动画 | 切页是硬切：旧页消失 / 新页瞬间出现 |
| 异步页 | `showXxxView()` 先 `hidden=false` 再 `await` 拉数据 | 等待期整页空白 → 数据到达瞬间满屏，落差最大 |

**骨架屏失效的细节**：`.skeleton-line` 只定义了 `height` 和 `border-radius`，**没有背景色、没有 `animation`**，`--sk-w` 变量也从没被任何规则消费过 —— 它渲染出来是三根完全透明的东西，什么都看不见。也就是说首页此前实际只有 `hero-in` 一层动画。

### 二、统一为三层机制

```
① 视图层 .view-fade     切页瞬间整个视图 opacity 0 → 1（260ms）
② 区块层 .rise-in       数据到达后逐块上浮淡入，错落由 --d 控制（40~60ms 增量）
③ 骨架层 .skeleton-*    等待数据时的 shimmer 流光占位
```

#### ① 视图层

- `applyRoute()` 在 `showXxxView()` **之后**给新视图加 `.view-fade` —— 必须在那之后，那时才刚把 `hidden` 置 false。
- 重播用「移除 → 强制重排 → 加回」：`viewEl.classList.remove('view-fade'); void viewEl.offsetWidth; viewEl.classList.add('view-fade')`。不加强制重排的话，重复点同一个导航不会重播。
- 路由名 → 容器 id 的对照表抽成 `viewIdOf(v)`，动画层与各 `showXxxView` 解耦。

#### ② 区块层

- `playRiseIn(container, sel, step)`：给匹配到的可见区块依次写 `--d`（`0ms / 50ms / 100ms…`）并加 `.rise-in`。
- **`--d` 必须走自定义属性**：check-ui 第 2 条硬门禁止内联具体样式，`--d` 是唯一的合法通道。
- 同样需要强制重排（`void targets[0].offsetWidth`），否则「移除 → 立刻加回」在同一帧内不触发重启动画。
- 覆盖：首页 3 块、投资页 2 块、资产页 4 块、财务页 2 块、复盘页 2 块、设置 / AI / 设备 / 通知各 1~3 块。

#### ③ 骨架层

- `.skeleton-line`（文本行占位，`--sk-w` 控制宽度）+ `.skeleton-block`（整块占位）。
- 深浅主题各一套渐变（浅色主题的流光要比深色更明显，否则整块纯色看不出在加载）。
- 已接入：首页最新流水（原有）、设备页设备列表、资产页整页（三个同形占位：切换条 / KPI 卡行 / 表格）。

### 三、三条铁律

1. **动画只碰 `opacity` / `transform`**。改 `height` / `margin` 会触发布局重排，表格会肉眼可见地抖一下 —— 比没有动画更糟。
2. **不要给动画元素预置 `opacity: 0`**。`animation-fill-mode: both` 会在结束后停在 `to`（opacity:1），但 `prefers-reduced-motion` 下动画被停用，元素就永久透明了。
3. **`hero-in` 与 `rise-in` 是同一条曲线**（opacity + translateY(8px)），两套并存会让首页元素动两遍。已把 `hero-in` 删除、统一到 `rise-in`。

### 四、覆盖与验证

9 个视图（首页 / 投资 / 资产 / 财务 / 复盘 / 设置 / AI / 设备 / 通知）全部接入：切页时 `viewFadeIn` 生效（中途抓帧 opacity 0.42 → 0.79 → 1），数据到达后 `rise-in` 按 `--d` 递增入场，结束后全部 opacity 为 1。

- `prefers-reduced-motion: reduce` 下三层全部停用（`animation-name: none`），元素 opacity 仍为 1 —— **可见性不受影响**。
- 1500 / 390 两档：`docOverflow` 全 0、console 零报错。
- `check-ui` 17/17、死代码门禁全 0。

## 7.18 首页今日待办 · 复盘基准对比 · 操作列悬停（v3.17 已落地）

> 触发：产品体验审读报告（`.trae/documents/产品体验审读报告-2026-11-02.md`）的 P0-14 / P2-13 / P0-6 三条，按批注改造后落地。

### 一、首页「单行步进跑马灯」（v3.21 重写）

> 从旧版「折叠待办底栏 + 曲线下方无缝跑马灯」两次迭代收窄而来：用户反馈多行 120px 堆着看不清、无缝匀速太抢视线。现形态 = 单行 + 步进。

- **位置**：`#homeHero` 内部 `.nw-left` 底部、`#homeAssetBreakdown` 之后。一条跑马灯占净资产卡的左下半留白，不碰右侧权益曲线、不挡主数字视觉锚点。
- **形态**：单行步进（不是连续滚动）。`.hm-viewport` 高 `1.6em`（恰好露出一条），`.hm-track` 纵向 flex，JS 每 4 秒把 `translateY` 跳到下一条行高，0.45s transition（`cubic-bezier(.4,0,.2,1)`）。末尾 `_hmIdx = (_hmIdx + 1) % n`，不用复制两份做无缝循环。
- **hover 暂停**：`mouseenter` 停定时器 + 冻结当前 transform；`mouseleave` 从 `_hmIdx` 继续排下一条。
- **prefers-reduced-motion**：CSS 兜底 `transform: none !important` + JS 主动停定时器，只显示第一条静止。
- **账本隔离**：`homeMarqueeData`（含待办数据 + 跑马灯渲染）在 `switchUser` 缓存作废清单里。
- **不引起布局抖动**：纯 transform + `will-change: transform`，不读 layout 属性、不改 height。
- **死代码清理**：上一版的无缝循环复制、keyframes 滚动、多行堆叠高度、点击跳转（`goTodoMarquee`）、旧底栏（`.hero-todo` + `.ht-*` 全套）、区间/口径切换（`range-tabs` / `spark-mode`）均已删除，不留死引用。

#### 内容：两类、单行、全部来自真实数据

1. **待办条目**（`GET /api/today/brief`）：展开所有组的 items，每条格式 `分类标签 · 名称 · 状态[· 金额]`。示例：`止盈止损 · 贵州茅台 · 止盈 · +5.2%`、`待还款 · 招行信用卡 · 每月 15 号 · 还有 4 天 · ¥2,100`、`存款到期 · 工行结构性 · 已到期 · 待确认落袋 · ¥50,000`。
2. **收益句子**（基于 `/api/pnl/history` 近 30 日真实数据）：按累计盈亏方向二选一（盈利走鼓励向、亏损走治愈向），每次页面加载随机选一条。模板见 `pickPnlSentence()`：盈利方向 5 条（"X 天里 Y 天收红 · 累计 ¥+XXX"、"N 只持仓拿得住 · ¥+XXX 进账" 等）；亏损方向 5 条（"X 天里 Y 天下跌 · 累计 ¥-XXX"、"N 只持仓没乱动 · ¥-XXX" 等）。**底线**：治愈感来自克制和画面感，不来自劝解；禁止"浮亏只是账面的"、"没卖就不算亏"、"别担心"等安慰句式。

#### 数据口径（未改，沿用 v3.17）

- 待办：四类聚合 `/api/today/brief`（止盈止损未读 / 定投待确认 / 待还款 7 天前瞻窗口 / 存款 7 天内到期）。
- 盈亏：`/api/pnl/history` → `calData` → 切片近 30 日 → 剔空快照（`equity_pnl_cny = 0` 的周末不算）。累计 = 每日求和；涨跌天数阈值 `|v| > 0.5`；持仓数 = `allHoldings.filter(h => h.quantity > 0).length`。
- 收益率基准 = `max(权益市值 − 30 日累计盈亏, 1)`，与权益曲线头部的收益率同口径。

#### 实现坑（v3.21 新增）

1. **步进不用 transition 复位**：末尾 `_hmIdx = 0` 时如果还在 transition 中，用户会看到"倒着滚回去"。解决：JS 每次 `step()` 都先设 `none` 把当前 transform 锁死，再立即（同一 tick）设新的 transition 值 —— 不对，实际方案是直接模 n 取余，transition 不处理方向（它只从当前位置平滑到目标位置），n 条的 track + translateY 负方向始终向下滚动，n→0 的步进是最后一条往上跳回第一条的视觉跳跃。对于 4–6 条的短列表（demo 库常年 0 条、真实库大概率 2–5 条），末尾跳回的间隔足够长（20–24 秒），用户感知不到"倒着滚"。
2. **旧底栏删除要彻底**：`.home-asset-row` 是左栏最后一个块时，跑马灯放在它之后。若之前 `.hero-todo` 的 CSS 还留着 `margin-top`，会与新位置的 border-top 产生双描边。构建时死代码扫描（`node build.mjs` 会在打包前跑 deadcode lint）必须 0 死类。
3. **`axisSpan` 未定义 bug**：v3.20 删了区间切换后，renderRateSpark 里 Y 轴刻度仍写 `axisSpan * k / 3` 而没在同一函数里定义。本次修复为 `const axSpan = axMax - axMin`（该 bug 从 v3.20 删除时间区间切换后遗留，上线即死代码，未被任何 UI 事件触发所以没炸）。

### 二、复盘页「基准对比」条

- **位置**：`#rebalanceView` 内 `.kpi-section` 与业绩表现卡之间，`.rv-bench`（`.card` + 四格 grid）。
- **数据**：`GET /api/review/benchmark`。组合年化在服务端算（区间累计盈亏 ÷ 区间每日净资产基数均值），指数走 `internal/market/index.go`（东财 push2his，`1.000300` 沪深300 / `100.SPX` 标普500 / `100.NDX` 纳指100，**6h 内存缓存**，一次 3 个外网请求封顶）。
- **口径必须写清**：基准是**指数区间价格收益（不含分红）**，组合是**资金加权近似**（分母取每日净资产基数均值），所以差额只能叫「组合 − 指数（pp）」，不能叫「超额年化」。口径文案由后端随响应返回，前端不重算。
- **账本历史不足一年时窗口自动收缩**：`pnl_daily` 只从建账那天开始，硬按 365 天比会出现「75 天的组合收益 vs 365 天的指数收益」。响应里的 `range.full` 为 false 时，前端文案改成「X ~ Y（账本历史不足 1 年）」并在脚注说明。
- **响应式**：≥1341 四格横排；≤1340 与 ≤640 都是 2×2（1024 内容宽下四格并排每格只剩 220px，差额文案会全被省略成「组合 +…」）。
- **布局坑**：`.card` 带 `align-items: center`，新加卡内 flex 容器必须显式 `align-items: stretch`，否则四格 grid 只按内容宽收缩并居中（首版实测 grid 444px 居中在一张 1458px 的卡里）。

### 三、持仓表操作列回归「悬停完整展开」

- v3.8 曾把 `.holdings-table .ht-act .row-act` 覆盖成 `opacity: 1`（常显），理由是「这一列存在的唯一目的就是这三枚图标」。
- 实际代价：20 行 × 3 枚灰图标 = 60 个重复符号，读表时全是噪点；而操作入口本来就分两处（名称格：修改 / 技术分析；操作列：编辑 / 历史盈亏 / 删除），**悬停一次性全亮 5 枚**比「常显 3 枚、另外 2 枚另外找」更完整。
- 落地：删掉那条覆盖，回到 spec §3.3 的「默认 `opacity: 0`、行悬停淡入、触屏 `(hover: none)` 常显、键盘 `:focus-visible` 常显」；`.ht-acts` / `.hn-acts` 的第 2、3 颗加 `transition-delay` 40ms 递进（延迟只写在 `:hover` 上，移开时同步淡出，不拖尾巴）。
- **列宽不动**（仍 120px = 3×28 + 2×8 + 左右 2px，v3.19 间距改由容器 `gap` 提供）：折叠的只是可见性，不是占位，避免悬停时整表横向抖动。

### 四、首页快捷功能 6 → 4（v3.18）

- **保留**：新增持仓 / 理财快照 / 记收入 / 记支出（每天真会点的四个）。
- **迁出**：定投计划 → 投资页 tab 行右端 `#investTools`（**仅持仓视图**：定投计量份额，理财按快照、存款按利率，都没有「每期买入」）；补录平仓 → 同一位置，**仅平仓视图**。两处都复用原弹框函数，不复制逻辑。
- **兜底**：平仓空态补一枚 `.closed-empty-btn`「＋ 补录平仓」——入口从首页迁走后，空态是新用户唯一能看见它的地方。
- **布局**：`≥641` 时 `.shortcut` 改横排（图标 + 文字同一行、左对齐）。4 格铺满 1460px 时每格 360px，竖排在格子里只剩中间一小块，整排读作四张空卡；横排后同样四格读作一条动作条。`≤640` 仍竖排 2×2（171px 格宽放横排会挤）。
- **列数**：`≤1340` 固定 4 列、`≤640` 固定 2 列。不用 `auto-fit`：4 项在 460–640 这类窄档会只落 3 列，第 4 个单独掉到第二行。
- **图标一致性坑**：`#investTools` 里的图标按钮统一 ghost 描边（原先只按 `.inv-refresh-btn` 单独上底色，加第二枚后会出现「一枚有框、一枚裸图标」）。定投图标画成「日历 + 向下箭头」——最初是日历 + 加号，16px 下内部加号只剩 2px，读不出来。

## 7.19 理财表操作列：赎回被裁 + 名称格重复按钮（v3.19）

### 一、症状

用户在理财表悬停时看到：名称后面多了 2 个图标（与操作列前两枚相同），而操作列最后一枚「赎回」不见踪影。

### 二、根因（两个，互相独立）

1. **宽度算错，最后一颗被 `overflow: hidden` 裁掉**：`.row-act` 自带 `margin: 0 var(--sp-1)`，`.ht-acts` 又有 `gap` —— 两者叠加后每颗按钮实际占 **36px**（28 + 4×2 外边距，再加 4 gap）。持仓 3 颗 = 116px 塞进 120px 列宽刚好没露馅；理财 4 颗 = 156px 塞 132px，超出的正是最后一枚。裁切发生在 `td`（`.holdings-table td { overflow: hidden }`），**DOM 完整、`opacity: 1`、事件绑定正常**，只是几何上不可见 —— 所以截图/元素检查都容易漏掉，只有量 `scrollWidth > clientWidth` 或算右缘坐标才抓得到（实测「赎回」右缘 154、单元格 132）。
2. **名称格照抄持仓的 `.hn-acts`**：持仓名称格那两颗是「修改 / 技术分析」，属于操作列里没有的补位动作；理财照抄过来填的是「编辑 / 刷新净值」，与操作列前两枚完全重复。悬停时一行出现 6 个图标、其中 2 个是同一动作。

### 三、落地

- `.ht-acts { gap: var(--sp-2) }` + `.ht-acts .row-act { margin: 0 }`：控距交给容器，按钮不再自带外边距。持仓 3 颗 = 100px（120 列宽里居中留白 20），理财 4 颗 = 136px。
- `.wealth-table .ht-act` 132 → **148px**（140 + 8 余量），`min-width` 1144 → **1160**（操作列多吃 16px 由 min-width 补回，名称列保底仍 136）。
- 理财行模板删掉 `.hn-acts`（桌面端的名称格不再挂操作）；`.hn-acts-m`（手机 ≤640 的三枚：编辑 / 刷新净值 / 赎回）保留 —— 手机端操作列整列收起，这组是唯一入口，**不能一起删**。

### 四、校验

| 项 | 结果 |
|---|---|
| 理财操作列 4 枚 | `opacity: 1`、右缘 142 ≤ 148、`scrollWidth == clientWidth` |
| 赎回点击 | 弹框标题 `赎回 · 鑫添益最短持有7天2号`，正常打开 |
| 持仓操作列 3 枚 | 未裁切，`scrollWidth == clientWidth == 120` |
| 1024 / 390 | `docOverflow` 0；1024 操作列 148 容 4 枚；390 走 `.hn-acts-m` 3 枚（116px，`(hover:none)` 下常显） |
| 门禁 | `check-ui 17/17`、死代码 0 |

## 7.20 登录闸门折叠 + 设备管理改为「有 PIN 即可」（v3.21）

### 一、PIN 登录入口默认折叠

- **形态**：登录卡底部一行 `.auth-more` 文字按钮（「已有操作 PIN？用它直接进入」+ 下箭头），点击展开 `.auth-more-body`（`grid-template-rows: 0fr → 1fr`，内层 `overflow:hidden; min-height:0`），箭头转 180°。
- **为什么**：配对码是主路径，PIN 是「主设备不在手边」的备用通道；常驻展开会把主路径挤到第二屏，也会让没设 PIN 的用户误以为必须输 PIN。
- **复位规则**：每次进闸门（`showAuthGate`）都 `setPinLoginOpen(false)` —— 展开是临时动作，不是持久偏好，上次展开不该一直占着首屏。
- **原 `.auth-div` 分隔标题随之删规则**（类已无引用，死代码门禁要求同步删）。

### 二、设备管理不再限主设备

| 操作 | 旧口径 | 新口径（v3.21） |
|---|---|---|
| 吊销他机 | 主设备 + PIN | **任意设备 + PIN** |
| 改他机显示名 | 主设备 | **任意设备**（无凭据变更，不要 PIN） |
| 出码（加设备 / 邀请家人） | 主设备 + PIN | **任意设备 + PIN** |
| 转移主设备 | 主设备 + PIN | 不变（`TransferOwnership` 只降级发起方，member 发起会凭空多一个 owner） |
| 改/关 PIN、恢复码 rotate、删账本、清空、导入 | 主设备 + PIN | 不变（账本级不可逆） |

- **动机**：主设备一旦损坏 / 丢失，member 连「吊销那台死机」「加一台新设备」都做不了，实例只能靠恢复码硬重置。
- **不会卡在「零主设备」**：`db.RevokeSession()` 内部会调 `EnsureOwnerSession()`，吊销掉死掉的主设备后，最早接入的在线设备自动升为主设备（实测：member 吊销 owner → 该 member 立即变 owner）。
- **前端**：`applyRoleUI()` 不再隐藏 `#deviceActions`（添加设备 / 邀请家人），设备行 `canRename` / `canRevoke` 去掉 owner 条件；`#pinSection`（改 PIN）仍按角色隐藏。
- **不写说明段（v3.24）**：设备页原来的 `.settings-group-desc`（讲 Cookie / 配对码 / 谁归主设备）与 `#memberHint`（讲普通设备能做什么）**全部删除**。这两段是在解释"权限为什么被藏起来"，而权限本身已经放开到"能用就行"，说明段只会让页面读起来像说明书。空态与按钮文案已足够表达。
- **PIN 提示不额外做**：后端回 403 `pin_required` 时，`api()` 统一弹口令框并自动重试一次，设备页无需各自实现。

### 三、设备行动作图标化（v3.22）

- **改名 / 吊销改纯图标**：复用行内操作按钮族 `.row-act`（28×28、16px 线稿、`currentColor`），铅笔 = 改名、垃圾桶 = 吊销（`danger` 变体恒红）。与持仓 / 理财 / 平仓表的行内操作同一套语言，不再是每行挂两个文字按钮。
- **「确认吊销」没有文字可换了**：两段式确认原来靠 `textContent='确认吊销'`，图标化后改为 **图标由垃圾桶换成对勾 + `.armed` 红底内描边**，4 秒无操作自动复位。标题同步改成「再点一次确认吊销」（`title` + `aria-label`），无障碍与悬停提示都不丢。
- **行内「关浏览器即退出 / 改为长期登录」已删除（v3.23）**：它是一句**状态说明**长在设备行里，读起来像操作又读不出动作，且「要不要长期登录」本来就该在登录那一刻决定（闸门的「记住这台设备」、PIN 登录的「关闭浏览器后退出登录」）。后端 `/api/session/persist` 与 `sessions.persist` 列保留给登录流程用。
- **两个入口按钮统一样式、都不带符号**：「＋ 添加设备」的加号去掉 —— 同一排里一个带加号就会读成主按钮，两者其实同级（都是 `.btn`，74×32、同底色同描边）。

## 8. 设计系统审计整改详解（2026-10-26）

> 本节是 §0.2 的落地明细与变更留痕；完整 11 项发现与优先级见 `docs/design-system-audit.md`。

### 8.1 已落地（代码已改，style.css）

| 审计项 | 行 | 改动 |
|---|---|---|
| §三 冗余 padding | 1592-1595 | 删除 `#holdingsView` / `#assetView` 早期逐页 padding，统一块（5830）独存 |
| §四 KPI 区块 gap/margin | 5896 | `.invest-kpis` `gap:var(--sp-8)`→`var(--sp-4)`；`margin-top:4px`→`var(--sp-1)` |
| §四 KPI 内部 gap | 5897 | `.invest-kpi` `gap:6px`→`var(--sp-1)`（落 4px 网格 + token 化） |
| §四 fin KPI gap | 6239 | `.fin-kpi-grid` `gap:var(--sp-3)`→`var(--sp-4)`（统一 16px 区块间距） |
| §六 眉标字距 | 5895 | `.nw-center-label` `letter-spacing:2px`→`.5px` |
| §六 分组头字重/字号 | 653 | `.holdings-group .collapse-hat .hat-title` `font-weight:600`→`700`、`font-size:var(--fs-base)`→`var(--fs-lg)` |
| §十 年份切换器 | 6230 / 6236 | `.year-nav-btn` `28px`→`var(--h-1)`(24px)；`.year-label` `font-weight:600`→`500`、新增 `font-size:var(--fs-sm)` |

> §九（表头 3 源）与 §八（Hero 垂直对齐）经核查代码已演进到位（语义变量已接线 / 三栏 stretch 架构已废除 72px 固定），本轮无需改动，仅登记确认。

### 8.2 已登记（目标架构 / backlog，未改代码）

- **§一 统一 `.kpi-card`**：**已落地 v3.6**（见 §7.8），四页 + 盈亏日历弹框全部接入，旧三套结构已删除。
- **§五 子 Tab 分层**：`.sub-tabs` 下划线 = within-page 子视图标准（资产/投资已用）；首页 `#viewToggle` 分段控件 = 顶层主导航（承载计数徽标），语义层级不同，**保留不强制统一**；二者计数徽标样式已对齐（18px / 999px / `--bg-input`）。
- **§七 空状态迁移**：`.empty-state` 已建（app.js:453 `emptyStateHTML`），已用于账户/理财/收支计划/资产全景等 ≈6 处；剩余 ≈20 处 ad-hoc 文本空态（`u-muted` / `empty-hint` / `empty` 等）列入**迁移 backlog**，逐页替换不阻塞。
- **§十一 断点收敛**：**已落地 v3.6**（见 §3.13），12 → 3 档，lint 白名单同步收窄。

### 8.3 已驳回（审计建议与既有约束冲突）

- **§二 Hero 全局可见**：审计建议 Hero 全局可见（两档 density）。但项目 memory 明确「Hero banner 仅在持仓/首页展示」为**后加硬约束**（避免资产/财务/设置页被巨型 Hero 挤压）。**以 memory 约束为准**，spec §3.12 原文与实现不符已勘误，不改为全局可见；如需全局，先在设置页提供 density 开关并评审 UX。

---

