package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/handler"
	"github.com/hapiy/hapiy/internal/middleware"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// TestLogStats_windowedAggregation verifies /logs/stats with from/to returns
// window-scoped sums (success counts tokens/cost, failed counts requests,
// event rows excluded) instead of the lifetime counter.
func TestLogStats_windowedAggregation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.Log{}, &model.UsageCounter{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	base := time.Date(2026, 8, 27, 10, 0, 0, 0, time.UTC)
	rows := []model.Log{
		{ModelName: "m1", Status: "success", PromptTokens: 10, CompletionTokens: 20, Quota: 0.5, UseTime: 100, CreatedAt: base.Add(-24 * time.Hour)},
		{ModelName: "m1", Status: "success", PromptTokens: 1, CompletionTokens: 2, Quota: 0.1, UseTime: 50, CreatedAt: base.Add(-2 * time.Hour)},
		{ModelName: "m1", Status: "failed", CreatedAt: base.Add(-1 * time.Hour)},
		{ModelName: "m1", Status: "", CreatedAt: base.Add(-time.Hour)}, // event row
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("create logs: %v", err)
	}
	// Lifetime counter would see both successes plus the failed request.
	if err := db.Create(&model.UsageCounter{ID: 1, TotalRequests: 3, SuccessCount: 2, FailedCount: 1, TotalTokens: 33, TotalCost: 0.6, TotalUseTimeMs: 150}).Error; err != nil {
		t.Fatalf("create counter: %v", err)
	}

	sessions := middleware.NewSessionStore()
	session := sessions.Issue("wooh")
	router := gin.New()
	dashboard := router.Group("/v1/dashboard")
	dashboard.Use(middleware.AuthRequired(db, sessions))
	dashboard.GET("/logs/stats", handler.GetLogStats(db))

	from := base.Add(-3 * time.Hour).Format(time.RFC3339)
	to := base.Format(time.RFC3339)
	req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/logs/stats?from="+from+"&to="+to, nil)
	req.AddCookie(&http.Cookie{Name: "hapiy_admin_session", Value: session})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Data struct {
			TotalRequests int64   `json:"total_requests"`
			SuccessCount  int64   `json:"success_count"`
			FailedCount   int64   `json:"failed_count"`
			TotalTokens   int64   `json:"total_tokens"`
			TotalCost     float64 `json:"total_cost"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	// Window (-3h..now) covers 1 success + 1 failed + 1 event; event excluded.
	if payload.Data.TotalRequests != 2 {
		t.Fatalf("total_requests: want 2, got %d", payload.Data.TotalRequests)
	}
	if payload.Data.SuccessCount != 1 {
		t.Fatalf("success_count: want 1, got %d", payload.Data.SuccessCount)
	}
	if payload.Data.FailedCount != 1 {
		t.Fatalf("failed_count: want 1, got %d", payload.Data.FailedCount)
	}
	if payload.Data.TotalTokens != 3 {
		t.Fatalf("total_tokens: want 3, got %d", payload.Data.TotalTokens)
	}
	if payload.Data.TotalCost != 0.1 {
		t.Fatalf("total_cost: want 0.1, got %v", payload.Data.TotalCost)
	}
}
