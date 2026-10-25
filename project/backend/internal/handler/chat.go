package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/chatproto"
	hapiymcp "github.com/hapiy/hapiy/internal/mcp"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/hapiy/hapiy/internal/version"
	"gorm.io/gorm"
)

// The console chat speaks the OpenAI chat-completions shape and reuses the
// relay engine, so a reply goes through the same provider, rewrite, failover
// and affinity machinery as external clients.
const (
	chatPath         = "/v1/chat/completions"
	chatHistoryLimit = 40
	// chatRequestTimeout is the wall clock of one turn. The tool loop is free
	// (no small step cap), so time is what bounds a runaway task — not a
	// count of steps.
	chatRequestTimeout   = 30 * time.Minute
	chatMaxResponseBytes = 8 << 20
	// A free loop appends every tool result to the next request, so unbounded
	// output — not the step count — is what actually kills a long turn
	// (context overflow). One result is cut at chatToolResultMaxBytes, and a
	// turn stops opening new steps once the sum passes chatToolBudgetMaxBytes.
	chatToolResultMaxBytes = 32 << 10
	chatToolBudgetMaxBytes = 512 << 10
	// chatWrapUpTimeout is the text-only call that summarises a turn stopped
	// by a safety valve.
	chatWrapUpTimeout     = 2 * time.Minute
	chatDefaultTitleRunes = 40
)

const chatWrapUpPrompt = "本轮的工具调用步数或输出预算已用尽。不要再调用任何工具，直接用文字回答：已经完成了哪些操作、还有哪些没做完、建议用户下一步怎么做。"

// chatUIWriteTools are exposed to the console agent as ui_* actions instead of
// direct MCP writes: the console performs the normal user path (navigate, open
// the dialog, fill, save/confirm) and reports the outcome back. External MCP
// clients keep the direct tools; the chat deliberately does not see them.
var chatUIWriteTools = map[string]bool{
	"create_provider":            true,
	"update_provider":            true,
	"delete_provider":            true,
	"set_provider_status":        true,
	"set_provider_workflow":      true,
	"set_provider_dedupe_v1":     true,
	"reset_provider_disable":     true,
	"reset_all_provider_disable": true,
}

// chatMaxToolSteps is a runaway valve, not the normal exit: the loop ends when
// the model stops calling tools, the way a coding agent works. Tests lower it
// to force the valve without burning 200 upstream calls.
var chatMaxToolSteps = 200

// chatUser returns the dashboard account the request belongs to (the session
// middleware stores the username under user_id).
func chatUser(c *gin.Context) string {
	return strings.TrimSpace(c.GetString("user_id"))
}

func loadChatThread(db *gorm.DB, id, user string) (*model.ChatThread, error) {
	var thread model.ChatThread
	if err := db.Where("id = ? AND user_id = ?", id, user).First(&thread).Error; err != nil {
		return nil, err
	}
	return &thread, nil
}

// ListChatThreads serves GET /v1/dashboard/chat/threads.
func ListChatThreads(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		user := chatUser(c)
		query := db.Where("user_id = ?", user)
		if c.Query("archived") == "true" {
			query = query.Where("archived = ?", true)
		} else {
			query = query.Where("archived = ?", false)
		}
		var threads []model.ChatThread
		if err := query.Order("updated_at desc").Find(&threads).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": threads, "total": len(threads)})
	}
}

// CreateChatThread serves POST /v1/dashboard/chat/threads.
func CreateChatThread(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Model      string `json:"model"`
			ProviderID string `json:"provider_id"`
		}
		_ = c.ShouldBindJSON(&req)
		thread := model.ChatThread{
			UserID:     chatUser(c),
			Model:      strings.TrimSpace(req.Model),
			ProviderID: strings.TrimSpace(req.ProviderID),
		}
		if err := db.Create(&thread).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Remember the model this conversation started with; it becomes the
		// default for the account's next new conversation. Best-effort: a
		// failure only affects that default, so the thread still succeeds.
		if thread.Model != "" {
			preference := model.ChatPreference{
				UserID:     thread.UserID,
				Model:      thread.Model,
				ProviderID: thread.ProviderID,
			}
			_ = db.Save(&preference).Error
		}
		c.JSON(http.StatusOK, gin.H{"data": thread})
	}
}

// ChatPreferences serves GET /v1/dashboard/chat/preferences. The panel reads
// it when it opens a new conversation: the stored model wins while it is still
// offered, otherwise the client falls back to the first available model.
func ChatPreferences(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		preference := model.ChatPreference{UserID: chatUser(c)}
		err := db.Where("user_id = ?", preference.UserID).First(&preference).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": preference})
	}
}

// UpdateChatThread serves PATCH /v1/dashboard/chat/threads/:id (rename and
// archive). The model/provider pair can also be updated here so a thread can
// switch models without sending a message first.
func UpdateChatThread(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		thread, err := loadChatThread(db, c.Param("id"), chatUser(c))
		if err != nil {
			respondError(c, http.StatusNotFound, "CHAT_THREAD_NOT_FOUND", "会话不存在")
			return
		}
		var req struct {
			Title      *string `json:"title"`
			Archived   *bool   `json:"archived"`
			Model      *string `json:"model"`
			ProviderID *string `json:"provider_id"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		updates := map[string]any{}
		if req.Title != nil {
			title := strings.TrimSpace(*req.Title)
			if title == "" {
				respondError(c, http.StatusBadRequest, "CHAT_TITLE_REQUIRED", "标题不能为空")
				return
			}
			updates["title"] = title
		}
		if req.Archived != nil {
			updates["archived"] = *req.Archived
		}
		if req.Model != nil {
			updates["model"] = strings.TrimSpace(*req.Model)
		}
		if req.ProviderID != nil {
			updates["provider_id"] = strings.TrimSpace(*req.ProviderID)
		}
		if len(updates) == 0 {
			c.JSON(http.StatusOK, gin.H{"data": thread})
			return
		}
		if err := db.Model(&model.ChatThread{}).Where("id = ?", thread.ID).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.First(thread, "id = ?", thread.ID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": thread})
	}
}

// DeleteChatThread serves DELETE /v1/dashboard/chat/threads/:id.
func DeleteChatThread(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		thread, err := loadChatThread(db, c.Param("id"), chatUser(c))
		if err != nil {
			respondError(c, http.StatusNotFound, "CHAT_THREAD_NOT_FOUND", "会话不存在")
			return
		}
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("thread_id = ?", thread.ID).Delete(&model.ChatMessage{}).Error; err != nil {
				return err
			}
			return tx.Delete(&model.ChatThread{}, "id = ?", thread.ID).Error
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
	}
}

// ListChatMessages serves GET /v1/dashboard/chat/threads/:id/messages.
func ListChatMessages(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		thread, err := loadChatThread(db, c.Param("id"), chatUser(c))
		if err != nil {
			respondError(c, http.StatusNotFound, "CHAT_THREAD_NOT_FOUND", "会话不存在")
			return
		}
		var messages []model.ChatMessage
		if err := db.Where("thread_id = ?", thread.ID).Order("created_at asc").Find(&messages).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": messages, "total": len(messages)})
	}
}

// chatProviderOption is one selectable provider for a model. The disable
// counters let the picker show what is auto-disabled (e.g. "Key 3/4") without
// exposing the key values themselves.
type chatProviderOption struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	AutoDisabled     bool   `json:"auto_disabled"`
	WorkflowOn       bool   `json:"workflow_enabled"`
	StatusEnabled    bool   `json:"status"`
	ProviderDisabled bool   `json:"provider_disabled"`
	DisabledBaseURLs int    `json:"disabled_base_urls"`
	TotalBaseURLs    int    `json:"total_base_urls"`
	DisabledKeys     int    `json:"disabled_keys"`
	TotalKeys        int    `json:"total_keys"`
}

// chatModelOption is one selectable model plus the providers that declare it.
type chatModelOption struct {
	Model     string               `json:"model"`
	Providers []chatProviderOption `json:"providers"`
}

// ChatModels serves GET /v1/dashboard/chat/models. The list is the union of
// models declared by enabled providers; the first provider option in the UI is
// "自动", which dispatches through the topology.
func ChatModels(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var providers []model.Provider
		if err := db.Where("status = ?", true).Order("name asc").Find(&providers).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var states []model.AutoDisableState
		if err := db.Where("disabled = ?", true).Find(&states).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		statesByProvider := make(map[string][]model.AutoDisableState, len(states))
		for _, state := range states {
			statesByProvider[state.ProviderID] = append(statesByProvider[state.ProviderID], state)
		}
		byModel := map[string][]chatProviderOption{}
		for _, provider := range providers {
			disable := summarizeDisables(provider, statesByProvider[provider.ID])
			option := chatProviderOption{
				ID:               provider.ID,
				Name:             provider.Name,
				AutoDisabled:     disable.unavailable(),
				WorkflowOn:       provider.WorkflowEnabled,
				StatusEnabled:    provider.Status,
				ProviderDisabled: disable.ProviderDisabled,
				DisabledBaseURLs: disable.DisabledBaseURLs,
				TotalBaseURLs:    disable.TotalBaseURLs,
				DisabledKeys:     disable.DisabledKeys,
				TotalKeys:        disable.TotalKeys,
			}
			for _, name := range parseProviderModelNames(provider.Models) {
				byModel[name] = append(byModel[name], option)
			}
		}
		models := make([]chatModelOption, 0, len(byModel))
		for name, options := range byModel {
			models = append(models, chatModelOption{Model: name, Providers: options})
		}
		sort.Slice(models, func(i, j int) bool { return models[i].Model < models[j].Model })
		c.JSON(http.StatusOK, gin.H{"data": models})
	}
}

// chatDisableSummary counts the auto-disabled channels of one provider. The
// provider is unusable only when it is disabled as a whole or every configured
// key (or base URL) is disabled; a partial key disable stays selectable.
type chatDisableSummary struct {
	ProviderDisabled bool
	DisabledBaseURLs int
	TotalBaseURLs    int
	DisabledKeys     int
	TotalKeys        int
}

func (s chatDisableSummary) unavailable() bool {
	if s.ProviderDisabled {
		return true
	}
	if s.TotalKeys > 0 && s.DisabledKeys == s.TotalKeys {
		return true
	}
	return s.TotalBaseURLs > 0 && s.DisabledBaseURLs == s.TotalBaseURLs
}

func summarizeDisables(provider model.Provider, states []model.AutoDisableState) chatDisableSummary {
	keys := parseStringArray(provider.Keys)
	baseURLs := parseStringArray(provider.BaseURLs)
	keySet := make(map[string]bool, len(keys))
	for _, key := range keys {
		keySet[key] = true
	}
	baseURLSet := make(map[string]bool, len(baseURLs))
	for _, baseURL := range baseURLs {
		baseURLSet[baseURL] = true
	}
	summary := chatDisableSummary{TotalBaseURLs: len(baseURLs), TotalKeys: len(keys)}
	for _, state := range states {
		switch state.Dimension {
		case model.FailoverDimensionProvider:
			if state.Value == provider.ID {
				summary.ProviderDisabled = true
			}
		case model.FailoverDimensionKey:
			// Count only configured values: a stale row for a removed key must
			// not make the provider look worse than it is.
			if keySet[state.Value] {
				summary.DisabledKeys++
			}
		case model.FailoverDimensionBaseURL:
			if baseURLSet[state.Value] {
				summary.DisabledBaseURLs++
			}
		}
	}
	return summary
}

// chatUIAction is one frontend action the model asked for (open a dialog,
// prefill fields). The console applies it after the reply arrives, so the
// agent never writes configuration on its own.
type chatUIAction struct {
	// ID dedupes the same action arriving twice: once over the live dashboard
	// event stream while the turn runs, and once in the final response.
	ID      string         `json:"id,omitempty"`
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

// pushChatUIAction publishes one action to the dashboard SSE hub so the console
// can follow the agent while the turn is still running. External MCP clients
// never see this: it is emitted by the chat handler, not by the MCP server.
func pushChatUIAction(user, threadID string, action chatUIAction) {
	dashboardEventsHub.publish("chat_ui_action", map[string]any{
		"thread_id": threadID,
		"user":      user,
		"action":    action,
	})
}

// SendChatMessage serves POST /v1/dashboard/chat/threads/:id/messages. It
// resolves the model's endpoint (chat completions / Responses / Anthropic),
// runs the conversation through the matching protocol adapter, executes MCP
// tool calls, and persists the user and assistant turns.
func SendChatMessage(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		user := chatUser(c)
		thread, err := loadChatThread(db, c.Param("id"), user)
		if err != nil {
			respondError(c, http.StatusNotFound, "CHAT_THREAD_NOT_FOUND", "会话不存在")
			return
		}
		var req struct {
			Content     string `json:"content"`
			Model       string `json:"model"`
			ProviderID  string `json:"provider_id"`
			PageContext string `json:"page_context"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		content := strings.TrimSpace(req.Content)
		if content == "" {
			respondError(c, http.StatusBadRequest, "CHAT_CONTENT_REQUIRED", "消息不能为空")
			return
		}
		modelName := firstNonEmptyString(strings.TrimSpace(req.Model), thread.Model)
		providerID := strings.TrimSpace(req.ProviderID)
		if providerID == "" {
			providerID = thread.ProviderID
		}
		if modelName == "" {
			respondError(c, http.StatusBadRequest, "CHAT_MODEL_REQUIRED", "先选择一个模型")
			return
		}

		var history []model.ChatMessage
		if err := db.Where("thread_id = ? AND role IN ? AND error = ''", thread.ID, []string{"user", "assistant"}).
			Order("created_at asc").Find(&history).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if len(history) > chatHistoryLimit {
			history = history[len(history)-chatHistoryLimit:]
		}
		messages := make([]chatproto.Message, 0, len(history)+2)
		if page := strings.TrimSpace(req.PageContext); page != "" {
			messages = append(messages, chatproto.Message{
				Role: "system",
				Content: "用户当前在控制台页面 " + page + "。查询用只读工具；所有写操作（新建/修改/删除/启停/恢复）调用 ui_ 开头的执行工具，" +
					"由控制台按用户操作路径完成并返回结果，不要走直连写工具。汇报时以界面返回的结果为准，不要假设没有返回结果的操作已经完成。" +
					"需要用户亲自填写敏感字段时，用 ui_open_provider_dialog / ui_create_provider_dialog 打开界面并预填。",
			})
		}
		for _, message := range history {
			text := strings.TrimSpace(message.Content)
			if text == "" {
				continue
			}
			messages = append(messages, chatproto.Message{Role: message.Role, Content: text})
		}
		messages = append(messages, chatproto.Message{Role: "user", Content: content})

		ctx, cancel := context.WithTimeout(c.Request.Context(), chatRequestTimeout)
		defer cancel()

		endpoint, baseURL, apiKey, provider, resolveErr := resolveChatEndpoint(db, engine, modelName, providerID, thread.ID)
		if resolveErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": resolveErr.Error()})
			return
		}

		// Expose the MCP tools to the model through the same registry /mcp uses.
		runner, err := hapiymcp.NewToolRunner(ctx, db, engine, version.Version)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "初始化 MCP 工具失败: " + err.Error()})
			return
		}
		defer runner.Close()
		listed, err := runner.Tools(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "读取 MCP 工具失败: " + err.Error()})
			return
		}
		tools := make([]chatproto.Tool, 0, len(listed))
		for _, tool := range listed {
			schema, marshalErr := json.Marshal(tool.InputSchema)
			if marshalErr != nil {
				continue
			}
			if chatUIWriteTools[tool.Name] {
				// Same schema and arguments, different execution path: the
				// console runs it as a user would.
				tools = append(tools, chatproto.Tool{
					Name:        "ui_" + tool.Name,
					Description: tool.Description + "（由控制台界面按用户操作路径执行，完成后返回结果）",
					Schema:      schema,
				})
				continue
			}
			tools = append(tools, chatproto.Tool{Name: tool.Name, Description: tool.Description, Schema: schema})
		}
		tools = append(tools, chatproto.Tool{
			Name:        "ui_open_provider_dialog",
			Description: "在控制台右侧打开供应商编辑弹窗并定位到该供应商，由用户确认后保存。用于“帮我改供应商 X”的操作。",
			Schema:      json.RawMessage(`{"type":"object","properties":{"provider_id":{"type":"string","description":"供应商 id，已知时优先传"},"provider_name":{"type":"string","description":"供应商名称，id 未知时用名称匹配"}}}`),
		})
		tools = append(tools, chatproto.Tool{
			Name:        "ui_create_provider_dialog",
			Description: "在控制台打开“新建供应商”弹窗并预填给定字段，由用户确认后保存。供应商还不存在、需要新建时用它；不要声称已经保存。",
			Schema:      json.RawMessage(`{"type":"object","properties":{"name":{"type":"string","description":"新供应商名称，必填；其余字段留空由用户填写"}},"required":["name"]}`),
		})

		uiActions := make([]chatUIAction, 0)
		actionSeq := 0
		nextAction := func(actionType string, payload map[string]any) chatUIAction {
			actionSeq++
			return chatUIAction{
				ID:      fmt.Sprintf("%s-%d-%d", thread.ID, start.UnixNano(), actionSeq),
				Type:    actionType,
				Payload: payload,
			}
		}
		reply := ""
		var usage chatproto.Result
		toolBytes := 0
		for step := 0; step < chatMaxToolSteps; step++ {
			result, completeErr := chatproto.Complete(ctx, chatproto.Request{
				Endpoint:  endpoint,
				BaseURL:   baseURL,
				Key:       apiKey,
				Model:     modelName,
				Messages:  messages,
				Tools:     tools,
				SessionID: thread.ID,
			})
			if completeErr != nil {
				if errors.Is(ctx.Err(), context.DeadlineExceeded) {
					c.JSON(http.StatusGatewayTimeout, gin.H{"error": "本轮已超过 " + chatRequestTimeout.String() + " 上限，工具调用被中止"})
					return
				}
				c.JSON(http.StatusBadGateway, gin.H{"error": completeErr.Error()})
				return
			}
			// Every step is a separate upstream call, so the turn's usage is
			// the sum, not the last step's.
			usage.PromptTokens += result.PromptTokens
			usage.CompletionTokens += result.CompletionTokens
			usage.TotalTokens += result.TotalTokens
			if len(result.ToolCalls) == 0 {
				reply = result.Text
				break
			}
			messages = append(messages, chatproto.Message{
				Role:      "assistant",
				Content:   result.Text,
				ToolCalls: result.ToolCalls,
			})
			for _, call := range result.ToolCalls {
				arguments := map[string]any{}
				if strings.TrimSpace(call.Arguments) != "" {
					_ = json.Unmarshal([]byte(call.Arguments), &arguments)
				}
				var payload string
				if strings.HasPrefix(call.Name, "ui_") {
					actionType := strings.TrimPrefix(call.Name, "ui_")
					action := nextAction(actionType, arguments)
					if chatUIWriteTools[actionType] {
						arguments["request_id"] = action.ID
					}
					uiActions = append(uiActions, action)
					pushChatUIAction(user, thread.ID, action)
					if chatUIWriteTools[actionType] {
						// Block until the console has walked the user path and
						// reported the outcome, so the model cannot claim a
						// result the UI has not produced.
						result, waitErr := awaitChatUIAction(ctx, user, action.ID)
						switch {
						case waitErr != nil:
							payload = `{"error":` + strconv.Quote(waitErr.Error()) + `}`
						case !result.OK:
							payload = `{"error":` + strconv.Quote(firstNonEmptyString(result.Message, "界面执行失败")) + `}`
						default:
							payload = hapiymcp.MarshalToolResult(result)
						}
					} else {
						payload = `{"ok":true,"note":"action queued for the console UI"}`
					}
				} else if chatUIWriteTools[call.Name] {
					// Safety net: the direct write tools are not advertised to
					// the chat, and must not be callable even if hallucinated.
					payload = `{"error":"该操作必须通过控制台界面执行，请调用对应的 ui_ 工具"}`
				} else {
					value, callErr := runner.Call(ctx, call.Name, arguments)
					if callErr != nil {
						payload = `{"error":` + strconv.Quote(callErr.Error()) + `}`
					} else {
						payload = hapiymcp.MarshalToolResult(value)
					}
				}
				payload = truncateChatToolResult(payload, chatToolResultMaxBytes)
				toolBytes += len(payload)
				messages = append(messages, chatproto.Message{
					Role:       "tool",
					ToolCallID: call.ID,
					Content:    payload,
				})
			}
			if toolBytes >= chatToolBudgetMaxBytes {
				break
			}
		}
		if strings.TrimSpace(reply) == "" {
			// The loop stopped on a safety valve (step count or tool output
			// budget) while the model was still working. Ask for a text-only
			// wrap-up so the user learns what happened instead of a bare error.
			wrapCtx, cancelWrap := context.WithTimeout(ctx, chatWrapUpTimeout)
			defer cancelWrap()
			final, finalErr := chatproto.Complete(wrapCtx, chatproto.Request{
				Endpoint:  endpoint,
				BaseURL:   baseURL,
				Key:       apiKey,
				Model:     modelName,
				Messages:  append(messages, chatproto.Message{Role: "user", Content: chatWrapUpPrompt}),
				SessionID: thread.ID,
			})
			if finalErr != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "本轮没有正常结束: " + finalErr.Error()})
				return
			}
			usage.PromptTokens += final.PromptTokens
			usage.CompletionTokens += final.CompletionTokens
			usage.TotalTokens += final.TotalTokens
			reply = final.Text
		}
		if strings.TrimSpace(reply) == "" {
			c.JSON(http.StatusBadGateway, gin.H{"error": "上游没有返回文本回复"})
			return
		}

		userMessage := model.ChatMessage{
			ThreadID: thread.ID,
			Role:     "user",
			Content:  content,
			Model:    modelName,
		}
		assistantMessage := model.ChatMessage{
			ThreadID:     thread.ID,
			Role:         "assistant",
			Content:      reply,
			Model:        modelName,
			ProviderID:   provider.ID,
			ProviderName: provider.Name,
		}
		updates := map[string]any{
			"updated_at":  time.Now(),
			"model":       modelName,
			"provider_id": providerID,
		}
		if strings.TrimSpace(thread.Title) == "" {
			thread.Title = chatTitle(content)
			updates["title"] = thread.Title
		}
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&userMessage).Error; err != nil {
				return err
			}
			if err := tx.Create(&assistantMessage).Error; err != nil {
				return err
			}
			return tx.Model(&model.ChatThread{}).Where("id = ?", thread.ID).Updates(updates).Error
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thread.Model = modelName
		thread.ProviderID = providerID

		// Usage record for the built-in agent: no token, source 内置Agent.
		logEntry := model.Log{
			UserID:           user,
			TokenName:        "",
			ProviderName:     provider.Name,
			ModelName:        modelName,
			Source:           "内置Agent",
			Status:           "success",
			IP:               c.ClientIP(),
			RequestID:        c.GetString("request_id"),
			UseTime:          int(time.Since(start).Milliseconds()),
			PromptTokens:     usage.PromptTokens,
			CompletionTokens: usage.CompletionTokens,
		}
		if usage.PromptTokens+usage.CompletionTokens > 0 {
			logEntry.Quota, logEntry.Currency = computeQuota(db, quotaRequest{
				provider:  provider,
				modelName: modelName,
				usage: &relay.UsageInfo{
					PromptTokens:     usage.PromptTokens,
					CompletionTokens: usage.CompletionTokens,
					TotalTokens:      usage.TotalTokens,
				},
			})
			if logEntry.Currency == "" {
				logEntry.Currency = service.GetBillingCurrency(db)
			}
		}
		if writer := service.Logs(); writer != nil {
			writer.Write(&logEntry)
		}

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"thread":            thread,
			"user_message":      userMessage,
			"assistant_message": assistantMessage,
			"ui_actions":        uiActions,
		}})
	}
}

// resolveChatEndpoint picks the endpoint, base URL and key for one chat turn.
// An empty providerID means 自动: try the model's declared endpoints in
// protocol order and let the topology dispatch pick a provider for each.
func resolveChatEndpoint(db *gorm.DB, engine *relay.Engine, modelName, providerID, sessionID string) (chatproto.Endpoint, string, string, *model.Provider, error) {
	if providerID != "" {
		var provider model.Provider
		if err := db.First(&provider, "id = ?", providerID).Error; err != nil {
			return chatproto.Endpoint{}, "", "", nil, fmt.Errorf("找不到供应商")
		}
		if !provider.Status {
			return chatproto.Endpoint{}, "", "", nil, fmt.Errorf("供应商 %s 已停用", provider.Name)
		}
		plan, err := engine.PlanForProvider(providerID)
		if err != nil {
			return chatproto.Endpoint{}, "", "", nil, fmt.Errorf("编译供应商 %s 失败: %w", provider.Name, err)
		}
		endpoints := chatproto.Resolve(plan.Provider, modelName)
		if len(endpoints) == 0 {
			return chatproto.Endpoint{}, "", "", nil, fmt.Errorf("供应商 %s 的模型 %s 没有可用的聊天端点", provider.Name, modelName)
		}
		for _, endpoint := range endpoints {
			if !plan.AllowsPath(modelName, endpoint.Path) {
				continue
			}
			baseURLIndex := engine.FirstEnabledIndex(providerID, model.FailoverDimensionBaseURL, plan.BaseURLs, -1)
			keyIndex := engine.FirstEnabledIndex(providerID, model.FailoverDimensionKey, plan.Keys, -1)
			if baseURLIndex < 0 || keyIndex < 0 {
				return chatproto.Endpoint{}, "", "", nil, fmt.Errorf("供应商 %s 的 Key 或 BaseURL 已全部禁用", provider.Name)
			}
			baseURL := plan.BaseURLs[baseURLIndex]
			key := plan.Keys[keyIndex]
			if baseURL == "" || key == "" {
				return chatproto.Endpoint{}, "", "", nil, fmt.Errorf("供应商 %s 缺少 BaseURL 或 Key", provider.Name)
			}
			return endpoint, baseURL, key, plan.Provider, nil
		}
		return chatproto.Endpoint{}, "", "", nil, fmt.Errorf("供应商 %s 的模型 %s 没有可用的聊天端点", provider.Name, modelName)
	}

	paths := autoChatPaths(db, modelName)
	var lastErr error
	for _, path := range paths {
		protocol, ok := chatproto.Detect(path)
		if !ok {
			continue
		}
		result, err := engine.Dispatch(modelName, path, &affinity.Request{
			Model:   modelName,
			Path:    path,
			Headers: map[string]string{"X-Session-Id": sessionID},
		})
		if err != nil {
			lastErr = err
			continue
		}
		baseURL := ""
		if result.BaseURLIndex >= 0 && result.BaseURLIndex < len(result.Plan.BaseURLs) {
			baseURL = result.Plan.BaseURLs[result.BaseURLIndex]
		} else if len(result.Plan.BaseURLs) > 0 {
			baseURL = result.Plan.BaseURLs[0]
		}
		key := ""
		if result.KeyIndex >= 0 && result.KeyIndex < len(result.Plan.Keys) {
			key = result.Plan.Keys[result.KeyIndex]
		} else if len(result.Plan.Keys) > 0 {
			key = result.Plan.Keys[0]
		}
		if baseURL == "" || key == "" {
			lastErr = fmt.Errorf("供应商 %s 缺少 BaseURL 或 Key", result.Provider.Name)
			continue
		}
		return chatproto.Endpoint{Path: path, Protocol: protocol}, baseURL, key, result.Provider, nil
	}
	if lastErr != nil {
		return chatproto.Endpoint{}, "", "", nil, lastErr
	}
	return chatproto.Endpoint{}, "", "", nil, fmt.Errorf("没有供应商支持模型 %s 的聊天端点", modelName)
}

// autoChatPaths returns the candidate endpoint paths for 自动 dispatch: the
// default chat path plus every endpoint declared by an enabled provider,
// ordered chat -> responses -> anthropic.
func autoChatPaths(db *gorm.DB, modelName string) []string {
	seen := map[string]bool{}
	paths := make([]string, 0, 4)
	add := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" || seen[path] {
			return
		}
		seen[path] = true
		paths = append(paths, path)
	}
	add("/v1/chat/completions")
	var providers []model.Provider
	if err := db.Where("status = ? AND workflow_enabled = ?", true, true).Find(&providers).Error; err == nil {
		for i := range providers {
			for _, endpoint := range chatproto.Resolve(&providers[i], modelName) {
				add(endpoint.Path)
			}
		}
	}
	rank := func(path string) int {
		protocol, ok := chatproto.Detect(path)
		if !ok {
			return 9
		}
		switch protocol {
		case chatproto.ProtocolChat:
			return 0
		case chatproto.ProtocolResponses:
			return 1
		case chatproto.ProtocolAnthropic:
			return 2
		}
		return 3
	}
	for i := 1; i < len(paths); i++ {
		for j := i; j > 0 && rank(paths[j]) < rank(paths[j-1]); j-- {
			paths[j], paths[j-1] = paths[j-1], paths[j]
		}
	}
	return paths
}

// dispatchChatRequest resolves the execution plan: an empty providerID means
// 自动 (topology + channel affinity), otherwise the provider is used directly
// and the topology is bypassed.
func dispatchChatRequest(db *gorm.DB, engine *relay.Engine, modelName, providerID string, relayReq *relay.RelayRequest, body []byte) (*relay.ExecutionPlan, *model.Provider, error) {
	if providerID == "" {
		result, err := engine.Dispatch(modelName, chatPath, &affinity.Request{
			Model:   modelName,
			Path:    chatPath,
			Headers: relayReq.Headers,
			Body:    body,
		})
		if err != nil {
			return nil, nil, err
		}
		relayReq.KeyIndex = result.KeyIndex
		relayReq.BaseURLIndex = result.BaseURLIndex
		relayReq.EntryID = result.EntryID
		relayReq.TopologyOrigin = result.Origin
		relayReq.AffinityDispatchState = result.AffinityReuse
		return result.Plan, result.Provider, nil
	}

	var provider model.Provider
	if err := db.First(&provider, "id = ?", providerID).Error; err != nil {
		return nil, nil, fmt.Errorf("找不到供应商")
	}
	if !provider.Status {
		return nil, nil, fmt.Errorf("供应商 %s 已停用", provider.Name)
	}
	plan, err := engine.PlanForProvider(providerID)
	if err != nil {
		return nil, nil, fmt.Errorf("编译供应商 %s 失败: %w", provider.Name, err)
	}
	models := plan.ModelSet
	if _, ok := models[modelName]; !ok {
		return nil, nil, fmt.Errorf("供应商 %s 没有声明模型 %s", provider.Name, modelName)
	}
	if !plan.AllowsPath(modelName, chatPath) {
		return nil, nil, fmt.Errorf("供应商 %s 的模型 %s 不支持 %s", provider.Name, modelName, chatPath)
	}
	return plan, plan.Provider, nil
}

// chatToolCall mirrors the OpenAI tool_calls entry.
type chatToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// chatResponseMessage is one upstream assistant turn: text, or tool calls.
type chatResponseMessage struct {
	Text      string
	Content   json.RawMessage
	ToolCalls []chatToolCall
}

func parseChatResponse(raw []byte) (chatResponseMessage, error) {
	var parsed struct {
		Choices []struct {
			Message struct {
				Content   json.RawMessage `json:"content"`
				ToolCalls []chatToolCall  `json:"tool_calls"`
			} `json:"message"`
			Text string `json:"text"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return chatResponseMessage{}, fmt.Errorf("解析上游响应失败: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return chatResponseMessage{}, errors.New("上游没有返回任何结果")
	}
	choice := parsed.Choices[0]
	text, _ := messageText(choice.Message.Content)
	if text == "" {
		text = choice.Text
	}
	return chatResponseMessage{Text: text, Content: choice.Message.Content, ToolCalls: choice.Message.ToolCalls}, nil
}

// messageText reads the assistant text from a content value that may be a
// plain string or an array of {type,text} parts.
func messageText(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text, nil
	}
	var parts []struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &parts); err == nil {
		var builder strings.Builder
		for _, part := range parts {
			builder.WriteString(part.Text)
		}
		return builder.String(), nil
	}
	return "", nil
}

func chatTitle(content string) string {
	runes := []rune(strings.TrimSpace(content))
	if len(runes) > chatDefaultTitleRunes {
		runes = runes[:chatDefaultTitleRunes]
	}
	return string(runes)
}

// truncateChatToolResult cuts one tool result on a rune boundary so a single
// long listing cannot push the next request past the model's context window.
func truncateChatToolResult(payload string, maxBytes int) string {
	if len(payload) <= maxBytes {
		return payload
	}
	cut := maxBytes
	for cut > 0 && !utf8.RuneStart(payload[cut]) {
		cut--
	}
	return payload[:cut] + "\n…(结果过长，已截断)"
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
