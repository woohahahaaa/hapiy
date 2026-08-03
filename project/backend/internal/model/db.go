package model

import (
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
		&Token{},
		&Log{},
		&RewriteRule{},
		&ResponseRewriteRule{},
		&HeartbeatRule{},
		&ConcurrencyRule{},
		&FailoverRule{},
		&TopologyConfig{},
		&TopologyNode{},
		&TopologyState{},
		&TopologySlotAssignment{},
		&TopologyVersion{},
		&PriceConfig{},
		&Setting{},
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
