package relay

import (
	"bytes"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
)

func TestWrapWithHeartbeat_returnsOriginalWhenMatchMisses(t *testing.T) {
	rule := &model.HeartbeatRule{MatchCondition: "specific-model", Timeout: 1, Status: true}
	resp := &RelayResponse{Body: io.NopCloser(bytes.NewReader([]byte("data")))}
	out := (&Engine{}).wrapWithHeartbeat(resp, rule, &RelayRequest{Model: "different-model"})
	if out != resp {
		t.Fatal("expected the original response when match condition does not match")
	}
}

func TestWrapWithHeartbeat_wildcardMatchesAll(t *testing.T) {
	rule := &model.HeartbeatRule{MatchCondition: "*", Timeout: 1, Status: true}
	original := io.NopCloser(bytes.NewReader([]byte("data")))
	resp := &RelayResponse{Body: original}
	out := (&Engine{}).wrapWithHeartbeat(resp, rule, &RelayRequest{Model: "anything"})
	if out.Body == original {
		t.Fatal("expected the body to be wrapped when wildcard matches")
	}
}

func TestHeartbeatReader_forwardsUpstreamBytes(t *testing.T) {
	upstream := strings.NewReader("hello-world")
	hr := newHeartbeatReader(upstream, 60)
	all, err := io.ReadAll(io.NopCloser(hr))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(all) != "hello-world" {
		t.Fatalf("unexpected bytes: %q", all)
	}
}

func TestHeartbeatReader_injectsAfterSilence(t *testing.T) {
	upstream := newBlockingReader()
	hr := newHeartbeatReader(upstream, 1)
	body := io.NopCloser(hr)
	buf := make([]byte, 64)
	var collectedMu sync.Mutex
	var collected []byte
	done := make(chan struct{})
	go func() {
		for {
			n, err := body.Read(buf)
			if n > 0 {
				collectedMu.Lock()
				collected = append(collected, buf[:n]...)
				collectedMu.Unlock()
			}
			if err == io.EOF {
				close(done)
				return
			}
		}
	}()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		collectedMu.Lock()
		hasHeartbeat := bytes.Contains(collected, []byte(": keep-alive"))
		collectedMu.Unlock()
		if hasHeartbeat {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	collectedMu.Lock()
	final := collected
	collectedMu.Unlock()
	if !bytes.Contains(final, []byte(": keep-alive")) {
		t.Fatalf("heartbeat was not injected: %q", final)
	}
	upstream.Close()
	<-done
}

func TestHeartbeatReadCloser_propagatesClose(t *testing.T) {
	upstream := &closeSpy{}
	hr := newHeartbeatReader(strings.NewReader(""), 60)
	rc := &heartbeatReadCloser{heartbeatReader: hr, closer: upstream}
	if err := rc.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if !upstream.closed {
		t.Fatal("upstream closer was not invoked")
	}
}

func TestWrapWithHeartbeat_nilResponseAndBody(t *testing.T) {
	rule := &model.HeartbeatRule{MatchCondition: "*", Timeout: 1}
	if out := (&Engine{}).wrapWithHeartbeat(nil, rule, &RelayRequest{}); out != nil {
		t.Fatal("expected nil response when input is nil")
	}
	resp := &RelayResponse{Body: nil}
	if out := (&Engine{}).wrapWithHeartbeat(resp, rule, &RelayRequest{}); out != resp {
		t.Fatal("expected same response when body is nil")
	}
}

// blockingReader is an io.Reader that blocks until Close is called.
type blockingReader struct {
	closed chan struct{}
}

func newBlockingReader() *blockingReader {
	return &blockingReader{closed: make(chan struct{})}
}

func (b *blockingReader) Read(_ []byte) (int, error) {
	<-b.closed
	return 0, io.EOF
}

func (b *blockingReader) Close() error {
	select {
	case <-b.closed:
	default:
		close(b.closed)
	}
	return nil
}

type closeSpy struct {
	closed bool
	err    error
}

func (c *closeSpy) Close() error {
	c.closed = true
	return c.err
}
