package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type fetchModelsResult struct {
	Data []fetchModelsResponseItem `json:"data"`
}

func modelFetchRequest(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/providers/fetch-models", FetchModels())
	req := httptest.NewRequest(http.MethodPost, "/providers/fetch-models", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestFetchModels_returns_models_with_name_fallback(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); got != "application/json" {
			t.Errorf("Accept header: want application/json, got %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("Authorization: want empty, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[{"id":"gpt-4"},{"id":"claude","name":"Claude"}]}`)
	}))
	defer upstream.Close()

	rec := modelFetchRequest(t, fmt.Sprintf(`{"endpoint":%q}`, upstream.URL))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var result fetchModelsResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(result.Data) != 2 {
		t.Fatalf("models: want 2, got %d", len(result.Data))
	}
	if result.Data[0].ID != "gpt-4" || result.Data[0].Name != "gpt-4" {
		t.Fatalf("gpt-4: want name fallback to id, got %+v", result.Data[0])
	}
	if result.Data[1].ID != "claude" || result.Data[1].Name != "Claude" {
		t.Fatalf("claude: want explicit name, got %+v", result.Data[1])
	}
}

func TestFetchModels_sends_bearer_when_key_provided(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer sk-test" {
			t.Errorf("Authorization: want Bearer sk-test, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[]}`)
	}))
	defer upstream.Close()

	rec := modelFetchRequest(t, fmt.Sprintf(`{"endpoint":%q,"key":"sk-test"}`, upstream.URL))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestFetchModels_returns_400_on_upstream_error_status(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()

	rec := modelFetchRequest(t, fmt.Sprintf(`{"endpoint":%q}`, upstream.URL))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Error != "上游返回错误状态码: 500" {
		t.Fatalf("error: want %q, got %q", "上游返回错误状态码: 500", resp.Error)
	}
}

func TestFetchModels_rejects_non_http_endpoint(t *testing.T) {
	rec := modelFetchRequest(t, `{"endpoint":"ftp://example.com/models"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Error != "接口地址必须是 http(s) URL" {
		t.Fatalf("error: want %q, got %q", "接口地址必须是 http(s) URL", resp.Error)
	}
}

func TestFetchModels_returns_400_when_data_missing(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"foo":1}`)
	}))
	defer upstream.Close()

	rec := modelFetchRequest(t, fmt.Sprintf(`{"endpoint":%q}`, upstream.URL))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Error != "上游响应缺少 data 数组" {
		t.Fatalf("error: want %q, got %q", "上游响应缺少 data 数组", resp.Error)
	}
}
