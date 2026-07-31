package relay

import (
	"sync"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

type ExecutionPlan struct {
	ID                   string
	Provider             *model.Provider
	RewriteRules         []*model.RewriteRule
	ResponseRewriteRules []*model.ResponseRewriteRule
	HeartbeatRule        *model.HeartbeatRule
	ConcurrencyRule      *model.ConcurrencyRule
	FailoverRules        []*model.FailoverRule
	LogOutputs           []LogOutputAssignment
	DebugEnabled         bool
	DebugFields          []string
}

type LogOutputAssignment struct {
	ID     string
	Order  int
	Config string
}

type topologyStage string

const (
	topologyStageRequestBefore   topologyStage = "request_before"
	topologyStageRequestAfter    topologyStage = "request_after"
	topologyStageResponseBefore  topologyStage = "response_before"
	topologyStageResponseRewrite topologyStage = "response_rewrite"
	topologyStageResponseAfter   topologyStage = "response_after"
)

type topologyStageEvent struct {
	Stage                topologyStage
	ResponseRewriteRules []*model.ResponseRewriteRule
	LogOutputs           []LogOutputAssignment
}

type Engine struct {
	db          *gorm.DB
	providers   map[string]*model.Provider
	plans       map[string]*ExecutionPlan
	plansMu     sync.RWMutex
	providersMu sync.RWMutex
	stopCh      chan struct{}

	topologyStageHook func(topologyStageEvent)
}

func NewEngine(db *gorm.DB) *Engine {
	return &Engine{
		db:        db,
		providers: make(map[string]*model.Provider),
		plans:     make(map[string]*ExecutionPlan),
		stopCh:    make(chan struct{}),
	}
}
