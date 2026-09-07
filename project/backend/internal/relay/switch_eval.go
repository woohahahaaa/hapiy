package relay

import (
	"encoding/json"

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

// switchEvalFor builds the per-request 条件开关 branch evaluator. 筛选维度与
// 判断条件须同时命中才走「是」，否则走「否」；筛选列表/条件留空视为命中。
// 配置损坏按无条件处理（走「是」），与空配置一致。
func switchEvalFor(headers map[string]string, body []byte) topology.SwitchEval {
	return func(raw json.RawMessage, ctx topology.SwitchEvalContext) bool {
		var cfg switchConfig
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return true
		}
		return switchFilterPasses(&cfg, ctx) && switchConditionsPass(&cfg, body, headers)
	}
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