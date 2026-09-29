package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AgentConfigVersion is an archived snapshot of one AgentConfigFile's content.
// A snapshot is appended every time the live file is written (editor save,
// managed-provider sync, or restore), so the history mirrors the file at each
// change. Content is stored in full so a version can be written back verbatim
// and is never serialized in list payloads (json:"-").
//
// SourceVersionID is empty for ordinary saves and set to the restored version's
// id when the snapshot was produced by a restore, so the timeline can show
// "restored from <time>".
type AgentConfigVersion struct {
	ID              string    `gorm:"primaryKey;type:uuid" json:"id"`
	ConfigID        string    `gorm:"index;not null" json:"config_id"`
	Content         string    `gorm:"type:text" json:"-"`
	SourceVersionID string    `gorm:"type:text" json:"source_version_id"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (v *AgentConfigVersion) BeforeCreate(tx *gorm.DB) error {
	if v.ID == "" {
		v.ID = uuid.New().String()
	}
	return nil
}
