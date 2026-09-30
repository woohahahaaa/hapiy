package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newAgentConfigVersionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.AgentConfigFile{}, &model.AgentConfigVersion{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func seedAgentConfigFile(t *testing.T, db *gorm.DB, path, content string) model.AgentConfigFile {
	t.Helper()
	row := model.AgentConfigFile{
		RecordName: "test-" + filepath.Base(filepath.Dir(path)) + "-" + filepath.Base(path),
		AgentType:  "opencode-v1",
		Mode:       "local",
		TargetOS:   "other",
		Path:       path,
		Content:    content,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("create config file: %v", err)
	}
	return row
}

func writeConfigFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write config file: %v", err)
	}
}

func countAgentConfigVersions(t *testing.T, db *gorm.DB, configID string) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&model.AgentConfigVersion{}).Where("config_id = ?", configID).Count(&count).Error; err != nil {
		t.Fatalf("count versions: %v", err)
	}
	return count
}

func versionRouter(t *testing.T, method, route string, handler gin.HandlerFunc, path string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Handle(method, route, handler)
	req := httptest.NewRequest(method, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func decodeVersionList(t *testing.T, rec *httptest.ResponseRecorder) (map[string]any, []map[string]any) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			Current  map[string]any   `json:"current"`
			Versions []map[string]any `json:"versions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return envelope.Data.Current, envelope.Data.Versions
}

func TestArchiveAgentConfigVersion_dedupes_identical_content(t *testing.T) {
	db := newAgentConfigVersionTestDB(t)
	row := seedAgentConfigFile(t, db, filepath.Join(t.TempDir(), "config.json"), "")

	if _, err := archiveAgentConfigVersion(db, row.ID, "{\"v\":1}\n"); err != nil {
		t.Fatalf("archive first: %v", err)
	}
	dup, err := archiveAgentConfigVersion(db, row.ID, "{\"v\":1}\n")
	if err != nil {
		t.Fatalf("archive duplicate: %v", err)
	}
	if dup != nil {
		t.Fatalf("identical content should be a no-op, got a new version")
	}
	if _, err := archiveAgentConfigVersion(db, row.ID, "{\"v\":2}\n"); err != nil {
		t.Fatalf("archive changed: %v", err)
	}
	if got := countAgentConfigVersions(t, db, row.ID); got != 2 {
		t.Fatalf("want 2 versions, got %d", got)
	}
}

func TestArchiveAgentConfigVersion_caps_history(t *testing.T) {
	db := newAgentConfigVersionTestDB(t)
	row := seedAgentConfigFile(t, db, filepath.Join(t.TempDir(), "config.json"), "")

	for i := 0; i < maxAgentConfigVersions+5; i++ {
		if _, err := archiveAgentConfigVersion(db, row.ID, fmt.Sprintf("{\"v\":%d}\n", i)); err != nil {
			t.Fatalf("archive %d: %v", i, err)
		}
	}
	if got := countAgentConfigVersions(t, db, row.ID); got != maxAgentConfigVersions {
		t.Fatalf("cap: want %d versions, got %d", maxAgentConfigVersions, got)
	}
}

func TestListAgentConfigVersions_derives_current_and_archived(t *testing.T) {
	db := newAgentConfigVersionTestDB(t)
	path := filepath.Join(t.TempDir(), "config.json")
	archived := "{\"v\":1}\n"
	writeConfigFile(t, path, archived)
	row := seedAgentConfigFile(t, db, path, archived)
	if _, err := archiveAgentConfigVersion(db, row.ID, archived); err != nil {
		t.Fatalf("archive: %v", err)
	}

	payload, err := agentConfigVersionList(db, &row, nil)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	current := payload["current"].(*agentConfigCurrentVersionDTO)
	if !current.Archived {
		t.Fatalf("current should be archived when it matches the newest snapshot")
	}
	if current.UpdatedAt == nil {
		t.Fatalf("archived current should carry the snapshot time")
	}
	// The newest snapshot duplicates the current row and must be hidden.
	if versions := payload["versions"].([]agentConfigVersionDTO); len(versions) != 0 {
		t.Fatalf("want 0 visible versions, got %d", len(versions))
	}

	// An external edit makes the current state unarchived again.
	writeConfigFile(t, path, "{\"v\":2}\n")
	payload, err = agentConfigVersionList(db, &row, nil)
	if err != nil {
		t.Fatalf("list after edit: %v", err)
	}
	current = payload["current"].(*agentConfigCurrentVersionDTO)
	if current.Archived {
		t.Fatalf("current should be unarchived after an external edit")
	}
	if versions := payload["versions"].([]agentConfigVersionDTO); len(versions) != 1 {
		t.Fatalf("want the old snapshot to remain, got %d", len(versions))
	}
}

func TestArchiveAgentConfigVersionHandler_snapshots_live_file(t *testing.T) {
	db := newAgentConfigVersionTestDB(t)
	path := filepath.Join(t.TempDir(), "config.json")
	writeConfigFile(t, path, "{\"v\":1}\n")
	row := seedAgentConfigFile(t, db, path, "")

	rec := versionRouter(t, http.MethodPost, "/api/:id/versions/archive",
		ArchiveAgentConfigVersion(db, nil), "/api/"+row.ID+"/versions/archive")
	current, versions := decodeVersionList(t, rec)
	if current["archived"] != true {
		t.Fatalf("current should be archived after the archive call: %v", current)
	}
	// The just-archived snapshot is shown as the current row, so the list is empty.
	if len(versions) != 0 {
		t.Fatalf("want 0 visible versions, got %d", len(versions))
	}
	if got := countAgentConfigVersions(t, db, row.ID); got != 1 {
		t.Fatalf("want 1 stored version, got %d", got)
	}
}

func TestRestoreAgentConfigVersion_archives_current_then_writes(t *testing.T) {	db := newAgentConfigVersionTestDB(t)
	path := filepath.Join(t.TempDir(), "config.json")
	target := "{\"v\":1}\n"
	current := "{\"v\":2}\n"
	writeConfigFile(t, path, current)
	row := seedAgentConfigFile(t, db, path, current)
	targetVersion, err := archiveAgentConfigVersion(db, row.ID, target)
	if err != nil {
		t.Fatalf("archive target: %v", err)
	}
	if _, err := archiveAgentConfigVersion(db, row.ID, current); err != nil {
		t.Fatalf("archive current: %v", err)
	}

	rec := versionRouter(t, http.MethodPost, "/api/:id/versions/:vid/restore",
		RestoreAgentConfigVersion(db, nil), "/api/"+row.ID+"/versions/"+targetVersion.ID+"/restore")
	_, versions := decodeVersionList(t, rec)
	// The restored target becomes the derived current row, so both stored
	// snapshots (target + the pre-restore current) remain visible.
	if len(versions) != 2 {
		t.Fatalf("want 2 visible versions, got %d", len(versions))
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read restored file: %v", err)
	}
	if string(got) != target {
		t.Fatalf("restored file: want %q, got %q", target, string(got))
	}
	if got := countAgentConfigVersions(t, db, row.ID); got != 2 {
		t.Fatalf("restore must not add a snapshot for the restored state, got %d", got)
	}
}

func TestGetAgentConfigVersion_returns_content(t *testing.T) {
	db := newAgentConfigVersionTestDB(t)
	row := seedAgentConfigFile(t, db, filepath.Join(t.TempDir(), "config.json"), "")
	version, err := archiveAgentConfigVersion(db, row.ID, "{\"v\":1}\n")
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	rec := versionRouter(t, http.MethodGet, "/api/:id/versions/:vid",
		GetAgentConfigVersion(db), "/api/"+row.ID+"/versions/"+version.ID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			ID      string `json:"id"`
			Content string `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.ID != version.ID || envelope.Data.Content != "{\"v\":1}\n" {
		t.Fatalf("unexpected payload: %+v", envelope.Data)
	}

	// A version id from another config must not resolve.
	other := seedAgentConfigFile(t, db, filepath.Join(t.TempDir(), "other.json"), "")
	rec = versionRouter(t, http.MethodGet, "/api/:id/versions/:vid",
		GetAgentConfigVersion(db), "/api/"+other.ID+"/versions/"+version.ID)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-config lookup: want 404, got %d", rec.Code)
	}
}
