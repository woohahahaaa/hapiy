package relay

import (
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/model"
)

func trackChannel(t *testing.T, id, providerID string, keyIndex, baseURLIndex int) {
	t.Helper()
	common.Global().TrackActiveRequest(common.ActiveRequest{
		RequestID:    id,
		ProviderID:   providerID,
		KeyIndex:     keyIndex,
		BaseURLIndex: baseURLIndex,
		StartTime:    time.Now(),
	})
	t.Cleanup(func() {
		common.Global().EndRequest(id, "", true, 0, 0, "completed")
	})
}

func resetChannelRoundRobin() {
	channelRRMu.Lock()
	channelRRNext = map[string]int{}
	channelRRMu.Unlock()
}

func TestSelectChannelIndexSequentialPicksFirstEnabled(t *testing.T) {
	e := &Engine{}
	// Base URLs default to sequential; an explicit "sequential" key strategy
	// does the same for keys.
	if got := e.selectChannelIndex("p-seq", model.FailoverDimensionBaseURL, []string{"a", "b"}, -1, ""); got != 0 {
		t.Fatalf("default base url strategy: got %d, want 0", got)
	}
	if got := e.selectChannelIndex("p-seq", model.FailoverDimensionKey, []string{"a", "b"}, -1, "sequential"); got != 0 {
		t.Fatalf("sequential key strategy: got %d, want 0", got)
	}
}

func TestSelectChannelIndexEmptyKeyStrategyDefaultsToBalanced(t *testing.T) {
	e := &Engine{}
	trackChannel(t, "ch-def", "p-def", 0, 0)
	if got := e.selectChannelIndex("p-def", model.FailoverDimensionKey, []string{"k0", "k1"}, -1, ""); got != 1 {
		t.Fatalf("empty key strategy should default to balanced: got %d, want idle key 1", got)
	}
}

func TestSelectChannelIndexEmptyBaseURLStrategyDefaultsToSequential(t *testing.T) {
	e := &Engine{}
	trackChannel(t, "ch-def-url", "p-def-url", 0, 0)
	if got := e.selectChannelIndex("p-def-url", model.FailoverDimensionBaseURL, []string{"u0", "u1"}, -1, ""); got != 0 {
		t.Fatalf("empty base url strategy should default to sequential: got %d, want 0", got)
	}
}

func TestSelectChannelIndexBalancedIsPerDimension(t *testing.T) {
	e := &Engine{}
	// Two requests use key 0 but base URL 1, so each dimension has a different
	// idle channel.
	trackChannel(t, "ch-r1", "p-bal", 0, 1)
	trackChannel(t, "ch-r2", "p-bal", 0, 1)

	keys := []string{"k0", "k1"}
	if got := e.selectChannelIndex("p-bal", model.FailoverDimensionKey, keys, -1, "balanced"); got != 1 {
		t.Fatalf("balanced key: got %d, want idle key 1", got)
	}
	urls := []string{"u0", "u1"}
	if got := e.selectChannelIndex("p-bal", model.FailoverDimensionBaseURL, urls, -1, "balanced"); got != 0 {
		t.Fatalf("balanced base url: got %d, want idle base url 0", got)
	}
}

func TestSelectChannelIndexBalancedRotatesIdleChannels(t *testing.T) {
	resetChannelRoundRobin()
	e := &Engine{}
	values := []string{"a", "b"}
	want := []int{0, 1, 0, 1}
	for i, expected := range want {
		got := e.selectChannelIndex("p-idle", model.FailoverDimensionKey, values, -1, "balanced")
		if got != expected {
			t.Fatalf("idle pick %d = %d, want %d", i, got, expected)
		}
	}
}

func TestSelectChannelIndexHonorsRequestedIndex(t *testing.T) {
	e := &Engine{}
	trackChannel(t, "ch-aff", "p-aff", 0, 0)
	// Channel affinity pinned key 0 even though it is the busier one.
	if got := e.selectChannelIndex("p-aff", model.FailoverDimensionKey, []string{"k0", "k1"}, 0, "balanced"); got != 0 {
		t.Fatalf("requested index must win, got %d", got)
	}
}
