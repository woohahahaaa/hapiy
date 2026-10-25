package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hapiy/hapiy/internal/relay"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
)

// ToolRunner exposes the MCP tools to in-process callers (the console chat
// agent) over the SDK's in-memory transport. It reuses the exact same tool
// registrations the /mcp endpoint serves, so a tool added there is available
// to the agent without a second definition.
type ToolRunner struct {
	server  *mcp.Server
	session *mcp.ClientSession
}

// NewToolRunner connects a client to a fresh server bound to db.
func NewToolRunner(ctx context.Context, db *gorm.DB, engine *relay.Engine, version string) (*ToolRunner, error) {
	server := NewServer(db, engine, version)
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		return nil, fmt.Errorf("connect mcp server: %w", err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "hapiy-chat", Version: version}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		return nil, fmt.Errorf("connect mcp client: %w", err)
	}
	return &ToolRunner{server: server, session: session}, nil
}

// Tools lists the tool definitions (name, description, JSON schema).
func (r *ToolRunner) Tools(ctx context.Context) ([]*mcp.Tool, error) {
	result, err := r.session.ListTools(ctx, nil)
	if err != nil {
		return nil, err
	}
	return result.Tools, nil
}

// Call executes one tool and returns its structured output. Tool failures are
// returned as errors with the tool's own message.
func (r *ToolRunner) Call(ctx context.Context, name string, arguments map[string]any) (any, error) {
	result, err := r.session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: arguments})
	if err != nil {
		return nil, err
	}
	if result.IsError {
		return nil, fmt.Errorf("%s", toolResultText(result))
	}
	if result.StructuredContent != nil {
		return result.StructuredContent, nil
	}
	return toolResultText(result), nil
}

// Close tears down the client session; the server session ends with it.
func (r *ToolRunner) Close() {
	if r.session != nil {
		_ = r.session.Close()
	}
}

func toolResultText(result *mcp.CallToolResult) string {
	var text string
	for _, content := range result.Content {
		if part, ok := content.(*mcp.TextContent); ok {
			text += part.Text
		}
	}
	return text
}

// MarshalToolResult renders a tool result for a role:"tool" message.
func MarshalToolResult(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	return string(raw)
}
