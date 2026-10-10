package handler

import (
	"errors"
	"strings"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// configFileFormat reports the document format of a take-over config file
// from its path: YAML for .yml/.yaml, JSON (incl. JSONC/JSON5) otherwise.
// The format only picks the parse/write engine; the rule's paths are
// authored so both engines can resolve them (see splitConfigPath).
func configFileFormat(path string) string {
	lower := strings.ToLower(strings.TrimSpace(path))
	if strings.HasSuffix(lower, ".yml") || strings.HasSuffix(lower, ".yaml") {
		return "yaml"
	}
	return "json"
}

// isYAMLConfigPath reports whether the config file is a YAML document.
func isYAMLConfigPath(path string) bool {
	return configFileFormat(path) == "yaml"
}

// configJSONView returns the file content as a JSON document so every
// existing gjson-based reader keeps working unchanged: JSON text gets its
// JSON5 comments stripped, YAML text is parsed and re-encoded as JSON.
func configJSONView(content, path string) ([]byte, error) {
	if isYAMLConfigPath(path) {
		return yamlToJSON(content)
	}
	return []byte(stripJSON5Comments(content)), nil
}

// configEditor abstracts the in-place edits the recommendation / managed
// sync flows perform on one config document. The JSON implementation keeps
// the historical sjson/gjson behavior byte-for-byte; the YAML one edits
// yaml.v3 nodes so the rest of the document (comments included) survives.
type configEditor interface {
	// Exists reports whether path resolves in the current document.
	Exists(path string) bool
	// Set writes value at path, creating missing containers on the way.
	Set(path string, value any) error
	// Delete removes path; ok=false when it was absent.
	Delete(path string) (bool, error)
	// JSON returns the current document as JSON, for gjson-based helpers.
	JSON() []byte
	// Marshal returns the final document text.
	Marshal() (string, error)
}

// newConfigEditor builds the editor for one file path: JSON (with JSON5
// comments stripped, as before) or YAML (node-preserving).
func newConfigEditor(content, path string) (configEditor, error) {
	if isYAMLConfigPath(path) {
		return newYAMLConfigEditor(content)
	}
	return &jsonConfigEditor{buf: []byte(stripJSON5Comments(content))}, nil
}

// jsonConfigEditor is the original gjson/sjson editor.
type jsonConfigEditor struct {
	buf []byte
}

func (e *jsonConfigEditor) Exists(path string) bool {
	return gjson.Parse(string(e.buf)).Get(path).Exists()
}

func (e *jsonConfigEditor) Set(path string, value any) error {
	next, err := sjson.SetBytes(e.buf, path, value)
	if err != nil {
		return err
	}
	e.buf = next
	return nil
}

func (e *jsonConfigEditor) Delete(path string) (bool, error) {
	if !e.Exists(path) {
		return false, nil
	}
	next, err := sjson.DeleteBytes(e.buf, path)
	if err != nil {
		return false, err
	}
	e.buf = next
	return true, nil
}

func (e *jsonConfigEditor) JSON() []byte { return e.buf }

func (e *jsonConfigEditor) Marshal() (string, error) { return string(e.buf), nil }

// errEmptyPath guards the YAML resolver against empty paths; the JSON side
// treats those as the document root (gjson semantics), which no YAML flow
// relies on.
var errEmptyPath = errors.New("空路径")
