package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestProbeChannel_BaseURLWithV1Suffix locks the auto-recovery probe to the
// same URL join as the relay path: a provider whose base URL already carries
// /v1 must not be probed at /v1/v1/chat/completions (a 404 on most upstreams).
func TestProbeChannel_BaseURLWithV1Suffix(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer server.Close()

	result := defaultChannelProbe(server.URL+"/v1", "k", "m")
	if !result.Success {
		t.Fatalf("probe failed: %s", result.ErrorMessage)
	}
	if gotPath != "/v1/chat/completions" {
		t.Fatalf("probe path = %q, want %q", gotPath, "/v1/chat/completions")
	}
}
