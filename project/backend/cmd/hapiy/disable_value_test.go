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

// TestProviderRoutes_disableValueManualState reproduces the provider editor's
// per-row 禁用 button: POST disable-status/disable must flip the entity's
// AutoDisableState (disabled + manual), report it through the disable-status
// list, and — unlike a failover disable — must NOT backfill a DisabledRecord,
// so the auto-recovery pending table never picks a manual disable up.
func TestProviderRoutes_disableValueManualState(t *testing.T) {
	// Given
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

	sessions := middleware.NewSessionStore()
	session := sessions.Issue("wooh")
	engine := relay.NewEngine(db)
	router := gin.New()
	dashboard := router.Group("/v1/dashboard")
	dashboard.Use(middleware.AuthRequired(db, sessions))
	dashboard.POST("/providers/:id/disable-status/disable", handler.DisableProviderValue(db, engine))
	dashboard.GET("/providers/disable-status", handler.ListProviderDisableStatus(db))
	dashboard.GET("/disabled-records", handler.ListDisabledRecords(db, engine))

	body, _ := json.Marshal(map[string]string{"dimension": model.FailoverDimensionKey, "value": "sk-leaky"})
	request := httptest.NewRequest(http.MethodPost, "/v1/dashboard/providers/provider-1/disable-status/disable", bytes.NewReader(body))
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
	if err := db.First(&state, "provider_id = ? AND dimension = ? AND value = ?", "provider-1", model.FailoverDimensionKey, "sk-leaky").Error; err != nil {
		t.Fatalf("load disable state: %v", err)
	}
	if !state.Disabled || !state.Manual {
		t.Fatalf("state must be disabled+manual, got disabled=%v manual=%v", state.Disabled, state.Manual)
	}

	// The disable-status list must surface the manually disabled key so the
	// dialog shows the row as disabled.
	listReq := httptest.NewRequest(http.MethodGet, "/v1/dashboard/providers/disable-status", nil)
	listReq.AddCookie(&http.Cookie{Name: "hapiy_admin_session", Value: session})
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, listReq)
	var status struct {
		Data []struct {
			ProviderID string          `json:"provider_id"`
			Keys       map[string]bool `json:"keys"`
		} `json:"data"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode list response: %v (%s)", err, listRec.Body.String())
	}
	foundDisabled := false
	for _, item := range status.Data {
		if item.ProviderID == "provider-1" && item.Keys["sk-leaky"] {
			foundDisabled = true
		}
	}
	if !foundDisabled {
		t.Fatalf("disable-status does not report the manually disabled key: %s", listRec.Body.String())
	}

	// Listing the recovery table reconciles from the states; a manual state
	// must not backfill a pending DisabledRecord.
	pendingReq := httptest.NewRequest(http.MethodGet, "/v1/dashboard/disabled-records", nil)
	pendingReq.AddCookie(&http.Cookie{Name: "hapiy_admin_session", Value: session})
	pendingRec := httptest.NewRecorder()
	router.ServeHTTP(pendingRec, pendingReq)
	if pendingRec.Code != http.StatusOK {
		t.Fatalf("pending status: want 200, got %d: %s", pendingRec.Code, pendingRec.Body.String())
	}
	var pending struct {
		Data []model.DisabledRecord `json:"data"`
	}
	if err := json.Unmarshal(pendingRec.Body.Bytes(), &pending); err != nil {
		t.Fatalf("decode pending response: %v (%s)", err, pendingRec.Body.String())
	}
	for _, rec := range pending.Data {
		if rec.ProviderID == "provider-1" && rec.Value == "sk-leaky" {
			t.Fatalf("manual disable must not appear in the recovery pending table: %+v", rec)
		}
	}
}
