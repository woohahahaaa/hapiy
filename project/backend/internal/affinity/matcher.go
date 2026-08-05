package affinity

import (
	"strings"

	"github.com/tidwall/gjson"
)

// Request is the minimal view of an incoming relay request that affinity needs
// to match rules and read field values. Headers are matched case-insensitively.
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

// extractValue reads an affinity value from one KeySource.
func extractValue(req *Request, src KeySource) string {
	switch src.Type {
	case SourceRequestHeader:
		if src.Key == "" {
			return ""
		}
		return strings.TrimSpace(headerValue(req.Headers, src.Key))
	case SourceGJSON:
		if src.Path == "" || len(req.Body) == 0 {
			return ""
		}
		res := gjson.GetBytes(req.Body, src.Path)
		if !res.Exists() {
			return ""
		}
		return strings.TrimSpace(res.String())
	default:
		return ""
	}
}

// MatchResult carries the outcome of an affinity lookup.
type MatchResult struct {
	// Matched is true when a rule applied and a cached triple was recalled.
	Matched bool
	// CacheKey is the composed cache key (used to delete/refresh on failure).
	CacheKey string
	// Triple is the recalled provider/key/baseURL when Matched is true.
	Triple Triple
	// RuleName identifies which rule matched (for logging / cache admin).
	RuleName string
	// RuleIncludeModel mirrors the rule's IncludeModelName for recording.
	RuleIncludeModel bool
	// AffinityValue is the extracted field value (needed to record a new recall).
	AffinityValue string
}

// Lookup runs channel affinity: find the first applicable enabled rule, read the
// affinity value, and recall a cached triple if present.
func (cs *RuleCompiledSet) Lookup(req *Request) MatchResult {
	if cs == nil || !cs.Enabled {
		return MatchResult{}
	}
	for _, cr := range cs.rules {
		r := cr.rule
		// Model match: if the rule lists model regexes, one must match.
		if len(cr.modelRe) > 0 && !matchAny(cr.modelRe, req.Model) {
			continue
		}
		// Path match: only when the rule declares path regexes.
		if len(cr.pathRe) > 0 && !matchAny(cr.pathRe, req.Path) {
			continue
		}
		// Read the affinity value from the first source that yields one.
		var value string
		for _, src := range r.KeySources {
			value = extractValue(req, src)
			if value != "" {
				break
			}
		}
		if value == "" {
			continue
		}
		if cr.valueRe != nil && !cr.valueRe.MatchString(value) {
			continue
		}

		ttl := r.TTLSeconds
		if ttl <= 0 {
			ttl = cs.DefaultTTL
		}
		key := buildCacheKey(r.Name, r.IncludeModelName, req.Model, value)
		t, found := cs.cacheGet(key)
		if !found {
			return MatchResult{Matched: false, CacheKey: key, RuleName: r.Name, RuleIncludeModel: r.IncludeModelName, AffinityValue: value}
		}
		_ = ttl
		return MatchResult{Matched: true, CacheKey: key, Triple: t, RuleName: r.Name, RuleIncludeModel: r.IncludeModelName, AffinityValue: value}
	}
	return MatchResult{}
}
