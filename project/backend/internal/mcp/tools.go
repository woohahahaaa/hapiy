package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/topology"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
)

// ── list_providers ──

type listProvidersIn struct {
	IncludeDisabled bool `json:"include_disabled,omitempty" jsonschema:"包含已停用的供应商，默认 false"`
}

type providerSummary struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Status          bool     `json:"status"`
	AutoDisabled    bool     `json:"auto_disabled"`
	WorkflowEnabled bool     `json:"workflow_enabled"`
	Endpoints       []string `json:"endpoints"`
	Models          []string `json:"models"`
	ModelCount      int      `json:"model_count"`
	BaseURLCount    int      `json:"base_url_count"`
	KeyCount        int      `json:"key_count"`
	Weight          int      `json:"weight"`
	Priority        int      `json:"priority"`
	Group           string   `json:"group"`
}

type listProvidersOut struct {
	Providers []providerSummary `json:"providers"`
	Total     int               `json:"total"`
}

func listProviders(db *gorm.DB) func(context.Context, *mcp.CallToolRequest, listProvidersIn) (*mcp.CallToolResult, listProvidersOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in listProvidersIn) (*mcp.CallToolResult, listProvidersOut, error) {
		var rows []model.Provider
		query := db.Order("name asc")
		if !in.IncludeDisabled {
			query = query.Where("status = ?", true)
		}
		if err := query.Find(&rows).Error; err != nil {
			return nil, listProvidersOut{}, err
		}
		disabled, err := autoDisabledProviderIDs(db)
		if err != nil {
			return nil, listProvidersOut{}, err
		}
		out := listProvidersOut{Providers: make([]providerSummary, 0, len(rows))}
		for _, p := range rows {
			models := providerModelNames(p.Models)
			out.Providers = append(out.Providers, providerSummary{
				ID:              p.ID,
				Name:            p.Name,
				Status:          p.Status,
				AutoDisabled:    disabled[p.ID],
				WorkflowEnabled: p.WorkflowEnabled,
				Endpoints:       parseStringArray(p.Endpoints),
				Models:          models,
				ModelCount:      len(models),
				BaseURLCount:    len(parseStringArray(p.BaseURLs)),
				KeyCount:        len(parseStringArray(p.Keys)),
				Weight:          p.Weight,
				Priority:        p.Priority,
				Group:           p.Group,
			})
		}
		out.Total = len(out.Providers)
		return nil, out, nil
	}
}

// ── get_provider ──

type getProviderIn struct {
	Name string `json:"name,omitempty" jsonschema:"供应商名称（与 id 二选一）"`
	ID   string `json:"id,omitempty" jsonschema:"供应商 id（与 name 二选一）"`
}

type providerModelDetail struct {
	Model     string   `json:"model"`
	Endpoints []string `json:"endpoints" jsonschema:"该模型允许的请求路径；空数组表示不限"`
}

type providerDetail struct {
	providerSummary
	KeyHints       []string              `json:"key_hints" jsonschema:"每个上游 Key 仅显示末尾 4 位，完整 Key 不对外暴露"`
	BaseURLs       []string              `json:"base_urls" jsonschema:"上游 Base URL 列表（非密钥）"`
	KeyNotes       map[string]string     `json:"key_notes,omitempty" jsonschema:"Key 备注，键同样只显示末尾 4 位"`
	ModelsDetailed []providerModelDetail `json:"models_detail" jsonschema:"每个模型的端点限制"`
	DedupeV1Suffix bool                  `json:"dedupe_v1_suffix"`
	AutoBan        bool                  `json:"auto_ban"`
}

// providerDetailOf renders a provider for tool output: upstream keys never
// leave this function unmasked, including the key_notes map keys.
func providerDetailOf(p model.Provider, autoDisabled bool) providerDetail {
	models := providerModelNames(p.Models)
	endpoints := perModelEndpoints(p.Models)
	detailed := make([]providerModelDetail, 0, len(models))
	for _, name := range models {
		detailed = append(detailed, providerModelDetail{Model: name, Endpoints: dedupeSorted(endpoints[name])})
	}
	notes := make(map[string]string)
	if strings.TrimSpace(p.KeyNotes) != "" {
		var raw map[string]string
		if err := json.Unmarshal([]byte(p.KeyNotes), &raw); err == nil {
			for key, note := range raw {
				if strings.TrimSpace(note) != "" {
					notes[maskKey(key)] = note
				}
			}
		}
	}
	dedupe := p.DedupeV1Suffix == nil || *p.DedupeV1Suffix
	return providerDetail{
		providerSummary: providerSummary{
			ID:              p.ID,
			Name:            p.Name,
			Status:          p.Status,
			AutoDisabled:    autoDisabled,
			WorkflowEnabled: p.WorkflowEnabled,
			Endpoints:       parseStringArray(p.Endpoints),
			Models:          models,
			ModelCount:      len(models),
			BaseURLCount:    len(parseStringArray(p.BaseURLs)),
			KeyCount:        len(parseStringArray(p.Keys)),
			Weight:          p.Weight,
			Priority:        p.Priority,
			Group:           p.Group,
		},
		KeyHints:       maskKeys(parseStringArray(p.Keys)),
		BaseURLs:       parseStringArray(p.BaseURLs),
		KeyNotes:       notes,
		ModelsDetailed: detailed,
		DedupeV1Suffix: dedupe,
		AutoBan:        p.AutoBan,
	}
}

type getProviderOut struct {
	Provider providerDetail `json:"provider"`
}

func getProvider(db *gorm.DB) func(context.Context, *mcp.CallToolRequest, getProviderIn) (*mcp.CallToolResult, getProviderOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in getProviderIn) (*mcp.CallToolResult, getProviderOut, error) {
		name := strings.TrimSpace(in.Name)
		id := strings.TrimSpace(in.ID)
		if name == "" && id == "" {
			return nil, getProviderOut{}, fmt.Errorf("name 或 id 至少给一个")
		}
		var row model.Provider
		query := db.Limit(1)
		switch {
		case id != "":
			query = query.Where("id = ?", id)
		case name != "":
			query = query.Where("name = ?", name)
		}
		if err := query.Find(&row).Error; err != nil {
			return nil, getProviderOut{}, err
		}
		if row.ID == "" {
			return nil, getProviderOut{}, fmt.Errorf("找不到供应商 %q", firstNonEmpty(id, name))
		}
		disabled, err := autoDisabledProviderIDs(db)
		if err != nil {
			return nil, getProviderOut{}, err
		}
		return nil, getProviderOut{Provider: providerDetailOf(row, disabled[row.ID])}, nil
	}
}

// ── list_models ──

type listModelsIn struct {
	IncludeDisabled bool   `json:"include_disabled,omitempty" jsonschema:"包含已停用供应商提供的模型"`
	Contains        string `json:"contains,omitempty" jsonschema:"只返回名称包含该子串的模型"`
}

type modelEntry struct {
	Model     string   `json:"model"`
	Providers []string `json:"providers"`
	Endpoints []string `json:"endpoints" jsonschema:"该模型声明可走的端点；空数组表示不限"`
}

type listModelsOut struct {
	Models []modelEntry `json:"models"`
	Total  int          `json:"total"`
}

func listModels(db *gorm.DB) func(context.Context, *mcp.CallToolRequest, listModelsIn) (*mcp.CallToolResult, listModelsOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in listModelsIn) (*mcp.CallToolResult, listModelsOut, error) {
		var rows []model.Provider
		query := db.Order("name asc")
		if !in.IncludeDisabled {
			query = query.Where("status = ?", true)
		}
		if err := query.Find(&rows).Error; err != nil {
			return nil, listModelsOut{}, err
		}
		needle := strings.ToLower(strings.TrimSpace(in.Contains))
		byModel := make(map[string]*modelEntry)
		for _, p := range rows {
			for modelName, endpoints := range perModelEndpoints(p.Models) {
				if needle != "" && !strings.Contains(strings.ToLower(modelName), needle) {
					continue
				}
				entry, ok := byModel[modelName]
				if !ok {
					entry = &modelEntry{Model: modelName, Providers: []string{}, Endpoints: []string{}}
					byModel[modelName] = entry
				}
				entry.Providers = append(entry.Providers, p.Name)
				entry.Endpoints = append(entry.Endpoints, endpoints...)
			}
		}
		out := listModelsOut{Models: make([]modelEntry, 0, len(byModel))}
		for _, entry := range byModel {
			sort.Strings(entry.Providers)
			entry.Endpoints = dedupeSorted(entry.Endpoints)
			out.Models = append(out.Models, *entry)
		}
		sort.Slice(out.Models, func(i, j int) bool { return out.Models[i].Model < out.Models[j].Model })
		out.Total = len(out.Models)
		return nil, out, nil
	}
}

// ── query_logs ──

type queryLogsIn struct {
	Model     string `json:"model,omitempty"`
	Provider  string `json:"provider,omitempty"`
	Token     string `json:"token,omitempty" jsonschema:"下游令牌名称"`
	Status    string `json:"status,omitempty" jsonschema:"success 或 failed"`
	RequestID string `json:"request_id,omitempty"`
	Source    string `json:"source,omitempty" jsonschema:"请求来源标记，如 __opencode"`
	From      string `json:"from,omitempty" jsonschema:"起始时间，RFC3339"`
	To        string `json:"to,omitempty" jsonschema:"结束时间，RFC3339"`
	Limit     int    `json:"limit,omitempty" jsonschema:"默认 50，最大 200"`
	Offset    int    `json:"offset,omitempty"`
}

type logEntry struct {
	ID               string  `json:"id"`
	RequestID        string  `json:"request_id"`
	CreatedAt        string  `json:"created_at"`
	Model            string  `json:"model"`
	Provider         string  `json:"provider"`
	Token            string  `json:"token"`
	Status           string  `json:"status"`
	Source           string  `json:"source"`
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	TotalTokens      int     `json:"total_tokens"`
	Cost             float64 `json:"cost"`
	Currency         string  `json:"currency"`
	UseTimeMs        int     `json:"use_time_ms"`
	IsStream         bool    `json:"is_stream"`
	ErrorMessage     string  `json:"error_message"`
}

type queryLogsOut struct {
	Logs   []logEntry `json:"logs"`
	Total  int64      `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
}

func queryLogs(db *gorm.DB) func(context.Context, *mcp.CallToolRequest, queryLogsIn) (*mcp.CallToolResult, queryLogsOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in queryLogsIn) (*mcp.CallToolResult, queryLogsOut, error) {
		limit := in.Limit
		if limit <= 0 {
			limit = 50
		}
		if limit > 200 {
			limit = 200
		}
		offset := in.Offset
		if offset < 0 {
			offset = 0
		}
		query := db.Model(&model.Log{})
		if v := strings.TrimSpace(in.Model); v != "" {
			query = query.Where("model_name = ?", v)
		}
		if v := strings.TrimSpace(in.Provider); v != "" {
			query = query.Where("provider_name = ?", v)
		}
		if v := strings.TrimSpace(in.Token); v != "" {
			query = query.Where("token_name = ?", v)
		}
		if v := strings.TrimSpace(in.Status); v != "" {
			query = query.Where("status = ?", v)
		}
		if v := strings.TrimSpace(in.RequestID); v != "" {
			query = query.Where("request_id = ?", v)
		}
		if v := strings.TrimSpace(in.Source); v != "" {
			query = query.Where("source = ?", v)
		}
		if v := strings.TrimSpace(in.From); v != "" {
			t, err := time.Parse(time.RFC3339, v)
			if err != nil {
				return nil, queryLogsOut{}, fmt.Errorf("from 必须是 RFC3339: %w", err)
			}
			query = query.Where("created_at >= ?", t)
		}
		if v := strings.TrimSpace(in.To); v != "" {
			t, err := time.Parse(time.RFC3339, v)
			if err != nil {
				return nil, queryLogsOut{}, fmt.Errorf("to 必须是 RFC3339: %w", err)
			}
			query = query.Where("created_at <= ?", t)
		}
		var total int64
		if err := query.Count(&total).Error; err != nil {
			return nil, queryLogsOut{}, err
		}
		var rows []model.Log
		if err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
			return nil, queryLogsOut{}, err
		}
		out := queryLogsOut{Logs: make([]logEntry, 0, len(rows)), Total: total, Limit: limit, Offset: offset}
		for _, row := range rows {
			out.Logs = append(out.Logs, logEntry{
				ID:               row.ID,
				RequestID:        row.RequestID,
				CreatedAt:        row.CreatedAt.Format(time.RFC3339),
				Model:            row.ModelName,
				Provider:         row.ProviderName,
				Token:            row.TokenName,
				Status:           row.Status,
				Source:           row.Source,
				PromptTokens:     row.PromptTokens,
				CompletionTokens: row.CompletionTokens,
				TotalTokens:      row.PromptTokens + row.CompletionTokens,
				Cost:             row.Quota,
				Currency:         row.Currency,
				UseTimeMs:        row.UseTime,
				IsStream:         row.IsStream,
				ErrorMessage:     row.ErrorMessage,
			})
		}
		return nil, out, nil
	}
}

// ── get_usage_stats ──

type usageStatsIn struct {
	From string `json:"from,omitempty" jsonschema:"起始时间，RFC3339；与 to 一起给出时按时间窗统计"`
	To   string `json:"to,omitempty" jsonschema:"结束时间，RFC3339；都不给时返回累计值"`
}

type usageStatsOut struct {
	TotalRequests   int64   `json:"total_requests"`
	SuccessCount    int64   `json:"success_count"`
	FailedCount     int64   `json:"failed_count"`
	TotalTokens     int64   `json:"total_tokens"`
	PromptTokens    int64   `json:"prompt_tokens"`
	TotalCost       float64 `json:"total_cost"`
	CacheHitTokens  int64   `json:"cache_hit_tokens"`
	CacheMissTokens int64   `json:"cache_miss_tokens"`
	AvgLatencyMs    float64 `json:"avg_latency_ms"`
	CacheHitRate    float64 `json:"cache_hit_rate"`
	Throughput      float64 `json:"throughput_tokens_per_second"`
	Windowed        bool    `json:"windowed" jsonschema:"true 表示按 from/to 聚合，false 表示累计值"`
}

func getUsageStats(db *gorm.DB) func(context.Context, *mcp.CallToolRequest, usageStatsIn) (*mcp.CallToolResult, usageStatsOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, in usageStatsIn) (*mcp.CallToolResult, usageStatsOut, error) {
		from := strings.TrimSpace(in.From)
		to := strings.TrimSpace(in.To)
		if from == "" && to == "" {
			var counter model.UsageCounter
			if err := db.First(&counter, "id = ?", 1).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, usageStatsOut{}, err
			}
			return nil, buildUsageStats(usageStatsOut{
				TotalRequests:   counter.TotalRequests,
				SuccessCount:    counter.SuccessCount,
				FailedCount:     counter.FailedCount,
				TotalTokens:     counter.TotalTokens,
				PromptTokens:    counter.PromptTokens,
				TotalCost:       counter.TotalCost,
				CacheHitTokens:  counter.CacheHitTokens,
				CacheMissTokens: counter.CacheMissTokens,
			}), nil
		}

		query := db.Model(&model.UsageStat{}).
			Select("COALESCE(SUM(total_requests), 0) AS total_requests, " +
				"COALESCE(SUM(success_count), 0) AS success_count, " +
				"COALESCE(SUM(failed_count), 0) AS failed_count, " +
				"COALESCE(SUM(total_tokens), 0) AS total_tokens, " +
				"COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, " +
				"COALESCE(SUM(total_cost), 0) AS total_cost, " +
				"COALESCE(SUM(cache_hit_tokens), 0) AS cache_hit_tokens, " +
				"COALESCE(SUM(cache_miss_tokens), 0) AS cache_miss_tokens, " +
				"COALESCE(SUM(total_use_time_ms), 0) AS total_use_time_ms")
		if from != "" {
			t, err := time.Parse(time.RFC3339, from)
			if err != nil {
				return nil, usageStatsOut{}, fmt.Errorf("from 必须是 RFC3339: %w", err)
			}
			query = query.Where("created_at >= ?", t)
		}
		if to != "" {
			t, err := time.Parse(time.RFC3339, to)
			if err != nil {
				return nil, usageStatsOut{}, fmt.Errorf("to 必须是 RFC3339: %w", err)
			}
			query = query.Where("created_at <= ?", t)
		}
		var agg struct {
			TotalRequests   int64
			SuccessCount    int64
			FailedCount     int64
			TotalTokens     int64
			PromptTokens    int64
			TotalCost       float64
			CacheHitTokens  int64
			CacheMissTokens int64
			TotalUseTimeMs  int64
		}
		if err := query.Scan(&agg).Error; err != nil {
			return nil, usageStatsOut{}, err
		}
		out := buildUsageStats(usageStatsOut{
			TotalRequests:   agg.TotalRequests,
			SuccessCount:    agg.SuccessCount,
			FailedCount:     agg.FailedCount,
			TotalTokens:     agg.TotalTokens,
			PromptTokens:    agg.PromptTokens,
			TotalCost:       agg.TotalCost,
			CacheHitTokens:  agg.CacheHitTokens,
			CacheMissTokens: agg.CacheMissTokens,
		})
		out.Windowed = true
		out.AvgLatencyMs = 0
		if agg.SuccessCount > 0 {
			out.AvgLatencyMs = float64(agg.TotalUseTimeMs) / float64(agg.SuccessCount)
		}
		if agg.TotalUseTimeMs > 0 {
			out.Throughput = float64(agg.TotalTokens) * 1000.0 / float64(agg.TotalUseTimeMs)
		}
		return nil, out, nil
	}
}

func buildUsageStats(in usageStatsOut) usageStatsOut {
	denom := in.PromptTokens
	if cacheable := in.CacheHitTokens + in.CacheMissTokens; cacheable > denom {
		denom = cacheable
	}
	if denom > 0 {
		rate := float64(in.CacheHitTokens) / float64(denom)
		if rate > 1 {
			rate = 1
		}
		in.CacheHitRate = rate
	}
	return in
}

// ── get_topology ──

type topologyNode struct {
	ID         string  `json:"id"`
	Kind       string  `json:"kind"`
	Name       string  `json:"name,omitempty"`
	ProviderID string  `json:"provider_id,omitempty"`
	SlotType   string  `json:"slot_type,omitempty"`
	Enabled    bool    `json:"enabled"`
	Weight     float64 `json:"weight,omitempty"`
	Emergency  bool    `json:"emergency,omitempty"`
	Strategy   string  `json:"strategy,omitempty"`
}

type topologyWire struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Branch string `json:"branch,omitempty"`
}

type getTopologyOut struct {
	Nodes     []topologyNode `json:"nodes"`
	Wires     []topologyWire `json:"wires"`
	Version   int            `json:"version"`
	UpdatedAt string         `json:"updated_at"`
}

func getTopology(db *gorm.DB) func(context.Context, *mcp.CallToolRequest, struct{}) (*mcp.CallToolResult, getTopologyOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, getTopologyOut, error) {
		tp, meta, err := topology.NewStore(db).LoadWithMeta()
		if err != nil {
			return nil, getTopologyOut{}, err
		}
		out := getTopologyOut{
			Nodes:   make([]topologyNode, 0, len(tp.Nodes)),
			Wires:   make([]topologyWire, 0, len(tp.Wires)),
			Version: meta.Version,
		}
		if !meta.UpdatedAt.IsZero() {
			out.UpdatedAt = meta.UpdatedAt.Format(time.RFC3339)
		}
		for _, n := range tp.Nodes {
			out.Nodes = append(out.Nodes, topologyNode{
				ID:         n.ID,
				Kind:       string(n.Kind),
				Name:       n.Name,
				ProviderID: n.ProviderID,
				SlotType:   n.SlotType,
				Enabled:    n.Enabled,
				Weight:     n.Weight,
				Emergency:  n.Emergency,
				Strategy:   n.Strategy,
			})
		}
		for _, w := range tp.Wires {
			out.Wires = append(out.Wires, topologyWire{Source: w.Source, Target: w.Target, Branch: w.Branch})
		}
		return nil, out, nil
	}
}

// ── list_disabled_channels ──

type disabledChannel struct {
	ProviderID   string `json:"provider_id"`
	ProviderName string `json:"provider_name"`
	Dimension    string `json:"dimension" jsonschema:"provider / base_url / key"`
	Value        string `json:"value" jsonschema:"按维度脱敏：key 只显示末尾 4 位"`
	Since        string `json:"since"`
}

type listDisabledOut struct {
	Items []disabledChannel `json:"items"`
	Total int               `json:"total"`
}

func listDisabledChannels(db *gorm.DB) func(context.Context, *mcp.CallToolRequest, struct{}) (*mcp.CallToolResult, listDisabledOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, listDisabledOut, error) {
		var rows []model.AutoDisableState
		if err := db.Where("disabled = ?", true).Order("updated_at desc").Find(&rows).Error; err != nil {
			return nil, listDisabledOut{}, err
		}
		names := make(map[string]string)
		ids := make([]string, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ProviderID)
		}
		if len(ids) > 0 {
			var providers []model.Provider
			if err := db.Select("id", "name").Where("id IN ?", ids).Find(&providers).Error; err != nil {
				return nil, listDisabledOut{}, err
			}
			for _, p := range providers {
				names[p.ID] = p.Name
			}
		}
		out := listDisabledOut{Items: make([]disabledChannel, 0, len(rows))}
		for _, row := range rows {
			value := row.Value
			if row.Dimension == model.FailoverDimensionKey {
				value = maskKey(value)
			}
			out.Items = append(out.Items, disabledChannel{
				ProviderID:   row.ProviderID,
				ProviderName: names[row.ProviderID],
				Dimension:    row.Dimension,
				Value:        value,
				Since:        row.UpdatedAt.Format(time.RFC3339),
			})
		}
		out.Total = len(out.Items)
		return nil, out, nil
	}
}

// ── list_agent_configs ──

type agentConfigEntry struct {
	ID         string `json:"id"`
	RecordName string `json:"record_name"`
	AgentType  string `json:"agent_type"`
	Mode       string `json:"mode" jsonschema:"local 或 ssh"`
	TargetOS   string `json:"target_os"`
	Path       string `json:"path"`
	UpdatedAt  string `json:"updated_at"`
}

type listAgentConfigsOut struct {
	Configs []agentConfigEntry `json:"configs"`
	Total   int                `json:"total"`
}

func listAgentConfigs(db *gorm.DB) func(context.Context, *mcp.CallToolRequest, struct{}) (*mcp.CallToolResult, listAgentConfigsOut, error) {
	return func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, listAgentConfigsOut, error) {
		var rows []model.AgentConfigFile
		if err := db.Order("record_name asc").Find(&rows).Error; err != nil {
			return nil, listAgentConfigsOut{}, err
		}
		out := listAgentConfigsOut{Configs: make([]agentConfigEntry, 0, len(rows))}
		for _, row := range rows {
			out.Configs = append(out.Configs, agentConfigEntry{
				ID:         row.ID,
				RecordName: row.RecordName,
				AgentType:  row.AgentType,
				Mode:       row.Mode,
				TargetOS:   row.TargetOS,
				Path:       row.Path,
				UpdatedAt:  row.UpdatedAt.Format(time.RFC3339),
			})
		}
		out.Total = len(out.Configs)
		return nil, out, nil
	}
}

// registerTools wires the read tools and the provider write tools into the server.
func registerTools(s *mcp.Server, db *gorm.DB, engine *relay.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_providers",
		Description: "列出网关里的供应商及其端点、模型、启用状态和权重。不会返回上游 Key。",
	}, listProviders(db))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_provider",
		Description: "按名称或 id 查看单个供应商的详情。上游 Key 只返回末尾 4 位。",
	}, getProvider(db))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_models",
		Description: "列出可通过网关调用的模型，以及每个模型由哪些供应商提供、可走哪些端点。",
	}, listModels(db))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "query_logs",
		Description: "按模型、供应商、令牌、状态、请求 id、时间和来源筛选请求日志，按时间倒序分页返回。",
	}, queryLogs(db))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_usage_stats",
		Description: "返回用量统计：请求数、成功率、Token 数、费用、缓存命中率、平均延迟。给 from/to 时按时间窗聚合，否则返回累计值。",
	}, getUsageStats(db))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_topology",
		Description: "返回转发拓扑的节点与连线（请求入口、供应商插槽、条件开关、日志输出等），用于判断请求实际会被路由到哪里。",
	}, getTopology(db))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_disabled_channels",
		Description: "列出当前被自动或手动禁用的渠道：供应商、BaseURL 或 Key 维度。Key 只显示末尾 4 位。",
	}, listDisabledChannels(db))

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_agent_configs",
		Description: "列出被接管的 Agent 配置文件记录（类型、路径、本地或 SSH），不返回文件内容。",
	}, listAgentConfigs(db))

	registerProviderWriteTools(s, db, engine)
}

// ── helpers ──

func parseStringArray(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	if out == nil {
		return []string{}
	}
	return out
}

// providerModelNames accepts both model array shapes the provider table uses:
// ["gpt-4o"] and [{"model":"gpt-4o","endpoints":[...]}].
func providerModelNames(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	var plain []string
	if err := json.Unmarshal([]byte(raw), &plain); err == nil {
		if plain == nil {
			return []string{}
		}
		return plain
	}
	var objs []struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal([]byte(raw), &objs); err != nil {
		return []string{}
	}
	out := make([]string, 0, len(objs))
	for _, obj := range objs {
		if name := strings.TrimSpace(obj.Model); name != "" {
			out = append(out, name)
		}
	}
	return out
}

// perModelEndpoints maps each model to its declared endpoints. Plain string
// arrays carry no per-model endpoints, so every model maps to an empty list.
func perModelEndpoints(raw string) map[string][]string {
	out := make(map[string][]string)
	if strings.TrimSpace(raw) == "" {
		return out
	}
	var plain []string
	if err := json.Unmarshal([]byte(raw), &plain); err == nil {
		for _, name := range plain {
			if name = strings.TrimSpace(name); name != "" {
				out[name] = nil
			}
		}
		return out
	}
	var objs []struct {
		Model     string   `json:"model"`
		Endpoints []string `json:"endpoints"`
	}
	if err := json.Unmarshal([]byte(raw), &objs); err != nil {
		return out
	}
	for _, obj := range objs {
		name := strings.TrimSpace(obj.Model)
		if name == "" {
			continue
		}
		out[name] = obj.Endpoints
	}
	return out
}

func autoDisabledProviderIDs(db *gorm.DB) (map[string]bool, error) {
	var rows []model.AutoDisableState
	if err := db.Select("provider_id").Where("disabled = ?", true).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(rows))
	for _, row := range rows {
		out[row.ProviderID] = true
	}
	return out, nil
}

// maskKeys keeps only the last 4 characters of each key so an operator can
// recognize a key without the tool ever returning a usable credential.
func maskKeys(keys []string) []string {
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		out = append(out, maskKey(key))
	}
	return out
}

func maskKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return "****"
	}
	return "****" + key[len(key)-4:]
}

func dedupeSorted(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
