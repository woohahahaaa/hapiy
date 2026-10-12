// Package affinity implements channel affinity: given a request's session
// id and model (each read from a list of header or gjson fields), it recalls
// the provider+key+baseURL that last served the same (session, model) pair,
// so follow-up requests of one conversation stick to the channel that
// already holds the upstream cache / session state.
package affinity

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/tidwall/gjson"
	"gorm.io/gorm"
)

const (
	// SettingKey is the Setting-table key the single global affinity
	// configuration is persisted under.
	SettingKey = "channel_affinity"
	// DefaultTTLSeconds is the cache lifetime used when the saved value is
	// missing or invalid.
	DefaultTTLSeconds = 1800
	// legacyRulesKey / legacyFallbackKey are the two settings the feature
	// was split across before the single-config merge. They are only read
	// (derived on load, never written) so an upgrade keeps whatever fields
	// were configured.
	legacyRulesKey    = "channel_affinity_rules"
	legacyFallbackKey = "channel_affinity_fallback"
)

// Setting is the persisted global channel-affinity configuration.
type Setting struct {
	Enabled         bool     `json:"enabled"`
	SessionIDFields []string `json:"session_id_fields"`
	ModelFields     []string `json:"model_fields"`
	TTLSeconds      int      `json:"ttl_seconds"`
}

// Request is the minimal view of an incoming relay request affinity needs
// to read field values from. Headers are matched case-insensitively.
type Request struct {
	Model   string
	Path    string
	Headers map[string]string
	Body    []byte
}

// Store loads/saves the singleton setting.
type Store struct{ db *gorm.DB }

// NewStore binds a Store to the database.
func NewStore(db *gorm.DB) *Store { return &Store{db: db} }

// Load returns the current setting. When the merged key has never been
// saved it is derived from the legacy rules/fallback settings instead.
func (s *Store) Load() (*Setting, error) {
	raw, err := service.GetSetting(s.db, SettingKey)
	if err != nil {
		return nil, err
	}
	if raw == "" {
		return s.loadLegacy()
	}
	var setting Setting
	if err := json.Unmarshal([]byte(raw), &setting); err != nil {
		return defaultSetting(), fmt.Errorf("decode affinity setting: %w", err)
	}
	normalize(&setting)
	return &setting, nil
}

// Save persists the setting.
func (s *Store) Save(setting *Setting) error {
	if setting == nil {
		setting = defaultSetting()
	}
	normalize(setting)
	raw, err := json.Marshal(setting)
	if err != nil {
		return fmt.Errorf("encode affinity setting: %w", err)
	}
	return s.db.Where("key = ?", SettingKey).
		Assign(model.Setting{Value: string(raw)}).
		FirstOrCreate(&model.Setting{Key: SettingKey}).Error
}

func defaultSetting() *Setting {
	return &Setting{Enabled: false, SessionIDFields: []string{}, ModelFields: []string{}, TTLSeconds: DefaultTTLSeconds}
}

func normalize(setting *Setting) {
	if setting.TTLSeconds <= 0 {
		setting.TTLSeconds = DefaultTTLSeconds
	}
	if setting.SessionIDFields == nil {
		setting.SessionIDFields = []string{}
	}
	if setting.ModelFields == nil {
		setting.ModelFields = []string{}
	}
}

// loadLegacy derives the merged setting from the pre-merge keys: the union
// of every enabled rule's fields plus the fallback fields, with the first
// enabled rule's TTL carried over. Derivation is idempotent and writes
// nothing; the merged key appears the first time the user saves.
func (s *Store) loadLegacy() (*Setting, error) {
	out := defaultSetting()

	raw, err := service.GetSetting(s.db, legacyRulesKey)
	if err != nil {
		return nil, err
	}
	if raw != "" {
		var legacy struct {
			DefaultTTLSeconds int `json:"default_ttl_seconds"`
			Rules             []struct {
				Enabled         bool     `json:"enabled"`
				SessionIDFields []string `json:"session_id_fields"`
				ModelFields     []string `json:"model_fields"`
				TTLSeconds      int      `json:"ttl_seconds"`
			} `json:"rules"`
		}
		if err := json.Unmarshal([]byte(raw), &legacy); err == nil {
			ruleTTL := 0
			for _, rule := range legacy.Rules {
				if !rule.Enabled {
					continue
				}
				out.Enabled = true
				out.SessionIDFields = appendUnique(out.SessionIDFields, rule.SessionIDFields)
				out.ModelFields = appendUnique(out.ModelFields, rule.ModelFields)
				if ruleTTL == 0 {
					ruleTTL = rule.TTLSeconds
					if ruleTTL <= 0 {
						ruleTTL = legacy.DefaultTTLSeconds
					}
				}
			}
			if ruleTTL > 0 {
				out.TTLSeconds = ruleTTL
			}
		}
	}

	raw, err = service.GetSetting(s.db, legacyFallbackKey)
	if err != nil {
		return nil, err
	}
	if raw != "" {
		var legacy struct {
			Enabled         bool     `json:"enabled"`
			SessionIDFields []string `json:"session_id_fields"`
			ModelFields     []string `json:"model_fields"`
		}
		if err := json.Unmarshal([]byte(raw), &legacy); err == nil && legacy.Enabled {
			out.Enabled = true
			out.SessionIDFields = appendUnique(out.SessionIDFields, legacy.SessionIDFields)
			out.ModelFields = appendUnique(out.ModelFields, legacy.ModelFields)
		}
	}

	normalize(out)
	return out, nil
}

func appendUnique(dst []string, items []string) []string {
	for _, item := range items {
		if item == "" {
			continue
		}
		seen := false
		for _, existing := range dst {
			if existing == item {
				seen = true
				break
			}
		}
		if !seen {
			dst = append(dst, item)
		}
	}
	return dst
}

// ExtractHeaderField reads the first non-empty value from request headers
// (case-insensitive). The body is never consulted.
func ExtractHeaderField(req *Request, fields []string) string {
	for _, name := range fields {
		if name == "" {
			continue
		}
		if v := headerValue(req.Headers, name); v != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// ExtractBodyField reads the first non-empty value from the request body
// via gjson paths. Headers are never consulted.
func ExtractBodyField(req *Request, fields []string) string {
	if len(req.Body) == 0 {
		return ""
	}
	for _, name := range fields {
		if name == "" {
			continue
		}
		res := gjson.GetBytes(req.Body, name)
		if !res.Exists() {
			continue
		}
		if s := strings.TrimSpace(res.String()); s != "" {
			return s
		}
	}
	return ""
}

// headerValue returns a header value case-insensitively.
func headerValue(headers map[string]string, name string) string {
	if v, ok := headers[name]; ok {
		return v
	}
	for k, v := range headers {
		if strings.EqualFold(k, name) {
			return v
		}
	}
	return ""
}
