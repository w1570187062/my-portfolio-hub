# Portfolio · 个人持仓看板

一个自托管的个人投资持仓看板：统一管理 **A 股 / 美股 / 港股 / 基金** 持仓，自动刷新行情、计算当日盈亏与总盈亏，提供盈亏日历、盈亏走势、资产全景、AI 总结与小工具计算器，并支持桌面与移动端访问。

> 技术栈：Go 1.22 + Gin + SQLite（`modernc.org/sqlite`，纯 Go 无 cgo）+ 原生前端（`//go:embed web`），Docker 多阶段构建。

---

## 一、功能特性

### 持仓看板（主页）
- 持仓增删改查、单条编辑、删除（带确认对话框）。
- 「刷新」一键拉取实时行情并即时计算「当日盈亏 / 总盈亏 / 持有天数」。
- 「历史」弹出该标的的每日盈亏与盈亏曲线（SVG 柱状+折线，hover 显示具体金额），表格按时间**从新到旧**排列。
- **卡片 / 表格双视图**：右上角分段控件一键切换，带滑动白块动画；两种视图下标的名称均随当日涨跌变色（红涨绿跌）。
- 顶部行情更新状态整合进汇率滚动条右侧的圆角 pill（前缀无边框、日期时间单独圆角边框），超 30 分钟仅变灰不提示过期。
- 多页分页（5 / 10 / 20 条）。

### 盈亏日历
- 月历大格视图，按当日盈亏正负与幅度分级配色。
- 中央居中显示**当日盈亏金额**；hover（桌面）展开日期号与情绪脸 emoji（盈亏越大表情越夸张）。
- 移动端自动取消 hover、缩小字号，仅保留居中金额，避免拥挤。

### 盈亏走势
- 纯 SVG 柱状（当日盈亏）+ 紫色折线（累计盈亏）组合图。
- 鼠标悬停任意柱子显示跟随光标的浮层：日期、当日盈亏（红涨绿跌）、累计盈亏。

### 资产全景
- 资产来源（银行 / 平台）、理财（产品+每日快照+现金流）、负债（利率/月供）、现金账户、消费台账。
- 自动汇总净资产、负债率等指标。
- 顶部工具栏（更新理财持仓 / 导出 / 下跌导出 / 饼图 / 走势）统一为**纯色圆角 icon** 风格，悬停提示**向下弹出**避免被页头遮挡。
- **补仓指南**弹框分为两部分：上方「📊 动态补仓计划」（基金净值刷新后、以及处于浮亏的股票，自动基于日 K 线计算三档补仓位），下方「📝 手动添加补仓计划」（操作记录 + 新增表单）。
- 「更新理财持仓」弹框中**每条理财用圆角外边框卡片**区分，便于逐条录入当日持仓金额与净存入。

### AI 总结
- 「🤖 一键 AI 总结」（全资产汇总）与「✨ 权益类总结」（仅股票/基金），均带确认对话框，结果可保存最近 10 条历史。

### 小工具
- 补仓计算器（按金额/数量补仓，摊薄成本）。
- 权益类盈亏、美元资产盈亏录入（带实时汇率自动填充），持久化保存。

### 通用 UI
- 暗黑 / 亮色双主题，护眼绿主色。
- 颜色遵循国内惯例：**涨 = 红、跌 = 绿**（与欧美相反）。
- 删除、清空等危险操作统一应用红底 `danger` 样式以突出警示；其余按钮为统一「幽灵样式」。
- 卡片 / 表格视图切换为带滑动白块的分段控件动画；资产全景工具栏悬停提示向下弹出。
- 小工具 / 通知渠道卡片在移动端为全屏宽度并自适应；Webhook 地址、加签密钥等敏感字段默认隐藏，可点眼睛图标切换显示。

---

## 二、技术架构

```
portfolio
├─ main.go              // 入口：DB 初始化、FX 预热、定时任务、embed 前端、路由
├─ internal/
│  ├─ api/              // HTTP 层（Gin 路由、快照/归零调度、AI、资产、分析）
│  ├─ db/               // SQLite 访问、数据模型、迁移、归零核心
│  ├─ auth/             // 鉴权（dashboard 基础认证）
│  └─ market/           // 行情/汇率抓取、技术指标、K 线、概率分析
└─ web/                 // 前端（HTML/CSS/JS + favicon），经 //go:embed 内嵌
```

- **前端内嵌**：`main.go` 用 `//go:embed web` 把 `web/` 整体打包进二进制，构建后无需单独部署静态文件。
  - 注意：参与构建的是 `web/` 下的 `app.js`/`index.html`/`style.css`；仓库根目录另有两个 **Jul 21 旧版** `app.js`/`index.html` 是改造前的遗留、不参与构建（已被 `.gitignore` 排除）。
- **数据库**：SQLite 单文件（`data/portfolio.db`），由 `internal/db/db.go` 在启动时建表与幂等迁移。
- **部署**：Docker 多阶段构建（Go 1.22 Alpine → 轻量运行镜像），`docker-compose.yml` 监听 `9989`，`DATA_DIR` 默认 `data/portfolio.db`。

---

## 三、后台实现逻辑（核心）

> 交叉备忘（长期笔记摘录）：汇率主源已改新浪实时外汇；加减仓功能已加；0 点归零功能源码已存在。以下为基于源码的实现说明。

### 1. 当日盈亏的口径
每个持仓的「当日盈亏」以 **（现价 − 昨收）× 数量** 计算：

```
day_pnl = (current_price − prev_close) × quantity
```

- `prev_close` 为前一交易日收盘价。美股因时区差异需手动填昨收（其余市场自动取行情）；若缺失则当日盈亏不计。
- USD / HKD 持仓按汇率折合 CNY 后再汇总（见 §4 汇率）。

### 2. 每日盈亏快照（白天定时落库）
- 启动兜底 `api.EnsureSnapshot()` + 定时 `api.ScheduleDailySnapshot()`。
- 受**北京时时段闸门**约束，分市场写入 `pnl_daily`（每日一条汇总）：
  - A 股：15:15（收盘后）
  - 基金：21:00（净值更新后）
  - 美股：07:00（北京时间早晨，对应美东前一日收盘）
- `pnl_daily` 字段：`date`（主键）、`total_cny`、`total_usd`、`rate`（当日汇率）、`detail`（按类别/币种/标的拆解的 JSON）。

### 3. 凌晨 00:00 归零结算（重点）
需求：**A 股 / 美股 / 基金的「当日盈亏」在凌晨 0 点必须归零、不得计入下一交易日，但要落库。**

`main.go` 接线：

```go
api.EnsureMidnightReset()      // 启动兜底：若今天还没归零则立即跑一次
go api.ScheduleMidnightReset() // 每日 00:00（北京时）触发
```

`runMidnightReset()` 做两件事：

1. **落库兜底**：取最近的中国交易日 `settleDate`（`lastTradingDayBefore` 向前跳过周末/节假日）。若该日 `pnl_daily` 缺失（白天快照漏跑），调用 `finalizePnlFromPrices(settleDate)`，基于 `price_daily` 历史收盘价回填当日盈亏：
   ```
   dp = (close_T − close_{T-1}) × quantity   // 逐标的
   ```
   该回填**不受时段闸门约束**，可在凌晨安全执行。
2. **归零**：调用 `db.RebasePrevCloseAll()`，把每个持仓的 `prev_close` 重设为最新价：
   ```sql
   UPDATE holdings SET prev_close = current_price
   ```
   重置后 live「当日盈亏」= (现价 − prev_close) × 数量 从 **0** 起算，休市/开盘前保持 0，下一交易日开盘刷新行情后重新开始累计，**绝不带入下一交易日**。

**幂等保证**：用 `meta` 表的 `last_day_reset` 标志记录最近一次结算日期。`EnsureMidnightReset` 启动时检查「今天是否已跑」，跑过则跳过；`ScheduleMidnightReset` 每次执行后写入当天日期。因此进程跨午夜宕机重启也不会重复结算或漏结算。

> 关键文件：`internal/api/handler.go`（`ScheduleMidnightReset` / `EnsureMidnightReset` / `runMidnightReset` / `finalizePnlFromPrices`）、`internal/db/db.go`（`RebasePrevCloseAll`）、`main.go`（接线）。

### 4. 汇率源（USD→CNY / USD→HKD）
美股、港股持仓需折合人民币，汇率获取策略如下：

- **主源**：新浪实时外汇 `hq.sinajs.cn/list=fx_susdcny,fx_susdhkd`（GBK 编码，需带 `Referer` 头）。选它替代旧的 exchangerate-api.com 免费档，后者约每天仅刷新一次、会让人民币走势看起来「冻住」。
- **备源**：`exchangerate-api.com/v4/latest/USD`，仅在主源不可达时回退。
- **缓存与降级**：
  - `market.StartFXUpdater()` 启动即预热并后台定时刷新。
  - 汇率持久化到 `fx_cache` 表（含昨收 `yesterday_cny/yesterday_hkd`），处理器**读缓存、不阻塞上游**。
  - 上游不可用时回退到「最近一次成功获取的汇率」，并在响应中标记 `rate_degraded=true`，前端据此提示「已回退至最近汇率」。
- 折算：`rateChoice()` 对 USD 用 `cnyRate`、HKD 用 `cnyRate/hkdRate` 把市值/盈亏统一折合为 CNY。

### 5. 加减仓与成本基数调整
`db.AdjustHolding(id, txType, quantity, price, fee, note)` 处理单笔加/减仓并更新持仓成本：

- **加仓 BUY**：摊薄平均成本
  ```
  new_qty   = qty + quantity
  new_cost  = (qty·cost + quantity·price + fee) / new_qty
  ```
- **减仓 SELL**：
  ```
  realized  = (price − cost)·quantity − fee   // 实现盈亏
  new_qty   = qty − quantity                  // 剩余成本基数不变
  // 份额归 0 时，cost 基数也归 0
  ```
- 每笔交易写入 `position_tx` 表，可累计已实现盈亏 `SumRealizedPnl(holdingID)`。

### 6. 数据模型（SQLite）
| 表 | 作用 |
|---|---|
| `holdings` | 持仓主表（含 `prev_close`、`linked_symbol` 基金关联股票、`buy_date` 持有天数、`note`） |
| `price_daily` | 每日收盘价快照（主键 `date+symbol`），供归零回填与走势图 |
| `pnl_daily` | 每日盈亏汇总（主键 `date`），含 CNY/USD 总额与拆解明细 |
| `position_tx` | 加减仓交易流水 |
| `fx_cache` | 汇率缓存（含昨收） |
| `meta` | 幂等标志（如 `last_day_reset`） |
| `asset_sources` / `wealth_products` / `wealth_snapshots` / `liabilities` / `consumptions` / `cash_accounts` | 资产全景模块 |
| `ai_settings` / `ai_summary_history` | AI 配置与总结历史（保留最近 10 条） |
| `calc_inputs` | 小工具计算器录入（权益/美元，全局单份） |
| `operation_guides` | 操作指南 / 买卖笔记 |

**兼容性迁移**：启动时对旧库幂等执行 `ALTER TABLE ADD COLUMN`（如 `prev_close`/`note`/`linked_symbol`/`buy_date`），以及一次性 `migrateMarkets()` 将旧市场码（`A_SH`/`US`/`FUND_ETF`…）重映射到两级方案（`stock → {A股,美股,港股}`、`fund → {QDII,债券,股票}`）。

---

## 四、本地开发 / 部署

### 前置
- Go 1.22+
- （可选）Docker / Docker Compose

### 直接运行
```bash
export DATA_DIR=data/portfolio.db   # 可选，默认 data/portfolio.db
go run .                            # 监听 :9989（可用 PORT 覆盖）
```

### Docker 部署
```bash
docker compose up -d --build        # 多阶段构建，前端经 //go:embed 内嵌，必须 rebuild
```
- 线上部署目录：`/mnt/nvme0n1-4/portfolio`，监听 `9989`。
- 因前端被 embed 进二进制，**任何前端改动都必须重新 `build`**（建议 `docker compose build --no-cache` 后 `--force-recreate`）。

### 目录约定
- 实际前端入口：`web/`（`//go:embed web`）。
- 运行时数据：`data/`（SQLite + 上传等），已在 `.gitignore` 中排除，不入库。
