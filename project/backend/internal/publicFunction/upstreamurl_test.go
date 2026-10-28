package publicfunction

import "testing"

// TestJoinUpstreamPath covers the passthrough model: the gateway forwards the
// path the agent sent, and the upstream base URL is expected to carry the
// protocol prefix itself. The overlap de-duplication must be segment-aligned
// so a doubled /v1 is collapsed while an unrelated string prefix is not.
func TestJoinUpstreamPath(t *testing.T) {
	cases := []struct {
		name string
		base string
		path string
		want string
	}{
		{
			name: "base without path appends verbatim",
			base: "https://api.deepseek.com",
			path: "/chat/completions",
			want: "https://api.deepseek.com/chat/completions",
		},
		{
			name: "base v1 plus bare operation path",
			base: "https://opencode.ai/zen/go/v1",
			path: "/chat/completions",
			want: "https://opencode.ai/zen/go/v1/chat/completions",
		},
		{
			name: "base v1 plus v1 path collapses",
			base: "https://opencode.ai/zen/go/v1",
			path: "/v1/chat/completions",
			want: "https://opencode.ai/zen/go/v1/chat/completions",
		},
		{
			name: "multi-segment base plus v1 path collapses only the v1 segment",
			base: "https://chat.duoyuanx.com/api/codex/v1",
			path: "/v1/chat/completions",
			want: "https://chat.duoyuanx.com/api/codex/v1/chat/completions",
		},
		{
			name: "anthropic base plus versioned messages path",
			base: "https://api.anthropic.com",
			path: "/v1/messages",
			want: "https://api.anthropic.com/v1/messages",
		},
		{
			name: "anthropic-prefixed base plus versioned path",
			base: "https://api.minimax.io/anthropic",
			path: "/v1/messages",
			want: "https://api.minimax.io/anthropic/v1/messages",
		},
		{
			name: "responses path",
			base: "https://apinebula.ai",
			path: "/responses",
			want: "https://apinebula.ai/responses",
		},
		{
			name: "string prefix that is not a segment match is not trimmed",
			base: "https://h/api",
			path: "/api2/x",
			want: "https://h/api/api2/x",
		},
		{
			name: "base query string is preserved",
			base: "https://h/v1?tenant=a",
			path: "/chat/completions",
			want: "https://h/v1/chat/completions?tenant=a",
		},
		{
			name: "empty request path leaves the base untouched",
			base: "https://h/v1",
			path: "",
			want: "https://h/v1",
		},
		{
			name: "request path already covered by base path",
			base: "https://h/v1",
			path: "/v1",
			want: "https://h/v1",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := JoinUpstreamPath(tc.base, tc.path); got != tc.want {
				t.Fatalf("JoinUpstreamPath(%q, %q) = %q, want %q", tc.base, tc.path, got, tc.want)
			}
		})
	}
}
