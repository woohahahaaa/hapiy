package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AgentTypeRule — an agent software type (e.g. "opencode") that owns
// config files managed through the dashboard ("管理规则"). The seeded
// default row lets the frontend dropdown work on a fresh database.
type AgentTypeRule struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name      string    `gorm:"uniqueIndex;not null" json:"name"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (r *AgentTypeRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// AgentConfigFile — a "接管配置文件" record binding an agent type to a
// config file (local path or SSH remote). Content is a local cache only
// (json:"-") so list payloads never carry it; read it through the
// GET/PUT /:id/content endpoints, which always re-read the live file.
// SshConfig is a JSON blob string (service.SshConfig), matching how
// other JSON blobs (e.g. Provider.Models) are stored.
type AgentConfigFile struct {
	ID         string    `gorm:"primaryKey;type:uuid" json:"id"`
	RecordName string    `gorm:"not null" json:"record_name"`
	AgentType  string    `gorm:"not null" json:"agent_type"`
	Mode       string    `gorm:"not null" json:"mode"` // "local" | "ssh"
	Path       string    `gorm:"not null" json:"path"`
	SshConfig  string    `gorm:"type:text" json:"ssh_config"` // JSON blob of service.SshConfig
	Content    string    `gorm:"type:text" json:"-"`          // local content cache, never serialized
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (f *AgentConfigFile) BeforeCreate(tx *gorm.DB) error {
	if f.ID == "" {
		f.ID = uuid.New().String()
	}
	return nil
}

// EnsureDefaultAgentTypes seeds the agent_type_rules table with the
// built-in "opencode" type when the table is empty. Called right after
// AutoMigrate on startup; only inserts when no rules exist so operator
// additions are never overwritten.
func EnsureDefaultAgentTypes(db *gorm.DB) error {
	var count int64
	if err := db.Model(&AgentTypeRule{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return db.Create(&AgentTypeRule{Name: "opencode"}).Error
}
