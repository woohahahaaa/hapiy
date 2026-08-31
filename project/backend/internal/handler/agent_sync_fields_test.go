package handler

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// seedSyncFieldsDB builds an in-memory DB with one opencode rule, one
// config file pointing at a tmp config JSON, and nothing else.
func seedSyncFieldsDB(t *testing.T) (*gorm.DB, string) {
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
	if err := rule.SetModelInfoFields(model.AgentModelInfoFieldPaths{
		MaxContext:     "limit.context",
		MaxOutputToken: "limit.output",
		InputTypes:     "modalities.input",
		ThinkingLevels: "reasoning",
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
    "anthropic": {
      "models": {
        "claude-3.5": {
          "name": "Claude 3.5"
        }
      }
    }
  }
}`
	if err := writeFile(path, content); err != nil {
		t.Fatal(err)
	}
	row := model.AgentConfigFile{
		RecordName: "opencode",
		AgentType:  "opencode",
		Mode:       "local",
		Path:       path,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	return db, row.ID
}

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

func newRouterForSyncFields(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/agent-config-files/:id/sync-model-fields", SyncAgentConfigFileModelFields(db, nil))
	return r
}

// TestSyncAgentConfigFileModelFields_modelIDWithDot reproduces the bug
// where a model id containing `.` (e.g. `claude-3.5`) tripped sjson path
// parsing. After escaping the model id the field lands at the right key.
func TestSyncAgentConfigFileModelFields_modelIDWithDot(t *testing.T) {
	db, id := seedSyncFieldsDB(t)
	r := newRouterForSyncFields(db)

	body := bytes.NewBufferString(`{"provider_id":"anthropic","model_id":"claude-3.5","fields":{"limit.context":200000}}`)
	req := httptest.NewRequest("POST", "/agent-config-files/"+id+"/sync-model-fields", body)
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
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Applied != 1 {
		t.Fatalf("applied: want 1, got %d", resp.Data.Applied)
	}
	if !strings.Contains(resp.Data.Content, `"claude-3.5":`) || !strings.Contains(resp.Data.Content, `"limit":{"context":200000`) {
		t.Fatalf("content did not land on the dotted key: %s", resp.Data.Content)
	}
}

// TestSyncAgentConfigFileModelFields_arrayModels covers the openclaw shape
// where `models` is an ARRAY of entries carrying an `id` field. The model
// must be located by index, not by a literal key (which tripped sjson with
// "cannot set array element for non-numeric key").
func TestSyncAgentConfigFileModelFields_arrayModels(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	rule := model.AgentTypeRule{Name: "openclaw"}
	if err := rule.SetJsonPaths(model.AgentJsonPaths{
		Provider: "models.providers",
		Model:    "models.providers.{provider_id}.models",
	}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetModelInfoFields(model.AgentModelInfoFieldPaths{
		MaxContext:     "contextWindow",
		MaxOutputToken: "maxTokens",
		InputTypes:     "input",
		ThinkingLevels: "reasoning",
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

	r := gin.New()
	r.POST("/agent-config-files/:id/sync-model-fields", SyncAgentConfigFileModelFields(db, nil))
	body := bytes.NewBufferString(`{"provider_id":"wooh-anthrop","model_id":"MiniMax-M3","fields":{"maxTokens":256000}}`)
	req := httptest.NewRequest("POST", "/agent-config-files/"+row.ID+"/sync-model-fields", body)
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
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Applied != 1 {
		t.Fatalf("applied: want 1, got %d", resp.Data.Applied)
	}
	if !strings.Contains(resp.Data.Content, `"maxTokens": 256000`) || !strings.Contains(resp.Data.Content, `"contextWindow": 200000`) {
		t.Fatalf("content did not update the right array element: %s", resp.Data.Content)
	}
	if strings.Contains(resp.Data.Content, `"maxTokens": 16000`) {
		t.Fatalf("updated the wrong array element: %s", resp.Data.Content)
	}
}

// TestSyncAgentConfigFileModelFields_providerIDWithDot covers provider ids
// (substituted into the rule's `{provider_id}` template) with dots.
func TestSyncAgentConfigFileModelFields_providerIDWithDot(t *testing.T) {
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
	if err := rule.SetModelInfoFields(model.AgentModelInfoFieldPaths{
		MaxContext: "limit.context",
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.json")
	content := `{"provider":{"openai.com":{"models":{"gpt-4o":{}}}}}`
	if err := writeFile(path, content); err != nil {
		t.Fatal(err)
	}
	row := model.AgentConfigFile{
		RecordName: "opencode",
		AgentType:  "opencode",
		Mode:       "local",
		Path:       path,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	r.POST("/agent-config-files/:id/sync-model-fields", SyncAgentConfigFileModelFields(db, nil))
	body := bytes.NewBufferString(`{"provider_id":"openai.com","model_id":"gpt-4o","fields":{"limit.context":128000}}`)
	req := httptest.NewRequest("POST", "/agent-config-files/"+row.ID+"/sync-model-fields", body)
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
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Applied != 1 {
		t.Fatalf("applied: want 1, got %d", resp.Data.Applied)
	}
	if !strings.Contains(resp.Data.Content, `"openai.com":{"models":{"gpt-4o":{"limit":{"context":128000}}`) {
		t.Fatalf("content did not land on the dotted provider key: %s", resp.Data.Content)
	}
}
