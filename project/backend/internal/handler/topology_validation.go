package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

var topologyIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

var topologySlotRanks = map[string]int{
	"requestModify":  0,
	"responseModify": 1,
	"autoReply":      2,
	"concurrency":    3,
	"autoSwitch":     4,
	"logOutput":      5,
}

func validateTopologyDocument(db *gorm.DB, document TopologyDocument) ([]model.TopologySlotAssignment, error) {
	if document.SchemaVersion != topologySchemaVersion {
		return nil, fmt.Errorf("schema_version must be %d", topologySchemaVersion)
	}
	sortTopologySlots(document.Slots)
	seenIDs := make(map[string]struct{}, len(document.Slots))
	nextOrder := make(map[string]int)
	rows := make([]model.TopologySlotAssignment, 0, len(document.Slots))
	for _, slot := range document.Slots {
		if err := validateTopologySlot(db, slot, seenIDs, nextOrder); err != nil {
			return nil, err
		}
		config, err := canonicalTopologyConfig(slot)
		if err != nil {
			return nil, fmt.Errorf("slot %s: %w", slot.ID, err)
		}
		rows = append(rows, model.TopologySlotAssignment{
			ID: slot.ID, ChannelID: slot.ChannelID, SlotType: slot.SlotType,
			Order: slot.Order, Enabled: slot.Enabled, RuleID: slot.RuleID, Config: config,
		})
	}
	return rows, nil
}

func validateTopologySlot(db *gorm.DB, slot TopologySlot, seenIDs map[string]struct{}, nextOrder map[string]int) error {
	if !topologyIDPattern.MatchString(slot.ID) {
		return fmt.Errorf("slot id %q is invalid", slot.ID)
	}
	if _, exists := seenIDs[slot.ID]; exists {
		return fmt.Errorf("duplicate slot id %q", slot.ID)
	}
	seenIDs[slot.ID] = struct{}{}
	if !topologyIDPattern.MatchString(slot.ChannelID) {
		return fmt.Errorf("channel_id %q is invalid", slot.ChannelID)
	}
	if _, exists := topologySlotRanks[slot.SlotType]; !exists {
		return fmt.Errorf("slot %s has invalid slot_type %q", slot.ID, slot.SlotType)
	}
	key := slot.ChannelID + "\x00" + slot.SlotType
	expected := nextOrder[key] + 1
	if slot.Order != expected {
		return fmt.Errorf("slot %s order must be contiguous from 1", slot.ID)
	}
	nextOrder[key] = expected
	var channelCount int64
	if err := db.Model(&model.Channel{}).Where("id = ?", slot.ChannelID).Count(&channelCount).Error; err != nil {
		return fmt.Errorf("check channel %s: %w", slot.ChannelID, err)
	}
	if channelCount != 1 {
		return fmt.Errorf("slot %s references missing channel %s", slot.ID, slot.ChannelID)
	}
	return validateTopologyRule(db, slot)
}

func validateTopologyRule(db *gorm.DB, slot TopologySlot) error {
	if slot.SlotType == "logOutput" {
		if slot.RuleID != nil {
			return fmt.Errorf("slot %s logOutput rule_id must be null", slot.ID)
		}
		return nil
	}
	if slot.RuleID == nil || !topologyIDPattern.MatchString(*slot.RuleID) {
		return fmt.Errorf("slot %s requires a valid rule_id", slot.ID)
	}
	var count int64
	query := db.Where("id = ? AND status = ?", *slot.RuleID, true)
	var err error
	switch slot.SlotType {
	case "requestModify":
		err = query.Model(&model.RewriteRule{}).Count(&count).Error
	case "responseModify":
		err = query.Model(&model.ResponseRewriteRule{}).Count(&count).Error
	case "autoReply":
		err = query.Model(&model.HeartbeatRule{}).Count(&count).Error
	case "concurrency":
		err = query.Model(&model.ConcurrencyRule{}).Count(&count).Error
	case "autoSwitch":
		err = query.Model(&model.FailoverRule{}).Count(&count).Error
	}
	if err != nil {
		return fmt.Errorf("check rule %s: %w", *slot.RuleID, err)
	}
	if count != 1 {
		return fmt.Errorf("slot %s references missing or disabled %s rule %s", slot.ID, slot.SlotType, *slot.RuleID)
	}
	return nil
}

func canonicalTopologyConfig(slot TopologySlot) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(slot.Config))
	decoder.UseNumber()
	var config map[string]any
	if err := decoder.Decode(&config); err != nil {
		return "", fmt.Errorf("config must be an object: %w", err)
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return "", errors.New("config has trailing JSON value")
		}
		return "", fmt.Errorf("decode config trailing value: %w", err)
	}
	if slot.SlotType != "logOutput" {
		if len(config) != 0 {
			return "", errors.New("rule-backed config must be exactly {}")
		}
		return `{}`, nil
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

func validateLogOutputConfig(config map[string]any) error {
	stringEnums := map[string][]string{
		"log_target": {"file", "console", "both"},
		"log_level":  {"info", "warn", "error"},
	}
	stringFields := map[string]struct{}{"log_path": {}}
	boolFields := map[string]struct{}{
		"record_request_before": {}, "record_request_after": {},
		"record_response_before": {}, "record_response_after": {},
	}
	keys := make([]string, 0, len(config))
	for key := range config {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := config[key]
		if allowed, exists := stringEnums[key]; exists {
			text, ok := value.(string)
			if !ok || !containsString(allowed, text) {
				return fmt.Errorf("logOutput config %s is invalid", key)
			}
			continue
		}
		if _, exists := stringFields[key]; exists {
			if _, ok := value.(string); !ok {
				return fmt.Errorf("logOutput config %s must be a string", key)
			}
			continue
		}
		if _, exists := boolFields[key]; exists {
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("logOutput config %s must be a boolean", key)
			}
			continue
		}
		return fmt.Errorf("logOutput config contains unknown field %s", key)
	}
	return nil
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func slotRank(slotType string) int {
	if rank, exists := topologySlotRanks[slotType]; exists {
		return rank
	}
	return len(topologySlotRanks)
}
