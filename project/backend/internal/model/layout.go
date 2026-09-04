package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LayoutConfig holds the persisted topology canvas layout — a single row
// keyed by a fixed ID. Layout is presentation state, not data: the Save
// path bumps Version on every write so frontend clients can detect edits
// made from another tab (same pattern as TopologyConfig).
type LayoutConfig struct {
	ID        string    `gorm:"primaryKey;type:uuid"`
	Version   int       `gorm:"default:1"`
	Layout    string    `gorm:"type:text"` // JSON blob: Record<nodeId, {x, y}>
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (l *LayoutConfig) BeforeCreate(tx *gorm.DB) error {
	if l.ID == "" {
		l.ID = uuid.New().String()
	}
	return nil
}
