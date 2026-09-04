package handler

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// eventHubBuffer is the per-subscriber queue depth. Subscribers whose buffer
// is full are dropped rather than blocking the publisher, so a stuck SSE
// client can never stall the relay hot path.
const eventHubBuffer = 8

// hubEvent is one framed SSE payload: the named event type plus its JSON data.
type hubEvent struct {
	event string
	data  string
}

// eventHub fans published payloads out to all subscribed channels. It is a
// fire-and-forget bus: publish never blocks and never retries, and a slow or
// disconnected consumer simply stops receiving events.
type eventHub struct {
	mu   sync.Mutex
	subs map[chan hubEvent]struct{}
}

func newEventHub() *eventHub {
	return &eventHub{subs: make(map[chan hubEvent]struct{})}
}

// subscribe registers a new consumer channel and returns a receive-only view
// of it plus a cancel func that unregisters and closes the channel. Calling
// cancel more than once is safe.
func (h *eventHub) subscribe() (<-chan hubEvent, func()) {
	ch := make(chan hubEvent, eventHubBuffer)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
}

// publish marshals payload to JSON and delivers it to every subscriber under
// the given event type without blocking. Subscribers with a full buffer are
// skipped, and a marshal failure is silently ignored so the relay request path
// is unaffected.
func (h *eventHub) publish(eventType string, payload map[string]any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	ev := hubEvent{event: eventType, data: string(data)}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- ev:
		default:
			// Slow consumer: drop the event rather than block the publisher.
		}
	}
}

// dashboardEventsHub is the package-level singleton feeding the /events SSE
// endpoint. It is published to from the relay Progress callback.
var dashboardEventsHub = newEventHub()

// DashboardEvents streams request_started events over SSE for the dashboard
// topology view. Clients subscribe with EventSource; a 15s comment heartbeat
// keeps the connection alive through proxies with idle timeouts. The endpoint
// is mounted under the dashboardAuthed group so cookie-session auth already
// applies.
func DashboardEvents() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")

		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			// No streaming support (e.g. a non-flushing test writer); there is
			// no meaningful error to report, so just end the response.
			return
		}

		events, cancel := dashboardEventsHub.subscribe()
		defer cancel()

		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()

		for {
			select {
			case <-c.Request.Context().Done():
				return
			case <-heartbeat.C:
				if _, err := c.Writer.WriteString(": ping\n\n"); err != nil {
					return
				}
				flusher.Flush()
			case payload, ok := <-events:
				if !ok {
					return
				}
				if _, err := c.Writer.WriteString("event: " + payload.event + "\ndata: " + payload.data + "\n\n"); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	}
}
