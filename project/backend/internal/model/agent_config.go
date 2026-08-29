package model

import (
	"encoding/json"
	"fmt"
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

// AgentJsonPaths — gjson expressions used to read providers and their
// models out of an agent's config file (see "管理模型"). ProviderPath
// should resolve to an object whose keys are provider ids; ModelPath is
// applied to each provider object to fetch its model map/array.
type AgentJsonPaths struct {
	Provider string `json:"provider"` // e.g. `provider` (opencode) or `models.providers` (openclaw)
	Model    string `json:"model"`    // e.g. `models` — relative to each provider object
}

// AgentTypeRule — an agent software type (e.g. "opencode") that owns
// config files managed through the dashboard ("管理规则"). The seeded
// default rows let the frontend dropdown work on a fresh database.
type AgentTypeRule struct {
	ID           string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name         string    `gorm:"uniqueIndex;not null" json:"name"`
	OsPaths      string    `gorm:"type:text" json:"-"`  // JSON blob of AgentOsPaths
	JsonPaths    string    `gorm:"type:text" json:"-"`  // JSON blob of AgentJsonPaths
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// MarshalJSON embeds os_paths and json_paths as parsed objects in the API
// response so the frontend can read per-OS path templates and the
// provider/model gjson paths without re-parsing the blobs.
func (r AgentTypeRule) MarshalJSON() ([]byte, error) {
	type alias AgentTypeRule
	p, _ := r.GetOsPaths()
	j, _ := r.GetJsonPaths()
	return json.Marshal(struct {
		alias
		OsPaths   AgentOsPaths   `json:"os_paths"`
		JsonPaths AgentJsonPaths `json:"json_paths"`
	}{alias: alias(r), OsPaths: p, JsonPaths: j})
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

// GetJsonPaths parses the stored JSON blob back into a struct. An empty
// blob yields a zero-valued struct so callers can default it.
func (r *AgentTypeRule) GetJsonPaths() (AgentJsonPaths, error) {
	var p AgentJsonPaths
	if r.JsonPaths == "" {
		return p, nil
	}
	return p, json.Unmarshal([]byte(r.JsonPaths), &p)
}

// SetJsonPaths serializes the gjson path pair into the JSON blob persisted
// on the rule row.
func (r *AgentTypeRule) SetJsonPaths(p AgentJsonPaths) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	r.JsonPaths = string(data)
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
	RecordName string    `gorm:"uniqueIndex;not null" json:"record_name"`
	AgentType  string    `gorm:"not null" json:"agent_type"`
	Mode       string    `gorm:"not null" json:"mode"` // "local" | "ssh"
	TargetOS   string    `gorm:"not null;default:''" json:"target_os"`
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
// fills os_paths and json_paths for rows that lack them, so user edits are
// never lost.
var builtinAgentRules = []struct {
	Name      string
	OsPaths   AgentOsPaths
	JsonPaths AgentJsonPaths
}{
	{
		Name: "opencode",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.config\opencode\opencode.json`,
			Mac:     `~/.config/opencode/opencode.json`,
		},
		JsonPaths: AgentJsonPaths{
			Provider: `provider`,
			Model:    `models`,
		},
	},
	{
		Name: "WorkBuddy",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.workbuddy\models.json`,
			Mac:     `~/.workbuddy/models.json`,
		},
		// WorkBuddy uses a flat `models` array keyed by `vendor`. The current
		// gjson design only walks provider objects with a sibling models key,
		// so the seeded paths stay empty until a vendor-grouping pass lands.
		JsonPaths: AgentJsonPaths{},
	},
	{
		Name: "ChatGPT",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.codex\config.toml`,
			Mac:     `~/.codex/config.toml`,
		},
		// Codex stores its config in TOML with a [model_providers.*] table
		// and no per-provider model list, so the seeded paths stay empty.
		JsonPaths: AgentJsonPaths{},
	},
	{
		Name: "openclaw",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.openclaw\openclaw.json`,
			Mac:     `~/.openclaw/openclaw.json`,
		},
		JsonPaths: AgentJsonPaths{
			Provider: `models.providers`,
			Model:    `models`,
		},
	},
}

// EnsureDefaultAgentTypes seeds the agent_type_rules table with the
// built-in rules. Called right after AutoMigrate on startup; inserts the
// built-ins that are missing and back-fills os_paths / json_paths when the
// stored rule exists but has none, so operator additions and edits are
// never overwritten.
func EnsureDefaultAgentTypes(db *gorm.DB) error {
	for _, want := range builtinAgentRules {
		var rule AgentTypeRule
		err := db.Where("name = ?", want.Name).First(&rule).Error
		switch {
		case err == nil:
			dirty := false
			if rule.OsPaths == "" {
				if err := rule.SetOsPaths(want.OsPaths); err != nil {
					return err
				}
				dirty = true
			}
			if rule.JsonPaths == "" {
				if err := rule.SetJsonPaths(want.JsonPaths); err != nil {
					return err
				}
				dirty = true
			}
			if !dirty {
				continue
			}
			if err := db.Model(&rule).Updates(map[string]any{
				"os_paths":   rule.OsPaths,
				"json_paths": rule.JsonPaths,
			}).Error; err != nil {
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
		if err := rule.SetJsonPaths(want.JsonPaths); err != nil {
			return err
		}
		if err := db.Create(&rule).Error; err != nil {
			return err
		}
	}
	return nil
}

// DeduplicateAgentConfigRecordNames renames duplicate takeover records
// (kept the oldest, appending " (2)", " (3)" … to the rest) so the
// RecordName unique index added by AutoMigrate can be created on databases
// that already accumulated duplicates. Called from main before AutoMigrate.
func DeduplicateAgentConfigRecordNames(db *gorm.DB) error {
	if !db.Migrator().HasTable(&AgentConfigFile{}) {
		return nil
	}
	type dupGroup struct {
		RecordName string
		Count      int
	}
	var groups []dupGroup
	if err := db.Model(&AgentConfigFile{}).
		Select("record_name, COUNT(*) AS count").
		Group("record_name").
		Having("COUNT(*) > 1").
		Scan(&groups).Error; err != nil {
		return err
	}
	for _, g := range groups {
		var rows []AgentConfigFile
		if err := db.Where("record_name = ?", g.RecordName).
			Order("created_at ASC, id ASC").
			Find(&rows).Error; err != nil {
			return err
		}
		// Keep the oldest as-is, rename the rest with a numeric suffix.
		for i := 1; i < len(rows); i++ {
			var newName string
			for suffix := i + 1; ; suffix++ {
				candidate := fmt.Sprintf("%s (%d)", rows[i].RecordName, suffix)
				var count int64
				if err := db.Model(&AgentConfigFile{}).Where("record_name = ?", candidate).Count(&count).Error; err != nil {
					return err
				}
				if count == 0 {
					newName = candidate
					break
				}
			}
			if err := db.Model(&rows[i]).Update("record_name", newName).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
