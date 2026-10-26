package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/net/html"
	"gorm.io/gorm"
)

const (
	webSearchUA      = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
	webSearchTimeout = 12 * time.Second
)

type webSearchIn struct {
	Query string `json:"query" jsonschema:"搜索关键词"`
	Limit int    `json:"limit,omitempty" jsonschema:"返回条数，默认 5，最多 10"`
}

type webSearchItem struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet,omitempty"`
}

type webSearchOut struct {
	Query   string          `json:"query"`
	Source  string          `json:"source" jsonschema:"searxng 或 bing"`
	Results []webSearchItem `json:"results"`
	Total   int             `json:"total"`
}

// webSearch is a small built-in search tool. It prefers a self-hosted SearXNG
// instance when `web_search_url` (or HAPIY_WEB_SEARCH_URL) is configured and
// falls back to scraping Bing's result page, so it works with no setup.
func webSearch(db *gorm.DB) func(context.Context, *mcp.CallToolRequest, webSearchIn) (*mcp.CallToolResult, webSearchOut, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, in webSearchIn) (*mcp.CallToolResult, webSearchOut, error) {
		query := strings.TrimSpace(in.Query)
		if query == "" {
			return nil, webSearchOut{}, fmt.Errorf("query 必填")
		}
		limit := in.Limit
		if limit <= 0 {
			limit = 5
		}
		if limit > 10 {
			limit = 10
		}

		out := webSearchOut{Query: query, Results: []webSearchItem{}}
		if endpoint := webSearchEndpoint(db); endpoint != "" {
			results, err := searchSearxng(ctx, endpoint, query, limit)
			if err == nil && len(results) > 0 {
				out.Source = "searxng"
				out.Results = results
				out.Total = len(results)
				return nil, out, nil
			}
		}

		results, err := searchBing(ctx, query, limit)
		if err != nil {
			return nil, webSearchOut{}, err
		}
		out.Source = "bing"
		out.Results = results
		out.Total = len(results)
		return nil, out, nil
	}
}

func webSearchEndpoint(db *gorm.DB) string {
	endpoint, err := service.GetSetting(db, "web_search_url")
	if err == nil && strings.TrimSpace(endpoint) != "" {
		return strings.TrimSpace(endpoint)
	}
	return strings.TrimSpace(os.Getenv("HAPIY_WEB_SEARCH_URL"))
}

func searchSearxng(ctx context.Context, endpoint, query string, limit int) ([]webSearchItem, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("q", query)
	q.Set("format", "json")
	u.RawQuery = q.Encode()

	ctx, cancel := context.WithTimeout(ctx, webSearchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", webSearchUA)
	resp, err := service.DefaultClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("SearXNG 返回 %d", resp.StatusCode)
	}
	var payload struct {
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"results"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	items := make([]webSearchItem, 0, len(payload.Results))
	for _, row := range payload.Results {
		if len(items) >= limit {
			break
		}
		title := strings.TrimSpace(row.Title)
		link := strings.TrimSpace(row.URL)
		if title == "" || link == "" {
			continue
		}
		items = append(items, webSearchItem{
			Title:   title,
			URL:     link,
			Snippet: truncateRunes(strings.TrimSpace(row.Content), 300),
		})
	}
	return items, nil
}

func searchBing(ctx context.Context, query string, limit int) ([]webSearchItem, error) {
	target := "https://cn.bing.com/search?q=" + url.QueryEscape(query) + "&count=" + strconv.Itoa(limit)
	ctx, cancel := context.WithTimeout(ctx, webSearchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", webSearchUA)
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	resp, err := service.DefaultClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Bing 返回 %d", resp.StatusCode)
	}
	doc, err := html.Parse(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	items := parseBingResults(doc, limit)
	if len(items) == 0 {
		return nil, fmt.Errorf("Bing 没有返回可用结果（可能被限流或需要验证）")
	}
	return items, nil
}

// parseBingResults walks the result page and collects organic results
// (<li class="b_algo">) in document order.
func parseBingResults(doc *html.Node, limit int) []webSearchItem {
	items := make([]webSearchItem, 0, limit)
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if len(items) >= limit {
			return
		}
		if node.Type == html.ElementNode && node.Data == "li" && hasHTMLClass(node, "b_algo") {
			if item, ok := parseBingItem(node); ok {
				items = append(items, item)
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)
	return items
}

func parseBingItem(node *html.Node) (webSearchItem, bool) {
	title := ""
	link := ""
	var findTitle func(*html.Node) bool
	findTitle = func(n *html.Node) bool {
		if n.Type == html.ElementNode && n.Data == "h2" {
			var anchor *html.Node
			var findAnchor func(*html.Node)
			findAnchor = func(a *html.Node) {
				if anchor != nil {
					return
				}
				if a.Type == html.ElementNode && a.Data == "a" {
					anchor = a
					return
				}
				for c := a.FirstChild; c != nil; c = c.NextSibling {
					findAnchor(c)
				}
			}
			findAnchor(n)
			if anchor != nil {
				link = attrValue(anchor, "href")
				title = strings.TrimSpace(nodeText(anchor))
				return true
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if findTitle(c) {
				return true
			}
		}
		return false
	}
	findTitle(node)

	if title == "" || link == "" {
		return webSearchItem{}, false
	}
	snippet := ""
	var findSnippet func(*html.Node) bool
	findSnippet = func(n *html.Node) bool {
		if n.Type == html.ElementNode && n.Data == "p" {
			snippet = truncateRunes(strings.TrimSpace(nodeText(n)), 300)
			return true
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if findSnippet(c) {
				return true
			}
		}
		return false
	}
	findSnippet(node)
	return webSearchItem{Title: title, URL: link, Snippet: snippet}, true
}

func hasHTMLClass(node *html.Node, class string) bool {
	for _, attr := range node.Attr {
		if attr.Key != "class" {
			continue
		}
		for _, field := range strings.Fields(attr.Val) {
			if field == class {
				return true
			}
		}
	}
	return false
}

func attrValue(node *html.Node, key string) string {
	for _, attr := range node.Attr {
		if attr.Key == key {
			return strings.TrimSpace(attr.Val)
		}
	}
	return ""
}

func nodeText(node *html.Node) string {
	if node.Type == html.TextNode {
		return node.Data
	}
	var builder strings.Builder
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		builder.WriteString(nodeText(child))
	}
	return builder.String()
}

func truncateRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max]) + "…"
}
