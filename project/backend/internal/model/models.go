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
	ID       string `gorm:"primaryKey;type:uuid" json:"id"`
	Name     string `gorm:"not null" json:"name"`
	BaseURLs string `gorm:"type:text" json:"base_urls"` // JSON array
	Keys     string `gorm:"type:text" json:"keys"`      // JSON array
	// KeyNotes is a JSON object mapping each API key to its optional user
	// remark. Purely informational; the relay never reads it.
	KeyNotes  string `gorm:"type:text" json:"key_notes"`
	Endpoints string `gorm:"type:text" json:"endpoints"` // JSON array
	Models    string `gorm:"type:text" json:"models"`    // JSON array
	Status    bool   `gorm:"default:true" json:"status"`
	// AutoDisabled is derived (not a column): the persisted automatic-disable
	// source is the auto_disable_states table. It is kept on the struct so the
	// API contract (auto_disabled in provider payloads) is preserved; callers
	// derive it from AutoDisableState before serializing.
	AutoDisabled    bool      `gorm:"-" json:"auto_disabled"`
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
	Currency string `json:"currency"`
	UseTime  int    `json:"use_time"` // milliseconds
	Status   string `json:"status"`   // success / failed
	// AffinityReuse records how much of the last channel-affinity channel was
	// reused on this request: empty when no affinity rule matched, otherwise
	// "none" / "partial" / "full" (see relay.AffinityReuse*).
	AffinityReuse string `json:"affinity_reuse"`
	// AffinityReuseParts is a comma-separated list of the channel dimensions
	// that were reused ("provider","baseurl","key"); empty when nothing was
	// reused or no affinity rule matched.
	AffinityReuseParts string `json:"affinity_reuse_parts"`
	IP                 string `json:"ip"`
	RequestID          string `json:"request_id"`
	ErrorMessage       string `json:"error_message"`
	// EventDetail is populated for event rows (auto-disable / auto-recover /
	// manual action / system admin) and explains which rule fired or which
	// action ran. Empty for request rows; historical rows stay empty
	// (no backfill).
	EventDetail string `gorm:"type:text" json:"event_detail,omitempty"`
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
	UpstreamURL string `json:"upstream_url,omitempty"`
	// ProviderKey is the actual provider key used to reach upstream; empty
	// when the request never reached upstream.
	ProviderKey string `json:"provider_key,omitempty"`
	// ProviderBaseURL is the actual provider base URL used to reach upstream;
	// empty when the request never reached upstream.
	ProviderBaseURL string    `json:"provider_base_url,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

func (l *Log) BeforeCreate(tx *gorm.DB) error {
	if l.ID == "" {
		l.ID = uuid.New().String()
	}
	return nil
}

// UsageCounter holds lifetime-aggregated usage stats, incremented each
// time a log row is flushed. Single row (id=1) in usage_counters. Fully
// decoupled from the logs table — clearing logs does not reset this;
// clearing this does not delete log rows. Historical aggregates from the
// logs table are NOT migrated: counters start fresh so subsequent totals
// stay in lockstep with the logs that produced them.
type UsageCounter struct {
	ID              uint      `gorm:"primaryKey" json:"-"`
	TotalRequests   int64     `json:"total_requests"`
	SuccessCount    int64     `json:"success_count"`
	FailedCount     int64     `json:"failed_count"`
	TotalTokens     int64     `json:"total_tokens"`
	PromptTokens    int64     `json:"prompt_tokens"`
	TotalCost       float64   `json:"total_cost"`
	CacheHitTokens  int64     `json:"cache_hit_tokens"`
	CacheMissTokens int64     `json:"cache_miss_tokens"`
	TotalUseTimeMs  int64     `json:"total_use_time_ms"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// UsageStat is the 活动监视 page's dedicated stats store: one row per
// flushed log batch, holding the batch's time and usage aggregates.
// Fully decoupled from the logs table — clearing 使用记录 never touches
// it — and wiped together with the lifetime UsageCounter by the 清空用量
// action, never by ClearLogs.
type UsageStat struct {
	ID              uint      `gorm:"primaryKey" json:"-"`
	TotalRequests   int64     `json:"total_requests"`
	SuccessCount    int64     `json:"success_count"`
	FailedCount     int64     `json:"failed_count"`
	TotalTokens     int64     `json:"total_tokens"`
	PromptTokens    int64     `json:"prompt_tokens"`
	TotalCost       float64   `json:"total_cost"`
	CacheHitTokens  int64     `json:"cache_hit_tokens"`
	CacheMissTokens int64     `json:"cache_miss_tokens"`
	TotalUseTimeMs  int64     `json:"total_use_time_ms"`
	CreatedAt       time.Time `gorm:"index" json:"created_at"`
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

// ConcurrencyWindowCounter is a transient per-bucket counter backing the
// sliding-window concurrency control. A row exists only while its workflow is
// running: rows are written (throttled) as requests enter/leave windows and
// wiped whenever plans are republished so a stopped topology never leaves
// stale counters behind.
//
// Bucket identity: (WorkflowID, NodeID, Provider). Provider is "*" for the
// merged window computed across suppliers; otherwise it is the id of the
// supplier whose separate window the row tracks (按供应商分别计算).
type ConcurrencyWindowCounter struct {
	ID              string    `gorm:"primaryKey;type:uuid" json:"id"`
	WorkflowID      string    `gorm:"index;size:64" json:"workflow_id"`
	NodeID          string    `gorm:"index;size:64" json:"node_id"`
	Provider        string    `gorm:"index;size:64" json:"provider"`
	MaxCount        int       `json:"max_count"`
	WindowMinutes   int       `json:"window_minutes"`
	WindowCount     int       `json:"window_count"`
	WindowStartedAt time.Time `json:"window_started_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (c *ConcurrencyWindowCounter) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.New().String()
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
	AutoDisable   bool     `gorm:"default:true" json:"auto_disable"`
	MatchPatterns []string `gorm:"serializer:json;type:text" json:"match_patterns"`
	TTFBSeconds   int      `gorm:"default:0" json:"ttfb_seconds"`
	// SpeedLimit is the minimum response speed in tokens per second
	// (total tokens over the full request duration, connect included).
	// 0 disables the speed check.
	SpeedLimit int `gorm:"default:0" json:"speed_limit"`

	// DisableThreshold counts rule hits before auto-disable fires;
	// 0 preserves legacy "disable on first match" behavior. DisableWindowMinutes
	// is the rolling window for those hits; 0 disables the time check.
	DisableThreshold     int `gorm:"default:0" json:"disable_threshold"`
	DisableWindowMinutes int `gorm:"default:0" json:"disable_window_minutes"`
}

type FailoverAction struct {
	Dimension        string `json:"dimension"`
	AutomaticPolling bool   `json:"automatic_polling"`
	AutoDisable      bool   `json:"auto_disable"`
}

const (
	FailoverDimensionBaseURL  = "base_url"
	FailoverDimensionKey      = "key"
	FailoverDimensionProvider = "provider"
)

// SingleAction returns the dimension the rule operates on and whether
// auto-disable is enabled. Falls back to the first legacy Actions
// entry when the new fields are unset.
func (r *FailoverRule) SingleAction() (string, bool) {
	if r.Dimension != "" {
		return r.Dimension, r.AutoDisable
	}
	if len(r.Actions) == 0 {
		return "", false
	}
	return r.Actions[0].Dimension, r.Actions[0].AutoDisable
}

// Normalize applies compatibility defaults to rows created before the richer
// failover payload existed. The action sequence is fixed and persisted in this
// order so runtime behavior remains deterministic. DisableThreshold is
// clamped to >= 1 so legacy rows with the default 0 are treated as the
// "disable on first match" baseline.
func (r *FailoverRule) Normalize() {
	if r.Dimension == "" && len(r.Actions) == 0 {
		r.Actions = []FailoverAction{
			{Dimension: FailoverDimensionBaseURL, AutomaticPolling: true, AutoDisable: true},
			{Dimension: FailoverDimensionKey, AutomaticPolling: true, AutoDisable: true},
			{Dimension: FailoverDimensionProvider, AutomaticPolling: true, AutoDisable: true},
		}
	}
	if r.DisableThreshold < 1 {
		r.DisableThreshold = 1
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
		if r.TTFBSeconds < 0 {
			return fmt.Errorf("failover ttfb_seconds must be non-negative")
		}
		if r.DisableThreshold < 1 {
			return fmt.Errorf("failover disable_threshold must be at least 1")
		}
		if r.DisableWindowMinutes < 0 {
			return fmt.Errorf("failover disable_window_minutes must be non-negative")
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
// DisabledRecord stores a captured request snapshot for the auto-recovery
// loop, plus the original (baseURL, key, model) used at the moment the
// request was disabled. Recovery probes use those recorded values instead
// of cross-combining against other entries — the original request was the
// one that reached (or tried to reach) the upstream, so its combo is the
// only one with a meaningful failure context.
type DisabledRecord struct {
	ID             string `gorm:"primaryKey;type:uuid" json:"id"`
	ProviderID     string `gorm:"not null;uniqueIndex:idx_dr_provider_dim_value" json:"provider_id"`
	Dimension      string `gorm:"not null;uniqueIndex:idx_dr_provider_dim_value" json:"dimension"`
	Value          string `gorm:"not null;uniqueIndex:idx_dr_provider_dim_value" json:"value"`
	BaseURL        string `gorm:"type:text" json:"base_url"`
	Key            string `gorm:"type:text" json:"key"`
	Model          string `gorm:"type:text" json:"model"`
	RequestHeaders string `gorm:"type:text" json:"request_headers"`
	RequestBody    string `gorm:"type:text" json:"request_body"`
	ErrorMessage   string `gorm:"type:text" json:"error_message"`
	// RuleID/RuleName snapshot the failover rule that caused the disable.
	// Recovery probes re-evaluate the (live) rule before recovering; when
	// the rule has been deleted the probe falls back to a connectivity
	// check only. RuleName is kept for display after the rule is gone.
	RuleID      string     `gorm:"default:''" json:"rule_id"`
	RuleName    string     `gorm:"default:''" json:"rule_name"`
	DisabledAt  time.Time  `gorm:"index" json:"disabled_at"`
	LastRetryAt *time.Time `json:"last_retry_at"`
	RetryCount  int        `json:"retry_count"`
	ResolvedAt  *time.Time `json:"resolved_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
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

// AutoDisableState is the single persisted source of automatic-disable state
// for a provider, a single base URL, or a single API key. It replaced the
// legacy dual-source design (ProviderDisableState table + providers.auto_disabled
// column): every dimension's disable flag lives here, deduped by the unique
// (provider_id, dimension, value) index. Provider.BaseURLs and Keys deliberately
// remain their legacy JSON arrays.
type AutoDisableState struct {
	ID         string    `gorm:"primaryKey;type:uuid" json:"id"`
	ProviderID string    `gorm:"not null;uniqueIndex:idx_auto_disable_dimension_value" json:"provider_id"`
	Dimension  string    `gorm:"not null;uniqueIndex:idx_auto_disable_dimension_value" json:"dimension"`
	Value      string    `gorm:"not null;uniqueIndex:idx_auto_disable_dimension_value" json:"value"`
	Disabled   bool      `gorm:"not null;default:false" json:"disabled"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (s *AutoDisableState) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}

// FailoverHitCounter tracks consecutive rule matches for one
// (provider_id, dimension, value) triple so the relay engine can decide
// when a rule's DisableThreshold has been reached inside its
// DisableWindowMinutes. Rows are dropped on success or manual restore
// to keep the table free of stale state.
type FailoverHitCounter struct {
	ID         string    `gorm:"primaryKey;type:uuid" json:"id"`
	ProviderID string    `gorm:"not null;uniqueIndex:idx_fhc_provider_dim_value" json:"provider_id"`
	Dimension  string    `gorm:"not null;uniqueIndex:idx_fhc_provider_dim_value" json:"dimension"`
	Value      string    `gorm:"not null;uniqueIndex:idx_fhc_provider_dim_value" json:"value"`
	HitCount   int       `gorm:"not null;default:1" json:"hit_count"`
	FirstHitAt time.Time `gorm:"index" json:"first_hit_at"`
	LastHitAt  time.Time `json:"last_hit_at"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (c *FailoverHitCounter) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.New().String()
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
	ID           string    `gorm:"primaryKey;type:uuid" json:"id"`
	SessionID    string    `gorm:"not null;uniqueIndex:idx_rch_session_model" json:"session_id"`
	Model        string    `gorm:"not null;uniqueIndex:idx_rch_session_model" json:"model"`
	ProviderID   string    `gorm:"not null" json:"provider_id"`
	KeyIndex     int       `json:"key_index"`
	BaseURLIndex int       `json:"base_url_index"`
	EntryID      string    `json:"entry_id"` // request entry the channel was used through; "" = legacy/unscoped
	LastUsedAt   time.Time `gorm:"index" json:"last_used_at"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
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
	SlotType     *string   `json:"slot_type"`                  // requestModify / responseModify / concurrency / autoSwitch / logOutput
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
