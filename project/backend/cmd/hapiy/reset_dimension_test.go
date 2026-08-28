package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/handler"
	"github.com/hapiy/hapiy/internal/middleware"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// TestProviderRoutes_resetDimensionClearsAutoDisabled reproduces the provider
// dialog "恢复" flow: a provider whose auto_disabled flag is set and whose
// provider-dimension disable state exists. After the reset-dimension call the
// flag must be cleared so the provider table / topology no longer show 禁用.
func TestProviderRoutes_resetDimensionClearsAutoDisabled(t *testing.T) {
	// Given
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.Provider{}, &model.AutoDisableState{}, &model.DisabledRecord{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	if err := db.Create(&model.Provider{ID: "provider-1", Name: "多元探索渠道"}).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&model.AutoDisableState{
		ProviderID: "provider-1",
		Dimension:  model.FailoverDimensionProvider,
		Value:      "provider-1",
		Disabled:   true,
	}).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
	if err := db.Create(&model.DisabledRecord{ProviderID: "provider-1", Dimension: model.FailoverDimensionProvider, Value: "provider-1"}).Error; err != nil {
		t.Fatalf("create disabled record: %v", err)
	}

	sessions := middleware.NewSessionStore()
	session := sessions.Issue("wooh")
	engine := relay.NewEngine(db)
	router := gin.New()
	dashboard := router.Group("/v1/dashboard")
	dashboard.Use(middleware.AuthRequired(db, sessions))
	dashboard.POST("/providers/:id/disable-status/reset-dimension", handler.ResetProviderDisableDimension(db, engine))
	dashboard.GET("/providers/disable-status", handler.ListProviderDisableStatus(db))

	body, _ := json.Marshal(map[string]string{"dimension": model.FailoverDimensionProvider})
	request := httptest.NewRequest(http.MethodPost, "/v1/dashboard/providers/provider-1/disable-status/reset-dimension", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: "hapiy_admin_session", Value: session})
	recorder := httptest.NewRecorder()

	// When
	router.ServeHTTP(recorder, request)

	// Then
	if recorder.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var state model.AutoDisableState
	if err := db.First(&state, "provider_id = ? AND dimension = ?", "provider-1", model.FailoverDimensionProvider).Error; err != nil {
		t.Fatalf("reload state: %v", err)
	}
	if state.Disabled {
		t.Fatal("provider disable state still disabled after reset-dimension")
	}

	var records int64
	if err := db.Model(&model.DisabledRecord{}).Where("provider_id = ?", "provider-1").Count(&records).Error; err != nil {
		t.Fatalf("count records: %v", err)
	}
	if records != 0 {
		t.Fatalf("disabled records not cleared: %d remain", records)
	}

	// The list endpoint must report the provider as not disabled.
	listReq := httptest.NewRequest(http.MethodGet, "/v1/dashboard/providers/disable-status", nil)
	listReq.AddCookie(&http.Cookie{Name: "hapiy_admin_session", Value: session})
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, listReq)
	var payload struct {
		Data []struct {
			ProviderID string `json:"provider_id"`
			Provider   bool   `json:"provider"`
		} `json:"data"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode list response: %v (%s)", err, listRec.Body.String())
	}
	for _, item := range payload.Data {
		if item.ProviderID == "provider-1" && item.Provider {
			t.Fatalf("list disable-status still reports provider-1 disabled: %s", listRec.Body.String())
		}
	}
}

// TestListDisabledRecords_backfillsMissingRecord verifies the 自动恢复 table
// reconciles from the disable-state source: a disabled state without a
// DisabledRecord row must appear after listing.
func TestListDisabledRecords_backfillsMissingRecord(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.Provider{}, &model.AutoDisableState{}, &model.DisabledRecord{}, &model.LogCapture{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	if err := db.Create(&model.Provider{ID: "provider-1", Name: "多元探索渠道"}).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	// Disabled state without a DisabledRecord row — the exact mismatch the
	// user observed (dashboard shows disabled, auto-recovery table is empty).
	if err := db.Create(&model.AutoDisableState{
		ProviderID: "provider-1",
		Dimension:  model.FailoverDimensionProvider,
		Value:      "provider-1",
		Disabled:   true,
	}).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}

	sessions := middleware.NewSessionStore()
	session := sessions.Issue("wooh")
	engine := relay.NewEngine(db)
	router := gin.New()
	dashboard := router.Group("/v1/dashboard")
	dashboard.Use(middleware.AuthRequired(db, sessions))
	dashboard.GET("/disabled-records", handler.ListDisabledRecords(db, engine))

	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard/disabled-records", nil)
	request.AddCookie(&http.Cookie{Name: "hapiy_admin_session", Value: session})
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data []model.DisabledRecord `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v (%s)", err, recorder.Body.String())
	}
	found := false
	for _, rec := range payload.Data {
		if rec.ProviderID == "provider-1" && rec.Dimension == model.FailoverDimensionProvider {
			found = true
		}
	}
	if !found {
		t.Fatalf("backfill did not create a record for disabled state: %s", recorder.Body.String())
	}
}

