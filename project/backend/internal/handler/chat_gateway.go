package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/hapiy/hapiy/internal/chatproto"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

// The console assistant is an ordinary gateway client. Every turn is POSTed
// back to the relay over the loopback URL, so it shares token auth, dispatch,
// topology, request/response rewrites, failover, concurrency rules and the
// usage log with any external app. Nothing is special-cased inside the relay.
const (
	// chatIngressPath is the relay path the console speaks. It stays
	// /chat/completions (no /v1) because provider base URLs already end in
	// /v1, and it is the same path OpenChamber and the other agents post.
	chatIngressPath = "/chat/completions"
	// chatGatewayPath is the ingress the built-in assistant uses: the same
	// /proxy/__<source> prefix as the other agents, so 使用记录 labels the
	// traffic with the assistant source.
	chatGatewayPath  = "/proxy/" + service.LogSourceAgent + chatIngressPath
	chatTokenName    = "内置助手"
	chatMaxBodyBytes = 8 << 20
)

// chatGateway POSTs one completion to the relay and normalizes the answer.
type chatGateway struct {
	url    string
	client *http.Client
}

func newChatGateway(baseURL string) *chatGateway {
	return &chatGateway{
		url: strings.TrimRight(baseURL, "/") + chatGatewayPath,
		client: &http.Client{
			// A loopback call must never be sent through an HTTP proxy.
			Transport: &http.Transport{Proxy: nil},
		},
	}
}

// chatGatewayMu serialises first-use creation of the assistant token.
var chatGatewayMu sync.Mutex

// ensureChatToken returns the token the console presents to the gateway,
// creating it on first use. It is a normal token row: it can be disabled or
// deleted like any app token, and its usage shows up under its name.
func ensureChatToken(db *gorm.DB, user string) (*model.Token, error) {
	chatGatewayMu.Lock()
	defer chatGatewayMu.Unlock()

	var token model.Token
	err := db.Where("name = ?", chatTokenName).First(&token).Error
	if err == nil {
		return &token, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	token = model.Token{
		Name:   chatTokenName,
		Key:    generateTokenKey(),
		Status: true,
		UserID: user,
	}
	if err := db.Create(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

// chatGatewayMessage is one OpenAI chat-completions message.
type chatGatewayMessage struct {
	Role       string            `json:"role"`
	Content    string            `json:"content"`
	ToolCallID string            `json:"tool_call_id,omitempty"`
	ToolCalls  []chatGatewayTool `json:"tool_calls,omitempty"`
}

// chatGatewayTool is both a tool definition (description/parameters) and an
// assistant tool call (id/arguments); omitempty keeps each shape clean.
type chatGatewayTool struct {
	ID       string                  `json:"id,omitempty"`
	Type     string                  `json:"type"`
	Function chatGatewayToolFunction `json:"function"`
}

type chatGatewayToolFunction struct {
	Name        string          `json:"name"`
	Arguments   string          `json:"arguments,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
	Description string          `json:"description,omitempty"`
}

type chatGatewayRequest struct {
	Model           string               `json:"model"`
	Messages        []chatGatewayMessage `json:"messages"`
	Stream          bool                 `json:"stream"`
	Tools           []chatGatewayTool    `json:"tools,omitempty"`
	ReasoningEffort string               `json:"reasoning_effort,omitempty"`
}

// complete sends one step of the turn through the gateway. sessionID is the
// console thread, carried in the same X-Session-Id header external clients use
// so channel affinity keeps a conversation on one channel.
func (g *chatGateway) complete(ctx context.Context, token, sessionID, modelName string, messages []chatproto.Message, tools []chatproto.Tool, effort string) (chatproto.Result, error) {
	body := chatGatewayRequest{
		Model:           modelName,
		Messages:        make([]chatGatewayMessage, 0, len(messages)),
		Stream:          false,
		ReasoningEffort: effort,
	}
	for _, message := range messages {
		entry := chatGatewayMessage{
			Role:       message.Role,
			Content:    message.Content,
			ToolCallID: message.ToolCallID,
		}
		for _, call := range message.ToolCalls {
			entry.ToolCalls = append(entry.ToolCalls, chatGatewayTool{
				ID:   call.ID,
				Type: "function",
				Function: chatGatewayToolFunction{
					Name:      call.Name,
					Arguments: call.Arguments,
				},
			})
		}
		body.Messages = append(body.Messages, entry)
	}
	for _, tool := range tools {
		schema := tool.Schema
		if len(schema) == 0 {
			schema = json.RawMessage(`{"type":"object","properties":{}}`)
		}
		body.Tools = append(body.Tools, chatGatewayTool{
			Type: "function",
			Function: chatGatewayToolFunction{
				Name:        tool.Name,
				Description: tool.Description,
				Parameters:  schema,
			},
		})
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return chatproto.Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.url, bytes.NewReader(payload))
	if err != nil {
		return chatproto.Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if sessionID != "" {
		req.Header.Set("X-Session-Id", sessionID)
	}

	resp, err := g.client.Do(req)
	if err != nil {
		return chatproto.Result{}, fmt.Errorf("网关请求失败: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, chatMaxBodyBytes))
	if err != nil {
		return chatproto.Result{}, fmt.Errorf("读取网关响应失败: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return chatproto.Result{}, gatewayResponseError(resp.StatusCode, raw)
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content   json.RawMessage `json:"content"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Type     string `json:"type"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage *struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return chatproto.Result{}, fmt.Errorf("解析网关响应失败: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return chatproto.Result{}, errors.New("网关没有返回任何结果")
	}

	result := chatproto.Result{}
	message := parsed.Choices[0].Message
	if text, textErr := messageText(message.Content); textErr == nil {
		result.Text = text
	}
	for _, call := range message.ToolCalls {
		result.ToolCalls = append(result.ToolCalls, chatproto.ToolCall{
			ID:        call.ID,
			Name:      call.Function.Name,
			Arguments: call.Function.Arguments,
		})
	}
	if parsed.Usage != nil {
		result.PromptTokens = parsed.Usage.PromptTokens
		result.CompletionTokens = parsed.Usage.CompletionTokens
		result.TotalTokens = parsed.Usage.TotalTokens
	}
	return result, nil
}

// gatewayResponseError turns the relay's error envelope into the message the
// console shows. The relay returns {"error":{"message":...}} for dispatch and
// upstream failures, and a plain string for a few older paths.
func gatewayResponseError(status int, body []byte) error {
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(body, &envelope) == nil && len(envelope.Error) > 0 {
		var shaped struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(envelope.Error, &shaped) == nil && strings.TrimSpace(shaped.Message) != "" {
			return errors.New(shaped.Message)
		}
		var text string
		if json.Unmarshal(envelope.Error, &text) == nil && strings.TrimSpace(text) != "" {
			return errors.New(text)
		}
	}
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		trimmed = http.StatusText(status)
	}
	if len(trimmed) > 300 {
		trimmed = trimmed[:300] + "…"
	}
	return fmt.Errorf("网关返回 %d：%s", status, trimmed)
}
