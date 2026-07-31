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
		&model.Channel{},
		&model.RewriteRule{},
		&model.ResponseRewriteRule{},
		&model.HeartbeatRule{},
		&model.ConcurrencyRule{},
		&model.FailoverRule{},
		&model.TopologyState{},
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

func TestTopologyGet_returns_empty_revision_without_writing_on_new_database(t *testing.T) {
	// Given
	db := newTopologyTestDB(t)

	// When
	rec := topologyRequest(t, http.MethodGet, "", TopologyGet(db))

	// Then
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != `{"schema_version":1,"revision":0,"slots":[]}` {
		t.Fatalf("body: got %s", rec.Body.String())
	}
	var count int64
	if err := db.Model(&model.TopologyState{}).Count(&count).Error; err != nil {
		t.Fatalf("count topology state: %v", err)
	}
	if count != 0 {
		t.Fatalf("GET wrote topology state: count=%d", count)
	}
}

func TestTopologyPut_replaces_assignments_in_canonical_order_and_increments_revision(t *testing.T) {
	// Given
	db := newTopologyTestDB(t)
	channel := model.Channel{ID: "channel-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	rule := model.RewriteRule{ID: "rewrite-a", Name: "rewrite", Status: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}
	refresher := &topologyRefreshFake{}
	body := `{"schema_version":1,"revision":0,"slots":[` +
		`{"id":"log","channel_id":"channel-a","slot_type":"logOutput","order":1,"enabled":true,"rule_id":null,"config":{"log_target":"file","record_request_before":true}},` +
		`{"id":"rewrite","channel_id":"channel-a","slot_type":"requestModify","order":1,"enabled":true,"rule_id":"rewrite-a","config":{}}]}`

	// When
	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))

	// Then
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var document TopologyDocument
	if err := json.Unmarshal(rec.Body.Bytes(), &document); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if document.Revision != 1 || len(document.Slots) != 2 {
		t.Fatalf("unexpected document: %+v", document)
	}
	if document.Slots[0].ID != "rewrite" || document.Slots[1].ID != "log" {
		t.Fatalf("slots not canonically sorted: %+v", document.Slots)
	}
	if refresher.calls != 1 {
		t.Fatalf("refresh calls: want 1, got %d", refresher.calls)
	}
}

func TestTopologyPut_rejects_unknown_fields_without_modifying_existing_assignments(t *testing.T) {
	// Given
	db := newTopologyTestDB(t)
	state := model.TopologyState{ID: 1, SchemaVersion: 1, Revision: 4}
	assignment := model.TopologySlotAssignment{ID: "existing", ChannelID: "channel-a", SlotType: "logOutput", Order: 1, Enabled: true, Config: `{}`}
	if err := db.Create(&state).Error; err != nil {
		t.Fatalf("create state: %v", err)
	}
	if err := db.Create(&assignment).Error; err != nil {
		t.Fatalf("create assignment: %v", err)
	}
	refresher := &topologyRefreshFake{}
	body := `{"schema_version":1,"revision":4,"slots":[],"unexpected":true}`

	// When
	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))

	// Then
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422, got %d: %s", rec.Code, rec.Body.String())
	}
	var count int64
	if err := db.Model(&model.TopologySlotAssignment{}).Where("id = ?", "existing").Count(&count).Error; err != nil {
		t.Fatalf("count assignment: %v", err)
	}
	if count != 1 || refresher.calls != 0 {
		t.Fatalf("old topology changed or refresh called: count=%d calls=%d", count, refresher.calls)
	}
}

func TestTopologyPut_rejects_camel_case_log_output_config_keys(t *testing.T) {
	// Given
	db := newTopologyTestDB(t)
	channel := model.Channel{ID: "channel-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	refresher := &topologyRefreshFake{}
	body := `{"schema_version":1,"revision":0,"slots":[` +
		`{"id":"log","channel_id":"channel-a","slot_type":"logOutput","order":1,"enabled":true,"rule_id":null,"config":{"logTarget":"file"}}]}`

	// When
	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))

	// Then
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422, got %d: %s", rec.Code, rec.Body.String())
	}
	if refresher.calls != 0 {
		t.Fatalf("refresh called for rejected document: %d", refresher.calls)
	}
}

func TestTopologyPut_returns_revision_conflict_without_modifying_assignments(t *testing.T) {
	// Given
	db := newTopologyTestDB(t)
	state := model.TopologyState{ID: 1, SchemaVersion: 1, Revision: 3}
	if err := db.Create(&state).Error; err != nil {
		t.Fatalf("create state: %v", err)
	}
	refresher := &topologyRefreshFake{}
	body := `{"schema_version":1,"revision":2,"slots":[]}`

	// When
	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))

	// Then
	if rec.Code != http.StatusConflict {
		t.Fatalf("status: want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != `{"current_revision":3,"error":"topology_revision_conflict"}` {
		t.Fatalf("body: got %s", rec.Body.String())
	}
	if refresher.calls != 0 {
		t.Fatalf("refresh called on conflict: %d", refresher.calls)
	}
}

func TestTopologyPut_keeps_database_unchanged_when_candidate_refresh_fails(t *testing.T) {
	// Given
	db := newTopologyTestDB(t)
	channel := model.Channel{ID: "channel-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	existing := model.TopologySlotAssignment{ID: "existing", ChannelID: channel.ID, SlotType: "logOutput", Order: 1, Enabled: true, Config: `{}`}
	state := model.TopologyState{ID: 1, SchemaVersion: 1, Revision: 2}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := db.Create(&state).Error; err != nil {
		t.Fatalf("create state: %v", err)
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("create assignment: %v", err)
	}
	refresher := &topologyRefreshFake{err: errors.New("candidate failed")}
	body := `{"schema_version":1,"revision":2,"slots":[]}`

	// When
	rec := topologyRequest(t, http.MethodPut, body, TopologyPut(db, refresher))

	// Then
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500, got %d: %s", rec.Code, rec.Body.String())
	}
	var savedState model.TopologyState
	if err := db.First(&savedState, 1).Error; err != nil {
		t.Fatalf("load state: %v", err)
	}
	if savedState.Revision != 2 {
		t.Fatalf("revision changed after failed candidate refresh: %d", savedState.Revision)
	}
	var count int64
	if err := db.Model(&model.TopologySlotAssignment{}).Where("id = ?", existing.ID).Count(&count).Error; err != nil {
		t.Fatalf("count assignment: %v", err)
	}
	if count != 1 || refresher.calls != 1 {
		t.Fatalf("assignments or candidate calls: count=%d calls=%d", count, refresher.calls)
	}
}
