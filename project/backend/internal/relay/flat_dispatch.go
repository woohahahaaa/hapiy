package relay

import (
	"errors"
	"fmt"
	"math/rand"

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
	return provider.AutoDisabled || e.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID)
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
	if len(eligible) == 0 {
		return nil, fmt.Errorf("%w for model %s", ErrNoProvider, model)
	}
	// Weighted selection: each eligible provider carries its request-entry
	// weight in [0,1]. Higher weight => higher chance.
	pick := weightedPick(eligible)
	return &pick, nil
}

// weightedPick returns one eligible provider by weight. All providers with a
// zero weight are eligible but only via the equal fallback; providers with
// positive weight are preferred by their relative weight.
func weightedPick(eligible []topology.EligibleProvider) topology.EligibleProvider {
	total := 0.0
	for _, p := range eligible {
		total += p.Weight
	}
	if total <= 0 {
		return eligible[0]
	}
	// roll is in [0,1); compare against the cumulative fraction cum/total so
	// equal weights yield an equal (uniform) chance. The <= is deliberate:
	// roll can never reach 1.0, so the last provider's boundary (cum==total)
	// is only hit by floating-point rounding, which still picks it.
	roll := rand.Float64()
	cum := 0.0
	for _, p := range eligible {
		cum += p.Weight
		if roll*total <= cum {
			return p
		}
	}
	return eligible[len(eligible)-1]
}

// DispatchResult is the outcome of selecting a provider for a request.
type DispatchResult struct {
	Plan         *ExecutionPlan
	Provider     *model.Provider
	KeyIndex     int
	BaseURLIndex int
	// AffinityMatch, when non-nil, means the provider was chosen via channel
	// affinity; the handler records the successful recall on request success.
	AffinityMatch *affinity.MatchResult
	// PathNodeIDs is the exact node path the request traverses
	// (entry -> provider -> slots), captured at dispatch time. Empty when
	// the request was served outside the flat-topology walk (affinity recall).
	PathNodeIDs []string
	Origin      *topology.RequestOrigin
}

// Dispatch selects a provider for a request and builds its execution plan. It
// consults channel affinity first (when enabled and a rule matches), then falls
// back to flat-topology weighted selection. The returned plan is restricted to
// the provider's reachable slot types in the wiring.
func (e *Engine) Dispatch(model, path string, affinityReq *affinity.Request) (*DispatchResult, error) {
	if affinityReq != nil && e.Affinity() != nil {
		match := e.Affinity().Lookup(affinityReq)
		if match.Matched {
			provider, plan, err := e.buildPlanForProvider(match.Triple.ProviderName, match.Triple.ProviderName, nil)
			if err == nil && !e.providerDisabled(provider) {
				return &DispatchResult{
					Plan:          plan,
					Provider:      provider,
					KeyIndex:      match.Triple.KeyIndex,
					BaseURLIndex:  match.Triple.BaseURLIndex,
					AffinityMatch: &match,
				}, nil
			}
			e.Affinity().Delete(match.CacheKey)
		}
	}

	tp, err := topology.NewStore(e.db).Load()
	if err != nil {
		return nil, err
	}
	if tp != nil && len(tp.Nodes) > 0 {
		eligible, err := e.SelectByFlatTopology(tp, model, path)
		if err != nil {
			// Topology exists but yields no eligible provider: reject, never
			// degrade to SelectProvider (it ignores topology switches/wires).
			return nil, err
		}
		if eligible != nil {
			provider, plan, err := e.buildPlanForProvider(eligible.ProviderID, eligible.Name, eligible.Chain)
			if err != nil {
				return nil, err
			}
			return &DispatchResult{
				Plan:         plan,
				Provider:     provider,
				KeyIndex:     -1,
				BaseURLIndex: -1,
				PathNodeIDs:  topology.BuildRequestPath(tp, eligible.EntryID, eligible.Node.ID),
				Origin:       &topology.RequestOrigin{EntryID: eligible.EntryID, ProviderSlotID: providerSlotID(tp, eligible.EntryID), ProviderID: provider.ID},
			}, nil
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
	return &DispatchResult{Plan: plan, Provider: provider, KeyIndex: -1, BaseURLIndex: -1}, nil
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
		if !wanted[assignment.SlotType] {
			continue
		}
		if err := e.populateAssignment(db, plan, assignment); err != nil {
			return err
		}
	}
	plan.DebugEnabled = false
	return nil
}
