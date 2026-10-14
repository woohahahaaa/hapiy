package handler

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newLogStatsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func getLogStats(t *testing.T, db *gorm.DB, query string) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/stats", GetLogStats(db))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/stats"+query, nil))
	if w.Code != 200 {
		t.Fatalf("stats: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	return resp.Data
}

// 活动监视的「总 Token（缓存命中去重）」卡片按 total_tokens - cache_hit_tokens
// 计算，所以响应必须带上原始 cache_hit_tokens（两条取数路径都要有）。
func TestGetLogStats_lifetime_returns_cache_hit_tokens(t *testing.T) {
	db := newLogStatsTestDB(t)
	if err := db.Create(&model.UsageCounter{
		ID: 1, TotalRequests: 10, SuccessCount: 8, FailedCount: 2,
		TotalTokens: 1000, PromptTokens: 700, TotalCost: 1.5,
		CacheHitTokens: 400, CacheMissTokens: 100, TotalUseTimeMs: 8000,
	}).Error; err != nil {
		t.Fatal(err)
	}

	data := getLogStats(t, db, "")
	if got := data["cache_hit_tokens"]; got != float64(400) {
		t.Fatalf("cache_hit_tokens: want 400, got %v", got)
	}
	if got := data["total_tokens"]; got != float64(1000) {
		t.Fatalf("total_tokens: want 1000, got %v", got)
	}
}

func TestGetLogStats_range_returns_cache_hit_tokens(t *testing.T) {
	db := newLogStatsTestDB(t)
	now := time.Now()
	for _, stat := range []model.UsageStat{
		{TotalTokens: 500, CacheHitTokens: 300, CacheMissTokens: 50, TotalRequests: 4, SuccessCount: 4, CreatedAt: now.Add(-time.Hour)},
		{TotalTokens: 200, CacheHitTokens: 100, CacheMissTokens: 20, TotalRequests: 2, SuccessCount: 2, CreatedAt: now.Add(-48 * time.Hour)},
	} {
		if err := db.Create(&stat).Error; err != nil {
			t.Fatal(err)
		}
	}

	from := url.QueryEscape(now.Add(-2 * time.Hour).Format(time.RFC3339))
	data := getLogStats(t, db, "?from="+from)
	if got := data["cache_hit_tokens"]; got != float64(300) {
		t.Fatalf("cache_hit_tokens: want 300 (window only), got %v", got)
	}
	if got := data["total_tokens"]; got != float64(500) {
		t.Fatalf("total_tokens: want 500 (window only), got %v", got)
	}
}
