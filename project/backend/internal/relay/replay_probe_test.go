package relay

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
)

// TestReplayProbe_baseURLWithV1Suffix covers legacy records (no UpstreamURL):
// the recorded base URL may already end in /v1, and the probe must collapse
// the duplicate instead of requesting /v1/v1/chat/completions.
func TestReplayProbe_baseURLWithV1Suffix(t *testing.T) {
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

// TestReplayProbe_usesRecordedUpstreamURL: the URL captured at disable time
// wins verbatim, so recovery never rebuilds the path (even for a custom
// endpoint the join logic would not reproduce).
func TestReplayProbe_usesRecordedUpstreamURL(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer server.Close()

	record := &model.DisabledRecord{UpstreamURL: server.URL + "/custom/route/chat"}
	engine := &Engine{}
	result := engine.replayProbe("https://unused.example/v1", "k", "m", record)
	if !result.Success {
		t.Fatalf("probe failed: %s", result.ErrorMessage)
	}
	if gotPath != "/custom/route/chat" {
		t.Fatalf("probe path = %q, want the recorded %q", gotPath, "/custom/route/chat")
	}
}

// TestSaveDisabledRecord_persistsUpstreamURL locks the capture side: the
// exact URL issued for the failed request is stored on the record.
func TestSaveDisabledRecord_persistsUpstreamURL(t *testing.T) {
	db := newRelayTestDB(t, &model.DisabledRecord{})
	engine := NewEngine(db)
	req := &RelayRequest{
		Model: "m",
		Path:  "/v1/chat/completions",
		Body:  map[string]interface{}{"model": "m"},
	}
	engine.saveDisabledRecord("p", model.FailoverDimensionKey, "k", "https://h/v1", "k", "https://h/v1/chat/completions", req, "", nil)

	var row model.DisabledRecord
	if err := db.First(&row).Error; err != nil {
		t.Fatalf("load record: %v", err)
	}
	if row.UpstreamURL != "https://h/v1/chat/completions" {
		t.Fatalf("upstream URL = %q, want %q", row.UpstreamURL, "https://h/v1/chat/completions")
	}
}
