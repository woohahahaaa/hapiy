package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// ── YAML config engine ──────────────────────────────────────────────
//
// YAML take-over files (DeepSeek Harness 的 cordis.patch.yml) are edited at
// the yaml.v3 node level so the rest of the document — comments included —
// survives every write. Paths use the same syntax the rules already carry
// for JSON (dot-separated segments with `{provider_id}` substituted by the
// caller), plus one extra segment the JSON side cannot express:
//
//	#(id=="llm-pi-ai")   find the sequence item whose `id` field matches
//
// which is also valid gjson, so a YAML file can be re-encoded as JSON and
// fed to the existing gjson-based readers unchanged (see configJSONView).

// yamlConfigEditor is the yaml.v3 node editor.
type yamlConfigEditor struct {
	doc *yamlDoc
}

func newYAMLConfigEditor(content string) (*yamlConfigEditor, error) {
	doc, err := parseYAMLDoc(content)
	if err != nil {
		return nil, err
	}
	return &yamlConfigEditor{doc: doc}, nil
}

func (e *yamlConfigEditor) Exists(path string) bool { return e.doc.get(path) != nil }

func (e *yamlConfigEditor) Set(path string, value any) error { return e.doc.set(path, value) }

func (e *yamlConfigEditor) Delete(path string) (bool, error) { return e.doc.remove(path) }

func (e *yamlConfigEditor) JSON() []byte {
	blob, err := json.Marshal(yamlNodeToAny(e.doc.root))
	if err != nil {
		return []byte("null")
	}
	return blob
}

func (e *yamlConfigEditor) Marshal() (string, error) { return e.doc.marshal() }

// yamlDoc wraps one parsed YAML document (a single-document file).
type yamlDoc struct {
	root *yaml.Node
}

func parseYAMLDoc(content string) (*yamlDoc, error) {
	doc := &yamlDoc{}
	if strings.TrimSpace(content) == "" {
		doc.root = &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		return doc, nil
	}
	var parsed yaml.Node
	if err := yaml.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, fmt.Errorf("YAML 解析失败: %w", err)
	}
	switch {
	case parsed.Kind == yaml.DocumentNode && len(parsed.Content) > 0:
		doc.root = parsed.Content[0]
	case parsed.Kind == yaml.DocumentNode:
		doc.root = &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
	default:
		doc.root = &parsed
	}
	if doc.root.Kind == 0 {
		doc.root.Kind = yaml.SequenceNode
		doc.root.Tag = "!!seq"
	}
	return doc, nil
}

func (d *yamlDoc) marshal() (string, error) {
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(d.root); err != nil {
		return "", err
	}
	if err := enc.Close(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// yamlToJSON re-encodes YAML content as JSON so the gjson readers
// (parseAgentModels / normalizeFileProvider / protocolMatchesProvider …)
// keep working on YAML files unchanged.
func yamlToJSON(content string) ([]byte, error) {
	doc, err := parseYAMLDoc(content)
	if err != nil {
		return nil, err
	}
	out, err := json.Marshal(yamlNodeToAny(doc.root))
	if err != nil {
		return nil, fmt.Errorf("YAML 转 JSON 失败: %w", err)
	}
	return out, nil
}

// ── path parsing ────────────────────────────────────────────────────

const (
	yamlSegKey = iota
	yamlSegIndex
	yamlSegQuery
)

type yamlPathSeg struct {
	kind       int
	key        string
	index      int
	queryField string
	queryValue string
}

var yamlQueryRe = regexp.MustCompile(`^#\(\s*([A-Za-z0-9_.\-]+)\s*==\s*"([^"]*)"\s*\)$`)

// splitConfigPath splits a rule path into segments. Dots separate segments
// unless escaped (`\.`) or inside a `#(...)` query; `{provider_id}` is
// substituted by the caller before this point.
func splitConfigPath(path string) ([]yamlPathSeg, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errEmptyPath
	}
	var raw []string
	var cur strings.Builder
	depth := 0
	for i := 0; i < len(path); i++ {
		c := path[i]
		switch {
		case c == '\\' && i+1 < len(path):
			cur.WriteByte(path[i+1])
			i++
		case c == '#' && i+1 < len(path) && path[i+1] == '(':
			depth++
			cur.WriteByte(c)
		case c == ')' && depth > 0:
			depth--
			cur.WriteByte(c)
		case c == '.' && depth == 0:
			raw = append(raw, cur.String())
			cur.Reset()
		default:
			cur.WriteByte(c)
		}
	}
	raw = append(raw, cur.String())

	segs := make([]yamlPathSeg, 0, len(raw))
	for _, s := range raw {
		if m := yamlQueryRe.FindStringSubmatch(s); m != nil {
			segs = append(segs, yamlPathSeg{kind: yamlSegQuery, queryField: m[1], queryValue: m[2]})
			continue
		}
		if n, err := strconv.Atoi(s); err == nil && n >= 0 {
			segs = append(segs, yamlPathSeg{kind: yamlSegIndex, index: n})
			continue
		}
		segs = append(segs, yamlPathSeg{kind: yamlSegKey, key: s})
	}
	return segs, nil
}

// ── node lookup ─────────────────────────────────────────────────────

func scalarNode(tag, value string) *yaml.Node {
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: tag, Value: value}
}

func nodeMappingIndex(m *yaml.Node, key string) int {
	if m == nil || m.Kind != yaml.MappingNode {
		return -1
	}
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return i
		}
	}
	return -1
}

func nodeMappingValue(m *yaml.Node, key string) *yaml.Node {
	idx := nodeMappingIndex(m, key)
	if idx < 0 {
		return nil
	}
	return m.Content[idx+1]
}

func nodeSequenceQueryItem(s *yaml.Node, field, value string) (*yaml.Node, int) {
	if s == nil || s.Kind != yaml.SequenceNode {
		return nil, -1
	}
	for i, item := range s.Content {
		if v := nodeMappingValue(item, field); v != nil && v.Value == value {
			return item, i
		}
	}
	return nil, -1
}

// nodeAt resolves a path read-only; nil when any segment is missing.
func (d *yamlDoc) nodeAt(segs []yamlPathSeg) *yaml.Node {
	node := d.root
	for _, seg := range segs {
		if node == nil {
			return nil
		}
		switch seg.kind {
		case yamlSegKey:
			node = nodeMappingValue(node, seg.key)
		case yamlSegIndex:
			if node.Kind != yaml.SequenceNode || seg.index >= len(node.Content) {
				return nil
			}
			node = node.Content[seg.index]
		case yamlSegQuery:
			node, _ = nodeSequenceQueryItem(node, seg.queryField, seg.queryValue)
		}
	}
	return node
}

func (d *yamlDoc) get(path string) *yaml.Node {
	segs, err := splitConfigPath(path)
	if err != nil {
		return nil
	}
	return d.nodeAt(segs)
}

// ── node edits ──────────────────────────────────────────────────────

// containerKindFor reports the node kind a segment needs from its parent:
// index/query segments iterate sequences, key segments index mappings.
func containerKindFor(seg yamlPathSeg) yaml.Kind {
	if seg.kind == yamlSegKey {
		return yaml.MappingNode
	}
	return yaml.SequenceNode
}

// ensureContainer converts an empty placeholder node in place, or returns
// it when it already has the wanted kind. Real (non-empty) nodes of another
// kind are an error, mirroring how sjson refuses to descend into scalars.
func ensureContainer(node *yaml.Node, kind yaml.Kind) error {
	if node == nil {
		return fmt.Errorf("内部错误：容器节点缺失")
	}
	if node.Kind == kind {
		return nil
	}
	empty := node.Kind == 0 || (node.Kind == yaml.ScalarNode && node.Value == "")
	if !empty {
		return fmt.Errorf("节点类型与路径不符（需要 %v）", kind)
	}
	node.Kind = kind
	if kind == yaml.MappingNode {
		node.Tag = "!!map"
	} else {
		node.Tag = "!!seq"
	}
	node.Value = ""
	node.Content = nil
	node.Style = 0
	return nil
}

// mergeNodeComments carries the replaced node's comments onto its successor.
func mergeNodeComments(next, old *yaml.Node) *yaml.Node {
	if old == nil || next == nil {
		return next
	}
	if next.HeadComment == "" {
		next.HeadComment = old.HeadComment
	}
	if next.LineComment == "" {
		next.LineComment = old.LineComment
	}
	if next.FootComment == "" {
		next.FootComment = old.FootComment
	}
	return next
}

func (d *yamlDoc) set(path string, value any) error {
	segs, err := splitConfigPath(path)
	if err != nil {
		return err
	}
	return d.setAt(d.root, segs, yamlNodeFromValue(value))
}

func (d *yamlDoc) setAt(node *yaml.Node, segs []yamlPathSeg, val *yaml.Node) error {
	seg := segs[0]
	last := len(segs) == 1

	switch seg.kind {
	case yamlSegKey:
		if err := ensureContainer(node, yaml.MappingNode); err != nil {
			return err
		}
		idx := nodeMappingIndex(node, seg.key)
		if idx < 0 {
			placeholder := &yaml.Node{}
			node.Content = append(node.Content, scalarNode("!!str", seg.key), placeholder)
			idx = len(node.Content) - 2
		}
		if last {
			node.Content[idx+1] = mergeNodeComments(val, node.Content[idx+1])
			return nil
		}
		if err := ensureContainer(node.Content[idx+1], containerKindFor(segs[1])); err != nil {
			return err
		}
		return d.setAt(node.Content[idx+1], segs[1:], val)

	case yamlSegIndex:
		if err := ensureContainer(node, yaml.SequenceNode); err != nil {
			return err
		}
		switch {
		case seg.index < len(node.Content):
			if last {
				node.Content[seg.index] = mergeNodeComments(val, node.Content[seg.index])
				return nil
			}
			if err := ensureContainer(node.Content[seg.index], containerKindFor(segs[1])); err != nil {
				return err
			}
			return d.setAt(node.Content[seg.index], segs[1:], val)
		case seg.index == len(node.Content):
			if last {
				node.Content = append(node.Content, val)
				return nil
			}
			child := &yaml.Node{}
			if err := ensureContainer(child, containerKindFor(segs[1])); err != nil {
				return err
			}
			node.Content = append(node.Content, child)
			return d.setAt(child, segs[1:], val)
		default:
			return fmt.Errorf("数组下标 %d 越界", seg.index)
		}

	case yamlSegQuery:
		if err := ensureContainer(node, yaml.SequenceNode); err != nil {
			return err
		}
		item, idx := nodeSequenceQueryItem(node, seg.queryField, seg.queryValue)
		if item == nil {
			item = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
			item.Content = append(item.Content,
				scalarNode("!!str", seg.queryField), scalarNode("!!str", seg.queryValue))
			node.Content = append(node.Content, item)
			idx = len(node.Content) - 1
		}
		if last {
			if val.Kind == yaml.MappingNode && item.Kind == yaml.MappingNode {
				mergeMappingInto(item, val)
				return nil
			}
			node.Content[idx] = mergeNodeComments(val, item)
			return nil
		}
		if err := ensureContainer(item, containerKindFor(segs[1])); err != nil {
			return err
		}
		return d.setAt(item, segs[1:], val)
	}
	return fmt.Errorf("不支持的路径段")
}

// mergeMappingInto copies src's key/value pairs over target (existing keys
// are replaced in place so their comments survive), appending new keys.
func mergeMappingInto(target, src *yaml.Node) {
	for i := 0; i+1 < len(src.Content); i += 2 {
		key := src.Content[i].Value
		val := src.Content[i+1]
		if idx := nodeMappingIndex(target, key); idx >= 0 {
			target.Content[idx+1] = mergeNodeComments(val, target.Content[idx+1])
			continue
		}
		target.Content = append(target.Content, src.Content[i], val)
	}
}

func (d *yamlDoc) remove(path string) (bool, error) {
	segs, err := splitConfigPath(path)
	if err != nil {
		return false, err
	}
	node := d.root
	for _, seg := range segs[:len(segs)-1] {
		switch seg.kind {
		case yamlSegKey:
			node = nodeMappingValue(node, seg.key)
		case yamlSegIndex:
			if node != nil && node.Kind == yaml.SequenceNode && seg.index < len(node.Content) {
				node = node.Content[seg.index]
			} else {
				node = nil
			}
		case yamlSegQuery:
			node, _ = nodeSequenceQueryItem(node, seg.queryField, seg.queryValue)
		}
		if node == nil {
			return false, nil
		}
	}
	last := segs[len(segs)-1]
	switch last.kind {
	case yamlSegKey:
		if node.Kind == yaml.MappingNode {
			if idx := nodeMappingIndex(node, last.key); idx >= 0 {
				node.Content = append(node.Content[:idx], node.Content[idx+2:]...)
				return true, nil
			}
		}
	case yamlSegIndex:
		if node.Kind == yaml.SequenceNode && last.index < len(node.Content) {
			node.Content = append(node.Content[:last.index], node.Content[last.index+1:]...)
			return true, nil
		}
	case yamlSegQuery:
		if item, idx := nodeSequenceQueryItem(node, last.queryField, last.queryValue); item != nil {
			node.Content = append(node.Content[:idx], node.Content[idx+1:]...)
			return true, nil
		}
	}
	return false, nil
}

// ── node ⇄ value conversion ─────────────────────────────────────────

// yamlNodeToAny converts a node tree into generic Go values (JSON data
// model), resolving aliases and honouring YAML scalar tags.
func yamlNodeToAny(n *yaml.Node) any {
	if n == nil {
		return nil
	}
	switch n.Kind {
	case yaml.DocumentNode:
		if len(n.Content) > 0 {
			return yamlNodeToAny(n.Content[0])
		}
		return nil
	case yaml.AliasNode:
		return yamlNodeToAny(n.Alias)
	case yaml.MappingNode:
		out := make(map[string]any, len(n.Content)/2)
		for i := 0; i+1 < len(n.Content); i += 2 {
			out[n.Content[i].Value] = yamlNodeToAny(n.Content[i+1])
		}
		return out
	case yaml.SequenceNode:
		out := make([]any, 0, len(n.Content))
		for _, item := range n.Content {
			out = append(out, yamlNodeToAny(item))
		}
		return out
	case yaml.ScalarNode:
		switch n.Tag {
		case "!!bool":
			return n.Value == "true" || n.Value == "True" || n.Value == "TRUE"
		case "!!int":
			if i, err := strconv.ParseInt(n.Value, 0, 64); err == nil {
				return i
			}
			return n.Value
		case "!!float":
			if f, err := strconv.ParseFloat(n.Value, 64); err == nil {
				return f
			}
			return n.Value
		case "!!null":
			return nil
		default:
			return n.Value
		}
	}
	return nil
}

// yamlNodeFromValue converts a generic Go value (what the recommendation /
// managed generation code produces) into a yaml.v3 node. Mapping keys are
// written in a stable order: id/name first, then alphabetical.
func yamlNodeFromValue(v any) *yaml.Node {
	switch t := v.(type) {
	case nil:
		return scalarNode("!!null", "null")
	case bool:
		return scalarNode("!!bool", strconv.FormatBool(t))
	case string:
		return scalarNode("!!str", t)
	case int:
		return scalarNode("!!int", strconv.Itoa(t))
	case int32:
		return scalarNode("!!int", strconv.FormatInt(int64(t), 10))
	case int64:
		return scalarNode("!!int", strconv.FormatInt(t, 10))
	case float32:
		return scalarNode("!!float", strconv.FormatFloat(float64(t), 'g', -1, 32))
	case float64:
		if t == float64(int64(t)) && t <= 1<<53 && t >= -(1<<53) {
			return scalarNode("!!int", strconv.FormatInt(int64(t), 10))
		}
		return scalarNode("!!float", strconv.FormatFloat(t, 'g', -1, 64))
	case json.Number:
		if i, err := t.Int64(); err == nil {
			return scalarNode("!!int", strconv.FormatInt(i, 10))
		}
		return scalarNode("!!float", t.String())
	case map[string]any:
		node := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return yamlKeyLess(keys[i], keys[j]) })
		for _, k := range keys {
			node.Content = append(node.Content, scalarNode("!!str", k), yamlNodeFromValue(t[k]))
		}
		return node
	case []any:
		node := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		for _, item := range t {
			node.Content = append(node.Content, yamlNodeFromValue(item))
		}
		return node
	case []map[string]any:
		node := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		for _, item := range t {
			node.Content = append(node.Content, yamlNodeFromValue(item))
		}
		return node
	case []string:
		node := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		for _, item := range t {
			node.Content = append(node.Content, scalarNode("!!str", item))
		}
		return node
	default:
		// Round-trip through JSON for any other shape the generators hand us.
		if blob, err := json.Marshal(v); err == nil {
			var generic any
			if json.Unmarshal(blob, &generic) == nil {
				return yamlNodeFromValue(generic)
			}
		}
		return scalarNode("!!str", fmt.Sprintf("%v", v))
	}
}

// yamlKeyLess keeps generated mappings readable: id and name lead, the rest
// sorts alphabetically.
func yamlKeyLess(a, b string) bool {
	rank := func(k string) int {
		switch k {
		case "id":
			return 0
		case "name":
			return 1
		default:
			return 2
		}
	}
	ra, rb := rank(a), rank(b)
	if ra != rb {
		return ra < rb
	}
	return a < b
}
