package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

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
	r.GET("/chat/preferences", ChatPreferences(db))
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

func TestChatPreferenceTracksTheModelAThreadStartedWith(t *testing.T) {
	db := newChatTestDB(t)
	router := newChatRouter(db, relay.NewEngine(db), "alice")

	readPreference := func(r http.Handler) model.ChatPreference {
		t.Helper()
		rec := doJSON(t, r, http.MethodGet, "/chat/preferences", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("preferences status=%d body=%s", rec.Code, rec.Body.String())
		}
		var payload struct {
			Data model.ChatPreference `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Data
	}

	if got := readPreference(router); got.Model != "" || got.ProviderID != "" {
		t.Fatalf("new account must have no preference, got %+v", got)
	}

	rec := doJSON(t, router, http.MethodPost, "/chat/threads", `{"model":"model-a","provider_id":"p1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	if got := readPreference(router); got.Model != "model-a" || got.ProviderID != "p1" {
		t.Fatalf("preference after first thread = %+v", got)
	}

	var created struct {
		Data model.ChatThread `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	// Switching models inside an existing thread must not rewrite the default
	// for the next new conversation.
	if rec := doJSON(t, router, http.MethodPatch, "/chat/threads/"+created.Data.ID, `{"model":"model-c"}`); rec.Code != http.StatusOK {
		t.Fatalf("patch status=%d body=%s", rec.Code, rec.Body.String())
	}
	if got := readPreference(router); got.Model != "model-a" {
		t.Fatalf("thread model change leaked into preference: %+v", got)
	}

	rec = doJSON(t, router, http.MethodPost, "/chat/threads", `{"model":"model-b"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("second create status=%d body=%s", rec.Code, rec.Body.String())
	}
	if got := readPreference(router); got.Model != "model-b" || got.ProviderID != "" {
		t.Fatalf("preference after second thread = %+v", got)
	}

	bob := newChatRouter(db, relay.NewEngine(db), "bob")
	if got := readPreference(bob); got.Model != "" {
		t.Fatalf("another account must keep its own preference, got %+v", got)
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

// The agent cannot create a provider on its own (no write tool by design), so
// it must be able to open the create dialog with the name already filled in.
func TestSendChatMessageQueuesCreateProviderDraft(t *testing.T) {
	var requests int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		if requests == 1 {
			var body struct {
				Tools []map[string]any `json:"tools"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			found := false
			for _, tool := range body.Tools {
				fn, _ := tool["function"].(map[string]any)
				if fn != nil && fn["name"] == "ui_create_provider_dialog" {
					found = true
				}
			}
			if !found {
				t.Errorf("ui_create_provider_dialog missing from tools")
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"ui_1","type":"function","function":{"name":"ui_create_provider_dialog","arguments":"{\"name\":\"test\"}"}}]}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"已经打开新建供应商弹窗，名称填好了 test，确认后点保存。"}}]}`))
	}))
	defer upstream.Close()

	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", upstream.URL, true, true)
	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newChatRouter(db, engine, "alice")
	threadID := createChatTestThread(t, router)

	rec := doJSON(t, router, http.MethodPost, "/chat/threads/"+threadID+"/messages",
		`{"content":"帮我建一个叫 test 的供应商，其他留空","model":"test-model","provider_id":""}`)
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
	if action.Type != "create_provider_dialog" || action.Payload["name"] != "test" {
		t.Fatalf("unexpected action: %+v", action)
	}
}

// A provider write is not executed by the backend for the console agent: the
// tool call becomes a ui_ action, the console walks the user path and reports
// back, and only then does the tool return to the model.
func TestSendChatMessageRunsProviderWritesThroughTheConsole(t *testing.T) {
	var (
		requests  int
		sawUI     bool
		sawDirect bool
	)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		if requests == 1 {
			var body struct {
				Tools []map[string]any `json:"tools"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			for _, tool := range body.Tools {
				fn, _ := tool["function"].(map[string]any)
				switch fn["name"] {
				case "ui_create_provider":
					sawUI = true
				case "create_provider":
					sawDirect = true
				}
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"ui_create_provider","arguments":"{\\"name\\":\\"agent-test\\"}"}}]}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"控制台已经完成创建。"}}]}`))
	}))
	defer upstream.Close()

	if !strings.Contains(`ui_create_provider`, "ui_") {
		t.Fatal("unreachable")
	}
	_ = sawDirect

	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", upstream.URL, true, true)
	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newChatRouter(db, engine, "alice")
	router.POST("/chat/ui-actions/:id/result", CompleteChatUIAction())
	threadID := createChatTestThread(t, router)

	events, cancel := dashboardEventsHub.subscribe()
	defer cancel()

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- doJSON(t, router, http.MethodPost, "/chat/threads/"+threadID+"/messages",
			`{"content":"帮我建一个叫 agent-test 的供应商","model":"test-model","provider_id":""}`)
	}()

	var event hubEvent
	select {
	case event = <-events:
	case <-time.After(3 * time.Second):
		t.Fatal("no chat_ui_action event was published")
	}
	if event.event != "chat_ui_action" {
		t.Fatalf("event type = %q", event.event)
	}
	var frame struct {
		ThreadID string `json:"thread_id"`
		Action   struct {
			ID      string         `json:"id"`
			Type    string         `json:"type"`
			Payload map[string]any `json:"payload"`
		} `json:"action"`
	}
	if err := json.Unmarshal([]byte(event.data), &frame); err != nil {
		t.Fatal(err)
	}
	if frame.ThreadID != threadID || frame.Action.Type != "create_provider" || frame.Action.ID == "" {
		t.Fatalf("unexpected action frame: %+v", frame)
	}
	if frame.Action.Payload["request_id"] != frame.Action.ID {
		t.Fatalf("request_id must carry the action id: %+v", frame.Action.Payload)
	}

	// The backend must not have written anything yet: the console owns the
	// operation until it reports back.
	var count int64
	if err := db.Model(&model.Provider{}).Where("name = ?", "agent-test").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("provider was created before the console confirmed")
	}

	rec := doJSON(t, router, http.MethodPost, "/chat/ui-actions/"+frame.Action.ID+"/result",
		`{"ok":true,"message":"界面已保存","data":{"provider_id":"p-new"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("result status=%d body=%s", rec.Code, rec.Body.String())
	}

	select {
	case rec = <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("chat request did not finish after the console result")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("send status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "控制台已经完成创建") {
		t.Fatalf("unexpected reply: %s", rec.Body.String())
	}
	if !sawUI || sawDirect {
		t.Fatalf("chat tools must expose ui_create_provider only (ui=%v direct=%v)", sawUI, sawDirect)
	}
}

func TestSendChatMessageDetectsBareChatPath(t *testing.T) {
	var seenPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"bare path ok"}}]}`))
	}))
	defer upstream.Close()

	db := newChatTestDB(t)
	provider := model.Provider{
		ID:              "bare",
		Name:            "Bare",
		Status:          true,
		WorkflowEnabled: true,
		BaseURLs:        `["` + upstream.URL + `/v1"]`,
		Keys:            `["sk-test"]`,
		Endpoints:       `[]`,
		Models:          `[{"model":"test-model","endpoints":["/chat/completions"]}]`,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatal(err)
	}
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
		`{"content":"hi","model":"test-model","provider_id":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("send status=%d body=%s", rec.Code, rec.Body.String())
	}
	if seenPath != "/v1/chat/completions" {
		t.Fatalf("upstream path = %q (base /v1 + declared /chat/completions)", seenPath)
	}
	if !strings.Contains(rec.Body.String(), "bare path ok") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestSendChatMessageUsesResponsesEndpoint(t *testing.T) {
	var seenPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"r1","object":"response","created_at":1,"model":"test-model","status":"completed","output":[{"type":"message","id":"m1","role":"assistant","status":"completed","content":[{"type":"output_text","text":"responses ok"}]}],"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}`))
	}))
	defer upstream.Close()

	db := newChatTestDB(t)
	provider := model.Provider{
		ID:              "resp",
		Name:            "Responses",
		Status:          true,
		WorkflowEnabled: true,
		BaseURLs:        `["` + upstream.URL + `"]`,
		Keys:            `["sk-test"]`,
		Endpoints:       `[]`,
		Models:          `[{"model":"test-model","endpoints":["/v1/responses"]}]`,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatal(err)
	}
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
		`{"content":"hi","model":"test-model","provider_id":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("send status=%d body=%s", rec.Code, rec.Body.String())
	}
	if seenPath != "/v1/responses" {
		t.Fatalf("upstream path = %q", seenPath)
	}
	if !strings.Contains(rec.Body.String(), "responses ok") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func chatModelProviders(t *testing.T, db *gorm.DB) []chatProviderOption {
	t.Helper()
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
	if len(payload.Data) != 1 {
		t.Fatalf("unexpected models: %+v", payload.Data)
	}
	return payload.Data[0].Providers
}

func TestChatModelsKeepsProviderAvailableWhileOneKeyWorks(t *testing.T) {
	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", "http://127.0.0.1:1", true, true)
	if err := db.Model(&model.Provider{}).Where("id = ?", "p1").
		Update("keys", `["sk-a","sk-b"]`).Error; err != nil {
		t.Fatal(err)
	}
	disable := func(dimension, value string) {
		t.Helper()
		if err := db.Create(&model.AutoDisableState{
			ProviderID: "p1", Dimension: dimension, Value: value, Disabled: true,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	disable(model.FailoverDimensionKey, "sk-a")
	providers := chatModelProviders(t, db)
	if len(providers) != 1 || providers[0].AutoDisabled {
		t.Fatalf("one disabled key must not disable the provider: %+v", providers)
	}
	if providers[0].DisabledKeys != 1 || providers[0].TotalKeys != 2 || providers[0].ProviderDisabled {
		t.Fatalf("disable counters must describe the partial state: %+v", providers[0])
	}

	disable(model.FailoverDimensionKey, "sk-b")
	providers = chatModelProviders(t, db)
	if len(providers) != 1 || !providers[0].AutoDisabled {
		t.Fatalf("every key disabled must disable the provider: %+v", providers)
	}
	if providers[0].DisabledKeys != 2 || providers[0].TotalKeys != 2 {
		t.Fatalf("disable counters must describe the full state: %+v", providers[0])
	}
}

func TestChatModelsKeepsProviderAvailableWhenOnlyKeysAreDisabled(t *testing.T) {
	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", "http://127.0.0.1:1", true, true)
	if err := db.Create(&model.AutoDisableState{
		ProviderID: "p1", Dimension: model.FailoverDimensionKey, Value: "sk-test", Disabled: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	providers := chatModelProviders(t, db)
	if len(providers) != 1 || !providers[0].AutoDisabled {
		t.Fatalf("a single-key provider with that key disabled is unavailable: %+v", providers)
	}
	if providers[0].DisabledKeys != 1 || providers[0].TotalKeys != 1 || providers[0].ProviderDisabled {
		t.Fatalf("unexpected counters: %+v", providers[0])
	}
}

func TestResolveChatEndpointSkipsAutoDisabledKeys(t *testing.T) {
	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", "http://127.0.0.1:1", true, true)
	if err := db.Model(&model.Provider{}).Where("id = ?", "p1").
		Update("keys", `["sk-dead","sk-live"]`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AutoDisableState{
		ProviderID: "p1", Dimension: model.FailoverDimensionKey, Value: "sk-dead", Disabled: true,
	}).Error; err != nil {
		t.Fatal(err)
	}

	_, baseURL, key, _, err := resolveChatEndpoint(db, relay.NewEngine(db), "test-model", "p1", "session")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if baseURL != "http://127.0.0.1:1" {
		t.Fatalf("base URL = %q", baseURL)
	}
	if key != "sk-live" {
		t.Fatalf("key = %q, want the first enabled key", key)
	}
}

// A console turn is a free loop: it ends when the model stops calling tools,
// not after a fixed handful of steps. Eight tool rounds is well past the old
// six-step cap, which used to answer with 502.
func TestSendChatMessageLoopsUntilTheModelStopsCallingTools(t *testing.T) {
	const toolRounds = 8
	var requests int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		if requests <= toolRounds {
			_, _ = fmt.Fprintf(w, `{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_%d","type":"function","function":{"name":"list_providers","arguments":"{}"}}]}}]}`, requests)
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"供应商已经看完了。"}}]}`))
	}))
	defer upstream.Close()

	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", upstream.URL, true, true)
	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newChatRouter(db, engine, "alice")
	threadID := createChatTestThread(t, router)

	rec := doJSON(t, router, http.MethodPost, "/chat/threads/"+threadID+"/messages",
		`{"content":"把供应商都过一遍","model":"test-model","provider_id":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if requests != toolRounds+1 {
		t.Fatalf("upstream calls = %d, want %d", requests, toolRounds+1)
	}
	if !strings.Contains(rec.Body.String(), "供应商已经看完了") {
		t.Fatalf("final reply missing: %s", rec.Body.String())
	}
}

// When the runaway valve trips, the turn must still produce a text reply: a
// tools-disabled wrap-up call summarises what happened instead of a 502.
func TestSendChatMessageWrapsUpWhenTheToolStepValveTrips(t *testing.T) {
	previous := chatMaxToolSteps
	chatMaxToolSteps = 2
	t.Cleanup(func() { chatMaxToolSteps = previous })

	var (
		requests   int
		wrapUpSeen bool
	)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var body struct {
			Messages []map[string]any `json:"messages"`
			Tools    []map[string]any `json:"tools"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		if len(body.Tools) == 0 {
			for _, message := range body.Messages {
				if content, ok := message["content"].(string); ok && strings.Contains(content, "不要再调用任何工具") {
					wrapUpSeen = true
				}
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"前两步已经完成，剩下的请稍后继续。"}}]}`))
			return
		}
		_, _ = fmt.Fprintf(w, `{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_%d","type":"function","function":{"name":"list_providers","arguments":"{}"}}]}}]}`, requests)
	}))
	defer upstream.Close()

	db := newChatTestDB(t)
	upstreamProvider(t, db, "p1", "Alpha", upstream.URL, true, true)
	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatal(err)
	}
	router := newChatRouter(db, engine, "alice")
	threadID := createChatTestThread(t, router)

	rec := doJSON(t, router, http.MethodPost, "/chat/threads/"+threadID+"/messages",
		`{"content":"一直查下去","model":"test-model","provider_id":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !wrapUpSeen {
		t.Fatalf("the wrap-up request must carry the no-more-tools prompt")
	}
	if requests != 3 {
		t.Fatalf("upstream calls = %d, want 2 tool rounds + 1 wrap-up", requests)
	}
	if !strings.Contains(rec.Body.String(), "剩下的请稍后继续") {
		t.Fatalf("wrap-up reply missing: %s", rec.Body.String())
	}
}

func createChatTestThread(t *testing.T, router *gin.Engine) string {
	t.Helper()
	rec := doJSON(t, router, http.MethodPost, "/chat/threads", `{"model":"test-model"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create thread status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		Data model.ChatThread `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	return created.Data.ID
}

func TestTruncateChatToolResultKeepsRunesWhole(t *testing.T) {
	payload := strings.Repeat("供", 40)
	got := truncateChatToolResult(payload, 10)
	if !utf8.ValidString(got) {
		t.Fatalf("truncation split a rune: %q", got)
	}
	if len(got) >= len(payload) {
		t.Fatalf("payload was not truncated: %q", got)
	}
	if !strings.HasSuffix(got, "已截断)") {
		t.Fatalf("truncation marker missing: %q", got)
	}
	if short := "abc"; truncateChatToolResult(short, 10) != short {
		t.Fatalf("short payload must pass through unchanged")
	}
}
