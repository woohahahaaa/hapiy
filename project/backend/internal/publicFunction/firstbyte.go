// Package publicfunction holds shared, reusable helpers.
package publicfunction

import (
	"bufio"
	"io"
	"sync"
	"sync/atomic"
	"time"
)

// FirstByteProbeReader wraps an io.ReadCloser and measures the time until
// the first body byte arrives (time-to-first-byte, TTFB). It is used by
// both the auto-disable failover path and the auto-recovery probe so both
// sides agree on what "first byte" means.
//
// Thread safety: WaitFirstByte runs a blocking peek on a background
// goroutine; consumer Read calls queue on the same mutex, so no byte can
// be consumed twice or lost. The background goroutine always finishes —
// it returns as soon as data/EOF/error arrives (the consumer reading the
// body guarantees that happens) — so no goroutine leaks. FirstByteSeen
// and FirstByteLatency read the stamp atomically and never block, even
// while the background peek is still waiting for data.
type FirstByteProbeReader struct {
	mu        sync.Mutex
	br        *bufio.Reader
	closeFn   func() error
	start     time.Time
	firstNano atomic.Int64 // 0 = not seen; else UnixNano of first byte
}

// NewFirstByteProbeReader wraps r with a start timestamp; TTFB is measured
// from start to the first byte read (or the first byte observed by
// WaitFirstByte). r.Close is forwarded.
func NewFirstByteProbeReader(r io.ReadCloser, start time.Time) *FirstByteProbeReader {
	return &FirstByteProbeReader{
		br:      bufio.NewReader(r),
		closeFn: r.Close,
		start:   start,
	}
}

// Read forwards to the underlying reader and stamps the first-byte moment
// the first time data arrives.
func (p *FirstByteProbeReader) Read(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	n, err := p.br.Read(b)
	if n > 0 {
		p.markFirst()
	}
	return n, err
}

// Close forwards to the underlying closer.
func (p *FirstByteProbeReader) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closeFn == nil {
		return nil
	}
	return p.closeFn()
}

// FirstByteLatency returns the measured TTFB; if no byte arrived yet it
// falls back to the elapsed time since start. Never blocks.
func (p *FirstByteProbeReader) FirstByteLatency() time.Duration {
	if nano := p.firstNano.Load(); nano > 0 {
		return time.Unix(0, nano).Sub(p.start)
	}
	return time.Since(p.start)
}

// FirstByteSeen reports whether the first body byte has arrived. Never blocks.
func (p *FirstByteProbeReader) FirstByteSeen() bool {
	return p.firstNano.Load() > 0
}

// WaitFirstByte blocks until the first body byte arrives or timeout
// elapses. It returns true when the byte arrived within the window. The
// observed byte is buffered and still delivered to later Read calls, so
// nothing is lost. A false return means the caller decided to treat the
// upstream as slow; the reader remains usable.
func (p *FirstByteProbeReader) WaitFirstByte(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() {
		p.mu.Lock()
		_, _ = p.br.Peek(1)
		p.markFirst()
		p.mu.Unlock()
		close(done)
	}()
	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}

func (p *FirstByteProbeReader) markFirst() {
	if p.firstNano.Load() == 0 {
		p.firstNano.Store(time.Now().UnixNano())
	}
}
