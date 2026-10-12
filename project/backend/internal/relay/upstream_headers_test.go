package relay

import (
	"net/http"
	"testing"
)

// hapiy 不再注入、也不再剥离 来源标记：标记走 gin context
// (service.SetSourceMark)，客户端自己发的 X-Hapiy-Source 与其他自定义头
// 一样原样透传到上游。
func TestSetupUpstreamHeaders_passesClientHeadersThrough(t *testing.T) {
	eng := &Engine{}
	req := &RelayRequest{
		Headers: map[string]string{
			"X-Hapiy-Source":   "__client_owned",
			"X-Session-Id":     "ses_keep_me", // client-owned, must pass through
			"X-Custom-Through": "untouched",   // arbitrary client header, must pass through
		},
	}

	httpReq, err := http.NewRequest("POST", "http://example.invalid/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	eng.setupUpstreamHeaders(httpReq, "test-key", req)

	if got := httpReq.Header.Get("X-Hapiy-Source"); got != "__client_owned" {
		t.Fatalf("client header X-Hapiy-Source must pass through untouched, got %q", got)
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
