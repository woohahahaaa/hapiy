package affinity

import (
	"encoding/json"
	"fmt"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/tidwall/gjson"
	"gorm.io/gorm"
)

// FallbackSettingKey is the Setting-table key under which the fallback
// affinity configuration is persisted (singleton row).
const FallbackSettingKey = "channel_affinity_fallback"

// FallbackSetting is the persisted configuration for the fallback
// channel-affinity feature. When Enabled, every request is matched
// against the history table on (SessionID, Model); if a record exists
// and its channel is still usable, that channel is reused. Otherwise
// the normal dispatch path runs.
type FallbackSetting struct {
	Enabled        bool     `json:"enabled"`
	SessionIDFields []string `json:"session_id_fields"`
	ModelFields     []string `json:"model_fields"`
}

// FallbackStore loads/saves the singleton fallback setting.
type FallbackStore struct {
	db *gorm.DB
}

// NewFallbackStore binds a Store to the database.
func NewFallbackStore(db *gorm.DB) *FallbackStore {
	return &FallbackStore{db: db}
}

// Load returns the current fallback setting (defaults when unset/invalid).
// The unset default is enabled=true so the feature is on out of the box;
// existing saved data is respected.
func (s *FallbackStore) Load() (*FallbackSetting, error) {
	raw, err := service.GetSetting(s.db, FallbackSettingKey)
	if err != nil {
		return nil, err
	}
	if raw == "" {
		return &FallbackSetting{Enabled: true, SessionIDFields: []string{}, ModelFields: []string{}}, nil
	}
	var setting FallbackSetting
	if err := json.Unmarshal([]byte(raw), &setting); err != nil {
		return &FallbackSetting{Enabled: true, SessionIDFields: []string{}, ModelFields: []string{}}, fmt.Errorf("decode fallback setting: %w", err)
	}
	if setting.SessionIDFields == nil {
		setting.SessionIDFields = []string{}
	}
	if setting.ModelFields == nil {
		setting.ModelFields = []string{}
	}
	return &setting, nil
}

// Save persists the setting and triggers the engine to refresh.
func (s *FallbackStore) Save(setting *FallbackSetting) error {
	if setting == nil {
		setting = &FallbackSetting{}
	}
	if setting.SessionIDFields == nil {
		setting.SessionIDFields = []string{}
	}
	if setting.ModelFields == nil {
		setting.ModelFields = []string{}
	}
	raw, err := json.Marshal(setting)
	if err != nil {
		return fmt.Errorf("encode fallback setting: %w", err)
	}
	return s.db.Where("key = ?", FallbackSettingKey).
		Assign(model.Setting{Value: string(raw)}).
		FirstOrCreate(&model.Setting{Key: FallbackSettingKey}).Error
}

// ExtractHeaderField reads the first non-empty value from request
// headers (case-insensitive). The body is never consulted.
func ExtractHeaderField(req *Request, fields []string) string {
	for _, name := range fields {
		if name == "" {
			continue
		}
		if v := headerValue(req.Headers, name); v != "" {
			return v
		}
	}
	return ""
}

// ExtractBodyField reads the first non-empty value from the request
// body via gjson paths. Headers are never consulted.
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
		if s := res.String(); s != "" {
			return s
		}
	}
	return ""
}
