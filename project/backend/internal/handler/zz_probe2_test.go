package handler

import (
	"encoding/json"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
)

func TestProbeV2ProviderBlock(t *testing.T) {
	tmpl, _ := model.LoadAgentTemplate("opencode-v2")
	var rule model.AgentTypeRule
	if err := model.ApplyTemplateToRule(&rule, tmpl); err != nil {
		t.Fatal(err)
	}
	recs, _ := rule.GetRecommendations()
	protocols, _ := rule.GetProtocols()
	for _, ep := range []string{"/v1/chat/completions", "/v1/responses"} {
		p := matchProtocolByEndpoint(ep, protocols)
		name := "(none)"
		if p != nil {
			name = p.Name
		}
		providerRecs := recsForScope(recs, "provider")
		if p != nil {
			providerRecs = append(providerRecs, recsForScope(p.Recommendations, "provider")...)
		}
		block := map[string]any{}
		applyRecToMap(block, providerRecs)
		raw, _ := json.Marshal(block)
		t.Logf("endpoint=%s protocol=%s block=%s", ep, name, raw)
	}
}
