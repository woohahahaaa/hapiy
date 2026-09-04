package relay

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestIntegrationHeaderKV_via_httptest(t *testing.T) {
	var mu sync.Mutex
	var captured string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		captured = r.Header.Get("X-Route")
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	eng := &Engine{}

	plan := &ExecutionPlan{
		CompiledRewrite: []CompiledRewriteChain{{
			RuleID: "integration-test",
			Ops: []RewriteOp{{
				Path:  "header.X-Route",
				Mode:  "set",
				Value: "premium-tier",
				Scope: "header",
			}},
		}},
	}

	req := &RelayRequest{
		Headers: map[string]string{"X-Other": "untouched"},
		Body:    map[string]interface{}{"model": "gpt-4"},
	}

	if err := eng.applyCompiledRewriteRules(plan, req); err != nil {
		t.Fatalf("applyCompiledRewriteRules: %v", err)
	}
	if req.Headers["X-Route"] != "premium-tier" {
		t.Fatalf("expected X-Route=premium-tier after rewrite, got %q", req.Headers["X-Route"])
	}
	if req.Headers["X-Other"] != "untouched" {
		t.Fatalf("expected X-Other=untouched preserved, got %q", req.Headers["X-Other"])
	}
	if req.Body["model"] != "gpt-4" {
		t.Fatalf("expected body.model unchanged, got %v", req.Body["model"])
	}

	httpReq, err := http.NewRequest("POST", server.URL, nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	eng.setupUpstreamHeaders(httpReq, "test-key", req)

	resp, err := server.Client().Do(httpReq)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	resp.Body.Close()

	mu.Lock()
	got := captured
	mu.Unlock()
	if got != "premium-tier" {
		t.Fatalf("expected mock upstream to see X-Route=premium-tier, got %q", got)
	}
}
