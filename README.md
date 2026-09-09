# Portfolio · 观澜 / My Folio Hub

> **中文**：自托管的多用户个人投资持仓看板，统一管理 **A 股 / 美股 / 港股 / 基金** 持仓与**理财 / 现金 / 负债 / 消费**全景资产。自动刷新行情、计算盈亏、记录历史，提供盈亏日历、技术分析、动态调仓计划与 AI 总结。桌面与移动端自适应。
>
> **English**: A self-hosted, multi-user personal investment dashboard for tracking **A-share / US / HK stocks and funds**, plus wealth products, cash, liabilities and consumption. Auto-refreshes quotes, computes P/L, records history, and offers a P/L calendar, technical analysis, dynamic rebuy plans, and AI summaries. Responsive on desktop and mobile.

## 🌐 在线 Demo / Live Demo

**<https://www.mrchenyifei.icu:19999>** · 预置了一套模拟数据（8 只持仓 / 多币种账户 / 理财 / 负债 / 近 30 日盈亏历史），行情定时自动刷新。
A pre-seeded demo instance with mock data is live at the link above; quotes refresh automatically.

## ✨ 功能一览

**持仓与行情**
- 持仓增删改查，按资产来源（券商 / 平台）分组；股票（A 股 / 美股 / 港股）与基金（场内 / 场外 / QDII）统一管理
- 一键刷新全部行情（腾讯行情 / 新浪外汇 / 公开基金 API），当日 / 总盈亏、盈亏率、持有天数、近 20 日迷你走势
- 表格 / 卡片双视图，分组可折叠，展开行悬停切换 当日 / 总盈亏
- 加减仓流水、分红记录、操作指南（买卖笔记）

**盈亏分析**
- 盈亏日历：按日着色的月度热力、本月总盈亏、年 / 月快速跳转、单日持仓级明细（前一天 / 后一天切换）
- 盈亏走势：累计盈亏曲线 + 当日盈亏柱状图，hover 查看 tooltip

**技术分析**
- K 线 + MA / MACD / RSI / KDJ / BOLL 全指标
- 自动信号评级（看多 / 看空）+ 逐日信号回测胜率与期望收益，结果缓存

**资产全景**
- 来源 / 理财 / 负债 / 现金 / 消费五类资产，环形占比 + 明细钻取
- 理财：批量「更新理财持仓」、申购 / 赎回流水、上次快照对比
- 现金账户：多币种（RMB / HKD / USD）、每来源每币种默认子账户（★）、账户间转账、现金流水
- 负债：利率支持 0，编辑 / 历史完整可溯

**调仓计划**
- 动态补仓档位：净值刷新时自动为持仓基金 / 亏损股票计算（含已执行标记），首页按钮显示触发数量徽标
- 手动添加操作记录，人工计划与自动档位同屏管理

**AI 总结**
- 一键 AI 总结（全资产 / 权益类），自定义提示词模板，支持多个模型配置（OpenAI 兼容接口）
- 每日收盘后自动生成（复用 21:00 快照），可随净值推送发送
- 历史记录一键回看；结果与历史均按 **Markdown 渲染（支持表格）**，XSS 安全转义

**其他**
- 通知渠道：钉钉（加签）、邮件（隐式 TLS / STARTTLS），按策略推送
- 小工具：权益盈亏录入、美元盈亏、汇率计算、贷款计算器
- 多用户隔离（`X-User-Id`），支持数据清空、删除（需输入确认短语）
- 暗黑 / 亮色双主题 + 主题色自定义：内置 3 套预设（土豪金 / 豆沙绿 / 经典蓝），取色器自定义任意主题色（本机 `localStorage` 记忆）

## 界面预览

| 主页（亮色） | 资产全景 |
| :---: | :---: |
| ![](docs/screenshots/home-light.png) | ![](docs/screenshots/asset.png) |

| 盈亏日历 | 技术分析（QQQ） |
| :---: | :---: |
| ![](docs/screenshots/calendar-pnl.png) | ![](docs/screenshots/analysis.png) |

| 更新理财持仓 | 动态调仓计划 |
| :---: | :---: |
| ![](docs/screenshots/wealth-update.png) | ![](docs/screenshots/buy-plan.png) |

| AI 中枢 · AI 总结 |
| :---: |
| ![](docs/screenshots/ai-modal.png) |

## 功能详解

### 持仓管理

主页按资产来源分组展示全部持仓，每组卡片显示市值、当日盈亏与累计盈亏。表格视图列：名称 / 代码 / 份额 / 成本价 / 现价 / 市值 / 当日 / 当日% / 总盈亏 / 盈亏% / 持仓天数 / 备注 / 近 20 日走势 / 操作。每只持仓支持 编辑、历史盈亏（每日表格 + 曲线）、分析、修改（加减仓 / 分红）与删除。

### 盈亏日历与走势

「盈亏分析」弹框内含 **盈亏日历 / 盈亏走势** 双 Tab。日历按日着色显示每日总盈亏（红涨绿跌），悬停有数据的日期会以表情符号（😍 大涨 → 😱 大跌）代替金额展示当日情绪；点击月份标题可年 / 月快速跳转；点击有数据的日期弹出当日持仓级盈亏明细，可用 ‹ › 按钮在前 / 后一个有数据日期间连续浏览。走势 Tab 提供累计盈亏曲线与当日盈亏柱状图，hover 显示具体数值。

### 技术分析

每只持仓点「分析」弹出技术分析：K 线叠加 MA / BOLL，副图 MACD / RSI / KDJ，并给出自动信号评级（看多 / 看空）、逐日信号回测的胜率与期望收益，辅助判断趋势与反弹。

### 资产全景 · 理财与现金

资产全景覆盖来源 / 理财 / 负债 / 现金 / 消费五类，环形图显示占比，点击可钻取明细。

「更新理财持仓」弹框一次性录入所有理财产品的当日持仓金额与当日净存入（转入为正、取出为负），并可指定联动资金账户（申购扣款 / 赎回回款自动记账），保存后自动生成快照与收益统计。

现金账户支持多币种（RMB / HKD / USD），每个来源的每个币种各有一个 ★ 默认子账户；支持账户间转账（同币种）与完整的现金流水查询。

### 动态调仓计划（补仓计划）

「调仓计划」弹框分两部分：

- **📊 动态调仓计划**：净值刷新时（定时 21:00 / 手动刷新）自动为持仓基金与亏损股票计算补仓档位，保存在 `holdings.buy_plan`（不写入备注列）。档位触发后首页按钮显示红底数量徽标，执行后可标记「已执行」。
- **📝 手动添加调仓计划**：手动记录自己的买卖计划与操作笔记。

### AI 总结

「AI 中枢」三个 Tab：

- **AI 总结**：选择总结类型（一键全资产 / 权益类）、提示词模板与模型后生成；结果自动保存到历史
- **AI 设置**：多个模型配置（OpenAI 兼容，如 DeepSeek），API Key、地址、提示词模板均可自定义；可开启每日收盘后自动生成并随净值推送发送
- **AI 历史**：最近总结列表，点击回看全文

总结结果与历史预览均按 **Markdown 渲染**（标题 / 列表 / **表格** / 代码块 / 引用 / 链接），渲染前做 HTML 转义，模型输出不会被注入执行。

### 通知推送

支持钉钉（加签机器人）与邮件（隐式 TLS / STARTTLS），推送内容为当日总盈亏 + 逐只持仓明细。推送策略见下方[通知策略](#通知策略)。

### 小工具

「资产工具」内含：权益盈亏录入、美元盈亏录入、汇率计算、贷款计算器。

### 多用户与数据隔离

- 前端以浏览器 `localStorage` 记住当前用户，请求携带 `X-User-Id`，后端按用户过滤全部数据
- 用户数上限 5；每类资产（持仓 / 来源 / 理财 / 负债 / 消费 / 现金）每用户上限 200 条
- 危险操作（清空 / 删除）需输入确认短语解锁

### 主题与外观

暗黑 / 亮色双主题一键切换；主题色内置土豪金 / 豆沙绿 / 经典蓝三套预设，也可用取色器自定义任意颜色（本机 `localStorage` 记忆）。所有图标使用 `currentColor`，跟随主题色变化。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Go 1.25 + Gin + SQLite（`modernc.org/sqlite`，**纯 Go 无 CGO**） |
| 前端 | 原生 HTML / CSS / JS，通过 `//go:embed web` 内嵌二进制，构建后无需单独部署静态文件 |
| 行情 | 腾讯 `qt.gtimg.cn`、新浪外汇、公开基金 API |
| 部署 | Docker / Docker Compose（默认端口 `9989`） |

## 快速开始

### 云端镜像（推荐，无需克隆源码）

镜像由 GitHub Actions 自动构建（`linux/amd64` + `linux/arm64`），推送到 GHCR，每个 main 提交更新 `latest`、每个 `v*` 标签发布版本号：

```bash
docker run -d --name portfolio -p 9989:9989 \
  -v portfolio-data:/data \
  -e TZ=Asia/Shanghai \
  ghcr.io/w1570187062/my-portfolio-hub:latest

# 或用 docker compose（compose.yml 里 image 填 ghcr.io/w1570187062/my-portfolio-hub:latest）
docker compose up -d
```

访问 <http://localhost:9989> 即可；升级只需 `docker pull` 后重建容器。

### 从源码构建

```bash
docker compose up -d --build
# 或强制无缓存重建（前端改动必须）
docker compose build --no-cache && docker compose up -d --force-recreate
```

数据持久化在 `data/portfolio.db`，挂载为 volume。

### 本地运行

```bash
go mod tidy
go build -o portfolio .      # 产物 ./portfolio
./portfolio                  # 监听 :9989，可用 PORT 环境变量覆盖
# 开发期也可直接：go run .
```

数据落在 `./data/portfolio.db`（compose 已挂 volume）。停止：`docker compose down`（保留数据）；`docker compose down -v` 连数据卷一并删除，慎用。

### 前端缓存与版本号

前端 `index.html` 以 `app.js?v=VERSION` / `style.css?v=VERSION` 引用资源。**改动前端后必须更新 `VERSION` 并重建**，否则浏览器仍用旧缓存：

```bash
./update-version.sh          # 写入 VERSION = git短哈希|时间戳（无 git 时退化为纯时间戳）
```

### 部署验证清单

部署后务必核验，不要只看构建成功：

1. **HTTP 可达**：`curl -s -m 10 "http://localhost:9989/" -o /dev/null -w "HTTP %{http_code}\n"` → 期望 `200`。
2. **版本号生效**：`curl -s "http://localhost:9989/" | grep -o "v=新VERSION值"` 应命中。
3. **接口自检**：`curl -s "http://localhost:9989/api/version"` 返回 JSON 含版本。
4. **前端语法把关**（无需构建）：`node --check web/app.js`。
5. **进程/容器状态**：`docker ps --filter name=portfolio` 为 `Up`，或本机 `./portfolio` 进程在跑。

### 常见坑

- **前端改了不生效** → 忘了 `./update-version.sh` 或忘了重建镜像（必须 `build --no-cache`，确保最新前端进镜像）。
- **docker build 卡在模块下载** → Dockerfile 用 `GOPROXY=https://goproxy.cn`；若所在网络无法访问该代理，需在能联网的环境构建。

## 目录结构

```
portfolio/
├── main.go                # 入口：embed web、初始化 DB / FX / 定时任务
├── internal/
│   ├── api/               # Gin 路由 + HTTP 处理（handler / analysis / asset / ai / notify / import）
│   ├── db/                # SQLite 访问、表结构、迁移
│   └── market/            # 行情抓取、技术指标、概率评估、补仓计划
├── web/                   # 前端（//go:embed 打包）
│   ├── index.html / app.js / style.css / favicon.svg
├── Dockerfile / docker-compose.yml
├── update-version.sh      # 写 VERSION = git short-hash|时间戳（破除浏览器缓存）
└── docs/                  # 文档目录
```

## 数据模型（核心表）

共 25 张表。多用户隔离方式：业务主表（`holdings`、资产全景各表、AI、小工具、设置）均带 `user_id`；`position_tx` / `buy_plan_executed` / `analysis_cache` / `wealth_snapshots` 通过关联 ID 间接隔离；`notify_settings`（单行 `id=1`）、`fx_cache`、`meta` 为全局共享。

### 持仓与行情

| 表 | 作用 |
|---|---|
| `holdings` | 持仓主表。`symbol/name/category/market/currency`、`quantity/cost_price/current_price/prev_close`、`buy_date`（持有天数）、`source_id`（资产来源）、`buy_plan`（动态补仓档位 JSON）、`closed/last_quantity/last_cost_price`（清仓后快照，供历史盈亏重算）、`analysis_signal/analysis_up_pct/analysis_at`（信号缓存）、`transaction_cost`、`asset_type` |
| `price_daily` | 每日收盘价，主键 `(date, symbol, user_id)` |
| `pnl_daily` | 每日盈亏汇总，主键 `(date, user_id)`；`total_cny/total_usd/rate` + `detail` JSON（个股 / 理财明细） |
| `realized_pnl_daily` | 减仓落库的**已实现**盈亏（按用户 + 日期 + 持仓），与浮盈分开统计 |
| `position_tx` | 加减仓流水：`tx_type` / `quantity` / `price` / `amount` / `fee` / `realized_pnl` / `note` |
| `buy_plan_executed` | 补仓档位「已执行」标记（含 `action`） |
| `analysis_cache` | 技术指标与信号回测结果缓存（按 `symbol`，带 `idx_analysis_cache_symbol`） |

### 资产全景

| 表 | 作用 |
|---|---|
| `asset_sources` | 资产来源 / 平台：`type`（bank / broker / software）、`region`、`currencies`（逗号分隔多币种） |
| `wealth_products` | 理财产品：`currency`、`cum_pnl`（累计收益） |
| `wealth_snapshots` | 理财每日快照，主键 `(wealth_id, date)`；`amount` 持仓金额 + `cashflow` 当日净存入 |
| `wealth_snapshot_audit` | 理财快照改动审计：记录改前 / 改后值，支持一键撤销误改误删 |
| `liabilities` | 负债：金额 / 年利率（`rate` 可为 0）/ 月供 |
| `liability_flows` | 负债流水：`loan` 增加贷款 / `repay` 还款，逐笔记余额变动 |
| `cash_accounts` | 现金账户：多币种 `currency`、`is_default`（每来源每币种一个 ★ 默认子账户） |
| `cash_flow` | 现金流水：加减仓付款 / 回款、转账（`transfer_out/in`）、手工调整，含 `ref_*` 关联与余额快照 |
| `consumptions` | 消费记录：日期 / 来源 / 分类 / 金额 |

### 设置与其他

| 表 | 作用 |
|---|---|
| `operation_guides` | 持仓操作指南（买卖笔记）：`title/content/tags/side`（buy / sell） |
| `users` | 多用户，按 `X-User-Id` 隔离数据；上限 5 个 |
| `notify_settings` | 通知渠道（钉钉加签 / 邮件 TLS）与推送策略 |
| `ai_settings` | AI 模型与提示词配置，主键含 `user_id` |
| `ai_summary_history` | AI 总结历史，正文按 Markdown 渲染 |
| `calc_inputs` | 小工具输入持久化，主键 `(kind, user_id)`，`payload` 为 JSON |
| `portfolio_settings` | 应用设置 KV，主键 `(kind, user_id)`；现有 `risk_profiles`（风险画像）、`asset_type_labels`（资产类型标签） |
| `fx_cache` / `meta` | 汇率缓存（含昨日值，算「汇率日变动」）/ 通用 KV |

## 定时任务

| 时间（北京时间） | 任务 |
|---|---|
| **07:00** | 美股收盘后（T+1）定时快照 |
| **15:15** | A 股收盘后定时快照 |
| **21:00** | 基金净值公布后定时快照 |
| **00:00** | 上一交易日盈亏落库、归零 `prev_close`，使新一天当日盈亏从 0 起算 |
| **21:30** | 若开启 AI「自动总结」，生成收盘总结并（可选）推送通知 |

均跳过周末与中国法定节假日（`cnHolidays`）。

## 通知策略

| 策略 | 触发 |
|---|---|
| 每次更新（默认） | 任何手动 / 自动刷新都推送 |
| 仅收盘后 | 仅定时快照推送 |
| 仅补仓信号 | 仅在有补仓档位触发时推送 |

## 许可

自托管个人项目。请遵守所在司法辖区的金融数据法规。
