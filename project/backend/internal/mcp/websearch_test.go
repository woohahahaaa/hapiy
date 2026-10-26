package mcp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"golang.org/x/net/html"
)

func TestParseBingResults(t *testing.T) {
	doc, err := html.Parse(strings.NewReader(`<html><body><ol id="b_results">
		<li class="b_algo"><h2><a href="https://example.com/a">Example A</a></h2><div><p>First snippet.</p></div></li>
		<li class="b_algo"><h2><a href="https://example.com/b">Example B</a></h2><div><p>Second snippet.</p></div></li>
	</ol></body></html>`))
	if err != nil {
		t.Fatal(err)
	}
	items := parseBingResults(doc, 10)
	if len(items) != 2 {
		t.Fatalf("expected 2 results, got %+v", items)
	}
	if items[0].Title != "Example A" || items[0].URL != "https://example.com/a" || items[0].Snippet != "First snippet." {
		t.Fatalf("unexpected first item: %+v", items[0])
	}
	if items[1].Title != "Example B" {
		t.Fatalf("unexpected second item: %+v", items[1])
	}
}

func TestWebSearchPrefersSearxng(t *testing.T) {
	var seenQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenQuery = r.URL.Query().Get("q")
		if r.URL.Query().Get("format") != "json" {
			t.Errorf("format = %q", r.URL.Query().Get("format"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[{"title":"Result One","url":"https://example.com/1","content":"hello"}]}`))
	}))
	defer server.Close()

	db := newTestDB(t)
	if err := db.Create(&model.Setting{Key: "web_search_url", Value: server.URL}).Error; err != nil {
		t.Fatal(err)
	}

	handler := webSearch(db)
	_, out, err := handler(context.Background(), nil, webSearchIn{Query: "hapiy gateway", Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if seenQuery != "hapiy gateway" {
		t.Fatalf("query = %q", seenQuery)
	}
	if out.Source != "searxng" || out.Total != 1 || out.Results[0].Title != "Result One" {
		t.Fatalf("unexpected output: %+v", out)
	}
}

func TestWebSearchRejectsEmptyQuery(t *testing.T) {
	handler := webSearch(newTestDB(t))
	if _, _, err := handler(context.Background(), nil, webSearchIn{}); err == nil {
		t.Fatal("expected an error for an empty query")
	}
}
