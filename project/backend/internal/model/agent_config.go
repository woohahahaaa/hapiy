package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AgentOsPaths — per-OS default config path templates for an agent type.
// Keys are "windows" and "mac"; paths may use env-var placeholders
// (%APPDATA%, %USERPROFILE%) on Windows and ~ / $HOME on macOS.
type AgentOsPaths struct {
	Windows string `json:"windows"` // e.g. `%USERPROFILE%\.config\opencode\opencode.json`
	Mac     string `json:"mac"`     // e.g. `~/.config/opencode/opencode.json`
}

// AgentTypeRule — an agent software type (e.g. "opencode") that owns
// config files managed through the dashboard ("管理规则"). The seeded
// default rows let the frontend dropdown work on a fresh database.
type AgentTypeRule struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name      string    `gorm:"uniqueIndex;not null" json:"name"`
	OsPaths   string    `gorm:"type:text" json:"-"` // JSON blob of AgentOsPaths
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// MarshalJSON embeds os_paths as a parsed object in the API response so the
// frontend can read per-OS path templates without re-parsing the blob.
func (r AgentTypeRule) MarshalJSON() ([]byte, error) {
	type alias AgentTypeRule
	p, _ := r.GetOsPaths()
	return json.Marshal(struct {
		alias
		OsPaths AgentOsPaths `json:"os_paths"`
	}{alias: alias(r), OsPaths: p})
}

// GetOsPaths parses the stored JSON blob back into a struct. An empty blob
// yields a zero-valued struct so callers can default it.
func (r *AgentTypeRule) GetOsPaths() (AgentOsPaths, error) {
	var p AgentOsPaths
	if r.OsPaths == "" {
		return p, nil
	}
	return p, json.Unmarshal([]byte(r.OsPaths), &p)
}

// SetOsPaths serializes the per-OS paths into the JSON blob persisted on
// the rule row.
func (r *AgentTypeRule) SetOsPaths(p AgentOsPaths) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	r.OsPaths = string(data)
	return nil
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

// builtinAgentRules are the agent types seeded into agent_type_rules when
// the table is empty. Operators can rename or edit them later; seeding only
// fills os_paths for rows that lack them, so user edits are never lost.
var builtinAgentRules = []struct {
	Name    string
	OsPaths AgentOsPaths
}{
	{
		Name: "opencode",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.config\opencode\opencode.json`,
			Mac:     `~/.config/opencode/opencode.json`,
		},
	},
	{
		Name: "WorkBuddy",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.workbuddy\models.json`,
			Mac:     `~/.workbuddy/models.json`,
		},
	},
	{
		Name: "ChatGPT",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.codex\config.toml`,
			Mac:     `~/.codex/config.toml`,
		},
	},
}

// EnsureDefaultAgentTypes seeds the agent_type_rules table with the
// built-in rules. Called right after AutoMigrate on startup; inserts the
// built-ins that are missing and back-fills os_paths when the stored rule
// exists but has none, so operator additions and edits are never
// overwritten.
func EnsureDefaultAgentTypes(db *gorm.DB) error {
	for _, want := range builtinAgentRules {
		var rule AgentTypeRule
		err := db.Where("name = ?", want.Name).First(&rule).Error
		switch {
		case err == nil:
			if rule.OsPaths != "" {
				continue
			}
			if err := rule.SetOsPaths(want.OsPaths); err != nil {
				return err
			}
			if err := db.Model(&rule).Update("os_paths", rule.OsPaths).Error; err != nil {
				return err
			}
			continue
		case err != gorm.ErrRecordNotFound:
			return err
		}
		rule = AgentTypeRule{Name: want.Name}
		if err := rule.SetOsPaths(want.OsPaths); err != nil {
			return err
		}
		if err := db.Create(&rule).Error; err != nil {
			return err
		}
	}
	return nil
}
