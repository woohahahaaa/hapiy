package model

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func InitDB(path string) (*gorm.DB, error) {
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}
	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&User{},
		&Provider{},
		&AutoDisableState{},
		&Token{},
		&Log{},
		&UsageCounter{},
		&UsageStat{},
		&RewriteRule{},
		&ResponseRewriteRule{},
		&LayoutConfig{},
		&ConcurrencyRule{},
		&FailoverRule{},
		&TopologyConfig{},
		&TopologyNode{},
		&TopologyState{},
		&TopologySlotAssignment{},
		&TopologyVersion{},
		&LogCapture{},
		&Setting{},
		&BaseUrlPath{},
		&TableConfig{},
		&RequestChannelHistory{},
		&DisabledRecord{},
		&FailoverHitCounter{},
		&AgentTypeRule{},
		&AgentConfigFile{},
		&ManagedAgentProvider{},
		&AgentModelConfigSource{},
	)
}

// MigrateTopologySchema repairs database shapes that AutoMigrate cannot fix
// (AutoMigrate only adds columns; it never drops or renames them). The slot
// assignment table was originally keyed by channel_id, then migrated to
// provider_id. A legacy database still carries a NOT NULL channel_id column,
// which makes every insert fail with a NOT NULL constraint error.
func MigrateTopologySchema(db *gorm.DB) error {
	var found int64
	if err := db.Raw(`SELECT COUNT(*) FROM pragma_table_info('topology_slot_assignments') WHERE name = 'channel_id'`).Scan(&found).Error; err != nil {
		return fmt.Errorf("check topology_slot_assignments schema: %w", err)
	}
	if found == 0 {
		return nil
	}

	type legacySlot struct {
		ID         string
		ProviderID string
		SlotType   string
		Order      int
		Enabled    bool
		RuleID     *string
		Name       string
		Config     string
		CreatedAt  time.Time
		UpdatedAt  time.Time
	}
	var rows []legacySlot
	if err := db.Table("topology_slot_assignments").Find(&rows).Error; err != nil {
		return fmt.Errorf("snapshot topology assignments: %w", err)
	}
	if err := db.Migrator().DropTable(&TopologySlotAssignment{}); err != nil {
		return fmt.Errorf("drop legacy topology_slot_assignments: %w", err)
	}
	if err := db.AutoMigrate(&TopologySlotAssignment{}); err != nil {
		return fmt.Errorf("recreate topology_slot_assignments: %w", err)
	}
	if len(rows) > 0 {
		assignments := make([]TopologySlotAssignment, 0, len(rows))
		for _, row := range rows {
			if row.ProviderID == "" {
				continue
			}
			assignments = append(assignments, TopologySlotAssignment{
				ID:         row.ID,
				ProviderID: row.ProviderID,
				SlotType:   row.SlotType,
				Order:      row.Order,
				Enabled:    row.Enabled,
				RuleID:     row.RuleID,
				Name:       row.Name,
				Config:     row.Config,
				CreatedAt:  row.CreatedAt,
				UpdatedAt:  row.UpdatedAt,
			})
		}
		if len(assignments) > 0 {
			if err := db.Create(&assignments).Error; err != nil {
				return fmt.Errorf("restore topology assignments: %w", err)
			}
		}
	}
	return nil
}

// MigrateAutoDisableState transitions the automatic-disable source from the
// legacy dual-source design (ProviderDisableState table + providers.auto_disabled
// column) to the single AutoDisableState table. It is idempotent: on an
// already-migrated database (auto_disable_states present, legacy structures
// gone) it is a no-op. Legacy rows are folded into AutoDisableState first,
// deduped by the unique (provider_id, dimension, value) index, so no disable
// state is lost when the legacy structures are dropped.
func MigrateAutoDisableState(db *gorm.DB) error {
	if err := db.AutoMigrate(&AutoDisableState{}); err != nil {
		return fmt.Errorf("migrate auto_disable_states: %w", err)
	}

	// Fold legacy provider_disable_states rows into AutoDisableState. A row
	// that already exists in the new table is left untouched so re-running
	// this migration never clobbers current state.
	if db.Migrator().HasTable("provider_disable_states") {
		type legacyDisableState struct {
			ProviderID string
			Dimension  string
			Value      string
			Disabled   bool
		}
		var legacy []legacyDisableState
		if err := db.Table("provider_disable_states").Find(&legacy).Error; err != nil {
			return fmt.Errorf("snapshot provider_disable_states: %w", err)
		}
		for _, row := range legacy {
			if err := upsertAutoDisableState(db, AutoDisableState{
				ProviderID: row.ProviderID,
				Dimension:  row.Dimension,
				Value:      row.Value,
				Disabled:   row.Disabled,
			}); err != nil {
				return fmt.Errorf("fold provider_disable_states row %s/%s/%s: %w", row.ProviderID, row.Dimension, row.Value, err)
			}
		}
		if err := db.Migrator().DropTable("provider_disable_states"); err != nil {
			return fmt.Errorf("drop legacy provider_disable_states: %w", err)
		}
	}

	// Fold legacy providers.auto_disabled=1 flags into provider-dimension
	// AutoDisableState rows, then drop the column.
	if db.Migrator().HasColumn(&Provider{}, "auto_disabled") {
		var flagged []Provider
		if err := db.Table("providers").Where("auto_disabled = ?", true).Find(&flagged).Error; err != nil {
			return fmt.Errorf("snapshot providers.auto_disabled: %w", err)
		}
		for _, provider := range flagged {
			if err := upsertAutoDisableState(db, AutoDisableState{
				ProviderID: provider.ID,
				Dimension:  FailoverDimensionProvider,
				Value:      provider.ID,
				Disabled:   true,
			}); err != nil {
				return fmt.Errorf("fold providers.auto_disabled row %s: %w", provider.ID, err)
			}
		}
		if err := db.Migrator().DropColumn(&Provider{}, "auto_disabled"); err != nil {
			return fmt.Errorf("drop legacy providers.auto_disabled: %w", err)
		}
	}
	return nil
}

// upsertAutoDisableState inserts an AutoDisableState row unless one already
// exists for the (provider_id, dimension, value) triple.

// DropPriceConfigTable removes the retired 模型信息 table (per-model pricing
// & capability rows) from upgraded databases. The feature was replaced by
// per-provider models.dev references, so the table is intentionally dropped.
func DropPriceConfigTable(db *gorm.DB) error {
	if db.Migrator().HasTable("price_configs") {
		if err := db.Migrator().DropTable("price_configs"); err != nil {
			return fmt.Errorf("drop price_configs table: %w", err)
		}
	}
	return nil
}
func upsertAutoDisableState(db *gorm.DB, state AutoDisableState) error {
	var existing AutoDisableState
	err := db.Where("provider_id = ? AND dimension = ? AND value = ?", state.ProviderID, state.Dimension, state.Value).First(&existing).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return db.Create(&state).Error
}
