package relay

import (
	"bufio"
	"bytes"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// rewriteOpRef identifies a single compiled op inside a chain so the
// stream rewriter can track per-op state across events.
type rewriteOpRef struct {
	ruleID string
	index  int
}

// streamRewriteReader wraps an upstream SSE body and rewrites every data
// event's JSON payload through the compiled response-rewrite chains as the
// stream flows. On top of the regular op modes it supports two streaming
// only ones:
//
//   - first_prepend: applies its prefix only on the first event whose
//     path exists, then stays silent for the rest of the stream.
//   - last_append: applies its suffix only on the last event whose path
//     exists. Because "last" is only known once the following event
//     arrives (or the stream ends), the rewriter holds the previous
//     matching event — together with its trailing SSE lines — and only
//     finalizes it when the next data event no longer matches or EOF.
//     Blank separator lines and comments pass through but stay attached
//     to the held event so output order is preserved.
//
// Only the body is rewritten; header ops are ignored for streaming.
type streamRewriteReader struct {
	src    io.Reader
	chains []CompiledRewriteChain

	mu      sync.Mutex
	pending []byte // rewritten bytes ready to be returned
	done    bool
	err     error

	br        *bufio.Reader
	firstDone map[string]bool
	held      []byte         // rewritten JSON payload of the held event
	heldTail  []byte         // trailing bytes (blank lines) of the held event
	heldOps   []rewriteOpRef // last_append ops the held event matched
	totalMs   int64
}

func newStreamRewriteReader(src io.Reader, chains []CompiledRewriteChain) *streamRewriteReader {
	return &streamRewriteReader{
		src:       src,
		chains:    chains,
		br:        bufio.NewReader(src),
		firstDone: make(map[string]bool),
	}
}

// TotalRewriteMs returns the accumulated rewrite time across all events
// processed so far.
func (r *streamRewriteReader) TotalRewriteMs() int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.totalMs
}

func (r *streamRewriteReader) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.done = true
	if closer, ok := r.src.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}

func (r *streamRewriteReader) Read(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for len(r.pending) == 0 {
		if r.done {
			return 0, r.err
		}
		if err := r.step(); err != nil {
			if err == io.EOF {
				r.done = true
				r.err = io.EOF
				if len(r.pending) == 0 {
					return 0, io.EOF
				}
				break
			}
			r.done = true
			r.err = err
			return 0, err
		}
	}
	n := copy(p, r.pending)
	r.pending = r.pending[n:]
	return n, nil
}

// step reads one line from upstream, rewrites it if it is a data event,
// and appends the output to r.pending in original stream order.
func (r *streamRewriteReader) step() error {
	line, err := r.br.ReadString('\n')
	hadNL := strings.HasSuffix(line, "\n")
	raw := strings.TrimSuffix(line, "\n")
	raw = strings.TrimSuffix(raw, "\r")
	trimmed := strings.TrimPrefix(raw, " ")

	emit := func(bs []byte) {
		r.pending = append(r.pending, bs...)
	}

	if strings.HasPrefix(trimmed, "data:") {
		payload := strings.TrimPrefix(trimmed, "data:")
		payload = strings.TrimPrefix(payload, " ")
		out, rewMs := r.processData([]byte(payload))
		if rewMs > 0 {
			r.totalMs += rewMs
		}
		if len(out) > 0 {
			emit(out)
		}
	} else {
		// A non-data line (blank separator, comment, event:, id:) belongs
		// to the current event framing. If a data event is being held for
		// last_append, attach the line to its tail so it is emitted with
		// the event; otherwise pass it through immediately.
		if r.held != nil {
			r.heldTail = append(r.heldTail, raw...)
			if hadNL {
				r.heldTail = append(r.heldTail, '\n')
			}
		} else {
			if len(raw) > 0 {
				emit([]byte(raw))
			}
			if hadNL {
				emit([]byte{'\n'})
			}
		}
	}

	if err == io.EOF {
		if out := r.flushHeld(); len(out) > 0 {
			emit(out)
		}
		return io.EOF
	}
	return err
}

// processData rewrites a single data payload, finalizing the previously
// held event when the new payload no longer matches its last_append ops.
// It returns the bytes to emit and the rewrite time spent.
func (r *streamRewriteReader) processData(payload []byte) ([]byte, int64) {
	var out []byte
	if r.held != nil {
		var finished, ongoing []rewriteOpRef
		for _, op := range r.heldOps {
			if r.matches(payload, op) {
				ongoing = append(ongoing, op)
			} else {
				finished = append(finished, op)
			}
		}
		body := r.held
		for _, op := range finished {
			body = r.applySuffix(body, op)
		}
		// The held event is emitted now: if any op is still ongoing the
		// held event is not the last one and goes out without those
		// suffixes (the new payload carries them forward).
		out = frameData(body, r.heldTail)
		r.held = nil
		r.heldTail = nil
		r.heldOps = ongoing
	}

	if !gjson.ValidBytes(payload) {
		if len(out) == 0 {
			out = frameData(payload, nil)
		}
		return out, 0
	}

	start := time.Now()
	body := payload
	matched := make([]rewriteOpRef, 0)
	for ci := range r.chains {
		chain := &r.chains[ci]
		for oi := range chain.Ops {
			op := &chain.Ops[oi]
			if strings.HasPrefix(op.Path, "header.") {
				continue
			}
			ref := rewriteOpRef{ruleID: chain.RuleID, index: oi}
			switch op.Mode {
			case "first_prepend":
				if r.firstDone[refKey(ref)] {
					continue
				}
				if !gjson.GetBytes(body, op.Path).Exists() {
					continue
				}
				cur := gjson.GetBytes(body, op.Path).String()
				updated, err := sjson.SetBytes(body, op.Path, op.Value+cur)
				if err == nil {
					body = updated
				}
				r.firstDone[refKey(ref)] = true
			case "last_append":
				if gjson.GetBytes(body, op.Path).Exists() {
					matched = append(matched, ref)
				}
			default:
				updated, _, err := applyRewriteOp(body, nil, op)
				if err == nil {
					body = updated
				}
			}
		}
	}
	rewMs := time.Since(start).Milliseconds()

	if len(matched) > 0 {
		r.held = body
		r.heldTail = nil
		r.heldOps = matched
		if len(out) == 0 {
			return nil, rewMs
		}
		return out, rewMs
	}
	// The event matched no last_append op: emit it now (the previously
	// held event, if any, was already emitted above).
	out = append(out, frameData(body, nil)...)
	return out, rewMs
}

// matches reports whether the payload still contains the op's path.
func (r *streamRewriteReader) matches(payload []byte, ref rewriteOpRef) bool {
	for ci := range r.chains {
		chain := &r.chains[ci]
		if chain.RuleID != ref.ruleID {
			continue
		}
		if ref.index < 0 || ref.index >= len(chain.Ops) {
			return false
		}
		op := &chain.Ops[ref.index]
		return gjson.GetBytes(payload, op.Path).Exists()
	}
	return false
}

// flushHeld applies the pending last_append suffixes to the held event and
// clears the held state. Called at EOF.
func (r *streamRewriteReader) flushHeld() []byte {
	if r.held == nil {
		return nil
	}
	body := r.held
	for _, op := range r.heldOps {
		body = r.applySuffix(body, op)
	}
	out := frameData(body, r.heldTail)
	r.held = nil
	r.heldTail = nil
	r.heldOps = nil
	return out
}

func (r *streamRewriteReader) applySuffix(body []byte, ref rewriteOpRef) []byte {
	for ci := range r.chains {
		chain := &r.chains[ci]
		if chain.RuleID != ref.ruleID {
			continue
		}
		if ref.index < 0 || ref.index >= len(chain.Ops) {
			return body
		}
		op := &chain.Ops[ref.index]
		cur := gjson.GetBytes(body, op.Path)
		if !cur.Exists() {
			updated, err := sjson.SetBytes(body, op.Path, op.Value)
			if err == nil {
				return updated
			}
			return body
		}
		updated, err := sjson.SetBytes(body, op.Path, cur.String()+op.Value)
		if err == nil {
			return updated
		}
		return body
	}
	return body
}

// frameData renders a data event: "data: <payload>\n" plus any trailing
// lines (normally the blank separator). When tail is nil the event ends
// with a single newline.
func frameData(payload, tail []byte) []byte {
	var b bytes.Buffer
	b.WriteString("data: ")
	b.Write(payload)
	b.WriteString("\n")
	if len(tail) > 0 {
		b.Write(tail)
	}
	return b.Bytes()
}

func refKey(ref rewriteOpRef) string {
	return ref.ruleID + "\x00" + strconv.Itoa(ref.index)
}
