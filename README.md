# 持仓侠 / MoneyComes

![GitHub stars](https://img.shields.io/github/stars/w1570187062/my-portfolio-hub?style=flat\&logo=github\&color=yellow) ![GitHub last commit](https://img.shields.io/github/last-commit/w1570187062/my-portfolio-hub?style=flat\&logo=github\&color=2ea44f) ![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat) ![MCP ready](https://img.shields.io/badge/MCP-ready-5A0FC8?style=flat)

> 「牛来：妈妈，我的账户又绿了，牛还来吗？」
> 「妈妈：牛会回来的。」
>
> 在牛回来之前，先把家底交给 **持仓侠（MoneyComes）**：股票、基金、理财、现金、负债、收支一个账本全收；盈亏自动算、历史天天记；房贷车贷到点自动提醒你别逾期。牛来牛去，心里有数。

> 自托管的多用户个人投资持仓看板，统一管理 **A 股 / 美股 / 港股 / 基金** 持仓（含理财）/ 现金 / 负债 / 流水 / 收支等。自动刷新行情（不含理财）、计算盈亏、记录历史，提供盈亏日历、技术分析/**基金关联股票代码**与 AI 助手。桌面与移动端自适应。

## 📖 目录

- [🌐 在线 Demo](#-在线-demo)
- [✨ 功能一览](#-功能一览)
- [界面预览](#界面预览)
- [MCP 服务（连接 hermes 等 AI 客户端）](#-mcp-服务连接-hermes-等-ai-客户端)
- [快速开始](#快速开始)
- [贡献与支持](#贡献与支持)
- [许可](#许可)

## 🌐 在线 Demo

**<https://www.mrchenyifei.icu:19999>** · 预置了一套模拟数据（8 只持仓 / 多币种账户 / 理财 / 负债 / 近 30 日盈亏历史），行情定时自动刷新。

## ✨ 功能一览

**持仓与行情**

- 多市场持仓（A 股 / 美股 / 港股 / 场内场外基金）按来源分组统一管理；
- 理财支持批量更新持仓、申赎流水与快照对比（顶部「更新理财持仓」刷新快照）。
- 行情由每日定时快照自动刷新；首页展示当日 / 总盈亏、盈亏率、持有天数与近 20 日走势。

**盈亏分析**

- 盈亏日历按日热力着色，支持年 / 月跳转与单日持仓级明细。

**技术分析**

- 每只持仓提供 K 线 + MA / MACD / RSI / KDJ / BOLL 全指标。
- 自动信号评级（看多 / 看空）与逐日回测胜率、期望收益，结果按日缓存。
- 场外基金 / QDII 可关联场内 ETF 代码，直接复用该 ETF 的 K 线与信号。

**资产**

- 现金账户支持多币种、每来源每币种默认子账户与账户间转账。
- 收支计划支持一次性 / 循环模式，逐月还款构成可视化。

**🛠 工具箱**

- 汇率计算：CNY / HKD / USD 实时汇率互换算。
- 贷款计算：等额本息 / 等额本金，逐月还款与本金利息构成可视化。

**MCP 服务**

- 内建零依赖 MCP 服务端（stdio / HTTP(SSE)），AI 客户端可查询账本并按名称/代码定位实体记录流水。
- 提供 `record_transaction` 写入与 `list_amount_modifiable` / `list_accounts` / `list_cash_accounts` / `list_holdings` / `list_wealth` 查询工具。
- MCP 写入的流水在表格中打高亮 **MCP** 标签。

**AI 助手**

- 一键生成全资产 / 权益类总结，支持自定义提示词与多模型配置。
- 可每日收盘后自动生成，并随净值推送发送。
- 结果按 Markdown 渲染（支持表格），渲染前做 XSS 转义。

**其他**

- 通知支持钉钉（加签）与邮件（TLS），可按策略推送当日盈亏明细。
- 多用户隔离（`X-User-Id`，上限 5 人、每类资产每用户 200 条），清空 / 删除需输入确认短语。
- 暗黑 / 亮色双主题与可自定义主题色。

## 界面预览

|                                                预览图                                               |
| :----------------------------------------------------------------------------------------------: |
|       **主页（亮色）**<br /><img src="docs/screenshots/home-light.png" width="760" alt="主页（亮色）">       |
|              **资产**<br /><img src="docs/screenshots/asset.png" width="760" alt="资产">             |
|        **盈亏日历**<br /><img src="docs/screenshots/calendar-pnl.png" width="760" alt="盈亏日历">        |
|     **技术分析（QQQ）**<br /><img src="docs/screenshots/analysis.png" width="760" alt="技术分析（QQQ）">     |
|        **AI 助手**<br /><img src="docs/screenshots/ai-assistant.png" width="760" alt="AI 助手">        |

## MCP 服务（连接 hermes 等 AI 客户端）

内建**零依赖 MCP 服务端**（stdio / HTTP(SSE)，默认端口 `9988`）：hermes 等 AI 客户端可先查询账本（账户 / 子账户 / 持仓 / 理财），再按名称/代码定位实体记录流水（加仓 / 减仓 / 分红、现金存取、理财申赎）。

- **配置**：**设置 → AI → MCP 参数** 页一键开关、选传输方式、填地址与令牌，并可复制 hermes 客户端配置；HTTP 模式保存后重启 MCP 服务生效（stdio 用 `portfolio mcp` 启动）。
- **启用（环境变量）**：`MCP_ENABLED=true` / `MCP_TRANSPORT=http` / `MCP_HTTP_ADDR=:9988`；不设则默认关闭、零开销。
- **定位实体**：AI 按**名称 / 证券代码**（大小写不敏感、包含匹配）定位目标；命中多个时返回候选列表供选择。表单中的「备注」仅作说明，不参与定位。
- **工具**：写 `record_transaction`；读 `list_amount_modifiable` / `list_accounts` / `list_cash_accounts` / `list_holdings` / `list_wealth`。均可选 `username` / `user_id` 指定归属用户。
- **流水来源**：MCP 写入的流水 `source='mcp'`、`type` 以 `mcp_` 开头，前端流水表打高亮 **MCP** 标签。

完整参数、返回结构与调用示例见 [`docs/mcp-api.md`](docs/mcp-api.md)。

## 快速开始

### 云端镜像（推荐，无需克隆源码）

镜像由 GitHub Actions 自动构建（`linux/amd64` + `linux/arm64`），推送到 GHCR，每个 main 提交更新 `latest`、每个 `v*` 标签发布版本号：

```bash
docker run -d --name portfolio -p 9989:9989 -p 9988:9988 \
  -v portfolio-data:/data \
  -e TZ=Asia/Shanghai \
  -e MCP_ENABLED=true \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_ADDR=:9988 \
  ghcr.io/w1570187062/my-portfolio-hub:latest

# 或用 docker compose（compose.yml 里 image 填 ghcr.io/w1570187062/my-portfolio-hub:latest）
docker compose up -d
```

- `-p 9989:9989`：Web 主端口（前端页面与 API）。
- `-p 9988:9988`：MCP 服务端口（HTTP/SSE 传输，供 hermes 等 AI 客户端远程连接）；若不需要 AI 客户端接入可省略该映射，并将 `MCP_ENABLED` 留空（默认关闭）。
- `MCP_ENABLED=true` / `MCP_TRANSPORT=http` / `MCP_HTTP_ADDR=:9988`：开启并配置内建 MCP 服务端（详见下文「MCP 服务」）。

访问 <http://localhost:9989> 即可；升级只需 `docker pull` 后重建容器。

### 从源码构建

> 前端 `web/dist` 不入库（见 `.gitignore`），构建前必须先在本地编译前端，否则 `Dockerfile` 的 `fe` 阶段会因缺少 `web/dist` 直接报错。

```bash
# 1) 编译前端（生成 web/dist/，main.go 通过 //go:embed 内嵌）
npm --prefix web install   # 仅首次或依赖变动时需要
npm --prefix web run build

# 2) 构建并启动（--no-cache 确保重新嵌入最新前端）
docker compose build --no-cache && docker compose up -d --force-recreate
```

数据持久化在 `data/portfolio.db`，挂载为 volume。

### 本地运行

```bash
# 前端仍需先编译（见上方「从源码构建」第 1 步），否则 go:embed 找不到 web/dist
npm --prefix web install && npm --prefix web run build
go mod tidy
go build -o portfolio .      # 产物 ./portfolio
./portfolio                  # 监听 :9989，可用 PORT 环境变量覆盖
# 开发期也可直接：go run .
```

数据落在 `./data/portfolio.db`（compose 已挂 volume）。停止：`docker compose down`（保留数据）；`docker compose down -v` 连数据卷一并删除，慎用。

## 贡献与支持

- 如果这个项目对你有帮助，欢迎点右上角 ⭐ **Star** 支持一下，这是持续维护的最大动力。
- Bug / 建议 / 新功能：欢迎提 [Issue](https://github.com/w1570187062/my-portfolio-hub/issues) 或 Pull Request（fork → 新建分支 → 提交 → 发起 PR）。
- 想先看看效果：可直接访问[在线 Demo](https://www.mrchenyifei.icu:19999)。

## 许可

本项目基于 **MIT License** 发布，详见 [LICENSE](LICENSE)。自托管个人项目，请遵守所在司法辖区的金融数据法规。
