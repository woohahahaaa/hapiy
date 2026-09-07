package topology

import "testing"

func refsFor(names ...string) map[string]ProviderRef {
	refs := map[string]ProviderRef{}
	for _, n := range names {
		refs[n] = ProviderRef{
			Name: n, Status: true, Enabled: true, Workflow: true,
			Models: map[string]struct{}{"deepseek-chat": {}},
		}
	}
	return refs
}

// dualSlotTopology is an entry wired into a provider slot with two provider
// children, both eligible for deepseek-chat.
func dualSlotTopology(strategy string) *Topology {
	slot := FlatNode{ID: "ps", Kind: KindSlot, SlotType: "provider", Enabled: true}
	if strategy != "" {
		slot.Strategy = strategy
	}
	return &Topology{
		Nodes: []FlatNode{
			{ID: "re", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			slot,
			{ID: "prov-a", Kind: KindProvider, Name: "deepseek-a", Enabled: true},
			{ID: "prov-b", Kind: KindProvider, Name: "deepseek-b", Enabled: true},
			{ID: "rm", Kind: KindSlot, SlotType: "requestModify", Enabled: true},
		},
		Wires: []Wire{
			{Source: "re", Target: "ps"},
			{Source: "ps", Target: "prov-a"},
			{Source: "prov-a", Target: "rm"},
			{Source: "prov-b", Target: "rm"},
		},
	}
}

func TestValidateTopologyRejectsUnknownStrategy(t *testing.T) {
	bad := node("re", KindRequestEntry)
	bad.Strategy = "chaos"
	tp := &Topology{Nodes: []FlatNode{bad}}
	if err := ValidateTopology(tp); err == nil {
		t.Fatalf("expected unknown strategy error")
	}
}

func TestFindEligibleProvidersSequentialReturnsAllInOrder(t *testing.T) {
	tp := dualSlotTopology("")
	got, err := FindEligibleProviders(tp, refsFor("deepseek-a", "deepseek-b"), "deepseek-chat", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 || got[0].Name != "deepseek-a" || got[1].Name != "deepseek-b" {
		t.Fatalf("sequential: expected both children in display order, got %+v", got)
	}
	for _, p := range got {
		if p.Strategy != "" || p.SlotID != "ps" {
			t.Fatalf("expected slot metadata (strategy %q slot %q) on %s", p.Strategy, p.SlotID, p.Name)
		}
	}
}

func TestFindEligibleProvidersRandomReturnsAll(t *testing.T) {
	tp := dualSlotTopology(StrategyRandom)
	got, err := FindEligibleProviders(tp, refsFor("deepseek-a", "deepseek-b"), "deepseek-chat", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("random strategy: expected both children eligible, got %d", len(got))
	}
	if got[0].Strategy != StrategyRandom || got[0].SlotID != "ps" {
		t.Fatalf("expected strategy random on candidate, got %q", got[0].Strategy)
	}
}

func TestFindEligibleProvidersRoundRobinReturnsAll(t *testing.T) {
	tp := dualSlotTopology(StrategyRoundRobin)
	got, err := FindEligibleProviders(tp, refsFor("deepseek-a", "deepseek-b"), "deepseek-chat", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("round robin strategy: expected both children eligible, got %d", len(got))
	}
}

func TestFindEligibleProvidersStrategySkipsIneligibleChild(t *testing.T) {
	tp := dualSlotTopology(StrategyRandom)
	refs := refsFor("deepseek-a") // deepseek-b has no ref: not eligible
	got, err := FindEligibleProviders(tp, refs, "deepseek-chat", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Name != "deepseek-a" {
		t.Fatalf("expected only deepseek-a, got %+v", got)
	}
}

func TestFindEligibleProvidersMatchesByProviderIDOnRename(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "re", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "ps", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "deepseek-old-name", ProviderID: "p-123", Enabled: true},
			{ID: "rm", Kind: KindSlot, SlotType: "requestModify", Enabled: true},
		},
		Wires: []Wire{
			{Source: "re", Target: "ps"},
			{Source: "ps", Target: "prov-a"},
			{Source: "prov-a", Target: "rm"},
		},
	}
	// The provider was renamed: refs are keyed by the NEW name, but the node
	// binds by provider_id, so it must still resolve.
	refs := map[string]ProviderRef{
		"deepseek": {ID: "p-123", Name: "deepseek", Status: true, Enabled: true, Workflow: true,
			Models: map[string]struct{}{"deepseek-chat": {}}},
		"p-123": {ID: "p-123", Name: "deepseek", Status: true, Enabled: true, Workflow: true,
			Models: map[string]struct{}{"deepseek-chat": {}}},
	}
	got, err := FindEligibleProviders(tp, refs, "deepseek-chat", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 eligible provider, got %d", len(got))
	}
	if got[0].ProviderID != "p-123" {
		t.Fatalf("expected bound provider id p-123, got %q", got[0].ProviderID)
	}
}

func TestProviderEligibleLegacyNameOnlyBindingStillMatches(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "re", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "ps", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "deepseek", Enabled: true},
			{ID: "rm", Kind: KindSlot, SlotType: "requestModify", Enabled: true},
		},
		Wires: []Wire{
			{Source: "re", Target: "ps"},
			{Source: "ps", Target: "prov-a"},
			{Source: "prov-a", Target: "rm"},
		},
	}
	refs := map[string]ProviderRef{
		"deepseek": {ID: "p-123", Name: "deepseek", Status: true, Enabled: true, Workflow: true,
			Models: map[string]struct{}{"deepseek-chat": {}}},
	}
	got, err := FindEligibleProviders(tp, refs, "deepseek-chat", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Name != "deepseek" {
		t.Fatalf("legacy name binding failed: %+v", got)
	}
}
