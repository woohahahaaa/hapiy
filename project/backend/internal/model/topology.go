package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type TopologyState struct {
	ID            uint      `gorm:"primaryKey" json:"-"`
	SchemaVersion int       `gorm:"not null" json:"schema_version"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type TopologySlotAssignment struct {
	ID         string    `gorm:"primaryKey;type:text" json:"id"`
	ProviderID string    `gorm:"not null;index;uniqueIndex:idx_topology_slot_position" json:"provider_id"`
	SlotType   string    `gorm:"not null;uniqueIndex:idx_topology_slot_position" json:"slot_type"`
	Order      int       `gorm:"not null;uniqueIndex:idx_topology_slot_position" json:"order"`
	Enabled    bool      `gorm:"not null" json:"enabled"`
	RuleID     *string   `gorm:"type:text" json:"rule_id"`
	Name       string    `gorm:"type:text;not null;default:''" json:"name"`
	Config     string    `gorm:"type:text;not null" json:"-"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (a *TopologySlotAssignment) BeforeCreate(tx *gorm.DB) error {
	if a.ID == "" {
		a.ID = uuid.New().String()
	}
	return nil
}
