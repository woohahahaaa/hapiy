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

// AgentRecommendation — one recommended field for an agent's provider or
// model config. Scope decides where the field is checked/applied:
// "provider" against the provider's other_fields, "model" against each
// model's config object. Key is a gjson path under that scope (single
// segment or dotted, no array wildcards); Recommended is the value to
// fill in when the user clicks "一键套用推荐值".
type AgentRecommendation struct {
	Scope        string `json:"scope"`         // "provider" | "model"
	Key          string `json:"key"`           // gjson path, e.g. "maxConcurrency" or "thinking.type"
	Description  string `json:"description"`   // human-readable meaning
	Type         string `json:"type"`          // "string" | "number" | "boolean" | "object" | "array"
	Recommended  any    `json:"recommended"`   // recommended value, or null when not filled
	Required     bool   `json:"required"`      // recommended to be present?
}

// AgentTypeRule — an agent software type (e.g. "opencode") that owns
// config files managed through the dashboard ("管理规则"). The seeded
// default rows let the frontend dropdown work on a fresh database.
type AgentTypeRule struct {
	ID              string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name            string    `gorm:"uniqueIndex;not null" json:"name"`
	OsPaths         string    `gorm:"type:text" json:"-"` // JSON blob of AgentOsPaths
	JsonPaths       string    `gorm:"type:text" json:"-"` // JSON blob of AgentJsonPaths
	Recommendations string    `gorm:"type:text" json:"-"` // JSON blob of []AgentRecommendation
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// MarshalJSON embeds os_paths, json_paths and recommendations as parsed
// objects in the API response so the frontend can read them without
// re-parsing the blobs.
func (r AgentTypeRule) MarshalJSON() ([]byte, error) {
	type alias AgentTypeRule
	p, _ := r.GetOsPaths()
	j, _ := r.GetJsonPaths()
	recs, _ := r.GetRecommendations()
	return json.Marshal(struct {
		alias
		OsPaths         AgentOsPaths         `json:"os_paths"`
		JsonPaths       AgentJsonPaths       `json:"json_paths"`
		Recommendations []AgentRecommendation `json:"recommendations"`
	}{alias: alias(r), OsPaths: p, JsonPaths: j, Recommendations: recs})
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

// GetRecommendations parses the stored JSON blob back into a slice. An
// empty blob yields a nil slice so callers can default it.
func (r *AgentTypeRule) GetRecommendations() ([]AgentRecommendation, error) {
	if r.Recommendations == "" {
		return nil, nil
	}
	var out []AgentRecommendation
	if err := json.Unmarshal([]byte(r.Recommendations), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// SetRecommendations serializes the structured schema into the JSON
// blob persisted on the rule row.
func (r *AgentTypeRule) SetRecommendations(recs []AgentRecommendation) error {
	if recs == nil {
		r.Recommendations = ""
		return nil
	}
	data, err := json.Marshal(recs)
	if err != nil {
		return err
	}
	r.Recommendations = string(data)
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
// the table is empty. Operators can rename or edit them later; seeding
// only fills os_paths, json_paths, and recommendations for rows that
// lack them, so user edits are never lost.
var builtinAgentRules = []struct {
	Name            string
	OsPaths         AgentOsPaths
	JsonPaths       AgentJsonPaths
	Recommendations []AgentRecommendation
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
		Recommendations: opencodeRecommendations,
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
		JsonPaths:       AgentJsonPaths{},
		Recommendations: nil,
	},
	{
		Name: "ChatGPT",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.codex\config.toml`,
			Mac:     `~/.codex/config.toml`,
		},
		// Codex stores its config in TOML with a [model_providers.*] table
		// and no per-provider model list, so the seeded paths stay empty.
		JsonPaths:       AgentJsonPaths{},
		Recommendations: nil,
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
		Recommendations: openclawRecommendations,
	},
}

// opencodeRecommendations are the recommended provider/model fields for
// opencode. Each entry is checked against the live config in the
// "管理模型" view and surfaced as a missing / mismatch / extra marker.
// Clicking "一键套用推荐值" writes the Recommended value into the file.
var opencodeRecommendations = []AgentRecommendation{
	{Scope: "provider", Key: "npm", Type: "string", Description: "AI SDK 适配器包名，决定下面 options / models 可用的字段（@ai-sdk/openai-compatible / openai / anthropic / google / amazon-bedrock / azure）", Required: true},
	{Scope: "provider", Key: "options.baseURL", Type: "string", Description: "API 端点（不填则走适配器默认）", Required: true},
	{Scope: "provider", Key: "options.apiKey", Type: "string", Description: "认证密钥", Required: true},
	{Scope: "provider", Key: "options.maxConcurrency", Type: "number", Description: "最大并发请求数", Recommended: 5},
	{Scope: "provider", Key: "options.timeout", Type: "number", Description: "请求超时（毫秒）。默认 300000，复杂任务建议拉长到 600000", Recommended: 600000},
	{Scope: "provider", Key: "options.chunkTimeout", Type: "number", Description: "流式响应 chunk 之间间隔超时（毫秒）", Recommended: 30000},
	{Scope: "provider", Key: "options.setCacheKey", Type: "boolean", Description: "是否强制为 provider 设置 cache key（开启可缓存优化）", Recommended: true},
	{Scope: "provider", Key: "options.thinking", Type: "object", Description: "思考模型配置：{ type: enabled }", Recommended: map[string]any{"type": "enabled"}},
	{Scope: "model", Key: "name", Type: "string", Description: "模型显示名"},
	{Scope: "model", Key: "limit.context", Type: "number", Description: "上下文 token 上限"},
	{Scope: "model", Key: "limit.output", Type: "number", Description: "输出 token 上限"},
}

// openclawRecommendations covers the JSON5-shaped providers block.
var openclawRecommendations = []AgentRecommendation{
	{Scope: "provider", Key: "baseUrl", Type: "string", Description: "API 端点", Required: true},
	{Scope: "provider", Key: "apiKey", Type: "string", Description: "认证密钥", Required: true},
	{Scope: "provider", Key: "api", Type: "string", Description: "API 协议（openai-completions / anthropic-messages / ...）", Recommended: "openai-completions"},
	{Scope: "model", Key: "id", Type: "string", Description: "模型 ID", Required: true},
	{Scope: "model", Key: "name", Type: "string", Description: "模型显示名"},
}

// EnsureDefaultAgentTypes seeds the agent_type_rules table with the
// built-in rules. Called right after AutoMigrate on startup; inserts the
// built-ins that are missing and back-fills os_paths / json_paths /
// notes / recommendations when the stored rule exists but has none. If
// a row has a json_paths blob that lacks the {provider_id} placeholder,
// the model_path is upgraded to the current full-path format so
// existing databases pick up the new convention on the next launch.
// User customizations are never overwritten.
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
			if rule.Recommendations == "" && want.Recommendations != nil {
				if err := rule.SetRecommendations(want.Recommendations); err != nil {
					return err
				}
				dirty = true
			} else if want.Recommendations != nil && recommendationsMissingLatestKeys(rule.Recommendations, want.Recommendations) {
				// Existing recommendations on a built-in rule predate the
				// current seed (e.g. a new field like setCacheKey was added).
				// Overwrite so the rule picks up the latest keys; users who
				// want to keep their old version can re-edit after the
				// restart.
				if err := rule.SetRecommendations(want.Recommendations); err != nil {
					return err
				}
				dirty = true
			}
			if !dirty {
				continue
			}
			if err := db.Model(&rule).Updates(map[string]any{
				"os_paths":        rule.OsPaths,
				"json_paths":      rule.JsonPaths,
				"recommendations": rule.Recommendations,
			}).Error; err != nil {
				return err
			}
			continue
		case err != gorm.ErrRecordNotFound:
			return err
		}
		rule = AgentTypeRule{
			Name: want.Name,
		}
		if err := rule.SetOsPaths(want.OsPaths); err != nil {
			return err
		}
		if err := rule.SetJsonPaths(want.JsonPaths); err != nil {
			return err
		}
		if err := rule.SetRecommendations(want.Recommendations); err != nil {
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
// recommendationsMissingLatestKeys reports whether any of the keys from
// `latest` are absent from `stored`. Used by EnsureDefaultAgentTypes to
// detect outdated built-in recommendations on existing rows (e.g. when a
// new field like setCacheKey is added to the seed) and refresh them
// without losing user-added custom rules.
func recommendationsMissingLatestKeys(stored string, latest []AgentRecommendation) bool {
	var parsed []AgentRecommendation
	if err := json.Unmarshal([]byte(stored), &parsed); err != nil {
		return true
	}
	have := make(map[string]bool, len(parsed))
	for _, r := range parsed {
		have[r.Key] = true
	}
	for _, r := range latest {
		if !have[r.Key] {
			return true
		}
	}
	return false
}

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
