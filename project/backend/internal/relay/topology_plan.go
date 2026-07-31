package relay

import (
	"fmt"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

func (e *Engine) RefreshPlans() error {
	freshChannels, freshPlans, err := e.buildPlans(e.db)
	if err != nil {
		return err
	}
	e.publishPlans(freshChannels, freshPlans)
	return nil
}

func (e *Engine) PrepareTopologyRefresh(tx *gorm.DB) (func(), error) {
	freshChannels, freshPlans, err := e.buildPlans(tx)
	if err != nil {
		return nil, err
	}
	return func() { e.publishPlans(freshChannels, freshPlans) }, nil
}

func (e *Engine) buildPlans(db *gorm.DB) (map[string]*model.Channel, map[string]*ExecutionPlan, error) {
	var channels []model.Channel
	if err := db.Where("status = ?", true).Find(&channels).Error; err != nil {
		return nil, nil, fmt.Errorf("load enabled channels: %w", err)
	}
	freshChannels := make(map[string]*model.Channel, len(channels))
	freshPlans := make(map[string]*ExecutionPlan, len(channels))
	for i := range channels {
		channel := &channels[i]
		freshChannels[channel.ID] = channel
		plan := &ExecutionPlan{ID: channel.ID, Channel: channel}
		if err := e.populatePlan(db, plan); err != nil {
			return nil, nil, fmt.Errorf("compile plan for channel %s: %w", channel.ID, err)
		}
		freshPlans[channel.ID] = plan
	}
	return freshChannels, freshPlans, nil
}

func (e *Engine) publishPlans(freshChannels map[string]*model.Channel, freshPlans map[string]*ExecutionPlan) {
	e.channelsMu.Lock()
	e.plansMu.Lock()
	e.channels = freshChannels
	e.plans = freshPlans
	e.plansMu.Unlock()
	e.channelsMu.Unlock()
}

func (e *Engine) populatePlan(db *gorm.DB, plan *ExecutionPlan) error {
	var assignments []model.TopologySlotAssignment
	orderClause := `CASE slot_type
		WHEN 'requestModify' THEN 0 WHEN 'responseModify' THEN 1
		WHEN 'autoReply' THEN 2 WHEN 'concurrency' THEN 3
		WHEN 'autoSwitch' THEN 4 WHEN 'logOutput' THEN 5 ELSE 6 END,
		"order" ASC, id ASC`
	if err := db.Where("channel_id = ? AND enabled = ?", plan.Channel.ID, true).
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
			return fmt.Errorf("channel %s has multiple enabled autoReply assignments", plan.Channel.ID)
		}
		var rule model.HeartbeatRule
		if err := query.First(&rule).Error; err != nil {
			return assignedRuleError(assignment, err)
		}
		plan.HeartbeatRule = &rule
	case "concurrency":
		if plan.ConcurrencyRule != nil {
			return fmt.Errorf("channel %s has multiple enabled concurrency assignments", plan.Channel.ID)
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
