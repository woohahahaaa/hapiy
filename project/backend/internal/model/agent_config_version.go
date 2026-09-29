package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AgentConfigVersion is an archived snapshot of one AgentConfigFile's content.
// Snapshots are appended automatically after every live-file write (editor
// save / managed-provider sync) and by an explicit archive, so the history
// mirrors the file at each stable state. Content is stored in full so a
// version can be written back verbatim and is never serialized in list
// payloads (json:"-").
//
// The "current" state is not a stored row: it is derived from the live file,
// and is considered archived when it matches the newest snapshot (mirroring
// the topology version history).
type AgentConfigVersion struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	ConfigID  string    `gorm:"index;not null" json:"config_id"`
	Content   string    `gorm:"type:text" json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (v *AgentConfigVersion) BeforeCreate(tx *gorm.DB) error {
	if v.ID == "" {
		v.ID = uuid.New().String()
	}
	return nil
}
