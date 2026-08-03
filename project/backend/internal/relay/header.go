package relay

import (
	"fmt"
	"strings"
)

func applyHeaderOp(headers map[string]string, op *RewriteOp) ([]byte, map[string]string, error) {
	if headers == nil {
		headers = make(map[string]string)
	}
	key, err := headerKey(op.Path)
	if err != nil {
		return nil, nil, err
	}
	switch op.Mode {
	case "set":
		headers[key] = op.Value
	case "delete":
		delete(headers, key)
	case "append":
		headers[key] += op.Value
	case "prepend":
		headers[key] = op.Value + headers[key]
	case "ensure_prefix":
		if !strings.HasPrefix(headers[key], op.Value) {
			headers[key] = op.Value + headers[key]
		}
	case "ensure_suffix":
		if !strings.HasSuffix(headers[key], op.Value) {
			headers[key] = headers[key] + op.Value
		}
	case "trim_prefix":
		headers[key] = strings.TrimPrefix(headers[key], op.Value)
	case "trim_suffix":
		headers[key] = strings.TrimSuffix(headers[key], op.Value)
	case "trim_space":
		headers[key] = strings.TrimSpace(headers[key])
	case "to_lower":
		headers[key] = strings.ToLower(headers[key])
	case "to_upper":
		headers[key] = strings.ToUpper(headers[key])
	case "replace":
		headers[key] = strings.ReplaceAll(headers[key], op.From, op.To)
	case "regex_replace":
		if op.Regex != nil {
			headers[key] = op.Regex.ReplaceAllString(headers[key], op.To)
		}
	case "copy", "move":
		return nil, nil, fmt.Errorf("header scope: copy/move not supported (cross-scope rewrite is not allowed)")
	default:
		return nil, nil, fmt.Errorf("header op: unsupported mode %q", op.Mode)
	}
	return nil, headers, nil
}

func headerKey(path string) (string, error) {
	if !strings.HasPrefix(path, "header.") {
		return "", fmt.Errorf("path %q does not have header. prefix", path)
	}
	return path[len("header."):], nil
}

func chainHasHeaderOp(chain *CompiledRewriteChain) bool {
	for i := range chain.Ops {
		if strings.HasPrefix(chain.Ops[i].Path, "header.") {
			return true
		}
	}
	return false
}
