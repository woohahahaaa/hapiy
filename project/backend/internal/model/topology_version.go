package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TopologyVersion is an archived snapshot of the topology document. The live
// topology is considered "archived" when the newest version's ConfigUpdatedAt
// matches the current TopologyConfig.UpdatedAt (every save recreates the config
// row, so UpdatedAt is a reliable per-save identity).
type TopologyVersion struct {
	ID              string    `gorm:"primaryKey;type:uuid" json:"id"`
	Nodes           string    `gorm:"type:text" json:"-"`
	ConfigUpdatedAt time.Time `gorm:"not null" json:"-"`
	WorkflowTotal   int       `gorm:"not null" json:"workflow_total"`
	WorkflowActive  int       `gorm:"not null" json:"workflow_active"`
	NodeCount       int       `gorm:"not null" json:"node_count"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (v *TopologyVersion) BeforeCreate(tx *gorm.DB) error {
	if v.ID == "" {
		v.ID = uuid.New().String()
	}
	return nil
}
