package api

import (
	"strconv"
	"strings"
)

// fmtNum 格式化进明细文案（cash_flow.note 等用户可见描述）的浮点数字。
//
// 背景：此前一律用 %g，二进制浮点的最短往返表示会被完整打出来，
// 例如每股分红 0.004299961709738625（前端流水列表原样显示 18 位小数），
// 既读不出量级也撑破列表行。这里统一成「最多 6 位小数 + 去掉尾随 0」：
//   0.004299961709738625 -> 0.0043     49072.53 -> 49072.53     1.32 -> 1.32     8 -> 8
// 6 位小数对单价/每股分红足够（误差 < 0.000001 × 份额，远小于 1 分钱），份额/数量类天然是 2 位。
func fmtNum(v float64) string {
	s := strconv.FormatFloat(v, 'f', 6, 64)
	if strings.ContainsRune(s, '.') {
		s = strings.TrimRight(s, "0")
		s = strings.TrimSuffix(s, ".")
	}
	if s == "" || s == "-" || s == "+0" {
		s = "0"
	}
	return s
}
