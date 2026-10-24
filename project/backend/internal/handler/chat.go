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
	chatPath              = "/v1/chat/completions"
	chatHistoryLimit      = 40
	chatRequestTimeout    = 3 * time.Minute
	chatMaxResponseBytes  = 8 << 20
	chatMaxToolSteps      = 6
	chatDefaultTitleRunes = 40
)

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
		c.JSON(http.StatusOK, gin.H{"data": thread})
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

// chatProviderOption is one selectable provider for a model.
type chatProviderOption struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	AutoDisabled  bool   `json:"auto_disabled"`
	WorkflowOn    bool   `json:"workflow_enabled"`
	StatusEnabled bool   `json:"status"`
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
		disabled := make(map[string]bool, len(states))
		for _, state := range states {
			disabled[state.ProviderID] = true
		}
		byModel := map[string][]chatProviderOption{}
		for _, provider := range providers {
			option := chatProviderOption{
				ID:            provider.ID,
				Name:          provider.Name,
				AutoDisabled:  disabled[provider.ID],
				WorkflowOn:    provider.WorkflowEnabled,
				StatusEnabled: provider.Status,
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

// chatUIAction is one frontend action the model asked for (open a dialog,
// prefill fields). The console applies it after the reply arrives, so the
// agent never writes configuration on its own.
type chatUIAction struct {
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
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
				Content: "用户当前在控制台页面 " + page + "。需要操作界面（打开弹窗、预填参数）时使用 ui_ 开头的工具；" +
					"改配置先打开界面让用户确认，不要假设已经保存。",
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
		runner, err := hapiymcp.NewToolRunner(ctx, db, version.Version)
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
			tools = append(tools, chatproto.Tool{Name: tool.Name, Description: tool.Description, Schema: schema})
		}
		tools = append(tools, chatproto.Tool{
			Name:        "ui_open_provider_dialog",
			Description: "在控制台右侧打开供应商编辑弹窗并定位到该供应商，由用户确认后保存。用于“帮我改供应商 X”的操作。",
			Schema:      json.RawMessage(`{"type":"object","properties":{"provider_id":{"type":"string","description":"供应商 id，已知时优先传"},"provider_name":{"type":"string","description":"供应商名称，id 未知时用名称匹配"}}}`),
		})

		uiActions := make([]chatUIAction, 0)
		reply := ""
		var usage chatproto.Result
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
				c.JSON(http.StatusBadGateway, gin.H{"error": completeErr.Error()})
				return
			}
			usage = result
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
					uiActions = append(uiActions, chatUIAction{
						Type:    strings.TrimPrefix(call.Name, "ui_"),
						Payload: arguments,
					})
					payload = `{"ok":true,"note":"action queued for the console UI"}`
				} else {
					value, callErr := runner.Call(ctx, call.Name, arguments)
					if callErr != nil {
						payload = `{"error":` + strconv.Quote(callErr.Error()) + `}`
					} else {
						payload = hapiymcp.MarshalToolResult(value)
					}
				}
				messages = append(messages, chatproto.Message{
					Role:       "tool",
					ToolCallID: call.ID,
					Content:    payload,
				})
			}
		}
		if strings.TrimSpace(reply) == "" {
			c.JSON(http.StatusBadGateway, gin.H{"error": "工具调用次数过多或上游没有返回文本回复"})
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
			baseURL := ""
			if len(plan.BaseURLs) > 0 {
				baseURL = plan.BaseURLs[0]
			}
			key := ""
			if len(plan.Keys) > 0 {
				key = plan.Keys[0]
			}
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

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
