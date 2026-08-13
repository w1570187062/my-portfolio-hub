# Portfolio · 个人持仓看板

自托管的个人投资持仓看板，统一管理 **A 股 / 美股 / 港股 / 基金** 持仓，自动刷新行情、计算盈亏、记录历史，并提供盈亏日历、走势、资产全景、AI 总结与小工具。桌面与移动端自适应。

## 功能概述

- 持仓增删改查、一键刷新行情、当日 / 总盈亏、持有天数
- 卡片 / 表格双视图；盈亏日历、盈亏走势（SVG）
- 资产全景（来源 / 理财 / 负债 / 现金 / 消费）、动态补仓计划
- 小工具：补仓计算器、权益 / 美元资产盈亏录入
- AI 总结（全资产 / 权益类）
- **UI 支持暗黑 / 亮色双主题切换**，护眼绿主色；遵循国内惯例「涨红跌绿」

## 技术架构

- 后端：**Go 1.22 + Gin + SQLite**（`modernc.org/sqlite`，纯 Go 无 cgo）
- 前端：原生 HTML / CSS / JS，经 `//go:embed web` 内嵌二进制，构建后无需单独部署静态文件
- 数据：SQLite 单文件（`data/portfolio.db`），启动时幂等建表与迁移
- 定时任务：每日盈亏快照、凌晨 00:00 归零结算、汇率预热

## 部署（Docker / Docker Compose）

```bash
# 构建并启动（前端内嵌，必须重建）
docker compose up -d --build

# 或强制无缓存重建
docker compose build --no-cache && docker compose up -d --force-recreate
```

- 默认监听 `9989`，数据卷 `data/portfolio.db`
- **任何前端改动都需重新 `build`**（镜像从 `web/` 内嵌打包）

本地直接运行（无需 Docker）：

```bash
go run .          # 监听 :9989，可用 PORT 环境变量覆盖
```

## 后台实现逻辑（简述）

- **当日盈亏**：`（现价 − 昨收）× 数量`；USD / HKD 按汇率折合人民币
- **每日快照**：分市场时段（A 股 15:15 / 基金 21:00 / 美股 07:00 北京时）写入 `pnl_daily`
- **零点归零**：每日 00:00（北京时）将 `prev_close` 重设为最新价，当日盈亏归零落库；用 `meta.last_day_reset` 保证幂等（每天至多一次）
- **汇率**：主源新浪实时外汇，备用 exchangerate-api，结果持久化 `fx_cache` 并带降级
- **加减仓**：`position_tx` 记录流水，BUY 摊薄平均成本、SELL 计实现盈亏

## 数据模型（SQLite）

| 表名 | 作用 | 关键字段（主键） |
|---|---|---|
| `holdings` | 持仓主表 | `id`(PK), name, symbol, category, market, currency, quantity, cost_price, current_price, prev_close, note, linked_symbol, buy_date, buy_plan, updated_at |
| `price_daily` | 每日收盘价快照 | `(date, symbol)`(PK), close |
| `pnl_daily` | 每日盈亏汇总（组合级） | `date`(PK), total_cny, total_usd, rate, detail(JSON) |
| `position_tx` | 加减仓交易流水 | `id`(PK), holding_id, tx_type, quantity, price, amount, fee, realized_pnl, note, created_at |
| `buy_plan_executed` | 补仓计划已执行标记 | `id`(PK), holding_id, tier_index, tier_label, price, amount, note, created_at |
| `fx_cache` | 汇率缓存（含昨收） | `id=1`(PK), cny, hkd, yesterday_cny, yesterday_hkd, updated |
| `meta` | 幂等标志 KV 存储 | `key`(PK), value |
| `notify_settings` | 通知渠道配置（JSON） | `id=1`(PK), cfg |
| `ai_settings` | AI 配置（JSON） | `id=1`(PK), cfg |
| `ai_summary_history` | AI 总结历史（保留最近 10 条） | `id`(PK), created_at, model, content |
| `asset_sources` | 资产来源 / 账户 | `id`(PK), name, type, note, created_at |
| `wealth_products` | 理财产品 | `id`(PK), source_id, name, code, currency, note, created_at |
| `wealth_snapshots` | 理财每日快照 | `(wealth_id, date)`(PK), amount, cashflow |
| `liabilities` | 负债 | `id`(PK), source_id, name, type, amount, rate, monthly_payment, note, created_at |
| `consumptions` | 消费台账 | `id`(PK), date, source_id, category, amount, note, created_at |
| `cash_accounts` | 现金账户 | `id`(PK), source_id, name, currency, amount, note, created_at |
| `calc_inputs` | 小工具录入（JSON） | `kind`(PK), payload, updated_at |
| `operation_guides` | 操作指南 / 买卖笔记 | `id`(PK), holding_id, title, content, tags, created_at, updated_at |
