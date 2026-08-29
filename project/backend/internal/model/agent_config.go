package model

import (
	"encoding/json"
	"fmt"
	"strings"
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
// must resolve to an object whose keys are provider ids. ModelPath is
// a full gjson path from the document root and supports the
// `{provider_id}` placeholder, which is substituted with the current
// provider key before each lookup. Writing the full path (rather than
// a fragment relative to each provider) lets the schema handle agents
// whose models live anywhere — under a provider, in a sibling list, or
// anywhere else reachable from the root.
type AgentJsonPaths struct {
	Provider string `json:"provider"` // e.g. `provider` (opencode)
	Model    string `json:"model"`    // e.g. `provider.{provider_id}.models`
}

// AgentTypeRule — an agent software type (e.g. "opencode") that owns
// config files managed through the dashboard ("管理规则"). The seeded
// default rows let the frontend dropdown work on a fresh database.
type AgentTypeRule struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name      string    `gorm:"uniqueIndex;not null" json:"name"`
	OsPaths   string    `gorm:"type:text" json:"-"` // JSON blob of AgentOsPaths
	JsonPaths string    `gorm:"type:text" json:"-"` // JSON blob of AgentJsonPaths
	Notes     string    `gorm:"type:text" json:"notes"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
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
// fills os_paths, json_paths, and notes for rows that lack them, so user
// edits are never lost.
var builtinAgentRules = []struct {
	Name      string
	OsPaths   AgentOsPaths
	JsonPaths AgentJsonPaths
	Notes     string
}{
	{
		Name: "opencode",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.config\opencode\opencode.json`,
			Mac:     `~/.config/opencode/opencode.json`,
		},
		JsonPaths: AgentJsonPaths{
			Provider: `provider`,
			Model:    `provider.{provider_id}.models`,
		},
		Notes: opencodeProviderNotes,
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
		Notes:     "",
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
		Notes:     "",
	},
	{
		Name: "openclaw",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.openclaw\openclaw.json`,
			Mac:     `~/.openclaw/openclaw.json`,
		},
		JsonPaths: AgentJsonPaths{
			Provider: `models.providers`,
			Model:    `models.providers.{provider_id}.models`,
		},
		Notes: "",
	},
}

// opencodeProviderNotes is the default documentation for the provider
// object in opencode.json/opencode.jsonc. It is pasted verbatim into the
// rule's notes field so users have a reference for the schema. Format is
// deliberately free-form until we settle on a richer structure.
const opencodeProviderNotes = `provider.<id> 对象支持的字段（参考 opencode 官方文档）：

- npm  string  AI SDK 适配器包名，决定下面 options / models 可用的字段
    常用取值：
      @ai-sdk/openai-compatible  任意兼容 OpenAI Chat Completions 的接口
      @ai-sdk/openai             OpenAI 官方
      @ai-sdk/anthropic          Anthropic Claude
      @ai-sdk/google             Google Gemini
      @ai-sdk/amazon-bedrock     AWS Bedrock
      @ai-sdk/azure              Azure OpenAI

- name  string  provider 在 UI 中的显示名（可省略，默认用 id）

- options  object  调用参数；键名随 npm 适配器变化，下面列出通用键
    baseURL        string   API 端点（不填则走适配器默认）
    apiKey         string   认证密钥
    maxConcurrency number   最大并发请求数
    timeout        number   请求超时（毫秒）
    thinking       object   思考模型配置：{ "type": "enabled" }
    ...其它 npm 专属字段

- models  object  model_id → 模型配置
    name           string   模型显示名
    limits         object   { context, output } token 上限
    ...其它 npm 专属字段
`

// EnsureDefaultAgentTypes seeds the agent_type_rules table with the
// built-in rules. Called right after AutoMigrate on startup; inserts the
// built-ins that are missing and back-fills os_paths / json_paths when
// the stored rule exists but has none. If a row has a json_paths blob
// that lacks the {provider_id} placeholder, the model_path is upgraded
// to the current full-path format so existing databases pick up the
// new convention on the next launch. User customizations (different
// name, different path templates, custom notes) are never overwritten.
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
			if rule.JsonPaths == "" || !strings.Contains(rule.JsonPaths, "{provider_id}") {
				if err := rule.SetJsonPaths(want.JsonPaths); err != nil {
					return err
				}
				dirty = true
			}
			if rule.Notes == "" && want.Notes != "" {
				rule.Notes = want.Notes
				dirty = true
			}
			if !dirty {
				continue
			}
			if err := db.Model(&rule).Updates(map[string]any{
				"os_paths":   rule.OsPaths,
				"json_paths": rule.JsonPaths,
				"notes":      rule.Notes,
			}).Error; err != nil {
				return err
			}
			continue
		case err != gorm.ErrRecordNotFound:
			return err
		}
		rule = AgentTypeRule{
			Name:  want.Name,
			Notes: want.Notes,
		}
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
