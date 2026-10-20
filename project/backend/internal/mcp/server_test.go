package mcp

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func newTestServer(t *testing.T, db *gorm.DB) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Any(EndpointPath, Handler(db, "1.0.0"))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func postMCP(t *testing.T, url, key, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewBufferString(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, string(raw)
}

const initializeBody = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}`

func TestEndpointIsClosedUntilEnabled(t *testing.T) {
	db := newTestDB(t)
	srv := newTestServer(t, db)

	code, _ := postMCP(t, srv.URL+EndpointPath, "", initializeBody)
	if code != http.StatusNotFound {
		t.Fatalf("disabled endpoint must answer 404, got %d", code)
	}
}

func TestEndpointRequiresGeneratedKey(t *testing.T) {
	db := newTestDB(t)
	if _, err := UpdateStatus(db, true); err != nil {
		t.Fatal(err)
	}
	status, err := ReadStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Enabled || !strings.HasPrefix(status.APIKey, "hm-") {
		t.Fatalf("enabling must generate a key, got %+v", status)
	}
	srv := newTestServer(t, db)

	code, _ := postMCP(t, srv.URL+EndpointPath, "", initializeBody)
	if code != http.StatusUnauthorized {
		t.Fatalf("missing key must answer 401, got %d", code)
	}
	code, _ = postMCP(t, srv.URL+EndpointPath, "hm-wrong", initializeBody)
	if code != http.StatusUnauthorized {
		t.Fatalf("wrong key must answer 401, got %d", code)
	}
	code, body := postMCP(t, srv.URL+EndpointPath, status.APIKey, initializeBody)
	if code != http.StatusOK {
		t.Fatalf("valid key must answer 200, got %d: %s", code, body)
	}
	if !strings.Contains(body, `"name":"hapiy"`) {
		t.Fatalf("initialize response must name the server: %s", body)
	}

	code, body = postMCP(t, srv.URL+EndpointPath, status.APIKey, `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`)
	if code != http.StatusOK || !strings.Contains(body, "list_providers") {
		t.Fatalf("tools/list failed: %d %s", code, body)
	}
}

func TestRotateKeyInvalidatesPreviousKey(t *testing.T) {
	db := newTestDB(t)
	first, err := UpdateStatus(db, true)
	if err != nil {
		t.Fatal(err)
	}
	srv := newTestServer(t, db)

	second, err := RotateKey(db)
	if err != nil {
		t.Fatal(err)
	}
	if second.APIKey == first.APIKey {
		t.Fatal("rotate must produce a different key")
	}
	if code, _ := postMCP(t, srv.URL+EndpointPath, first.APIKey, initializeBody); code != http.StatusUnauthorized {
		t.Fatalf("old key must be rejected, got %d", code)
	}
	if code, body := postMCP(t, srv.URL+EndpointPath, second.APIKey, initializeBody); code != http.StatusOK {
		t.Fatalf("new key must be accepted, got %d: %s", code, body)
	}
}

func TestDisablingEndpointClosesAccess(t *testing.T) {
	db := newTestDB(t)
	status, err := UpdateStatus(db, true)
	if err != nil {
		t.Fatal(err)
	}
	srv := newTestServer(t, db)

	if code, _ := postMCP(t, srv.URL+EndpointPath, status.APIKey, initializeBody); code != http.StatusOK {
		t.Fatalf("enabled endpoint must accept the key, got %d", code)
	}
	if _, err := UpdateStatus(db, false); err != nil {
		t.Fatal(err)
	}
	if code, _ := postMCP(t, srv.URL+EndpointPath, status.APIKey, initializeBody); code != http.StatusNotFound {
		t.Fatalf("disabled endpoint must answer 404 even with a valid key, got %d", code)
	}
	// The key itself is preserved so re-enabling does not hand out a new one.
	reopened, err := UpdateStatus(db, true)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.APIKey != status.APIKey {
		t.Fatal("re-enabling must keep the existing key")
	}
}
