package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newChatTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func newChatRouter(db *gorm.DB, engine *relay.Engine, user string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user)
		c.Next()
	})
	r.GET("/chat/models", ChatModels(db))
	r.GET("/chat/threads", ListChatThreads(db))
	r.POST("/chat/threads", CreateChatThread(db))
	r.PATCH("/chat/threads/:id", UpdateChatThread(db))
	r.DELETE("/chat/threads/:id", DeleteChatThread(db))
	r.GET("/chat/threads/:id/messages", ListChatMessages(db))
	r.POST("/chat/threads/:id/messages", SendChatMessage(db, engine))
	return r
}

func doJSON(t *testing.T, r http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func upstreamProvider(t *testing.T, db *gorm.DB, id, name, baseURL string, status, workflow bool) {
	t.Helper()
	provider := model.Provider{
		ID:              id,
		Name:            name,
		Status:          status,
		WorkflowEnabled: workflow,
		BaseURLs:        `["` + baseURL + `"]`,
		Keys:            `["sk-test"]`,
		Endpoints:       `[{"pathSuffix":"/v1/chat/completions"}]`,
		Models:          `[{"model":"test-model","endpoints":["/v1/chat/completions"]}]`,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatal(err)
	}
	// Status/WorkflowEnabled carry `default:true`, so GORM substitutes the
	// default for a false zero value on create.
	if err := db.Model(&model.Provider{}).Where("id = ?", id).
		Updates(map[string]any{"status": status, "workflow_enabled": workflow}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestChatModelsListsEnabledProviders(t *testing.T) {
	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", "http://127.0.0.1:1", true, true)
	upstreamProvider(t, db, "p2", "Beta", "http://127.0.0.1:1", true, false)
	upstreamProvider(t, db, "p3", "Off", "http://127.0.0.1:1", false, true)

	rec := doJSON(t, newChatRouter(db, relay.NewEngine(db), "alice"), http.MethodGet, "/chat/models", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Data []chatModelOption `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 1 || payload.Data[0].Model != "test-model" {
		t.Fatalf("unexpected models: %+v", payload.Data)
	}
	providers := payload.Data[0].Providers
	if len(providers) != 2 {
		t.Fatalf("disabled providers must be excluded, got %+v", providers)
	}
	if providers[0].Name != "Alpha" || providers[1].Name != "Beta" {
		t.Fatalf("providers must be sorted by name: %+v", providers)
	}
}

func TestChatThreadsAreScopedToTheAccount(t *testing.T) {
	db := newChatTestDB(t)
	engine := relay.NewEngine(db)
	alice := newChatRouter(db, engine, "alice")
	bob := newChatRouter(db, engine, "bob")

	rec := doJSON(t, alice, http.MethodPost, "/chat/threads", `{"model":"test-model"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		Data model.ChatThread `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	if rec := doJSON(t, bob, http.MethodGet, "/chat/threads/"+created.Data.ID+"/messages", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("another account must not read the thread, got %d", rec.Code)
	}
	if rec := doJSON(t, bob, http.MethodDelete, "/chat/threads/"+created.Data.ID, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("another account must not delete the thread, got %d", rec.Code)
	}

	rec = doJSON(t, alice, http.MethodGet, "/chat/threads", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), created.Data.ID) {
		t.Fatalf("owner must see the thread: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSendChatMessageRunsThroughAutoDispatch(t *testing.T) {
	var seenModel string
	var seenSession string
	var seenMessages []map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected upstream path %s", r.URL.Path)
		}
		seenSession = r.Header.Get("X-Session-Id")
		var body struct {
			Model    string           `json:"model"`
			Messages []map[string]any `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		seenModel = body.Model
		seenMessages = body.Messages
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"来自上游的回复"}}]}`))
	}))
	defer upstream.Close()

	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", upstream.URL, true, true)
	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newChatRouter(db, engine, "alice")

	// Create the thread, then send the first message.
	rec := doJSON(t, router, http.MethodPost, "/chat/threads", `{"model":"test-model"}`)
	var created struct {
		Data model.ChatThread `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	rec = doJSON(t, router, http.MethodPost, "/chat/threads/"+created.Data.ID+"/messages",
		`{"content":"你好","model":"test-model","provider_id":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("send status=%d body=%s", rec.Code, rec.Body.String())
	}
	if seenModel != "test-model" {
		t.Fatalf("upstream saw model %q", seenModel)
	}
	if seenSession != created.Data.ID {
		t.Fatalf("session header = %q, want thread id %q", seenSession, created.Data.ID)
	}
	if len(seenMessages) != 1 || seenMessages[0]["content"] != "你好" {
		t.Fatalf("unexpected messages sent upstream: %+v", seenMessages)
	}

	var payload struct {
		Data struct {
			Thread           model.ChatThread  `json:"thread"`
			UserMessage      model.ChatMessage `json:"user_message"`
			AssistantMessage model.ChatMessage `json:"assistant_message"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.AssistantMessage.Content != "来自上游的回复" {
		t.Fatalf("assistant content = %q", payload.Data.AssistantMessage.Content)
	}
	if payload.Data.AssistantMessage.ProviderName != "Alpha" {
		t.Fatalf("provider name = %q", payload.Data.AssistantMessage.ProviderName)
	}
	if payload.Data.Thread.Title != "你好" {
		t.Fatalf("thread title = %q", payload.Data.Thread.Title)
	}

	// The second turn must carry the persisted history upstream.
	rec = doJSON(t, router, http.MethodPost, "/chat/threads/"+created.Data.ID+"/messages",
		`{"content":"继续","model":"test-model","provider_id":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("second send status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(seenMessages) != 3 {
		t.Fatalf("history not sent: %+v", seenMessages)
	}
	if seenMessages[0]["role"] != "user" || seenMessages[1]["role"] != "assistant" || seenMessages[2]["content"] != "继续" {
		t.Fatalf("unexpected history: %+v", seenMessages)
	}

	var stored []model.ChatMessage
	if err := db.Where("thread_id = ?", created.Data.ID).Order("created_at asc").Find(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if len(stored) != 4 {
		t.Fatalf("expected 4 persisted messages, got %d", len(stored))
	}
}

func TestSendChatMessageToFixedProviderBypassesWorkflow(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"fixed ok"}}]}`))
	}))
	defer upstream.Close()

	db := newChatTestDB(t)
	// workflow_enabled=false: the provider is not in the startup plans, but a
	// fixed selection must still be able to use it.
	upstreamProvider(t, db, "fixed", "Fixed", upstream.URL, true, false)
	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newChatRouter(db, engine, "alice")

	rec := doJSON(t, router, http.MethodPost, "/chat/threads", `{"model":"test-model","provider_id":"fixed"}`)
	var created struct {
		Data model.ChatThread `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	rec = doJSON(t, router, http.MethodPost, "/chat/threads/"+created.Data.ID+"/messages",
		`{"content":"hi","model":"test-model","provider_id":"fixed"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("fixed send status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "fixed ok") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestSendChatMessageRejectsADisabledFixedProvider(t *testing.T) {
	db := newChatTestDB(t)
	upstreamProvider(t, db, "off", "Off", "http://127.0.0.1:1", false, true)
	engine := relay.NewEngine(db)
	router := newChatRouter(db, engine, "alice")

	rec := doJSON(t, router, http.MethodPost, "/chat/threads", `{"model":"test-model"}`)
	var created struct {
		Data model.ChatThread `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	rec = doJSON(t, router, http.MethodPost, "/chat/threads/"+created.Data.ID+"/messages",
		`{"content":"hi","model":"test-model","provider_id":"off"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("disabled provider must be rejected, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestSendChatMessageRunsMCPToolCalls(t *testing.T) {
	var (
		requests int
		second   []map[string]any
	)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var body struct {
			Messages []map[string]any `json:"messages"`
			Tools    []map[string]any `json:"tools"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if requests == 1 && len(body.Tools) == 0 {
			t.Errorf("first request must carry MCP tools")
		}
		w.Header().Set("Content-Type", "application/json")
		if requests == 1 {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"list_providers","arguments":"{}"}}]}}]}`))
			return
		}
		second = body.Messages
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"网关里现在没有供应商。"}}]}`))
	}))
	defer upstream.Close()

	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", upstream.URL, true, true)
	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newChatRouter(db, engine, "alice")

	rec := doJSON(t, router, http.MethodPost, "/chat/threads", `{"model":"test-model"}`)
	var created struct {
		Data model.ChatThread `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	rec = doJSON(t, router, http.MethodPost, "/chat/threads/"+created.Data.ID+"/messages",
		`{"content":"现在有哪些供应商？","model":"test-model","provider_id":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("send status=%d body=%s", rec.Code, rec.Body.String())
	}
	if requests != 2 {
		t.Fatalf("expected a second upstream call after the tool result, got %d", requests)
	}
	toolSeen := false
	for _, message := range second {
		if message["role"] != "tool" {
			continue
		}
		toolSeen = true
		if message["tool_call_id"] != "call_1" {
			t.Fatalf("tool_call_id = %v", message["tool_call_id"])
		}
		content, _ := message["content"].(string)
		if !strings.Contains(content, "providers") {
			t.Fatalf("tool result not forwarded: %q", content)
		}
	}
	if !toolSeen {
		t.Fatalf("the tool result was not appended to the conversation: %+v", second)
	}
	if !strings.Contains(rec.Body.String(), "现在没有供应商") {
		t.Fatalf("unexpected final reply: %s", rec.Body.String())
	}
}

func TestSendChatMessageQueuesUIActions(t *testing.T) {
	var requests int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		if requests == 1 {
			var body struct {
				Tools []map[string]any `json:"tools"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			foundUI := false
			for _, tool := range body.Tools {
				fn, _ := tool["function"].(map[string]any)
				if fn != nil && fn["name"] == "ui_open_provider_dialog" {
					foundUI = true
				}
			}
			if !foundUI {
				t.Errorf("ui_open_provider_dialog missing from tools")
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"ui_1","type":"function","function":{"name":"ui_open_provider_dialog","arguments":"{\"provider_name\":\"Backup-GPT\"}"}}]}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"已经打开供应商编辑弹窗，改完点保存。"}}]}`))
	}))
	defer upstream.Close()

	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", upstream.URL, true, true)
	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newChatRouter(db, engine, "alice")

	rec := doJSON(t, router, http.MethodPost, "/chat/threads", `{"model":"test-model"}`)
	var created struct {
		Data model.ChatThread `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	rec = doJSON(t, router, http.MethodPost, "/chat/threads/"+created.Data.ID+"/messages",
		`{"content":"帮我改一下 Backup-GPT","model":"test-model","provider_id":"","page_context":"/logs"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("send status=%d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Data struct {
			UIActions []struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			} `json:"ui_actions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Data.UIActions) != 1 {
		t.Fatalf("expected one UI action, got %+v", payload.Data.UIActions)
	}
	action := payload.Data.UIActions[0]
	if action.Type != "open_provider_dialog" || action.Payload["provider_name"] != "Backup-GPT" {
		t.Fatalf("unexpected action: %+v", action)
	}
}
