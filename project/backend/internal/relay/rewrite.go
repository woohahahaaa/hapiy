package relay

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// CompiledRewriteChain is the pre-validated form of a rewrite rule's
// Script. Compiling happens once at plan build time so the per-request
// hot path just iterates []RewriteOp with cheap sjson local byte
// replacement — no parsing, no validation.
type CompiledRewriteChain struct {
	RuleID   string
	RuleName string
	Ops      []RewriteOp
}

// RewriteOp is a single, pre-parsed operation from a rule's Script.
type RewriteOp struct {
	Mode       string // set | delete | append | prepend | trim_prefix | trim_suffix | ensure_prefix | ensure_suffix | trim_space | to_lower | to_upper | replace | regex_replace | move | copy
	Path       string // gjson path
	Value      string // raw value for set/append/prepend/ensure_*
	RawValue   json.RawMessage
	From       string             // replace / regex_replace source
	To         string             // replace / regex_replace target
	Regex      *regexp.Regexp     // compiled regex for regex_replace
	DstPath    string             // copy / move destination
	Conditions []RewriteCondition // optional execution gating
	Scope      string             // "header" | "body" | "all" (default)
}

// RewriteCondition evaluates the current value at a path and decides
// whether the op should run. Logic is AND/OR across siblings.
type RewriteCondition struct {
	Path     string // gjson path to evaluate against (defaults to op.Path)
	Op       string // contains | prefix | suffix | eq | neq | gt | gte | lt | lte | matches
	Value    string // literal string to compare against
	Invert   bool
	combined bool   // internal: true when this is a logic node, not a leaf
	Logic    string // "AND" | "OR" — only used when combined
	Children []RewriteCondition
	Regex    *regexp.Regexp // compiled regex for matches
}

// compileRewriteChain parses and validates a rule's Script. A bad Script
// returns an error so the planner fails loudly with the rule's name and ID
// in the message — silent fallback to "no-op" would hide authoring bugs
// and produce confusing zero-effect requests in production.
func compileRewriteChain(ruleID, script string) ([]RewriteOp, error) {
	trimmed := strings.TrimSpace(script)
	if trimmed == "" {
		return nil, nil
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		return nil, fmt.Errorf("rule %s: script is not a JSON array: %w", ruleID, err)
	}
	ops := make([]RewriteOp, 0, len(raw))
	for index, entry := range raw {
		op, err := compileRewriteOp(ruleID, index, entry)
		if err != nil {
			return nil, err
		}
		ops = append(ops, op)
	}
	return ops, nil
}

// compileRewriteOp parses a single operations-object entry.
func compileRewriteOp(ruleID string, index int, entry map[string]json.RawMessage) (RewriteOp, error) {
	op := RewriteOp{}
	if raw, ok := entry["mode"]; ok {
		if err := json.Unmarshal(raw, &op.Mode); err != nil {
			return op, fmt.Errorf("rule %s: op %d: mode is not a string: %w", ruleID, index, err)
		}
	}
	op.Mode = strings.ToLower(strings.TrimSpace(op.Mode))
	if op.Mode == "" {
		return op, fmt.Errorf("rule %s: op %d: mode is required", ruleID, index)
	}
	if raw, ok := entry["path"]; ok {
		if err := json.Unmarshal(raw, &op.Path); err != nil {
			return op, fmt.Errorf("rule %s: op %d: path is not a string: %w", ruleID, index, err)
		}
	}
	if op.Path == "" {
		return op, fmt.Errorf("rule %s: op %d (%s): path is required", ruleID, index, op.Mode)
	}
	switch op.Mode {
	case "set":
		raw, ok := entry["value"]
		if !ok {
			op.RawValue = json.RawMessage(`""`)
			break
		}
		op.RawValue = raw
		if strings.HasPrefix(op.Path, "header.") {
			if err := json.Unmarshal(raw, &op.Value); err != nil {
				return op, fmt.Errorf("rule %s: op %d (set): value is not a string: %w", ruleID, index, err)
			}
		}
	case "append", "prepend", "ensure_prefix", "ensure_suffix", "trim_prefix", "trim_suffix",
		"first_prepend", "last_append":
		if raw, ok := entry["value"]; ok {
			if err := json.Unmarshal(raw, &op.Value); err != nil {
				return op, fmt.Errorf("rule %s: op %d (%s): value is not a string: %w", ruleID, index, op.Mode, err)
			}
		}
	case "replace":
		if raw, ok := entry["from"]; ok {
			if err := json.Unmarshal(raw, &op.From); err != nil {
				return op, fmt.Errorf("rule %s: op %d (replace): from is not a string: %w", ruleID, index, err)
			}
		}
		if raw, ok := entry["to"]; ok {
			if err := json.Unmarshal(raw, &op.To); err != nil {
				return op, fmt.Errorf("rule %s: op %d (replace): to is not a string: %w", ruleID, index, err)
			}
		}
		if op.From == "" {
			return op, fmt.Errorf("rule %s: op %d (replace): from is required", ruleID, index)
		}
	case "regex_replace":
		if raw, ok := entry["from"]; ok {
			if err := json.Unmarshal(raw, &op.From); err != nil {
				return op, fmt.Errorf("rule %s: op %d (regex_replace): from is not a string: %w", ruleID, index, err)
			}
		}
		if raw, ok := entry["to"]; ok {
			if err := json.Unmarshal(raw, &op.To); err != nil {
				return op, fmt.Errorf("rule %s: op %d (regex_replace): to is not a string: %w", ruleID, index, err)
			}
		}
		if op.From == "" {
			return op, fmt.Errorf("rule %s: op %d (regex_replace): from is required", ruleID, index)
		}
		re, err := regexp.Compile(op.From)
		if err != nil {
			return op, fmt.Errorf("rule %s: op %d (regex_replace): invalid regex: %w", ruleID, index, err)
		}
		op.Regex = re
	case "move", "copy":
		if raw, ok := entry["dst"]; ok {
			if err := json.Unmarshal(raw, &op.DstPath); err != nil {
				return op, fmt.Errorf("rule %s: op %d (%s): dst is not a string: %w", ruleID, index, op.Mode, err)
			}
		}
		if op.DstPath == "" {
			return op, fmt.Errorf("rule %s: op %d (%s): dst is required", ruleID, index, op.Mode)
		}
	case "delete", "trim_space", "to_lower", "to_upper":
		// no extra fields required
	default:
		return op, fmt.Errorf("rule %s: op %d: unsupported mode %q", ruleID, index, op.Mode)
	}
	if raw, ok := entry["conditions"]; ok {
		conds, err := compileConditions(ruleID, index, raw)
		if err != nil {
			return op, err
		}
		op.Conditions = conds
	}
	if raw, ok := entry["scope"]; ok {
		var scope string
		if err := json.Unmarshal(raw, &scope); err != nil {
			return op, fmt.Errorf("rule %s: op %d: scope is not a string: %w", ruleID, index, err)
		}
		scope = strings.ToLower(strings.TrimSpace(scope))
		switch scope {
		case "", "all", "header", "body":
		default:
			return op, fmt.Errorf("rule %s: op %d: unsupported scope %q (must be \"header\", \"body\", or \"all\")", ruleID, index, scope)
		}
		if scope == "header" && !strings.HasPrefix(op.Path, "header.") {
			return op, fmt.Errorf("rule %s: op %d: scope %q incompatible with path %q (scope header requires header. prefix)", ruleID, index, scope, op.Path)
		}
		if scope == "body" && strings.HasPrefix(op.Path, "header.") {
			return op, fmt.Errorf("rule %s: op %d: scope %q incompatible with path %q (scope body cannot use header. prefix)", ruleID, index, scope, op.Path)
		}
		op.Scope = scope
	}
	return op, nil
}

// compileConditions parses the optional conditions array. In its simple
// form it's an array of leaf objects: {"path", "op", "value", "invert"}.
// For nested AND/OR composition, a leaf can be {"logic":"AND","children":[]}
// — recursion handles arbitrarily nested trees.
func compileConditions(ruleID string, opIndex int, raw json.RawMessage) ([]RewriteCondition, error) {
	var rawList []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &rawList); err != nil {
		return nil, fmt.Errorf("rule %s: op %d: conditions must be an array: %w", ruleID, opIndex, err)
	}
	conds := make([]RewriteCondition, 0, len(rawList))
	for ci, leaf := range rawList {
		c, err := compileConditionLeaf(ruleID, opIndex, ci, leaf)
		if err != nil {
			return nil, err
		}
		conds = append(conds, c)
	}
	return conds, nil
}

func compileConditionLeaf(ruleID string, opIndex, ci int, leaf map[string]json.RawMessage) (RewriteCondition, error) {
	c := RewriteCondition{}
	if raw, ok := leaf["logic"]; ok {
		if err := json.Unmarshal(raw, &c.Logic); err != nil {
			return c, fmt.Errorf("rule %s: op %d condition %d: logic is not a string: %w", ruleID, opIndex, ci, err)
		}
		c.Logic = strings.ToUpper(strings.TrimSpace(c.Logic))
		if c.Logic != "AND" && c.Logic != "OR" {
			return c, fmt.Errorf("rule %s: op %d condition %d: logic must be AND or OR", ruleID, opIndex, ci)
		}
		c.combined = true
		if raw, ok := leaf["children"]; ok {
			inner, err := compileConditions(ruleID, opIndex, raw)
			if err != nil {
				return c, err
			}
			c.Children = inner
		}
		return c, nil
	}
	if raw, ok := leaf["op"]; ok {
		if err := json.Unmarshal(raw, &c.Op); err != nil {
			return c, fmt.Errorf("rule %s: op %d condition %d: op is not a string: %w", ruleID, opIndex, ci, err)
		}
	}
	c.Op = strings.ToLower(strings.TrimSpace(c.Op))
	switch c.Op {
	case "contains", "prefix", "suffix", "eq", "neq", "gt", "gte", "lt", "lte", "matches":
	default:
		return c, fmt.Errorf("rule %s: op %d condition %d: unsupported comparison op %q", ruleID, opIndex, ci, c.Op)
	}
	if raw, ok := leaf["path"]; ok {
		if err := json.Unmarshal(raw, &c.Path); err != nil {
			return c, fmt.Errorf("rule %s: op %d condition %d: path is not a string: %w", ruleID, opIndex, ci, err)
		}
	}
	if raw, ok := leaf["value"]; ok {
		if err := json.Unmarshal(raw, &c.Value); err != nil {
			return c, fmt.Errorf("rule %s: op %d condition %d: value is not a string: %w", ruleID, opIndex, ci, err)
		}
	}
	if raw, ok := leaf["invert"]; ok {
		if err := json.Unmarshal(raw, &c.Invert); err != nil {
			return c, fmt.Errorf("rule %s: op %d condition %d: invert is not a boolean: %w", ruleID, opIndex, ci, err)
		}
	}
	if c.Op == "matches" {
		re, err := regexp.Compile(c.Value)
		if err != nil {
			return c, fmt.Errorf("rule %s: op %d condition %d: invalid matches regex: %w", ruleID, opIndex, ci, err)
		}
		c.Regex = re
	}
	return c, nil
}

// applyRewriteChains runs every compiled chain in sequence over the
// request body. Each op mutates the raw JSON bytes via sjson local
// replacements — no full re-parse. The engine passes req.Body in by
// marshalling it once because that's the contract used by the existing
// pipeline (Body is a map[string]any).
func applyRewriteChains(body []byte, headers map[string]string, chains []CompiledRewriteChain) ([]byte, map[string]string, error) {
	for ci := range chains {
		chain := &chains[ci]
		if headers == nil && chainHasHeaderOp(chain) {
			headers = make(map[string]string)
		}
		for oi := range chain.Ops {
			op := &chain.Ops[oi]
			ok, err := evaluateConditions(op.Conditions, body, headers)
			if err != nil {
				return nil, headers, fmt.Errorf("rule %s op %d: %w", chain.RuleID, oi, err)
			}
			if !ok {
				continue
			}
			updated, updatedHeaders, err := applyRewriteOp(body, headers, op)
			if err != nil {
				return nil, headers, fmt.Errorf("rule %s op %d (%s): %w", chain.RuleID, oi, op.Mode, err)
			}
			body = updated
			headers = updatedHeaders
		}
	}
	return body, headers, nil
}

// applyRewriteOp performs a single op. Returns the (possibly new) bytes.
func applyRewriteOp(body []byte, headers map[string]string, op *RewriteOp) ([]byte, map[string]string, error) {
	if strings.HasPrefix(op.Path, "header.") {
		return applyHeaderOp(body, headers, op)
	}
	// sjson cannot address array elements by negative index ("-1"), while
	// gjson (used for condition evaluation above) can. Resolve negative
	// indexes to their concrete positive position before writing so a rule
	// like "messages.-1.content" behaves identically in both phases.
	writePath := op.Path
	if resolved := resolveSjsonPath(body, op.Path); resolved != op.Path {
		writePath = resolved
	}
	switch op.Mode {
	case "set":
		updated, err := sjson.SetRawBytes(body, writePath, op.RawValue)
		return updated, headers, err
	case "delete":
		updated, err := sjson.DeleteBytes(body, writePath)
		return updated, headers, err
	case "append", "last_append":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			updated, err := sjson.SetBytes(body, writePath, op.Value)
			return updated, headers, err
		}
		updated, err := sjson.SetBytes(body, writePath, current.String()+op.Value)
		return updated, headers, err
	case "prepend", "first_prepend":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			updated, err := sjson.SetBytes(body, writePath, op.Value)
			return updated, headers, err
		}
		updated, err := sjson.SetBytes(body, writePath, op.Value+current.String())
		return updated, headers, err
	case "trim_prefix":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			return body, headers, nil
		}
		updated, err := sjson.SetBytes(body, writePath, strings.TrimPrefix(current.String(), op.Value))
		return updated, headers, err
	case "trim_suffix":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			return body, headers, nil
		}
		updated, err := sjson.SetBytes(body, writePath, strings.TrimSuffix(current.String(), op.Value))
		return updated, headers, err
	case "ensure_prefix":
		current := gjson.GetBytes(body, op.Path)
		if current.Exists() && strings.HasPrefix(current.String(), op.Value) {
			return body, headers, nil
		}
		merged := op.Value
		if current.Exists() {
			merged = op.Value + current.String()
		}
		updated, err := sjson.SetBytes(body, writePath, merged)
		return updated, headers, err
	case "ensure_suffix":
		current := gjson.GetBytes(body, op.Path)
		if current.Exists() && strings.HasSuffix(current.String(), op.Value) {
			return body, headers, nil
		}
		merged := op.Value
		if current.Exists() {
			merged = current.String() + op.Value
		}
		updated, err := sjson.SetBytes(body, writePath, merged)
		return updated, headers, err
	case "trim_space":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			return body, headers, nil
		}
		updated, err := sjson.SetBytes(body, writePath, strings.TrimSpace(current.String()))
		return updated, headers, err
	case "to_lower":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			return body, headers, nil
		}
		updated, err := sjson.SetBytes(body, writePath, strings.ToLower(current.String()))
		return updated, headers, err
	case "to_upper":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			return body, headers, nil
		}
		updated, err := sjson.SetBytes(body, writePath, strings.ToUpper(current.String()))
		return updated, headers, err
	case "replace":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			return body, headers, nil
		}
		updated, err := sjson.SetBytes(body, writePath, strings.ReplaceAll(current.String(), op.From, op.To))
		return updated, headers, err
	case "regex_replace":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			return body, headers, nil
		}
		updated, err := sjson.SetBytes(body, writePath, op.Regex.ReplaceAllString(current.String(), op.To))
		return updated, headers, err
	case "copy":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			return body, headers, nil
		}
		updated, err := sjson.SetRawBytes(body, resolveSjsonPath(body, op.DstPath), []byte(current.Raw))
		return updated, headers, err
	case "move":
		current := gjson.GetBytes(body, op.Path)
		if !current.Exists() {
			return body, headers, nil
		}
		updated, err := sjson.SetRawBytes(body, resolveSjsonPath(body, op.DstPath), []byte(current.Raw))
		if err != nil {
			return nil, nil, err
		}
		deleted, err := sjson.DeleteBytes(updated, writePath)
		return deleted, headers, err
	default:
		return body, headers, nil
	}
}

// resolveSjsonPath rewrites negative array indexes (e.g. "-1") in a gjson
// path to their concrete positive position (e.g. "2") by walking the path
// against the actual body with gjson. sjson rejects "-1" as an address and
// would append a bogus object; gjson accepts it for reads, so conditions
// and writes must agree on the same position. Any unresolvable segment
// leaves the original path untouched.
func resolveSjsonPath(body []byte, path string) string {
	if !strings.Contains(path, "-") {
		return path
	}
	parts := strings.Split(path, ".")
	resolved := make([]string, 0, len(parts))
	cur := gjson.ParseBytes(body)
	for _, p := range parts {
		idx, err := strconv.Atoi(p)
		if err == nil && idx < 0 && cur.IsArray() {
			arr := cur.Array()
			pos := len(arr) + idx
			if pos < 0 {
				return path
			}
			p = strconv.Itoa(pos)
		}
		resolved = append(resolved, p)
		cur = cur.Get(p)
	}
	return strings.Join(resolved, ".")
}

// ApplyScript compiles and runs a rewrite script against the given body,
// returning the modified body. This is the public entry point for the
// rewrite test API in the handler layer.
func ApplyScript(body []byte, script string) ([]byte, error) {
	ops, err := compileRewriteChain("test", script)
	if err != nil {
		return nil, err
	}
	updated, _, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "test", RuleName: "test", Ops: ops}})
	return updated, err
}

// evaluateConditions short-circuits when the conditions list is empty.
func evaluateConditions(conds []RewriteCondition, body []byte, headers map[string]string) (bool, error) {
	if len(conds) == 0 {
		return true, nil
	}
	for i := range conds {
		ok, err := evaluateCondition(&conds[i], body, headers)
		if err != nil {
			return false, err
		}
		if !ok {
			return false, nil
		}
	}
	return true, nil
}

func evaluateCondition(c *RewriteCondition, body []byte, headers map[string]string) (bool, error) {
	if c.combined {
		return evaluateCombined(c, body, headers)
	}
	path := c.Path
	if path == "" {
		path = ""
	}
	if strings.HasPrefix(path, "header.") {
		key, err := headerKey(path)
		if err != nil {
			return false, err
		}
		actual := ""
		if headers != nil {
			actual = headers[key]
		}
		var ok bool
		if c.Op == "matches" && c.Regex != nil {
			ok = c.Regex.MatchString(actual)
		} else {
			ok, err = compareValues(c.Op, actual, c.Value)
			if err != nil {
				return false, err
			}
		}
		if c.Invert {
			ok = !ok
		}
		return ok, nil
	}
	current := gjson.GetBytes(body, path)
	actual := current.String()
	var ok bool
	if c.Op == "matches" && c.Regex != nil {
		ok = c.Regex.MatchString(actual)
	} else {
		var err error
		ok, err = compareValues(c.Op, actual, c.Value)
		if err != nil {
			return false, err
		}
	}
	if c.Invert {
		ok = !ok
	}
	return ok, nil
}

func evaluateCombined(c *RewriteCondition, body []byte, headers map[string]string) (bool, error) {
	if len(c.Children) == 0 {
		return true, nil
	}
	if c.Logic == "OR" {
		for i := range c.Children {
			ok, err := evaluateCondition(&c.Children[i], body, headers)
			if err != nil {
				return false, err
			}
			if ok {
				return true, nil
			}
		}
		return false, nil
	}
	// AND
	for i := range c.Children {
		ok, err := evaluateCondition(&c.Children[i], body, headers)
		if err != nil {
			return false, err
		}
		if !ok {
			return false, nil
		}
	}
	return true, nil
}

// compareValues performs the leaf comparison. gt/gte/lt/lte try numeric
// comparison first and fall back to lexicographic for non-numeric values.
func compareValues(op, actual, expected string) (bool, error) {
	switch op {
	case "contains":
		return strings.Contains(actual, expected), nil
	case "prefix":
		return strings.HasPrefix(actual, expected), nil
	case "suffix":
		return strings.HasSuffix(actual, expected), nil
	case "eq":
		return actual == expected, nil
	case "neq":
		return actual != expected, nil
	}
	aNum, aErr := strconv.ParseFloat(actual, 64)
	bNum, bErr := strconv.ParseFloat(expected, 64)
	if aErr == nil && bErr == nil {
		switch op {
		case "gt":
			return aNum > bNum, nil
		case "gte":
			return aNum >= bNum, nil
		case "lt":
			return aNum < bNum, nil
		case "lte":
			return aNum <= bNum, nil
		}
	}
	switch op {
	case "gt":
		return actual > expected, nil
	case "gte":
		return actual >= expected, nil
	case "lt":
		return actual < expected, nil
	case "lte":
		return actual <= expected, nil
	}
	return false, fmt.Errorf("unsupported comparison op %q", op)
}
