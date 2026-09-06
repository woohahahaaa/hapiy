package relay

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
)

// testConcurrencyPlan builds a compiled inline concurrency rule for tests.
func testConcurrencyPlan(id string, windowMinutes, maxCount int) *ConcurrencyRule {
	return &ConcurrencyRule{
		ID:            id,
		WindowMinutes: windowMinutes,
		MaxCount:      maxCount,
	}
}

// newTestProvider returns a bare provider row used to resolve bucket scopes.
func newTestProvider(id string) *model.Provider {
	return &model.Provider{ID: id, Name: id}
}

func TestCheckConcurrency_admitsUnderLimit(t *testing.T) {
	eng := NewEngine(nil)
	plan := &ExecutionPlan{ID: "w1", Provider: newTestProvider("p1")}
	rule := testConcurrencyPlan("r1", 1, 2)

	release1, err := eng.checkConcurrency(context.Background(), plan, rule)
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	defer release1(time.Now())

	release2, err := eng.checkConcurrency(context.Background(), plan, rule)
	if err != nil {
		t.Fatalf("second acquire: %v", err)
	}
	defer release2(time.Now())
}

func TestCheckConcurrency_blocksAtCapacity_untilCancelled(t *testing.T) {
	eng := NewEngine(nil)
	plan := &ExecutionPlan{ID: "w1", Provider: newTestProvider("p1")}
	rule := testConcurrencyPlan("r1", 1, 1)

	release, err := eng.checkConcurrency(context.Background(), plan, rule)
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	defer release(time.Now())

	// Second acquire must park (wait forever) — a cancelled context is the
	// only way out, matching the "等到天荒地老" contract.
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := eng.checkConcurrency(ctx, plan, rule)
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("acquire returned early with %v (should have parked)", err)
	case <-time.After(50 * time.Millisecond):
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, ErrConcurrencyRejected) {
			t.Fatalf("expected ErrConcurrencyRejected on cancel, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("parked acquire did not unblock after cancel")
	}
}

func TestCheckConcurrency_waiterReleasedAfterWindowCountdown(t *testing.T) {
	eng := NewEngine(nil)
	_ = eng
	// Directly exercise the bucket with a tiny window for speed.
	key := bucketKey("r1")
	fast := newWindowBucket(50*time.Millisecond, 1, eng, "w1", key)
	release1, err := fast.acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	type result struct {
		err error
		rel func(time.Time)
	}
	ch := make(chan result, 1)
	go func() {
		rel, err := fast.acquire(ctx)
		ch <- result{err, rel}
	}()
	select {
	case r := <-ch:
		t.Fatalf("acquire returned early (%v), should have parked", r.err)
	case <-time.After(30 * time.Millisecond):
	}

	// Holder finishes now -> window countdown (50ms) starts; the parked
	// waiter must be admitted once the countdown completes.
	time.Sleep(10 * time.Millisecond)
	release1(time.Now())

	select {
	case r := <-ch:
		if r.err != nil {
			t.Fatalf("waiter acquire failed: %v", r.err)
		}
		r.rel(time.Now())
	case <-time.After(time.Second):
		t.Fatal("waiter was not woken after countdown")
	}
	cancel()
}

func TestCheckConcurrency_sharedBinAcrossProviders(t *testing.T) {
	eng := NewEngine(nil)
	rule := testConcurrencyPlan("r1", 5, 1)

	planA := &ExecutionPlan{ID: "w1", Provider: newTestProvider("p1")}
	planB := &ExecutionPlan{ID: "w1", Provider: newTestProvider("p2")}

	release, err := eng.checkConcurrency(context.Background(), planA, rule)
	if err != nil {
		t.Fatalf("provider A acquire: %v", err)
	}
	defer release(time.Now())

	// Provider B shares the "*" window: A holds the only slot -> B parks
	// (cancelled ctx exits with rejection immediately).
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := eng.checkConcurrency(ctx, planB, rule)
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("provider B should share the window and park, got %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, ErrConcurrencyRejected) {
			t.Fatalf("expected rejection on cancel, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("parked provider B acquire did not unblock")
	}
}

func TestPublishPlans_clearsConcurrencyBuckets(t *testing.T) {
	eng := NewEngine(nil)
	plan := &ExecutionPlan{ID: "w1", Provider: newTestProvider("p1")}
	rule := testConcurrencyPlan("r1", 5, 1)
	release, err := eng.checkConcurrency(context.Background(), plan, rule)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release(time.Now())

	eng.publishPlans(map[string]*model.Provider{"p1": newTestProvider("p1")}, map[string]*ExecutionPlan{})

	// A fresh rule (different ID) must acquire without interference.
	newRule := testConcurrencyPlan("r2", 5, 1)
	release2, err := eng.checkConcurrency(context.Background(), plan, newRule)
	if err != nil {
		t.Fatalf("new rule acquire after publish: %v", err)
	}
	release2(time.Now())
}

func TestCheckConcurrency_concurrentRelease(t *testing.T) {
	eng := NewEngine(nil)
	plan := &ExecutionPlan{ID: "w1", Provider: newTestProvider("p1")}
	rule := testConcurrencyPlan("r1", 5, 4)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			release, err := eng.checkConcurrency(context.Background(), plan, rule)
			if err != nil {
				t.Errorf("acquire: %v", err)
				return
			}
			time.Sleep(10 * time.Millisecond)
			release(time.Now())
		}()
	}
	wg.Wait()
}

func TestCheckConcurrency_errorMessageNamesNode(t *testing.T) {
	eng := NewEngine(nil)
	plan := &ExecutionPlan{ID: "w1", Provider: newTestProvider("p1")}
	rule := testConcurrencyPlan("node-7", 5, 1)
	release, err := eng.checkConcurrency(context.Background(), plan, rule)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release(time.Now())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := eng.checkConcurrency(ctx, plan, rule)
		done <- err
	}()
	time.Sleep(20 * time.Millisecond)
	cancel()
	err = <-done
	if err == nil || !strings.Contains(err.Error(), "node-7") {
		t.Fatalf("expected error to mention node id, got %v", err)
	}
}
