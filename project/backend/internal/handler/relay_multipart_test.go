package handler

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/gorm"
)

// capturedUpstream records what the upstream received and answers like an
// OpenAI-compatible image endpoint.
type capturedUpstream struct {
	server      *httptest.Server
	contentType string
	body        []byte
}

func newCapturedUpstream(t *testing.T, response string) *capturedUpstream {
	t.Helper()
	upstream := &capturedUpstream{}
	upstream.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstream.contentType = r.Header.Get("Content-Type")
		upstream.body, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(upstream.server.Close)
	return upstream
}

// endpointProvider declares one enabled provider whose single model only
// serves the given path.
func endpointProvider(t *testing.T, db *gorm.DB, id, baseURL, modelName, path string) {
	t.Helper()
	provider := model.Provider{
		ID:              id,
		Name:            id,
		Status:          true,
		WorkflowEnabled: true,
		BaseURLs:        `["` + baseURL + `"]`,
		Keys:            `["sk-test"]`,
		Endpoints:       `[{"pathSuffix":"` + path + `"}]`,
		Models:          `[{"model":"` + modelName + `","endpoints":["` + path + `"]}]`,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Provider{}).Where("id = ?", id).
		Updates(map[string]any{"status": true, "workflow_enabled": true}).Error; err != nil {
		t.Fatal(err)
	}
}

// newRelayOnlyRouter mounts the relay handler without token middleware: the
// tests assert what reaches the upstream, not the auth gate.
func newRelayOnlyRouter(t *testing.T, db *gorm.DB, engine *relay.Engine) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/:endpoint", Relay(db, engine))
	r.POST("/:endpoint/*rest", Relay(db, engine))
	return r
}

func multipartEditBody(t *testing.T, boundary string) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if err := writer.SetBoundary(boundary); err != nil {
		t.Fatal(err)
	}
	_ = writer.WriteField("model", "gpt-image-2.6")
	_ = writer.WriteField("prompt", "把背景换成纯白")
	_ = writer.WriteField("size", "1024x1024")
	part, err := writer.CreateFormFile("image", "ref.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("\x89PNG\r\n\x1a\n-original-binary")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestRelayForwardsMultipartImageEditUntouched(t *testing.T) {
	db := newChatTestDB(t)
	upstream := newCapturedUpstream(t, `{"data":[{"url":"https://cdn.example/image.png"}]}`)
	endpointProvider(t, db, "img", upstream.server.URL, "gpt-image-2.6", "/v1/images/edits")

	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newRelayOnlyRouter(t, db, engine)

	boundary := "----hapiytestboundary"
	body := multipartEditBody(t, boundary)
	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(body))
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.HasPrefix(upstream.contentType, "multipart/form-data; boundary="+boundary) {
		t.Fatalf("upstream content type: %q", upstream.contentType)
	}
	if !bytes.Equal(upstream.body, body) {
		t.Fatalf("multipart body was modified in transit:\nwant %q\ngot  %q", body, upstream.body)
	}
	if !bytes.Contains(upstream.body, []byte("-original-binary")) {
		t.Fatalf("file bytes missing upstream")
	}
}

func TestRelayForwardsCleanJSONByteForByte(t *testing.T) {
	db := newChatTestDB(t)
	upstream := newCapturedUpstream(t, `{"choices":[]}`)
	endpointProvider(t, db, "chat", upstream.server.URL, "test-model", "/v1/chat/completions")

	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newRelayOnlyRouter(t, db, engine)

	// Spacing and key order are deliberately non-canonical: a request no rule
	// rewrote must reach the upstream exactly as the client wrote it.
	body := `{"model":"test-model",   "messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if string(upstream.body) != body {
		t.Fatalf("clean JSON body was re-serialized:\nwant %q\ngot  %q", body, upstream.body)
	}
}

func TestRelayRejectsOversizedBody(t *testing.T) {
	db := newChatTestDB(t)
	upstream := newCapturedUpstream(t, `{"data":[]}`)
	endpointProvider(t, db, "img", upstream.server.URL, "gpt-image-2.6", "/v1/images/edits")

	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newRelayOnlyRouter(t, db, engine)

	huge := bytes.Repeat([]byte("a"), maxRequestBodyBytes+1)
	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(huge))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}
