package model

import (
	"strings"
	"testing"
)

func TestLoadAgentTemplate(t *testing.T) {
	for _, name := range []string{"opencode", "WorkBuddy", "ChatGPT", "openclaw"} {
		tmpl, ok := LoadAgentTemplate(name)
		if !ok {
			t.Fatalf("template %s not found", name)
		}
		if tmpl.Name != name {
			t.Fatalf("template name mismatch: %s", tmpl.Name)
		}
	}
	if _, ok := LoadAgentTemplate("no-such-agent"); ok {
		t.Fatal("unexpected template for unknown agent")
	}
}

// TestEveryAgentProtocolsMatchSdkDriver 守护「每个 agent 默认规则的多 SDK 问题」：
// 凡是 provider 级推荐声明了协议/SDK 驱动字段（api/npm/wire_api 等），该 agent
// 必须有按 endpoint 关键词归类的 protocols —— 否则不同 endpoint 会拿到完全相同的
// 驱动字段值（如全默认 openai-completions）。单协议的 agent（WorkBuddy 仅
// OpenAI 兼容、Codex 仅 responses）不需要 protocols。复现 openclaw 曾缺失
// protocols 的回归。
func TestEveryAgentProtocolsMatchSdkDriver(t *testing.T) {
	driverKeys := map[string]bool{"api": true, "npm": true, "wire_api": true, "wireapi": true, "sdk": true, "adapter": true}
	agents := ListBuiltinTemplates()
	if len(agents) == 0 {
		t.Fatal("no builtin agent templates")
	}

	gotDriver := map[string]bool{}
	hasProtocols := map[string]bool{}
	for _, a := range agents {
		for _, r := range a.Recommendations {
			if r.Scope == "provider" && driverKeys[strings.ToLower(strings.TrimSpace(r.Key))] {
				gotDriver[a.Name] = true
			}
		}
		if len(a.Protocols) > 0 {
			hasProtocols[a.Name] = true
		}
	}

	// 有驱动字段 → 必须配 protocols（按 endpoint 归类，不能全站同一个值）。
	for name := range gotDriver {
		if !hasProtocols[name] {
			t.Fatalf("agent %s declares an SDK-driver field but has no per-endpoint protocols; "+
				"different endpoints would silently share one driver value", name)
		}
	}

	// 每个 protocols 的 endpoint 关键词都必须在托管生成里能被 endpoint 命中，
	// 并且 anthropic-messages 类协议（opencode/openclaw）必须把输出 token 标为必填。
	for _, a := range agents {
		for _, p := range a.Protocols {
			hasTag := false
			for _, tag := range p.EndpointTags {
				if strings.TrimSpace(tag) != "" {
					hasTag = true
				}
			}
			if !hasTag {
				t.Fatalf("agent %s protocol %q has no endpoint_tags; endpoint matching is impossible", a.Name, p.Name)
			}
			isAnthropic := false
			for _, tag := range p.EndpointTags {
				if strings.Contains("anthropic-messages", tag) || strings.Contains("chat/message", tag) || tag == "messages" {
					isAnthropic = true
				}
			}
			if isAnthropic {
				requiredOutput := false
				for _, r := range p.Recommendations {
					if r.Scope == "model" && (r.Key == "maxTokens" || r.Key == "limit.output" || r.Key == "maxOutputTokens") && r.Required {
						requiredOutput = true
					}
				}
				if !requiredOutput {
					t.Fatalf("agent %s anthropic protocol %q must mark the model output-token field required, "+
						"got none", a.Name, p.Name)
				}
			}
		}
	}
}
