package handler

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
)

// TestBuildOneModelCfgOpencodeV2Shape is the regression guard for the OpenCode
// V2 managed-sync breakage: the generated model entry must carry a COMPLETE
// `capabilities` object (tools + input + output) and an ARRAY `variants`
// (each entry with an id). OpenCode V2 validates native providers strictly and
// skips the entire provider when either is malformed.
func TestBuildOneModelCfgOpencodeV2Shape(t *testing.T) {
	tmpl, ok := model.LoadAgentTemplate("opencode-v2")
	if !ok {
		t.Fatal("opencode-v2 template not found")
	}
	var rule model.AgentTypeRule
	if err := model.ApplyTemplateToRule(&rule, tmpl); err != nil {
		t.Fatal(err)
	}
	recs, _ := rule.GetRecommendations()
	mif, _ := rule.GetModelInfoFields()
	if got := strings.TrimSpace(mif.InputTypes.Path); got != "capabilities.input" {
		t.Fatalf("opencode-v2 input_types path = %q, want capabilities.input", got)
	}
	if mif.ReasoningEffort.VariantShape != "array" {
		t.Fatalf("opencode-v2 reasoning_effort.variant_shape = %q, want array", mif.ReasoningEffort.VariantShape)
	}

	group := model.ManagedAgentGroup{ModelSources: map[string]string{"m1": "DeepSeek"}}
	md := []modelsDevModel{{
		ID: "m1", Name: "m1", ProviderName: "DeepSeek",
		ContextLength: 1000, MaxOutput: 100,
		InputTypes:   []string{"text", "image", "pdf"},
		EffortLevels: []string{"low", "high"},
	}}
	cfg := buildOneModelCfg("m1", recsForScope(recs, "model"), group, mif, md)

	caps, ok := cfg["capabilities"].(map[string]any)
	if !ok {
		t.Fatalf("capabilities missing: %#v", cfg["capabilities"])
	}
	for _, key := range []string{"tools", "input", "output"} {
		if _, ok := caps[key]; !ok {
			t.Fatalf("capabilities.%s missing (OpenCode V2 requires all three): %#v", key, caps)
		}
	}
	if in, _ := json.Marshal(caps["input"]); string(in) != `["text","image","pdf"]` {
		t.Fatalf("capabilities.input = %s, want models.dev types", in)
	}

	variants, ok := cfg["variants"].([]any)
	if !ok || len(variants) != 2 {
		t.Fatalf("variants = %#v, want a 2-entry array", cfg["variants"])
	}
	raw, _ := json.Marshal(cfg["variants"])
	want := `[{"id":"low","settings":{"reasoningEffort":"low"}},{"id":"high","settings":{"reasoningEffort":"high"}}]`
	if string(raw) != want {
		t.Fatalf("variants = %s, want %s", raw, want)
	}
}

// TestEnsureCapabilitiesCompleteSkipsOtherAgents makes sure the completion
// pass only fires for rules whose model input types live under capabilities.*,
// so openclaw / opencode-v1 model shapes are unaffected.
func TestEnsureCapabilitiesCompleteSkipsOtherAgents(t *testing.T) {
	cfg := map[string]any{"input": []any{"text"}}
	ensureCapabilitiesComplete(cfg, "input")
	if _, ok := cfg["capabilities"]; ok {
		t.Fatal("non-capabilities input path must not gain a capabilities object")
	}
}
