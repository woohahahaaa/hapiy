package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/topology"
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

func TestDeriveFlatAssignments_assigns_provider_rule_with_correct_fields(t *testing.T) {
	db := newTopologyTestDB(t)
	provider := model.Provider{ID: "p-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true, WorkflowEnabled: true}
	rule := model.RewriteRule{ID: "rewrite-a", Name: "rewrite", Script: "", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}

	// Provider has one outgoing wire to a requestModify slot with one entry.
	tp := &topology.Topology{
		Nodes: []topology.FlatNode{
			{ID: "e1", Kind: topology.KindRequestEntry, Enabled: true},
			{ID: "p1", Kind: topology.KindProvider, Name: "A", Enabled: true},
			{
				ID: "rm1", Kind: topology.KindSlot, SlotType: "requestModify", Enabled: true,
				Entries: json.RawMessage(`[{"id":"r1","slotType":"requestModify","index":3,"ruleId":"rewrite-a","enabled":true,"config":{}}]`),
			},
		},
		Wires: []topology.Wire{{Source: "p1", Target: "rm1"}},
	}

	rows, err := deriveFlatAssignments(db, tp)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows: want 1, got %d (%v)", len(rows), rows)
	}
	row := rows[0]
	if row.ProviderID != provider.ID {
		t.Errorf("provider_id: want %s, got %s", provider.ID, row.ProviderID)
	}
	if row.SlotType != "requestModify" {
		t.Errorf("slot_type: want requestModify, got %s", row.SlotType)
	}
	if row.Order != 3 {
		t.Errorf("order: want 3, got %d", row.Order)
	}
	if !row.Enabled {
		t.Errorf("enabled: want true, got false")
	}
	if row.RuleID == nil || *row.RuleID != rule.ID {
		t.Errorf("rule_id: want %s, got %v", rule.ID, row.RuleID)
	}
}

func TestDeriveFlatAssignments_skips_missing_rule_without_error(t *testing.T) {
	db := newTopologyTestDB(t)
	provider := model.Provider{ID: "p-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true, WorkflowEnabled: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}

	// One entry points at a rule id that does not exist; a second entry
	// has an empty ruleId. Both should be skipped without erroring.
	tp := &topology.Topology{
		Nodes: []topology.FlatNode{
			{ID: "p1", Kind: topology.KindProvider, Name: "A", Enabled: true},
			{
				ID: "rm1", Kind: topology.KindSlot, SlotType: "requestModify", Enabled: true,
				Entries: json.RawMessage(`[{"id":"r1","slotType":"requestModify","index":1,"ruleId":"missing","enabled":true,"config":{}},` +
					`{"id":"r2","slotType":"requestModify","index":2,"ruleId":"","enabled":true,"config":{}}]`),
			},
		},
		Wires: []topology.Wire{{Source: "p1", Target: "rm1"}},
	}

	rows, err := deriveFlatAssignments(db, tp)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows: want 0 (both skipped), got %d (%v)", len(rows), rows)
	}
}

func TestDeriveFlatAssignments_emits_log_output_with_nil_rule(t *testing.T) {
	db := newTopologyTestDB(t)
	provider := model.Provider{ID: "p-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true, WorkflowEnabled: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}

	logCfg := `{"prefix":"x","record_request":true,"auto_close_minutes":5}`
	tp := &topology.Topology{
		Nodes: []topology.FlatNode{
			{ID: "p1", Kind: topology.KindProvider, Name: "A", Enabled: true},
			{
				ID: "lo1", Kind: topology.KindSlot, SlotType: "logOutput", Enabled: true,
				Entries: json.RawMessage(`[{"id":"l1","slotType":"logOutput","index":1,"enabled":true,"config":` + logCfg + `}]`),
			},
		},
		Wires: []topology.Wire{{Source: "p1", Target: "lo1"}},
	}

	rows, err := deriveFlatAssignments(db, tp)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows: want 1, got %d", len(rows))
	}
	if rows[0].RuleID != nil {
		t.Errorf("rule_id: want nil for logOutput, got %v", rows[0].RuleID)
	}
	if rows[0].SlotType != "logOutput" {
		t.Errorf("slot_type: want logOutput, got %s", rows[0].SlotType)
	}
	if rows[0].Config != logCfg {
		t.Errorf("config: want %s, got %s", logCfg, rows[0].Config)
	}
}
