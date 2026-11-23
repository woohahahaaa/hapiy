package handler

import (
	"encoding/json"
	"net/http/httptest"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/gorm"
)

// TestRelayErrorOrigin_classifiesLocalVsUpstream locks the 使用记录 status
// labels: a failure that produced an upstream response (HTTP status or at
// least the attempted URL) is 上游报错; dispatch/concurrency/local errors are
// hapiy 报错.
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

// listLogIDs runs the dashboard list endpoint with a raw query string and
// returns the request ids of the returned rows.
func listLogIDs(t *testing.T, db *gorm.DB, query string) []string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/logs", ListLogs(db))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/logs"+query, nil))
	if w.Code != 200 {
		t.Fatalf("list logs %q: %d %s", query, w.Code, w.Body.String())
	}
	var resp struct {
		Data []struct {
			RequestID string `json:"request_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(resp.Data))
	for _, row := range resp.Data {
		ids = append(ids, row.RequestID)
	}
	return ids
}

// TestListLogs_filtersByErrorOrigin locks the 使用记录 status dropdown: failed
// rows split into 上游报错 (status=failed_upstream) and hapiy 报错
// (status=failed_local) by error_origin.
func TestListLogs_filtersByErrorOrigin(t *testing.T) {
	db := newLogStatsTestDB(t)
	rows := []model.Log{
		{RequestID: "up", Status: "failed", ErrorOrigin: model.LogErrorOriginUpstream},
		{RequestID: "local", Status: "failed", ErrorOrigin: model.LogErrorOriginLocal},
		{RequestID: "ok", Status: "success"},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		query string
		want  []string
	}{
		{query: "?status=failed_upstream", want: []string{"up"}},
		{query: "?status=failed_local", want: []string{"local"}},
		{query: "?status=failed", want: []string{"local", "up"}},
		{query: "?status=success", want: []string{"ok"}},
	}
	for _, tc := range cases {
		got := listLogIDs(t, db, tc.query)
		sort.Strings(got)
		if !slices.Equal(got, tc.want) {
			t.Fatalf("%s: ids = %v, want %v", tc.query, got, tc.want)
		}
	}
}

// TestClearLogs_filtersByErrorOrigin verifies the same split applies to
// "清空筛选结果", so clearing 上游报错 keeps hapiy 报错 rows.
func TestClearLogs_filtersByErrorOrigin(t *testing.T) {
	db := newLogStatsTestDB(t)
	rows := []model.Log{
		{RequestID: "up", Status: "failed", ErrorOrigin: model.LogErrorOriginUpstream},
		{RequestID: "local", Status: "failed", ErrorOrigin: model.LogErrorOriginLocal},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatal(err)
		}
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/logs/clear", ClearLogs(db))
	body := `{"scope":"filtered","filters":{"status":"failed_upstream"}}`
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/logs/clear", strings.NewReader(body)))
	if w.Code != 200 {
		t.Fatalf("clear logs: %d %s", w.Code, w.Body.String())
	}

	got := listLogIDs(t, db, "")
	sort.Strings(got)
	if !slices.Equal(got, []string{"local"}) {
		t.Fatalf("remaining ids = %v, want [local]", got)
	}
}

// TestListLogs_returnsErrorOrigin verifies the dashboard API exposes the
// stored origin so the UI can split hapiy 报错 from 上游报错.
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
