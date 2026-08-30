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
			"openai":  map[string]any{"npm": "openai", "options": map[string]any{}},
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
