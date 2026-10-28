// Package chatproto turns the console chat's protocol-agnostic conversation
// into a concrete provider protocol and back. It uses Bifrost's provider
// adapters (chat completions, Responses API, Anthropic messages) so switching
// a thread from one model family to another does not require a new client.
package chatproto

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/providers/anthropic"
	"github.com/maximhq/bifrost/core/providers/openai"
	"github.com/maximhq/bifrost/core/schemas"
)

// Protocol is the wire shape an endpoint speaks.
type Protocol string

const (
	ProtocolChat      Protocol = "openai-chat"
	ProtocolResponses Protocol = "openai-responses"
	ProtocolAnthropic Protocol = "anthropic-messages"
)

// Endpoint is one selectable upstream path and the protocol it speaks.
type Endpoint struct {
	Path     string
	Protocol Protocol
}

// Detect maps an endpoint suffix to a protocol. It is deliberately suffix
// based: providers declare paths like /chat/completions, /v1/chat/completions,
// /responses and /messages, and the prefix is part of the base URL.
func Detect(path string) (Protocol, bool) {
	normalized := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(path), "/"))
	switch {
	case normalized == "":
		return "", false
	case strings.HasSuffix(normalized, "/chat/completions"):
		return ProtocolChat, true
	case strings.HasSuffix(normalized, "/responses"):
		return ProtocolResponses, true
	case strings.HasSuffix(normalized, "/messages"):
		return ProtocolAnthropic, true
	}
	return "", false
}

// protocolRank is the console preference when a model declares several
// endpoints: chat completions first, then Responses, then Anthropic.
func protocolRank(protocol Protocol) int {
	switch protocol {
	case ProtocolChat:
		return 0
	case ProtocolResponses:
		return 1
	case ProtocolAnthropic:
		return 2
	}
	return 3
}

// Resolve returns the endpoints a model can use, best first. When neither the
// model nor the provider declares an endpoint the OpenAI chat path is assumed,
// matching the old behaviour.
func Resolve(provider *model.Provider, modelName string) []Endpoint {
	paths := relay.PathsForModel(provider, modelName)
	if len(paths) == 0 {
		paths = []string{"/v1/chat/completions"}
	}
	out := make([]Endpoint, 0, len(paths))
	seen := map[Protocol]bool{}
	for _, path := range paths {
		protocol, ok := Detect(path)
		if !ok || seen[protocol] {
			continue
		}
		seen[protocol] = true
		out = append(out, Endpoint{Path: path, Protocol: protocol})
	}
	// Keep declaration order inside a rank; sort by rank only.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && protocolRank(out[j].Protocol) < protocolRank(out[j-1].Protocol); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	if len(out) == 0 {
		// Declared paths exist but none is a conversation API we can speak.
		return nil
	}
	return out
}

// ToolCall is a protocol-neutral tool invocation.
type ToolCall struct {
	ID        string
	Name      string
	Arguments string
}

// Message is one protocol-neutral turn.
type Message struct {
	Role       string // system | user | assistant | tool
	Content    string
	ToolCallID string
	ToolCalls  []ToolCall
}

// Tool is a function tool definition with a JSON schema.
type Tool struct {
	Name        string
	Description string
	Schema      json.RawMessage
}

// Request is one completion against a resolved endpoint.
type Request struct {
	Endpoint  Endpoint
	BaseURL   string
	Key       string
	Model     string
	Messages  []Message
	Tools     []Tool
	SessionID string
	// ReasoningEffort is the turn's thinking level ("low"/"medium"/"high");
	// empty leaves the provider default in place.
	ReasoningEffort string
}

// Result is the assistant turn after protocol translation.
type Result struct {
	Text             string
	ToolCalls        []ToolCall
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

// Complete sends the conversation through the provider adapter that matches
// the endpoint protocol and returns the assistant text or tool calls.
func Complete(ctx context.Context, req Request) (Result, error) {
	chatReq, err := buildChatRequest(req)
	if err != nil {
		return Result{}, err
	}
	config := providerConfig(req)
	bctx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	key := schemas.Key{Value: *schemas.NewSecretVar(req.Key)}

	var chatResp *schemas.BifrostChatResponse
	var bifrostErr *schemas.BifrostError

	switch req.Endpoint.Protocol {
	case ProtocolChat:
		provider := openai.NewOpenAIProvider(config, bifrost.NewNoOpLogger())
		chatResp, bifrostErr = provider.ChatCompletion(bctx, key, chatReq)
	case ProtocolResponses:
		provider := openai.NewOpenAIProvider(config, bifrost.NewNoOpLogger())
		var responsesResp *schemas.BifrostResponsesResponse
		responsesResp, bifrostErr = provider.Responses(bctx, key, chatReq.ToResponsesRequest())
		if bifrostErr == nil && responsesResp != nil {
			chatResp = responsesResp.ToBifrostChatResponse()
		}
	case ProtocolAnthropic:
		provider := anthropic.NewAnthropicProvider(config, bifrost.NewNoOpLogger())
		chatResp, bifrostErr = provider.ChatCompletion(bctx, key, chatReq)
	default:
		return Result{}, fmt.Errorf("不支持的协议: %s", req.Endpoint.Protocol)
	}
	if bifrostErr != nil {
		return Result{}, fmt.Errorf("%s", bifrostErrorText(bifrostErr))
	}
	if chatResp == nil {
		return Result{}, fmt.Errorf("上游没有返回结果")
	}
	return resultFromResponse(chatResp), nil
}

func providerConfig(req Request) *schemas.ProviderConfig {
	baseType := schemas.OpenAI
	requestType := schemas.ChatCompletionRequest
	if req.Endpoint.Protocol == ProtocolResponses {
		requestType = schemas.ResponsesRequest
	}
	if req.Endpoint.Protocol == ProtocolAnthropic {
		baseType = schemas.Anthropic
	}
	headers := map[string]string{}
	if req.SessionID != "" {
		headers["X-Session-Id"] = req.SessionID
	}
	return &schemas.ProviderConfig{
		NetworkConfig: schemas.NetworkConfig{
			BaseURL:      req.BaseURL,
			ExtraHeaders: schemas.NewSecretVarMap(headers),
		},
		CustomProviderConfig: &schemas.CustomProviderConfig{
			BaseProviderType: baseType,
			RequestPathOverrides: map[schemas.RequestType]string{
				requestType: joinURL(req.BaseURL, req.Endpoint.Path),
			},
		},
	}
}

func buildChatRequest(req Request) (*schemas.BifrostChatRequest, error) {
	input := make([]schemas.ChatMessage, 0, len(req.Messages))
	for _, message := range req.Messages {
		switch message.Role {
		case "assistant":
			built := schemas.ChatMessage{
				Role:    schemas.ChatMessageRoleAssistant,
				Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr(message.Content)},
			}
			if len(message.ToolCalls) > 0 {
				calls := make([]schemas.ChatAssistantMessageToolCall, 0, len(message.ToolCalls))
				for index, call := range message.ToolCalls {
					typeName := "function"
					id := call.ID
					name := call.Name
					calls = append(calls, schemas.ChatAssistantMessageToolCall{
						Index: uint16(index),
						Type:  &typeName,
						ID:    &id,
						Function: schemas.ChatAssistantMessageToolCallFunction{
							Name:      &name,
							Arguments: call.Arguments,
						},
					})
				}
				built.ChatAssistantMessage = &schemas.ChatAssistantMessage{ToolCalls: calls}
			}
			input = append(input, built)
		case "tool":
			id := message.ToolCallID
			input = append(input, schemas.ChatMessage{
				Role:            schemas.ChatMessageRoleTool,
				Content:         &schemas.ChatMessageContent{ContentStr: schemas.Ptr(message.Content)},
				ChatToolMessage: &schemas.ChatToolMessage{ToolCallID: &id},
			})
		case "system":
			input = append(input, schemas.ChatMessage{
				Role:    schemas.ChatMessageRoleSystem,
				Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr(message.Content)},
			})
		default:
			input = append(input, schemas.ChatMessage{
				Role:    schemas.ChatMessageRoleUser,
				Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr(message.Content)},
			})
		}
	}

	params := &schemas.ChatParameters{}
	if req.ReasoningEffort != "" {
		effort := req.ReasoningEffort
		params.Reasoning = &schemas.ChatReasoning{Effort: &effort}
	}
	if len(req.Tools) > 0 {
		tools := make([]schemas.ChatTool, 0, len(req.Tools))
		for _, tool := range req.Tools {
			var parameters schemas.ToolFunctionParameters
			if len(tool.Schema) > 0 {
				if err := json.Unmarshal(tool.Schema, &parameters); err != nil {
					return nil, fmt.Errorf("工具 %s 的 schema 解析失败: %w", tool.Name, err)
				}
			}
			if parameters.Type == "" {
				parameters.Type = "object"
			}
			tools = append(tools, schemas.ChatTool{
				Type: schemas.ChatToolTypeFunction,
				Function: &schemas.ChatToolFunction{
					Name:        tool.Name,
					Description: schemas.Ptr(tool.Description),
					Parameters:  &parameters,
				},
			})
		}
		params.Tools = tools
	}

	return &schemas.BifrostChatRequest{
		Provider: providerForProtocol(req.Endpoint.Protocol),
		Model:    req.Model,
		Input:    input,
		Params:   params,
	}, nil
}

func providerForProtocol(protocol Protocol) schemas.ModelProvider {
	if protocol == ProtocolAnthropic {
		return schemas.Anthropic
	}
	return schemas.OpenAI
}

func resultFromResponse(resp *schemas.BifrostChatResponse) Result {
	result := Result{}
	if resp.Usage != nil {
		result.PromptTokens = resp.Usage.PromptTokens
		result.CompletionTokens = resp.Usage.CompletionTokens
		result.TotalTokens = resp.Usage.TotalTokens
	}
	if len(resp.Choices) == 0 {
		return result
	}
	choice := resp.Choices[0]
	if choice.ChatNonStreamResponseChoice == nil || choice.ChatNonStreamResponseChoice.Message == nil {
		return result
	}
	message := choice.ChatNonStreamResponseChoice.Message
	result.Text = chatMessageText(message)
	if message.ChatAssistantMessage == nil {
		return result
	}
	for _, call := range message.ChatAssistantMessage.ToolCalls {
		name := ""
		if call.Function.Name != nil {
			name = *call.Function.Name
		}
		id := ""
		if call.ID != nil {
			id = *call.ID
		}
		result.ToolCalls = append(result.ToolCalls, ToolCall{
			ID:        id,
			Name:      name,
			Arguments: call.Function.Arguments,
		})
	}
	return result
}

func chatMessageText(message *schemas.ChatMessage) string {
	if message.Content == nil {
		return ""
	}
	if message.Content.ContentStr != nil {
		return *message.Content.ContentStr
	}
	var builder strings.Builder
	for _, block := range message.Content.ContentBlocks {
		if block.Text != nil {
			builder.WriteString(*block.Text)
		}
	}
	return builder.String()
}

func bifrostErrorText(err *schemas.BifrostError) string {
	if err == nil {
		return ""
	}
	if err.Error != nil && err.Error.Message != "" {
		return err.Error.Message
	}
	return fmt.Sprintf("%v", err)
}

// joinURL appends the declared endpoint path to a provider base URL, dropping
// a duplicated /v1 on either side (base ".../v1" + path "/v1/chat/completions").
// UpstreamURL is the URL Complete issues for one resolved endpoint. The chat
// handler records it in usage logs so a failed turn names the exact upstream
// address, matching what the relay path already stores.
func UpstreamURL(baseURL, path string) string {
	return joinURL(baseURL, path)
}

func joinURL(baseURL, path string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	endpoint := strings.TrimSpace(path)
	if endpoint == "" {
		return base
	}
	if !strings.HasPrefix(endpoint, "/") {
		endpoint = "/" + endpoint
	}
	if strings.HasSuffix(base, "/v1") && strings.HasPrefix(endpoint, "/v1/") {
		endpoint = strings.TrimPrefix(endpoint, "/v1")
	}
	return base + endpoint
}
