package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestEventHub_publish_delivers_json_to_subscribers(t *testing.T) {
	hub := newEventHub()
	events, cancel := hub.subscribe()
	defer cancel()

	hub.publish("request_started", map[string]any{
		"model":      "gpt-4o",
		"provider":   "openai",
		"request_id": "req-123",
	})

	select {
	case ev := <-events:
		if ev.event != "request_started" {
			t.Fatalf("event type: got %q", ev.event)
		}
		var got map[string]string
		if err := json.Unmarshal([]byte(ev.data), &got); err != nil {
			t.Fatalf("decode event payload: %v", err)
		}
		if got["model"] != "gpt-4o" || got["provider"] != "openai" || got["request_id"] != "req-123" {
			t.Fatalf("event payload: got %v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for published event")
	}
}

func TestEventHub_cancel_stops_delivery(t *testing.T) {
	hub := newEventHub()
	events, cancel := hub.subscribe()
	cancel()

	hub.publish("request_started", map[string]any{
		"model":      "gpt-4o",
		"provider":   "openai",
		"request_id": "req-1",
	})

	select {
	case ev, ok := <-events:
		if ok {
			t.Fatalf("received event after cancel: %+v", ev)
		}
		// Channel closed by cancel: nothing further is ever delivered.
	case <-time.After(time.Second):
		t.Fatal("timed out: channel not closed after cancel")
	}
}

func TestEventHub_publish_does_not_block_on_slow_consumer(t *testing.T) {
	hub := newEventHub()
	slow, cancel := hub.subscribe()
	defer cancel()

	// Fill the subscriber buffer past capacity without reading, then publish
	// again: every publish must return immediately, dropping the overflow.
	for i := 0; i < eventHubBuffer+1; i++ {
		hub.publish("request_started", map[string]any{"model": "gpt-4o"})
	}

	done := make(chan struct{})
	go func() {
		hub.publish("request_started", map[string]any{"model": "gpt-4o"})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("publish blocked on a slow consumer")
	}

	_ = slow
}

// recordingSSEWriter is a goroutine-safe httptest-style recorder so the SSE
// handler test can observe flushed output without racing on a bytes.Buffer.
type recordingSSEWriter struct {
	mu      sync.Mutex
	header  http.Header
	flushed int
	body    strings.Builder
}

func (w *recordingSSEWriter) Header() http.Header { return w.header }

func (w *recordingSSEWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.body.Write(p)
}

func (w *recordingSSEWriter) WriteHeader(int) {}

func (w *recordingSSEWriter) Flush() {
	w.mu.Lock()
	w.flushed++
	w.mu.Unlock()
}

func (w *recordingSSEWriter) flushCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.flushed
}

func TestDashboardEvents_streams_request_started(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/events", DashboardEvents())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/events", nil).WithContext(ctx)
	rec := &recordingSSEWriter{header: make(http.Header)}

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(rec, req)
		close(done)
	}()

	// Wait for the handler to subscribe before publishing so the event is
	// not missed, then wait for a flush (which follows the event write).
	deadline := time.Now().Add(time.Second)
	for {
		dashboardEventsHub.mu.Lock()
		n := len(dashboardEventsHub.subs)
		dashboardEventsHub.mu.Unlock()
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("handler never subscribed")
		}
		time.Sleep(time.Millisecond)
	}

	dashboardEventsHub.publish("request_started", map[string]any{
		"model":      "gpt-4o",
		"provider":   "openai",
		"request_id": "req-abc",
	})

	deadline = time.Now().Add(time.Second)
	for rec.flushCount() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("event was not flushed to the SSE client")
		}
		time.Sleep(time.Millisecond)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not exit after context cancellation")
	}

	if got := rec.header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("content-type: want text/event-stream, got %q", got)
	}
	body := rec.body.String()
	if !strings.Contains(body, "event: request_started") {
		t.Fatalf("body missing event type: %q", body)
	}
	if !strings.Contains(body, `"request_id":"req-abc"`) {
		t.Fatalf("body missing payload fields: %q", body)
	}
}
