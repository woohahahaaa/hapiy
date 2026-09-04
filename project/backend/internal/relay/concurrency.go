package relay

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/model"
)

// concurrencyQueueTimeout is the maximum time a request will wait for a
// concurrency slot before being rejected. User-confirmed semantics:
// "wait up to 30s, then reject". Tests override this var to shrink the
// window without changing the production contract.
var concurrencyQueueTimeout = 30 * time.Second

// ErrConcurrencyRejected is returned by RelayRequest when the concurrency
// rule has no queue capacity and the limit is reached. The handler maps
// this to HTTP 429. We use a sentinel so the handler can detect it with
// errors.As.
var ErrConcurrencyRejected = errors.New("concurrency limit exceeded")

// concurrencyLimiter is a buffered-channel semaphore for a single rule
// (or rule + scope-key combination). It is created on demand and lives
// as long as the rule does; publishPlans wipes the table entirely so
// stale rules never leak counters.
type concurrencyLimiter struct {
	mu     sync.Mutex
	sem    chan struct{}
	closed bool
}

func newConcurrencyLimiter(limit int) *concurrencyLimiter {
	if limit <= 0 {
		limit = 1
	}
	return &concurrencyLimiter{sem: make(chan struct{}, limit)}
}

// acquire reserves a slot. If queueing is enabled, the caller waits up
// to concurrencyQueueTimeout; otherwise it returns ErrConcurrencyRejected
// immediately. The caller MUST invoke the returned release function when
// the request finishes, regardless of success or failure.
func (c *concurrencyLimiter) acquire(ctx context.Context, queueEnabled bool) (release func(), err error) {
	select {
	case c.sem <- struct{}{}:
		return c.release, nil
	default:
	}
	if !queueEnabled {
		return nil, ErrConcurrencyRejected
	}
	timer := time.NewTimer(concurrencyQueueTimeout)
	defer timer.Stop()
	select {
	case c.sem <- struct{}{}:
		return c.release, nil
	case <-timer.C:
		return nil, ErrConcurrencyRejected
	case <-ctx.Done():
		return nil, ErrConcurrencyRejected
	}
}

func (c *concurrencyLimiter) release() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()
	// Non-blocking pop: the slot must exist because we only hand out
	// release() after a successful push.
	select {
	case <-c.sem:
	default:
	}
}

// close marks the limiter closed. Future acquire attempts will reject
// immediately. publishPlans calls this before removing the entry.
func (c *concurrencyLimiter) close() {
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
}

// limiterFor returns (or lazily creates) the concurrency limiter for the
// given rule scope-key. The key encodes both the rule ID and the per-user
// or per-token identity so global rules don't share waitlists with scoped
// ones.
func (e *Engine) limiterFor(rule *model.ConcurrencyRule, scopeKey string) *concurrencyLimiter {
	key := rule.ID + "\x00" + scopeKey
	if existing, ok := e.concurrencyLimiters.Load(key); ok {
		return existing.(*concurrencyLimiter)
	}
	cl := newConcurrencyLimiter(rule.MaxConcurrent)
	actual, _ := e.concurrencyLimiters.LoadOrStore(key, cl)
	return actual.(*concurrencyLimiter)
}

// checkConcurrency reserves a slot under the plan's ConcurrencyRule. The
// request's UserID and TokenID fields provide the per_user / per_token
// scope key. When the request finishes or fails, the caller MUST invoke
// the returned release function — RelayRequest does this around the
// relay pipeline.
func (e *Engine) checkConcurrency(ctx context.Context, rule *model.ConcurrencyRule, req *RelayRequest) (release func(), err error) {
	scopeKey := resolveScopeKey(rule, req)
	limiter := e.limiterFor(rule, scopeKey)
	if rule.QueueEnabled {
		common.Global().IncQueued()
	}
	release, err = limiter.acquire(ctx, rule.QueueEnabled)
	if err != nil {
		if rule.QueueEnabled {
			common.Global().DecQueued()
		}
		return nil, fmt.Errorf("concurrency rule %s: %w", rule.ID, err)
	}
	// Wrap release so the Queued counter is decremented exactly once on
	// the same goroutine that acquired the slot.
	if rule.QueueEnabled {
		prev := release
		release = func() {
			prev()
			common.Global().DecQueued()
		}
	}
	return release, nil
}

// resolveScopeKey picks the per_user / per_token identity from the
// request. Falls back to "global" so unscoped rules don't share waitlists.
func resolveScopeKey(rule *model.ConcurrencyRule, req *RelayRequest) string {
	switch rule.Scope {
	case "per_user":
		if req.UserID != "" {
			return "user:" + req.UserID
		}
	case "per_token":
		if req.TokenID != "" {
			return "token:" + req.TokenID
		}
	}
	return "global"
}
