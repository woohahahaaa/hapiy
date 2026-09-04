package relay

import (
	"net/http"
	"testing"
)

func TestSetupUpstreamHeaders_stripsHapiySource(t *testing.T) {
	eng := &Engine{}
	req := &RelayRequest{
		Headers: map[string]string{
			"X-Hapiy-Source":   "__opencodetest",
			"X-Session-Id":     "ses_keep_me",        // client-owned, must pass through
			"X-Custom-Through": "untouched",          // arbitrary client header, must pass through
		},
	}

	httpReq, err := http.NewRequest("POST", "http://example.invalid/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	eng.setupUpstreamHeaders(httpReq, "test-key", req)

	if got := httpReq.Header.Get("X-Hapiy-Source"); got != "" {
		t.Fatalf("X-Hapiy-Source must not reach upstream, got %q", got)
	}
	if got := httpReq.Header.Get("Authorization"); got != "Bearer test-key" {
		t.Fatalf("Authorization must be replaced with provider key, got %q", got)
	}
	if got := httpReq.Header.Get("X-Session-Id"); got != "ses_keep_me" {
		t.Fatalf("client header X-Session-Id must pass through, got %q", got)
	}
	if got := httpReq.Header.Get("X-Custom-Through"); got != "untouched" {
		t.Fatalf("arbitrary client header must pass through, got %q", got)
	}
}
