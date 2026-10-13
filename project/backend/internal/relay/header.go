package relay

import (
	"fmt"
	"strings"

	"github.com/tidwall/gjson"
)

// applyHeaderOp performs one header-scope op. origBody/origHeaders are the
// pre-rewrite snapshots a variable reference reads from (a cross-domain ref may
// name either domain). The third return value is a non-empty reason when the op
// was allowed to run but changed nothing — currently only the set-from-ref case
// whose source is absent; the caller records it as "命中但未生效" instead of
// silently dropping it.
func applyHeaderOp(body []byte, headers map[string]string, origBody []byte, origHeaders map[string]string, op *RewriteOp) ([]byte, map[string]string, string, error) {
	if headers == nil {
		headers = make(map[string]string)
	}
	key, err := headerKey(op.Path)
	if err != nil {
		return body, nil, "", err
	}
	switch op.Mode {
	case "set":
		if op.HashPath != "" {
			// 哈希来源：从原始请求取文本，写入派生出的稳定 id。
			src, ok := readHashSource(origBody, origHeaders, op.HashDomain, op.HashPath)
			if !ok {
				return body, headers, fmt.Sprintf("引用源 %s 不存在", hashSourceLabel(op, true)), nil
			}
			headers[key] = hashID(src)
			break
		}
		if op.Ref != "" {
			if op.RefDomain == "body" {
				// 跨域引用：body → header。header 只能是字符串，取值的字符串形式。
				src := gjson.GetBytes(origBody, op.Ref)
				if !src.Exists() {
					return body, headers, fmt.Sprintf("引用源 %s 不存在", refSourceLabel(op, true)), nil
				}
				setHeader(headers, key, src.String())
				break
			}
			// 变量引用：拷原始请求里的同名 header；源不存在则跳过。
			src, ok := lookupHeader(origHeaders, op.Ref)
			if !ok {
				return body, headers, fmt.Sprintf("引用源 %s 不存在", refSourceLabel(op, true)), nil
			}
			setHeader(headers, key, src)
			break
		}
		setHeader(headers, key, op.Value)
	case "delete":
		deleteHeader(headers, key)
	case "append":
		value, _ := lookupHeader(headers, key)
		setHeader(headers, key, value+op.Value)
	case "prepend":
		value, _ := lookupHeader(headers, key)
		setHeader(headers, key, op.Value+value)
	case "ensure_prefix":
		value, _ := lookupHeader(headers, key)
		if !strings.HasPrefix(value, op.Value) {
			setHeader(headers, key, op.Value+value)
		}
	case "ensure_suffix":
		value, _ := lookupHeader(headers, key)
		if !strings.HasSuffix(value, op.Value) {
			setHeader(headers, key, value+op.Value)
		}
	case "trim_prefix":
		value, _ := lookupHeader(headers, key)
		setHeader(headers, key, strings.TrimPrefix(value, op.Value))
	case "trim_suffix":
		value, _ := lookupHeader(headers, key)
		setHeader(headers, key, strings.TrimSuffix(value, op.Value))
	case "trim_space":
		value, _ := lookupHeader(headers, key)
		setHeader(headers, key, strings.TrimSpace(value))
	case "to_lower":
		value, _ := lookupHeader(headers, key)
		setHeader(headers, key, strings.ToLower(value))
	case "to_upper":
		value, _ := lookupHeader(headers, key)
		setHeader(headers, key, strings.ToUpper(value))
	case "replace":
		value, _ := lookupHeader(headers, key)
		setHeader(headers, key, strings.ReplaceAll(value, op.From, op.To))
	case "regex_replace":
		if op.Regex != nil {
			value, _ := lookupHeader(headers, key)
			setHeader(headers, key, op.Regex.ReplaceAllString(value, op.To))
		}
	case "copy", "move":
		return body, nil, "", fmt.Errorf("header scope: copy/move not supported (cross-scope rewrite is not allowed)")
	default:
		return body, nil, "", fmt.Errorf("header op: unsupported mode %q", op.Mode)
	}
	return body, headers, "", nil
}

func headerKey(path string) (string, error) {
	if !strings.HasPrefix(path, "header.") {
		return "", fmt.Errorf("path %q does not have header. prefix", path)
	}
	return path[len("header."):], nil
}

// lookupHeader finds a header by name. HTTP field names are case-insensitive,
// and the map mixes spellings: client headers arrive in Go's canonical form
// (X-Opencode-Session) while rule-authored names keep the spelling the author
// typed. An exact match wins, then a case-insensitive scan follows, so a rule
// never silently misses because it spelled the name differently.
func lookupHeader(headers map[string]string, name string) (string, bool) {
	if value, ok := headers[name]; ok {
		return value, true
	}
	for key, value := range headers {
		if strings.EqualFold(key, name) {
			return value, true
		}
	}
	return "", false
}

// setHeader writes a header, updating an existing entry whose name differs only
// in case instead of leaving two entries that race for the same wire name when
// the upstream request is assembled.
func setHeader(headers map[string]string, name, value string) {
	for key := range headers {
		if key != name && strings.EqualFold(key, name) {
			headers[key] = value
			return
		}
	}
	headers[name] = value
}

// deleteHeader removes every case variant of a header name.
func deleteHeader(headers map[string]string, name string) {
	for key := range headers {
		if strings.EqualFold(key, name) {
			delete(headers, key)
		}
	}
}

func chainHasHeaderOp(chain *CompiledRewriteChain) bool {
	for i := range chain.Ops {
		if strings.HasPrefix(chain.Ops[i].Path, "header.") {
			return true
		}
	}
	return false
}
