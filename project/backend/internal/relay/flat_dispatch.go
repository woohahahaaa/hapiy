package relay

import (
	"errors"
	"fmt"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/topology"
	"gorm.io/gorm"
)

// ErrNoProvider is returned when no enabled provider supports the requested
// model. It lets the handler distinguish "nothing could serve this request"
// from genuine upstream failures.
var ErrNoProvider = errors.New("no provider available")

// buildFlatProviderRefs builds ProviderRef values for every enabled provider
// known to the engine, keyed by provider name. It reflects the provider's
// Status, its supported model set, and the set of allowed endpoint paths
// (empty set means "any path", matching ProviderRef.Paths semantics).
func (e *Engine) buildFlatProviderRefs() map[string]topology.ProviderRef {
	e.plansMu.RLock()
	defer e.plansMu.RUnlock()
	refs := make(map[string]topology.ProviderRef, len(e.plans)*2)
	for _, plan := range e.plans {
		if plan == nil || plan.Provider == nil {
			continue
		}
		ref := topology.ProviderRef{
			ID:       plan.Provider.ID,
			Name:     plan.Provider.Name,
			Status:   plan.Provider.Status,
			Disabled: e.providerDisabled(plan.Provider),
			Enabled:  true, // provider node mini-switch is checked in the flat walk
			Workflow: plan.Provider.WorkflowEnabled,
			Models:   plan.ModelSet,
			Paths:    plan.AllowedPaths,
		}
		// Bound by ID and by name: nodes carry the stable provider_id and
		// fall back to the legacy name-only binding. refKey() picks the same
		// key the node stores.
		refs[ref.ID] = ref
		refs[ref.Name] = ref
	}
	return refs
}

func (e *Engine) providerDisabled(provider *model.Provider) bool {
	return e.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID)
}

// SelectByFlatTopology chooses a provider for a request using the flat topology
// wiring: it walks the active request entries, gathers eligible providers that
// support the model (and path, when a provider declares paths), then applies
// the entry weights. If no provider is eligible it returns an error.
func (e *Engine) SelectByFlatTopology(tp *topology.Topology, model, path string) (*topology.EligibleProvider, error) {
	if tp == nil || len(tp.Nodes) == 0 {
		return nil, fmt.Errorf("flat topology is empty")
	}
	refs := e.buildFlatProviderRefs()
	eligible, err := topology.FindEligibleProviders(tp, refs, model, path)
	if err != nil {
		return nil, err
	}
	pick, ok := topology.PickEligibleProvider(eligible)
	if !ok {
		return nil, fmt.Errorf("%w for model %s", ErrNoProvider, model)
	}
	return &pick, nil
}

// Channel-reuse states recorded per request after a channel-affinity match.
const (
	// AffinityReuseNone: an affinity rule matched but nothing of the last
	// channel could be reused — the request fell through to normal selection.
	AffinityReuseNone = "none"
	// AffinityReusePartial: part of the last channel (provider, baseURL or
	// key) was reused, but not the exact same provider+baseURL+key triple.
	AffinityReusePartial = "partial"
	// AffinityReuseFull: the exact last provider+baseURL+key triple was
	// reused as-is.
	AffinityReuseFull = "full"
)

// DispatchResult is the outcome of selecting a provider for a request.
type DispatchResult struct {
	Plan         *ExecutionPlan
	Provider     *model.Provider
	KeyIndex     int
	BaseURLIndex int
	// EntryID is the request entry whose workflow served the request;
	// empty on the legacy provider scan (no topology).
	EntryID string
	// AffinityMatch, when non-nil, means the provider was chosen via channel
	// affinity; the handler records the successful recall on request success.
	AffinityMatch *affinity.MatchResult
	// AffinityReuse records how much of the last channel was reused:
	// empty when no affinity rule matched, otherwise one of the
	// AffinityReuse* constants.
	AffinityReuse string
	// AffinityReuseParts lists which dimensions of the last channel were
	// reused ("provider", "baseurl", "key"); empty when AffinityReuse is
	// empty or the request created a fresh channel.
	AffinityReuseParts []string
	// PathNodeIDs is the exact node path the request traverses
	// (entry -> provider -> slots), captured at dispatch time. Empty when
	// the request was served outside the flat-topology walk (affinity recall).
	PathNodeIDs []string
	Origin      *topology.RequestOrigin
}

// channelHint is the (provider, key, baseURL) tuple a channel-affinity
// match (fallback history or affinity rule) wants to reuse. entryID scopes
// the reuse to the request entry the channel was last used through; empty
// disables the scope (legacy history rows).
type channelHint struct {
	providerID   string
	providerName string
	keyIndex     int
	baseURLIndex int
	entryID      string
}

// affinityCandidate is a provider that can currently serve this request.
type affinityCandidate struct {
	provider *model.Provider
	plan     *ExecutionPlan
	entryID  string
}

// Dispatch selects a provider for a request and builds its execution plan. It
// consults the fallback channel affinity first (last-used channel for the
// request's session_id+model), then configured affinity rules, then the
// flat-topology weighted selection. A channel-affinity hit is only honored
// when it is still inside the current eligible set; otherwise it degrades by
// priority (provider -> baseURL -> key) before falling through to normal
// selection. The returned plan is restricted to the provider's reachable
// slot types in the wiring.
func (e *Engine) Dispatch(model, path string, affinityReq *affinity.Request) (*DispatchResult, error) {
	tp, err := topology.NewStore(e.db).Load()
	if err != nil {
		return nil, err
	}
	hasTopology := tp != nil && len(tp.Nodes) > 0

	var ruleMatch affinity.MatchResult
	var weakAffinityMatch *affinity.MatchResult
	if affinityReq != nil && e.Affinity() != nil {
		match := e.Affinity().Lookup(affinityReq)
		ruleMatch = match
		if match.RuleName != "" {
			weakAffinityMatch = &match
		}
	}

	if hasTopology {
		// 普通趟：兜底亲和 → 规则亲和 → 普通入口加权选择。
		if result, err := e.dispatchLane(model, path, affinityReq, tp, false, &ruleMatch); result != nil || err != nil {
			return result, err
		}
		// 应急趟：只有普通趟完全无候选时才进入；亲和命中只会在应急入口
		// 下游的渠道里解析，普通侧恢复后自然回切。
		if topology.HasEmergencyEntries(tp) {
			if result, err := e.dispatchLane(model, path, affinityReq, tp, true, &ruleMatch); result != nil || err != nil {
				return result, err
			}
		}
		return nil, fmt.Errorf("%w for model %s", ErrNoProvider, model)
	}

	// 无拓扑 legacy 路径
	if affinityReq != nil {
		if fallback := e.lookupFallbackAffinity(affinityReq); fallback.matched {
			if result, used := e.dispatchWithChannelHint(model, path, channelHint{
				providerID:   fallback.providerID,
				providerName: fallback.providerName,
				keyIndex:     fallback.keyIndex,
				baseURLIndex: fallback.baseURLIndex,
				entryID:      fallback.entryID,
			}, false); used {
				return result, nil
			}
		}
		if ruleMatch.Matched {
			if result, used := e.dispatchWithChannelHint(model, path, channelHint{
				providerName: ruleMatch.Triple.ProviderName,
				keyIndex:     ruleMatch.Triple.KeyIndex,
				baseURLIndex: ruleMatch.Triple.BaseURLIndex,
				entryID:      ruleMatch.Triple.EntryID,
			}, false); used {
				result.AffinityMatch = &ruleMatch
				return result, nil
			}
			e.Affinity().Delete(ruleMatch.CacheKey)
		}
	}

	provider, err := e.SelectProvider(model, path)
	if err != nil {
		return nil, err
	}
	plan, err := e.GetPlan(provider.ID)
	if err != nil {
		return nil, err
	}
	return &DispatchResult{
		Plan:          plan,
		Provider:      provider,
		KeyIndex:      -1,
		BaseURLIndex:  -1,
		AffinityMatch: weakAffinityMatch,
	}, nil
}

// dispatchLane runs one lane of the two-pass dispatch: fallback affinity,
// then rule affinity, then weighted selection over that lane's request
// entries. emergency=false walks 普通入口, emergency=true walks 应急请求入口.
// A nil result (with nil error) means the lane had nothing to serve the
// request with and the caller should try the next lane.
func (e *Engine) dispatchLane(model, path string, affinityReq *affinity.Request, tp *topology.Topology, emergency bool, ruleMatch *affinity.MatchResult) (*DispatchResult, error) {
	if affinityReq != nil {
		if fallback := e.lookupFallbackAffinity(affinityReq); fallback.matched {
			if result, used := e.dispatchWithChannelHint(model, path, channelHint{
				providerID:   fallback.providerID,
				providerName: fallback.providerName,
				keyIndex:     fallback.keyIndex,
				baseURLIndex: fallback.baseURLIndex,
				entryID:      fallback.entryID,
			}, emergency); used {
				return result, nil
			}
		}
		if ruleMatch != nil && ruleMatch.Matched && e.Affinity() != nil {
			if result, used := e.dispatchWithChannelHint(model, path, channelHint{
				providerName: ruleMatch.Triple.ProviderName,
				keyIndex:     ruleMatch.Triple.KeyIndex,
				baseURLIndex: ruleMatch.Triple.BaseURLIndex,
				entryID:      ruleMatch.Triple.EntryID,
			}, emergency); used {
				match := *ruleMatch
				result.AffinityMatch = &match
				return result, nil
			}
			// 普通趟里应急入口命中的条目不算失效（留给应急趟）；其余
			// 未复用的缓存条目按 stale 删除，避免再次召回。
			if emergency || !topology.EntryIsEmergency(tp, ruleMatch.Triple.EntryID) {
				e.Affinity().Delete(ruleMatch.CacheKey)
			}
		}
	}

	eligible, err := e.selectByFlatTopologyLane(tp, model, path, emergency)
	if err != nil {
		return nil, err
	}
	if eligible == nil {
		return nil, nil
	}
	provider, plan, err := e.buildPlanForProvider(eligible.ProviderID, eligible.Name, eligible.Chain)
	if err != nil {
		return nil, err
	}
	var weak *affinity.MatchResult
	if ruleMatch != nil && ruleMatch.RuleName != "" {
		match := *ruleMatch
		weak = &match
	}
	return &DispatchResult{
		Plan:          plan,
		Provider:      provider,
		KeyIndex:      -1,
		BaseURLIndex:  -1,
		EntryID:       eligible.EntryID,
		AffinityMatch: weak,
		PathNodeIDs:   topology.BuildRequestPath(tp, eligible.EntryID, eligible.Node.ID),
		Origin:        &topology.RequestOrigin{EntryID: eligible.EntryID, ProviderSlotID: providerSlotID(tp, eligible.EntryID), ProviderID: provider.ID},
	}, nil
}

// selectByFlatTopologyLane chooses a provider within one lane. It returns
// (nil, nil) when the lane has no eligible provider for the request.
func (e *Engine) selectByFlatTopologyLane(tp *topology.Topology, model, path string, emergency bool) (*topology.EligibleProvider, error) {
	refs := e.buildFlatProviderRefs()
	eligible, err := topology.FindEligibleProvidersOfLane(tp, refs, model, path, emergency)
	if err != nil {
		return nil, err
	}
	pick, ok := topology.PickEligibleProvider(eligible)
	if !ok {
		return nil, nil
	}
	return &pick, nil
}

// dispatchWithChannelHint resolves a channel-affinity hint against the set of
// providers currently eligible for this request. The hint is scoped to its
// request entry (when set): candidates from other entries are ignored. Within
// the scope: the hinted provider itself -> any eligible provider carrying the
// hinted baseURL -> any eligible provider carrying the hinted key. Returns
// used=false when nothing matches, so the caller falls through to normal
// selection. Hints only resolve against providers in the requested lane
// (emergency=false 普通入口, emergency=true 应急请求入口), which is what keeps
// the two affinity environments isolated.
func (e *Engine) dispatchWithChannelHint(model, path string, hint channelHint, emergency bool) (*DispatchResult, bool) {
	candidates := e.eligibleAffinityCandidates(model, path, emergency)
	tp, _ := topology.NewStore(e.db).Load()
	if len(candidates) == 0 {
		return nil, false
	}
	if hint.entryID != "" {
		scoped := candidates[:0:0]
		for _, c := range candidates {
			if c.entryID == hint.entryID {
				scoped = append(scoped, c)
			}
		}
		candidates = scoped
		if len(candidates) == 0 {
			return nil, false
		}
	}

	// 1) The hinted provider is still eligible: use it. Full reuse only when
	// the hinted key and baseURL indices are both still valid on this plan;
	// otherwise it is a partial reuse and the relay layer falls back to the
	// first enabled key/baseURL.
	for _, c := range candidates {
		if (hint.providerID != "" && c.provider.ID == hint.providerID) ||
			(hint.providerName != "" && c.provider.Name == hint.providerName) {
			reuse := AffinityReusePartial
			if hint.keyIndex >= 0 && hint.keyIndex < len(c.plan.Keys) &&
				hint.baseURLIndex >= 0 && hint.baseURLIndex < len(c.plan.BaseURLs) {
				reuse = AffinityReuseFull
			}
			result := &DispatchResult{
				Plan:          c.plan,
				Provider:      c.provider,
				KeyIndex:      hint.keyIndex,
				BaseURLIndex:  hint.baseURLIndex,
				EntryID:       c.entryID,
				AffinityReuse: reuse,
				PathNodeIDs:   affinityRequestPath(tp, c.entryID, c.provider),
			}
			result.AffinityReuseParts = e.reuseParts(hint, result)
			return result, true
		}
	}

	// 2) The hinted baseURL exists on another eligible provider: partial reuse.
	baseURL := e.hintBaseURL(hint)
	if baseURL != "" {
		for _, c := range candidates {
			for bi, u := range c.plan.BaseURLs {
				if u == baseURL {
					result := &DispatchResult{
						Plan:          c.plan,
						Provider:      c.provider,
						KeyIndex:      hint.keyIndex,
						BaseURLIndex:  bi,
						EntryID:       c.entryID,
						AffinityReuse: AffinityReusePartial,
						PathNodeIDs:   affinityRequestPath(tp, c.entryID, c.provider),
					}
					result.AffinityReuseParts = e.reuseParts(hint, result)
					return result, true
				}
			}
		}
	}

	// 3) The hinted key exists on another eligible provider: partial reuse.
	key := e.hintKey(hint)
	if key != "" {
		for _, c := range candidates {
			for ki, k := range c.plan.Keys {
				if k == key {
					result := &DispatchResult{
						Plan:          c.plan,
						Provider:      c.provider,
						KeyIndex:      ki,
						BaseURLIndex:  hint.baseURLIndex,
						EntryID:       c.entryID,
						AffinityReuse: AffinityReusePartial,
						PathNodeIDs:   affinityRequestPath(tp, c.entryID, c.provider),
					}
					result.AffinityReuseParts = e.reuseParts(hint, result)
					return result, true
				}
			}
		}
	}

	return nil, false
}

// reuseParts computes which dimensions of the hinted channel the final result
// actually reused, by comparing the hint's values against the selected plan.
func (e *Engine) reuseParts(hint channelHint, result *DispatchResult) []string {
	var parts []string
	if result.Provider != nil &&
		((hint.providerID != "" && hint.providerID == result.Provider.ID) ||
			(hint.providerName != "" && hint.providerName == result.Provider.Name)) {
		parts = append(parts, "provider")
	}
	if result.Plan != nil {
		if url := e.hintBaseURL(hint); url != "" &&
			result.BaseURLIndex >= 0 && result.BaseURLIndex < len(result.Plan.BaseURLs) &&
			result.Plan.BaseURLs[result.BaseURLIndex] == url {
			parts = append(parts, "baseurl")
		}
		if key := e.hintKey(hint); key != "" &&
			result.KeyIndex >= 0 && result.KeyIndex < len(result.Plan.Keys) &&
			result.Plan.Keys[result.KeyIndex] == key {
			parts = append(parts, "key")
		}
	}
	return parts
}

// eligibleAffinityCandidates builds the current eligible provider set for a
// request: the flat-topology walk when a topology exists (it filters model,
// endpoints, node switches and slot strategy), otherwise every usable
// provider that supports the model/path. This is the "可选集合" the affinity
// hint is validated against.
func (e *Engine) eligibleAffinityCandidates(modelName, path string, emergency bool) []affinityCandidate {
	if tp, err := topology.NewStore(e.db).Load(); err == nil && tp != nil && len(tp.Nodes) > 0 {
		refs := e.buildFlatProviderRefs()
		if eligible, err := topology.FindEligibleProvidersOfLane(tp, refs, modelName, path, emergency); err == nil {
			candidates := make([]affinityCandidate, 0, len(eligible))
			for _, el := range eligible {
				provider, plan, err := e.buildPlanForProvider(el.ProviderID, el.Name, el.Chain)
				if err != nil {
					continue
				}
				candidates = append(candidates, affinityCandidate{provider: provider, plan: plan, entryID: el.EntryID})
			}
			return candidates
		}
	}

	e.providersMu.RLock()
	providers := make([]*model.Provider, 0, len(e.providers))
	for _, p := range e.providers {
		providers = append(providers, p)
	}
	e.providersMu.RUnlock()

	candidates := make([]affinityCandidate, 0, len(providers))
	for _, p := range providers {
		if !p.Status || !p.WorkflowEnabled || e.providerDisabled(p) {
			continue
		}
		provider, plan, err := e.buildPlanForProvider(p.ID, p.Name, nil)
		if err != nil {
			continue
		}
		if !affinityPlanSupports(plan, modelName, path) {
			continue
		}
		candidates = append(candidates, affinityCandidate{provider: provider, plan: plan})
	}
	return candidates
}

// affinityPlanSupports reports whether a compiled plan can serve the request
// model and path (mirrors the flat-topology providerSupports check).
func affinityPlanSupports(plan *ExecutionPlan, model, path string) bool {
	if len(plan.ModelSet) > 0 {
		if _, ok := plan.ModelSet[model]; !ok {
			return false
		}
	}
	if len(plan.AllowedPaths) > 0 {
		if _, ok := plan.AllowedPaths[path]; !ok {
			return false
		}
	}
	return true
}

// hintBaseURL returns the baseURL value the hint's baseURLIndex refers to on
// the hinted provider, or "" when the provider/plan/index is unavailable.
func (e *Engine) hintBaseURL(hint channelHint) string {
	plan := e.hintPlan(hint)
	if plan == nil || hint.baseURLIndex < 0 || hint.baseURLIndex >= len(plan.BaseURLs) {
		return ""
	}
	return plan.BaseURLs[hint.baseURLIndex]
}

// hintKey returns the key value the hint's keyIndex refers to on the hinted
// provider, or "" when the provider/plan/index is unavailable.
func (e *Engine) hintKey(hint channelHint) string {
	plan := e.hintPlan(hint)
	if plan == nil || hint.keyIndex < 0 || hint.keyIndex >= len(plan.Keys) {
		return ""
	}
	return plan.Keys[hint.keyIndex]
}

// hintPlan resolves the hinted provider's execution plan by ID or name.
func (e *Engine) hintPlan(hint channelHint) *ExecutionPlan {
	_, plan, err := e.buildPlanForProvider(hint.providerID, hint.providerName, nil)
	if err != nil || plan == nil {
		return nil
	}
	return plan
}

func providerSlotID(tp *topology.Topology, entryID string) string {
	if tp == nil {
		return ""
	}
	for _, wire := range tp.Wires {
		if wire.Source != entryID {
			continue
		}
		for _, node := range tp.Nodes {
			if node.ID == wire.Target && node.Kind == topology.KindSlot && node.SlotType == "provider" {
				return node.ID
			}
		}
	}
	return ""
}

// buildPlanForProvider builds (or reuses) an execution plan for a provider.
// When chain is non-nil the plan is restricted to those slot types. The
// provider is resolved by stable ID when available, falling back to the
// legacy name binding.
func (e *Engine) buildPlanForProvider(providerID, name string, chain []string) (*model.Provider, *ExecutionPlan, error) {
	var provider *model.Provider
	var err error
	if providerID != "" {
		provider, err = e.getProviderByID(providerID)
		if err != nil {
			provider = nil
		}
	}
	if provider == nil {
		provider, err = e.getProviderByName(name)
		if err != nil {
			return nil, nil, fmt.Errorf("provider %q (id %q) not found", name, providerID)
		}
	}
	plan := &ExecutionPlan{ID: provider.ID, Provider: provider}
	if chain != nil {
		if err := e.populatePlanWithSlots(e.db, plan, chain); err != nil {
			return nil, nil, err
		}
	} else if err := e.populatePlan(e.db, plan); err != nil {
		return nil, nil, err
	}
	return provider, plan, nil
}

// getProviderByID looks up a provider by its stable record ID.
func (e *Engine) getProviderByID(id string) (*model.Provider, error) {
	e.providersMu.RLock()
	defer e.providersMu.RUnlock()
	for _, p := range e.providers {
		if p.ID == id {
			return p, nil
		}
	}
	return nil, fmt.Errorf("provider %q not found", id)
}

// getProviderByName looks up a provider by its configured Name.
func (e *Engine) getProviderByName(name string) (*model.Provider, error) {
	e.providersMu.RLock()
	defer e.providersMu.RUnlock()
	for _, p := range e.providers {
		if p.Name == name {
			return p, nil
		}
	}
	return nil, fmt.Errorf("provider %q not found", name)
}

// populatePlanWithSlots compiles a plan restricted to the slot types reachable
// in the flat wiring chain. It mirrors populatePlan but only loads enabled
// assignments whose slot_type is listed in chain, preserving the canonical
// stage order.
func (e *Engine) populatePlanWithSlots(db *gorm.DB, plan *ExecutionPlan, chain []string) error {
	if err := decodeStringList(plan.Provider.ID, plan.Provider.BaseURLs, &plan.BaseURLs, "base_urls"); err != nil {
		return err
	}
	if err := decodeStringList(plan.Provider.ID, plan.Provider.Keys, &plan.Keys, "keys"); err != nil {
		return err
	}
	if err := decodeModelSet(plan.Provider.ID, plan.Provider.Models, &plan.ModelSet); err != nil {
		return err
	}
	if err := decodeEndpointSet(plan.Provider.ID, plan.Provider.Endpoints, &plan.AllowedPaths); err != nil {
		return err
	}

	wanted := make(map[string]bool, len(chain))
	for _, st := range chain {
		wanted[st] = true
	}

	var assignments []model.TopologySlotAssignment
	orderClause := `CASE slot_type
		WHEN 'requestModify' THEN 0 WHEN 'responseModify' THEN 1
		WHEN 'autoReply' THEN 2 WHEN 'concurrency' THEN 3
		WHEN 'autoSwitch' THEN 4 WHEN 'logOutput' THEN 5 ELSE 6 END,
		"order" ASC, id ASC`
	if err := db.Where("provider_id = ? AND enabled = ?", plan.Provider.ID, true).
		Order(orderClause).Find(&assignments).Error; err != nil {
		return fmt.Errorf("load topology assignments: %w", err)
	}
	for _, assignment := range assignments {
		if assignment.SlotType != "autoSwitch" && !wanted[assignment.SlotType] {
			continue
		}
		if err := e.populateAssignment(db, plan, assignment); err != nil {
			return err
		}
	}
	plan.DebugEnabled = false
	return nil
}

// affinityRequestPath builds the exact node path an affinity-reused request
// traverses: it is served through the same request entry and provider node in
// the topology, so its path is just as well-defined as a regular dispatch.
func affinityRequestPath(tp *topology.Topology, entryID string, provider *model.Provider) []string {
	if tp == nil || entryID == "" || provider == nil {
		return nil
	}
	for _, n := range tp.Nodes {
		if n.Kind != topology.KindProvider {
			continue
		}
		if (n.ProviderID != "" && n.ProviderID == provider.ID) || n.Name == provider.Name {
			return topology.BuildRequestPath(tp, entryID, n.ID)
		}
	}
	return nil
}
