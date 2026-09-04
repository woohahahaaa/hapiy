package handler_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/handler"
	"github.com/hapiy/hapiy/internal/relay"
)

// TestRelayInvalidJSONCompletesMetrics pins the contract that a malformed JSON
// payload to the Relay handler returns 400 AND decrements the active_requests
// gauge back to its pre-request baseline.
//
// The bug under test: Relay calls common.Global().BeginRequest() unconditionally
// and only releases the counter on the success/error paths. The
// json.Unmarshal failure path returns 400 without ever calling EndRequest,
// leaking an active request forever.
func TestRelayInvalidJSONCompletesMetrics(t *testing.T) {
	// Given: a Gin router with the real Relay handler and a known metrics baseline.
	gin.SetMode(gin.TestMode)
	engine := relay.NewEngine(nil) // malformed JSON returns before any engine method is called
	router := gin.New()
	router.POST("/v1/chat/completions", handler.Relay(nil, engine))

	before := common.Global().Snapshot().ActiveRequests

	// When: a request with malformed JSON is sent.
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		bytes.NewReader([]byte("{this is not valid json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Then: the handler responds 400 with the documented error body.
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid request format") {
		t.Fatalf("body: want error to mention 'invalid request format', got %s", rec.Body.String())
	}

	// Then: active_requests returns to its pre-request baseline
	// (the bug leaks +1 on this code path).
	after := common.Global().Snapshot().ActiveRequests
	if after != before {
		t.Fatalf("active_requests leaked: baseline=%d, after=%d (delta=%d)",
			before, after, after-before)
	}
}
