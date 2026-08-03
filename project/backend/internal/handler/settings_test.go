package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newSettingsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Setting{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func settingsRequest(t *testing.T, method, body string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Handle(method, "/settings", handler)
	req := httptest.NewRequest(method, "/settings", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestListSettings_returns_empty_array_on_new_database(t *testing.T) {
	db := newSettingsTestDB(t)
	rec := settingsRequest(t, http.MethodGet, "", ListSettings(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != `{"data":[]}` {
		t.Fatalf("body: got %s", rec.Body.String())
	}
}

func TestUpsertSetting_creates_setting_and_get_returns_it(t *testing.T) {
	db := newSettingsTestDB(t)

	rec := settingsRequest(t, http.MethodPut, `{"key":"theme","value":"dark"}`, UpsertSetting(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Data model.Setting `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode PUT response: %v", err)
	}
	if created.Data.Key != "theme" || created.Data.Value != "dark" {
		t.Fatalf("created setting: %+v", created.Data)
	}

	rec = settingsRequest(t, http.MethodGet, "", ListSettings(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var listed struct {
		Data []model.Setting `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if len(listed.Data) != 1 || listed.Data[0].Key != "theme" || listed.Data[0].Value != "dark" {
		t.Fatalf("GET: unexpected settings: %+v", listed.Data)
	}
}

func TestUpsertSetting_overwrites_existing_key_without_duplicates(t *testing.T) {
	db := newSettingsTestDB(t)
	if rec := settingsRequest(t, http.MethodPut, `{"key":"theme","value":"dark"}`, UpsertSetting(db)); rec.Code != http.StatusOK {
		t.Fatalf("first PUT status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rec := settingsRequest(t, http.MethodPut, `{"key":"theme","value":"light"}`, UpsertSetting(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("second PUT status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var count int64
	if err := db.Model(&model.Setting{}).Where("key = ?", "theme").Count(&count).Error; err != nil {
		t.Fatalf("count settings: %v", err)
	}
	if count != 1 {
		t.Fatalf("duplicate rows: want 1, got %d", count)
	}

	var setting model.Setting
	if err := db.First(&setting, "key = ?", "theme").Error; err != nil {
		t.Fatalf("load setting: %v", err)
	}
	if setting.Value != "light" {
		t.Fatalf("overwritten value: got %q, want %q", setting.Value, "light")
	}
}

func TestUpsertSetting_rejects_empty_key(t *testing.T) {
	db := newSettingsTestDB(t)
	rec := settingsRequest(t, http.MethodPut, `{"key":"","value":"dark"}`, UpsertSetting(db))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Error != "key 不能为空" {
		t.Fatalf("error message: got %q, want %q", resp.Error, "key 不能为空")
	}
}
