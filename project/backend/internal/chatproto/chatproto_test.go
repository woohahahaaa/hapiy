package chatproto

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
)

func providerWithEndpoints(endpoints string) *model.Provider {
	return &model.Provider{Models: `[{"model":"test-model","endpoints":` + endpoints + `}]`}
}

func TestResolveDetectsEndpoints(t *testing.T) {
	provider := providerWithEndpoints(`["/v1/responses","/chat/completions","/v1/messages"]`)
	endpoints := Resolve(provider, "test-model")
	if len(endpoints) != 3 {
		t.Fatalf("expected 3 endpoints, got %+v", endpoints)
	}
	if endpoints[0].Protocol != ProtocolChat || endpoints[0].Path != "/chat/completions" {
		t.Fatalf("chat completions must come first: %+v", endpoints)
	}
	if endpoints[1].Protocol != ProtocolResponses {
		t.Fatalf("responses must come second: %+v", endpoints)
	}
	if endpoints[2].Protocol != ProtocolAnthropic {
		t.Fatalf("messages must come last: %+v", endpoints)
	}
}

func TestResolveDefaultsToChat(t *testing.T) {
	endpoints := Resolve(&model.Provider{}, "unknown")
	if len(endpoints) != 1 || endpoints[0].Protocol != ProtocolChat {
		t.Fatalf("expected a chat fallback, got %+v", endpoints)
	}
}

func TestCompleteChatProtocol(t *testing.T) {
	var (
		path    string
		session string
		body    string
	)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		session = r.Header.Get("X-Session-Id")
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"x","object":"chat.completion","created":1,"model":"test-model","choices":[{"index":0,"message":{"role":"assistant","content":"hello chat"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}`))
	}))
	defer upstream.Close()

	result, err := Complete(context.Background(), Request{
		Endpoint:  Endpoint{Path: "/chat/completions", Protocol: ProtocolChat},
		BaseURL:   upstream.URL + "/v1",
		Key:       "sk-test",
		Model:     "test-model",
		SessionID: "thread-1",
		Messages:  []Message{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "hello chat" {
		t.Fatalf("text = %q", result.Text)
	}
	if path != "/v1/chat/completions" {
		t.Fatalf("path = %q (base /v1 plus /chat/completions must not double /v1)", path)
	}
	if session != "thread-1" {
		t.Fatalf("session header = %q", session)
	}
	if result.TotalTokens != 7 {
		t.Fatalf("usage = %+v", result)
	}
	if body == "" {
		t.Fatal("empty body")
	}
}

func TestCompleteResponsesProtocol(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"r1","object":"response","created_at":1,"model":"test-model","status":"completed","output":[{"type":"message","id":"msg1","role":"assistant","status":"completed","content":[{"type":"output_text","text":"hello responses"}]}],"usage":{"input_tokens":2,"output_tokens":5,"total_tokens":7}}`))
	}))
	defer upstream.Close()

	result, err := Complete(context.Background(), Request{
		Endpoint: Endpoint{Path: "/v1/responses", Protocol: ProtocolResponses},
		BaseURL:  upstream.URL,
		Key:      "sk-test",
		Model:    "test-model",
		Messages: []Message{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "hello responses" {
		t.Fatalf("text = %q", result.Text)
	}
}
