package relay

import (
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/hapiy/hapiy/internal/model"
)

// heartbeatFrame is the SSE comment line emitted when no upstream data
// has flowed for rule.Timeout seconds. The leading colon marks an SSE
// comment so clients ignore it but keep the connection warm.
var heartbeatFrame = []byte(": keep-alive\n\n")

// heartbeatReader wraps an upstream streaming body and injects periodic
// SSE comment frames when the upstream produces no bytes for the
// configured silence window. A single goroutine reads from upstream and
// writes to an internal channel; the public Read blocks on a select
// across (upstream-data, timer, channel-close). No data is buffered
// beyond the immediate read: real bytes flow forward as soon as they
// arrive.
type heartbeatReader struct {
	upstream io.Reader
	timeout  time.Duration
	timer    *time.Timer

	mu      sync.Mutex
	pending []byte
	closed  bool

	dataCh chan []byte
	errCh  chan error
}

func newHeartbeatReader(upstream io.Reader, timeoutSeconds int) *heartbeatReader {
	if timeoutSeconds <= 0 {
		timeoutSeconds = 30
	}
	hr := &heartbeatReader{
		upstream: upstream,
		timeout:  time.Duration(timeoutSeconds) * time.Second,
		timer:    time.NewTimer(time.Duration(timeoutSeconds) * time.Second),
		dataCh:   make(chan []byte, 1),
		errCh:    make(chan error, 1),
	}
	go hr.pump()
	return hr
}

// pump runs in its own goroutine and forwards upstream bytes (or an
// error) through the channels. The reader's main Read returns this
// data immediately and resets the silence timer.
func (h *heartbeatReader) pump() {
	buf := make([]byte, 4096)
	for {
		n, err := h.upstream.Read(buf)
		if n > 0 {
			cp := make([]byte, n)
			copy(cp, buf[:n])
			h.dataCh <- cp
		}
		if err != nil {
			h.errCh <- err
			return
		}
	}
}

func (h *heartbeatReader) Read(p []byte) (int, error) {
	h.mu.Lock()
	closed := h.closed
	if len(h.pending) > 0 {
		n := copy(p, h.pending)
		h.pending = h.pending[n:]
		h.mu.Unlock()
		return n, nil
	}
	h.mu.Unlock()
	if closed {
		return 0, io.EOF
	}
	// Stop+Reset is the documented Go pattern for "re-arm the timer
	// from this moment". Draining the channel prevents a stale send
	// from a previous interval from being observed by the select.
	stopped := h.timer.Stop()
	if !stopped {
		select {
		case <-h.timer.C:
		default:
		}
	}
	h.timer.Reset(h.timeout)
	select {
	case chunk := <-h.dataCh:
		n := copy(p, chunk)
		if n < len(chunk) {
			h.mu.Lock()
			h.pending = append(h.pending, chunk[n:]...)
			h.mu.Unlock()
		}
		return n, nil
	case err := <-h.errCh:
		h.timer.Stop()
		return 0, err
	case <-h.timer.C:
		n := copy(p, heartbeatFrame)
		if n < len(heartbeatFrame) {
			h.mu.Lock()
			h.pending = append(h.pending, heartbeatFrame[n:]...)
			h.mu.Unlock()
		}
		return n, nil
	}
}

// Close stops the timer. The underlying upstream body is closed by the
// caller (handler/relay.go's defer).
func (h *heartbeatReader) Close() error {
	h.mu.Lock()
	h.closed = true
	if h.timer != nil {
		h.timer.Stop()
	}
	h.mu.Unlock()
	return nil
}

// wrapWithHeartbeat returns resp with a heartbeat-wrapped streaming body
// when the HeartbeatRule matches the request's model. matchCondition "*"
// matches everything; otherwise the value is compared against req.Model.
// Non-streaming callers are not affected; the existing struct field shape
// is preserved so the handler can keep reading res.Body as an
// io.ReadCloser.
func (e *Engine) wrapWithHeartbeat(resp *RelayResponse, rule *model.HeartbeatRule, req *RelayRequest) *RelayResponse {
	if resp == nil {
		return resp
	}
	if !matchesHeartbeatCondition(rule.MatchCondition, req.Model) {
		return resp
	}
	if resp.Body == nil {
		return resp
	}
	resp.Body = &heartbeatReadCloser{
		heartbeatReader: newHeartbeatReader(resp.Body, rule.Timeout),
		closer:          resp.Body,
	}
	return resp
}

// matchesHeartbeatCondition implements the rule's match grammar. "*"
// matches everything; otherwise the literal comparison is exact. An
// empty condition is treated as "*" because that matches the HeartbeatRule
// GORM default.
func matchesHeartbeatCondition(condition, model string) bool {
	if condition == "" || condition == "*" {
		return true
	}
	return condition == model
}

// heartbeatReadCloser delegates Read to the embedded heartbeatReader and
// Close to the underlying io.ReadCloser so callers can still close the
// upstream body via the same handle.
type heartbeatReadCloser struct {
	*heartbeatReader
	closer io.Closer
}

func (h *heartbeatReadCloser) Close() error {
	_ = h.heartbeatReader.Close()
	if h.closer != nil {
		return h.closer.Close()
	}
	return nil
}

// detectStreamingResponse returns true when the response headers indicate
// an SSE / event-stream body. The caller in engine.go makes this decision
// from req.Stream, but we expose the helper for tests.
func detectStreamingResponse(statusCode int, header http.Header) bool {
	if statusCode != http.StatusOK {
		return false
	}
	contentType := header.Get("Content-Type")
	return contentType == "text/event-stream" || contentType == "text/event-stream; charset=utf-8"
}
