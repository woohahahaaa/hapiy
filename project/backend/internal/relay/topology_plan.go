package relay

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

func (e *Engine) RefreshPlans() error {
	freshProviders, freshPlans, err := e.buildPlans(e.db)
	if err != nil {
		return err
	}
	e.publishPlans(freshProviders, freshPlans)
	return nil
}

func (e *Engine) PrepareTopologyRefresh(tx *gorm.DB) (func(), error) {
	freshProviders, freshPlans, err := e.buildPlans(tx)
	if err != nil {
		return nil, err
	}
	return func() { e.publishPlans(freshProviders, freshPlans) }, nil
}

func (e *Engine) buildPlans(db *gorm.DB) (map[string]*model.Provider, map[string]*ExecutionPlan, error) {
	var providers []model.Provider
	if err := db.Where("status = ? AND workflow_enabled = ?", true, true).Find(&providers).Error; err != nil {
		return nil, nil, fmt.Errorf("load enabled providers: %w", err)
	}
	freshProviders := make(map[string]*model.Provider, len(providers))
	freshPlans := make(map[string]*ExecutionPlan, len(providers))
	for i := range providers {
		provider := &providers[i]
		freshProviders[provider.ID] = provider
		plan := &ExecutionPlan{ID: provider.ID, Provider: provider}
		if err := e.populatePlan(db, plan); err != nil {
			return nil, nil, fmt.Errorf("compile plan for provider %s: %w", provider.ID, err)
		}
		freshPlans[provider.ID] = plan
	}
	return freshProviders, freshPlans, nil
}

// publishPlans swaps the live plans and providers maps for fresh candidates
// and clears any runtime concurrency state so stale rules don't leak
// counters across topology refreshes.
func (e *Engine) publishPlans(freshProviders map[string]*model.Provider, freshPlans map[string]*ExecutionPlan) {
	e.providersMu.Lock()
	e.plansMu.Lock()
	e.providers = freshProviders
	e.plans = freshPlans
	e.plansMu.Unlock()
	e.providersMu.Unlock()

	// Drop every window bucket. Redesign rules out stale counters: closing a
	// bucket wakes parked waiters so they fail fast instead of hanging.
	e.concurrencyBuckets.Range(func(key, value interface{}) bool {
		if b, ok := value.(*windowBucket); ok {
			b.close()
		}
		e.concurrencyBuckets.Delete(key)
		return true
	})
	e.concurrencyFlushTimes.Range(func(key, value interface{}) bool {
		e.concurrencyFlushTimes.Delete(key)
		return true
	})

	// 临时统计表：清除不再活跃的工作流行（工作流停止即清）。
	if e.db != nil {
		active := make([]string, 0, len(freshPlans))
		for id := range freshPlans {
			active = append(active, id)
		}
		if len(freshPlans) == 0 {
			if err := e.db.Where("1 = 1").Delete(&model.ConcurrencyWindowCounter{}).Error; err != nil {
				log.Printf("relay: failed to clear concurrency counters: %v", err)
			}
		} else {
			if err := e.db.Where("workflow_id NOT IN (?)", active).Delete(&model.ConcurrencyWindowCounter{}).Error; err != nil {
				log.Printf("relay: failed to prune concurrency counters: %v", err)
			}
		}
	}
}

func (e *Engine) populatePlan(db *gorm.DB, plan *ExecutionPlan) error {
	// 1. Deep-compile provider JSON strings into typed slices. A malformed
	//    JSON value MUST fail plan build with a clear error: silent empty
	//    slices would cause a confusing "no base URL" runtime error.
	if err := decodeStringList(plan.Provider.ID, plan.Provider.BaseURLs, &plan.BaseURLs, "base_urls"); err != nil {
		return err
	}
	if err := decodeStringList(plan.Provider.ID, plan.Provider.Keys, &plan.Keys, "keys"); err != nil {
		return err
	}
	if err := decodeModelSet(plan.Provider.ID, plan.Provider.Models, &plan.ModelSet); err != nil {
		return err
	}
	if err := decodeEndpointSet(plan.Provider.ID, plan.Provider.Endpoints, &plan.AllowedPaths); err != nil {
		return err
	}

	// 2. Load topology slot assignments in canonical stage order.
	var assignments []model.TopologySlotAssignment
	orderClause := `CASE slot_type
		WHEN 'requestModify' THEN 0 WHEN 'responseModify' THEN 1
		WHEN 'concurrency' THEN 2 WHEN 'autoSwitch' THEN 3 WHEN 'logOutput' THEN 4 ELSE 5 END,
		"order" ASC, id ASC`
	if err := db.Where("provider_id = ? AND enabled = ?", plan.Provider.ID, true).
		Order(orderClause).Find(&assignments).Error; err != nil {
		return fmt.Errorf("load topology assignments: %w", err)
	}
	for _, assignment := range assignments {
		if err := e.populateAssignment(db, plan, assignment); err != nil {
			return err
		}
	}
	plan.DebugEnabled = false
	return nil
}

func (e *Engine) populateAssignment(db *gorm.DB, plan *ExecutionPlan, assignment model.TopologySlotAssignment) error {
	if !assignmentEffective(assignment, time.Now().UnixMilli()) {
		return nil
	}
	if assignment.SlotType == "logOutput" {
		plan.LogOutputs = append(plan.LogOutputs, LogOutputAssignment{
			ID:          assignment.ID,
			Order:       assignment.Order,
			Enabled:     assignment.Enabled,
			NodeEnabled: assignment.NodeEnabled != nil && *assignment.NodeEnabled,
			Config:      assignment.Config,
			CreatedAt:   assignment.CreatedAt,
		})
		return nil
	}
	if assignment.RuleID == nil {
		return fmt.Errorf("assignment %s has no rule_id", assignment.ID)
	}
	query := db.Where("id = ? AND status = ?", *assignment.RuleID, true)
	switch assignment.SlotType {
	case "requestModify":
		var rule model.RewriteRule
		if err := query.First(&rule).Error; err != nil {
			return assignedRuleError(assignment, err)
		}
		plan.RewriteRules = append(plan.RewriteRules, &rule)
		chain, err := compileRewriteChain(rule.ID, rule.Script)
		if err != nil {
			return fmt.Errorf("compile rewrite rule %s (%s): %w", rule.ID, rule.Name, err)
		}
		plan.CompiledRewrite = append(plan.CompiledRewrite, CompiledRewriteChain{RuleID: rule.ID, RuleName: rule.Name, Ops: chain})
	case "responseModify":
		var rule model.ResponseRewriteRule
		if err := query.First(&rule).Error; err != nil {
			return assignedRuleError(assignment, err)
		}
		plan.ResponseRewriteRules = append(plan.ResponseRewriteRules, &rule)
		chain, err := compileRewriteChain(rule.ID, rule.Script)
		if err != nil {
			return fmt.Errorf("compile response rewrite rule %s (%s): %w", rule.ID, rule.Name, err)
		}
		plan.CompiledResponseRewrites = append(plan.CompiledResponseRewrites, CompiledRewriteChain{RuleID: rule.ID, RuleName: rule.Name, Ops: chain})
	case "concurrency":
		// 并行控制配置内联在 assignment.Config（与 logOutput 同级）：不再
		// 从规则表加载。一个提供者可挂多个并发节点，请求必须全部通过
		// （AND）。RuleID 为空/配置缺失时跳过该节点而不是拖垮整个计划。
		if assignment.Config == "" || assignment.Config == "{}" {
			log.Printf("relay: provider %s: concurrency assignment %s has no config; skipping", plan.Provider.ID, assignment.ID)
			return nil
		}
		rule, err := parseConcurrencyRuleConfig(assignment)
		if err != nil {
			log.Printf("relay: provider %s: concurrency assignment %s invalid config: %v; skipping", plan.Provider.ID, assignment.ID, err)
			return nil
		}
		plan.ConcurrencyRules = append(plan.ConcurrencyRules, rule)
	case "autoSwitch":
		var rule model.FailoverRule
		if err := query.First(&rule).Error; err != nil {
			return assignedRuleError(assignment, err)
		}
		plan.FailoverRules = append(plan.FailoverRules, &rule)
	default:
		return fmt.Errorf("assignment %s has invalid slot type %s", assignment.ID, assignment.SlotType)
	}
	return nil
}

func assignedRuleError(assignment model.TopologySlotAssignment, err error) error {
	return fmt.Errorf("resolve %s rule for assignment %s: %w", assignment.SlotType, assignment.ID, err)
}

// parseConcurrencyRuleConfig decodes the inline 并行控制 config stored on the
// topology assignment. Supported JSON shape (mirrors the frontend, no
// supplier dimension):
//
//	{
//	  "nodeId": "concurrency-abc",       // 幕后识别：from the flat slot node id
//	  "windowMinutes": 1,                // 每 X 分钟内
//	  "maxCount": 20,                    // 最多 N 条
//	}
func parseConcurrencyRuleConfig(assignment model.TopologySlotAssignment) (*ConcurrencyRule, error) {
	var cfg struct {
		NodeID        string `json:"nodeId"`
		WindowMinutes int    `json:"windowMinutes"`
		MaxCount      int    `json:"maxCount"`
	}
	if err := json.Unmarshal([]byte(assignment.Config), &cfg); err != nil {
		return nil, err
	}
	// Old topologies persisted `{"deadline_at": N}` for concurrency via
	// slotDeadlineConfig; treat that as "no window control".
	if cfg.WindowMinutes <= 0 || cfg.MaxCount <= 0 {
		return nil, fmt.Errorf("windowMinutes/maxCount must be positive")
	}
	nodeID := cfg.NodeID
	if nodeID == "" {
		nodeID = assignment.ID
	}
	return &ConcurrencyRule{
		ID:            nodeID,
		WindowMinutes: cfg.WindowMinutes,
		MaxCount:      cfg.MaxCount,
	}, nil
}

// decodeStringList unmarshals a JSON-encoded string array into the
// destination slice. It fails loudly on malformed JSON — the previous
// behaviour was silently producing an empty slice, which would surface
// later as a confusing "no base URL" error.
func decodeStringList(providerID, raw string, dst *[]string, field string) error {
	trimmed := jsonOrEmpty(raw)
	if err := json.Unmarshal([]byte(trimmed), dst); err != nil {
		return fmt.Errorf("provider %s: invalid JSON in %s: %w", providerID, field, err)
	}
	return nil
}

// decodeModelSet parses the provider Models JSON array (each entry has a
// "model" string) into a set for O(1) membership tests.
func decodeModelSet(providerID, raw string, dst *map[string]struct{}) error {
	trimmed := jsonOrEmpty(raw)
	if trimmed == "" {
		*dst = map[string]struct{}{}
		return nil
	}
	var entries []map[string]interface{}
	if err := json.Unmarshal([]byte(trimmed), &entries); err != nil {
		return fmt.Errorf("provider %s: invalid JSON in models: %w", providerID, err)
	}
	set := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		if name, ok := entry["model"].(string); ok && name != "" {
			set[name] = struct{}{}
		}
	}
	*dst = set
	return nil
}

// decodeEndpointSet parses the provider Endpoints JSON array (each entry has
// a "pathSuffix" string) into a set for O(1) membership tests. Unlike
// decodeStringList/decodeModelSet it is intentionally lenient: malformed
// JSON or unknown shapes collapse to an empty set, which the path filter
// treats as "any path allowed" (the historic behaviour in handler/relay.go
// before this pre-parse existed).
func decodeEndpointSet(providerID, raw string, dst *map[string]struct{}) error {
	set := map[string]struct{}{}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		*dst = set
		return nil
	}
	var entries []map[string]interface{}
	if err := json.Unmarshal([]byte(trimmed), &entries); err != nil {
		log.Printf("relay: provider %s: invalid JSON in endpoints, treating as unrestricted: %v", providerID, err)
		*dst = set
		return nil
	}
	for _, entry := range entries {
		if suffix, ok := entry["pathSuffix"].(string); ok {
			if s := strings.TrimSpace(suffix); s != "" {
				set[s] = struct{}{}
			}
		}
	}
	*dst = set
	return nil
}

// jsonOrEmpty normalizes an empty string to "[]" so the JSON parser doesn't
// reject it as invalid syntax. We keep the empty-string branch distinct in
// case callers want to know whether the field was provided.
func jsonOrEmpty(raw string) string {
	if raw == "" {
		return "[]"
	}
	return raw
}

// assignmentEffective reports whether a topology slot assignment is currently
// effective at plan time: the slot master switch (NodeEnabled) is on and any
// auto-off deadline stored in the assignment Config is still in the future.
func assignmentEffective(assignment model.TopologySlotAssignment, now int64) bool {
	if assignment.NodeEnabled != nil && !*assignment.NodeEnabled {
		return false
	}
	if assignment.Config == "" || assignment.Config == "{}" {
		return true
	}
	var cfg struct {
		DeadlineAt *int64 `json:"deadline_at"`
	}
	if err := json.Unmarshal([]byte(assignment.Config), &cfg); err != nil {
		return true
	}
	return cfg.DeadlineAt == nil || *cfg.DeadlineAt > now
}
