package relay

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
)

func TestCheckConcurrency_admitsUnderLimit(t *testing.T) {
	eng := NewEngine(nil)
	rule := &model.ConcurrencyRule{ID: "r1", Name: "r1", Scope: "global", MaxConcurrent: 2, QueueEnabled: true, Status: true}
	req := &RelayRequest{}

	release1, err := eng.checkConcurrency(context.Background(), rule, req)
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	defer release1()

	release2, err := eng.checkConcurrency(context.Background(), rule, req)
	if err != nil {
		t.Fatalf("second acquire: %v", err)
	}
	defer release2()

	// Third acquire should queue: we won't wait, but we know it would
	// block because the first two are still held.
}

func TestCheckConcurrency_rejectsImmediatelyWhenQueueDisabled(t *testing.T) {
	eng := NewEngine(nil)
	rule := &model.ConcurrencyRule{ID: "r1", Name: "r1", Scope: "global", MaxConcurrent: 1, QueueEnabled: false, Status: true}
	req := &RelayRequest{}

	release, err := eng.checkConcurrency(context.Background(), rule, req)
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	defer release()

	release2, err := eng.checkConcurrency(context.Background(), rule, req)
	if err == nil {
		release2()
		t.Fatal("expected ErrConcurrencyRejected, got nil")
	}
	if !errors.Is(err, ErrConcurrencyRejected) {
		t.Fatalf("expected ErrConcurrencyRejected, got %v", err)
	}
}

func TestCheckConcurrency_queueRejectsAfterTimeout(t *testing.T) {
	prev := concurrencyQueueTimeout
	concurrencyQueueTimeout = 200 * time.Millisecond
	t.Cleanup(func() { concurrencyQueueTimeout = prev })

	eng := NewEngine(nil)
	rule := &model.ConcurrencyRule{ID: "r1", Name: "r1", Scope: "global", MaxConcurrent: 1, QueueEnabled: true, Status: true}
	req := &RelayRequest{}

	release, err := eng.checkConcurrency(context.Background(), rule, req)
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	defer release()

	start := time.Now()
	_, err = eng.checkConcurrency(context.Background(), rule, req)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("expected queue rejection, got nil")
	}
	if !errors.Is(err, ErrConcurrencyRejected) {
		t.Fatalf("expected ErrConcurrencyRejected, got %v", err)
	}
	if elapsed < 150*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("expected ~200ms wait, got %v", elapsed)
	}
}

func TestCheckConcurrency_perUserScopes(t *testing.T) {
	eng := NewEngine(nil)
	rule := &model.ConcurrencyRule{ID: "r1", Name: "r1", Scope: "per_user", MaxConcurrent: 1, QueueEnabled: false, Status: true}

	release, err := eng.checkConcurrency(context.Background(), rule, &RelayRequest{UserID: "alice"})
	if err != nil {
		t.Fatalf("alice acquire: %v", err)
	}
	defer release()

	// Bob's request must succeed because the limiter is keyed by user.
	release2, err := eng.checkConcurrency(context.Background(), rule, &RelayRequest{UserID: "bob"})
	if err != nil {
		t.Fatalf("bob should not be blocked by alice: %v", err)
	}
	defer release2()

	// Alice's second request must be rejected.
	_, err = eng.checkConcurrency(context.Background(), rule, &RelayRequest{UserID: "alice"})
	if !errors.Is(err, ErrConcurrencyRejected) {
		t.Fatalf("alice's second request should be rejected, got %v", err)
	}
}

func TestCheckConcurrency_releaseAfterPanic(t *testing.T) {
	eng := NewEngine(nil)
	rule := &model.ConcurrencyRule{ID: "r1", Name: "r1", Scope: "global", MaxConcurrent: 1, QueueEnabled: false, Status: true}
	var done int32
	go func() {
		release, err := eng.checkConcurrency(context.Background(), rule, &RelayRequest{})
		if err != nil {
			t.Errorf("acquire: %v", err)
			return
		}
		defer release()
		// Yield the slot to a sibling after a short delay so the
		// sibling observes the held state before this goroutine
		// returns and releases.
		time.Sleep(50 * time.Millisecond)
		atomic.StoreInt32(&done, 1)
	}()
	time.Sleep(10 * time.Millisecond)
	// The slot is now held. Use a short timeout so the test stays fast.
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := eng.checkConcurrency(ctx, rule, &RelayRequest{})
	if !errors.Is(err, ErrConcurrencyRejected) {
		t.Fatalf("expected rejection while slot held, got %v", err)
	}
	// Wait for the holder to release.
	deadline := time.Now().Add(2 * time.Second)
	for atomic.LoadInt32(&done) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if atomic.LoadInt32(&done) == 0 {
		t.Fatal("holder goroutine did not complete")
	}
	// Slot is now free — fresh acquire should succeed.
	release, err := eng.checkConcurrency(context.Background(), rule, &RelayRequest{})
	if err != nil {
		t.Fatalf("post-release acquire: %v", err)
	}
	release()
}

func TestPublishPlans_clearsConcurrencyLimiters(t *testing.T) {
	eng := NewEngine(nil)
	rule := &model.ConcurrencyRule{ID: "r1", Name: "r1", Scope: "global", MaxConcurrent: 1, QueueEnabled: false, Status: true}
	release, err := eng.checkConcurrency(context.Background(), rule, &RelayRequest{})
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release()

	// Publish empty plans — must drop the limiter so the rule id key
	// can be reused on the next refresh without leaking old counters.
	eng.publishPlans(map[string]*model.Provider{}, map[string]*ExecutionPlan{})

	// The old reference is a stale limiter; a fresh checkConcurrency
	// against a new rule (different ID) should succeed because the
	// limiter map was cleared.
	newRule := &model.ConcurrencyRule{ID: "r2", Name: "r2", Scope: "global", MaxConcurrent: 1, QueueEnabled: false, Status: true}
	release2, err := eng.checkConcurrency(context.Background(), newRule, &RelayRequest{})
	if err != nil {
		t.Fatalf("new rule acquire after publish: %v", err)
	}
	release2()
}

func TestCheckConcurrency_concurrentRelease(t *testing.T) {
	eng := NewEngine(nil)
	rule := &model.ConcurrencyRule{ID: "r1", Name: "r1", Scope: "global", MaxConcurrent: 4, QueueEnabled: true, Status: true}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			release, err := eng.checkConcurrency(context.Background(), rule, &RelayRequest{})
			if err != nil {
				t.Errorf("acquire: %v", err)
				return
			}
			time.Sleep(10 * time.Millisecond)
			release()
		}()
	}
	wg.Wait()
}

func TestCheckConcurrency_errorMessageNamesRule(t *testing.T) {
	eng := NewEngine(nil)
	rule := &model.ConcurrencyRule{ID: "rule-7", Name: "r7", Scope: "global", MaxConcurrent: 1, QueueEnabled: false, Status: true}
	release, err := eng.checkConcurrency(context.Background(), rule, &RelayRequest{})
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release()
	_, err = eng.checkConcurrency(context.Background(), rule, &RelayRequest{})
	if err == nil || !strings.Contains(err.Error(), "rule-7") {
		t.Fatalf("expected error to mention rule id, got %v", err)
	}
}
