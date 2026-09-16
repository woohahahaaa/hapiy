package handler

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestApplyRecommendationTemplate(t *testing.T) {
	db := seedManagedDB(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/agent-config-files/:id/apply-recommendation-template", ApplyRecommendationTemplate(db, nil))

	// File content: one provider missing options.timeout, plus a managed
	// block "HAPIY-C" that must be skipped.
	fileID := fileID(db)
	var f model.AgentConfigFile
	db.First(&f)
	f.Content = string(mustJSON(map[string]any{
		"provider": map[string]any{
			"openai":  map[string]any{"npm": "openai", "maxConcurrency": 5, "options": map[string]any{"baseURL": "https://old.example.com", "apiKey": "sk-old", "timeout": 123, "maxConcurrency": 5, "thinking": map[string]any{"type": "enabled"}}},
			"HAPIY-C": map[string]any{"npm": "openai", "options": map[string]any{}},
		},
	}))
	if err := writeTempFile("/tmp/hapiy-test-open.json", f.Content); err != nil {
		t.Fatal(err)
	}
	db.Save(&f)

	// Register a managed provider whose group name is "HAPIY-C".
	mp := model.ManagedAgentProvider{AgentConfigFileID: fileID, Name: "HAPIY"}
	if err := mp.SetProviderIDs(nil); err != nil {
		t.Fatal(err)
	}
	if err := mp.SetGroups([]model.ManagedAgentGroup{{Endpoint: "/v1/chat/completions", Suffix: "-C"}}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&mp).Error; err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+fileID+"/apply-recommendation-template", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("template: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Applied   int    `json:"applied"`
			Content   string `json:"content"`
			Providers []struct {
				ProviderID string         `json:"provider_id"`
				Count      int            `json:"count"`
				Models     map[string]int `json:"models"`
			} `json:"providers"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Applied == 0 {
		t.Fatalf("expected applied > 0: %s", w.Body.String())
	}
	if !strings.Contains(resp.Data.Content, `"timeout":600000`) {
		t.Fatalf("expected provider timeout applied: %s", resp.Data.Content)
	}
	// 推荐不填（baseURL/apiKey 的 recommended=null）应被执行删除。
	if strings.Contains(resp.Data.Content, `"baseURL":"https://old.example.com"`) {
		t.Fatalf("recommended-null field baseURL must be deleted: %s", resp.Data.Content)
	}
	if strings.Contains(resp.Data.Content, `"apiKey":"sk-old"`) {
		t.Fatalf("recommended-null field apiKey must be deleted: %s", resp.Data.Content)
	}
	// 推荐修改（timeout 规则推荐 600000，文件里是 123）应被改写。
	if !strings.Contains(resp.Data.Content, `"timeout":600000`) {
		t.Fatalf("expected timeout updated to 600000: %s", resp.Data.Content)
	}
	// 模板未声明的多余标量字段（maxConcurrency 顶层与 options 内）应被删除，
	// 而未声明对象结构（thinking）保留。
	if strings.Contains(resp.Data.Content, `"maxConcurrency":5`) {
		t.Fatalf("undeclared scalar maxConcurrency must be deleted: %s", resp.Data.Content)
	}
	if !strings.Contains(resp.Data.Content, `"thinking":{"type":"enabled"}`) &&
		!strings.Contains(resp.Data.Content, `"type":"enabled"`) {
		t.Fatalf("undeclared object thinking should be kept: %s", resp.Data.Content)
	}
	// Managed HAPIY-C must be skipped: no "HAPIY-C" in providers tally.
	var sawManaged bool
	var sawOpenAI bool
	for _, p := range resp.Data.Providers {
		if p.ProviderID == "HAPIY-C" {
			sawManaged = true
		}
		if p.ProviderID == "openai" {
			sawOpenAI = true
		}
	}
	if sawManaged {
		t.Fatalf("managed provider should be skipped: %s", w.Body.String())
	}
	if !sawOpenAI {
		t.Fatalf("expected openai provider in tallies")
	}
}

// TestApplyRecommendationConfigChecked covers the 勾选-scoped apply:
// only the checked providers/models get recommendations applied, others
// untouched.
func TestApplyRecommendationConfigChecked(t *testing.T) {
	db := seedManagedDB(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/agent-config-files/:id/apply-recommendation-config", ApplyRecommendationConfig(db, nil))

	fileID := fileID(db)
	var f model.AgentConfigFile
	db.First(&f)
	f.Content = string(mustJSON(map[string]any{
		"provider": map[string]any{
			"alpha": map[string]any{"npm": "openai", "options": map[string]any{"timeout": 123}},
			"beta":  map[string]any{"npm": "openai", "options": map[string]any{"timeout": 123}},
		},
	}))
	if err := writeTempFile("/tmp/hapiy-test-open.json", f.Content); err != nil {
		t.Fatal(err)
	}
	db.Save(&f)

	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+fileID+"/apply-recommendation-config",
		strings.NewReader(`{"checked":{"alpha":[]}}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("checked apply: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Applied int    `json:"applied"`
			Content string `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	// alpha 被勾选：timeout 应用为 600000（npm 因 recommended=nil 被删）。
	if !strings.Contains(resp.Data.Content, `"alpha":{"options":{"timeout":600000}}`) {
		t.Fatalf("alpha should get recommendations: %s", resp.Data.Content)
	}
	// beta 未被勾选：保持 timeout 123。
	if strings.Contains(resp.Data.Content, `"beta":{"npm":"openai","options":{"timeout":600000`) {
		t.Fatalf("beta should be untouched: %s", resp.Data.Content)
	}
	if resp.Data.Applied == 0 {
		t.Fatalf("expected applied > 0: %s", w.Body.String())
	}
}

// seedOpenclawRuleDB seeds an openclaw-shaped rule (providers object →
// per-provider `models` ARRAY of {id, ...} entries) with model-level
// recommendations marked recommended=nil plus model_info_fields pointing
// at contextWindow / maxTokens / input / reasoning.
func seedOpenclawRuleDB(t *testing.T) (*gorm.DB, string, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	rule := model.AgentTypeRule{Name: "openclaw"}
	if err := rule.SetJsonPaths(model.AgentJsonPaths{
		Provider:        "models.providers",
		Model:           "models.providers.{provider_id}.models",
		ModelsContainer: "array",
	}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetRecommendations([]model.AgentRecommendation{
		{Scope: "provider", Key: "api", Recommended: "openai-completions"},
		// 模型能力字段：模板未提供值（recommended=nil），旧逻辑会「推荐不填→删」；
		// 现在模型级 nil 一律「不干预」，用户已有的 contextWindow/maxTokens 等保留。
		{Scope: "model", Key: "name", Recommended: nil},
		{Scope: "model", Key: "contextWindow", Recommended: nil},
		{Scope: "model", Key: "maxTokens", Recommended: nil},
		{Scope: "model", Key: "input", Recommended: nil},
		{Scope: "model", Key: "reasoning", Recommended: nil},
	}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetModelInfoFields(model.AgentModelInfoFieldPaths{
		MaxContext:     model.ModelInfoPath("contextWindow"),
		MaxOutputToken: model.ModelInfoPath("maxTokens"),
		InputTypes:     model.ModelInfoPath("input"),
		ThinkingLevels: model.ModelInfoOp("reasoning", "bool"),
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "openclaw.json")
	content := `{
  "models": {
    "providers": {
      "wooh-anthrop": {
        "api": "anthropic-messages",
        "models": [
          {"id": "claude-3.5", "contextWindow": 200000, "maxTokens": 8000},
          {"id": "MiniMax-M3", "contextWindow": 300000, "maxTokens": 16000}
        ]
      }
    }
  }
}`
	if err := writeFile(path, content); err != nil {
		t.Fatal(err)
	}
	row := model.AgentConfigFile{RecordName: "openclaw", AgentType: "openclaw", Mode: "local", Path: path}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	return db, row.ID, content
}

// TestApplyRecommendationConfig_arrayModels reproduces the reported bug:
// applying on an openclaw file where `models` is an ARRAY used to fail
// with "cannot set array element for non-numeric key 'MiniMax-M3'",
// because the model id was spliced into the sjson path as a literal key.
// The model must be located by array index, the maxTokens / contextWindow
// base fields written to the right element, and — because the rule's
// model-level recommendations have no value (recommended=nil) — the
// user's existing contextWindow must be preserved rather than deleted.
func TestApplyRecommendationConfig_arrayModels(t *testing.T) {
	db, rowID, original := seedOpenclawRuleDB(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/agent-config-files/:id/apply-recommendation-config", ApplyRecommendationConfig(db, nil))

	body := bytes.NewBufferString(`{
		"checked": {"wooh-anthrop": ["MiniMax-M3"]},
		"model_fields": {
			"wooh-anthrop": {
				"MiniMax-M3": {"maxTokens": 256000}
			}
		}
	}`)
	req := httptest.NewRequest("POST", "/agent-config-files/"+rowID+"/apply-recommendation-config", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("status: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Applied int    `json:"applied"`
			Content string `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Applied == 0 {
		t.Fatalf("applied: want > 0, got 0 (%s)", w.Body.String())
	}
	// 1) 不再报错，且基础字段落在 MiniMax-M3 那个数组元素上。
	if !strings.Contains(resp.Data.Content, `"maxTokens": 256000`) {
		t.Fatalf("maxTokens not written to array element: %s", resp.Data.Content)
	}
	if strings.Contains(resp.Data.Content, `"maxTokens": 16000`) {
		t.Fatalf("updated the wrong array element: %s", resp.Data.Content)
	}
	// 2) claude-3.5（未被勾选）不能被动过，其 maxTokens 保持 8000。
	if !strings.Contains(resp.Data.Content, `"id": "claude-3.5", "contextWindow": 200000, "maxTokens": 8000`) {
		t.Fatalf("unchecked model must stay untouched: %s", resp.Data.Content)
	}
	// 3) 模型级 recommended=nil 不得删除用户已有的 contextWindow 基础字段。
	if !strings.Contains(resp.Data.Content, `"contextWindow": 300000`) {
		t.Fatalf("user contextWindow must be preserved: %s", resp.Data.Content)
	}
	// 4) 元素 id 是数组标识，绝不能因 recommended=nil 被删。
	if !strings.Contains(resp.Data.Content, `"id": "MiniMax-M3"`) {
		t.Fatalf("array element id must be preserved: %s", resp.Data.Content)
	}
	// 5) 未勾选场景下文档仍可被 parse（不是损坏 JSON）。
	if err := json.Valid([]byte(resp.Data.Content)); !err {
		t.Fatalf("result must remain valid JSON: %s", resp.Data.Content)
	}
	_ = original
}

// TestApplyRecommendationTemplate_arrayModels covers the 全量套用 path on
// the openclaw array shape: model entries get located by index, and model
// fields with recommended=nil stay untouched (no contextWindow deletion).
func TestApplyRecommendationTemplate_arrayModels(t *testing.T) {
	db, rowID, _ := seedOpenclawRuleDB(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/agent-config-files/:id/apply-recommendation-template", ApplyRecommendationTemplate(db, nil))

	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+rowID+"/apply-recommendation-template", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("template: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Applied   int    `json:"applied"`
			Content   string `json:"content"`
			Providers []struct {
				ProviderID string         `json:"provider_id"`
				Count      int            `json:"count"`
				Models     map[string]int `json:"models"`
			} `json:"providers"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Applied == 0 {
		t.Fatalf("applied: want > 0, got 0 (%s)", w.Body.String())
	}
	// 数组模型不被误删，id/contextWindow/maxTokens 都保留。
	for _, want := range []string{`"id": "MiniMax-M3"`, `"contextWindow": 300000`, `"maxTokens": 16000`} {
		if !strings.Contains(resp.Data.Content, want) {
			t.Fatalf("expected %s preserved, got: %s", want, resp.Data.Content)
		}
	}
	// provider 级推荐（api→openai-completions）仍生效。
	if !strings.Contains(resp.Data.Content, `"api": "openai-completions"`) {
		t.Fatalf("provider-level recommendation should apply: %s", resp.Data.Content)
	}
	_ = db
}

// seedOpenCodeRuleDB seeds an opencode-shaped rule: `provider` object →
// per-provider `models` OBJECT MAP keyed by model id, with model-level
// recommendations declared as recommended=nil (open 推荐不填) and
// model_info_fields pointing at limit.context / limit.output /
// modalities.input / reasoning.
func seedOpenCodeRuleDB(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	rule := model.AgentTypeRule{Name: "opencode"}
	if err := rule.SetJsonPaths(model.AgentJsonPaths{
		Provider:        "provider",
		Model:           "provider.{provider_id}.models",
		ModelsContainer: "object",
	}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetRecommendations([]model.AgentRecommendation{
		{Scope: "provider", Key: "npm", Recommended: "@ai-sdk/openai-compatible"},
		// 与官方 opencode 模板一致：模型基础字段均为 recommended=nil。
		{Scope: "model", Key: "name", Recommended: nil},
		{Scope: "model", Key: "limit.context", Recommended: nil},
		{Scope: "model", Key: "limit.output", Recommended: nil},
		{Scope: "model", Key: "reasoning", Recommended: nil},
		{Scope: "model", Key: "tool_call", Recommended: nil},
		{Scope: "model", Key: "attachment", Recommended: nil},
	}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetModelInfoFields(model.AgentModelInfoFieldPaths{
		MaxContext:     model.ModelInfoPath("limit.context"),
		MaxOutputToken: model.ModelInfoPath("limit.output"),
		InputTypes:     model.ModelInfoPath("modalities.input"),
		ThinkingLevels: model.ModelInfoOp("reasoning", "bool"),
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.json")
	content := `{
  "provider": {
    "minimax": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {"baseURL": "https://api.minimax.example.com"},
      "models": {
        "MiniMax-M3": {
          "name": "MiniMax M3",
          "limit": {"context": 300000, "output": 16000},
          "reasoning": true,
          "tool_call": true,
          "modalities": {"input": ["text"]}
        }
      }
    }
  }
}`
	if err := writeFile(path, content); err != nil {
		t.Fatal(err)
	}
	row := model.AgentConfigFile{RecordName: "opencode", AgentType: "opencode", Mode: "local", Path: path}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	return db, row.ID
}

// TestApplyRecommendationConfig_objectModelsKeepContext reproduces the
// reported deletion bug on the OPENCODE (object-map) shape: applying the
// recommendation config with model-level recommended=nil must NOT delete
// the user's existing limit.context / limit.output — the models.dev miss
// used to end up wiping them because nil was treated as "推荐不填→删除".
func TestApplyRecommendationConfig_objectModelsKeepContext(t *testing.T) {
	db, rowID := seedOpenCodeRuleDB(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/agent-config-files/:id/apply-recommendation-config", ApplyRecommendationConfig(db, nil))

	w := httptest.NewRecorder()
	// 勾选整个 provider（checked=[] → 全模型）。models.dev 里查不到
	// MiniMax-M3（model_fields 为空）——旧逻辑会把 limit.context 删掉。
	req := httptest.NewRequest("POST", "/agent-config-files/"+rowID+"/apply-recommendation-config",
		strings.NewReader(`{"checked":{"minimax":[]},"model_fields":{}}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("status: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Applied int    `json:"applied"`
			Content string `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	// models.dev 没读到 → 模板级 nil 推荐不干预 → 用户 context/output 保留。
	for _, want := range []string{`"context": 300000`, `"output": 16000`, `"reasoning": true`, `"tool_call": true`} {
		if !strings.Contains(resp.Data.Content, want) {
			t.Fatalf("user field %s must be preserved, got: %s", want, resp.Data.Content)
		}
	}
	// provider 级推荐照常应用（npm 已一致则不重复计数也行，但内容不能被删）。
	if !strings.Contains(resp.Data.Content, `"npm": "@ai-sdk/openai-compatible"`) {
		t.Fatalf("provider npm should stay: %s", resp.Data.Content)
	}
	_ = db
}
