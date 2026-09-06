package relay

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/model"
)

// ErrConcurrencyRejected is returned by RelayRequest when a concurrency
// window cannot be acquired. With the "wait as long as it takes" contract
// the only way this fires is the bucket being closed by a plan refresh or
// the request context being cancelled while queued — never a voluntary
// timeout. The handler maps it to HTTP 429.
var ErrConcurrencyRejected = errors.New("concurrency limit exceeded")

// ConcurrencyRule is the compiled, inline concurrency config attached to a
// 并行控制 slot node. It replaces the old globally-managed concurrency rule:
// the parameters now live directly on the topology slot entry and are
// compiled into the provider's plan at plan build time. The rule applies a
// single shared sliding window to every request passing the node — no
// supplier dimension.
type ConcurrencyRule struct {
	ID            string // node id (assignment id) — bucket identity
	WindowMinutes int    // 每 X 分钟内 (countdown length after each finish)
	MaxCount      int    // 最多 N 条 (window capacity)
}

// windowBucket implements the sliding-window concurrency control.
//
// Semantics (user-confirmed):
//   - (a) 进入即计数: an acquired request occupies a slot from entry time.
//   - (b) 完成即倒计时: when the request finishes, release() schedules the
//     window countdown (WindowMinutes) from that finish moment; when it
//     expires the slot frees up and a parked waiter is woken.
//   - (c) 限额 + 排队: while active >= MaxCount the request parks (waits
//     forever — no timeout, no voluntary 429). It proceeds only when a slot
//     frees, or fails when the bucket closes / context cancels.
type windowBucket struct {
	mu     sync.Mutex
	window time.Duration
	max    int
	active int

	waiters []chan struct{}
	closed  bool

	stats    *Engine
	workflow string
	key      string
}

func newWindowBucket(window time.Duration, max int, e *Engine, workflow, key string) *windowBucket {
	return &windowBucket{window: window, max: max, stats: e, workflow: workflow, key: key}
}

// acquire parks until a slot is free, then reserves one and returns a release
// function that takes the request's finish moment. The caller MUST call the
// release exactly once; pass time.Time{} to count down from now. If the
// bucket is closed or the context is cancelled while waiting, it returns
// ErrConcurrencyRejected.
func (b *windowBucket) acquire(ctx context.Context) (release func(finish time.Time), err error) {
	for {
		b.mu.Lock()
		if b.closed {
			b.mu.Unlock()
			return nil, fmt.Errorf("concurrency %s: %w", b.key, ErrConcurrencyRejected)
		}
		if b.active < b.max {
			b.active++
			stats, workflow, key := b.stats, b.workflow, b.key
			active := b.active
			b.mu.Unlock()
			stats.recordConcurrencyStats(workflow, key, int(b.window.Minutes()), b.max, active)
			return func(finish time.Time) {
				if finish.IsZero() {
					finish = time.Now()
				}
				countdown := b.window
				scheduled := time.Until(finish) + countdown
				if scheduled < 0 {
					scheduled = 0
				}
				time.AfterFunc(scheduled, b.popAndWake)
			}, nil
		}
		ch := make(chan struct{})
		b.waiters = append(b.waiters, ch)
		b.mu.Unlock()
		common.Global().IncQueued()
		select {
		case <-ch:
			common.Global().DecQueued()
		case <-ctx.Done():
			common.Global().DecQueued()
			b.removeWaiter(ch)
			return nil, fmt.Errorf("concurrency %s: %w", b.key, ErrConcurrencyRejected)
		}
	}
}

// popAndWake decrements the active count after a window countdown completes
// and wakes one parked waiter so it can retry.
func (b *windowBucket) popAndWake() {
	b.mu.Lock()
	if b.active > 0 {
		b.active--
	}
	var next chan struct{}
	if len(b.waiters) > 0 {
		next = b.waiters[0]
		b.waiters = b.waiters[1:]
	}
	stats, workflow, key := b.stats, b.workflow, b.key
	active := b.active
	b.mu.Unlock()
	if stats != nil {
		stats.recordConcurrencyStats(workflow, key, int(b.window.Minutes()), b.max, active)
	}
	if next != nil {
		close(next)
	}
}

func (b *windowBucket) removeWaiter(ch chan struct{}) {
	b.mu.Lock()
	for i, w := range b.waiters {
		if w == ch {
			b.waiters = append(b.waiters[:i], b.waiters[i+1:]...)
			break
		}
	}
	b.mu.Unlock()
}

// close marks the bucket closed and wakes every parked waiter so they fail
// fast instead of hanging forever after a plan refresh.
func (b *windowBucket) close() {
	b.mu.Lock()
	b.closed = true
	waiters := b.waiters
	b.waiters = nil
	b.mu.Unlock()
	for _, w := range waiters {
		close(w)
	}
}

// bucketKey builds the window bucket identity. The node id is the flat
// topology slot node (shared by every request whose chain reaches it), so all
// requests passing the node share ONE "*" bucket — a single uniform window.
//
// The workflow id is deliberately not part of the runtime key (it is recorded
// in the stats rows for observability); two providers attaching the same node
// must land in the same "*" bucket.
func bucketKey(nodeID string) string {
	return nodeID + "\x00*"
}

// checkConcurrency reserves a slot for one compiled concurrency rule. It
// blocks until the window has room or the request/engine gives up. The
// returned release parameter schedules the window countdown from the finish
// moment; pass zero to count down from now.
func (e *Engine) checkConcurrency(ctx context.Context, plan *ExecutionPlan, rule *ConcurrencyRule) (release func(finish time.Time), err error) {
	sKey := bucketKey(rule.ID)
	bucket := e.concurrencyBucketFor(plan, sKey, rule)
	return bucket.acquire(ctx)
}

// concurrencyBucketFor returns (creating if needed) the window bucket for the
// key, sized by the rule's window and capacity.
func (e *Engine) concurrencyBucketFor(plan *ExecutionPlan, key string, rule *ConcurrencyRule) *windowBucket {
	if existing, ok := e.concurrencyBuckets.Load(key); ok {
		return existing.(*windowBucket)
	}
	workflow := ""
	if plan != nil {
		workflow = plan.ID
	}
	b := newWindowBucket(time.Duration(rule.WindowMinutes)*time.Minute, rule.MaxCount, e, workflow, key)
	actual, _ := e.concurrencyBuckets.LoadOrStore(key, b)
	return actual.(*windowBucket)
}

// recordConcurrencyStats writes a throttled snapshot of a bucket's occupancy
// to the transient ConcurrencyWindowCounter table. Writes are best-effort and
// rate-limited (~1/s/key) so observability never sits on the request hot path.
func (e *Engine) recordConcurrencyStats(workflowID, key string, windowMinutes, maxCount, active int) {
	if e.db == nil {
		return
	}
	parts := strings.Split(key, "\x00")
	if len(parts) != 2 {
		return
	}
	now := time.Now()
	if last, ok := e.concurrencyFlushTimes.Load(key); ok {
		if t, ok := last.(time.Time); ok && now.Sub(t) < time.Second {
			return
		}
	}
	e.concurrencyFlushTimes.Store(key, now)
	row := model.ConcurrencyWindowCounter{
		ID:              statsRowID(key),
		WorkflowID:      workflowID,
		NodeID:          parts[0],
		Provider:        parts[1],
		MaxCount:        maxCount,
		WindowMinutes:   windowMinutes,
		WindowCount:     active,
		WindowStartedAt: now,
		UpdatedAt:       now,
	}
	go func() {
		if err := e.db.Save(&row).Error; err != nil {
			// best-effort stats: swallow
		}
	}()
}

// statsRowID derives a stable primary key from the bucket key so repeated
// snapshot writes update the same ConcurrencyWindowCounter row instead of
// inserting unbounded duplicates into the transient table.
func statsRowID(key string) string {
	sum := sha1.Sum([]byte(key))
	return hex.EncodeToString(sum[:])
}
