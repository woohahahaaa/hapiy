package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

var topologySlotRanks = map[string]int{
	"requestModify":  0,
	"responseModify": 1,
	"concurrency":    2,
	"autoSwitch":     3,
	"logOutput":      4,
}

// validateTopologyDocument validates the user-supplied document and produces
// two outputs: the canonical document (with provider_id / rule_id / order
// backfilled) that is stored verbatim as the source of truth, and the
// normalized assignment rows that the relay engine consumes.
func validateTopologyDocument(db *gorm.DB, document TopologyDocument) (TopologyDocument, []model.TopologySlotAssignment, error) {
	canonical := make(TopologyDocument, 0, len(document))
	rows := make([]model.TopologySlotAssignment, 0)
	enabledByProviderName := make(map[string]int)
	for wi, workflow := range document {
		if len(workflow) == 0 {
			return nil, nil, fmt.Errorf("workflow %d is empty", wi+1)
		}
		providerNode := workflow[0]
		if providerNode.Type != "provider" {
			return nil, nil, fmt.Errorf("workflow %d first node must be provider, got %s", wi+1, providerNode.Type)
		}
		provider, err := resolveProvider(db, providerNode)
		if err != nil {
			return nil, nil, fmt.Errorf("workflow %d: %w", wi+1, err)
		}
		requestedEnabled := providerNode.Enabled == nil || *providerNode.Enabled
		keptEnabled := requestedEnabled
		if requestedEnabled && enabledByProviderName[provider.Name] >= 1 {
			keptEnabled = false
		}
		if keptEnabled {
			enabledByProviderName[provider.Name]++
		}
		canonicalWorkflow := []TopologyNode{{
			Type:       "provider",
			Name:       provider.Name,
			ProviderID: &provider.ID,
			Enabled:    &keptEnabled,
		}}
		nextOrder := make(map[string]int)
		for ni, node := range workflow[1:] {
			row, err := validateAndConvertNode(db, node, provider.ID, ni+1, nextOrder)
			if err != nil {
				return nil, nil, fmt.Errorf("workflow %d node %d: %w", wi+1, ni+2, err)
			}
			rows = append(rows, row)
			canonicalWorkflow = append(canonicalWorkflow, rowToNode(row))
		}
		canonical = append(canonical, canonicalWorkflow)
	}
	return canonical, rows, nil
}

func resolveProvider(db *gorm.DB, node TopologyNode) (*model.Provider, error) {
	if node.ProviderID != nil && *node.ProviderID != "" {
		var provider model.Provider
		if err := db.Where("id = ?", *node.ProviderID).First(&provider).Error; err != nil {
			return nil, fmt.Errorf("provider_id %s not found", *node.ProviderID)
		}
		return &provider, nil
	}
	var provider model.Provider
	if err := db.Where("name = ?", node.Name).First(&provider).Error; err != nil {
		return nil, fmt.Errorf("provider name %q not found", node.Name)
	}
	return &provider, nil
}

func rowToNode(row model.TopologySlotAssignment) TopologyNode {
	enabled := row.Enabled
	node := TopologyNode{
		Type:    row.SlotType,
		Name:    row.Name,
		Enabled: &enabled,
	}
	if row.RuleID != nil {
		rid := *row.RuleID
		node.RuleID = &rid
	}
	if row.SlotType != "logOutput" {
		order := row.Order
		node.Order = &order
	} else {
		node.Config = json.RawMessage(row.Config)
	}
	return node
}

func validateAndConvertNode(db *gorm.DB, node TopologyNode, providerID string, nodeIndex int, nextOrder map[string]int) (model.TopologySlotAssignment, error) {
	if _, exists := topologySlotRanks[node.Type]; !exists {
		return model.TopologySlotAssignment{}, fmt.Errorf("invalid node type %q", node.Type)
	}
	if node.Name == "" {
		return model.TopologySlotAssignment{}, fmt.Errorf("name is required")
	}
	row := model.TopologySlotAssignment{
		ProviderID: providerID,
		SlotType:   node.Type,
		Name:       node.Name,
	}
	if node.Enabled != nil {
		row.Enabled = *node.Enabled
	} else {
		row.Enabled = true
	}
	if node.Type == "logOutput" {
		config, err := validateLogOutputNode(node)
		if err != nil {
			return row, err
		}
		row.Config = config
		row.RuleID = nil
		// Multiple logOutput entries are allowed per provider; each needs a
		// unique order because (provider_id, slot_type, order) is unique.
		key := providerID + "\x00" + node.Type
		row.Order = nextOrder[key] + 1
		nextOrder[key] = row.Order
		return row, nil
	}
	if node.Type == "concurrency" {
		// 并行控制配置内联在节点 Config，不再关联规则表。
		config, err := validateConcurrencyNode(node)
		if err != nil {
			return row, err
		}
		row.Config = config
		row.RuleID = nil
		key := providerID + "\x00" + node.Type
		if node.Order != nil {
			row.Order = *node.Order
		} else {
			row.Order = nextOrder[key] + 1
		}
		nextOrder[providerID+"\x00"+node.Type] = row.Order
		return row, nil
	}
	ruleID, err := resolveRuleID(db, node)
	if err != nil {
		return row, err
	}
	row.RuleID = &ruleID
	if node.Order != nil {
		row.Order = *node.Order
	} else {
		key := providerID + "\x00" + node.Type
		row.Order = nextOrder[key] + 1
	}
	nextOrder[providerID+"\x00"+node.Type] = row.Order
	row.Config = "{}"
	return row, nil
}

func resolveRuleID(db *gorm.DB, node TopologyNode) (string, error) {
	if node.RuleID != nil && *node.RuleID != "" {
		ruleID := *node.RuleID
		if err := validateRuleExists(db, node.Type, ruleID); err != nil {
			return "", err
		}
		return ruleID, nil
	}
	return resolveRuleByName(db, node.Type, node.Name)
}

func resolveRuleByName(db *gorm.DB, slotType, name string) (string, error) {
	query := db.Where("name = ? AND status = ?", name, true)
	var id string
	var err error
	switch slotType {
	case "requestModify":
		var rule model.RewriteRule
		err = query.First(&rule).Error
		id = rule.ID
	case "responseModify":
		var rule model.ResponseRewriteRule
		err = query.First(&rule).Error
		id = rule.ID
	case "autoSwitch":
		var rule model.FailoverRule
		err = query.First(&rule).Error
		id = rule.ID
	default:
		return "", fmt.Errorf("cannot resolve rule for slot type %s", slotType)
	}
	if err != nil {
		return "", fmt.Errorf("%s rule name %q not found or disabled", slotType, name)
	}
	return id, nil
}

func validateRuleExists(db *gorm.DB, slotType, ruleID string) error {
	var count int64
	query := db.Where("id = ? AND status = ?", ruleID, true)
	switch slotType {
	case "requestModify":
		query.Model(&model.RewriteRule{}).Count(&count)
	case "responseModify":
		query.Model(&model.ResponseRewriteRule{}).Count(&count)
	case "autoSwitch":
		query.Model(&model.FailoverRule{}).Count(&count)
	default:
		return fmt.Errorf("unknown slot type %s", slotType)
	}
	if count != 1 {
		return fmt.Errorf("%s rule %s not found or disabled", slotType, ruleID)
	}
	return nil
}

func validateLogOutputNode(node TopologyNode) (string, error) {
	var config map[string]any
	if len(node.Config) > 0 {
		decoder := json.NewDecoder(bytes.NewReader(node.Config))
		decoder.UseNumber()
		if err := decoder.Decode(&config); err != nil {
			return "", fmt.Errorf("config must be an object: %w", err)
		}
	} else {
		config = map[string]any{}
	}
	if err := validateLogOutputConfig(config); err != nil {
		return "", err
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return "", fmt.Errorf("encode config: %w", err)
	}
	return string(encoded), nil
}

// validateConcurrencyNode validates the inline 并行控制 config carried by a
// concurrency node and returns the canonical JSON stored on the assignment.
// Any non-object config is rejected; missing windowMinutes/maxCount fall
// through to validation (the engine skips such nodes at plan build).
func validateConcurrencyNode(node TopologyNode) (string, error) {
	var config map[string]any
	if len(node.Config) > 0 {
		decoder := json.NewDecoder(bytes.NewReader(node.Config))
		decoder.UseNumber()
		if err := decoder.Decode(&config); err != nil {
			return "", fmt.Errorf("concurrency config must be an object: %w", err)
		}
	} else {
		config = map[string]any{}
	}
	for key, value := range config {
		switch key {
		case "windowMinutes", "maxCount":
			num, ok := value.(json.Number)
			if !ok {
				return "", fmt.Errorf("concurrency config %s must be an integer", key)
			}
			if n, err := num.Int64(); err != nil || n <= 0 {
				return "", fmt.Errorf("concurrency config %s must be a positive integer", key)
			}
		case "perProvider":
			if _, ok := value.(bool); !ok {
				return "", fmt.Errorf("concurrency config perProvider must be a boolean")
			}
		case "providers":
			if _, ok := value.([]any); !ok {
				return "", fmt.Errorf("concurrency config providers must be an array")
			}
		case "deadline_at":
			num, ok := value.(json.Number)
			if !ok {
				return "", fmt.Errorf("concurrency config deadline_at must be an integer")
			}
			if _, err := num.Int64(); err != nil {
				return "", fmt.Errorf("concurrency config deadline_at must be a valid epoch")
			}
		default:
			return "", fmt.Errorf("concurrency config contains unknown field %s", key)
		}
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return "", fmt.Errorf("encode concurrency config: %w", err)
	}
	return string(encoded), nil
}

func validateLogOutputConfig(config map[string]any) error {
	stringFields := map[string]struct{}{"prefix": {}}
	boolFields := map[string]struct{}{
		"record_request":           {},
		"record_modified_request":  {},
		"record_response":          {},
		"record_modified_response": {},
		"record_system":            {},
		"merge_stream":             {},
	}
	keys := make([]string, 0, len(config))
	for key := range config {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := config[key]
		if _, exists := stringFields[key]; exists {
			text, ok := value.(string)
			if !ok {
				return fmt.Errorf("logOutput config %s must be a string", key)
			}
			if key == "prefix" && strings.TrimSpace(text) == "" {
				return fmt.Errorf("logOutput config prefix must not be empty")
			}
			continue
		}
		if _, exists := boolFields[key]; exists {
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("logOutput config %s must be a boolean", key)
			}
			continue
		}
		if key == "auto_close_minutes" {
			num, ok := value.(json.Number)
			if !ok {
				return fmt.Errorf("logOutput config auto_close_minutes must be an integer")
			}
			n, err := num.Int64()
			if err != nil || n < 1 || n > 60 {
				return fmt.Errorf("logOutput config auto_close_minutes must be between 1 and 60")
			}
			continue
		}
		if key == "deadline_at" {
			num, ok := value.(json.Number)
			if !ok {
				return fmt.Errorf("logOutput config deadline_at must be an integer")
			}
			if _, err := num.Int64(); err != nil {
				return fmt.Errorf("logOutput config deadline_at must be a valid epoch")
			}
			continue
		}
		return fmt.Errorf("logOutput config contains unknown field %s", key)
	}
	return nil
}
