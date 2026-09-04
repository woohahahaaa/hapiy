package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type topologyRefreshFake struct {
	calls int
	err   error
}

func (f *topologyRefreshFake) PrepareTopologyRefresh(_ *gorm.DB) (func(), error) {
	f.calls++
	return nil, f.err
}

func newTopologyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.Provider{},
		&model.RewriteRule{},
		&model.ResponseRewriteRule{},
		&model.HeartbeatRule{},
		&model.ConcurrencyRule{},
		&model.FailoverRule{},
		&model.TopologyState{},
		&model.TopologyConfig{},
		&model.TopologySlotAssignment{},
	); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func topologyRequest(t *testing.T, method, body string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Handle(method, "/topology", handler)
	req := httptest.NewRequest(method, "/topology", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestTopologyGet_returns_empty_array_on_new_database(t *testing.T) {
	db := newTopologyTestDB(t)
	rec := topologyRequest(t, http.MethodGet, "", TopologyGet(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != `[]` {
		t.Fatalf("body: got %s", rec.Body.String())
	}
}

func TestTopologyPut_preserves_provider_only_workflows(t *testing.T) {
	db := newTopologyTestDB(t)
	providers := []model.Provider{
		{ID: "p-a", Name: "wooh-anthropic", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true},
		{ID: "p-b", Name: "wooh-openai-r", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true},
		{ID: "p-c", Name: "wooh-openai-c", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	refresher := &topologyRefreshFake{}
	body := `[[{"type":"provider","name":"wooh-anthropic","provider_id":"p-a"}],` +
		`[{"type":"provider","name":"wooh-openai-r","provider_id":"p-b"}],` +
		`[{"type":"provider","name":"wooh-openai-c","provider_id":"p-c"}]]`

	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var document TopologyDocument
	if err := json.Unmarshal(rec.Body.Bytes(), &document); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(document) != 3 {
		t.Fatalf("provider-only workflows lost: got %d workflows", len(document))
	}
	for i, workflow := range document {
		if len(workflow) != 1 || workflow[0].Type != "provider" {
			t.Fatalf("workflow %d: want single provider node, got %v", i, workflow)
		}
	}

	rec = topologyRequest(t, http.MethodGet, "", TopologyGet(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &document); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if len(document) != 3 {
		t.Fatalf("GET: provider-only workflows lost after reload, got %d", len(document))
	}
}

func TestTopologyPut_saves_workflow_and_returns_canonical_order(t *testing.T) {
	db := newTopologyTestDB(t)
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	rule := model.RewriteRule{ID: "rewrite-a", Name: "rewrite", Script: "", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}
	refresher := &topologyRefreshFake{}
	body := `[[` +
		`{"type":"provider","name":"A","provider_id":"provider-a"},` +
		`{"type":"requestModify","name":"rewrite","rule_id":"rewrite-a","order":1,"enabled":true},` +
		`{"type":"logOutput","name":"log","enabled":true,"config":{"prefix":"my-logs","record_request":true,"record_modified_request":true,"record_response":true,"record_modified_response":true,"record_system":true,"merge_stream":true,"auto_close_minutes":5}}` +
		`]]`

	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var document TopologyDocument
	if err := json.Unmarshal(rec.Body.Bytes(), &document); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(document) != 1 || len(document[0]) != 3 {
		t.Fatalf("unexpected document: %v", document)
	}
	if document[0][1].Type != "requestModify" || document[0][2].Type != "logOutput" {
		t.Fatalf("nodes not canonically sorted: %v", document[0])
	}
	if refresher.calls != 1 {
		t.Fatalf("refresh calls: want 1, got %d", refresher.calls)
	}
}

func TestTopologyPut_resolves_rule_by_name_when_rule_id_omitted(t *testing.T) {
	db := newTopologyTestDB(t)
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	rule := model.RewriteRule{ID: "rewrite-a", Name: "my rewrite", Script: "", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}
	refresher := &topologyRefreshFake{}
	body := `[[` +
		`{"type":"provider","name":"A"},` +
		`{"type":"requestModify","name":"my rewrite","order":1}` +
		`]]`

	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var document TopologyDocument
	if err := json.Unmarshal(rec.Body.Bytes(), &document); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(document) != 1 || len(document[0]) != 2 {
		t.Fatalf("unexpected document: %v", document)
	}
	if document[0][1].RuleID == nil || *document[0][1].RuleID != "rewrite-a" {
		t.Fatalf("rule_id not backfilled: %v", document[0][1])
	}
}

func TestTopologyPut_rejects_unknown_node_type(t *testing.T) {
	db := newTopologyTestDB(t)
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	refresher := &topologyRefreshFake{}
	body := `[[{"type":"provider","name":"A","provider_id":"provider-a"},{"type":"unknown","name":"x","order":1}]]`

	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422, got %d: %s", rec.Code, rec.Body.String())
	}
	if refresher.calls != 0 {
		t.Fatalf("refresh called for rejected document: %d", refresher.calls)
	}
}

func TestTopologyPut_rejects_camel_case_log_output_config_keys(t *testing.T) {
	db := newTopologyTestDB(t)
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	refresher := &topologyRefreshFake{}
	body := `[[{"type":"provider","name":"A","provider_id":"provider-a"},` +
		`{"type":"logOutput","name":"log","enabled":true,"config":{"logTarget":"file"}}]]`

	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422, got %d: %s", rec.Code, rec.Body.String())
	}
	if refresher.calls != 0 {
		t.Fatalf("refresh called for rejected document: %d", refresher.calls)
	}
}

func TestTopologyPut_keeps_database_unchanged_when_candidate_refresh_fails(t *testing.T) {
	db := newTopologyTestDB(t)
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	existing := model.TopologySlotAssignment{ID: "existing", ProviderID: provider.ID, SlotType: "logOutput", Order: 1, Enabled: true, Config: `{}`}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("create assignment: %v", err)
	}
	refresher := &topologyRefreshFake{err: errors.New("candidate failed")}
	body := `[[{"type":"provider","name":"A","provider_id":"provider-a"}]]`

	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500, got %d: %s", rec.Code, rec.Body.String())
	}
	var count int64
	if err := db.Model(&model.TopologySlotAssignment{}).Where("id = ?", existing.ID).Count(&count).Error; err != nil {
		t.Fatalf("count assignment: %v", err)
	}
	if count != 1 || refresher.calls != 1 {
		t.Fatalf("assignments or candidate calls: count=%d calls=%d", count, refresher.calls)
	}
}
