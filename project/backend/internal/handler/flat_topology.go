package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/topology"
	"gorm.io/gorm"
)

// GetFlatTopology returns the stored flat topology together with its version
// metadata, so clients can detect edits made from another tab.
func GetFlatTopology(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tp, meta, err := topology.NewStore(db).LoadWithMeta()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"nodes":      tp.Nodes,
			"wires":      tp.Wires,
			"version":    meta.Version,
			"updated_at": meta.UpdatedAt,
		}})
	}
}

// SaveFlatTopology validates and persists the flat topology, rebuilds the
// topology_slot_assignments table from the new Flat document in the same
// transaction, then refreshes the relay engine plans so dispatch uses the
// new wiring. Status codes:
//   - 400 invalid JSON body
//   - 422 validation or insert failure inside the transaction
//   - 200 success; if the engine refresh fails afterwards the save is still
//     considered successful (a warning is logged) — the assignments table is
//     already consistent with the Flat document.
func SaveFlatTopology(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		var tp topology.Topology
		if err := c.ShouldBindJSON(&tp); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var assignments []model.TopologySlotAssignment
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := topology.NewStore(tx).Save(&tp); err != nil {
				return err
			}
			if err := tx.Where("1 = 1").Delete(&model.TopologySlotAssignment{}).Error; err != nil {
				return fmt.Errorf("wipe topology assignments: %w", err)
			}
			derived, err := deriveFlatAssignments(tx, &tp)
			if err != nil {
				return err
			}
			assignments = derived
			if len(assignments) > 0 {
				if err := tx.Create(&assignments).Error; err != nil {
					return fmt.Errorf("insert topology assignments: %w", err)
				}
			}
			return nil
		})
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}

		if err := engine.RefreshPlans(); err != nil {
			log.Printf("flat-topology: engine refresh after save failed: %v", err)
		}

		store := topology.NewStore(db)
		_, meta, err := store.LoadWithMeta()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"nodes":      tp.Nodes,
			"wires":      tp.Wires,
			"version":    meta.Version,
			"updated_at": meta.UpdatedAt,
		}})
	}
}

// ValidateFlatTopology checks the flat topology for structural errors and
// duplicate-activation conflicts, returning the list of conflicts so the
// frontend can highlight them.
func ValidateFlatTopology(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tp, err := topology.NewStore(db).Load()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := topology.ValidateTopology(tp); err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": topology.FindDuplicateActivations(tp)})
	}
}

// flatSlotEntry mirrors the SlotEntry shape the frontend writes into
// FlatNode.Entries. The flat topology only forwards the engine-relevant
// fields (id, slotType, index, ruleId, enabled, config); logOutput
// additionally carries its configuration as flattened entry fields.
type flatSlotEntry struct {
	ID             string          `json:"id"`
	SlotType       string          `json:"slotType"`
	Index          int             `json:"index"`
	RuleID         *string         `json:"ruleId,omitempty"`
	Enabled        bool            `json:"enabled"`
	Prefix         string          `json:"prefix,omitempty"`
	RecordRequest  bool            `json:"recordRequest,omitempty"`
	RecordResponse bool            `json:"recordResponse,omitempty"`
	RecordSystem   bool            `json:"recordSystem,omitempty"`
	Config         json.RawMessage `json:"config,omitempty"`
}

// deriveFlatAssignments walks the Flat Topology and produces a normalized
// slice of TopologySlotAssignment rows that the relay engine consumes. It is
// called inside the SaveFlatTopology transaction; the caller has already
// wiped topology_slot_assignments.
//
// Behavior:
//   - Providers not found, or with Status=false / WorkflowEnabled=false, are
//     logged and skipped — their slot chain never produces assignments.
//   - Duplicate provider names are allowed: the FIRST provider node with a
//     given name contributes its enabled flag, later ones are forced to
//     Enabled=false (mirrors the OLD enabledByProviderName collapse).
//   - logOutput slots contribute rows with RuleID=nil and Config=entry.Config.
//   - For each (provider_id, slot_type) pair the entry's Index is honored when
//     free; on collision orders are bumped to the next free value so the
//     bulk insert never trips the UNIQUE INDEX
//     (provider_id, slot_type, order). This is the simpler of the two choices
//     the task offered (the alternative was to reject the save with 422).
//   - Entries whose RuleId is empty or whose rule is missing/disabled are
//     logged and skipped without erroring the save.
func deriveFlatAssignments(db *gorm.DB, tp *topology.Topology) ([]model.TopologySlotAssignment, error) {
	if tp == nil {
		return nil, nil
	}
	nodesByID := make(map[string]topology.FlatNode, len(tp.Nodes))
	for _, n := range tp.Nodes {
		nodesByID[n.ID] = n
	}
	seenName := map[string]bool{}
	nextOrder := map[string]int{}

	var rows []model.TopologySlotAssignment
	for _, n := range tp.Nodes {
		if n.Kind != topology.KindProvider {
			continue
		}
		var provider model.Provider
		if err := db.Where("name = ?", n.Name).First(&provider).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fmt.Errorf("lookup provider %q: %w", n.Name, err)
			}
			log.Printf("flat-topology: provider %q not found; skipping its slots", n.Name)
			continue
		}
		if !provider.Status || !provider.WorkflowEnabled {
			log.Printf("flat-topology: provider %q disabled (status=%v workflow_enabled=%v); skipping its slots",
				n.Name, provider.Status, provider.WorkflowEnabled)
			continue
		}
		providerEnabled := n.Enabled && !seenName[n.Name]
		seenName[n.Name] = true

		cur := n.ID
		visited := map[string]bool{cur: true}
		for {
			next := flatOutgoing(tp, cur)
			if next == "" || visited[next] {
				break
			}
			visited[next] = true
			node, ok := nodesByID[next]
			if !ok || node.Kind != topology.KindSlot || node.SlotType == "" {
				break
			}
			collectSlotEntries(db, &rows, node, provider.ID, providerEnabled, nextOrder)
			cur = next
		}
	}
	return rows, nil
}

// flatOutgoing returns the single target node id a wire leaves from, or "".
// Local copy of topology.outgoing so the handler package does not need to
// reach into topology's unexported helpers.
func flatOutgoing(tp *topology.Topology, id string) string {
	for _, w := range tp.Wires {
		if w.Source == id {
			return w.Target
		}
	}
	return ""
}

// collectSlotEntries parses a slot node's Entries and appends a row per entry
// to *rows. Bad entries (missing ruleId, missing rule, malformed JSON) are
// logged and skipped; never returns an error so a single bad entry can't
// fail the whole save.
func collectSlotEntries(db *gorm.DB, rows *[]model.TopologySlotAssignment, slot topology.FlatNode, providerID string, providerEnabled bool, nextOrder map[string]int) {
	if len(slot.Entries) == 0 || string(slot.Entries) == "null" {
		return
	}
	var entries []flatSlotEntry
	if err := json.Unmarshal(slot.Entries, &entries); err != nil {
		log.Printf("flat-topology: slot %s has malformed entries: %v; skipping slot", slot.ID, err)
		return
	}
	orderKey := providerID + "\x00" + slot.SlotType
	for _, e := range entries {
		order := e.Index
		if order <= nextOrder[orderKey] {
			order = nextOrder[orderKey] + 1
		}
		nextOrder[orderKey] = order

		entryEnabled := providerEnabled && e.Enabled

		if slot.SlotType == "logOutput" {
			// Per-entry fields (prefix, record_*) live on the entry; slot-level
			// state (enabled, deadlineAt) lives on the FlatNode. Pack both into
			// the Config JSON so the engine sees one shape.
			config := e.Config
			trimmed := bytes.TrimSpace(config)
			if len(trimmed) == 0 || string(trimmed) == "null" || string(trimmed) == "{}" {
				cfg := map[string]any{
					"enabled":         slot.Enabled,
					"prefix":          e.Prefix,
					"record_request":  e.RecordRequest,
					"record_response": e.RecordResponse,
					"record_system":   e.RecordSystem,
				}
				if slot.LogDeadlineAt != nil && *slot.LogDeadlineAt > 0 {
					cfg["deadline_at"] = *slot.LogDeadlineAt
				}
				if packed, err := json.Marshal(cfg); err == nil {
					config = packed
				} else {
					config = []byte("{}")
				}
			}
			nodeEnabled := slot.Enabled
			*rows = append(*rows, model.TopologySlotAssignment{
				ProviderID:  providerID,
				SlotType:    slot.SlotType,
				Order:       order,
				Enabled:     entryEnabled,
				NodeEnabled: &nodeEnabled,
				RuleID:      nil,
				Name:        "",
				Config:      string(config),
			})
			continue
		}

		if e.RuleID == nil || *e.RuleID == "" {
			log.Printf("flat-topology: slot %s entry %s has empty ruleId; skipping", slot.ID, e.ID)
			continue
		}
		ruleID := *e.RuleID
		if err := validateFlatRuleExists(db, slot.SlotType, ruleID); err != nil {
			log.Printf("flat-topology: slot %s entry %s rule %s invalid: %v; skipping", slot.ID, e.ID, ruleID, err)
			continue
		}
		*rows = append(*rows, model.TopologySlotAssignment{
			ProviderID: providerID,
			SlotType:   slot.SlotType,
			Order:      order,
			Enabled:    entryEnabled,
			RuleID:     &ruleID,
			Name:       "",
			Config:     "{}",
		})
	}
}

// validateFlatRuleExists returns nil iff the given rule exists with
// status=true in the table backing slotType.
func validateFlatRuleExists(db *gorm.DB, slotType, ruleID string) error {
	var count int64
	query := db.Where("id = ? AND status = ?", ruleID, true)
	switch slotType {
	case "requestModify":
		query.Model(&model.RewriteRule{}).Count(&count)
	case "responseModify":
		query.Model(&model.ResponseRewriteRule{}).Count(&count)
	case "autoReply":
		query.Model(&model.HeartbeatRule{}).Count(&count)
	case "concurrency":
		query.Model(&model.ConcurrencyRule{}).Count(&count)
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