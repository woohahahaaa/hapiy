// Package affinity implements channel affinity: given a request's model,
// endpoint path, and the value of a configured affinity field (request header
// or JSON body path), it recalls the last provider+key+baseURL used for the
// same key. The design mirrors New API's channel affinity but stores a full
// triple (provider_id, key_index, base_url_index) instead of just a channel id.
package affinity

import (
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

// SettingKey is the Setting table key under which the rule list is stored.
const SettingKey = "channel_affinity_rules"

// DefaultTTLSeconds is used when a rule does not set its own TTL.
const DefaultTTLSeconds = 1800 // 30 minutes

// KeySourceType enumerates where an affinity field value is read from.
type KeySourceType string

const (
	SourceRequestHeader KeySourceType = "request_header"
	SourceGJSON         KeySourceType = "gjson"
)

// KeySource describes one place to read the affinity value from a request.
type KeySource struct {
	Type KeySourceType `json:"type"`              // request_header | gjson
	Key  string        `json:"key,omitempty"`     // header name (request_header)
	Path string        `json:"path,omitempty"`    // gjson path into the request body (gjson)
}

// Rule is one channel-affinity matching rule.
type Rule struct {
	Name             string      `json:"name"`
	Enabled          bool        `json:"enabled"`
	ModelRegex       []string    `json:"model_regex"`       // match any => rule applies
	PathRegex        []string    `json:"path_regex"`        // request path; empty => not checked
	KeySources       []KeySource `json:"key_sources"`       // first non-empty value wins
	ValueRegex       string      `json:"value_regex,omitempty"` // optional filter on the extracted affinity value
	TTLSeconds       int         `json:"ttl_seconds,omitempty"`
	IncludeModelName bool        `json:"include_model_name"` // scope cache key by model
}

// AffinitySetting is the whole stored config (top-level switches + rules).
type AffinitySetting struct {
	Enabled           bool   `json:"enabled"`
	DefaultTTLSeconds int    `json:"default_ttl_seconds"`
	Rules             []Rule `json:"rules"`
}

// Triple is the recall target: which provider, and which key + baseURL within
// that provider. key_index/base_url_index are -1 when not part of the recall.
type Triple struct {
	ProviderName string `json:"provider_name"`
	KeyIndex     int    `json:"key_index"`      // -1 = any / rotate
	BaseURLIndex int    `json:"base_url_index"` // -1 = any / rotate
}

// CompileState precompiles rule regexes once so request-time matching is cheap.
type compiledRule struct {
	rule      Rule
	modelRe   []*regexp.Regexp
	pathRe    []*regexp.Regexp
	valueRe   *regexp.Regexp
}

// Store loads and saves the affinity setting from the Setting table.
type Store struct {
	db *gorm.DB
}

// NewStore builds a Store bound to a database.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// Load reads the current rule config (defaults when unset/invalid).
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

// Save persists the rule config to the Setting table.
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

// compileRule builds the compiled form of a rule, skipping invalid regexes.
func compileRule(r Rule) compiledRule {
	c := compiledRule{rule: r}
	for _, p := range r.ModelRegex {
		if re, err := regexp.Compile(p); err == nil {
			c.modelRe = append(c.modelRe, re)
		}
	}
	for _, p := range r.PathRegex {
		if re, err := regexp.Compile(p); err == nil {
			c.pathRe = append(c.pathRe, re)
		}
	}
	if r.ValueRegex != "" {
		if re, err := regexp.Compile(r.ValueRegex); err == nil {
			c.valueRe = re
		}
	}
	return c
}

// matchAny reports whether any compiled regex matches s.
func matchAny(res []*regexp.Regexp, s string) bool {
	if len(res) == 0 || s == "" {
		return false
	}
	for _, re := range res {
		if re.MatchString(s) {
			return true
		}
	}
	return false
}

// RuleCompiledSet precompiles rule regexes and holds the recall cache so
// request-time matching does no regex compilation.
type RuleCompiledSet struct {
	Enabled    bool
	DefaultTTL int
	rules      []compiledRule
	cache      *cache
}

// CompileRules builds a precompiled set from a setting.
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

func (cs *RuleCompiledSet) Record(ruleName string, includeModel bool, modelName, affinityValue string, t Triple, ttlSeconds int) string {
	if cs == nil || cs.cache == nil {
		return ""
	}
	ttl := ttlSeconds
	if ttl <= 0 {
		ttl = cs.DefaultTTL
	}
	key := buildCacheKey(ruleName, includeModel, modelName, affinityValue)
	cs.cache.Set(key, t, time.Duration(ttl)*time.Second)
	return key
}

func (cs *RuleCompiledSet) Delete(key string) {
	if cs == nil || cs.cache == nil {
		return
	}
	cs.cache.Delete(key)
}
