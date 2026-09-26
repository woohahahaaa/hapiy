package handler

import "testing"

func TestFindModelsDevRow_normalizesHyphensAndSpaces(t *testing.T) {
	models := []modelsDevModel{
		{ID: "glm-5.3", Name: "GLM-5.3", ProviderName: "Zhipu AI"},
		{ID: "zai/glm-5.3", Name: "GLM-5.3", ProviderName: "Z.AI"},
		{ID: "kimi-k3", Name: "Kimi K3", ProviderName: "Moonshot AI"},
	}
	cases := []struct {
		name     string
		model    string
		supplier string
		wantID   string
	}{
		{name: "exact", model: "glm-5.3", supplier: "Zhipu AI", wantID: "glm-5.3"},
		{name: "hyphen stripped", model: "GLM5.3", supplier: "Zhipu AI", wantID: "glm-5.3"},
		{name: "hyphen stripped qualified", model: "GLM5.3", supplier: "Z.AI", wantID: "zai/glm-5.3"},
		{name: "space stripped", model: "KimiK3", supplier: "Moonshot AI", wantID: "kimi-k3"},
		{name: "space variant", model: "Kimi K3", supplier: "Moonshot AI", wantID: "kimi-k3"},
	}
	for _, tc := range cases {
		row, ok := findModelsDevRow(models, tc.model, tc.supplier)
		if !ok {
			t.Fatalf("%s: expected match for %q/%q", tc.name, tc.model, tc.supplier)
		}
		if row.ID != tc.wantID {
			t.Fatalf("%s: got %q, want %q", tc.name, row.ID, tc.wantID)
		}
	}
}

func TestFindModelsDevRow_mismatch(t *testing.T) {
	models := []modelsDevModel{
		{ID: "glm-5.3", Name: "GLM-5.3", ProviderName: "Zhipu AI"},
	}
	if _, ok := findModelsDevRow(models, "gpt-4o", "Zhipu AI"); ok {
		t.Fatal("expected no match for unrelated model")
	}
	if _, ok := findModelsDevRow(models, "glm-5.3", "OpenAI"); ok {
		t.Fatal("expected no match for unrelated supplier")
	}
}
