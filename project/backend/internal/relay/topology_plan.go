package relay

import (
	"fmt"

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

func (e *Engine) publishPlans(freshProviders map[string]*model.Provider, freshPlans map[string]*ExecutionPlan) {
	e.providersMu.Lock()
	e.plansMu.Lock()
	e.providers = freshProviders
	e.plans = freshPlans
	e.plansMu.Unlock()
	e.providersMu.Unlock()
}

func (e *Engine) populatePlan(db *gorm.DB, plan *ExecutionPlan) error {
	var assignments []model.TopologySlotAssignment
	orderClause := `CASE slot_type
		WHEN 'requestModify' THEN 0 WHEN 'responseModify' THEN 1
		WHEN 'autoReply' THEN 2 WHEN 'concurrency' THEN 3
		WHEN 'autoSwitch' THEN 4 WHEN 'logOutput' THEN 5 ELSE 6 END,
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
	if assignment.SlotType == "logOutput" {
		plan.LogOutputs = append(plan.LogOutputs, LogOutputAssignment{ID: assignment.ID, Order: assignment.Order, Config: assignment.Config})
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
	case "responseModify":
		var rule model.ResponseRewriteRule
		if err := query.First(&rule).Error; err != nil {
			return assignedRuleError(assignment, err)
		}
		plan.ResponseRewriteRules = append(plan.ResponseRewriteRules, &rule)
	case "autoReply":
		if plan.HeartbeatRule != nil {
			return fmt.Errorf("provider %s has multiple enabled autoReply assignments", plan.Provider.ID)
		}
		var rule model.HeartbeatRule
		if err := query.First(&rule).Error; err != nil {
			return assignedRuleError(assignment, err)
		}
		plan.HeartbeatRule = &rule
	case "concurrency":
		if plan.ConcurrencyRule != nil {
			return fmt.Errorf("provider %s has multiple enabled concurrency assignments", plan.Provider.ID)
		}
		var rule model.ConcurrencyRule
		if err := query.First(&rule).Error; err != nil {
			return assignedRuleError(assignment, err)
		}
		plan.ConcurrencyRule = &rule
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
