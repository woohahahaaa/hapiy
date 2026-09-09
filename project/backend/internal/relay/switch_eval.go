package relay

import (
	"encoding/json"
	"strings"

	"github.com/hapiy/hapiy/internal/topology"
)

// switchConfig mirrors the frontend 条件开关 node config (config-dialog):
// 筛选维度（供应商/模型）+ 请求头/请求体条件。条件形状与请求改写共用
// compileConditions / evaluateCondition(s)。
type switchConfig struct {
	Mode           string          `json:"mode"` // "provider" | "model"（缺省 provider）
	Providers      []string        `json:"providers"`
	Models         []string        `json:"models"`
	ConditionLogic string          `json:"conditionLogic"` // "AND"（缺省）| "OR"
	Conditions     json.RawMessage `json:"conditions"`
}

// switchEvalFor builds the per-request 条件开关 branch evaluator. 语义是
// 「路由分流」：配置了供应商/模型筛选或判断条件时，命中其中任一即走「是」，
// 全部未命中走「否」；两者都没配置时无条件走「是」（与空配置一致）。
// 单个筛选维度或条件列表内部仍按各自规则（条件内为 AND/OR 复合）。
func switchEvalFor(headers map[string]string, body []byte) topology.SwitchEval {
	return func(raw json.RawMessage, ctx topology.SwitchEvalContext) bool {
		var cfg switchConfig
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return true
		}
		filterConfigured := cfg.Mode == "model" && len(cfg.Models) > 0
		if cfg.Mode != "model" {
			filterConfigured = len(cfg.Providers) > 0
		}
		condConfigured := switchCondCount(&cfg) > 0
		if filterConfigured && switchFilterPasses(&cfg, ctx) {
			return true
		}
		if condConfigured && switchConditionsPass(&cfg, body, headers) {
			return true
		}
		return !filterConfigured && !condConfigured
	}
}

// switchCondCount returns the number of top-level conditions in the config.
// An explicit `"conditions":[]` must count as "no conditions configured" —
// the raw bytes are non-empty even though the array has no elements.
func switchCondCount(cfg *switchConfig) int {
	if len(cfg.Conditions) == 0 {
		return 0
	}
	var list []json.RawMessage
	if err := json.Unmarshal(cfg.Conditions, &list); err != nil {
		return 0
	}
	return len(list)
}

func switchFilterPasses(cfg *switchConfig, ctx topology.SwitchEvalContext) bool {
	if cfg.Mode == "model" {
		if len(cfg.Models) == 0 {
			return true
		}
		for _, m := range cfg.Models {
			if m == ctx.Model {
				return true
			}
		}
		return false
	}
	if len(cfg.Providers) == 0 {
		return true
	}
	for _, p := range cfg.Providers {
		if p == ctx.ProviderID || (p != "" && p == ctx.ProviderName) {
			return true
		}
	}
	return false
}

func switchConditionsPass(cfg *switchConfig, body []byte, headers map[string]string) bool {
	if len(cfg.Conditions) == 0 {
		return true
	}
	conds, err := compileConditions("switch", 0, cfg.Conditions)
	if err != nil {
		return true
	}
	for i := range conds {
		unquoteConditionString(&conds[i])
	}
	if cfg.ConditionLogic == "OR" {
		if len(conds) == 0 {
			return true
		}
		for i := range conds {
			ok, err := evaluateCondition(&conds[i], body, headers)
			if err == nil && ok {
				return true
			}
		}
		return false
	}
	ok, err := evaluateConditions(conds, body, headers)
	return err == nil && ok
}

// unquoteConditionString 兼容历史数据：开关弹窗早期按「字符串带引号」的
// 字面量约定取值，却没像请求改写那样在入库前去引号，导致布尔/数字外的
// 字符串被存成带引号文本（如 "MiniMax" 存成 "\"MiniMax\""），contains/eq
// 永远对不上。这里把叶子里形如 JSON 字符串字面量的 value 解开成普通字符串。
// 请求改写入库一定是无引号形式，该修正不影响它。
func unquoteConditionString(c *RewriteCondition) {
	if c.combined {
		for i := range c.Children {
			unquoteConditionString(&c.Children[i])
		}
		return
	}
	if c.RawValue != nil {
		return
	}
	t := strings.TrimSpace(c.Value)
	if len(t) >= 2 && t[0] == '"' && t[len(t)-1] == '"' {
		var s string
		if err := json.Unmarshal([]byte(t), &s); err == nil {
			c.Value = s
		}
	}
}