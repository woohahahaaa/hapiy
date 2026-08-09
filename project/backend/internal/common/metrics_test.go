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
	m.EndRequest(id, "test-model", true, runFor.Milliseconds(), 10)
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
