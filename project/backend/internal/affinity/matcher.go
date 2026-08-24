package affinity

import (
	"strings"

	"github.com/tidwall/gjson"
)

// Request is the minimal view of an incoming relay request that affinity
// needs to match rules and read field values. Headers are matched
// case-insensitively.
type Request struct {
	Model   string
	Path    string
	Headers map[string]string
	Body    []byte
}

// headerValue returns a header value case-insensitively.
func headerValue(headers map[string]string, name string) string {
	if v, ok := headers[name]; ok {
		return v
	}
	for k, v := range headers {
		if strings.EqualFold(k, name) {
			return v
		}
	}
	return ""
}

// readField tries each candidate field name in order: first as a
// request header (case-insensitive), then as a gjson path into the
// body. Returns the first non-empty trimmed value.
func readField(req *Request, fields []string) string {
	for _, name := range fields {
		if name == "" {
			continue
		}
		if v := headerValue(req.Headers, name); v != "" {
			return strings.TrimSpace(v)
		}
		if len(req.Body) > 0 {
			res := gjson.GetBytes(req.Body, name)
			if res.Exists() {
				if s := strings.TrimSpace(res.String()); s != "" {
					return s
				}
			}
		}
	}
	return ""
}

// MatchResult carries the outcome of an affinity lookup.
type MatchResult struct {
	Matched     bool
	CacheKey    string
	Triple      Triple
	RuleName    string
	SessionID   string
	UserID      string
	ModelName   string
}

// Lookup runs channel affinity: iterate enabled rules, extract the
// session id / user id / model from their configured field lists, and
// recall a cached triple when one applies. The model also has to match
// the rule's explicit ModelNames list.
func (cs *RuleCompiledSet) Lookup(req *Request) MatchResult {
	if cs == nil || !cs.Enabled {
		return MatchResult{}
	}
	for _, cr := range cs.rules {
		r := cr.rule

		sessionID := readField(req, r.SessionIDFields)
		if sessionID == "" {
			continue
		}
		modelName := req.Model
		if modelName == "" {
			modelName = readField(req, r.ModelFields)
		}
		if modelName == "" {
			continue
		}
		if len(cr.modelNamesSet) > 0 {
			if _, ok := cr.modelNamesSet[modelName]; !ok {
				continue
			}
		}
		userID := readField(req, r.UserIDFields)

		ttl := r.TTLSeconds
		if ttl <= 0 {
			ttl = cs.DefaultTTL
		}
		key := buildCacheKey(r.Name, sessionID, userID, modelName)
		t, found := cs.cacheGet(key)
		if !found {
			return MatchResult{
				Matched: false, CacheKey: key, RuleName: r.Name,
				SessionID: sessionID, UserID: userID, ModelName: modelName,
			}
		}
		_ = ttl
		return MatchResult{
			Matched: true, CacheKey: key, Triple: t, RuleName: r.Name,
			SessionID: sessionID, UserID: userID, ModelName: modelName,
		}
	}
	return MatchResult{}
}
