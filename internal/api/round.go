package api

import "math"

// round2 / round4 把浮点计算值归整到常规展示精度，
// 避免 2.930000000000291 / 4054.7628000000003 之类的长小数
// 进入 API 返回、导出 JSON、推送与 AI 总结文本。
// 金额/盈亏 2 位小数；基金净值等价格 4 位。
func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round4(v float64) float64 { return math.Round(v*10000) / 10000 }
