package relay

import (
	"fmt"
	"strings"
)

func applyHeaderOp(headers map[string]string, op *RewriteOp) ([]byte, map[string]string, error) {
	if headers == nil {
		headers = make(map[string]string)
	}
	return nil, headers, fmt.Errorf("header op %q not yet implemented", op.Mode)
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
