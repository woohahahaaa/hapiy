package handler

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/tidwall/gjson"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const dshSample = `# Profile patch comments must survive edits
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-account
    model: deepseek-flash
- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
  config:
    transcriptView: detailed
`

// TestYAMLViewResolvesRulePaths: YAML 文件转成 JSON 视图后，规则里的
// 查询路径（#(id=="…")）能被 gjson 直接解析，provider/model 读取无需改。
func TestYAMLViewResolvesRulePaths(t *testing.T) {
	view, err := yamlToJSON(dshSample)
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid(view) {
		t.Fatalf("view must be valid JSON: %s", view)
	}
	// The sample has no llm-pi-ai entry yet.
	if r := gjson.GetBytes(view, `#(id=="llm-pi-ai").config.providers`); r.Exists() {
		t.Fatalf("no llm-pi-ai entry expected yet, got %s", r.Raw)
	}

	withProviders := `- id: llm-pi-ai
  config:
    providers:
      HAPIY:
        apiKeyEnv: HAPIY_API_KEY
        api: openai-completions
        baseURL: https://gw.example.com/v1
        models:
          - id: gpt-5.6-sol
          - id: claude-fable-5
            maxTokens: 8192
`
	view, err = yamlToJSON(withProviders)
	if err != nil {
		t.Fatal(err)
	}
	provs := gjson.GetBytes(view, `#(id=="llm-pi-ai").config.providers`)
	if !provs.IsObject() || !provs.Get("HAPIY").Exists() {
		t.Fatalf("provider lookup failed: %s", provs.Raw)
	}
	models := gjson.GetBytes(view, `#(id=="llm-pi-ai").config.providers.HAPIY.models`)
	if !models.IsArray() || len(models.Array()) != 2 {
		t.Fatalf("models lookup failed: %s", models.Raw)
	}
	if got := models.Array()[1].Get("maxTokens").Int(); got != 8192 {
		t.Fatalf("yaml numbers must stay numbers in the view, got %d", got)
	}
}

// TestYAMLEditorManagedWrites: 托管生成的写入在一个真实 dsh patch 上落盘
// 正确：创建 llm-pi-ai 条目、写 provider 字段、写 models 子树，且不碰其他
// 条目的注释与内容。
func TestYAMLEditorManagedWrites(t *testing.T) {
	ed, err := newYAMLConfigEditor(dshSample)
	if err != nil {
		t.Fatal(err)
	}
	providerPath := `#(id=="llm-pi-ai").config.providers.HAPIY`
	if err := ed.Set(providerPath+".apiKeyEnv", "HAPIY_API_KEY"); err != nil {
		t.Fatal(err)
	}
	if err := ed.Set(providerPath+".api", "openai-completions"); err != nil {
		t.Fatal(err)
	}
	if err := ed.Set(providerPath+".baseURL", "https://gw.example.com/v1"); err != nil {
		t.Fatal(err)
	}
	models := []map[string]any{
		{"id": "gpt-5.6-sol", "name": "gpt-5.6-sol"},
		{"id": "claude-fable-5", "maxTokens": 8192},
	}
	if err := ed.Set(`#(id=="llm-pi-ai").config.providers.HAPIY.models`, models); err != nil {
		t.Fatal(err)
	}
	out, err := ed.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"# Profile patch comments must survive edits",
		`- id: agent-default-model`,
		`- id: llm-pi-ai`,
		`apiKeyEnv: HAPIY_API_KEY`,
		`api: openai-completions`,
		`baseURL: https://gw.example.com/v1`,
		`- id: gpt-5.6-sol`,
		`maxTokens: 8192`,
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("output missing %q:\n%s", want, out)
		}
	}
	// The new entry must be appendable to a list whose entries keep comments.
	if strings.Count(out, "- id: agent-default-model") != 1 {
		t.Fatalf("existing entry duplicated:\n%s", out)
	}
	// And the result must still parse.
	if _, err := yamlToJSON(out); err != nil {
		t.Fatalf("output must stay valid yaml: %v\n%s", err, out)
	}
}

// TestYAMLEditorDeleteAndRevert: 删除旧 provider 块；删除不存在的路径是
// no-op；删除后 JSON 视图里查询路径随之消失。
func TestYAMLEditorDeleteAndRevert(t *testing.T) {
	content := `- id: llm-pi-ai
  config:
    providers:
      HAPIY:
        api: openai-completions
      OLD-NAME:
        api: openai-completions
`
	ed, err := newYAMLConfigEditor(content)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := ed.Delete(`#(id=="llm-pi-ai").config.providers.OLD-NAME`)
	if err != nil || !ok {
		t.Fatalf("delete existing block: ok=%v err=%v", ok, err)
	}
	ok, err = ed.Delete(`#(id=="llm-pi-ai").config.providers.MISSING`)
	if err != nil || ok {
		t.Fatalf("delete missing block must be a no-op: ok=%v err=%v", ok, err)
	}
	out, err := ed.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	view, err := yamlToJSON(out)
	if err != nil {
		t.Fatal(err)
	}
	if gjson.GetBytes(view, `#(id=="llm-pi-ai").config.providers.OLD-NAME`).Exists() {
		t.Fatalf("deleted block still present:\n%s", out)
	}
	if !gjson.GetBytes(view, `#(id=="llm-pi-ai").config.providers.HAPIY`).Exists() {
		t.Fatalf("surviving block lost:\n%s", out)
	}
}

// TestYAMLEditorReplacesModelArray: 整段重写 models（托管同步的路径）时，
// 旧模型条目被替换而不是叠加。
func TestYAMLEditorReplacesModelArray(t *testing.T) {
	content := `- id: llm-pi-ai
  config:
    providers:
      HAPIY:
        models:
          - id: old-model
            maxTokens: 1024
`
	ed, err := newYAMLConfigEditor(content)
	if err != nil {
		t.Fatal(err)
	}
	if err := ed.Set(`#(id=="llm-pi-ai").config.providers.HAPIY.models`, []map[string]any{{"id": "new-model"}}); err != nil {
		t.Fatal(err)
	}
	out, err := ed.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "old-model") {
		t.Fatalf("stale model must be replaced:\n%s", out)
	}
	if !strings.Contains(out, "new-model") {
		t.Fatalf("new model missing:\n%s", out)
	}
}

// TestYAMLPathEscapesAndIndexes: 转义点（sjson 键转义）与数组下标段。
func TestYAMLPathEscapesAndIndexes(t *testing.T) {
	content := `- id: llm-pi-ai
  config:
    providers:
      HAPIY:
        models:
          - id: first
            maxTokens: 1
          - id: second
            maxTokens: 2
`
	ed, err := newYAMLConfigEditor(content)
	if err != nil {
		t.Fatal(err)
	}
	if err := ed.Set(`#(id=="llm-pi-ai").config.providers.HAPIY.models.1.maxTokens`, 4096); err != nil {
		t.Fatal(err)
	}
	if !ed.Exists(`#(id=="llm-pi-ai").config.providers.HAPIY.models.1.maxTokens`) {
		t.Fatal("indexed path must resolve")
	}
	out, err := ed.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	view, _ := yamlToJSON(out)
	if got := gjson.GetBytes(view, `#(id=="llm-pi-ai").config.providers.HAPIY.models.1.maxTokens`).Int(); got != 4096 {
		t.Fatalf("indexed write failed, got %d:\n%s", got, out)
	}
}

// TestManagedYAMLDeepSeekHarnessFlow 端到端：用 dsh 的真实规则（Desktop）
// 在一个 YAML 文件上走完 托管 provider 创建 → 同步写盘 → 读回 → pending 收敛。
// 回归点：YAML 不能被按 JSON 写坏、注释与其他条目必须保留、模型数组带 id。
func TestManagedYAMLDeepSeekHarnessFlow(t *testing.T) {
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

	dir := t.TempDir()
	path := filepath.Join(dir, "cordis.patch.yml")
	initial := "# keep me\n- id: agent-default-model\n  name: \"@deepseek-ai/dsh-agent-default-model\"\n  config:\n    provider: deepseek-account\n    model: deepseek-flash\n"
	if err := writeFile(path, initial); err != nil {
		t.Fatal(err)
	}
	file := model.AgentConfigFile{
		RecordName: "dsh-test", AgentType: "DeepSeek Harness (Desktop)",
		Mode: "local", TargetOS: "mac", Path: path,
	}
	if err := db.Create(&file).Error; err != nil {
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
			{ID: "gpt-x", Name: "gpt-x", ProviderName: "OpenRouter", ContextLength: 131072, MaxOutput: 16384, InputTypes: []string{"text"}},
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

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/agent-config-files/:id/managed-providers", CreateManagedProvider(db, nil))
	r.GET("/agent-config-files/:id/managed-providers", ListManagedProviders(db, nil))
	r.POST("/agent-config-files/:id/managed-providers/:mid/sync", SyncManagedProvider(db, nil))
	r.GET("/agent-config-files/:id/models", GetAgentConfigFileModels(db, nil))

	// 1) 还没建 llm-pi-ai 条目时，GET models 给空列表而不是报错。
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/agent-config-files/"+file.ID+"/models", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("models on a fresh yaml: %d %s", w.Code, w.Body.String())
	}

	// 2) 建托管 provider 并同步写盘。
	body := `{"name":"hapiying","provider_ids":` + idsJSON(ids) + `,"api_key":"sk-token-1","groups":[{"endpoint":"/v1/chat/completions","suffix":"-C","model_sources":{"gpt-x":"OpenRouter","gpt-y":"OpenRouter"}}]}`
	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create managed: %d %s", w.Code, w.Body.String())
	}
	mid := managedProviderID(db)

	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers/"+mid+"/sync", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("sync: %d %s", w.Code, w.Body.String())
	}

	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	out := string(written)
	for _, want := range []string{
		"# keep me",
		"- id: agent-default-model",
		"- id: llm-pi-ai",
		"hapiying-C:",
		"apiKeyEnv: HAPIY_API_KEY",
		"gpt-x",
		"gpt-y",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("written yaml missing %q:\n%s", want, out)
		}
	}

	// 3) 写出的 YAML 能按规则路径读回，models 是带 id 的数组。
	view, err := yamlToJSON(out)
	if err != nil {
		t.Fatalf("written file must stay valid yaml: %v\n%s", err, out)
	}
	provs := gjson.GetBytes(view, `#(id=="llm-pi-ai").config.providers.hapiying-C`)
	if !provs.Exists() {
		t.Fatalf("synced provider not readable:\n%s", out)
	}
	models := provs.Get("models")
	if !models.IsArray() || len(models.Array()) != 2 {
		t.Fatalf("models must be an array of entries: %s", models.Raw)
	}
	for _, item := range models.Array() {
		if item.Get("id").String() == "" {
			t.Fatalf("array entry missing id: %s", item.Raw)
		}
	}

	// 4) 同步必须收敛：文件块与生成块相等，pending_sync=false。
	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/agent-config-files/"+file.ID+"/managed-providers", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}
	var listed struct {
		Data []struct {
			PendingSync bool `json:"pending_sync"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Data) != 1 || listed.Data[0].PendingSync {
		t.Fatalf("sync must converge (pending=false), got %+v\n%s", listed.Data, out)
	}
}

// TestApplyRecommendationsYAML 端到端：一键套用推荐值（dsh 规则）在 YAML 文件
// 上走节点编辑——已存在的 provider 里补上 apiKeyEnv，其余内容与注释保留，
// 返回值仍是 YAML（不是被 JSON 化的文件）。
func TestApplyRecommendationsYAML(t *testing.T) {
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

	dir := t.TempDir()
	path := filepath.Join(dir, "cordis.patch.yml")
	content := "# keep\n- id: llm-pi-ai\n  config:\n    providers:\n      HAPIY-C:\n        api: openai-completions\n        baseURL: https://gw.example.com/v1\n        models:\n          - id: gpt-x\n"
	if err := writeFile(path, content); err != nil {
		t.Fatal(err)
	}
	file := model.AgentConfigFile{
		RecordName: "dsh-apply", AgentType: "DeepSeek Harness (Desktop)",
		Mode: "local", TargetOS: "mac", Path: path,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/agent-config-files/:id/apply-recommendation-template", ApplyRecommendationTemplate(db, nil))

	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/apply-recommendation-template", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("apply template: %d %s", w.Code, w.Body.String())
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
		t.Fatalf("expected at least one field applied: %s", w.Body.String())
	}
	if !strings.Contains(resp.Data.Content, "apiKeyEnv: HAPIY_API_KEY") {
		t.Fatalf("recommended apiKeyEnv not written:\n%s", resp.Data.Content)
	}
	if !strings.Contains(resp.Data.Content, "# keep") {
		t.Fatalf("unrelated comment must survive:\n%s", resp.Data.Content)
	}
	if strings.Contains(resp.Data.Content, "{") {
		t.Fatalf("YAML output must not be JSON-ified:\n%s", resp.Data.Content)
	}
	if _, err := yamlToJSON(resp.Data.Content); err != nil {
		t.Fatalf("output must stay valid yaml: %v\n%s", err, resp.Data.Content)
	}
}
