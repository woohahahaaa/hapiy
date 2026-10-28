package publicfunction

import (
	"net/url"
	"slices"
	"strings"
)

// JoinUpstreamPath appends a request path to a provider's base URL. The
// gateway forwards the path the agent actually sent (no /v1 is injected),
// but provider base URLs often already carry the protocol prefix — e.g.
// `https://opencode.ai/zen/go/v1` — so the longest overlap between the base
// URL's trailing path segments and the request path's leading segments is
// removed to avoid a doubled prefix:
//
//	base "https://h/v1"            + "/chat/completions"       -> "https://h/v1/chat/completions"
//	base "https://h/v1"            + "/v1/chat/completions"    -> "https://h/v1/chat/completions"
//	base "https://h/zen/go/v1"     + "/v1/chat/completions"    -> "https://h/zen/go/v1/chat/completions"
//	base "https://api.deepseek.com"+ "/chat/completions"       -> "https://api.deepseek.com/chat/completions"
//	base "https://h/anthropic"     + "/v1/messages"            -> "https://h/anthropic/v1/messages"
//
// The overlap is matched per whole path segment, so a base of `https://h/api`
// and a request of `/api2/x` are joined to `https://h/api/api2/x` rather than
// being mangled into `/api/2/x` by a raw string-prefix trim. It lives here
// (not in relay) so the relay path and the auto-recovery probes share one
// implementation and cannot drift apart.
func JoinUpstreamPath(baseURL, reqPath string) string {
	if reqPath == "" {
		return baseURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return baseURL
	}
	baseSegs := splitPathSegments(parsed.Path)
	reqSegs := splitPathSegments(reqPath)
	if len(reqSegs) == 0 {
		return baseURL
	}
	overlap := 0
	maxOverlap := len(baseSegs)
	if len(reqSegs) < maxOverlap {
		maxOverlap = len(reqSegs)
	}
	for k := maxOverlap; k > 0; k-- {
		if slices.Equal(baseSegs[len(baseSegs)-k:], reqSegs[:k]) {
			overlap = k
			break
		}
	}
	relative := strings.Join(reqSegs[overlap:], "/")
	if relative == "" {
		return baseURL
	}
	return parsed.JoinPath(relative).String()
}

// splitPathSegments splits a URL path into its non-empty segments so overlap
// checks are segment-aligned ("/api2" never matches "/api").
func splitPathSegments(p string) []string {
	p = strings.Trim(p, "/")
	if p == "" {
		return nil
	}
	return strings.Split(p, "/")
}
