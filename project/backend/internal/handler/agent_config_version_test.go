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
		RecordName: "test-config",
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

func countAgentConfigVersions(t *testing.T, db *gorm.DB, configID string) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&model.AgentConfigVersion{}).Where("config_id = ?", configID).Count(&count).Error; err != nil {
		t.Fatalf("count versions: %v", err)
	}
	return count
}

func TestArchiveAgentConfigVersion_dedupes_identical_content(t *testing.T) {
	db := newAgentConfigVersionTestDB(t)
	row := seedAgentConfigFile(t, db, filepath.Join(t.TempDir(), "config.json"), "")

	if _, err := archiveAgentConfigVersion(db, row.ID, "{\"v\":1}\n", "", false); err != nil {
		t.Fatalf("archive first: %v", err)
	}
	dup, err := archiveAgentConfigVersion(db, row.ID, "{\"v\":1}\n", "", false)
	if err != nil {
		t.Fatalf("archive duplicate: %v", err)
	}
	if dup != nil {
		t.Fatalf("identical content should be a no-op, got a new version")
	}
	if _, err := archiveAgentConfigVersion(db, row.ID, "{\"v\":2}\n", "", false); err != nil {
		t.Fatalf("archive changed: %v", err)
	}

	versions, err := agentConfigVersionList(db, row.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("want 2 versions, got %d", len(versions))
	}
	if !versions[0].Current || versions[1].Current {
		t.Fatalf("only the newest version should be current")
	}
}

func TestArchiveAgentConfigVersion_caps_history(t *testing.T) {
	db := newAgentConfigVersionTestDB(t)
	row := seedAgentConfigFile(t, db, filepath.Join(t.TempDir(), "config.json"), "")

	for i := 0; i < maxAgentConfigVersions+5; i++ {
		if _, err := archiveAgentConfigVersion(db, row.ID, fmt.Sprintf("{\"v\":%d}\n", i), "", true); err != nil {
			t.Fatalf("archive %d: %v", i, err)
		}
	}
	if got := countAgentConfigVersions(t, db, row.ID); got != maxAgentConfigVersions {
		t.Fatalf("cap: want %d versions, got %d", maxAgentConfigVersions, got)
	}
}

func TestRestoreAgentConfigVersion_writes_file_and_records_source(t *testing.T) {
	db := newAgentConfigVersionTestDB(t)
	path := filepath.Join(t.TempDir(), "config.json")
	original := "{\"v\":1}\n"
	if err := os.WriteFile(path, []byte("{\"v\":2}\n"), 0o644); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	row := seedAgentConfigFile(t, db, path, "{\"v\":2}\n")
	target, err := archiveAgentConfigVersion(db, row.ID, original, "", true)
	if err != nil {
		t.Fatalf("archive target: %v", err)
	}
	if _, err := archiveAgentConfigVersion(db, row.ID, "{\"v\":2}\n", "", true); err != nil {
		t.Fatalf("archive current: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/:id/versions/:vid/restore", RestoreAgentConfigVersion(db, nil))
	req := httptest.NewRequest(http.MethodPost, "/api/"+row.ID+"/versions/"+target.ID+"/restore", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read restored file: %v", err)
	}
	if string(got) != original {
		t.Fatalf("restored file: want %q, got %q", original, string(got))
	}

	versions, err := agentConfigVersionList(db, row.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(versions) != 3 {
		t.Fatalf("after restore: want 3 versions, got %d", len(versions))
	}
	if !versions[0].Current {
		t.Fatalf("restored version should be current")
	}
	if versions[0].RestoredFrom == nil || versions[0].RestoredFrom.ID != target.ID {
		t.Fatalf("restored version should point back at %s", target.ID)
	}
}

func TestListAgentConfigVersions_seeds_baseline_from_live_file(t *testing.T) {
	db := newAgentConfigVersionTestDB(t)
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("{\"v\":1}\n"), 0o644); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	row := seedAgentConfigFile(t, db, path, "")

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/:id/versions", ListAgentConfigVersions(db, nil))
	req := httptest.NewRequest(http.MethodGet, "/api/"+row.ID+"/versions", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			Versions []map[string]any `json:"versions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(envelope.Data.Versions) != 1 {
		t.Fatalf("want 1 baseline version, got %d", len(envelope.Data.Versions))
	}
	if _, leaked := envelope.Data.Versions[0]["content"]; leaked {
		t.Fatalf("list payload must not carry content")
	}
}
