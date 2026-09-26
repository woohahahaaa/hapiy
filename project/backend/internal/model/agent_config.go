package model

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AgentOsPaths — per-OS default config path templates for an agent type.
// Keys are "windows" and "mac"; paths may use env-var placeholders
// (%APPDATA%, %USERPROFILE%) on Windows and ~ / $HOME on macOS.
type AgentOsPaths struct {
	Windows string `json:"windows"` // e.g. `%USERPROFILE%\.config\opencode\opencode.json`
	Mac     string `json:"mac"`     // e.g. `~/.config/opencode/opencode.json`
}

// AgentJsonPaths — gjson expressions used to read providers and their
// models out of an agent's config file (see "管理模型"). ProviderPath
// must resolve to an object whose keys are provider ids. ModelPath is
// a full gjson path from the document root and supports the
// `{provider_id}` placeholder, which is substituted with the current
// provider key before each lookup. Writing the full path (rather than
// a fragment relative to each provider) lets the schema handle agents
// whose models live anywhere — under a provider, in a sibling list, or
// anywhere else reachable from the root.
//
// ModelsContainer declares the JSON shape of the per-provider models
// container that the rule expects — "array" (each entry is {id, ...cfg},
// e.g. openclaw) or "object" (each model is a key whose value is the
// cfg object, e.g. opencode). Empty / unset means "object" so old
// stored blobs keep their pre-existing write behaviour.
type AgentJsonPaths struct {
	Provider        string `json:"provider"`         // e.g. `provider` (opencode)
	Model           string `json:"model"`            // e.g. `provider.{provider_id}.models`
	ModelsContainer string `json:"models_container"` // "" | "array" | "object"
}

// AgentRecommendation — one recommended field for an agent's provider or
// model config. Scope decides where the field is checked/applied:
// "provider" against the provider's other_fields, "model" against each
// model's config object. Key is a gjson path under that scope (single
// segment or dotted, no array wildcards).
//
// Action declares what the recommendation should do to the field:
//
//	"set"   推荐填 —— 写入 Recommended（默认，缺省即 set）
//	"skip"  推荐不填 —— 明确不动该字段（即使文件里已有也保持原样）
//	"delete"推荐删除该字段
//
// Op / Sep / Values shape the Recommended value before writing (值写法),
// matching the semantics of AgentModelInfoFieldSpec: op raw/bool/first/join,
// sep for join, Values as an allowed-literal whitelist that drops anything
// not listed (e.g. openclaw's `input` only accepts text/image/video/audio).
type AgentRecommendation struct {
	Name        string            `json:"name,omitempty"`       // 字段名（官方配置里）
	Scope       string            `json:"scope"`                // "provider" | "model"
	Key         string            `json:"key"`                  // gjson path, e.g. "maxConcurrency" or "thinking.type"
	Description string            `json:"description"`          // human-readable meaning
	Action      string            `json:"action,omitempty"`     // "set" | "skip" | "delete"（缺省 "set"）
	Recommended any               `json:"recommended"`          // recommended value, or null when not filled
	Candidates  map[string]string `json:"candidates,omitempty"` // 多候选值说明 key→含义
	Required    bool              `json:"required"`             // recommended to be present?
	Op          string            `json:"op,omitempty"`         // ""|"raw"|"bool"|"first"|"join"
	Sep         string            `json:"sep,omitempty"`        // join 分隔符
	Values      []string          `json:"values,omitempty"`     // allowed-literal whitelist
}

// RecommendAction resolves the effective action of a recommendation,
// defaulting the empty value to "set" for backward compatibility.
func (r AgentRecommendation) RecommendAction() string {
	if r.Action == "skip" || r.Action == "delete" {
		return r.Action
	}
	return "set"
}

// ShapeValue applies the 值写法 (op/sep/values) to the recommendation's
// value before writing. ok=false means "skip this field" after shaping.
func (r AgentRecommendation) ShapeValue(v any) (any, bool) {
	return shapeValue(r.Op, r.Sep, r.Values, v)
}

// AgentModelInfoFieldSpec — one unified model-info field's write spec.
// A plain string ("limit.context") writes the unified value at that gjson
// path unchanged (legacy form, op raw). The object form additionally names
// an op that reshapes the unified value before writing, because agents
// disagree on the value shape — e.g. opencode's `reasoning` must be a
// boolean while the unified 思考程度 value is a level array:
//
//	"thinking_levels": {"path": "reasoning", "op": "bool"}
//
// Ops: raw (default, value as-is), bool (non-empty → true, empty →
// false), first (first element; skipped when empty), join (elements
// joined with Sep, default ","; skipped when empty).
//
// Values filters array outputs to the listed allowed literals before
// writing (e.g. openclaw's `input` only accepts text/image/video/audio,
// so `"values": ["text","image","video","audio"]` strips anything else
// like models.dev's "pdf"). Unlisted elements are dropped; set empty to
// skip filtering.
//
// Action mirrors AgentRecommendation.Action: "set" (default) writes the
// unified value, "delete" removes the field from the model config
// entirely, and "skip" leaves any existing value untouched.
type AgentModelInfoFieldSpec struct {
	Path   string   `json:"path"`
	Action string   `json:"action,omitempty"` // "set" | "skip" | "delete"（缺省 "set"）
	Op     string   `json:"op,omitempty"`
	Sep    string   `json:"sep,omitempty"`
	Values []string `json:"values,omitempty"`
}

// RecommendAction resolves the effective action of a model-info field
// spec, defaulting the empty value to "set".
func (s AgentModelInfoFieldSpec) RecommendAction() string {
	if s.Action == "skip" || s.Action == "delete" {
		return s.Action
	}
	return "set"
}

// UnmarshalJSON accepts the legacy string form and the object form.
func (s *AgentModelInfoFieldSpec) UnmarshalJSON(b []byte) error {
	trimmed := strings.TrimSpace(string(b))
	if trimmed == "null" || trimmed == `""` {
		*s = AgentModelInfoFieldSpec{}
		return nil
	}
	if len(trimmed) > 0 && trimmed[0] == '"' {
		return json.Unmarshal(b, &s.Path)
	}
	type plain AgentModelInfoFieldSpec
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*s = AgentModelInfoFieldSpec(p)
	return nil
}

// MarshalJSON writes the plain-path string form unless an op (other than
// raw), a separator, or an allowed-values filter is configured, keeping
// stored blobs and API payloads readable for the common case.
func (s AgentModelInfoFieldSpec) MarshalJSON() ([]byte, error) {
	if (s.Op == "" || s.Op == "raw") && s.Sep == "" && len(s.Values) == 0 {
		return json.Marshal(s.Path)
	}
	type plain AgentModelInfoFieldSpec
	return json.Marshal(plain(s))
}

// Shape converts the unified model-info value into the concrete value to
// write. ok is false when the op semantics say the field must be skipped
// (empty raw / first / join values), so agents never receive e.g. an
// empty array where a boolean is expected.
func (s AgentModelInfoFieldSpec) Shape(v any) (any, bool) {
	return shapeValue(s.Op, s.Sep, s.Values, v)
}

// shapeValue transforms a unified/raw value into the concrete value an
// agent expects: op raw (as-is, filtered by allowed values), bool
// (non-empty → true, empty → false), first (first element of a list),
// join (list joined with sep), variants (list of allowed levels →
// {level:{options:{reasoningEffort:level}}} preset map). ok=false means
// "skip this field".
// This is the single 值写法 engine shared by the unified model-info
// fields and AgentRecommendation writing.
func shapeValue(op, sep string, allowed []string, v any) (any, bool) {
	switch op {
	case "bool":
		if v == nil {
			return nil, false
		}
		return valueTruthy(v), true
	case "first":
		arr, ok := toStrings(v)
		if !ok {
			return nil, false
		}
		arr = filterValues(allowed, arr)
		if len(arr) == 0 {
			return nil, false
		}
		return arr[0], true
	case "join":
		if sep == "" {
			sep = ","
		}
		arr, ok := toStrings(v)
		if !ok {
			return nil, false
		}
		arr = filterValues(allowed, arr)
		if len(arr) == 0 {
			return nil, false
		}
		return strings.Join(arr, sep), true
	case "variants":
		// 把「允许的档位集合」写成 agent 的 variants 预设对象：
		// 每个档位一个 {"options":{"reasoningEffort":<档位>}} 条目
		// （opencode 官方表达多档位的结构）。交集为空则不写。
		arr, ok := toStrings(v)
		if !ok {
			return nil, false
		}
		arr = filterValues(allowed, arr)
		if len(arr) == 0 {
			return nil, false
		}
		out := make(map[string]any, len(arr))
		for _, lvl := range arr {
			out[lvl] = map[string]any{"options": map[string]any{"reasoningEffort": lvl}}
		}
		return out, true
	default: // "" | "raw"
		arr, isArr := toStrings(v)
		if isArr {
			arr = filterValues(allowed, arr)
			if len(arr) == 0 {
				return nil, false
			}
			// Preserve the original element kind when the caller passed a
			// []any so applyModelInfoFromModelsDev still assigns an array.
			if _, anySlice := v.([]any); anySlice {
				out := make([]any, len(arr))
				for i, x := range arr {
					out[i] = x
				}
				return out, true
			}
			return arr, true
		}
		switch val := v.(type) {
		case nil:
			return nil, false
		case string:
			if val == "" {
				return nil, false
			}
		}
		return v, true
	}
}

// filterValues drops elements not listed in the allowed whitelist
// (case-insensitive, trimmed). An empty whitelist passes everything.
func filterValues(allowed, arr []string) []string {
	if len(allowed) == 0 {
		return arr
	}
	allow := make(map[string]bool, len(allowed))
	for _, v := range allowed {
		allow[strings.ToLower(strings.TrimSpace(v))] = true
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if allow[strings.ToLower(strings.TrimSpace(item))] {
			out = append(out, item)
		}
	}
	return out
}

// toStrings normalizes a unified value into a string slice. nil and
// scalar values yield ok=false so ops that need arrays skip.
func toStrings(v any) ([]string, bool) {
	switch arr := v.(type) {
	case []string:
		return arr, true
	case []any:
		if len(arr) == 0 {
			return nil, true
		}
		out := make([]string, 0, len(arr))
		for _, item := range arr {
			out = append(out, fmt.Sprintf("%v", item))
		}
		return out, true
	case nil:
		return nil, false
	}
	return nil, false
}

func valueTruthy(v any) bool {
	switch val := v.(type) {
	case bool:
		return val
	case string:
		return val != ""
	case []any:
		return len(val) > 0
	case []string:
		return len(val) > 0
	case nil:
		return false
	}
	return true
}

// ModelInfoPath is the plain-path (raw) spec shorthand used by seeds.
func ModelInfoPath(p string) AgentModelInfoFieldSpec {
	return AgentModelInfoFieldSpec{Path: p}
}

// ModelInfoOp is the op-carrying spec shorthand used by seeds.
func ModelInfoOp(p, op string) AgentModelInfoFieldSpec {
	return AgentModelInfoFieldSpec{Path: p, Op: op}
}

// AgentModelInfoFieldPaths maps the five unified model-info fields to
// their write specs inside each agent's model config object (see
// AgentModelInfoFieldSpec for the syntax). Agents name these fields
// differently (opencode: limit.context // modalities.input; openclaw:
// contextWindow / input, ...), so the spec is stored per rule and both
// the "同步模型信息" dialog and managed-provider generation use it to
// write values back. Field names are the fixed shared vocabulary:
//
//	max_context       最大上下文
//	max_output_token  最大输出token
//	input_types       支持的输入类型
//	thinking_levels   支持的思考程度
type AgentModelInfoFieldPaths struct {
	MaxContext      AgentModelInfoFieldSpec `json:"max_context"`
	MaxOutputToken  AgentModelInfoFieldSpec `json:"max_output_token"`
	InputTypes      AgentModelInfoFieldSpec `json:"input_types"`
	ThinkingLevels  AgentModelInfoFieldSpec `json:"thinking_levels"`
	ReasoningEffort AgentModelInfoFieldSpec `json:"reasoning_effort"`
}

// AgentProtocolCondition — one OR-branch of a request-protocol's match
// rule. The condition reads a provider-level config field (a gjson path
// inside the agent's provider config block, e.g. opencode's
// "options.baseURL" or openclaw's "api") and compares it against Value
// using the operator. Multiple conditions on a protocol are ORed.
type AgentProtocolCondition struct {
	Field string `json:"field"` // provider-level gjson path inside the agent config
	Op    string `json:"op"`    // "equals" | "contains" | "not_contains" | "not_equals"
	Value string `json:"value"`
}

// AgentProtocol — one "请求协议 (SDK)" block of an agent-type rule.
// Name is free text. The block applies when ANY of its Conditions match
// the provider's config fields. EndpointTags is the fixed "根据 endpoint
// 来判断" field: every tag is a keyword matched as a substring of the
// model endpoint (e.g. "completions" hits "/v1/chat/completions",
// "responses" hits "/v1/responses"); at least one tag is required.
// Recommendations only take effect when the protocol matches,
// and override/supplement the rule's common recommendations.
type AgentProtocol struct {
	Name            string                   `json:"name"`
	Conditions      []AgentProtocolCondition `json:"conditions"`
	EndpointTags    []string                 `json:"endpoint_tags"`
	Recommendations []AgentRecommendation    `json:"recommendations"`
}

const (
	ModelInfoFieldMaxContext      = "max_context"
	ModelInfoFieldMaxOutputToken  = "max_output_token"
	ModelInfoFieldInputTypes      = "input_types"
	ModelInfoFieldThinkingLevels  = "thinking_levels"
	ModelInfoFieldReasoningEffort = "reasoning_effort"
)

// ModelInfoFieldLabels is the canonical Chinese label for every unified
// model-info field. All surfaces (rule table, sync dialog, model info
// editor) share these strings so the vocabulary stays consistent.
var ModelInfoFieldLabels = map[string]string{
	ModelInfoFieldMaxContext:      "最大上下文",
	ModelInfoFieldMaxOutputToken:  "最大输出token",
	ModelInfoFieldInputTypes:      "支持的输入类型",
	ModelInfoFieldThinkingLevels:  "支持的思考程度",
	ModelInfoFieldReasoningEffort: "思考档位",
}

// AgentTypeRule — an agent software type (e.g. "opencode") that owns
// config files managed through the dashboard ("管理规则"). The seeded
// default rows let the frontend dropdown work on a fresh database.
//
// Customized marks whether the user has saved this rule with content that
// differs from its default template. Untouched rows (Customized=false)
// fully follow the default template on every startup — template changes
// (added *and* removed fields) propagate; once customized, the user's
// version always wins and the seed never touches the row again. Saving
// content that is again identical to the default clears the flag.
type AgentTypeRule struct {
	ID              string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name            string    `gorm:"uniqueIndex;not null" json:"name"`
	OsPaths         string    `gorm:"type:text" json:"-"` // JSON blob of AgentOsPaths
	JsonPaths       string    `gorm:"type:text" json:"-"` // JSON blob of AgentJsonPaths
	Recommendations string    `gorm:"type:text" json:"-"` // JSON blob of []AgentRecommendation
	Protocols       string    `gorm:"type:text" json:"-"` // JSON blob of []AgentProtocol
	ModelInfoFields string    `gorm:"type:text" json:"-"` // JSON blob of AgentModelInfoFieldPaths
	ConfigJsonc     string    `gorm:"type:text" json:"-"` // 原始 JSONC（含注释）
	Customized      bool      `gorm:"not null;default:false" json:"customized"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// AgentRuleConfigJsonc is the JSONC document shape users edit directly
// in the rule dialog. Common holds the SDK-independent fields; Protocols
// holds per-SDK blocks (each with its own field list + endpoint tags).
type AgentRuleConfigJsonc struct {
	Common    []AgentRecommendation `json:"common"`
	Protocols []AgentProtocolJsonc  `json:"protocols"`
}

// AgentProtocolJsonc is the JSONC representation of a protocol block.
// It matches AgentProtocol except the SDK-specific field list uses the
// friendlier "fields" key instead of "recommendations".
type AgentProtocolJsonc struct {
	Name         string                   `json:"name"`
	Conditions   []AgentProtocolCondition `json:"conditions"`
	EndpointTags []string                 `json:"endpoint_tags"`
	Fields       []AgentRecommendation    `json:"fields"`
}

// MarshalJSON embeds os_paths, json_paths, recommendations, protocols,
// model_info_fields and config_jsonc as parsed values so the frontend
// can read them without re-parsing the blobs.
func (r AgentTypeRule) MarshalJSON() ([]byte, error) {
	type alias AgentTypeRule
	p, _ := r.GetOsPaths()
	j, _ := r.GetJsonPaths()
	recs, _ := r.GetRecommendations()
	protocols, _ := r.GetProtocols()
	mif, _ := r.GetModelInfoFields()
	jsonc, _ := r.GetConfigJsonc()
	return json.Marshal(struct {
		alias
		OsPaths         AgentOsPaths             `json:"os_paths"`
		JsonPaths       AgentJsonPaths           `json:"json_paths"`
		Recommendations []AgentRecommendation    `json:"recommendations"`
		Protocols       []AgentProtocol          `json:"protocols"`
		ModelInfoFields AgentModelInfoFieldPaths `json:"model_info_fields"`
		ConfigJsonc     string                   `json:"config_jsonc"`
	}{alias: alias(r), OsPaths: p, JsonPaths: j, Recommendations: recs, Protocols: protocols, ModelInfoFields: mif, ConfigJsonc: jsonc})
}

// GetOsPaths parses the stored JSON blob back into a struct. An empty blob
// yields a zero-valued struct so callers can default it.
func (r *AgentTypeRule) GetOsPaths() (AgentOsPaths, error) {
	var p AgentOsPaths
	if r.OsPaths == "" {
		return p, nil
	}
	return p, json.Unmarshal([]byte(r.OsPaths), &p)
}

// SetOsPaths serializes the per-OS paths into the JSON blob persisted on
// the rule row.
func (r *AgentTypeRule) SetOsPaths(p AgentOsPaths) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	r.OsPaths = string(data)
	return nil
}

// GetJsonPaths parses the stored JSON blob back into a struct. An empty
// blob yields a zero-valued struct so callers can default it.
func (r *AgentTypeRule) GetJsonPaths() (AgentJsonPaths, error) {
	var p AgentJsonPaths
	if r.JsonPaths == "" {
		return p, nil
	}
	return p, json.Unmarshal([]byte(r.JsonPaths), &p)
}

// SetJsonPaths serializes the gjson path pair into the JSON blob persisted
// on the rule row.
func (r *AgentTypeRule) SetJsonPaths(p AgentJsonPaths) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	r.JsonPaths = string(data)
	return nil
}

// GetRecommendations parses the stored JSON blob back into a slice. An
// empty blob yields a nil slice so callers can default it.
func (r *AgentTypeRule) GetRecommendations() ([]AgentRecommendation, error) {
	if r.Recommendations == "" {
		return nil, nil
	}
	var out []AgentRecommendation
	if err := json.Unmarshal([]byte(r.Recommendations), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// SetRecommendations serializes the structured schema into the JSON
// blob persisted on the rule row.
func (r *AgentTypeRule) SetRecommendations(recs []AgentRecommendation) error {
	if recs == nil {
		r.Recommendations = ""
		return nil
	}
	data, err := json.Marshal(recs)
	if err != nil {
		return err
	}
	r.Recommendations = string(data)
	return nil
}

// GetProtocols parses the stored JSON blob back into a slice of
// request-protocol blocks. An empty blob yields a nil slice.
func (r *AgentTypeRule) GetProtocols() ([]AgentProtocol, error) {
	if r.Protocols == "" {
		return nil, nil
	}
	var out []AgentProtocol
	if err := json.Unmarshal([]byte(r.Protocols), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// SetProtocols serializes the request-protocol blocks into the JSON
// blob persisted on the rule row.
func (r *AgentTypeRule) SetProtocols(protocols []AgentProtocol) error {
	if protocols == nil {
		r.Protocols = ""
		return nil
	}
	data, err := json.Marshal(protocols)
	if err != nil {
		return err
	}
	r.Protocols = string(data)
	return nil
}

// SetConfigJsonc persists the raw JSONC text verbatim (comments and
// whitespace preserved) so the rule dialog round-trips user edits.
func (r *AgentTypeRule) SetConfigJsonc(text string) {
	r.ConfigJsonc = text
}

// GetConfigJsonc returns the stored JSONC text. When a legacy/seed row
// predates the JSONC column, it builds the document from the derived
// recommendations + protocols and returns pretty JSON without comments.
func (r *AgentTypeRule) GetConfigJsonc() (string, error) {
	if r.ConfigJsonc != "" {
		return r.ConfigJsonc, nil
	}
	recs, err := r.GetRecommendations()
	if err != nil {
		return "", err
	}
	protocols, err := r.GetProtocols()
	if err != nil {
		return "", err
	}
	return BuildRuleConfigJsonc(recs, protocols)
}

// BuildRuleConfigJsonc marshals a rule's recommendations + protocols
// into the {common, protocols} JSONC document pretty-printed with two
// spaces, with a trailing newline.
func BuildRuleConfigJsonc(recs []AgentRecommendation, protocols []AgentProtocol) (string, error) {
	common := make([]AgentRecommendation, 0, len(recs))
	common = append(common, recs...)
	protocolJsonc := make([]AgentProtocolJsonc, 0, len(protocols))
	for _, p := range protocols {
		protocolJsonc = append(protocolJsonc, AgentProtocolJsonc{
			Name: p.Name, Conditions: p.Conditions, EndpointTags: p.EndpointTags, Fields: p.Recommendations,
		})
	}
	doc := AgentRuleConfigJsonc{Common: common, Protocols: protocolJsonc}
	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out) + "\n", nil
}

// ParseRuleConfigJsonc parses a JSONC document (comments already
// stripped by the caller) back into its recommendations + protocols.
func ParseRuleConfigJsonc(data []byte) ([]AgentRecommendation, []AgentProtocol, error) {
	var doc AgentRuleConfigJsonc
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, nil, err
	}
	common := make([]AgentRecommendation, 0, len(doc.Common))
	common = append(common, doc.Common...)
	protocols := make([]AgentProtocol, 0, len(doc.Protocols))
	for _, p := range doc.Protocols {
		recs := make([]AgentRecommendation, 0, len(p.Fields))
		recs = append(recs, p.Fields...)
		protocols = append(protocols, AgentProtocol{
			Name: p.Name, Conditions: p.Conditions, EndpointTags: p.EndpointTags, Recommendations: recs,
		})
	}
	return common, protocols, nil
}

// GetModelInfoFields parses the stored JSON blob back into the unified
// model-info field path struct. Empty blob yields zero values.
func (r *AgentTypeRule) GetModelInfoFields() (AgentModelInfoFieldPaths, error) {
	var p AgentModelInfoFieldPaths
	if r.ModelInfoFields == "" {
		return p, nil
	}
	return p, json.Unmarshal([]byte(r.ModelInfoFields), &p)
}

// SetModelInfoFields serializes the shared model-info field paths into
// the JSON blob persisted on the rule row.
func (r *AgentTypeRule) SetModelInfoFields(p AgentModelInfoFieldPaths) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	r.ModelInfoFields = string(data)
	return nil
}

// SetModelInfoFieldsOrZero updates the persisted blob only when the
// caller supplied a value; nil leaves the existing paths untouched so a
// PUT that omits the field doesn't wipe user edits.
func (r *AgentTypeRule) SetModelInfoFieldsOrZero(p *AgentModelInfoFieldPaths) error {
	if p == nil {
		return nil
	}
	return r.SetModelInfoFields(*p)
}

func (r *AgentTypeRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// AgentConfigFile — a "接管配置文件" record binding an agent type to a
// config file (local path or SSH remote). Content is a local cache only
// (json:"-") so list payloads never carry it; read it through the
// GET/PUT /:id/content endpoints, which always re-read the live file.
// SshConfig is a JSON blob string (service.SshConfig), matching how
// other JSON blobs (e.g. Provider.Models) are stored.
type AgentConfigFile struct {
	ID         string    `gorm:"primaryKey;type:uuid" json:"id"`
	RecordName string    `gorm:"uniqueIndex;not null" json:"record_name"`
	AgentType  string    `gorm:"not null" json:"agent_type"`
	Mode       string    `gorm:"not null" json:"mode"` // "local" | "ssh"
	TargetOS   string    `gorm:"not null;default:''" json:"target_os"`
	Path       string    `gorm:"not null" json:"path"`
	SshConfig  string    `gorm:"type:text" json:"ssh_config"` // JSON blob of service.SshConfig
	Content    string    `gorm:"type:text" json:"-"`          // local content cache, never serialized
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (f *AgentConfigFile) BeforeCreate(tx *gorm.DB) error {
	if f.ID == "" {
		f.ID = uuid.New().String()
	}
	return nil
}

// builtinAgentRules are the agent types seeded into agent_type_rules when
// the table is empty. Operators can rename or edit them later; seeding
// only fills os_paths, json_paths, recommendations, and model_info_fields
// for rows that lack them, so user edits are never lost.
var builtinAgentRules = []struct {
	Name            string
	OsPaths         AgentOsPaths
	JsonPaths       AgentJsonPaths
	Recommendations []AgentRecommendation
	ModelInfoFields AgentModelInfoFieldPaths
	Protocols       []AgentProtocol
}{
	{
		Name: "opencode",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.config\opencode\opencode.json`,
			Mac:     `~/.config/opencode/opencode.json`,
		},
		JsonPaths: AgentJsonPaths{
			Provider: `provider`,
			Model:    `provider.{provider_id}.models`,
			// opencode 的 models 是 { model_id: cfg } 对象 map。
			ModelsContainer: "object",
		},
		Recommendations: opencodeRecommendations,
		ModelInfoFields: AgentModelInfoFieldPaths{
			MaxContext:     ModelInfoPath(`limit.context`),
			MaxOutputToken: ModelInfoPath(`limit.output`),
			InputTypes:     ModelInfoPath(`modalities.input`),
			// opencode 的 reasoning 字段要求 boolean，而统一值是思考档位数组。
			ThinkingLevels: ModelInfoOp(`reasoning`, "bool"),
			// opencode（OpenAI 系模型）的思考档位写在 options.reasoningEffort；
			// 默认「不填」（action skip）：models.dev 只有 reasoning 布尔，推导
			// 档位恒为 high，且 Anthropic 系端点不认 reasoningEffort（那是
			// options.thinking 的形状），是否写入由运营者按端点自行开启。
			ReasoningEffort: AgentModelInfoFieldSpec{
				Path: `variants`,
				Op:   "variants",
				// 允许值 = opencode 支持的档位全集（无默认档位）；写值时取
				// models.dev 枚举 ∩ 允许值的交集，op=variants 把每个允许档位
				// 写成 {"options":{"reasoningEffort":档位}} 预设（opencode 的
				// 多档位表达结构）。模型无 effort 枚举时不写。
				Values: []string{"none", "minimal", "low", "medium", "high", "xhigh"},
			},
		},
		// npm（AI SDK 适配器包）由 endpoint 关键词自动归类：endpoint 是子串
		// 包含任一关键词即命中该协议，从而拿到对应的 npm 推荐值。顺序即
		// 优先级 —— 关键词越具体越靠前，避免误命中。
		Protocols: opencodeProtocols,
	},
	{
		Name: "WorkBuddy",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.workbuddy\models.json`,
			Mac:     `~/.workbuddy/models.json`,
		},
		// WorkBuddy（腾讯 / CodeBuddy）官方 models.json：平铺的 models 数组，
		// 每项一个模型，字段 id/name/vendor/apiKey/maxInputTokens/maxOutputTokens/
		// url/supportsToolCall/supportsImages/supportsReasoning；url 必须是完整
		// 路径且一般以 /chat/completions 结尾。可选顶层 availableModels 控制
		// 下拉列表。现有引擎按「provider 对象 + models 子树」设计，平铺数组
		// 不直接适配，json_paths 留空，仅保留官方字段参考。
		JsonPaths:       AgentJsonPaths{},
		Recommendations: workBuddyRecommendations,
		ModelInfoFields: AgentModelInfoFieldPaths{
			// models[] 单项直接就是模型配置：四个字段写在该模型对象里。
			MaxContext:     ModelInfoPath(`maxInputTokens`),
			MaxOutputToken: ModelInfoPath(`maxOutputTokens`),
			// 输入类型：WorkBuddy 用布尔 supportsImages，不是数组。
			InputTypes:     ModelInfoOp(`supportsImages`, "bool"),
			ThinkingLevels: ModelInfoOp(`supportsReasoning`, "bool"),
		},
	},
	{
		Name: "ChatGPT",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.codex\config.toml`,
			Mac:     `~/.codex/config.toml`,
		},
		// Codex 配置是 TOML（config.toml），自定义模型走 [model_providers.<id>]
		// 表：base_url / env_key / wire_api / name / 重试与流式超时等。
		// 现有接管引擎只读写 JSON/JSONC，TOML 暂不自动生成 provider 块，
		// 因此 json_paths 留空；这里仅按官方 config 文档列出完整字段参考，
		// 标注「推荐时不干预」的字段表示官方有默认、不必写。
		JsonPaths:       AgentJsonPaths{},
		Recommendations: codexRecommendations,
		// Codex 的 provider-model 无独立的 context/output 字段（模型参数由
		// reasoning_effort 等控制），四个统一模型信息字段不适用。
		ModelInfoFields: AgentModelInfoFieldPaths{},
	},
	{
		Name: "openclaw",
		OsPaths: AgentOsPaths{
			Windows: `%USERPROFILE%\.openclaw\openclaw.json`,
			Mac:     `~/.openclaw/openclaw.json`,
		},
		JsonPaths: AgentJsonPaths{
			Provider: `models.providers`,
			Model:    `models.providers.{provider_id}.models`,
			// openclaw 的 models 是 [{ id, ...cfg }] 数组。
			ModelsContainer: "array",
		},
		Recommendations: openclawRecommendations,
		// openclaw 的 provider `api` 字段（协议类型：openai-completions /
		// anthropic-messages / ollama / lmstudio）是驱动字段，跟 opencode 的
		// npm 一样必须由 endpoint 关键词自动归类 —— 同一个托管 provider 下
		// 不同 endpoint 分组（如 /v1/messages 与 /v1/chat/completions）走不同
		// 的 SDK，不能全默认 openai-completions。顺序即优先级。
		Protocols: openclawProtocols,
		ModelInfoFields: AgentModelInfoFieldPaths{
			MaxContext:     ModelInfoPath(`contextWindow`),
			MaxOutputToken: ModelInfoPath(`maxTokens`),
			// openclaw 的 input 数组只接受 text/image/video/audio，
			// models.dev 可能带回 pdf 等非法值，写前过滤。
			InputTypes: AgentModelInfoFieldSpec{Path: `input`, Values: []string{"text", "image", "video", "audio"}},
			// openclaw 的 reasoning 字段同样要求 boolean。
			ThinkingLevels: ModelInfoOp(`reasoning`, "bool"),
		},
	},
}

// AgentTemplateConfig is the on-disk representation of one agent's default
// recommendation template. Each built-in agent has a JSON file under
// config/agent-templates/<name>.json; operators edit those files to tune the
// defaults without touching Go code. The rule dialog shows a
// 「使用默认推荐模版」 button when a same-named template file exists.
type AgentTemplateConfig struct {
	Name            string                   `json:"name"`
	OsPaths         AgentOsPaths             `json:"os_paths"`
	JsonPaths       AgentJsonPaths           `json:"json_paths"`
	Recommendations []AgentRecommendation    `json:"recommendations"`
	Protocols       []AgentProtocol          `json:"protocols"`
	ModelInfoFields AgentModelInfoFieldPaths `json:"model_info_fields"`
}

// AgentTemplateDir is the directory (relative to backend cwd) where default
// agent recommendation templates live. A missing file for a name falls back
// to the built-in Go templates, so existing deployments keep working.
const AgentTemplateDir = "config/agent-templates"

// LoadAgentTemplate loads a single agent's default template from
// config/agent-templates/<name>.json. When the file is missing or unreadable,
// it falls back to the built-in Go template with that name. ok is false when
// neither source provides the agent.
func LoadAgentTemplate(name string) (AgentTemplateConfig, bool) {
	if tmpl, ok := loadAgentTemplateFile(name); ok {
		return tmpl, true
	}
	for _, b := range builtinAgentRules {
		if b.Name == name {
			return AgentTemplateConfig{
				Name:            b.Name,
				OsPaths:         b.OsPaths,
				JsonPaths:       b.JsonPaths,
				Recommendations: b.Recommendations,
				Protocols:       b.Protocols,
				ModelInfoFields: b.ModelInfoFields,
			}, true
		}
	}
	return AgentTemplateConfig{}, false
}

// HasAgentTemplate reports whether a default recommendation template exists
// for the agent (either a JSON file or a built-in Go source).
func HasAgentTemplate(name string) bool {
	_, ok := LoadAgentTemplate(name)
	return ok
}

func loadAgentTemplateFile(name string) (AgentTemplateConfig, bool) {
	var tmpl AgentTemplateConfig
	data, err := os.ReadFile(filepath.Join(AgentTemplateDir, name+".json"))
	if err != nil {
		return tmpl, false
	}
	if err := json.Unmarshal(data, &tmpl); err != nil {
		return tmpl, false
	}
	return tmpl, true
}

// ListBuiltinTemplates returns every built-in agent's default template as
// AgentTemplateConfig, used to (re)generate config/agent-templates/*.json.
func ListBuiltinTemplates() []AgentTemplateConfig {
	out := make([]AgentTemplateConfig, 0, len(builtinAgentRules))
	for _, b := range builtinAgentRules {
		out = append(out, AgentTemplateConfig{
			Name:            b.Name,
			OsPaths:         b.OsPaths,
			JsonPaths:       b.JsonPaths,
			Recommendations: b.Recommendations,
			Protocols:       b.Protocols,
			ModelInfoFields: b.ModelInfoFields,
		})
	}
	return out
}

// opencodeRecommendations are the recommended provider/model fields for
// opencode. Each entry is checked against the live config in the
// "管理模型" view and surfaced as a missing / mismatch / extra marker.
// Clicking "一键套用推荐值" writes the Recommended value into the file.
// 只保留：缺了就跑不起来的必填字段、模型输入格式字段（图片/视频/文字）
// 与缓存优化字段；其余可选调优项不做推荐。
var opencodeRecommendations = []AgentRecommendation{
	{Scope: "provider", Key: "name", Description: "在 opencode 界面里的显示名（provider 名称）", Required: true},
	{Scope: "provider", Key: "npm", Description: "AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类", Required: true},
	{Scope: "provider", Key: "options.baseURL", Description: "API 端点（不填则走适配器默认）", Required: true},
	{Scope: "provider", Key: "options.apiKey", Description: "认证密钥", Required: true},
	{Scope: "provider", Key: "options.setCacheKey", Description: "启用 promptCacheKey 缓存优化（官方默认 false，建议开启）", Recommended: true},
	{Scope: "model", Key: "name", Description: "模型在界面里的显示名"},
	{Scope: "model", Key: "limit.context", Description: "上下文 token 上限"},
	{Scope: "model", Key: "reasoning", Description: "模型是否支持思考模式（思考程度统一值→bool）"},
	{Scope: "model", Key: "tool_call", Description: "模型是否支持工具调用"},
	{Scope: "model", Key: "attachment", Description: "模型是否支持文件/图片附件输入（输入格式）"},
}

// opencodeProtocols 按 endpoint 关键词把规范化 provider 归入对应的 AI SDK。
// 匹配为子串包含：endpoint 里含任一关键词即命中该协议的 npm 推荐值。
// 顺序即优先级 —— 具体关键词放前面避免误命中。
var opencodeProtocols = []AgentProtocol{
	{
		Name:         "OpenAI Responses API",
		EndpointTags: []string{"responses"},
		Recommendations: []AgentRecommendation{
			{Scope: "provider", Key: "npm", Description: "Responses API 使用 OpenAI SDK", Recommended: "@ai-sdk/openai"},
		},
	},
	{
		Name:         "Anthropic Messages API",
		EndpointTags: []string{"chat/message", "/v1/message", "messages"},
		Recommendations: []AgentRecommendation{
			{Scope: "provider", Key: "npm", Description: "Messages API 使用 Anthropic SDK", Recommended: "@ai-sdk/anthropic"},
			// Anthropic Messages API 官方要求每次请求带 max_tokens，对应
			// opencode 的模型 limit.output —— anthropic-messages 协议下必填。
			{Scope: "model", Key: "limit.output", Description: "输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）", Required: true},
		},
	},
	{
		Name:         "OpenAI 兼容 Chat Completions",
		EndpointTags: []string{"completions", "chat/comple", "/v1/chat"},
		Recommendations: []AgentRecommendation{
			{Scope: "provider", Key: "npm", Description: "Chat Completions API 使用 OpenAI 兼容 SDK", Recommended: "@ai-sdk/openai-compatible"},
		},
	},
}

// codexRecommendations 对齐 OpenAI Codex 官方 config.toml 参考
// （developers.openai.com/codex/config-file/config-reference 与
// config-sample）。自定义模型写 [model_providers.<id>] 表，字段类型走 TOML
// 而非 JSON —— 但字段名与官方一致。只保留缺了就跑不起来的必填字段，
// 其余官方有默认的调优项不做推荐。
var codexRecommendations = []AgentRecommendation{
	{Scope: "provider", Key: "model_provider", Description: "顶层默认 provider id，取自 [model_providers] 的键（官方默认 openai）", Required: true},
	{Scope: "provider", Key: "name", Description: "自定义 provider 的显示名"},
	{Scope: "provider", Key: "base_url", Description: "该 provider 的 API base URL（如 https://api.example.com/v1）", Required: true},
	// 2026.02 起 Codex 强制 responses（Responses API），不再支持 Chat Completions；
	// 网关必须原生支持 Responses API，这里给出唯一可用的取值。
	{Scope: "provider", Key: "wire_api", Description: "接口协议（2026.02 起 Codex 强制 responses，不再支持 Chat Completions）", Recommended: "responses"},
	{Scope: "provider", Key: "env_key", Description: "提供 API key 的环境变量名（官方推荐用环境变量，不写明文 key）"},
}

// workBuddyRecommendations 对齐 WorkBuddy/CodeBuddy 官方 models.json 指南
// （腾讯云文档：「models.json 配置指南」）。官方要求：url 必填且必须是完整
// 接口路径、一般以 /chat/completions 结尾；仅支持 OpenAI 接口格式。只保留
// 缺了就跑不起来的必填字段与模型能力/输入格式字段，其余选填不做推荐。
var workBuddyRecommendations = []AgentRecommendation{
	{Scope: "model", Key: "id", Description: "模型唯一标识（官方必填）", Required: true},
	{Scope: "model", Key: "name", Description: "模型显示名称"},
	// apiKey 官方标非必填（覆盖内置模型时可不填），但自定义模型缺它连不上；
	// 这里标必填以与 opencode/openclaw 的 apiKey 口径一致。注意 WorkBuddy 是
	// 平铺 models 结构（json_paths 为空），apiKeyFieldFor 只扫描 provider 级
	// 推荐，因此该标记当前只作文档/字段追踪，不参与托管生成。
	{Scope: "model", Key: "apiKey", Description: "认证密钥（实际密钥值，非环境变量名；Ollama 本地填占位符 ollama）", Required: true},
	{Scope: "model", Key: "url", Description: "API 端点，必须是完整路径且一般以 /chat/completions 结尾", Required: true},
	{Scope: "model", Key: "maxInputTokens", Description: "最大输入 token 数"},
	{Scope: "model", Key: "maxOutputTokens", Description: "最大输出 token 数"},
	{Scope: "model", Key: "supportsToolCall", Description: "是否支持工具调用"},
	{Scope: "model", Key: "supportsImages", Description: "是否支持图片输入（图片/视频等输入格式）"},
	{Scope: "model", Key: "supportsReasoning", Description: "是否支持推理模式"},
}

// openclawRecommendations 对齐 OpenClaw 官方 openclaw.json：models.providers
// 下每个 provider 的 baseUrl / apiKey / api（协议类型），models[] 每个模型的
// id / name / 上下文与输出 / input / reasoning（官方字段）。provider 级
// model 字段（如 contextWindow、maxTokens）由 models.dev 同步填充。只保留
// 缺了就跑不起来的必填字段与输入格式字段（input 收 text/image/video/audio）。
var openclawRecommendations = []AgentRecommendation{
	{Scope: "provider", Key: "baseUrl", Description: "服务商 API 端点（按官方格式，注意不要多写不该有的 /v1）", Required: true},
	{Scope: "provider", Key: "apiKey", Description: "认证密钥", Required: true},
	// api 是协议/SDK 驱动字段，由 endpoint 关键词自动归类（见 openclawProtocols）；
	// common 里只保留字段本身做驱动识别，不给推荐值，避免管理模型把
	// anthropic-messages 端点误判成 openai-completions。
	{Scope: "provider", Key: "api", Description: "接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类"},
	{Scope: "model", Key: "id", Description: "模型唯一标识", Required: true},
	{Scope: "model", Key: "name", Description: "模型显示名"},
	{Scope: "model", Key: "contextWindow", Description: "上下文 token 上限"},
	{Scope: "model", Key: "input", Description: "支持的输入类型（text/image/video/audio）"},
	{Scope: "model", Key: "reasoning", Description: "是否支持思考模式（官方 schema 校验，未配按 false 处理）"},
}

// openclawProtocols 按 endpoint 关键词把规范化 provider 归入对应的
// openclaw `api`（协议/SDK）类型。匹配为子串包含：endpoint 里含任一关键词
// 即命中该协议的 api 推荐值。顺序即优先级 —— 具体关键词放前面避免误命中。
// anthropic-messages 协议下模型必须有 maxTokens（Anthropic API 官方要求每次
// 请求都带 max_tokens），故该协议的 model 级推荐把 maxTokens 声明为必填。
var openclawProtocols = []AgentProtocol{
	{
		Name:         "Anthropic Messages API",
		EndpointTags: []string{"chat/message", "/v1/message", "messages"},
		Recommendations: []AgentRecommendation{
			{Scope: "provider", Key: "api", Description: "Messages API 使用 anthropic-messages 协议", Recommended: "anthropic-messages"},
			{Scope: "model", Key: "maxTokens", Description: "输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）", Required: true},
		},
	},
	{
		Name:         "OpenAI 兼容 Chat Completions",
		EndpointTags: []string{"completions", "chat/comple", "/v1/chat"},
		Recommendations: []AgentRecommendation{
			{Scope: "provider", Key: "api", Description: "Chat Completions API 使用 openai-completions 协议", Recommended: "openai-completions"},
		},
	},
	{
		Name:         "Ollama",
		EndpointTags: []string{"ollama"},
		Recommendations: []AgentRecommendation{
			{Scope: "provider", Key: "api", Description: "Ollama 本地推理使用 ollama 协议", Recommended: "ollama"},
		},
	},
	{
		Name:         "LM Studio",
		EndpointTags: []string{"lmstudio"},
		Recommendations: []AgentRecommendation{
			{Scope: "provider", Key: "api", Description: "LM Studio 本地推理使用 lmstudio 协议", Recommended: "lmstudio"},
		},
	},
}

// AgentModelConfigSource — persisted 模型配置参考供应商 selection for one
// config-file provider model. Mode is "none" (不同步), "self" (a models.dev
// supplier picked directly) or "link" (follow the same-named model's
// reference on one of our providers). Only the reference is stored, never a
// resolved result: every sync-dialog open re-resolves from models.dev and
// our provider table, and a link whose target provider/model evaporated
// shows 同步的供应商信息丢失 with no storage change.
type AgentModelConfigSource struct {
	AgentConfigFileID string    `gorm:"primaryKey" json:"-"`
	ProviderID        string    `gorm:"primaryKey" json:"-"`
	ModelID           string    `gorm:"primaryKey" json:"-"`
	Mode              string    `gorm:"not null;default:'none'" json:"mode"`
	SelfSupplier      string    `gorm:"type:text" json:"self_supplier"`    // models.dev supplier name in "self" mode
	LinkProviderID    string    `gorm:"type:text" json:"link_provider_id"` // our provider bound in "link" mode
	UpdatedAt         time.Time `json:"updated_at"`
}

// ManagedAgentGroup — one endpoint group of a managed provider. The
// endpoint string is the group's identity: identical system-provider
// endpoints are merged into one group, its Suffix names the agent-config
// provider block (root name + suffix), and ModelSources remembers which
// models.dev reference supplier ("", none) the user picked for
// each model name so generation can fill the four unified fields.
type ManagedAgentGroup struct {
	Endpoint     string            `json:"endpoint"`
	Suffix       string            `json:"suffix"`
	ModelSources map[string]string `json:"model_sources"`
	// ProviderIDs holds the system Provider ids backing this group. It is
	// only populated for the 未配置 endpoint group (providers with no
	// endpoints), whose members cannot be derived by matching the hand-typed
	// endpoint against any provider's endpoint list.
	ProviderIDs []string `json:"provider_ids,omitempty"`
}

// ManagedAgentProvider — a "托管 provider" bound to one agent config
// file (接管配置文件). It links system Provider rows (模型管理菜单) and
// groups their endpoints into per-endpoint agent provider blocks. The
// blocks themselves are generated from the agent-type rule's common +
// matched-protocol recommendations and the chosen model-info sources,
// so they are read-only in the 管理模型 view — users can only toggle
// between the generated views, never edit or "使用推荐值" them.
type ManagedAgentProvider struct {
	ID                string `gorm:"primaryKey;type:uuid" json:"id"`
	AgentConfigFileID string `gorm:"not null;index" json:"agent_config_file_id"`
	Name              string `gorm:"not null" json:"name"` // 根名，例如 HAPIY
	ProviderIDs       string `gorm:"type:text" json:"-"`   // JSON array of system Provider ids
	Groups            string `gorm:"type:text" json:"-"`   // JSON blob of []ManagedAgentGroup
	// APIKey is the 令牌 (downstream relay token) key the agent uses to
	// authenticate against the hapiy relay; chosen in the 托管 dialog.
	// Empty falls back to the first linked provider's key (legacy rows).
	APIKey string `gorm:"type:text" json:"api_key"`
	// BaseURL overrides the system base URL prefix when non-empty; empty
	// lets generation derive it from the current request + base_url_suffix
	// setting (BaseURL settings page logic).
	BaseURL string `gorm:"type:text" json:"base_url"`
	// SourceName, when non-empty, appends the `__来源` segment after the
	// base URL (BaseURL settings page 标记来源 logic); empty = no mark.
	SourceName string `gorm:"type:text" json:"source_name"`
	// SyncedBlocks records the provider block names written into the
	// config file by the last successful sync（根名 + 各分组后缀）。下次
	// 同步时，已不属于当前名字/分组的旧块（改名、删除分组）会被从文件
	// 里删掉，避免残留在普通供应商列表中。
	SyncedBlocks string    `gorm:"type:text" json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (m *ManagedAgentProvider) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.New().String()
	}
	return nil
}

// GetProviderIDs parses the stored JSON blob back into a slice. An
// empty blob yields a nil slice.
func (m *ManagedAgentProvider) GetProviderIDs() ([]string, error) {
	if m.ProviderIDs == "" {
		return nil, nil
	}
	var out []string
	if err := json.Unmarshal([]byte(m.ProviderIDs), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetSyncedBlocks parses the block names written by the last sync. An
// empty blob yields nil.
func (m *ManagedAgentProvider) GetSyncedBlocks() ([]string, error) {
	if m.SyncedBlocks == "" {
		return nil, nil
	}
	var out []string
	if err := json.Unmarshal([]byte(m.SyncedBlocks), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// SetProviderIDs serializes the linked system provider ids into the
// JSON blob persisted on the row.
func (m *ManagedAgentProvider) SetProviderIDs(ids []string) error {
	if ids == nil {
		m.ProviderIDs = ""
		return nil
	}
	data, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	m.ProviderIDs = string(data)
	return nil
}

// GetGroups parses the stored JSON blob back into a slice of endpoint
// groups. An empty blob yields a nil slice.
func (m *ManagedAgentProvider) GetGroups() ([]ManagedAgentGroup, error) {
	if m.Groups == "" {
		return nil, nil
	}
	var out []ManagedAgentGroup
	if err := json.Unmarshal([]byte(m.Groups), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// SetGroups serializes the endpoint groups into the JSON blob persisted
// on the row.
func (m *ManagedAgentProvider) SetGroups(groups []ManagedAgentGroup) error {
	if groups == nil {
		m.Groups = ""
		return nil
	}
	data, err := json.Marshal(groups)
	if err != nil {
		return err
	}
	m.Groups = string(data)
	return nil
}

// EnsureDefaultAgentTypes keeps the built-in agent rules in step with
// their default templates. Called right after AutoMigrate on startup:
//
//   - missing rows are created straight from the default template;
//   - rows the user never customized (Customized=false) fully follow the
//     default template on every startup — fields added *or* removed by a
//     template change propagate;
//   - customized rows are never touched: the user's version wins.
//
// The default template is the same source the 「使用默认推荐模版」 button
// uses: config/agent-templates/<name>.json when present, else the Go
// built-in (LoadAgentTemplate).
func EnsureDefaultAgentTypes(db *gorm.DB) error {
	for _, builtin := range builtinAgentRules {
		tmpl, ok := LoadAgentTemplate(builtin.Name)
		if !ok {
			continue
		}
		var rule AgentTypeRule
		err := db.Where("name = ?", builtin.Name).First(&rule).Error
		switch {
		case err == nil:
			if rule.Customized || rule.MatchesTemplate(tmpl) {
				continue
			}
			if err := ApplyTemplateToRule(&rule, tmpl); err != nil {
				return err
			}
			if err := db.Model(&rule).Updates(map[string]any{
				"os_paths":          rule.OsPaths,
				"json_paths":        rule.JsonPaths,
				"recommendations":   rule.Recommendations,
				"protocols":         rule.Protocols,
				"config_jsonc":      rule.ConfigJsonc,
				"model_info_fields": rule.ModelInfoFields,
			}).Error; err != nil {
				return err
			}
		case err != gorm.ErrRecordNotFound:
			return err
		default:
			rule = AgentTypeRule{Name: builtin.Name}
			if err := ApplyTemplateToRule(&rule, tmpl); err != nil {
				return err
			}
			if err := db.Create(&rule).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// ApplyTemplateToRule overwrites the rule's editable content with the
// default template's (os/json paths, recommendations, protocols,
// model-info fields, and the JSONC rebuilt from them).
func ApplyTemplateToRule(r *AgentTypeRule, tmpl AgentTemplateConfig) error {
	if err := r.SetOsPaths(tmpl.OsPaths); err != nil {
		return err
	}
	if err := r.SetJsonPaths(tmpl.JsonPaths); err != nil {
		return err
	}
	if err := r.SetRecommendations(tmpl.Recommendations); err != nil {
		return err
	}
	if err := r.SetProtocols(tmpl.Protocols); err != nil {
		return err
	}
	if err := r.SetModelInfoFields(tmpl.ModelInfoFields); err != nil {
		return err
	}
	jsonc, err := BuildRuleConfigJsonc(tmpl.Recommendations, tmpl.Protocols)
	if err != nil {
		return err
	}
	r.ConfigJsonc = jsonc
	return nil
}

// MatchesTemplate reports whether the rule's editable content is
// semantically identical to the default template: os/json paths,
// recommendations, protocols, and the four model-info fields. The
// comparison is content-based (blobs are parsed and canonicalized), so
// formatting/comments/`[]`-vs-null never count as customization.
func (r *AgentTypeRule) MatchesTemplate(tmpl AgentTemplateConfig) bool {
	stored, ok := r.asTemplateSnapshot()
	if !ok {
		return false
	}
	return sameTemplateContent(stored, tmpl)
}

// asTemplateSnapshot parses the rule's blobs in the template's shape.
// ok=false when any blob fails to parse (treat the rule as customized so
// a corrupt row is never silently overwritten by the seed).
func (r *AgentTypeRule) asTemplateSnapshot() (AgentTemplateConfig, bool) {
	out := AgentTemplateConfig{Name: r.Name}
	osP, err := r.GetOsPaths()
	if err != nil {
		return out, false
	}
	out.OsPaths = osP
	jpaths, err := r.GetJsonPaths()
	if err != nil {
		return out, false
	}
	out.JsonPaths = jpaths
	recs, err := r.GetRecommendations()
	if err != nil {
		return out, false
	}
	normalizeRecs(recs)
	out.Recommendations = recs
	protos, err := r.GetProtocols()
	if err != nil {
		return out, false
	}
	normalizeProtocols(protos)
	out.Protocols = protos
	mif, err := r.GetModelInfoFields()
	if err != nil {
		return out, false
	}
	normalizeModelInfo(mif)
	out.ModelInfoFields = mif
	return out, true
}

// normalizeRecs/normalizeProtocols/normalizeModelInfo nil out empty
// slices so storage-shape differences (null vs []) never read as a
// user customization.
func normalizeRecs(recs []AgentRecommendation) {
	for i := range recs {
		if len(recs[i].Values) == 0 {
			recs[i].Values = nil
		}
	}
}

func normalizeProtocols(protos []AgentProtocol) {
	for i := range protos {
		if len(protos[i].Conditions) == 0 {
			protos[i].Conditions = nil
		}
		if len(protos[i].EndpointTags) == 0 {
			protos[i].EndpointTags = nil
		}
		if len(protos[i].Recommendations) == 0 {
			protos[i].Recommendations = nil
		}
		normalizeRecs(protos[i].Recommendations)
	}
}

func normalizeModelInfo(mif AgentModelInfoFieldPaths) {
	specs := []*AgentModelInfoFieldSpec{&mif.MaxContext, &mif.MaxOutputToken, &mif.InputTypes, &mif.ThinkingLevels, &mif.ReasoningEffort}
	for _, s := range specs {
		if len(s.Values) == 0 {
			s.Values = nil
		}
	}
}

// normalizeTemplateSnapshot applies the same empty-slice nil-ing to a
// template loaded from a file or the Go built-ins.
func normalizeTemplate(tmpl AgentTemplateConfig) AgentTemplateConfig {
	normalizeRecs(tmpl.Recommendations)
	normalizeProtocols(tmpl.Protocols)
	normalizeModelInfo(tmpl.ModelInfoFields)
	return tmpl
}

func sameJSON(a, b any) bool {
	ab, err1 := json.Marshal(a)
	bb, err2 := json.Marshal(b)
	if err1 != nil || err2 != nil {
		return false
	}
	return string(ab) == string(bb)
}

func sameTemplateContent(a, b AgentTemplateConfig) bool {
	return sameJSON(a.OsPaths, b.OsPaths) &&
		sameJSON(a.JsonPaths, b.JsonPaths) &&
		sameJSON(a.Recommendations, b.Recommendations) &&
		sameJSON(a.Protocols, b.Protocols) &&
		sameJSON(a.ModelInfoFields, b.ModelInfoFields)
}

// TemplateForRuleName returns the same-named default template (file
// first, built-in fallback), for callers deciding whether a save counts
// as a customization.
func TemplateForRuleName(name string) (AgentTemplateConfig, bool) {
	tmpl, ok := LoadAgentTemplate(name)
	if ok {
		tmpl = normalizeTemplate(tmpl)
	}
	return tmpl, ok
}

// DeduplicateAgentConfigRecordNames renames duplicate takeover records
// (kept the oldest, appending " (2)", " (3)" … to the rest) so the
// RecordName unique index added by AutoMigrate can be created on databases
// that already accumulated duplicates. Called from main before AutoMigrate.

func DeduplicateAgentConfigRecordNames(db *gorm.DB) error {
	if !db.Migrator().HasTable(&AgentConfigFile{}) {
		return nil
	}
	type dupGroup struct {
		RecordName string
		Count      int
	}
	var groups []dupGroup
	if err := db.Model(&AgentConfigFile{}).
		Select("record_name, COUNT(*) AS count").
		Group("record_name").
		Having("COUNT(*) > 1").
		Scan(&groups).Error; err != nil {
		return err
	}
	for _, g := range groups {
		var rows []AgentConfigFile
		if err := db.Where("record_name = ?", g.RecordName).
			Order("created_at ASC, id ASC").
			Find(&rows).Error; err != nil {
			return err
		}
		// Keep the oldest as-is, rename the rest with a numeric suffix.
		for i := 1; i < len(rows); i++ {
			var newName string
			for suffix := i + 1; ; suffix++ {
				candidate := fmt.Sprintf("%s (%d)", rows[i].RecordName, suffix)
				var count int64
				if err := db.Model(&AgentConfigFile{}).Where("record_name = ?", candidate).Count(&count).Error; err != nil {
					return err
				}
				if count == 0 {
					newName = candidate
					break
				}
			}
			if err := db.Model(&rows[i]).Update("record_name", newName).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
