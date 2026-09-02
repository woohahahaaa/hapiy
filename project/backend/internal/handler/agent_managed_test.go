package handler

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// seedManagedDB builds an in-memory DB with one agent rule (opencode),
// one config file, and a couple of system providers with endpoints.
func seedManagedDB(t *testing.T) *gorm.DB {
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
		Provider: "provider",
		Model:    "provider.{provider_id}.models",
	}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetRecommendations([]model.AgentRecommendation{
		{Scope: "provider", Key: "npm", Type: "string", Required: true},
		{Scope: "provider", Key: "options.timeout", Type: "number", Recommended: 600000},
		{Scope: "provider", Key: "options.baseURL", Type: "string", Required: true},
		{Scope: "provider", Key: "options.apiKey", Type: "string", Required: true},
		{Scope: "model", Key: "name", Type: "string", Description: "模型显示名"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetProtocols([]model.AgentProtocol{
		{
			Name: "OpenAI 兼容",
			Conditions: []model.AgentProtocolCondition{
				{Field: "options.baseURL", Op: "contains", Value: "/v1"},
			},
			EndpointTags: []string{"/v1/chat/completions"},
			Recommendations: []model.AgentRecommendation{
				{Scope: "provider", Key: "options.extraBody", Type: "object", Recommended: map[string]any{"foo": "bar"}},
			},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetModelInfoFields(model.AgentModelInfoFieldPaths{
		MaxContext: model.ModelInfoPath("limit.context"), MaxOutputToken: model.ModelInfoPath("limit.output"),
		InputTypes: model.ModelInfoPath("modalities.input"), ThinkingLevels: model.ModelInfoOp("reasoning", "bool"),
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatal(err)
	}

	file := model.AgentConfigFile{
		RecordName: "test-open", AgentType: "opencode",
		Mode: "local", TargetOS: "mac", Path: "/tmp/hapiy-test-open.json",
		Content: string(mustJSON(map[string]any{
			"provider": map[string]any{},
		})),
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := writeTempFile("/tmp/hapiy-test-open.json", file.Content); err != nil {
		t.Fatal(err)
	}

	p1 := model.Provider{Name: "HAPIY-A", Endpoints: `[{"pathSuffix":"/v1/chat/completions"}]`, Models: `[{"model":"gpt-x"}]`, Keys: `["sk-a"]`}
	p2 := model.Provider{Name: "HAPIY-B", Endpoints: `[{"pathSuffix":"/v1/chat/completions"}]`, Models: `[{"model":"gpt-y"}]`, Keys: `["sk-b"]`}
	p3 := model.Provider{Name: "HAPIY-C", Endpoints: `[{"pathSuffix":"/anthropic"}]`, Models: `[{"model":"claude-z"}]`, Keys: `["sk-c"]`}
	for _, p := range []model.Provider{p1, p2, p3} {
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}

	// Seed the models.dev capability snapshot so the reference-supplier
	// model-config lookup (group.ModelSources → supplier name) resolves
	// without a real network call.
	modelsDev.mu.Lock()
	modelsDev.cached = &modelsDevSnapshot{
		models: []modelsDevModel{
			{ID: "gpt-x", Name: "gpt-x", ProviderName: "OpenRouter", ContextLength: 131072, MaxOutput: 16384, InputTypes: []string{"text"}},
			{ID: "gpt-x", Name: "gpt-x", ProviderName: "Together", ContextLength: 100000, MaxOutput: 8192, InputTypes: []string{"text"}},
		},
		fetchedAt: time.Now(),
	}
	modelsDev.mu.Unlock()
	return db
}

func newRouterForManaged(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// No auth middleware needed for these direct handler tests.
	r.POST("/agent-config-files/:id/managed-providers", CreateManagedProvider(db, nil))
	r.GET("/agent-config-files/:id/managed-providers", ListManagedProviders(db, nil))
	r.POST("/agent-config-files/:id/managed-providers/:mid/sync", SyncManagedProvider(db, nil))
	r.DELETE("/agent-config-files/:id/managed-providers/:mid", DeleteManagedProvider(db))
	r.GET("/agent-config-files/managed-options", ManagedProviderOptions(db))
	return r
}

func TestManagedProviderRoundTrip(t *testing.T) {
	db := seedManagedDB(t)
	r := newRouterForManaged(db)

	// options
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/agent-config-files/managed-options", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("options: %d %s", w.Code, w.Body.String())
	}
	defer func() { _ = db }()
	var opts []struct {
		ID            string `json:"id"`
		EndpointCount int    `json:"endpoint_count"`
		ModelCount    int    `json:"model_count"`
	}
	_ = opts
	out := w.Body.String()
	if !strings.Contains(out, `"endpoint_count":1`) || !strings.Contains(out, `"model_count":1`) {
		t.Fatalf("options mismatch: %s", out)
	}

	// providers ids
	var providers []model.Provider
	db.Find(&providers)
	var ids []string
	for _, p := range providers {
		ids = append(ids, p.ID)
	}

	createBody := `{"name":"HAPIY","provider_ids":` + idsJSON(ids) + `,"api_key":"sk-token-1","source_name":"SRC","groups":[{"endpoint":"/v1/chat/completions","suffix":"-C","model_sources":{"gpt-x":"OpenRouter","gpt-y":""}},{"endpoint":"/anthropic","suffix":"-A","model_sources":{}}]}`
	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/agent-config-files/"+fileID(db)+"/managed-providers", strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	mid := created.Data.ID

	// list
	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/agent-config-files/"+fileID(db)+"/managed-providers", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}
	listOut := w.Body.String()
	if !strings.Contains(listOut, `"pending_sync":true`) {
		t.Fatalf("expected pending_sync true (file has no providers yet): %s", listOut)
	}
	if !strings.Contains(listOut, `"generated"`) {
		t.Fatalf("expected generated blocks: %s", listOut)
	}

	// sync
	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/agent-config-files/"+fileID(db)+"/managed-providers/"+mid+"/sync", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("sync: %d %s", w.Code, w.Body.String())
	}
	syncOut := w.Body.String()
	if !strings.Contains(syncOut, `extraBody`) {
		t.Fatalf("sync should include protocol-matched recs: %s", syncOut)
	}
	if !strings.Contains(syncOut, `131072`) {
		t.Fatalf("sync should include model info fields (context length): %s", syncOut)
	}
	if !strings.Contains(syncOut, `16384`) {
		t.Fatalf("sync should include model info fields (output token): %s", syncOut)
	}
	if !strings.Contains(syncOut, `/v1/chat/completions`) {
		t.Fatalf("sync should include the endpoint in baseURL: %s", syncOut)
	}
	// baseURL = 系统 BaseURL（请求 Host + proxy 后缀）+ /__SRC 来源段 + endpoint
	if !strings.Contains(syncOut, `http://example.com/proxy/__SRC/v1/chat/completions`) {
		t.Fatalf("sync should build the full baseURL with source mark: %s", syncOut)
	}
	// 令牌 Key 优先于上游供应商的 key
	if !strings.Contains(syncOut, `sk-token-1`) {
		t.Fatalf("sync should write the chosen token key: %s", syncOut)
	}
	if strings.Contains(syncOut, `sk-a`) {
		t.Fatalf("upstream provider key must not win over the token key: %s", syncOut)
	}

	// list again → pending_sync should be false now (and content written)
	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/agent-config-files/"+fileID(db)+"/managed-providers", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("list2: %d %s", w.Code, w.Body.String())
	}
	list2 := w.Body.String()
	if strings.Contains(list2, `"pending_sync":true`) {
		t.Fatalf("expected pending_sync false after sync: %s", list2)
	}

	// delete managed
	w = httptest.NewRecorder()
	req = httptest.NewRequest("DELETE", "/agent-config-files/"+fileID(db)+"/managed-providers/"+mid, nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}
}

func idsJSON(ids []string) string {
	b, _ := json.Marshal(ids)
	return string(b)
}

func writeTempFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

func fileID(db *gorm.DB) string {
	var f model.AgentConfigFile
	db.First(&f)
	return f.ID
}

// TestManagedProviderSyncConverges 复现「同步后仍显示待同步」：文件里的
// 托管块一旦混入同步覆盖不到的内容（用户手改的字段、快照变化留下的旧
// 模型条目），旧的增量式同步永远清不掉它们，而 pending 比较是全等。
func TestManagedProviderSyncConverges(t *testing.T) {
	db := seedManagedDB(t)
	r := newRouterForManaged(db)

	var providers []model.Provider
	db.Find(&providers)
	var ids []string
	for _, p := range providers {
		ids = append(ids, p.ID)
	}
	body := `{"name":"HAPIY","provider_ids":` + idsJSON(ids) + `,"api_key":"sk-token-1","groups":[{"endpoint":"/v1/chat/completions","suffix":"-C","model_sources":{"gpt-x":"OpenRouter","gpt-y":""}}]}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+fileID(db)+"/managed-providers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	mid := managedProviderID(db)

	// 第一轮：文件干净，同步后应收敛。
	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/agent-config-files/"+fileID(db)+"/managed-providers/"+mid+"/sync", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("sync1: %d %s", w.Code, w.Body.String())
	}

	// 模拟用户在管理模型里编辑过该块：多了一个 provider 字段和一个
	// 旧模型条目（快照/来源变化后遗留）。
	var f model.AgentConfigFile
	db.First(&f)
	var doc map[string]any
	if err := json.Unmarshal([]byte(f.Content), &doc); err != nil {
		t.Fatal(err)
	}
	block := doc["provider"].(map[string]any)["HAPIY-C"].(map[string]any)
	block["userField"] = "keep-me?"
	block["models"].(map[string]any)["ghost-model"] = map[string]any{"name": "幽灵模型"}
	f.Content = string(mustJSON(doc))
	db.Save(&f)
	if err := writeTempFile("/tmp/hapiy-test-open.json", f.Content); err != nil {
		t.Fatal(err)
	}

	// 再同步一次，希望把多余内容清掉、回到与生成块一致。
	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/agent-config-files/"+fileID(db)+"/managed-providers/"+mid+"/sync", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("sync2: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/agent-config-files/"+fileID(db)+"/managed-providers", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), `"pending_sync":true`) {
		t.Fatalf("expected pending_sync false after re-sync, block did not converge: %s", w.Body.String())
	}
}

// TestManagedSyncDottedModelNames 复现线上「同步后永远待同步」：模型名
// 带点（gpt-5.6-sol）时，逐字段拼 gjson 路径写入会把名字拆成嵌套对象
// （gpt-5→6-sol），而 pending 按平铺键名比较，永远不相等。
func TestManagedSyncDottedModelNames(t *testing.T) {
	db := seedManagedDB(t)
	r := newRouterForManaged(db)

	var providers []model.Provider
	db.Find(&providers)
	var ids []string
	for _, p := range providers {
		ids = append(ids, p.ID)
	}
	// 关键：模型名里带点。
	db.Model(&model.Provider{}).Where("name = ?", "HAPIY-A").
		Update("models", `[{"model":"gpt-5.6-sol"},{"model":"gpt-5.6-luna"}]`)
	db.Model(&model.Provider{}).Where("name = ?", "HAPIY-B").
		Update("models", `[{"model":"glm-5.3-flash"}]`)
	modelsDev.mu.Lock()
	modelsDev.cached = &modelsDevSnapshot{
		models: []modelsDevModel{
			{ID: "gpt-5.6-sol", Name: "gpt-5.6-sol", ProviderName: "OpenRouter", ContextLength: 1050000, MaxOutput: 128000, InputTypes: []string{"text"}},
			{ID: "gpt-5.6-luna", Name: "gpt-5.6-luna", ProviderName: "OpenRouter", ContextLength: 1000000, MaxOutput: 128000, InputTypes: []string{"text"}, Reasoning: true},
			{ID: "glm-5.3-flash", Name: "glm-5.3-flash", ProviderName: "Abacus", ContextLength: 1000000, MaxOutput: 128000, InputTypes: []string{"text"}},
		},
		fetchedAt: time.Now(),
	}
	modelsDev.mu.Unlock()

	body := `{"name":"HAPIY","provider_ids":` + idsJSON(ids) + `,"api_key":"sk-token-1","groups":[{"endpoint":"/v1/chat/completions","suffix":"-C","model_sources":{"gpt-5.6-sol":"OpenRouter","gpt-5.6-luna":"OpenRouter","glm-5.3-flash":"Abacus"}}]}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+fileID(db)+"/managed-providers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	mid := managedProviderID(db)

	for round := 1; round <= 2; round++ {
		w = httptest.NewRecorder()
		req = httptest.NewRequest("POST", "/agent-config-files/"+fileID(db)+"/managed-providers/"+mid+"/sync", nil)
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("sync round %d: %d %s", round, w.Code, w.Body.String())
		}
		// 同步结果里模型名必须按字面量落盘，不能被拆成嵌套对象。
		var f model.AgentConfigFile
		db.First(&f)
		if !strings.Contains(f.Content, `"gpt-5.6-sol"`) {
			t.Fatalf("round %d: model name with dots was split by the gjson path, file content: %s", round, f.Content)
		}
		w = httptest.NewRecorder()
		req = httptest.NewRequest("GET", "/agent-config-files/"+fileID(db)+"/managed-providers", nil)
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("list round %d: %d %s", round, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), `"pending_sync":true`) {
			t.Fatalf("round %d: expected pending_sync false right after sync (dotted model names), got: %s", round, w.Body.String())
		}
	}
}

// TestManagedRealRuleConverges 用真实内置 opencode 规则（含 bool 形状的
// reasoning、真实 rec 集合）验证「同步后待同步必须消失」，不掺任何手工
// 编辑——对应「刚点了全部同步还是显示待同步」的线上现象。
func TestManagedRealRuleConverges(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	if err := model.EnsureDefaultAgentTypes(db); err != nil {
		t.Fatal(err)
	}
	var rule model.AgentTypeRule
	if err := db.Where("name = ?", "opencode").First(&rule).Error; err != nil {
		t.Fatal(err)
	}

	file := model.AgentConfigFile{
		RecordName: "real-open", AgentType: "opencode",
		Mode: "local", TargetOS: "mac", Path: "/tmp/hapiy-real-open.json",
		Content: `{"$schema":"https://opencode.ai/config.json","theme":"opencode"}`,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := writeTempFile("/tmp/hapiy-real-open.json", file.Content); err != nil {
		t.Fatal(err)
	}

	p1 := model.Provider{Name: "HAPIY-A", Endpoints: `[{"pathSuffix":"/v1/chat/completions"}]`, Models: `[{"model":"gpt-x"}]`, Keys: `["sk-a"]`}
	p2 := model.Provider{Name: "HAPIY-B", Endpoints: `[{"pathSuffix":"/v1/chat/completions"}]`, Models: `[{"model":"gpt-y"}]`, Keys: `["sk-b"]`}
	for _, p := range []model.Provider{p1, p2} {
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	modelsDev.mu.Lock()
	modelsDev.cached = &modelsDevSnapshot{
		models: []modelsDevModel{
			{ID: "gpt-x", Name: "gpt-x", ProviderName: "OpenRouter", ContextLength: 131072, MaxOutput: 16384, InputTypes: []string{"text", "images"}, Reasoning: true},
			{ID: "gpt-y", Name: "gpt-y", ProviderName: "OpenRouter", ContextLength: 262144, MaxOutput: 32768, InputTypes: []string{"text"}},
		},
		fetchedAt: time.Now(),
	}
	modelsDev.mu.Unlock()

	var providers []model.Provider
	db.Find(&providers)
	var ids []string
	for _, p := range providers {
		ids = append(ids, p.ID)
	}
	body := `{"name":"HAPIY","provider_ids":` + idsJSON(ids) + `,"api_key":"sk-token-1","source_name":"SRC","groups":[{"endpoint":"/v1/chat/completions","suffix":"","model_sources":{"gpt-x":"OpenRouter","gpt-y":"OpenRouter"}}]}`
	r := newRouterForManaged(db)
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	// 连续两轮「同步 → 列表」，模拟用户点「同步所有」后看徽标。
	for round := 1; round <= 2; round++ {
		w = httptest.NewRecorder()
		req = httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers/"+managedProviderID(db)+"/sync", nil)
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("sync round %d: %d %s", round, w.Code, w.Body.String())
		}
		w = httptest.NewRecorder()
		req = httptest.NewRequest("GET", "/agent-config-files/"+file.ID+"/managed-providers", nil)
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("list round %d: %d %s", round, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), `"pending_sync":true`) {
			t.Fatalf("round %d: expected pending_sync false right after sync, got: %s", round, w.Body.String())
		}
	}
}

func TestManagedProviderNoEndpointGroup(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	rule := model.AgentTypeRule{Name: "opencode"}
	if err := rule.SetJsonPaths(model.AgentJsonPaths{Provider: "provider", Model: "provider.{provider_id}.models"}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetRecommendations([]model.AgentRecommendation{
		{Scope: "provider", Key: "options.baseURL", Type: "string", Required: true},
		{Scope: "provider", Key: "options.apiKey", Type: "string", Required: true},
	}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetProtocols([]model.AgentProtocol{}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetModelInfoFields(model.AgentModelInfoFieldPaths{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatal(err)
	}
	file := model.AgentConfigFile{
		RecordName: "t", AgentType: "opencode", Mode: "local", TargetOS: "mac",
		Path: "/tmp/hapiy-test-noep.json", Content: `{"provider":{}}`,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := writeTempFile("/tmp/hapiy-test-noep.json", file.Content); err != nil {
		t.Fatal(err)
	}
	// A supplier with NO endpoints at all.
	p := model.Provider{Name: "NO-EP", Endpoints: `[]`, Models: `[{"model":"m1"},{"model":"m2"}]`, Keys: `["sk-x"]`}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	modelsDev.mu.Lock()
	modelsDev.cached = &modelsDevSnapshot{models: []modelsDevModel{{ID: "m1", Name: "m1", ProviderName: "OpenRouter"}}, fetchedAt: time.Now()}
	modelsDev.mu.Unlock()

	// 未配置 endpoint 组：endpoint 手填 /manual/v1，provider_ids 指向无 endpoint 供应商。
	body := `{"name":"HAPIY","provider_ids":` + idsJSON([]string{p.ID}) + `,"groups":[{"endpoint":"/manual/v1","suffix":"","model_sources":{"m1":"OpenRouter"},"provider_ids":` + idsJSON([]string{p.ID}) + `}]}`
	r := newRouterForManaged(db)
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers/"+managedProviderID(db)+"/sync", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("sync: %d %s", w.Code, w.Body.String())
	}
	syncOut := w.Body.String()
	if !strings.Contains(syncOut, `/manual/v1`) {
		// members resolved from provider_ids: baseUrl=/manual/v1
		t.Fatalf("no-endpoint group did not resolve its hand-typed endpoint: %s", syncOut)
	}
	if !strings.Contains(syncOut, `sk-x`) {
		t.Fatalf("expected apiKey from linked provider: %s", syncOut)
	}
}

func managedProviderID(db *gorm.DB) string {
	var m model.ManagedAgentProvider
	db.First(&m)
	return m.ID
}

// TestManagedProviderSyncModelInfoSpec covers the two managed-sync fixes:
// the bool-op model-info spec (opencode `reasoning` must be a boolean,
// not ["high"]) and the pretty re-indent after sjson inserts a new
// provider block on a single line.
func TestManagedProviderSyncModelInfoSpec(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	rule := model.AgentTypeRule{Name: "opencode"}
	if err := rule.SetJsonPaths(model.AgentJsonPaths{Provider: "provider", Model: "provider.{provider_id}.models"}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetRecommendations([]model.AgentRecommendation{
		{Scope: "provider", Key: "options.baseURL", Type: "string", Required: true},
		{Scope: "provider", Key: "options.apiKey", Type: "string", Required: true},
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
	file := model.AgentConfigFile{
		RecordName: "t", AgentType: "opencode", Mode: "local", TargetOS: "mac",
		Path: "/tmp/hapiy-test-spec.json", Content: `{"provider":{}}`,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := writeTempFile("/tmp/hapiy-test-spec.json", file.Content); err != nil {
		t.Fatal(err)
	}
	p := model.Provider{Name: "HAPIY-A", Endpoints: `[{"pathSuffix":"/v1/chat/completions"}]`, Models: `[{"model":"gpt-x"}]`, Keys: `["sk-a"]`}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	modelsDev.mu.Lock()
	modelsDev.cached = &modelsDevSnapshot{models: []modelsDevModel{
		{ID: "gpt-x", Name: "gpt-x", ProviderName: "OpenRouter", ContextLength: 131072, MaxOutput: 16384, InputTypes: []string{"text"}, Reasoning: true},
	}, fetchedAt: time.Now()}
	modelsDev.mu.Unlock()

	body := `{"name":"HAPIY","provider_ids":` + idsJSON([]string{p.ID}) + `,"api_key":"sk-token-1","groups":[{"endpoint":"/v1/chat/completions","suffix":"","model_sources":{"gpt-x":"OpenRouter"}}]}`
	r := newRouterForManaged(db)
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers/"+managedProviderID(db)+"/sync", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("sync: %d %s", w.Code, w.Body.String())
	}

	// Inspect the file actually written to disk.
	content, err := os.ReadFile("/tmp/hapiy-test-spec.json")
	if err != nil {
		t.Fatal(err)
	}
	out := string(content)
	if !strings.Contains(out, `"reasoning": true`) {
		t.Fatalf("bool-op spec must write a boolean, got: %s", out)
	}
	if strings.Contains(out, `"reasoning":[]`) || strings.Contains(out, `"reasoning":["high"]`) {
		t.Fatalf("reasoning must not be an array: %s", out)
	}
	// Pretty format: the new provider block must span indented lines
	// instead of one compact line.
	if !strings.Contains(out, "\n  \"provider\": {\n") {
		t.Fatalf("synced file must be pretty-printed, got: %s", out)
	}
	if !strings.Contains(out, `"limit": {
        "context": 131072`) && !strings.Contains(out, `"context": 131072`) {
		t.Fatalf("model info numbers missing: %s", out)
	}
}

func TestManagedProviderNameConflict(t *testing.T) {
	db := seedManagedDB(t)
	r := newRouterForManaged(db)
	// link only the two /v1/chat/completions providers → single group
	var p1, p2 model.Provider
	db.Where("name = ?", "HAPIY-A").First(&p1)
	db.Where("name = ?", "HAPIY-B").First(&p2)
	var ids = []string{p1.ID, p2.ID}
	// file already has a provider literally named HAPIY
	target := fileID(db)
	var f model.AgentConfigFile
	db.First(&f)
	f.Content = string(mustJSON(map[string]any{
		"provider": map[string]any{"HAPIY": map[string]any{"npm": "openai"}},
	}))
	db.Save(&f)
	if err := writeTempFile("/tmp/hapiy-test-open.json", f.Content); err != nil {
		t.Fatal(err)
	}
	body := `{"name":"HAPIY","provider_ids":` + idsJSON(ids) + `,"groups":[{"endpoint":"/v1/chat/completions","suffix":"","model_sources":{}}]}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+target+"/managed-providers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatalf("expected 400 on conflict, got %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "同名") {
		t.Fatalf("expected 同名 error: %s", w.Body.String())
	}
}