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

func TestCreateRule_persistsSingleAction_whenPayloadIsValid(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.FailoverRule{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	router := gin.New()
	router.POST("/rules/:type", CreateRule(db))
	body := []byte(`{"name":"key-on-error","keywords":["quota"],"status":true,"dimension":"key","retry_count":2,"auto_disable":true,"match_patterns":["rate_limit","401"],"ttfb_seconds":5}`)
	req := httptest.NewRequest(http.MethodPost, "/rules/failover", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status: want %d, got %d: %s", http.StatusCreated, recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data model.FailoverRule `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.Dimension != model.FailoverDimensionKey {
		t.Fatalf("expected dimension key, got %q", response.Data.Dimension)
	}
	if response.Data.RetryCount != 2 {
		t.Fatalf("expected retry_count 2, got %d", response.Data.RetryCount)
	}
	if !response.Data.AutoDisable {
		t.Fatalf("expected auto_disable true")
	}
	if response.Data.TTFBSeconds != 5 {
		t.Fatalf("expected ttfb_seconds 5, got %d", response.Data.TTFBSeconds)
	}
}

func TestCreateRule_rejectsMultipleActions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.FailoverRule{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	router := gin.New()
	router.POST("/rules/:type", CreateRule(db))
	body := []byte(`{"name":"invalid","status":true,"actions":[{"dimension":"key","retry_count":3},{"dimension":"provider","retry_count":3}]}`)
	req := httptest.NewRequest(http.MethodPost, "/rules/failover", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status: want %d, got %d: %s", http.StatusBadRequest, recorder.Code, recorder.Body.String())
	}
}

func TestCreateRule_rejectsInvalidDimension(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.FailoverRule{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	router := gin.New()
	router.POST("/rules/:type", CreateRule(db))
	body := []byte(`{"name":"bad","status":true,"dimension":"invalid_dim","retry_count":3}`)
	req := httptest.NewRequest(http.MethodPost, "/rules/failover", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status: want %d, got %d", http.StatusBadRequest, recorder.Code)
	}
}
