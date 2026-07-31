package model

import "time"

type TopologyState struct {
	ID            uint      `gorm:"primaryKey" json:"-"`
	SchemaVersion int       `gorm:"not null" json:"schema_version"`
	Revision      uint64    `gorm:"not null" json:"revision"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type TopologySlotAssignment struct {
	ID        string    `gorm:"primaryKey;type:text" json:"id"`
	ChannelID string    `gorm:"not null;index;uniqueIndex:idx_topology_slot_position" json:"channel_id"`
	SlotType  string    `gorm:"not null;uniqueIndex:idx_topology_slot_position" json:"slot_type"`
	Order     int       `gorm:"not null;uniqueIndex:idx_topology_slot_position" json:"order"`
	Enabled   bool      `gorm:"not null" json:"enabled"`
	RuleID    *string   `gorm:"type:text" json:"rule_id"`
	Config    string    `gorm:"type:text;not null" json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
