package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newPriceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.PriceConfig{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func priceRequest(t *testing.T, method, path, body string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	return priceRequestRoute(t, method, path, path, body, handler)
}

func priceRequestRoute(t *testing.T, method, routePattern, requestPath, body string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Handle(method, routePattern, handler)
	req := httptest.NewRequest(method, requestPath, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func decodePriceList(t *testing.T, body []byte) []model.PriceConfig {
	t.Helper()
	var resp struct {
		Data []model.PriceConfig `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	return resp.Data
}

func TestPriceCreate_roundtrips_new_fields(t *testing.T) {
	db := newPriceTestDB(t)
	body := `{"model":"gpt-4o","input_price":5,"output_price":15,"context_length":128000,` +
		`"max_token":4096,` +
		`"supported_types":"[\"text\",\"image\"]",` +
		`"aliases":"[\"gpt-4o-alias\"]",` +
		`"endpoints":"[\"https://api.example.com/v1\"]",` +
		`"thinking_levels":"[\"low\",\"high\"]",` +
		`"rate":"[{\"pattern\":\"^gpt-4o\",\"multiplier\":1.5}]"}`

	rec := priceRequest(t, http.MethodPost, "/models", body, CreatePrice(db))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status: want 201, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = priceRequest(t, http.MethodGet, "/models", "", ListPrices(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("list status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rows := decodePriceList(t, rec.Body.Bytes())
	if len(rows) != 1 {
		t.Fatalf("list rows: want 1, got %d", len(rows))
	}
	got := rows[0]
	if got.Model != "gpt-4o" {
		t.Fatalf("model: got %q", got.Model)
	}
	if got.ContextLength != 128000 {
		t.Fatalf("context_length: want 128000, got %d", got.ContextLength)
	}
	if got.Endpoints != `["https://api.example.com/v1"]` {
		t.Fatalf("endpoints: got %q", got.Endpoints)
	}
	if got.MaxToken != 4096 {
		t.Fatalf("max_token: want 4096, got %d", got.MaxToken)
	}
	if got.SupportedTypes != `["text","image"]` {
		t.Fatalf("supported_types: got %q", got.SupportedTypes)
	}
	if got.Aliases != `["gpt-4o-alias"]` {
		t.Fatalf("aliases: got %q", got.Aliases)
	}
	if got.ThinkingLevels != `["low","high"]` {
		t.Fatalf("thinking_levels: got %q", got.ThinkingLevels)
	}
	if got.Rate != `[{"pattern":"^gpt-4o","multiplier":1.5}]` {
		t.Fatalf("rate: got %q", got.Rate)
	}
}

func TestPriceCreate_rejects_invalid_regex_rule(t *testing.T) {
	db := newPriceTestDB(t)
	body := `{"model":"gpt-4o","rate":"[{\"pattern\":\"(\",\"multiplier\":1}]"}`

	rec := priceRequest(t, http.MethodPost, "/models", body, CreatePrice(db))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "不是有效的正则表达式") {
		t.Fatalf("error message: got %s", rec.Body.String())
	}
}

func TestPriceCreate_rejects_negative_multiplier(t *testing.T) {
	db := newPriceTestDB(t)
	body := `{"model":"gpt-4o","rate":"[{\"pattern\":\"^gpt\",\"multiplier\":-1}]"}`

	rec := priceRequest(t, http.MethodPost, "/models", body, CreatePrice(db))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "不能为负数") {
		t.Fatalf("error message: got %s", rec.Body.String())
	}
}

func TestPriceCreate_rejects_negative_context_length(t *testing.T) {
	db := newPriceTestDB(t)
	body := `{"model":"gpt-4o","context_length":-5}`

	rec := priceRequest(t, http.MethodPost, "/models", body, CreatePrice(db))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "context_length 不能为负数") {
		t.Fatalf("error message: got %s", rec.Body.String())
	}
}

func TestPriceCreate_rejects_empty_model(t *testing.T) {
	db := newPriceTestDB(t)
	body := `{"model":"","input_price":1}`

	rec := priceRequest(t, http.MethodPost, "/models", body, CreatePrice(db))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "model 不能为空") {
		t.Fatalf("error message: got %s", rec.Body.String())
	}
}

func TestPriceCreate_rejectsModelNameMatchingExistingAlias(t *testing.T) {
	db := newPriceTestDB(t)
	if err := db.Create(&model.PriceConfig{Model: "canonical-model", Aliases: `["shared-name"]`}).Error; err != nil {
		t.Fatalf("create existing price: %v", err)
	}

	rec := priceRequest(t, http.MethodPost, "/models", `{"model":"SHARED-NAME"}`, CreatePrice(db))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "已被历史模型或别名占用") {
		t.Fatalf("error message: got %s", rec.Body.String())
	}
}

func TestPriceCreate_rejectsAliasMatchingExistingModelName(t *testing.T) {
	db := newPriceTestDB(t)
	if err := db.Create(&model.PriceConfig{Model: "canonical-model"}).Error; err != nil {
		t.Fatalf("create existing price: %v", err)
	}

	rec := priceRequest(t, http.MethodPost, "/models", `{"model":"other-model","aliases":"[\"CANONICAL-MODEL\"]"}`, CreatePrice(db))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "已被历史模型或别名占用") {
		t.Fatalf("error message: got %s", rec.Body.String())
	}
}

func TestPriceUpdate_preserves_and_updates_new_fields(t *testing.T) {
	db := newPriceTestDB(t)
	createBody := `{"model":"gpt-4o","input_price":5,"output_price":15,"context_length":128000,` +
		`"endpoints":"[\"https://api.example.com/v1\"]",` +
		`"rate":"[{\"pattern\":\"^gpt\",\"multiplier\":1}]"}`

	rec := priceRequest(t, http.MethodPost, "/prices", createBody, CreatePrice(db))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status: want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Data model.PriceConfig `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	id := created.Data.ID

	// Full update overwrites the new fields.
	updateBody := `{"model":"gpt-4o-x","input_price":6,"output_price":16,"context_length":200000,` +
		`"max_token":8192,` +
		`"supported_types":"[\"text\",\"video\"]",` +
		`"aliases":"[\"gpt-4o-x-v2\"]",` +
		`"endpoints":"[\"https://api2.example.com/v1\"]",` +
		`"rate":"[{\"pattern\":\"x\",\"multiplier\":2}]"}`
	rec = priceRequestRoute(t, http.MethodPut, "/models/:id", "/models/"+id, updateBody, UpdatePrice(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("update status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = priceRequest(t, http.MethodGet, "/models", "", ListPrices(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("list status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rows := decodePriceList(t, rec.Body.Bytes())
	if len(rows) != 1 {
		t.Fatalf("list rows: want 1, got %d", len(rows))
	}
	got := rows[0]
	if got.Model != "gpt-4o-x" {
		t.Fatalf("model: got %q", got.Model)
	}
	if got.OutputPrice != 16 {
		t.Fatalf("output_price: want 16, got %v", got.OutputPrice)
	}
	if got.ContextLength != 200000 {
		t.Fatalf("context_length: want 200000, got %d", got.ContextLength)
	}
	if got.Endpoints != `["https://api2.example.com/v1"]` {
		t.Fatalf("endpoints: got %q", got.Endpoints)
	}
	if got.Rate != `[{"pattern":"x","multiplier":2}]` {
		t.Fatalf("rate: got %q", got.Rate)
	}
	if got.MaxToken != 8192 {
		t.Fatalf("max_token: want 8192, got %d", got.MaxToken)
	}
	if got.SupportedTypes != `["text","video"]` {
		t.Fatalf("supported_types: got %q", got.SupportedTypes)
	}
	if got.Aliases != `["gpt-4o-x-v2"]` {
		t.Fatalf("aliases: got %q", got.Aliases)
	}

	// Partial update without a model preserves the stored model.
	rec = priceRequestRoute(t, http.MethodPut, "/models/:id", "/models/"+id, `{"output_price":99}`, UpdatePrice(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("partial update status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = priceRequest(t, http.MethodGet, "/models", "", ListPrices(db))
	if rec.Code != http.StatusOK {
		t.Fatalf("list status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rows = decodePriceList(t, rec.Body.Bytes())
	if len(rows) != 1 || rows[0].Model != "gpt-4o-x" || rows[0].OutputPrice != 99 {
		t.Fatalf("after partial update: got %+v", rows)
	}
}

func TestPriceUpdate_rejects_negative_context_length(t *testing.T) {
	db := newPriceTestDB(t)
	createBody := `{"model":"gpt-4o"}`
	rec := priceRequest(t, http.MethodPost, "/prices", createBody, CreatePrice(db))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status: want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Data model.PriceConfig `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	id := created.Data.ID

	rec = priceRequestRoute(t, http.MethodPut, "/models/:id", "/models/"+id, `{"context_length":-1}`, UpdatePrice(db))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "context_length 不能为负数") {
		t.Fatalf("error message: got %s", rec.Body.String())
	}
}

func TestPriceUpdate_rejects_invalid_regex_rule(t *testing.T) {
	db := newPriceTestDB(t)
	createBody := `{"model":"gpt-4o"}`
	rec := priceRequest(t, http.MethodPost, "/prices", createBody, CreatePrice(db))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status: want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Data model.PriceConfig `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	id := created.Data.ID

	rec = priceRequestRoute(t, http.MethodPut, "/models/:id", "/models/"+id, `{"rate":"[{\"pattern\":\"[\",\"multiplier\":1}]"}`, UpdatePrice(db))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "不是有效的正则表达式") {
		t.Fatalf("error message: got %s", rec.Body.String())
	}
}
