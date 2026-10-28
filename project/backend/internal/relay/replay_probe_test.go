package relay

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestReplayProbe_BaseURLWithV1Suffix covers the dashboard's "test upstream"
// action: the recorded base URL may already end in /v1, and the probe must
// collapse the duplicate instead of requesting /v1/v1/chat/completions.
func TestReplayProbe_BaseURLWithV1Suffix(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer server.Close()

	engine := &Engine{}
	result := engine.replayProbe(server.URL+"/v1", "k", "m", nil)
	if !result.Success {
		t.Fatalf("probe failed: %s", result.ErrorMessage)
	}
	if gotPath != "/v1/chat/completions" {
		t.Fatalf("probe path = %q, want %q", gotPath, "/v1/chat/completions")
	}
}
