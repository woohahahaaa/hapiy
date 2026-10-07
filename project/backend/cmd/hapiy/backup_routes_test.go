package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/handler"
	"github.com/hapiy/hapiy/internal/middleware"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBackupRoutes_createListAndResolvePath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "test.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.Token{}, &model.BackupRecord{}, &model.Setting{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	if err := db.Create(&model.Token{ID: "tok-1", Name: "one", Key: "k1", Status: true}).Error; err != nil {
		t.Fatalf("create token: %v", err)
	}
	service.SetBackupBaseDir(dir)
	t.Cleanup(func() { service.SetBackupBaseDir("") })

	sessions := middleware.NewSessionStore()
	session := sessions.Issue("wooh")
	router := gin.New()
	dashboard := router.Group("/v1/dashboard")
	dashboard.Use(middleware.AuthRequired(db, sessions))
	dashboard.GET("/backups", handler.ListBackups(db))
	dashboard.POST("/backups", handler.CreateBackup(db))
	dashboard.GET("/backups/path", handler.ResolveBackupPath())
	dashboard.GET("/backups/:id/download", handler.DownloadBackup(db))
	dashboard.DELETE("/backups/:id", handler.DeleteBackup(db))

	do := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		var reader *strings.Reader
		if body == "" {
			reader = strings.NewReader("")
		} else {
			reader = strings.NewReader(body)
		}
		request := httptest.NewRequest(method, path, reader)
		request.AddCookie(&http.Cookie{Name: "hapiy_admin_session", Value: session})
		if body != "" {
			request.Header.Set("Content-Type", "application/json")
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder
	}

	// Create a manual backup for the tokens module.
	created := do(http.MethodPost, "/v1/dashboard/backups", `{"modules":["tokens"],"path":"backups"}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create backup: %d %s", created.Code, created.Body.String())
	}
	var createResp struct {
		Data struct {
			ID       string `json:"id"`
			FileName string `json:"file_name"`
		} `json:"data"`
		FileCreated bool `json:"file_created"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if !createResp.FileCreated || createResp.Data.ID == "" || createResp.Data.FileName == "" {
		t.Fatalf("unexpected create response: %s", created.Body.String())
	}

	// The history lists it with the resolved absolute directory.
	listed := do(http.MethodGet, "/v1/dashboard/backups?limit=10&offset=0", "")
	if listed.Code != http.StatusOK {
		t.Fatalf("list backups: %d %s", listed.Code, listed.Body.String())
	}
	var listResp struct {
		Total        int64  `json:"total"`
		ResolvedPath string `json:"resolved_path"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if listResp.Total != 1 {
		t.Fatalf("expected 1 record, got %d", listResp.Total)
	}
	if want := filepath.Join(dir, "backups"); listResp.ResolvedPath != want {
		t.Fatalf("resolved_path: want %q, got %q", want, listResp.ResolvedPath)
	}

	// Path preview endpoint must not be swallowed by the :id routes.
	resolved := do(http.MethodGet, "/v1/dashboard/backups/path?path=sub/dir", "")
	if resolved.Code != http.StatusOK {
		t.Fatalf("resolve path: %d %s", resolved.Code, resolved.Body.String())
	}
	var resolveResp struct {
		Data struct {
			AbsolutePath string `json:"absolute_path"`
		} `json:"data"`
	}
	if err := json.Unmarshal(resolved.Body.Bytes(), &resolveResp); err != nil {
		t.Fatalf("decode resolve response: %v", err)
	}
	if want := filepath.Join(dir, "sub", "dir"); resolveResp.Data.AbsolutePath != want {
		t.Fatalf("absolute_path: want %q, got %q", want, resolveResp.Data.AbsolutePath)
	}
}
