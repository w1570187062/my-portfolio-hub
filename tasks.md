# 收支计划落地任务清单

> 规格：[spec.md](file:///c:/Users/chenyifei/WorkBuddy/portfolio/spec.md)

## 后端

- [x] B1 `internal/db/db.go`：建表语句与 `addColumnIfMissing` 增加 `enabled`、`deleted_at`
- [x] B2 `CashflowPlan` 结构体与 `ListCashflowPlans` / `GetCashflowPlan` 读取 `enabled`，列表过滤 `deleted_at=''`
- [x] B3 `CreateCashflowPlan` / `UpdateCashflowPlan` 写入 `enabled`；撤销完成记录级联删除
- [x] B4 `DeleteCashflowPlan` 改软删除；新增 `SoftDeleteCashflowPlans` / `RestoreCashflowPlans`
- [x] B5 `internal/api/cashflow.go`：`patchCashflowPlan`（局部更新 + 校验 + 归属）
- [x] B6 `internal/api/cashflow.go`：`bulkDeleteCashflowPlans` / `restoreCashflowPlans`；complete/uncomplete 拒绝已删计划
- [x] B7 `internal/api/handler.go`：注册 PATCH / bulk-delete / restore
- [x] B8 `today.go` 与 `notify.go` 跳过 `enabled=0`
- [x] B9 `go build ./...` 通过

## 前端

- [x] F1 `web/app.js`：重写 `renderAssetCashflowPanel`（小结 / 工具条 / 批量条 / 分组列表 / 空态）
- [x] F2 行内编辑：金额、日期浮层（每月/一次性）、名称、启用开关（全部走 PATCH）
- [x] F3 删除 / 批量删除 + 5 秒撤销 toast（新增 `#cfUndoToast`）
- [x] F4 抽屉化 `#cashflowModal`：右侧抽屉 + 关闭 + 编辑态删除按钮
- [x] F5 筛选 / 排序 / 批量选择 / 窄屏「更多」
- [x] F6 清理翻月卡死代码与旧样式；`cfDoneYmOf` 去掉 `_fpCardYm`
- [x] F7 `node --check`、`node build.mjs`（死代码 0）、`node check-ui.mjs`（17/17）

## 实测

- [x] V1 新增 → 行内改金额/日期/名称 → 暂停 → 删除 → 撤销
- [x] V2 批量删除 → 批量撤销 → 刷新确认软删不回来、完成历史仍在
- [x] V3 首页待办与 today 接口不显示已删/暂停计划
- [x] V4 桌面 1280×800、手机 390×844 截图

## 部署与提交

- [x] D1 备份线上与本地库
- [x] D2 部署，9989 / 19998 探活，md5 一致
- [ ] D3 后端 / 前端 / 文档三次提交，推 gitea
- [ ] D4 GitHub 尝试一次，失败如实说明
