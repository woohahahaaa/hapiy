package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/relay"
)

func flatTopologyRequest(t *testing.T, method, body string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Handle(method, "/flat-topology", handler)
	req := httptest.NewRequest(method, "/flat-topology", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func decodeFlatTopologyData(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return envelope.Data
}

func TestGetFlatTopology_returns_version_and_updated_at(t *testing.T) {
	db := newTopologyTestDB(t)
	seedTopologyConfig(t, db, `{"nodes":[{"id":"e1","kind":"requestEntry","name":"A","enabled":true}],"wires":[]}`)

	data := decodeFlatTopologyData(t, flatTopologyRequest(t, http.MethodGet, "", GetFlatTopology(db)))

	version, ok := data["version"]
	if !ok {
		t.Fatalf("version missing from response: %v", data)
	}
	if int(version.(float64)) != topologySchemaVersion {
		t.Fatalf("version: want %d, got %v", topologySchemaVersion, version)
	}
	if _, ok := data["updated_at"]; !ok {
		t.Fatalf("updated_at missing from response: %v", data)
	}
	if data["nodes"] == nil || data["wires"] == nil {
		t.Fatalf("nodes/wires missing from response: %v", data)
	}
}

func TestSaveFlatTopology_bumps_version(t *testing.T) {
	db := newTopologyTestDB(t)
	seedTopologyConfig(t, db, `{"nodes":[{"id":"e1","kind":"requestEntry","name":"A","enabled":true}],"wires":[]}`)
	engine := relay.NewEngine(db)
	body := `{"nodes":[{"id":"e1","kind":"requestEntry","name":"A","enabled":true},{"id":"ps1","kind":"slot","slot_type":"provider","enabled":true}],"wires":[{"source":"e1","target":"ps1"}]}`

	rec := flatTopologyRequest(t, http.MethodPut, body, SaveFlatTopology(db, engine))
	data := decodeFlatTopologyData(t, rec)
	if v := int(data["version"].(float64)); v != topologySchemaVersion+1 {
		t.Fatalf("version after first save: want %d, got %d", topologySchemaVersion+1, v)
	}

	rec = flatTopologyRequest(t, http.MethodPut, body, SaveFlatTopology(db, engine))
	data = decodeFlatTopologyData(t, rec)
	if v := int(data["version"].(float64)); v != topologySchemaVersion+2 {
		t.Fatalf("version after second save: want %d, got %d", topologySchemaVersion+2, v)
	}
}

func TestSaveFlatTopology_creates_row_when_missing(t *testing.T) {
	db := newTopologyTestDB(t)
	engine := relay.NewEngine(db)
	body := `{"nodes":[{"id":"e1","kind":"requestEntry","name":"A","enabled":true}],"wires":[]}`

	data := decodeFlatTopologyData(t, flatTopologyRequest(t, http.MethodPut, body, SaveFlatTopology(db, engine)))
	if v := int(data["version"].(float64)); v != 1 {
		t.Fatalf("version on first create: want 1, got %d", v)
	}
}
