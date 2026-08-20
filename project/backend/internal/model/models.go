package model

import (
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
	Models          string    `gorm:"type:text" json:"models"` // JSON array
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
	ID               string    `gorm:"primaryKey;type:uuid" json:"id"`
	UserID           string    `json:"user_id"`
	TokenName        string    `json:"token_name"`
	ProviderName     string    `json:"provider_name"`
	ModelName        string    `json:"model_name"`
	Source           string    `json:"source"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	// Miss = written to cache; Hit = served from cache.
	PromptCacheMissTokens int `json:"prompt_cache_miss_tokens"`
	PromptCacheHitTokens  int `json:"prompt_cache_hit_tokens"`
	IsStream         bool      `json:"is_stream"`
	Quota            float64   `json:"quota"`
	// Currency is the billing currency this quota was computed in ("USD" or
	// "CNY"). Historical records keep the currency they were written with;
	// switching the global billing currency only affects new records.
	Currency         string    `json:"currency"`
	UseTime          int       `json:"use_time"` // milliseconds
	Status           string    `json:"status"`   // success / failed
	IP               string    `json:"ip"`
	RequestID        string    `json:"request_id"`
	ErrorMessage     string    `json:"error_message"`
	// Stage timings in milliseconds; nil means the stage does not apply.
	// ConnectMs: time from issuing the upstream request until its response
	// headers arrive. FirstByteMs: time from response headers until the first
	// body byte is read (streaming only). RequestRewriteMs / ResponseRewriteMs:
	// elapsed time of each rewrite pass (response rewrite only runs for
	// non-streaming responses).
	ConnectMs        *int      `json:"connect_ms,omitempty"`
	FirstByteMs      *int      `json:"first_byte_ms,omitempty"`
	RequestRewriteMs *int      `json:"request_rewrite_ms,omitempty"`
	ResponseRewriteMs *int     `json:"response_rewrite_ms,omitempty"`
	// StreamRewriteMs is the cumulative time spent rewriting individual
	// SSE events for streaming responses; nil when no streaming rewrite.
	StreamRewriteMs *int      `json:"stream_rewrite_ms,omitempty"`
	// QueueWaitMs is the time spent waiting for a concurrency slot before
	// the upstream request was issued; nil when no concurrency rule applies.
	QueueWaitMs      *int      `json:"queue_wait_ms,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
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
	ID              string `gorm:"primaryKey;type:uuid" json:"id"`
	Name            string `gorm:"not null" json:"name"`
	PrimaryProvider string `json:"primary_provider"`
	FallbackProvider string `json:"fallback_provider"`
	Condition       string `gorm:"default:'timeout'" json:"condition"`
	Status          bool   `gorm:"not null" json:"status"`
}

func (r *FailoverRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
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
	Endpoints       string    `gorm:"type:text" json:"endpoints"`        // JSON array
	ThinkingLevels  string    `gorm:"type:text" json:"thinking_levels"`  // JSON array
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
	ProviderID   *string   `gorm:"index" json:"provider_id"`  // for slot nodes: the parent provider id
	ModelHubID   *string   `json:"model_hub_id"`               // future use
	Name         string    `gorm:"not null" json:"name"`
	ProviderName *string   `json:"provider_name"`              // backend provider name when type=provider
	Payload      string    `gorm:"type:text" json:"payload"`   // free-form per-type JSON blob
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (n *TopologyNode) BeforeCreate(tx *gorm.DB) error {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}
	return nil
}
