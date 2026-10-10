package model

import (
	"os"
	"path/filepath"
	"testing"
)

// TestTemplateFilesAreJSONC verifies the JSONC template files in
// config/agent-templates/*.json (with // comments) still load through
// loadAgentTemplateFile — if comment stripping failed, json.Unmarshal
// would error and the file would silently fall back to the built-in
// Go templates.
func TestTemplateFilesAreJSONC(t *testing.T) {
	// Tests run with cwd = package dir; templates live at backend root.
	if err := os.Chdir(filepath.Join("..", "..")); err != nil {
		t.Fatalf("chdir to backend root: %v", err)
	}
	defer os.Chdir(filepath.Join("internal", "model"))
	for _, name := range []string{"opencode-v1", "opencode-v2", "openclaw", "WorkBuddy", "ChatGPT", "DeepSeek Harness"} {
		tmpl, ok := loadAgentTemplateFile(name)
		if !ok {
			t.Fatalf("loadAgentTemplateFile(%q) failed (comment stripping broke the file?)", name)
		}
		if tmpl.Name != name {
			t.Fatalf("loadAgentTemplateFile(%q): got name %q", name, tmpl.Name)
		}
		t.Logf("%s: %d recommendations, %d protocols", name, len(tmpl.Recommendations), len(tmpl.Protocols))
	}
}

// TestFullDocConfigJsoncParses verifies the full commented document the
// frontend now stores (name/os_paths/json_paths/model_info_fields/common/
// protocols + comments) still parses into common/protocols.
func TestFullDocConfigJsoncParses(t *testing.T) {
	doc := `// header
{
  "name": "opencode",
  "os_paths": {"windows": "w", "mac": "m"},
  "json_paths": {"provider": "p", "model": "m", "models_container": "object"},
  "model_info_fields": {"max_context": "limit.context"},
  "common": [
    {"scope": "provider", "key": "name", "description": "", "recommended": null, "required": true}
  ],
  "protocols": [
    {"name": "OpenAI", "conditions": null, "endpoint_tags": ["responses"], "fields": []}
  ]
}`
	cleaned := stripJSONCComments(doc)
	common, protocols, err := ParseRuleConfigJsonc([]byte(cleaned))
	if err != nil {
		t.Fatalf("ParseRuleConfigJsonc: %v", err)
	}
	if len(common) != 1 || common[0].Key != "name" {
		t.Fatalf("common wrong: %+v", common)
	}
	if len(protocols) != 1 || protocols[0].Name != "OpenAI" {
		t.Fatalf("protocols wrong: %+v", protocols)
	}
}
