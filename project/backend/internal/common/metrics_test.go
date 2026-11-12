package common

import (
	"testing"
	"time"
)

func trackAndEnd(m *Metrics, id string, start time.Time, runFor time.Duration) {
	m.TrackActiveRequest(ActiveRequest{
		RequestID: id,
		Model:     "test-model",
		StartTime: start,
	})
	m.EndRequest(id, "test-model", true, runFor.Milliseconds(), 10, "completed")
}

func TestFinishedRequestStaysWithinRetention(t *testing.T) {
	m := NewMetrics()
	now := time.Now()
	trackAndEnd(m, "r1", now.Add(-30*time.Second), 30*time.Second)

	requests := m.ActiveRequests()
	if len(requests) != 1 {
		t.Fatalf("expected 1 visible request, got %d", len(requests))
	}
	if requests[0].EndTime == nil {
		t.Fatal("expected EndTime to be set after EndRequest")
	}
	if requests[0].ElapsedMs != 30_000 {
		t.Fatalf("expected elapsed 30000ms, got %d", requests[0].ElapsedMs)
	}
}

func TestProviderInFlightCountsOnlyActiveRequestsOfProvider(t *testing.T) {
	m := NewMetrics()
	now := time.Now()
	m.TrackActiveRequest(ActiveRequest{RequestID: "a", ProviderID: "p1", StartTime: now})
	m.TrackActiveRequest(ActiveRequest{RequestID: "b", ProviderID: "p1", StartTime: now})
	m.TrackActiveRequest(ActiveRequest{RequestID: "c", ProviderID: "p2", StartTime: now})
	m.TrackActiveRequest(ActiveRequest{RequestID: "d", StartTime: now}) // queued, not dispatched yet
	// A finished entry stays visible for the retention window but must not count.
	m.TrackActiveRequest(ActiveRequest{RequestID: "e", ProviderID: "p1", StartTime: now})
	m.EndRequest("e", "test-model", true, 1, 0, "completed")

	if got := m.ProviderInFlight("p1"); got != 2 {
		t.Fatalf("p1 in flight = %d, want 2", got)
	}
	if got := m.ProviderInFlight("p2"); got != 1 {
		t.Fatalf("p2 in flight = %d, want 1", got)
	}
	if got := m.ProviderInFlight(""); got != 0 {
		t.Fatalf("empty provider id = %d, want 0", got)
	}
}

func TestUpdateActiveRequestChannelTracksPerChannelLoads(t *testing.T) {
	m := NewMetrics()
	now := time.Now()
	m.TrackActiveRequest(ActiveRequest{RequestID: "r1", ProviderID: "p", KeyIndex: -1, BaseURLIndex: -1, StartTime: now})
	m.TrackActiveRequest(ActiveRequest{RequestID: "r2", ProviderID: "p", KeyIndex: -1, BaseURLIndex: -1, StartTime: now})

	m.UpdateActiveRequestChannel("r1", 1, 0)
	m.UpdateActiveRequestChannel("r2", 1, 1)

	if got := m.KeyInFlight("p", 1); got != 2 {
		t.Fatalf("key 1 in flight = %d, want 2", got)
	}
	if got := m.KeyInFlight("p", 0); got != 0 {
		t.Fatalf("key 0 in flight = %d, want 0", got)
	}
	if got := m.BaseURLInFlight("p", 0); got != 1 {
		t.Fatalf("base url 0 in flight = %d, want 1", got)
	}
	if got := m.BaseURLInFlight("p", 1); got != 1 {
		t.Fatalf("base url 1 in flight = %d, want 1", got)
	}

	// A finished request keeps its channel but no longer counts as in flight.
	m.EndRequest("r1", "test-model", true, 1, 0, "completed")
	if got := m.KeyInFlight("p", 1); got != 1 {
		t.Fatalf("key 1 in flight after finish = %d, want 1", got)
	}
	if got := m.BaseURLInFlight("p", 0); got != 0 {
		t.Fatalf("base url 0 in flight after finish = %d, want 0", got)
	}
}

func TestFinishedRequestEvictedAfterRetention(t *testing.T) {
	m := NewMetrics()
	now := time.Now()
	endTime := now.Add(-10 * time.Minute)
	m.TrackActiveRequest(ActiveRequest{
		RequestID: "r1",
		Model:     "test-model",
		StartTime: now.Add(-12 * time.Minute),
		EndTime:   &endTime,
	})

	m.evictExpired(2 * time.Minute)
	if len(m.ActiveRequests()) != 0 {
		t.Fatal("expected finished request to be evicted past its retention window")
	}
}

func TestZeroRetentionEvictsImmediately(t *testing.T) {
	m := NewMetrics()
	m.SetRetentionMinutes(0)
	now := time.Now()
	trackAndEnd(m, "r1", now.Add(-30*time.Second), 30*time.Second)

	if len(m.ActiveRequests()) != 0 {
		t.Fatal("expected finished request to be evicted immediately with zero retention")
	}
}

func TestInFlightRequestKeptRegardlessOfRetention(t *testing.T) {
	m := NewMetrics()
	m.SetRetentionMinutes(0)
	m.TrackActiveRequest(ActiveRequest{
		RequestID: "r1",
		Model:     "test-model",
		StartTime: time.Now().Add(-30 * time.Second),
	})

	requests := m.ActiveRequests()
	if len(requests) != 1 || requests[0].EndTime != nil {
		t.Fatalf("expected in-flight request to remain visible, got %+v", requests)
	}
}

func TestUpdateActiveRequestProgress_updatesInflightRequest(t *testing.T) {
	m := NewMetrics()
	m.TrackActiveRequest(ActiveRequest{RequestID: "r1", Model: "m", StartTime: time.Now()})

	m.UpdateActiveRequestProgress("r1", "receiving_stream", 42, 1536)

	requests := m.ActiveRequests()
	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}
	got := requests[0]
	if got.Stage != "receiving_stream" || got.ChunkCount != 42 || got.BytesReceived != 1536 {
		t.Fatalf("progress not applied: %+v", got)
	}
}

func TestUpdateActiveRequestProgress_skipsFinishedRequest(t *testing.T) {
	m := NewMetrics()
	m.TrackActiveRequest(ActiveRequest{RequestID: "r1", Model: "m", StartTime: time.Now()})
	m.EndRequest("r1", "m", true, 100, 0, "completed")

	m.UpdateActiveRequestProgress("r1", "receiving", 1, 1)

	requests := m.ActiveRequests()
	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}
	if requests[0].Stage != "" {
		t.Fatalf("finished request stage must stay empty, got %q", requests[0].Stage)
	}
}

func TestUpdateActiveRequestProgress_ignoresUnknownRequest(t *testing.T) {
	m := NewMetrics()
	m.UpdateActiveRequestProgress("ghost", "receiving", 1, 1)
	if len(m.ActiveRequests()) != 0 {
		t.Fatal("expected no entry for unknown request")
	}
}

func TestUpdateActiveRequestAffinity_updatesInflightRequest(t *testing.T) {
	m := NewMetrics()
	m.TrackActiveRequest(ActiveRequest{RequestID: "r1", Model: "m", StartTime: time.Now(), AffinityReuse: "full"})

	m.UpdateActiveRequestAffinity("r1", "new")

	requests := m.ActiveRequests()
	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}
	if requests[0].AffinityReuse != "new" {
		t.Fatalf("affinity not applied: %+v", requests[0])
	}
}

func TestUpdateActiveRequestAffinity_skipsFinishedRequest(t *testing.T) {
	m := NewMetrics()
	m.TrackActiveRequest(ActiveRequest{RequestID: "r1", Model: "m", StartTime: time.Now(), AffinityReuse: "full"})
	m.EndRequest("r1", "m", true, 100, 0, "completed")

	m.UpdateActiveRequestAffinity("r1", "new")

	requests := m.ActiveRequests()
	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}
	if requests[0].AffinityReuse != "full" {
		t.Fatalf("finished request affinity must stay as recorded, got %q", requests[0].AffinityReuse)
	}
}
