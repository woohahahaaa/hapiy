package service

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// The 来源标记 travels in the gin context, never as an injected request
// header, and RequestURL rebuilds the downstream URL the caller actually used
// from it.
func TestSourceMark_roundTripAndRequestURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "http://hapiy.local/proxy/__xgimiDSH/chat/completions", nil)

	if got := SourceMark(c); got != "" {
		t.Fatalf("unset source mark = %q, want empty", got)
	}
	SetSourceMark(c, "__xgimiDSH")
	if got := SourceMark(c); got != "__xgimiDSH" {
		t.Fatalf("source mark = %q, want __xgimiDSH", got)
	}
	if got := RequestURL(c, SourceMark(c), "/chat/completions"); got != "http://hapiy.local/proxy/__xgimiDSH/chat/completions" {
		t.Fatalf("RequestURL = %q", got)
	}
	// A direct /v1 request carries no mark: the URL stays prefix-free.
	if got := RequestURL(c, "", "/v1/chat/completions"); got != "http://hapiy.local/v1/chat/completions" {
		t.Fatalf("RequestURL without mark = %q", got)
	}
}
