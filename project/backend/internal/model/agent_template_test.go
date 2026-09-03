package model

import "testing"

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
