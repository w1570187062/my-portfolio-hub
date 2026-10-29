package mcp

import "fmt"

// RebalanceProvider 由 api 包在 init 阶段注入，返回与 GET /api/rebalance 同口径的快照。
//
// 为什么用注入而不是 import：再平衡的取数依赖 api 包里的 enrich / 汇率 / 口径常量，
// 而 api 包本身 import 了 mcp（内置 AI 助手要用 ChatToolDefs），直接调用会形成循环依赖。
// 注入后「配平算法只有一份」，避免在 mcp 里复刻一份 drift/amount/contrib 计算后
// 两端口径漂移 —— 该口径的红线是 Σamount = 0、Σcontrib = 超额收益，两份实现必然对不上。
//
// 为 nil 表示当前进程没有装配 api 层（例如仅跑 MCP 子命令），此时工具明确报错，不返回空数据。
var RebalanceProvider func(uid int64) (map[string]interface{}, error)

// registerRebalanceTools 注册只读的资产再平衡查询工具。
func (s *Server) registerRebalanceTools() {
	s.tools = append(s.tools, &Tool{
		Name: "get_rebalance",
		Description: "查询当前账本的资产再平衡状态（股票/基金/理财/现金四大类口径，与页面「再平衡」完全一致）。" +
			"返回：总市值、四类的市值/实际占比/目标占比/偏离(pp)/应买应卖金额/收益影响、" +
			"组合的目标年化与实际年化、超额收益率与超额收益金额、波动率、待调整金额、" +
			"距上次再平衡天数与是否超期，以及被剔除的日常开销子账户规模。" +
			"用于回答「现在偏离多少 / 该买还是该卖 / 各买多少 / 现金是不是太多 / 组合预期收益多少 / 要不要调仓」。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"username": map[string]interface{}{"type": "string", "description": "归属账本名：省略则使用默认（首个）账本。"},
				"user_id":  map[string]interface{}{"type": "integer", "description": "归属账本 id：与 username 二选一；省略使用默认账本。"},
			},
		},
		Handler: getRebalance,
	})
}

// getRebalance 返回结构化快照（缩进 JSON）。金额单位为人民币元，占比与偏离为百分比。
func getRebalance(args map[string]interface{}) (string, error) {
	uid, err := resolveUserID(args)
	if err != nil {
		return "", err
	}
	if RebalanceProvider == nil {
		return "", fmt.Errorf("再平衡查询未就绪：当前进程未装配账本服务")
	}
	data, err := RebalanceProvider(uid)
	if err != nil {
		return "", err
	}
	return marshalResult(data)
}
