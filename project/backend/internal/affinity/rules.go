// Package affinity implements channel affinity: given a request's
// session id, user id, and model (each read from a list of header or
// gjson fields), it recalls the last provider+key+baseURL used for the
// same tuple. Stores a full triple (provider_name, key_index,
// base_url_index) so the dispatcher can re-route.
package affinity

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

const (
	SettingKey          = "channel_affinity_rules"
	DefaultTTLSeconds   = 1800
)

// AffinitySetting is the persisted rule config.
type AffinitySetting struct {
	Enabled           bool   `json:"enabled"`
	DefaultTTLSeconds int    `json:"default_ttl_seconds"`
	Rules             []Rule `json:"rules"`
}

// Rule matches requests whose session id / model can be read from
// the configured field lists.
type Rule struct {
	Name           string   `json:"name"`
	Enabled        bool     `json:"enabled"`
	SessionIDFields []string `json:"session_id_fields"`
	ModelFields     []string `json:"model_fields"`
	TTLSeconds     int      `json:"ttl_seconds,omitempty"`
}

// Triple is the recall target.
type Triple struct {
	ProviderName string `json:"provider_name"`
	KeyIndex     int    `json:"key_index"`
	BaseURLIndex int    `json:"base_url_index"`
	// EntryID is the request entry whose workflow served the request.
	// Reuse is only honored for the same entry, so affinity never leaks
	// across workflows.
	EntryID string `json:"entry_id,omitempty"`
}

// compiledRule is the in-memory form. Sets are precomputed so request-
// time matching is O(1) per field.
type compiledRule struct {
	rule         Rule
	sessionIDSet map[string]struct{}
	modelSet     map[string]struct{}
}

type Store struct{ db *gorm.DB }

func NewStore(db *gorm.DB) *Store { return &Store{db: db} }

func (s *Store) Load() (*AffinitySetting, error) {
	raw, err := service.GetSetting(s.db, SettingKey)
	if err != nil {
		return nil, err
	}
	if raw == "" {
		return &AffinitySetting{Enabled: false, DefaultTTLSeconds: DefaultTTLSeconds, Rules: []Rule{}}, nil
	}
	var setting AffinitySetting
	if err := json.Unmarshal([]byte(raw), &setting); err != nil {
		return &AffinitySetting{Enabled: false, DefaultTTLSeconds: DefaultTTLSeconds, Rules: []Rule{}}, fmt.Errorf("decode affinity setting: %w", err)
	}
	if setting.DefaultTTLSeconds <= 0 {
		setting.DefaultTTLSeconds = DefaultTTLSeconds
	}
	if setting.Rules == nil {
		setting.Rules = []Rule{}
	}
	return &setting, nil
}

func (s *Store) Save(setting *AffinitySetting) error {
	if setting == nil {
		setting = &AffinitySetting{}
	}
	if setting.DefaultTTLSeconds <= 0 {
		setting.DefaultTTLSeconds = DefaultTTLSeconds
	}
	if setting.Rules == nil {
		setting.Rules = []Rule{}
	}
	raw, err := json.Marshal(setting)
	if err != nil {
		return fmt.Errorf("encode affinity setting: %w", err)
	}
	return s.db.Where("key = ?", SettingKey).
		Assign(model.Setting{Value: string(raw)}).
		FirstOrCreate(&model.Setting{Key: SettingKey}).Error
}

func compileRule(r Rule) compiledRule {
	return compiledRule{
		rule:         r,
		sessionIDSet: stringSet(r.SessionIDFields),
		modelSet:     stringSet(r.ModelFields),
	}
}

func stringSet(items []string) map[string]struct{} {
	if len(items) == 0 {
		return nil
	}
	out := make(map[string]struct{}, len(items))
	for _, s := range items {
		if s != "" {
			out[s] = struct{}{}
		}
	}
	return out
}

// RuleCompiledSet precompiles rules and holds the recall cache.
type RuleCompiledSet struct {
	Enabled    bool
	DefaultTTL int
	rules      []compiledRule
	cache      *cache
}

func CompileRules(s *AffinitySetting) *RuleCompiledSet {
	enabled := false
	cs := &RuleCompiledSet{DefaultTTL: DefaultTTLSeconds, cache: newCache()}
	if s != nil {
		if s.DefaultTTLSeconds > 0 {
			cs.DefaultTTL = s.DefaultTTLSeconds
		}
		for _, r := range s.Rules {
			if !r.Enabled {
				continue
			}
			enabled = true
			cs.rules = append(cs.rules, compileRule(r))
		}
	}
	cs.Enabled = enabled
	return cs
}

func (cs *RuleCompiledSet) cacheGet(key string) (Triple, bool) {
	if cs == nil || cs.cache == nil {
		return Triple{}, false
	}
	return cs.cache.Get(key)
}

// Record stores a successful affinity routing so the next matching
// request can recall it.
func (cs *RuleCompiledSet) Record(ruleName, sessionID, modelName string, t Triple, ttlSeconds int) string {
	if cs == nil || cs.cache == nil {
		return ""
	}
	ttl := ttlSeconds
	if ttl <= 0 {
		ttl = cs.DefaultTTL
	}
	key := buildCacheKey(ruleName, sessionID, modelName)
	cs.cache.Set(key, t, time.Duration(ttl)*time.Second)
	return key
}

func (cs *RuleCompiledSet) Delete(key string) {
	if cs == nil || cs.cache == nil {
		return
	}
	cs.cache.Delete(key)
}
