package market

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/dop251/goja"
)

// ---- 自定义评级脚本引擎（goja）----
//
// 用户在「资产工具 → 评级逻辑」编写 JS：实现 evaluate(ind)，返回 0~100 看涨概率。
// 脚本由后端进程内嵌的 goja（纯 Go ECMAScript 引擎）执行，沙箱无 I/O；
// 配置后全局生效，作用于：分析弹框、自动分析落库、逐日历史信号三处。
//
// 降级策略：未启用 / 编译失败 / 运行异常 / 超时 / 返回非法 → 自动走内置默认
// 逻辑 CalculateProbability，仅记录日志，绝不因自定义脚本导致分析不可用。
//
// ind 字段契约（与 IndicatorsResult 的 json 标签一致，经 JSON 序列化传入）：
//   ind.price / ind.ma5 / ind.ma10 / ind.ma20 / ind.ma60
//   ind.dif / ind.dea / ind.hist / ind.hist_prev        // MACD
//   ind.rsi / ind.k / ind.d / ind.j                     // RSI / KDJ
//   ind.bu / ind.bm / ind.bl / ind.bw                   // 布林带上/中/下轨/带宽
// 内置助手：clamp(v, min, max)。

const (
	scriptTimeoutSingle = 5 * time.Second  // 单次调用（弹框/自动分析）超时
	scriptTimeoutDaily  = 250 * time.Millisecond // 逐日信号批量调用单日超时
	scriptDailyBudget   = 4 * time.Second        // 逐日信号批量调用总预算，超支后剩余日期走默认
)

var (
	engineMu        sync.RWMutex
	engineEnabled   bool
	engineCompiled  *goja.Program
	engineCompiledOf string // 编译产物对应的脚本原文（用于判断是否需要重编译）
)

// ConfigureEngine (re)loads the global custom script. Called at startup and
// whenever the script is saved via the API. Compile errors are logged and
// leave the engine disabled (default logic keeps running).
func ConfigureEngine(code string, enabled bool) {
	engineMu.Lock()
	defer engineMu.Unlock()
	engineEnabled = false
	engineCompiled = nil
	engineCompiledOf = ""
	if !enabled || code == "" {
		return
	}
	prog, err := goja.Compile("analysis_script", code, false)
	if err != nil {
		log.Printf("[scriptEngine] 脚本编译失败，停用自定义逻辑: %v", err)
		return
	}
	engineCompiled = prog
	engineCompiledOf = code
	engineEnabled = true
	log.Printf("[scriptEngine] 自定义评级脚本已启用（%d 字节）", len(code))
}

// EvaluateProbability computes UpPct for ind using the custom script when
// enabled, falling back to the built-in default logic otherwise.
func EvaluateProbability(ind *IndicatorsResult) *ProbabilityResult {
	engineMu.RLock()
	enabled, prog := engineEnabled, engineCompiled
	engineMu.RUnlock()

	if !enabled || prog == nil {
		res := CalculateProbability(ind)
		if res != nil {
			res.Engine = "default"
		}
		return res
	}

	up, err := runScriptEngine(prog, ind, scriptTimeoutSingle, nil)
	if err != nil {
		log.Printf("[scriptEngine] 脚本执行失败，降级默认逻辑: %v", err)
		res := CalculateProbability(ind)
		if res != nil {
			res.Engine = "default(fallback)"
		}
		return res
	}
	return buildCustomResult(ind, up)
}

// EvaluateProbabilityBounded is the batch variant used by ComputeDailySignals:
// per-day timeout is small and a shared budget caps the total custom-script
// time; once the budget is exhausted the remaining days use the default logic.
// budget may be nil (no total cap).
func EvaluateProbabilityBounded(ind *IndicatorsResult, budget *time.Duration) *ProbabilityResult {
	engineMu.RLock()
	enabled, prog := engineEnabled, engineCompiled
	engineMu.RUnlock()

	if !enabled || prog == nil {
		res := CalculateProbability(ind)
		if res != nil {
			res.Engine = "default"
		}
		return res
	}

	up, err := runScriptEngine(prog, ind, scriptTimeoutDaily, budget)
	if err != nil {
		log.Printf("[scriptEngine] 批量脚本执行失败（单日降级）: %v", err)
		res := CalculateProbability(ind)
		if res != nil {
			res.Engine = "default(fallback)"
		}
		return res
	}
	return buildCustomResult(ind, up)
}

// runScriptEngine executes the compiled program with a fresh runtime and
// returns evaluate(ind) clamped to [10,90]. budget, when non-nil, is charged
// with the actual run time; running out of budget aborts before execution.
func runScriptEngine(prog *goja.Program, ind *IndicatorsResult, timeout time.Duration, budget *time.Duration) (float64, error) {
	if budget != nil {
		if *budget <= 0 {
			return 0, fmt.Errorf("脚本总预算已耗尽，跳过执行")
		}
	}

	vm := goja.New()

	// 内置助手：clamp(v, min, max)
	_ = vm.Set("clamp", func(call goja.FunctionCall) goja.Value {
		v := toFloat(call.Argument(0))
		lo := toFloat(call.Argument(1))
		hi := toFloat(call.Argument(2))
		if lo > hi {
			lo, hi = hi, lo
		}
		return vm.ToValue(math.Max(lo, math.Min(hi, v)))
	})

	// ind 经 JSON 序列化注入，字段名与文档契约（json 标签）完全一致
	raw, err := json.Marshal(ind)
	if err != nil {
		return 0, fmt.Errorf("指标序列化失败: %w", err)
	}
	indVal, err := goja.JSONParse(vm, string(raw))
	if err != nil {
		return 0, fmt.Errorf("指标注入失败: %w", err)
	}
	_ = vm.Set("ind", indVal)

	start := time.Now()
	timer := time.AfterFunc(timeout, func() { vm.Interrupt(fmt.Errorf("脚本执行超时(%v)", timeout)) })
	defer timer.Stop()

	val, err := vm.RunProgram(prog)
	if err == nil {
		if fn, ok := goja.AssertFunction(val); ok {
			val, err = fn(goja.Undefined(), indVal)
		} else {
			// 脚本未定义 evaluate 时，顶层返回值视为结果（更宽松的容错）
			err = nil
		}
	}
	elapsed := time.Since(start)
	if budget != nil {
		*budget -= elapsed
	}
	if err != nil {
		return 0, fmt.Errorf("脚本运行错误: %v", err)
	}
	if val == nil || goja.IsUndefined(val) || goja.IsNull(val) {
		return 0, fmt.Errorf("evaluate 未返回结果")
	}
	up := toFloat(val)
	if math.IsNaN(up) || math.IsInf(up, 0) {
		return 0, fmt.Errorf("evaluate 返回了非有限数值: %v", up)
	}
	return math.Max(10, math.Min(90, up)), nil
}

// toFloat extracts a float from a goja value, 0 when not convertible.
func toFloat(v goja.Value) float64 {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return 0
	}
	return v.ToFloat()
}

// ValidateScript compiles code without enabling it; used by the save API to
// reject syntactically broken scripts.
func ValidateScript(code string) error {
	_, err := goja.Compile("script_test", code, false)
	return err
}

// RunScriptTest compiles code fresh and runs it against ind, returning the
// clamped upPct. Used by the test API to contrast custom vs default results.
func RunScriptTest(code string, ind *IndicatorsResult) (float64, error) {
	prog, err := goja.Compile("script_test", code, false)
	if err != nil {
		return 0, err
	}
	return runScriptEngine(prog, ind, scriptTimeoutSingle, nil)
}

// buildCustomResult assembles the response for a custom-script verdict:
// UpPct from the script; per-indicator signals from the default logic are kept
// as reference detail, and Engine marks which engine produced the number.
func buildCustomResult(ind *IndicatorsResult, upPct float64) *ProbabilityResult {
	base := CalculateProbability(ind)
	if base == nil {
		base = &ProbabilityResult{}
	}
	upPct = math.Round(upPct*10) / 10
	base.UpPct = upPct
	base.DownPct = math.Round((100-upPct)*10) / 10
	base.Engine = "custom"
	base.Summary = fmt.Sprintf("【自定义脚本】技术面看涨指数：%.1f。下方指标明细为内置默认逻辑，仅供对照参考。", upPct)
	return base
}
