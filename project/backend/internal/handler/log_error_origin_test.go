package handler

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
)

// TestRelayErrorOrigin_classifiesLocalVsUpstream locks the 使用记录 status
// labels: a failure that produced an upstream response (HTTP status or at
// least the attempted URL) is 上游报错; dispatch/concurrency/local errors are
// 本地报错.
func TestRelayErrorOrigin_classifiesLocalVsUpstream(t *testing.T) {
	cases := []struct {
		name string
		err  error
		resp *relay.RelayResponse
		want string
	}{
		{name: "no provider", err: relay.ErrNoProvider, want: model.LogErrorOriginLocal},
		{name: "concurrency", err: relay.ErrConcurrencyRejected, want: model.LogErrorOriginLocal},
		{name: "rewrite error", err: errString("rule r1: script is not a JSON array"), want: model.LogErrorOriginLocal},
		{name: "http error", err: errString("upstream returned 500: boom"), resp: &relay.RelayResponse{StatusCode: 500}, want: model.LogErrorOriginUpstream},
		{name: "transport error", err: errString("upstream request failed: dial tcp"), resp: &relay.RelayResponse{UpstreamURL: "https://up.example/v1/chat/completions"}, want: model.LogErrorOriginUpstream},
	}
	for _, tc := range cases {
		if got := relayErrorOrigin(tc.err, tc.resp); got != tc.want {
			t.Fatalf("%s: origin = %q, want %q", tc.name, got, tc.want)
		}
	}
}

type errString string

func (e errString) Error() string { return string(e) }

// TestListLogs_returnsErrorOrigin verifies the dashboard API exposes the
// stored origin so the UI can split 本地报错 from 上游报错.
func TestListLogs_returnsErrorOrigin(t *testing.T) {
	db := newLogStatsTestDB(t)
	rows := []model.Log{
		{Status: "failed", ErrorOrigin: model.LogErrorOriginUpstream, ErrorMessage: "HTTP 500"},
		{Status: "failed", ErrorOrigin: model.LogErrorOriginLocal, ErrorMessage: "no provider available"},
		{Status: "success"},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatal(err)
		}
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/logs", ListLogs(db))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/logs", nil))
	if w.Code != 200 {
		t.Fatalf("list logs: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	origins := map[string]string{}
	for _, row := range resp.Data {
		status, _ := row["status"].(string)
		origin, _ := row["error_origin"].(string)
		origins[status+":"+origin] = origin
	}
	if _, ok := origins["failed:"+model.LogErrorOriginUpstream]; !ok {
		t.Fatalf("upstream origin missing from response: %s", w.Body.String())
	}
	if _, ok := origins["failed:"+model.LogErrorOriginLocal]; !ok {
		t.Fatalf("local origin missing from response: %s", w.Body.String())
	}
}
