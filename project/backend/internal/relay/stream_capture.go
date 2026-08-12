package relay

// stream_capture.go — Captures streaming response bytes as they flow from
// upstream to the client. The wrapper is installed in relay.Relay() so the
// engine can return RelayResponse with both Body (for forwarding) and a
// StreamCapture buffer (for log capture backfill).
//
// The buffer is populated lazily as the handler reads from Body. After the
// stream completes the relay handler calls service.LogCapture().UpdateStreamBody
// to swap the placeholder body written by runTopologyLogOutputs with the
// real captured bytes. This mirrors the existing UpdateStreamTimings pattern.

import (
	"bytes"
	"io"
	"sync"
)

// streamCaptureReader wraps an io.ReadCloser and copies every read chunk
// into a shared *bytes.Buffer. Safe for concurrent reads because the
// underlying transport's Read is already serial; we additionally guard the
// buffer with a mutex so backfill reads do not race with capture writes.
type streamCaptureReader struct {
	inner io.ReadCloser
	buf   *bytes.Buffer
	mu    sync.Mutex
	done  bool
}

func newStreamCaptureReader(inner io.ReadCloser, buf *bytes.Buffer) *streamCaptureReader {
	return &streamCaptureReader{inner: inner, buf: buf}
}

func (r *streamCaptureReader) Read(p []byte) (int, error) {
	n, err := r.inner.Read(p)
	if n > 0 {
		r.mu.Lock()
		r.buf.Write(p[:n])
		r.mu.Unlock()
	}
	if err == io.EOF {
		r.mu.Lock()
		r.done = true
		r.mu.Unlock()
	}
	return n, err
}

func (r *streamCaptureReader) Close() error {
	return r.inner.Close()
}

// Captured returns the bytes accumulated so far. Safe to call concurrently
// with Read; the returned slice aliases internal state and must not be
// mutated by the caller.
func (r *streamCaptureReader) Captured() []byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.done {
		return r.buf.Bytes()
	}
	// Snapshot before EOF so backfill mid-stream sees partial data.
	out := make([]byte, r.buf.Len())
	copy(out, r.buf.Bytes())
	return out
}