package handler

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
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
