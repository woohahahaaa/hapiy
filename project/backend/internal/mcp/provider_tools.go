package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
	providerops "github.com/hapiy/hapiy/internal/provider"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
)

// registerProviderWriteTools wires the provider mutations. Every handler calls
// internal/provider so an agent-issued change goes through the same checks and
// engine refresh as the dashboard.
func registerProviderWriteTools(s *mcp.Server, db *gorm.DB, engine *relay.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name: "create_provider",
		Description: "新建供应商（默认启用）。只填给出的字段：base_urls/keys/models/endpoints 省略即留空。名称必须唯一。" +
			"全空的供应商无法转发请求，只能用来验证创建流程。",
	}, createProvider(db, engine))

	mcp.AddTool(s, &mcp.Tool{
		Name: "update_provider",
		Description: "修改供应商，只改传入的字段（patch），未传的字段保持不变。数组字段一旦传入就是整表替换。" +
			"Key 会被脱敏返回，修改 keys 时整组替换。",
	}, updateProvider(db, engine))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "delete_provider",
		Description: "删除供应商，不可恢复。会同时移除它的路由计划，正在使用它的请求会失败。",
	}, deleteProvider(db, engine))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "set_provider_status",
		Description: "启用或停用供应商（渠道级开关），幂等。停用后它不再接收新请求。",
	}, setProviderStatus(db, engine))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "set_provider_workflow",
		Description: "启用或停用供应商的工作流开关（拓扑节点上的开关），与渠道级状态独立。同名供应商同时只能有一个工作流启用。",
	}, setProviderWorkflow(db, engine))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "set_provider_dedupe_v1",
		Description: "设置“从上游拉取模型列表”时是否去掉重复的 /v1 后缀，幂等。",
	}, setProviderDedupeV1(db, engine))

	mcp.AddTool(s, &mcp.Tool{
		Name: "reset_provider_disable",
		Description: "恢复被自动禁用的渠道：dimension=provider 恢复整行；base_url/key 传 value 恢复单条，不传则恢复该维度的全部条目。" +
			"同时清掉对应的待恢复记录。",
	}, resetProviderDisable(db, engine))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "reset_all_provider_disable",
		Description: "按维度恢复全部供应商的自动禁用状态（等价于控制台的“恢复全部 BaseURL / 全部 Key / provider 行”）。",
	}, resetAllProviderDisable(db, engine))
}

// ── shared input / output ──

type providerMutationOut struct {
	OK       bool           `json:"ok"`
	Provider providerDetail `json:"provider"`
}

type deleteProviderOut struct {
	OK   bool   `json:"ok"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

type resetProviderDisableOut struct {
	OK        bool   `json:"ok"`
	Provider  string `json:"provider"`
	Dimension string `json:"dimension"`
	Value     string `json:"value,omitempty"`
}

type resetAllProviderDisableOut struct {
	OK        bool   `json:"ok"`
	Dimension string `json:"dimension"`
}

func resolveProvider(db *gorm.DB, ref string) (*model.Provider, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, fmt.Errorf("provider 必填：供应商 id 或名称")
	}
	var p model.Provider
	if err := db.First(&p, "id = ?", ref).Error; err == nil {
		return &p, nil
	}
	if err := db.First(&p, "name = ?", ref).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("找不到供应商 %q", ref)
		}
		return nil, err
	}
	return &p, nil
}

func mutationOut(db *gorm.DB, p *model.Provider) providerMutationOut {
	disabled := false
	if rows, err := autoDisabledProviderIDs(db); err == nil {
		disabled = rows[p.ID]
	}
	return providerMutationOut{OK: true, Provider: providerDetailOf(*p, disabled)}
}

func jsonArray(values []string) string {
	if values == nil {
		values = []string{}
	}
	raw, err := json.Marshal(values)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

// ── create_provider ──

type createProviderIn struct {
	Name           string   `json:"name" jsonschema:"供应商名称，必填且唯一"`
	BaseURLs       []string `json:"base_urls,omitempty" jsonschema:"上游 Base URL 列表，可留空"`
	Keys           []string `json:"keys,omitempty" jsonschema:"上游 Key 列表，可留空"`
	Models         []string `json:"models,omitempty" jsonschema:"模型名列表，可留空"`
	Endpoints      []string `json:"endpoints,omitempty" jsonschema:"供应商级请求路径，如 /v1/chat/completions"`
	Weight         int      `json:"weight,omitempty" jsonschema:"权重，默认 1"`
	Priority       int      `json:"priority,omitempty" jsonschema:"优先级，默认 0"`
	Group          string   `json:"group,omitempty" jsonschema:"分组名，可留空"`
	DedupeV1Suffix *bool    `json:"dedupe_v1_suffix,omitempty" jsonschema:"拉取模型列表时去掉重复 /v1，默认 true"`
}

func createProvider(db *gorm.DB, engine *relay.Engine) func(context.Context, *mcp.CallToolRequest, createProviderIn) (*mcp.CallToolResult, providerMutationOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in createProviderIn) (*mcp.CallToolResult, providerMutationOut, error) {
		name := strings.TrimSpace(in.Name)
		if name == "" {
			return nil, providerMutationOut{}, fmt.Errorf("name 必填")
		}
		p := &model.Provider{
			Name:      name,
			BaseURLs:  jsonArray(in.BaseURLs),
			Keys:      jsonArray(in.Keys),
			Models:    jsonArray(in.Models),
			Endpoints: jsonArray(in.Endpoints),
			Weight:    in.Weight,
			Priority:  in.Priority,
			Group:     strings.TrimSpace(in.Group),
			KeyNotes:  "{}",
		}
		if in.DedupeV1Suffix != nil {
			p.DedupeV1Suffix = in.DedupeV1Suffix
		}
		if err := providerops.Create(db, engine, p); err != nil {
			return nil, providerMutationOut{}, err
		}
		out := mutationOut(db, p)
		return nil, out, nil
	}
}

// ── update_provider ──

type updateProviderIn struct {
	Provider        string    `json:"provider" jsonschema:"供应商 id 或名称，必填"`
	Name            *string   `json:"name,omitempty" jsonschema:"新名称（唯一）"`
	BaseURLs        *[]string `json:"base_urls,omitempty" jsonschema:"整组替换 Base URL"`
	Keys            *[]string `json:"keys,omitempty" jsonschema:"整组替换上游 Key"`
	Models          *[]string `json:"models,omitempty" jsonschema:"整组替换模型名列表"`
	Endpoints       *[]string `json:"endpoints,omitempty" jsonschema:"整组替换供应商级路径"`
	Status          *bool     `json:"status,omitempty" jsonschema:"渠道级启用状态"`
	WorkflowEnabled *bool     `json:"workflow_enabled,omitempty" jsonschema:"工作流开关"`
	DedupeV1Suffix  *bool     `json:"dedupe_v1_suffix,omitempty"`
	Weight          *int      `json:"weight,omitempty"`
	Priority        *int      `json:"priority,omitempty"`
	Group           *string   `json:"group,omitempty"`
}

func updateProvider(db *gorm.DB, engine *relay.Engine) func(context.Context, *mcp.CallToolRequest, updateProviderIn) (*mcp.CallToolResult, providerMutationOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in updateProviderIn) (*mcp.CallToolResult, providerMutationOut, error) {
		p, err := resolveProvider(db, in.Provider)
		if err != nil {
			return nil, providerMutationOut{}, err
		}
		if in.Name != nil {
			name := strings.TrimSpace(*in.Name)
			if name == "" {
				return nil, providerMutationOut{}, fmt.Errorf("name 不能为空")
			}
			p.Name = name
		}
		if in.BaseURLs != nil {
			p.BaseURLs = jsonArray(*in.BaseURLs)
		}
		if in.Keys != nil {
			p.Keys = jsonArray(*in.Keys)
			p.KeyNotes = pruneKeyNotes(p.KeyNotes, *in.Keys)
		}
		if in.Models != nil {
			p.Models = jsonArray(*in.Models)
		}
		if in.Endpoints != nil {
			p.Endpoints = jsonArray(*in.Endpoints)
		}
		if in.Status != nil {
			p.Status = *in.Status
		}
		if in.WorkflowEnabled != nil {
			p.WorkflowEnabled = *in.WorkflowEnabled
		}
		if in.DedupeV1Suffix != nil {
			p.DedupeV1Suffix = in.DedupeV1Suffix
		}
		if in.Weight != nil {
			p.Weight = *in.Weight
		}
		if in.Priority != nil {
			p.Priority = *in.Priority
		}
		if in.Group != nil {
			p.Group = strings.TrimSpace(*in.Group)
		}
		if err := providerops.Update(db, engine, p); err != nil {
			return nil, providerMutationOut{}, err
		}
		out := mutationOut(db, p)
		return nil, out, nil
	}
}

// pruneKeyNotes drops remarks for keys that no longer exist, so a key swap
// cannot leave a stale note attached to a future key with the same tail.
func pruneKeyNotes(raw string, keys []string) string {
	if strings.TrimSpace(raw) == "" {
		return "{}"
	}
	var notes map[string]string
	if err := json.Unmarshal([]byte(raw), &notes); err != nil || len(notes) == 0 {
		return "{}"
	}
	keep := make(map[string]bool, len(keys))
	for _, key := range keys {
		keep[key] = true
	}
	for key := range notes {
		if !keep[key] {
			delete(notes, key)
		}
	}
	encoded, err := json.Marshal(notes)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// ── delete_provider ──

type deleteProviderIn struct {
	Provider string `json:"provider" jsonschema:"供应商 id 或名称，必填"`
}

func deleteProvider(db *gorm.DB, engine *relay.Engine) func(context.Context, *mcp.CallToolRequest, deleteProviderIn) (*mcp.CallToolResult, deleteProviderOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in deleteProviderIn) (*mcp.CallToolResult, deleteProviderOut, error) {
		p, err := resolveProvider(db, in.Provider)
		if err != nil {
			return nil, deleteProviderOut{}, err
		}
		if err := providerops.Delete(db, engine, p.ID); err != nil {
			return nil, deleteProviderOut{}, err
		}
		return nil, deleteProviderOut{OK: true, ID: p.ID, Name: p.Name}, nil
	}
}

// ── switches ──

type setProviderStatusIn struct {
	Provider string `json:"provider" jsonschema:"供应商 id 或名称，必填"`
	Enabled  bool   `json:"enabled"`
}

func setProviderStatus(db *gorm.DB, engine *relay.Engine) func(context.Context, *mcp.CallToolRequest, setProviderStatusIn) (*mcp.CallToolResult, providerMutationOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in setProviderStatusIn) (*mcp.CallToolResult, providerMutationOut, error) {
		p, err := resolveProvider(db, in.Provider)
		if err != nil {
			return nil, providerMutationOut{}, err
		}
		updated, err := providerops.SetStatus(db, engine, p.ID, in.Enabled)
		if err != nil {
			return nil, providerMutationOut{}, err
		}
		out := mutationOut(db, updated)
		return nil, out, nil
	}
}

type setProviderWorkflowIn struct {
	Provider string `json:"provider" jsonschema:"供应商 id 或名称，必填"`
	Enabled  bool   `json:"enabled"`
}

func setProviderWorkflow(db *gorm.DB, engine *relay.Engine) func(context.Context, *mcp.CallToolRequest, setProviderWorkflowIn) (*mcp.CallToolResult, providerMutationOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in setProviderWorkflowIn) (*mcp.CallToolResult, providerMutationOut, error) {
		p, err := resolveProvider(db, in.Provider)
		if err != nil {
			return nil, providerMutationOut{}, err
		}
		updated, err := providerops.SetWorkflow(db, engine, p.ID, in.Enabled)
		if err != nil {
			return nil, providerMutationOut{}, err
		}
		out := mutationOut(db, updated)
		return nil, out, nil
	}
}

type setProviderDedupeIn struct {
	Provider string `json:"provider" jsonschema:"供应商 id 或名称，必填"`
	Enabled  bool   `json:"enabled"`
}

func setProviderDedupeV1(db *gorm.DB, engine *relay.Engine) func(context.Context, *mcp.CallToolRequest, setProviderDedupeIn) (*mcp.CallToolResult, providerMutationOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in setProviderDedupeIn) (*mcp.CallToolResult, providerMutationOut, error) {
		p, err := resolveProvider(db, in.Provider)
		if err != nil {
			return nil, providerMutationOut{}, err
		}
		if err := providerops.SetDedupeV1(db, p.ID, in.Enabled); err != nil {
			return nil, providerMutationOut{}, err
		}
		reloaded, err := resolveProvider(db, p.ID)
		if err != nil {
			return nil, providerMutationOut{}, err
		}
		out := mutationOut(db, reloaded)
		return nil, out, nil
	}
}

// ── disable resets ──

type resetProviderDisableIn struct {
	Provider  string `json:"provider" jsonschema:"供应商 id 或名称，必填"`
	Dimension string `json:"dimension" jsonschema:"provider / base_url / key"`
	Value     string `json:"value,omitempty" jsonschema:"base_url 或 key 维度恢复单条时给出；留空表示该维度全部"`
}

func resetProviderDisable(db *gorm.DB, engine *relay.Engine) func(context.Context, *mcp.CallToolRequest, resetProviderDisableIn) (*mcp.CallToolResult, resetProviderDisableOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in resetProviderDisableIn) (*mcp.CallToolResult, resetProviderDisableOut, error) {
		p, err := resolveProvider(db, in.Provider)
		if err != nil {
			return nil, resetProviderDisableOut{}, err
		}
		dimension := strings.TrimSpace(in.Dimension)
		value := strings.TrimSpace(in.Value)
		var resetErr error
		if dimension == model.FailoverDimensionProvider || value != "" {
			resetErr = providerops.ResetDisableValue(db, engine, p.ID, dimension, value)
		} else {
			resetErr = providerops.ResetDisableDimension(db, engine, p.ID, dimension)
		}
		if resetErr != nil {
			return nil, resetProviderDisableOut{}, resetErr
		}
		if dimension == model.FailoverDimensionProvider {
			value = p.ID
		}
		return nil, resetProviderDisableOut{OK: true, Provider: p.ID, Dimension: dimension, Value: value}, nil
	}
}

type resetAllProviderDisableIn struct {
	Dimension string `json:"dimension" jsonschema:"provider / base_url / key"`
}

func resetAllProviderDisable(db *gorm.DB, engine *relay.Engine) func(context.Context, *mcp.CallToolRequest, resetAllProviderDisableIn) (*mcp.CallToolResult, resetAllProviderDisableOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in resetAllProviderDisableIn) (*mcp.CallToolResult, resetAllProviderDisableOut, error) {
		dimension := strings.TrimSpace(in.Dimension)
		if err := providerops.ResetAllDisable(db, engine, dimension); err != nil {
			return nil, resetAllProviderDisableOut{}, err
		}
		return nil, resetAllProviderDisableOut{OK: true, Dimension: dimension}, nil
	}
}
