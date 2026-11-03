# 收支计划落地规格（第一期）

> 状态：待确认后执行  
> 原型（交互与视觉基线）：`tab-redesign-prototype/cashflow-plan-prototype.html`  
> 设计说明：`docs/收支计划改版方案.md`

## 1. 目标与范围

把已验收原型落到真实应用：资产页「收支」页签下的收支计划支持**行内改金额/日期/名称、暂停/启用、软删除、5 秒撤销、批量删除与批量撤销、筛选与排序、右侧抽屉新增/详情**，并且**删除不再抹掉完成历史**。

明确不做：每周重复（后端 pattern 仍只认 `recurring_fixed` / `one_time`，非 `one_time` 归一为每月）；回收站页面；拖拽排序；提醒文案改版；自动记账。

## 2. 后端规格

### 2.1 表结构（`internal/db/db.go`）

- 建表语句 `cashflow_plans`（L1393-L1409）新增：
  - `enabled INTEGER NOT NULL DEFAULT 1`
  - `deleted_at TEXT NOT NULL DEFAULT ''`
- 兼容旧库迁移，沿用 `addColumnIfMissing`（L1241），在 L1505 附近追加：
  - `addColumnIfMissing("cashflow_plans", "enabled", "INTEGER NOT NULL DEFAULT 1")`
  - `addColumnIfMissing("cashflow_plans", "deleted_at", "TEXT NOT NULL DEFAULT ''")`
- 老数据由默认值带回：`enabled=1`、`deleted_at=''`（SQLite 常量默认值 ALTER 不重写表）。
- `db.CashflowPlan` 结构（L2792）新增 `Enabled int \`json:"enabled"\``、`DeletedAt string \`json:"deleted_at,omitempty"\``。

### 2.2 读取过滤（单点收口）

所有读取都走 `db.ListCashflowPlans`：列表、资产页月度小结、首页待办聚合、`today.go`、定时提醒、子账户删除/转负债的引用校验。因此：

- `ListCashflowPlans`（L2824）查询加 `AND COALESCE(deleted_at,'')=''`，SELECT 增加 `enabled`，ORDER BY 保持不变。
- `GetCashflowPlan`（L2843）SELECT 增加 `enabled, deleted_at`，供所有权校验与“已删除不可完成/不可改”判断。
- 不做其他 SQL 散点过滤（仓库内只有 db.go 直接查该表）。
- `today.go`（L136 起的 plans 循环）与 `notify.go`（L683 起的 plans 循环）各加一条：`if p.Enabled == 0 { continue }`，暂停计划不进入首页待办、不发提醒。

### 2.3 写入与软删除

- `CreateCashflowPlan`（L2858）：INSERT 增加 `enabled`，创建时缺省 `1`。
- `UpdateCashflowPlan`（L2881）：UPDATE 增加 `enabled`；handler 中仍以现有行覆盖 `p.Enabled`，保证不传 enabled 的整表单保存不会把启用中的计划暂停。
- `DeleteCashflowPlan`（L2897）改为软删除：`UPDATE cashflow_plans SET deleted_at=? WHERE id=? AND user_id=?`；**删除 L2899 的 `DELETE FROM cashflow_plan_done`**。
- 新增 `SoftDeleteCashflowPlans(uid int64, ids []int64) (int64, error)`：一条 UPDATE、`IN` 占位符、只影响本人未删除行。
- 新增 `RestoreCashflowPlans(uid int64, ids []int64) (int64, error)`：`deleted_at=''`，只恢复本人已删除行，幂等。

### 2.4 接口（`internal/api/cashflow.go` + `handler.go` L359-L364）

| 方法/路径 | 实现 | 契约 |
|---|---|---|
| `DELETE /api/cashflow/plans/:id` | 复用 `deleteCashflowPlan` | 语义变为软删除，返回 `{ok:true}`，不再级联删完成记录 |
| `PATCH /api/cashflow/plans/:id` | 新增 `patchCashflowPlan` | body 只带要改的字段：`amount?`、`day_of_month?`、`title?`（兼容 `name?`）、`type?`、`enabled?`、`one_time_date?`；返回 `{plan}` |
| `POST /api/cashflow/plans/bulk-delete` | 新增 | body `{ids:[...]}`，返回 `{deleted:n, ids:[...]}` |
| `POST /api/cashflow/plans/restore` | 新增 | body `{ids:[...]}`，返回 `{restored:n}`；单条撤销也走它 |

`patchCashflowPlan` 规则：
- 用指针字段区分“没传”和“传 0/空”；仅改传入字段，其余保持原值。
- 校验：`title` 去空格后非空；`type` ∈ income/expense；`amount >= 0`；`day_of_month` 1–31；`one_time_date` 为合法 `YYYY-MM-DD`（若计划是 `one_time` 且传了日期，同步 `day_of_month` 为日号）。
- 归属校验：行不存在、非本人、`deleted_at<>''` 统一 404「计划不存在」。
- 若改 `type`，不重算分类/负债（第一期只允许方向切换的字段本身；分类保持原值，抽屉里再编辑可校正）。为避免脏数据，`type` 切换仅允许在未关联负债时进行；已关联负债（`liability_id>0` 或 `liability_mode=incur`）时返回 400「已关联负债的计划不能直接改方向」。

`completeCashflowPlan` / `uncompleteCashflowPlan`：加载计划后若 `DeletedAt != ""` 返回 404，避免对已删计划记账。

`updateCashflowPlan`：所有权校验失败/已删除 → 404；保存前 `p.Enabled = existing.Enabled`。

## 3. 前端规格

### 3.1 面板结构（`web/app.js` `renderAssetCashflowPanel` L7663-L7690）

在 `#assetPanelCashflow` 内渲染：

1. 头部：`收支计划` + 计划数 + 右侧「批量管理」与「新建计划」。
2. 小结卡：本月固定收入 / 固定支出 / 本月净额 / 计划状态（4 格；只计启用中的循环计划，金额折 CNY 复用 `cnyOf`，暂停与一次性不计入收支合计）。
3. 工具条：类型（全部/收入/支出）、状态（全部/启用中/已暂停/已过期）、排序（下次发生升序默认 / 金额 / 名称）。
4. 批量条：全选当前筛选、已选数、删除所选、退出批量。
5. 分组列表：`即将发生`（≤7 天）、`本月`（7 天外且最近一次在本月；**下月顺延的计划也归入本组**，组头注明「含下月顺延」）、`已过期`、`已暂停`。组内默认按下次发生升序。
6. 行：类型色点、名称、分类、状态、周期、下次发生 + 倒计时、截止/负债、金额、启用开关、编辑、删除；窄屏（≤640）隐藏开关/编辑/删除，收进「更多」浮层。
7. 空态：无计划时引导建工资/房租；筛选无结果时给「清除筛选」。

### 3.2 行内编辑

- 金额：点击金额变输入框，Enter/失焦 PATCH `amount`，Esc 取消；≤0 拒绝并提示；成功后 toast，可撤销回旧值。
- 日期：点击「下次 …」弹浮层，仅「每月 / 一次性」两档；每月改 `day_of_month`，一次性改 `one_time_date`；PATCH 后重排分组；可撤销。
- 名称：点击标题变输入框，Enter/失焦 PATCH `title`，空值拒绝；可撤销。
- 开关：PATCH `enabled`，暂停行变淡并移入「已暂停」，从小结剔除；toast 可撤销。

### 3.3 删除与撤销

- 单条/批量删除：先从列表乐观移除 → `POST /bulk-delete`（单条也走批量接口）→ 底部专用 toast「已删除「X」/ 已删除 N 个计划」+「撤销」+ 5 秒进度条。
- 撤销：`POST /restore`（单条 id 或整批 ids）→ `loadCashflow()` → 重绘。
- 失败：把行加回列表并提示，不制造“假删”。
- 抽屉内删除复用同一路径。

专用 toast：`web/index.html` 在现有 `#toast` 旁新增 `#cfUndoToast`，`app.js` 新增 `cfUndoToast(msg, undoFn)`，5 秒后自动消失；不与全局 `toast()` 抢定时器。

### 3.4 抽屉（新增 / 详情）

- `web/index.html` L1062-L1125 的 `#cashflowModal` 保留全部字段与 id，加 `cf-drawer` 类，CSS 覆盖为右侧抽屉（≤640 为底部 sheet）；右上角关闭按钮；底部左侧新增 `#cfDeleteBtn`「删除计划」（编辑态显示）。
- `openCashflowModal(p)` 复用现有字段填充/选择器逻辑；标题仍为「新建收支计划 / 编辑收支计划」，不新增页面跳转。
- 保存成功关闭抽屉并刷新面板；删除走 3.3。
- 不新增抽屉内的字段分组改版（字段已按现有分组，视觉由抽屉样式承载），避免第一期扩张。

### 3.5 清理旧代码

- 删除仅服务于“单月卡 + 左右翻月”的：`FP_PREV_SVG`/`FP_NEXT_SVG`、`_fpCardYm`、`fpRowHTML`、`fpActHTML`、`fpCardHTML`、`fpNav`、`renderPlanList`、`prefetchPlanMonths`、L4814-L4827 的 `#assetPlanList` 委托，以及 `renderAssetCashflowPanel` 内对它们的调用。
- `cfDoneYmOf` 去掉 `_fpCardYm` 依赖，改用 `cashflowMonth || cfNowYm`。
- 删除前先 grep 引用，`cfSortDay`/`ymShift`/`ymLabel`/`sleepMs` 若仍有首页或其他调用则保留。
- `web/style.css` 删除仅被上述函数使用的 `.fp-nav-btn/.fp-content/.fp-row/.fp-main/.fp-side/.fp-month-pill/.fp-act` 等规则（保留仍有引用的 `.plan-*`）。
- 新样式统一 `cf-plan-*` / `cf-row-*` 前缀，只用现有 token；不新增配色/圆角体系。

### 3.6 视觉硬约束（check-ui 必过）

- 不新增 `font-size` 字面量档位：小结数字用 `var(--fs-xl)`。
- 圆角走 `var(--r-sm)/var(--r)`，不得新增 6px 等。
- 间距走 4px 网格 token；`min-height` 用 56px，开关尺寸 32×20，金额列宽 120px。
- 响应式只用 640/641/1340/1341。
- app.js 不写具体内联样式声明（动态浮层定位用 DOM `style.left/top` 不受此限）。

## 4. 验证

1. `node --check web/app.js`
2. `go build ./...`
3. `cd web && node build.mjs`（死代码新增 0）
4. `cd web && node check-ui.mjs`（17/17）
5. 本地实例（拷贝一份现有 `data/portfolio.db` 到临时库启动，避免污染）实测：
   - 新增 → 行内改金额 → 行内改日期 → 行内改名称 → 暂停 → 删除 → 5 秒内撤销 → 批量删 2 条 → 批量撤销；
   - 刷新页面：软删计划不回来；`cashflow_plan_done` 行数前后一致（SQL 查询确认）；
   - 首页待办 `/api/today/brief` 与列表接口均不出现已删/暂停计划。
6. 截图 1280×800 与 390×844 各一张，存 `docs/screenshots/cashflow-plan-impl-*.png`。

## 5. 部署、备份与回滚

- 部署前备份线上库：先确认容器与数据卷（`docker inspect portfolio`），`docker cp <container>:/app/data/portfolio.db /mnt/nvme0n1-4/backup/portfolio-<日期>.db`（demo 同库则一次即可）；本地 `data/portfolio.db` 也复制一份 `.bak`。
- 部署：`bash scripts/deploy.sh`（构建 + 打包 + 两容器重建 + 探活）。
- 回滚：代码回退到上一提交并重新 `deploy.sh`；数据库新增列是常量默认值，回退代码后旧版不会读写这两列，可保留；如需彻底回滚，停容器后用备份替换 `portfolio.db` 再启动（会丢失备份后的新数据，需用户确认）。

## 6. 提交

分三批，中文说明“为什么”：
1. 后端：软删除 + enabled + 新接口 + 读取过滤。
2. 前端：面板重做 + 抽屉 + 撤销 + 清理翻月卡。
3. 文档：更新 `docs/收支计划改版方案.md` 落地状态、接口契约与回滚说明。

先推 gitea；GitHub 尝试一次，网络不通则如实说明，不反复重试。不 force、不改 git config。
