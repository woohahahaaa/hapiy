package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// newTopologyVersionTestDB is the topology test DB plus the version table.
func newTopologyVersionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := newTopologyTestDB(t)
	if err := db.AutoMigrate(&model.TopologyVersion{}); err != nil {
		t.Fatalf("automigrate version table: %v", err)
	}
	return db
}

// seedTopologyConfig replaces the live config with the given document, so the
// UpdatedAt is always fresh and the previous config is gone.
func seedTopologyConfig(t *testing.T, db *gorm.DB, document string) {
	t.Helper()
	if err := db.Where("id = ?", topologyConfigRowID).Delete(&model.TopologyConfig{}).Error; err != nil {
		t.Fatalf("clear config: %v", err)
	}
	config := model.TopologyConfig{ID: topologyConfigRowID, Version: topologySchemaVersion, Nodes: document, Edges: "[]"}
	if err := db.Create(&config).Error; err != nil {
		t.Fatalf("create topology config: %v", err)
	}
}

func bumpConfigUpdatedAt(t *testing.T, db *gorm.DB, at time.Time) {
	t.Helper()
	if err := db.Model(&model.TopologyConfig{}).Where("id = ?", topologyConfigRowID).
		Update("updated_at", at).Error; err != nil {
		t.Fatalf("bump updated_at: %v", err)
	}
}

func countTopologyVersions(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&model.TopologyVersion{}).Count(&count).Error; err != nil {
		t.Fatalf("count versions: %v", err)
	}
	return count
}

func versionsRequest(t *testing.T, method, path string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Handle(method, path, handler)
	req := httptest.NewRequest(method, path, bytes.NewBufferString(""))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// versionsRestoreRequest registers the restore route with a :id path parameter
// (as main.go does) and requests the given concrete id, so c.Param("id") is
// populated inside the handler.
func versionsRestoreRequest(t *testing.T, id string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Handle(http.MethodPost, "/api/versions/:id/restore", handler)
	req := httptest.NewRequest(http.MethodPost, "/api/versions/"+id+"/restore", bytes.NewBufferString(""))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func decodeVersionsData(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
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

func TestTopologyVersionArchive_idempotent(t *testing.T) {
	db := newTopologyVersionTestDB(t)
	seedTopologyConfig(t, db, `[[{"type":"provider","name":"A","provider_id":"p-a","enabled":true}]]`)

	rec := versionsRequest(t, http.MethodPost, "/api/archive", TopologyVersionArchive(db))
	decodeVersionsData(t, rec)
	if got := countTopologyVersions(t, db); got != 1 {
		t.Fatalf("archive: want 1 version, got %d", got)
	}

	rec = versionsRequest(t, http.MethodPost, "/api/archive", TopologyVersionArchive(db))
	decodeVersionsData(t, rec)
	if got := countTopologyVersions(t, db); got != 1 {
		t.Fatalf("archive not idempotent: want 1 version, got %d", got)
	}
}

func TestTopologyVersionArchive_respects_quiet_window(t *testing.T) {
	db := newTopologyVersionTestDB(t)
	seedTopologyConfig(t, db, `[[{"type":"provider","name":"A","provider_id":"p-a","enabled":true}]]`)

	// Fresh save: auto-archive (force=false) must not archive inside 5 min.
	if _, err := archiveCurrentTopology(db, false); err != nil {
		t.Fatalf("auto archive: %v", err)
	}
	if got := countTopologyVersions(t, db); got != 0 {
		t.Fatalf("quiet window: want 0 versions, got %d", got)
	}

	// Age the config past the window: auto-archive now captures it.
	bumpConfigUpdatedAt(t, db, time.Now().Add(-topologyArchiveWindow-30*time.Second))
	if _, err := archiveCurrentTopology(db, false); err != nil {
		t.Fatalf("auto archive after window: %v", err)
	}
	if got := countTopologyVersions(t, db); got != 1 {
		t.Fatalf("after window: want 1 version, got %d", got)
	}

	// Manual archive (force=true) always captures, even when fresh.
	seedTopologyConfig(t, db, `[[{"type":"provider","name":"A","provider_id":"p-a","enabled":true}]]`)
	if _, err := archiveCurrentTopology(db, true); err != nil {
		t.Fatalf("force archive: %v", err)
	}
	if got := countTopologyVersions(t, db); got != 2 {
		t.Fatalf("force archive: want 2 versions, got %d", got)
	}
}

func TestTopologyVersionArchive_caps_at_twenty(t *testing.T) {
	db := newTopologyVersionTestDB(t)
	seedTopologyConfig(t, db, `[[{"type":"provider","name":"A","provider_id":"p-a","enabled":true}]]`)

	for i := 0; i < maxTopologyVersions+5; i++ {
		// Each iteration looks like a distinct save (fresh UpdatedAt) followed
		// by a manual archive.
		bumpConfigUpdatedAt(t, db, time.Now().Add(time.Duration(i)*time.Second))
		if _, err := archiveCurrentTopology(db, true); err != nil {
			t.Fatalf("archive iteration %d: %v", i, err)
		}
	}
	if got := countTopologyVersions(t, db); got != maxTopologyVersions {
		t.Fatalf("cap: want %d versions, got %d", maxTopologyVersions, got)
	}
}

func TestTopologyVersionList_shape(t *testing.T) {
	db := newTopologyVersionTestDB(t)
	seedTopologyConfig(t, db, `[[{"type":"provider","name":"A","provider_id":"p-a","enabled":true}]]`)

	rec := versionsRequest(t, http.MethodGet, "/api/versions", TopologyVersionList(db))
	data := decodeVersionsData(t, rec)
	if data["current"] == nil {
		t.Fatalf("current must not be nil when a config exists")
	}
	if versions := data["versions"].([]any); len(versions) != 0 {
		t.Fatalf("unarchived current: want 0 versions, got %d", len(versions))
	}

	versionsRequest(t, http.MethodPost, "/api/archive", TopologyVersionArchive(db))
	rec = versionsRequest(t, http.MethodGet, "/api/versions", TopologyVersionList(db))
	data = decodeVersionsData(t, rec)
	current := data["current"].(map[string]any)
	if current["archived"] != true {
		t.Fatalf("current.archived: want true after archive")
	}
	// The newest version duplicates the current live state and must be skipped.
	if versions := data["versions"].([]any); len(versions) != 0 {
		t.Fatalf("archived current: want 0 versions (current row covers it), got %d", len(versions))
	}
}

func TestTopologyVersionRestore_applies_snapshot(t *testing.T) {
	db := newTopologyVersionTestDB(t)
	provider := model.Provider{ID: "p-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	rule := model.RewriteRule{ID: "r-1", Name: "rewrite", Script: "", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}
	refresher := &topologyRefreshFake{}

	v1 := `[[{"type":"provider","name":"A","provider_id":"p-a","enabled":true},
		{"type":"requestModify","name":"rewrite","rule_id":"r-1","order":1,"enabled":true}]]`
	seedTopologyConfig(t, db, v1)
	rec := versionsRequest(t, http.MethodPost, "/api/archive", TopologyVersionArchive(db))
	data := decodeVersionsData(t, rec)
	versions := data["versions"].([]any)
	if len(versions) == 0 {
		// After archiving, current duplicates v1 so versions is empty; fetch the
		// version id straight from the table instead.
	}
	var stored model.TopologyVersion
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("load stored version: %v", err)
	}

	// Change the live state to something else, then restore the snapshot.
	seedTopologyConfig(t, db, `[[{"type":"provider","name":"A","provider_id":"p-a","enabled":true}]]`)
	rec = versionsRestoreRequest(t, stored.ID, TopologyVersionRestore(db, refresher))
	decodeVersionsData(t, rec)

	document, err := loadTopologyDocument(db)
	if err != nil {
		t.Fatalf("load after restore: %v", err)
	}
	if len(document) != 1 || len(document[0]) != 2 {
		t.Fatalf("restored document mismatch: %v", document)
	}
	if document[0][1].Name != "rewrite" {
		t.Fatalf("restored slot node wrong: %v", document[0][1])
	}
	if refresher.calls != 1 {
		t.Fatalf("refresh calls: want 1, got %d", refresher.calls)
	}
}

func TestTopologyVersionRestore_archives_current_first(t *testing.T) {
	db := newTopologyVersionTestDB(t)
	provider := model.Provider{ID: "p-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	refresher := &topologyRefreshFake{}

	// Save v1, archive it, then move live to v2 (fresh config, not archived).
	v1 := `[[{"type":"provider","name":"A","provider_id":"p-a","enabled":true}]]`
	seedTopologyConfig(t, db, v1)
	versionsRequest(t, http.MethodPost, "/api/archive", TopologyVersionArchive(db))
	var stored model.TopologyVersion
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("load stored version: %v", err)
	}
	seedTopologyConfig(t, db, `[[{"type":"provider","name":"A","provider_id":"p-a","enabled":false}]]`)

	// Restore v1: the current (v2) must be archived first.
	rec := versionsRestoreRequest(t, stored.ID, TopologyVersionRestore(db, refresher))
	data := decodeVersionsData(t, rec)
	current := data["current"].(map[string]any)
	// Restore writes a fresh config row with a new UpdatedAt, so the restored
	// live state is "current but not archived" (a new 5-minute quiet window).
	if current["archived"] != false {
		t.Fatalf("restored live state must be unarchived (fresh config after restore), got %v", current["archived"])
	}
	// The pre-restore v2 was archived first; no version duplicates the (fresh)
	// live state, so both v1 and the archived v2 are listed.
	if versions := data["versions"].([]any); len(versions) != 2 {
		t.Fatalf("versions after restore: want 2 entries, got %d", len(versions))
	}
	if got := countTopologyVersions(t, db); got != 2 {
		t.Fatalf("versions stored: want 2, got %d", got)
	}
}

func TestTopologyVersionGet_not_found(t *testing.T) {
	db := newTopologyVersionTestDB(t)
	rec := versionsRequest(t, http.MethodGet, "/api/versions/does-not-exist", TopologyVersionGet(db))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d", rec.Code)
	}
}
