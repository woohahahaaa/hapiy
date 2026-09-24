package handler

import (
	"strings"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
)

func parseJsoncForTest(data string) ([]model.AgentRecommendation, []model.AgentProtocol, error) {
	return model.ParseRuleConfigJsonc([]byte(data))
}

func TestJsoncRoundTrip(t *testing.T) {
	doc := `{
  // 通用部分
  "common": [
    { "name": "timeout", "key": "options.timeout", "scope": "provider", "required": false, "recommended": 600000 }
  ],
  "protocols": [
    { "name": "OpenAI 兼容", "endpoint_tags": ["/v1/chat/completions"], "fields": [
      { "key": "options.extraBody", "scope": "provider", "recommended": null }
    ] }
  ]
}`
	cleaned := stripJSON5Comments(doc)
	common, protocols, err := parseJsoncForTest(cleaned)
	if err != nil {
		t.Fatal(err)
	}
	if len(common) != 1 || common[0].Recommended != float64(600000) {
		t.Fatalf("common wrong: %+v", common)
	}
	if len(protocols) != 1 || len(protocols[0].EndpointTags) != 1 || len(protocols[0].Recommendations) != 1 {
		t.Fatalf("protocols wrong: %+v", protocols)
	}
	if protocols[0].Recommendations[0].Recommended != nil {
		t.Fatalf("null recommended should stay nil")
	}
}

func TestJsoncWithCommentsKeptInString(t *testing.T) {
	doc := `{"a": "http://x/not//a//comment", "b": "/* not a comment */"}`
	cleaned := stripJSON5Comments(doc)
	if !strings.Contains(cleaned, "http://x/not//a//comment") {
		t.Fatalf("url inside string was stripped: %s", cleaned)
	}
	if !strings.Contains(cleaned, "/* not a comment */") {
		t.Fatalf("comment-like string was stripped: %s", cleaned)
	}
}
