package model

import (
	"strings"
	"testing"
	"unicode"
)

func hasCJK(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func checkRecsLocalized(t *testing.T, where string, recs []AgentRecommendation) {
	t.Helper()
	for _, r := range recs {
		if !hasCJK(r.Description) {
			continue
		}
		en, ok := agentRecommendationDescriptionEn[r.Description]
		if !ok {
			t.Errorf("%s: no EN translation for description %q", where, r.Description)
			continue
		}
		if strings.TrimSpace(en) == "" {
			t.Errorf("%s: empty EN translation for description %q", where, r.Description)
		}
	}
}

func checkTemplateLocalized(t *testing.T, where string, tmpl AgentTemplateConfig) {
	t.Helper()
	checkRecsLocalized(t, where, tmpl.Recommendations)
	for _, p := range tmpl.Protocols {
		if hasCJK(p.Name) {
			if _, ok := agentProtocolNameEn[p.Name]; !ok {
				t.Errorf("%s: no EN translation for protocol name %q", where, p.Name)
			}
		}
		checkRecsLocalized(t, where, p.Recommendations)
	}
}

// TestLocalizationCoversTemplates guards the follow-default view: every
// Chinese description in the built-in rules and the on-disk templates must
// have an English mapping, otherwise switching to English would leak Chinese.
func TestLocalizationCoversTemplates(t *testing.T) {
	for _, b := range builtinAgentRules {
		tmpl := AgentTemplateConfig{
			Name:            b.Name,
			Recommendations: b.Recommendations,
			Protocols:       b.Protocols,
		}
		checkTemplateLocalized(t, "builtin/"+b.Name, tmpl)
	}
	for _, name := range []string{"opencode-v1", "opencode-v2", "WorkBuddy", "ChatGPT", "openclaw", "DeepSeek Harness (Desktop)", "DeepSeek Harness (Web)"} {
		tmpl, ok := LoadAgentTemplate(name)
		if !ok {
			continue
		}
		checkTemplateLocalized(t, "file/"+name, tmpl)
	}
}

// TestLocalizeRuleFollowsTemplate covers the three requirement cases:
// default-following rules render from the template in either language
// (ignoring stale stored blobs), while customized rules are served verbatim.
func TestLocalizeRuleFollowsTemplate(t *testing.T) {
	tmpl, ok := TemplateForRuleName("opencode-v1")
	if !ok || len(tmpl.Recommendations) == 0 {
		t.Skip("no opencode-v1 template")
	}
	zhDesc := tmpl.Recommendations[0].Description
	if !hasCJK(zhDesc) {
		t.Skip("first recommendation is not Chinese")
	}
	// Simulate an untouched rule whose stored blobs were last saved in English.
	r := AgentTypeRule{Name: "opencode-v1", Customized: false}
	if err := ApplyTemplateToRule(&r, LocalizeTemplate(tmpl, "en")); err != nil {
		t.Fatal(err)
	}
	zh, err := LocalizeRule(&r, "zh")
	if err != nil {
		t.Fatal(err)
	}
	zhRecs, _ := zh.GetRecommendations()
	if len(zhRecs) == 0 || zhRecs[0].Description != zhDesc {
		t.Errorf("zh view should come from the zh template, got %+v", zhRecs)
	}
	en, err := LocalizeRule(&r, "en")
	if err != nil {
		t.Fatal(err)
	}
	enRecs, _ := en.GetRecommendations()
	if len(enRecs) == 0 || hasCJK(enRecs[0].Description) {
		t.Errorf("en view still has Chinese: %+v", enRecs)
	}

	// Customized rules are served verbatim in every language.
	custom := r
	custom.Customized = true
	if err := custom.SetRecommendations([]AgentRecommendation{{Scope: "provider", Key: "k", Description: "我自己的说明"}}); err != nil {
		t.Fatal(err)
	}
	got, err := LocalizeRule(&custom, "en")
	if err != nil {
		t.Fatal(err)
	}
	gotRecs, _ := got.GetRecommendations()
	if len(gotRecs) != 1 || gotRecs[0].Description != "我自己的说明" {
		t.Errorf("customized rule must be served verbatim, got %+v", gotRecs)
	}
}
func TestLocalizeTemplateSwitchesAndKeepsStructure(t *testing.T) {
	tmpl := AgentTemplateConfig{
		Name: "demo",
		Recommendations: []AgentRecommendation{
			{Scope: "provider", Key: "apiKey", Description: "认证密钥", Recommended: "x"},
		},
		Protocols: []AgentProtocol{
			{Name: "OpenAI 兼容 Chat Completions", EndpointTags: []string{"completions"}, Recommendations: []AgentRecommendation{
				{Scope: "model", Key: "name", Description: "模型显示名"},
			}},
		},
	}
	en := LocalizeTemplate(tmpl, "en")
	if en.Recommendations[0].Description != "API key" {
		t.Fatalf("rec description not localized: %q", en.Recommendations[0].Description)
	}
	if en.Protocols[0].Name != "OpenAI-compatible Chat Completions" {
		t.Fatalf("protocol name not localized: %q", en.Protocols[0].Name)
	}
	if en.Protocols[0].Recommendations[0].Description != "Model display name" {
		t.Fatalf("protocol rec description not localized: %q", en.Protocols[0].Recommendations[0].Description)
	}
	// key / scope / recommended untouched
	if en.Recommendations[0].Key != "apiKey" || en.Recommendations[0].Scope != "provider" || en.Recommendations[0].Recommended != "x" {
		t.Fatalf("non-text fields changed: %+v", en.Recommendations[0])
	}
	// zh input is returned unchanged
	if zh := LocalizeTemplate(tmpl, "zh"); zh.Recommendations[0].Description != "认证密钥" {
		t.Fatalf("zh must be unchanged")
	}
}
