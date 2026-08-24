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

func TestCreateRule_rejectsDuplicateName(t *testing.T) {
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
	router.PUT("/rules/:type/:id", UpdateRule(db))

	first := []byte(`{"name":"dup","status":true,"dimension":"base_url","retry_count":3,"auto_disable":true}`)
	req1 := httptest.NewRequest(http.MethodPost, "/rules/failover", bytes.NewReader(first))
	req1.Header.Set("Content-Type", "application/json")
	rec1 := httptest.NewRecorder()
	router.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("first create: want 201, got %d: %s", rec1.Code, rec1.Body.String())
	}

	second := []byte(`{"name":"dup","status":true,"dimension":"key","retry_count":3,"auto_disable":true}`)
	req2 := httptest.NewRequest(http.MethodPost, "/rules/failover", bytes.NewReader(second))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("duplicate name: want 400, got %d: %s", rec2.Code, rec2.Body.String())
	}
}

// Regression: the failover branch of UpdateRule must bind the request body
// before validating and saving, otherwise PUT silently re-persists the
// unchanged row and edits appear to have no effect.
func TestUpdateRule_appliesPayloadChanges(t *testing.T) {
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
	router.PUT("/rules/:type/:id", UpdateRule(db))

	createBody := []byte(`{"name":"rule-a","keywords":["quota"],"status":true,"dimension":"base_url","retry_count":3,"auto_disable":true,"match_patterns":["429"],"ttfb_seconds":0}`)
	req := httptest.NewRequest(http.MethodPost, "/rules/failover", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Data model.FailoverRule `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Data.ID == "" {
		t.Fatal("created rule has empty id")
	}

	updateBody := []byte(`{"name":"rule-a-renamed","keywords":["quota","retry"],"status":false,"dimension":"key","retry_count":5,"auto_disable":false,"match_patterns":["rate_limit","401"],"ttfb_seconds":7}`)
	req2 := httptest.NewRequest(http.MethodPut, "/rules/failover/"+created.Data.ID, bytes.NewReader(updateBody))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("update: want 200, got %d: %s", rec2.Code, rec2.Body.String())
	}
	var updated struct {
		Data model.FailoverRule `json:"data"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode update response: %v", err)
	}
	if updated.Data.Name != "rule-a-renamed" {
		t.Fatalf("expected renamed name, got %q", updated.Data.Name)
	}
	if updated.Data.Dimension != model.FailoverDimensionKey {
		t.Fatalf("expected dimension key, got %q", updated.Data.Dimension)
	}
	if updated.Data.RetryCount != 5 {
		t.Fatalf("expected retry_count 5, got %d", updated.Data.RetryCount)
	}
	if updated.Data.AutoDisable {
		t.Fatalf("expected auto_disable false")
	}
	if updated.Data.Status {
		t.Fatalf("expected status false")
	}
	if updated.Data.TTFBSeconds != 7 {
		t.Fatalf("expected ttfb_seconds 7, got %d", updated.Data.TTFBSeconds)
	}

	// Verify persistence, not just the response body.
	var persisted model.FailoverRule
	if err := db.First(&persisted, "id = ?", created.Data.ID).Error; err != nil {
		t.Fatalf("reload persisted rule: %v", err)
	}
	if persisted.Name != "rule-a-renamed" ||
		persisted.Dimension != model.FailoverDimensionKey ||
		persisted.RetryCount != 5 ||
		persisted.AutoDisable ||
		persisted.Status ||
		persisted.TTFBSeconds != 7 {
		t.Fatalf("persisted rule not updated: %+v", persisted)
	}
}
