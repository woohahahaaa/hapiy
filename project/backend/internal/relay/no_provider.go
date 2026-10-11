package relay

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
)

// Reasons carried by NoProviderError. The handler localizes per reason so
// the caller learns why nothing served the request instead of a generic
// checklist.
const (
	// NoProviderReasonModelUnknown: no enabled provider declares the model.
	NoProviderReasonModelUnknown = "model_unknown"
	// NoProviderReasonPathUnsupported: the model exists but no provider
	// allows the request path for it.
	NoProviderReasonPathUnsupported = "path_unsupported"
	// NoProviderReasonProviderDisabled: the model+path are supported, but
	// only by providers that are auto-disabled (failover) right now.
	NoProviderReasonProviderDisabled = "provider_disabled"
	// NoProviderReasonUnavailable: none of the above (e.g. a matching
	// provider exists but is not reachable in the current topology wiring).
	NoProviderReasonUnavailable = "unavailable"
)

// NoProviderError reports that dispatch found no provider for a request and
// why. Path is the request path; AllowedPaths carries the sorted union of
// endpoints declared for the requested model (path_unsupported only);
// DisabledProviders names the providers that could serve model+path but are
// auto-disabled (provider_disabled only).
type NoProviderError struct {
	Model             string
	Path              string
	Reason            string
	AllowedPaths      []string
	DisabledProviders []string
}

// Is keeps errors.Is(err, ErrNoProvider) working for callers that match on
// the sentinel.
func (e *NoProviderError) Is(target error) bool { return target == ErrNoProvider }

func (e *NoProviderError) Error() string {
	msg := fmt.Sprintf("%v for model %s (path %s, reason %s)", ErrNoProvider, e.Model, e.Path, e.Reason)
	if len(e.AllowedPaths) > 0 {
		msg += "; declared endpoints: " + strings.Join(e.AllowedPaths, ", ")
	}
	if len(e.DisabledProviders) > 0 {
		msg += "; auto-disabled providers: " + strings.Join(e.DisabledProviders, ", ")
	}
	return msg
}

// noProviderError classifies a failed dispatch by scanning the enabled
// plans. It distinguishes: the model is unknown (no enabled provider
// declares it); the model exists but no provider allows the request path;
// the model+path are supported but only by auto-disabled providers; and
// "something else" (matching providers exist but the wiring does not reach
// them). Only ever called on the failure path, so the per-plan
// auto-disable queries are acceptable.
func (e *Engine) noProviderError(modelName, path string) *NoProviderError {
	out := &NoProviderError{Model: modelName, Path: path, Reason: NoProviderReasonUnavailable}
	allowed := map[string]struct{}{}

	e.plansMu.RLock()
	defer e.plansMu.RUnlock()

	modelKnown := false
	pathSupportedEnabled := false
	for _, plan := range e.plans {
		if plan == nil || plan.Provider == nil {
			continue
		}
		if !plan.Provider.Status || !plan.Provider.WorkflowEnabled {
			continue
		}
		if _, ok := plan.ModelSet[modelName]; !ok {
			continue
		}
		modelKnown = true
		paths, restricted := plan.endpointsForModel(modelName)
		if restricted {
			for p := range paths {
				allowed[p] = struct{}{}
			}
			if _, ok := paths[path]; !ok {
				continue
			}
		}
		if e.providerDisabled(plan.Provider) {
			out.DisabledProviders = append(out.DisabledProviders, plan.Provider.Name)
		} else {
			pathSupportedEnabled = true
		}
	}

	switch {
	case pathSupportedEnabled:
		out.Reason = NoProviderReasonUnavailable
	case len(out.DisabledProviders) > 0:
		out.Reason = NoProviderReasonProviderDisabled
		out.DisabledProviders = uniqueSortedStrings(out.DisabledProviders)
	case !modelKnown:
		out.Reason = NoProviderReasonModelUnknown
	case len(allowed) > 0:
		out.Reason = NoProviderReasonPathUnsupported
		out.AllowedPaths = sortedKeys(allowed)
	default:
		out.Reason = NoProviderReasonUnavailable
	}
	return out
}

// PathsForModel returns the effective endpoint whitelist for provider+model:
// the model's own declared endpoints when any, else the provider-level
// endpoints; nil means unrestricted. It mirrors ExecutionPlan.AllowsPath
// for callers that only hold the raw rows (the relay handler's
// post-dispatch check). Parsing is deliberately lenient — malformed JSON
// degrades to the next level instead of blocking the request.
func PathsForModel(provider *model.Provider, modelName string) []string {
	if provider == nil {
		return nil
	}
	if strings.TrimSpace(provider.Models) != "" {
		var entries []struct {
			Model     string   `json:"model"`
			Endpoints []string `json:"endpoints"`
		}
		if err := json.Unmarshal([]byte(provider.Models), &entries); err == nil {
			var out []string
			seen := map[string]bool{}
			for _, entry := range entries {
				if strings.TrimSpace(entry.Model) != modelName {
					continue
				}
				for _, ep := range entry.Endpoints {
					if ep = strings.TrimSpace(ep); ep != "" && !seen[ep] {
						seen[ep] = true
						out = append(out, ep)
					}
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	if strings.TrimSpace(provider.Endpoints) != "" {
		var eps []struct {
			PathSuffix string `json:"pathSuffix"`
		}
		if err := json.Unmarshal([]byte(provider.Endpoints), &eps); err == nil {
			var out []string
			seen := map[string]bool{}
			for _, e := range eps {
				if s := strings.TrimSpace(e.PathSuffix); s != "" && !seen[s] {
					seen[s] = true
					out = append(out, s)
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	return nil
}

func sortedKeys(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func uniqueSortedStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
