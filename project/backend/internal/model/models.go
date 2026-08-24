package model

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// User model
type User struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Username  string    `gorm:"uniqueIndex;not null" json:"username"`
	Password  string    `gorm:"not null" json:"-"`
	Role      string    `gorm:"default:'admin'" json:"role"`
	Status    bool      `gorm:"default:true" json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == "" {
		u.ID = uuid.New().String()
	}
	return nil
}

// Provider model (upstream API provider)
type Provider struct {
	ID              string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name            string    `gorm:"not null" json:"name"`
	BaseURLs        string    `gorm:"type:text" json:"base_urls"` // JSON array
	Keys            string    `gorm:"type:text" json:"keys"`      // JSON array
	Endpoints       string    `gorm:"type:text" json:"endpoints"` // JSON array
	Models          string    `gorm:"type:text" json:"models"`    // JSON array
	Status          bool      `gorm:"default:true" json:"status"`
	AutoDisabled    bool      `gorm:"default:false" json:"auto_disabled"`
	WorkflowEnabled bool      `gorm:"default:true" json:"workflow_enabled"`
	Weight          int       `gorm:"default:1" json:"weight"`
	Priority        int       `gorm:"default:0" json:"priority"`
	AutoBan         bool      `gorm:"default:true" json:"auto_ban"`
	Group           string    `gorm:"default:''" json:"group"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (p *Provider) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}

// Token model (downstream API key)
type Token struct {
	ID          string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name        string    `gorm:"not null" json:"name"`
	Key         string    `gorm:"uniqueIndex;not null" json:"key"`
	HistoryKeys string    `gorm:"type:text" json:"history_keys"` // JSON array
	Quota       *float64  `json:"quota"`
	UsedQuota   float64   `gorm:"default:0" json:"used_quota"`
	Status      bool      `gorm:"default:true" json:"status"`
	UserID      string    `json:"user_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (t *Token) BeforeCreate(tx *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	return nil
}

// Log model (usage log)
type Log struct {
	ID               string `gorm:"primaryKey;type:uuid" json:"id"`
	UserID           string `json:"user_id"`
	TokenName        string `json:"token_name"`
	ProviderName     string `json:"provider_name"`
	ModelName        string `json:"model_name"`
	Source           string `json:"source"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	// Miss = written to cache; Hit = served from cache.
	PromptCacheMissTokens int     `json:"prompt_cache_miss_tokens"`
	PromptCacheHitTokens  int     `json:"prompt_cache_hit_tokens"`
	IsStream              bool    `json:"is_stream"`
	Quota                 float64 `json:"quota"`
	// Currency is the billing currency this quota was computed in ("USD" or
	// "CNY"). Historical records keep the currency they were written with;
	// switching the global billing currency only affects new records.
	Currency     string `json:"currency"`
	UseTime      int    `json:"use_time"` // milliseconds
	Status       string `json:"status"` // success / failed
	// AffinityHit reports whether the provider was chosen via channel affinity
	// (fallback last-used channel or configured affinity rule), as opposed to plain
	// flat-topology weighted selection. Backfilled on the success path only.
	AffinityHit  bool   `json:"affinity_hit"`   // success / failed
	IP           string `json:"ip"`
	RequestID    string `json:"request_id"`
	ErrorMessage string `json:"error_message"`
	// Stage timings in milliseconds; nil means the stage does not apply.
	// ConnectMs: time from issuing the upstream request until its response
	// headers arrive. FirstByteMs: time from response headers until the first
	// body byte is read (streaming only). RequestRewriteMs / ResponseRewriteMs:
	// elapsed time of each rewrite pass (response rewrite only runs for
	// non-streaming responses).
	ConnectMs         *int `json:"connect_ms,omitempty"`
	FirstByteMs       *int `json:"first_byte_ms,omitempty"`
	RequestRewriteMs  *int `json:"request_rewrite_ms,omitempty"`
	ResponseRewriteMs *int `json:"response_rewrite_ms,omitempty"`
	// StreamRewriteMs is the cumulative time spent rewriting individual
	// SSE events for streaming responses; nil when no streaming rewrite.
	StreamRewriteMs *int `json:"stream_rewrite_ms,omitempty"`
	// QueueWaitMs is the time spent waiting for a concurrency slot before
	// the upstream request was issued; nil when no concurrency rule applies.
	QueueWaitMs *int `json:"queue_wait_ms,omitempty"`
	// UpstreamURL is the full URL (base URL + path) actually issued to the upstream; empty when the request never reached upstream.
	UpstreamURL string    `json:"upstream_url,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

func (l *Log) BeforeCreate(tx *gorm.DB) error {
	if l.ID == "" {
		l.ID = uuid.New().String()
	}
	return nil
}

// RewriteRule model
type RewriteRule struct {
	ID     string `gorm:"primaryKey;type:uuid" json:"id"`
	Name   string `gorm:"not null" json:"name"`
	Script string `gorm:"type:text" json:"script"`
	Status bool   `gorm:"not null" json:"status"`
}

func (r *RewriteRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// ResponseRewriteRule model
type ResponseRewriteRule struct {
	ID     string `gorm:"primaryKey;type:uuid" json:"id"`
	Name   string `gorm:"not null" json:"name"`
	Script string `gorm:"type:text" json:"script"`
	Status bool   `gorm:"not null" json:"status"`
}

func (r *ResponseRewriteRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// HeartbeatRule model
type HeartbeatRule struct {
	ID             string `gorm:"primaryKey;type:uuid" json:"id"`
	Name           string `gorm:"not null" json:"name"`
	MatchCondition string `gorm:"default:'*'" json:"match_condition"`
	ReplyContent   string `gorm:"not null" json:"reply_content"`
	Timeout        int    `gorm:"default:30" json:"timeout"`
	Status         bool   `gorm:"not null" json:"status"`
}

func (r *HeartbeatRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// ConcurrencyRule model
type ConcurrencyRule struct {
	ID            string `gorm:"primaryKey;type:uuid" json:"id"`
	Name          string `gorm:"not null" json:"name"`
	Scope         string `gorm:"default:'global'" json:"scope"`
	MaxConcurrent int    `gorm:"default:10" json:"max_concurrent"`
	QueueEnabled  bool   `gorm:"default:true" json:"queue_enabled"`
	Status        bool   `gorm:"not null" json:"status"`
}

func (r *ConcurrencyRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// FailoverRule model
type FailoverRule struct {
	ID               string           `gorm:"primaryKey;type:uuid" json:"id"`
	Name             string           `gorm:"not null" json:"name"`
	PrimaryProvider  string           `json:"primary_provider"`
	FallbackProvider string           `json:"fallback_provider"`
	Condition        string           `gorm:"default:'timeout'" json:"condition"`
	Status           bool             `gorm:"not null" json:"status"`
	Keywords         []string         `gorm:"serializer:json;type:text" json:"keywords"`
	Actions          []FailoverAction `gorm:"serializer:json;type:text" json:"actions"`

	// Single-action fields. When Dimension is set, runtime prefers these
	// over the legacy Actions array.
	Dimension     string   `gorm:"default:''" json:"dimension"`
	RetryCount    int      `gorm:"default:0" json:"retry_count"`
	AutoDisable   bool     `gorm:"default:true" json:"auto_disable"`
	MatchPatterns []string `gorm:"serializer:json;type:text" json:"match_patterns"`
	TTFBSeconds   int      `gorm:"default:0" json:"ttfb_seconds"`
}

type FailoverAction struct {
	Dimension        string `json:"dimension"`
	RetryCount       int    `json:"retry_count"`
	AutomaticPolling bool   `json:"automatic_polling"`
	AutoDisable      bool   `json:"auto_disable"`
}

const (
	FailoverDimensionBaseURL  = "base_url"
	FailoverDimensionKey      = "key"
	FailoverDimensionProvider = "provider"
)

// SingleAction returns the rule's effective single action, falling back
// to the first legacy Actions entry when the new fields are unset.
func (r *FailoverRule) SingleAction() (string, int, bool) {
	if r.Dimension != "" {
		retry := r.RetryCount
		if retry <= 0 {
			retry = 3
		}
		return r.Dimension, retry, r.AutoDisable
	}
	if len(r.Actions) == 0 {
		return "", 0, false
	}
	return r.Actions[0].Dimension, r.Actions[0].RetryCount, r.Actions[0].AutoDisable
}

// Normalize applies compatibility defaults to rows created before the richer
// failover payload existed. The action sequence is fixed and persisted in this
// order so runtime behavior remains deterministic.
func (r *FailoverRule) Normalize() {
	if r.Dimension != "" {
		return
	}
	if len(r.Actions) == 0 {
		r.Actions = []FailoverAction{
			{Dimension: FailoverDimensionBaseURL, RetryCount: 3, AutomaticPolling: true, AutoDisable: true},
			{Dimension: FailoverDimensionKey, RetryCount: 3, AutomaticPolling: true, AutoDisable: true},
			{Dimension: FailoverDimensionProvider, RetryCount: 3, AutomaticPolling: true, AutoDisable: true},
		}
	}
}

// Validate enforces the single-action contract: either Dimension is set
// or at most one legacy Actions entry exists.
func (r *FailoverRule) Validate() error {
	if r.Dimension == "" && len(r.Actions) == 0 {
		return fmt.Errorf("failover rule must specify dimension or actions")
	}
	if r.Dimension != "" {
		switch r.Dimension {
		case FailoverDimensionBaseURL, FailoverDimensionKey, FailoverDimensionProvider:
		default:
			return fmt.Errorf("invalid failover dimension %q", r.Dimension)
		}
		if r.RetryCount < 0 {
			return fmt.Errorf("failover retry_count must be non-negative")
		}
		if r.TTFBSeconds < 0 {
			return fmt.Errorf("failover ttfb_seconds must be non-negative")
		}
		return nil
	}
	if len(r.Actions) > 1 {
		return fmt.Errorf("failover rule must contain exactly one action (got %d)", len(r.Actions))
	}
	return nil
}

func (r *FailoverRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	r.Normalize()
	return nil
}

// DisabledRecord captures the request that triggered an auto-disable so
// auto-recovery can replay it later. The unique index on
// (provider_id, dimension, value) dedupes repeated disables on the same
// entity: a second disable updates the row instead of inserting a new one.
// For key/base_url dimensions, the row carries the ProviderID so the
// recovery cascade can find sibling records that share the same
// provider or base URL.
type DisabledRecord struct {
	ID                string    `gorm:"primaryKey;type:uuid" json:"id"`
	ProviderID        string    `gorm:"not null;uniqueIndex:idx_dr_provider_dim_value" json:"provider_id"`
	Dimension         string    `gorm:"not null;uniqueIndex:idx_dr_provider_dim_value" json:"dimension"`
	Value             string    `gorm:"not null;uniqueIndex:idx_dr_provider_dim_value" json:"value"`
	RequestHeaders    string    `gorm:"type:text" json:"request_headers"`
	RequestBody       string    `gorm:"type:text" json:"request_body"`
	ErrorMessage      string    `gorm:"type:text" json:"error_message"`
	DisabledAt        time.Time `gorm:"index" json:"disabled_at"`
	LastRetryAt       *time.Time `json:"last_retry_at"`
	RetryCount        int        `json:"retry_count"`
	ResolvedAt        *time.Time `json:"resolved_at"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (r *DisabledRecord) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	if r.DisabledAt.IsZero() {
		r.DisabledAt = time.Now()
	}
	return nil
}

func (r *FailoverRule) BeforeSave(tx *gorm.DB) error {
	r.Normalize()
	return nil
}

func (r *FailoverRule) AfterFind(tx *gorm.DB) error {
	r.Normalize()
	return nil
}

// ProviderDisableState is the persisted, global automatic-disable state for
// a provider, a single base URL, or a single API key. Provider BaseURLs and
// Keys deliberately remain their legacy JSON arrays.
type ProviderDisableState struct {
	ID         string    `gorm:"primaryKey;type:uuid" json:"id"`
	ProviderID string    `gorm:"not null;uniqueIndex:idx_provider_disable_dimension_value" json:"provider_id"`
	Dimension  string    `gorm:"not null;uniqueIndex:idx_provider_disable_dimension_value" json:"dimension"`
	Value      string    `gorm:"not null;uniqueIndex:idx_provider_disable_dimension_value" json:"value"`
	Disabled   bool      `gorm:"not null;default:false" json:"disabled"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (s *ProviderDisableState) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}

// TopologyConfig model (stores node graph configuration)
type TopologyConfig struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Version   int       `gorm:"default:1" json:"version"`
	Nodes     string    `gorm:"type:text" json:"nodes"` // JSON array of nodes
	Edges     string    `gorm:"type:text" json:"edges"` // JSON array of edges
	Flat      string    `gorm:"type:text" json:"flat"`  // JSON flat topology (nodes + wires)
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RequestChannelHistory remembers which channel was last used for a
// (session_id, model) pair, used by the fallback channel affinity feature.
type RequestChannelHistory struct {
	ID            string    `gorm:"primaryKey;type:uuid" json:"id"`
	SessionID     string    `gorm:"not null;uniqueIndex:idx_rch_session_model" json:"session_id"`
	Model         string    `gorm:"not null;uniqueIndex:idx_rch_session_model" json:"model"`
	ProviderID    string    `gorm:"not null" json:"provider_id"`
	KeyIndex      int       `gorm:"default:-1" json:"key_index"`
	BaseURLIndex  int       `gorm:"default:-1" json:"base_url_index"`
	LastUsedAt    time.Time `gorm:"index" json:"last_used_at"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (h *RequestChannelHistory) BeforeCreate(tx *gorm.DB) error {
	if h.ID == "" {
		h.ID = uuid.New().String()
	}
	if h.LastUsedAt.IsZero() {
		h.LastUsedAt = time.Now()
	}
	return nil
}

// PriceRule is a JSON sub-struct stored inside PriceConfig.Rules (not a table).
type PriceRule struct {
	Pattern    string  `json:"pattern"`
	Multiplier float64 `json:"multiplier"`
}

// PriceConfig model — per-model pricing; units are per 1M tokens.
type PriceConfig struct {
	ID              string    `gorm:"primaryKey;type:uuid" json:"id"`
	Model           string    `gorm:"uniqueIndex;not null" json:"model"`
	InputPrice      float64   `gorm:"default:0" json:"input_price"`
	OutputPrice     float64   `gorm:"default:0" json:"output_price"`
	CacheWritePrice float64   `gorm:"default:0" json:"cache_write_price"`
	CacheReadPrice  float64   `gorm:"default:0" json:"cache_read_price"`
	ContextLength   int       `gorm:"default:0" json:"context_length"`
	MaxToken        int       `gorm:"default:0" json:"max_token"`
	SupportedTypes  string    `gorm:"type:text" json:"supported_types"` // JSON array
	Aliases         string    `gorm:"type:text" json:"aliases"`         // JSON array
	Endpoints       string    `gorm:"type:text" json:"endpoints"`       // JSON array
	ThinkingLevels  string    `gorm:"type:text" json:"thinking_levels"` // JSON array
	Rate            string    `gorm:"type:text" json:"rate"`            // JSON array of PriceRule
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (p *PriceConfig) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}

// Setting model — key/value system settings
type Setting struct {
	Key   string `gorm:"primaryKey" json:"key"`
	Value string `gorm:"type:text" json:"value"`
}

// TableConfig — per-table column display config, shared across all clients.
// Width is a required user-provided value parsed client-side; this table only
// stores the resolved config blob.
type TableConfig struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	TableID   string    `gorm:"uniqueIndex;not null" json:"table_id"`
	Configs   string    `gorm:"type:text" json:"configs"` // JSON array of ColumnDisplayConfig
	UpdatedAt time.Time `json:"updated_at"`
}

func (t *TableConfig) BeforeCreate(tx *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	return nil
}

// BaseUrlPath model — display-only path names for the BaseURL settings page;
// never consulted by the relay, which reads the "__name" path convention directly.
type BaseUrlPath struct {
	ID        string `gorm:"primaryKey;type:uuid" json:"id"`
	Path      string `gorm:"not null;uniqueIndex" json:"path"`
	SortOrder int    `gorm:"not null" json:"sort_order"`
}

func (b *BaseUrlPath) BeforeCreate(tx *gorm.DB) error {
	if b.ID == "" {
		b.ID = uuid.New().String()
	}
	return nil
}

func (t *TopologyConfig) BeforeCreate(tx *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	return nil
}

// TopologyNode model — hard data of a topology node (id/type/parent/slot/payload).
// Positions are intentionally NOT stored; the frontend derives layout locally.
type TopologyNode struct {
	ID           string    `gorm:"primaryKey;type:uuid" json:"id"`
	Type         string    `gorm:"not null;index" json:"type"` // modelHub | provider | slot
	ParentID     *string   `gorm:"index" json:"parent_id"`     // for slot nodes: the provider id
	SlotType     *string   `json:"slot_type"`                  // requestModify / responseModify / autoReply / concurrency / autoSwitch / logOutput
	ProviderID   *string   `gorm:"index" json:"provider_id"`   // for slot nodes: the parent provider id
	ModelHubID   *string   `json:"model_hub_id"`               // future use
	Name         string    `gorm:"not null" json:"name"`
	ProviderName *string   `json:"provider_name"`            // backend provider name when type=provider
	Payload      string    `gorm:"type:text" json:"payload"` // free-form per-type JSON blob
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (n *TopologyNode) BeforeCreate(tx *gorm.DB) error {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}
	return nil
}
