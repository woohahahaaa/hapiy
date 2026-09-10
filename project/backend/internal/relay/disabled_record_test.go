package relay

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestCompactValue_arrayKeepsOneTypedElement(t *testing.T) {
	items := make([]interface{}, 5)
	for i := range items {
		items[i] = map[string]interface{}{"type": "function"}
	}
	out := compactValue(items)
	arr, ok := out.([]interface{})
	if !ok {
		t.Fatalf("compactValue returned %#v, want array", out)
	}
	if len(arr) != 1 {
		t.Fatalf("len = %d, want 1", len(arr))
	}
	if _, ok := arr[0].(map[string]interface{}); !ok {
		t.Fatalf("truncated array contains non-object element %#v", arr[0])
	}
}

func TestCompactBody_longStringReplaced(t *testing.T) {
	body := map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{"role": "user", "content": "很长的内容很长的内容很长的内容很长的内容很长的内容很长的内容"},
		},
	}
	out := compactBody(body)
	if out == "" {
		t.Fatalf("compactBody returned empty")
	}
}

// TestCompactBody_repairsLegacyRecordedBody feeds a DisabledRecord body
// saved by an older build (which appended a bare "..." string to
// truncated arrays, and kept stream=true + stream_options) through
// sanitizeReplayBody — the exact payload replayProbe sends upstream.
func TestCompactBody_repairsLegacyRecordedBody(t *testing.T) {
	raw, err := os.ReadFile(os.Getenv("RECORD_BODY_FILE"))
	if err != nil {
		t.Skip("no record body file")
	}
	sanitized := sanitizeReplayBody(raw)
	if sanitized == nil {
		t.Fatalf("sanitizeReplayBody returned nil")
	}
	var out struct {
		Messages      []json.RawMessage `json:"messages"`
		Stream        *bool             `json:"stream"`
		StreamOptions json.RawMessage   `json:"stream_options"`
	}
	if err := json.Unmarshal(sanitized, &out); err != nil {
		t.Fatalf("sanitized body invalid: %v", err)
	}
	for i, m := range out.Messages {
		if strings.TrimSpace(string(m)) == `"..."` {
			t.Fatalf("messages[%d] is still a bare string placeholder", i)
		}
	}
	if out.Stream == nil || *out.Stream {
		t.Fatalf("stream must be forced false, got %v", out.Stream)
	}
	if len(out.StreamOptions) != 0 {
		t.Fatalf("stream_options must be dropped, got %s", out.StreamOptions)
	}
	t.Logf("sanitized body: %s", sanitized)
}
