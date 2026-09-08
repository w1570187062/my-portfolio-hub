# Portfolio · 观澜 / My Folio Hub

> **中文**：自托管的多用户个人投资持仓看板，统一管理 **A 股 / 美股 / 港股 / 基金** 持仓。自动刷新行情、计算盈亏、记录历史，并提供盈亏日历、走势、资产全景、AI 总结与技术分析。桌面与移动端自适应。
>
> **English**: A self-hosted, multi-user personal investment dashboard for tracking **A-share / US / HK stocks and funds**. Auto-refreshes quotes, computes P/L, records history, and offers a P/L calendar, trend charts, asset panorama, AI summaries, and technical analysis. Responsive on desktop and mobile.

## 功能一览

- 持仓增删改查、一键刷新行情、当日 / 总盈亏、持有天数
- 卡片 / 表格双视图；盈亏日历、盈亏走势（SVG）
- 资产全景（来源 / 理财 / 负债 / 现金 / 消费）、动态补仓计划
- 技术分析：K 线 + MA / MACD / RSI / KDJ / BOLL + 逐日信号回测胜率
- 小工具：补仓计算器、权益 / 美元资产盈亏录入
- AI 总结（全资产 / 权益类）
- 通知渠道：钉钉（加签）、邮件（隐式 TLS / STARTTLS），按策略推送
- 多用户隔离（`X-User-Id` 请求头），支持数据隔离、清空、删除
- **暗黑 / 亮色双主题 + 主题色自定义**：内置 3 套主题色预设（土豪金 / 豆沙绿 / 经典蓝），用户面板一键切换，也可用取色器自定义任意主题色（本机 `localStorage` 记忆）；**涨红跌绿**（国内惯例）

## 界面预览

| 主页（亮色） | 资产全景 |
| :---: | :---: |
| ![](docs/screenshots/home-light.png) | ![](docs/screenshots/asset.png) |

| 技术分析（QQQ） |
| :---: |
| ![](docs/screenshots/analysis.png) |

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Go 1.25 + Gin + SQLite（`modernc.org/sqlite`，**纯 Go 无 CGO**） |
| 前端 | 原生 HTML / CSS / JS，通过 `//go:embed web` 内嵌二进制，构建后无需单独部署静态文件 |
| 行情 | 腾讯 `qt.gtimg.cn`、新浪外汇、公开基金 API |
| 部署 | Docker / Docker Compose（默认端口 `9989`） |

## 快速开始

### Docker（推荐）

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

| 表 | 作用 |
|---|---|
| `holdings` | 持仓主表（按 `user_id` 隔离） |
| `price_daily` / `pnl_daily` | 每日收盘价 / 每日盈亏汇总（按用户） |
| `position_tx` / `buy_plan_executed` | 加减仓流水 / 补仓档位已执行标记 |
| `asset_sources` / `wealth_products` / `wealth_snapshots` | 资产来源 / 理财 / 理财每日快照 |
| `liabilities` / `consumptions` / `cash_accounts` | 负债 / 消费 / 现金 |
| `operation_guides` | 持仓买卖笔记（操作指南） |
| `users` | 多用户（按 `X-User-Id` 隔离数据） |
| `analysis_cache` | 技术分析缓存 |
| `fx_cache` / `meta` / `notify_settings` / `ai_settings` / `ai_summary_history` | 汇率缓存 / KV / 通知 / AI 配置 / 总结历史 |

> `buy_plan` 字段（`holdings` 上）保存净值刷新时计算的动态补仓档位 JSON，操作指南弹框直接展示，不写入 `note`。

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

## 涨红跌绿

遵循国内惯例：**上涨红、下跌绿**。`--up:#f87171`、`--down:#4ade80`（暗色）；亮色主题同步切换为更深的 `#dc2626` / `#16a34a` 以保证对比度。

## 许可

自托管个人项目。请遵守所在司法辖区的金融数据法规。