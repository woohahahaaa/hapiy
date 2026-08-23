package relay

import (
	"log"
	"sync"
	"time"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// ExecutionPlan is the in-memory compiled representation of a provider's
// runtime configuration. Everything heavy that the engine used to re-parse
// per request is captured here at plan build time:
//   - BaseURLs / Keys: pre-parsed from the JSON strings on the model row.
//   - ModelSet: pre-parsed from the Models JSON, allowing O(1) "supports
//     this model?" lookups in SelectProvider.
//   - AllowedPaths: pre-parsed from the Endpoints JSON; empty set means
//     "any path allowed", matching the convention in topology.ProviderRef.
//   - Compiled rewrite chains: validated []RewriteOp executed in order.
//   - bound FailoverRules: ready for runtime resolution.
type ExecutionPlan struct {
	ID                   string
	Provider             *model.Provider
	BaseURLs             []string
	Keys                 []string
	ModelSet             map[string]struct{}
	AllowedPaths         map[string]struct{}
	RewriteRules         []*model.RewriteRule
	CompiledRewrite      []CompiledRewriteChain
	ResponseRewriteRules []*model.ResponseRewriteRule
	CompiledResponseRewrites []CompiledRewriteChain
	HeartbeatRule        *model.HeartbeatRule
	ConcurrencyRule      *model.ConcurrencyRule
	FailoverRules        []*model.FailoverRule
	LogOutputs           []LogOutputAssignment
	DebugEnabled         bool
	DebugFields          []string
}

// LogOutputAssignment is a thin wrapper over a topology logOutput slot.
// Config is the raw JSON config blob stored on the TopologySlotAssignment.
// CreatedAt is the assignment row's creation time, used to auto-close the log
// node after AutoCloseMinutes.
type LogOutputAssignment struct {
	ID          string
	Order       int
	Enabled     bool
	NodeEnabled bool
	Config      string
	CreatedAt   time.Time
}

// LogOutputNodeConfig is the parsed logOutput node config. Enabled and
// DeadlineAt are slot-level (shared by every entry in the slot); Prefix and
// the record_* switches are per-entry and replicated across the cfg JSON.
//
// DeadlineAt is a Unix epoch in milliseconds, set when the user opens the
// slot with a timer. The engine treats it as an absolute wall-clock cutoff:
// once time.Now() exceeds it, runTopologyLogOutputs skips the assignment.
// Zero means "no timer set" — the slot stays open until manually closed.
type LogOutputNodeConfig struct {
	Enabled         bool   `json:"enabled"`
	Prefix          string `json:"prefix"`
	RecordRequest   bool   `json:"record_request"`
	RecordResponse  bool   `json:"record_response"`
	RecordSystem    bool   `json:"record_system"`
	DeadlineAt      int64  `json:"deadline_at,omitempty"`
}

// topologyStage labels where in the request pipeline a stage event fires.
type topologyStage string

const (
	topologyStageRequestBefore   topologyStage = "request_before"
	topologyStageRequestAfter    topologyStage = "request_after"
	topologyStageRelay           topologyStage = "relay"
	topologyStageResponseBefore  topologyStage = "response_before"
	topologyStageResponseRewrite topologyStage = "response_rewrite"
	topologyStageResponseAfter   topologyStage = "response_after"
)

// topologyStageEvent is the payload delivered to topologyStageHook. Hook
// consumers can use ProviderID + RequestID to correlate stage events with
// a single request as it flows through the provider node.
type topologyStageEvent struct {
	Stage                topologyStage
	ProviderID           string
	RequestID            string
	ResponseRewriteRules []*model.ResponseRewriteRule
	LogOutputs           []LogOutputAssignment
}

// Engine owns the compiled execution plans plus runtime concurrency state.
// concurrencyLimiters is keyed by ConcurrencyRule.ID (global) or by
// ConcurrencyRule.ID + "\x00" + scope-key (per_user / per_token). It is
// wiped whenever plans are republished so stale rules never leak counters.
type Engine struct {
	db          *gorm.DB
	providers   map[string]*model.Provider
	plans       map[string]*ExecutionPlan
	plansMu     sync.RWMutex
	providersMu sync.RWMutex
	stopCh      chan struct{}

	// concurrencyLimiters holds the runtime semaphore state per rule.
	// It is rebuilt in lockstep with the plans map to ensure stale rule
	// IDs don't continue to throttle new requests.
	concurrencyLimiters sync.Map // map[string]*concurrencyLimiter

	topologyStageHook func(topologyStageEvent)

	affinityMu sync.RWMutex
	affinity   *affinity.RuleCompiledSet

	fallbackMu     sync.RWMutex
	fallbackConfig *affinity.FallbackSetting
}

func NewEngine(db *gorm.DB) *Engine {
	e := &Engine{
		db:        db,
		providers: make(map[string]*model.Provider),
		plans:     make(map[string]*ExecutionPlan),
		stopCh:    make(chan struct{}),
	}
	e.ReloadAffinity()
	e.ReloadFallbackAffinity()
	return e
}

// Affinity returns the current compiled rule set; never nil (an empty set
// matches nothing), so callers can rely on non-nil checks.
func (e *Engine) Affinity() *affinity.RuleCompiledSet {
	e.affinityMu.RLock()
	defer e.affinityMu.RUnlock()
	return e.affinity
}

// ReloadAffinity reloads and compiles the rule set, then swaps it in.
func (e *Engine) ReloadAffinity() {
	var setting *affinity.AffinitySetting
	if e.db != nil {
		var err error
		setting, err = affinity.NewStore(e.db).Load()
		if err != nil {
			log.Printf("relay: failed to load affinity rules: %v", err)
			setting = &affinity.AffinitySetting{}
		}
	}
	compiled := affinity.CompileRules(setting)
	e.affinityMu.Lock()
	e.affinity = compiled
	e.affinityMu.Unlock()
}

// ReloadFallbackAffinity swaps in the current fallback setting.
func (e *Engine) ReloadFallbackAffinity() {
	var setting *affinity.FallbackSetting
	if e.db != nil {
		s, err := affinity.NewFallbackStore(e.db).Load()
		if err != nil {
			log.Printf("relay: failed to load fallback affinity: %v", err)
			s = &affinity.FallbackSetting{}
		}
		setting = s
	} else {
		setting = &affinity.FallbackSetting{}
	}
	e.fallbackMu.Lock()
	e.fallbackConfig = setting
	e.fallbackMu.Unlock()
}

// fallbackSetting returns the current fallback setting (safe copy).
func (e *Engine) fallbackSetting() *affinity.FallbackSetting {
	e.fallbackMu.RLock()
	defer e.fallbackMu.RUnlock()
	if e.fallbackConfig == nil {
		return &affinity.FallbackSetting{}
	}
	return e.fallbackConfig
}
