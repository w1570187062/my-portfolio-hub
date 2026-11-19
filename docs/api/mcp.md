# MCP 接口文档

本项目内置了一个自包含的 MCP（Model Context Protocol）服务端，AI 客户端可通过标准 MCP 协议连接本应用，查询账本并按实体名称 / 代码定位后记录流水。

- 协议：JSON-RPC 2.0，版本 `2024-11-05`
- 支持能力：`tools`（`tools/list`、`tools/call`）
- 依赖：零外部 SDK，标准库实现

---

## 1. 启用与配置

配置来源优先级：**环境变量 > 配置文件**（环境变量会覆盖文件里的同名项）。

| 配置项 | JSON 字段 | 环境变量 | 说明 |
| --- | --- | --- | --- |
| 启用开关 | `enabled` | `MCP_ENABLED` | `true/1` 启用；HTTP 模式下随 Web 主进程自动拉起 |
| 传输方式 | `transport` | `MCP_TRANSPORT` | `http` | `stdio`，默认 `http` |
| 监听地址 | `http_addr` | `MCP_HTTP_ADDR` | HTTP 模式端口，默认 `:9988` |
| 鉴权令牌 | `token` | `MCP_TOKEN` | HTTP 模式 Bearer 令牌，留空表示不鉴权 |
| 服务名 | `server_name` | — | 暴露给客户端的服务名，默认 `portfolio-mcp` |
| 版本 | `server_version` | — | 默认 `1.0.0` |

配置文件路径：环境变量 `MCP_CONFIG` 指定，缺省为**数据目录**下的 `mcp.json`（与数据库同目录）；容器内数据目录即挂载卷 `/data`，故文件为 `/data/mcp.json`，容器重建后配置不丢失。

示例：

```json
{
  "enabled": true,
  "transport": "http",
  "http_addr": ":9988",
  "token": "你的令牌",
  "server_name": "portfolio-mcp",
  "server_version": "1.0.0"
}
```

Web 端「设置 → AI → MCP 参数」页可直接编辑并保存上述配置；令牌输入框旁的「生成」按钮会随机生成一个令牌。

---

## 2. 传输方式

### 2.1 HTTP（SSE，经典 MCP SSE 传输）

默认监听 `:9988`，提供三个端点：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/mcp` | 建立 SSE 事件流，首帧 `event: endpoint` 给出 POST 地址 |
| POST | `/mcp/messages?sessionId=xxx` | 发送 JSON-RPC 消息，响应经 SSE 流回推 |
| POST | `/mcp/rpc` | 调试端点：直接返回 JSON 响应（不走 SSE），便于 curl/脚本联调 |

流程：客户端先 `GET /mcp` 打开 SSE 流 → 读到 `POST /mcp/messages?sessionId=<sid>` → 后续把 JSON-RPC 消息 POST 到该地址。

> 保存配置后，HTTP 模式需要**重启 MCP 服务**才能生效：在 MCP 参数页点击「重启 MCP 服务」按钮即可（无需重启整个 Web 服务）。页面带状态圆点：主题色=运行中，红色呼吸=未运行/异常，灰色=未启用。

### 2.2 stdio

本地模式，由客户端拉起子进程：

```bash
portfolio mcp                     # 按配置文件运行
portfolio mcp -transport stdio    # 强制 stdio
portfolio mcp -transport http -addr :9988 -token abc
```

stdio 模式下只有 JSON 响应写 stdout，诊断日志一律走 stderr，不会污染协议流。

---

## 3. 鉴权

HTTP 模式下若配置了 `token`，则所有端点都需要携带：

```http
Authorization: Bearer <token>
```

未携带或不匹配时返回 `401 unauthorized`。令牌为空则不鉴权。

---

## 4. 归属账本（多账本隔离）

本应用为多账本体系（一个账本 = 一整套持仓/资产/现金/负债数据，底层 `users` 表的一行即一本账本），MCP 操作的归属账本按以下顺序解析：

1. 优先取工具入参里的 `username` —— 必须与已有**账本名**精确匹配，否则报错（参数名沿用 `username` 属历史契约，语义为账本名）；
2. 其次取工具入参里的 `user_id` —— 必须与已有**账本 id** 匹配，否则报错；
3. 都未传 —— 回退到默认账本（首个账本，通常为 `默认`）。

因此前端「归属账本 ID」无需配置，客户端可在每次调用时按需指定账本。所有工具都支持 `username` / `user_id` 两个可选参数。

---

## 5. 工具清单

| 工具名 | 类型 | 说明 |
| --- | --- | --- |
| `record_transaction` | 写 | 按名称 / 代码（`name`）记录一笔流水（加仓/减仓/分红、现金存取、理财申赎） |
| `list_amount_modifiable` | 读 | 列出所有「金额可被 MCP 修改」的实体（持仓/子账户/理财），含各自支持的 `action` 与当前金额 |
| `list_accounts` | 读 | 列出账户来源（平台/银行/券商），默认内联其下现金子账户 |
| `list_cash_accounts` | 读 | 列出所有现金子账户（扁平列表），含余额与所属来源 |
| `list_holdings` | 读 | 列出持仓，含份额/成本/现价/市值/盈亏；已清仓行（`include_closed=true`）带落袋盈亏口径 |
| `list_wealth` | 读 | 列出理财产品，含最新持仓金额快照与累计收益（快照累计兜底） |
| `list_closed_records` | 读 | 列出全部已平仓记录（系统清仓持仓 + 已清理财 + 手动补录），带落袋金额/收益率/胜率汇总 |
| `get_rebalance` | 读 | 资产再平衡状态（四大类占比/偏离/应买卖金额/年化/超额收益，与页面「再平衡」同口径） |

所有工具统一返回文本块（`content[0].type = "text"`，内容为缩进 JSON）；出错时返回 `isError: true` 且文本为错误信息。

**name 说明**：按**名称 / 证券代码**做**大小写不敏感、包含**匹配定位目标实体。若 `name` 命中多个实体，工具返回候选列表并要求更精确或指定 `entity_type`。

---

## 6. 工具详解

### 6.1 record_transaction（记录流水）

按 `name`（名称 / 证券代码模糊匹配）定位实体并记录一笔流水；`name` **为必填**。

> 来源标记：MCP 写入的流水 `type` 以 `mcp_` 开头，并在 `cash_flow.source` 落库为 `mcp`。
> 资产全景「流水」表格会对这类流水显示高亮的 **MCP** 标签，与手动 / 应用内操作区分；备注同时保留 `MCP·<action>·<note>` 前缀。

参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 目标实体名称 / 证券代码，**大小写不敏感的包含**匹配（可匹配持仓名称、代码或子账户/理财名称） |
| `action` | string | 是 | `buy`/`sell`/`dividend`（持仓）、`deposit`/`withdraw`（现金）、`subscribe`/`redeem`（理财） |
| `entity_type` | string | 否 | `holding` | `cash` | `wealth`，省略则自动匹配 |
| `quantity` | number | 否 | 加仓/减仓数量 |
| `price` | number | 否 | 加仓/减仓价格 |
| `fee` | number | 否 | 手续费，默认 0 |
| `per_share` | number | 否 | 分红每股金额 |
| `amount` | number | 否 | 现金存取 / 理财申赎金额（**取绝对值，方向由 `action` 决定**：`withdraw`/`redeem` 记流出、`deposit`/`subscribe` 记流入；传负数按绝对值处理） |
| `note` | string | 否 | 附加说明，写入账本备注 |
| `username` / `user_id` | string / int | 否 | 归属账本 |

`name` 命中 0 个返回错误、命中 1 个直接执行、**命中多个返回候选列表**（含 `type`/`id`/`name`/`extra`），需更精确或指定 `entity_type` 后重试。

调用示例：

```json
{
  "jsonrpc": "2.0", "id": 2,
  "method": "tools/call",
  "params": {
    "name": "record_transaction",
    "arguments": {
      "name": "茅台",
      "action": "buy",
      "quantity": 100,
      "price": 1600
    }
  }
}
```

### 6.2 list_accounts（账户来源 + 子账户）

参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `source_id` | int | 只返回该来源；省略返回全部 |
| `include_cash` | bool | 是否内联该来源下的现金子账户，默认 `true` |
| `username` / `user_id` | string / int | 归属账本 |

返回示例：

```json
{
  "count": 1,
  "accounts": [
    {
      "id": 3, "name": "招商银行", "type": "bank", "region": "domestic",
      "currencies": "rmb", "note": "",
      "cash_accounts": [
        { "id": 7, "name": "活期", "currency": "CNY", "type": "活期", "amount": 12345.67, "is_default": true, "note": "养老金账户" }
      ],
      "cash_total_by_currency": { "CNY": 12345.67 }
    }
  ]
}
```

### 6.3 list_cash_accounts（现金子账户）

参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `source_id` | int | 只返回该来源下的子账户 |
| `currency` | string | 按币种过滤（如 `CNY`/`USD`），不分大小写 |
| `username` / `user_id` | string / int | 归属账本 |

返回：`count`、`total_by_currency`（各币种合计）、`cash_accounts[]`（含 `source`、`is_default`、`note`）。

### 6.4 list_holdings（持仓）

参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `source_id` | int | 按来源过滤 |
| `symbol` | string | 按代码过滤（不分大小写） |
| `category` | string | `stock` | `fund` |
| `include_closed` | bool | 是否包含份额为 0 的清仓持仓，默认 `false` |
| `username` / `user_id` | string / int | 归属账本 |

返回：`count`、`market_value_by_currency`、`pnl_by_currency`、`holdings[]`。
单条持仓含：`quantity`、`cost_price`、`current_price`、`market_value`、`pnl`、`pnl_pct`（百分比）、`asset_type`、`buy_date`、`note` 等。

> **已清仓行**（`quantity <= 0`，需 `include_closed=true`）：浮动口径恒为 0，因此 `pnl` / `pnl_pct` 自动改带**落袋口径**（`pnl` = Σ减仓已实现盈亏，`pnl_pct` = 落袋 ÷ 本金），并额外返回 `closed`（恒 true）、`realized_pnl`（落袋金额）、`invested_cost`（本金分母；为 0 表示算不出，`pnl_pct` 亦为 0）。`pnl_by_currency` 合计中在持行为浮动口径、已清仓行为落袋口径。

### 6.5 list_wealth（理财）

参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `source_id` | int | 按来源过滤 |
| `username` / `user_id` | string / int | 归属账本 |

返回：`count`、`amount_by_currency`、`wealth[]`。
单条含：`code`、`currency`、`source`、`latest_amount`（最新快照金额）、`latest_date`（快照日期）、`cum_pnl`（累计收益）、`note`。

> **累计收益兜底**：手动编辑值（非 0）优先；为 0 时按每日快照自动累计。已清仓理财库内 `cum_pnl` 常为 0，该兜底保证 AI 读到的值与页面表格一致。

### 6.6 list_closed_records（已平仓记录）

列出当前账本**全部已平仓记录**，与页面「平仓」tab 同源同口径，三类合并返回；分析历史落袋收益 / 胜率 / 复盘用本工具，在持部分用 `list_holdings`。

参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `username` / `user_id` | string / int | 归属账本 |

返回：

| 字段 | 说明 |
| --- | --- |
| `count` | 记录总条数 |
| `realized_total_cny` | 落袋合计（折人民币） |
| `by_kind_cny` | 分类小计：`stock_cny` / `fund_cny` / `wealth_cny` |
| `win_n` / `loss_n` / `win_rate_pct` | 盈/亏笔数与胜率（0 盈亏不进分母，无输赢样本时 `win_rate_pct` 为 `null`） |
| `closed_records[]` | 逐条记录 |

`closed_records[]` 单条含：

| 字段 | 说明 |
| --- | --- |
| `kind` | `stock` / `fund` / `wealth` |
| `source` | 来源/账户名（手动补录为纯文本） |
| `name` / `code` | 名称 / 代码 |
| `currency` | 金额币种 |
| `amount` | 落袋盈亏（原币种，正=赚、负=亏） |
| `principal` | 本金（`null` = 算不出/未填） |
| `return_rate` | 持有期收益率 %（`null` = 算不出） |
| `holding_days` | 持有天数 |
| `realized_at` | 清仓日期 YYYY-MM-DD |

三类来源与口径：

1. **系统已清仓持仓**（份额 0）：`amount` = Σ减仓已实现盈亏（`position_tx.realized_pnl`），本金按「清仓前快照份额×成本 vs BUY 合计取大」反推，与 `/api/home` 已平仓视图一致；
2. **已清仓理财**（archived）：`amount` = 累计收益（手动值优先，否则每日快照累计），本金按「最后持有节点反推」；
3. **手动补录平仓**（系统外发生的平仓，不入账）：金额/本金/收益率取补录时填写值，未填收益率时按 盈亏÷本金 推算。

调用示例：

```json
{
  "jsonrpc": "2.0", "id": 4,
  "method": "tools/call",
  "params": { "name": "list_closed_records", "arguments": {} }
}
```

### 6.7 list_amount_modifiable（可改金额的实体）

列出当前账本所有**金额可被 MCP 修改**的实体，即持仓（holding）、现金子账户（cash）、理财（wealth）三类；供 AI 先定位可改金额的目标，再选 `record_transaction` 的 `action`。

> 负债（liability）与账户来源（source）**不支持** MCP 改金额，故不包含在内。

参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `entity_type` | string | 只返回该类型：`holding` | `cash` | `wealth`；省略返回全部三类 |
| `username` / `user_id` | string / int | 归属账本 |

返回：`count`、`amount_modifiable[]`。单条含 `type`、`id`、`name`、`note`、`currency`、`current_amount`（当前金额：持仓=份额×现价、现金=余额、理财=最新快照金额）、`supported_actions`。

`supported_actions` 取值：holding=`buy`/`sell`/`dividend`；cash=`deposit`/`withdraw`；wealth=`subscribe`/`redeem`。

### 6.8 get_rebalance（资产再平衡状态）

查询当前账本的再平衡快照，口径与页面「再平衡」完全一致（股票/基金/理财/现金四大类）。

参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `username` / `user_id` | string / int | 归属账本 |

返回：总市值，四类的市值 / 实际占比 / 目标占比 / 偏离(pp) / 应买应卖金额 / 收益影响，组合目标年化与实际年化、超额收益率与超额收益金额、波动率、待调整金额、距上次再平衡天数与是否超期，以及被剔除的日常开销子账户规模。金额单位为人民币元，占比与偏离为百分比。用于回答「现在偏离多少 / 该买还是该卖 / 各买多少 / 现金是不是太多 / 组合预期收益多少 / 要不要调仓」。

---

## 7. 调用示例

### 7.1 初始化

```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }
```

响应 `result.serverInfo` 返回服务名与版本。

### 7.2 列出工具

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }
```

### 7.3 调用查询工具

```json
{
  "jsonrpc": "2.0", "id": 3,
  "method": "tools/call",
  "params": {
    "name": "list_holdings",
    "arguments": { "username": "默认" }
  }
}
```

### 7.4 curl 联调（HTTP 调试端点）

```bash
curl -X POST http://127.0.0.1:9988/mcp/rpc \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

若配置了令牌，缺少或不匹配会返回 `401`。

### 7.5 客户端配置模板

```json
{
  "mcpServers": {
    "portfolio": {
      "url": "http://127.0.0.1:9988/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

stdio 模式：

```json
{
  "mcpServers": {
    "portfolio": { "command": "portfolio", "args": ["mcp"] }
  }
}
```

两份模板在 Web 端「MCP 参数」页会随表单实时生成，可直接「复制客户端配置」。

---

## 8. 错误处理

- 未知方法：返回 JSON-RPC 错误 `-32601 method not found`
- 工具内部出错：返回 `result.isError = true`，`content[0].text` 为可读错误原因（例如未找到该名称、归属账本不存在、必填参数缺失等）
- HTTP 层：方法不允许 `405`，鉴权失败 `401`，请求体非法 JSON `400`

