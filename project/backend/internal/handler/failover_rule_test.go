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

func TestCreateRule_persistsOrderedFailoverActionRows_whenPayloadIsValid(t *testing.T) {
	// Given
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
	body := []byte(`{"name":"ordered","keywords":["quota"],"status":true,"actions":[{"dimension":"provider","retry_count":1,"automatic_polling":false,"auto_disable":false},{"dimension":"key","retry_count":2,"automatic_polling":true,"auto_disable":false},{"dimension":"base_url","retry_count":4,"automatic_polling":false,"auto_disable":true}]}`)
	req := httptest.NewRequest(http.MethodPost, "/rules/failover", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	// When
	router.ServeHTTP(recorder, req)

	// Then
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status: want %d, got %d: %s", http.StatusCreated, recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data model.FailoverRule `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.Actions[0].Dimension != model.FailoverDimensionProvider || response.Data.Actions[1].RetryCount != 2 || !response.Data.Actions[2].AutoDisable {
		t.Fatalf("unexpected action payload: %#v", response.Data.Actions)
	}
}

func TestCreateRule_rejectsFailoverActionsWithoutAllThreeDimensions(t *testing.T) {
	// Given
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
	body := []byte(`{"name":"invalid","status":true,"actions":[{"dimension":"key","retry_count":3},{"dimension":"key","retry_count":3},{"dimension":"provider","retry_count":3}]}`)
	req := httptest.NewRequest(http.MethodPost, "/rules/failover", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	// When
	router.ServeHTTP(recorder, req)

	// Then
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status: want %d, got %d", http.StatusBadRequest, recorder.Code)
	}
}
