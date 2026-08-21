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

func TestFindEligibleProvidersSequentialDefaultPicksFirst(t *testing.T) {
	tp := dualSlotTopology("")
	got, err := FindEligibleProviders(tp, refsFor("deepseek-a", "deepseek-b"), "deepseek-chat", "/v1/chat/completions")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Name != "deepseek-a" {
		t.Fatalf("sequential default: expected deepseek-a, got %+v", got)
	}
}

func TestFindEligibleProvidersStrategyRandomUsesBoth(t *testing.T) {
	tp := dualSlotTopology(StrategyRandom)
	seen := map[string]int{}
	const n = 200
	for i := 0; i < n; i++ {
		got, err := FindEligibleProviders(tp, refsFor("deepseek-a", "deepseek-b"), "deepseek-chat", "/v1/chat/completions")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got) != 1 {
			t.Fatalf("expected 1 eligible, got %d", len(got))
		}
		seen[got[0].Name]++
	}
	if seen["deepseek-a"] == 0 || seen["deepseek-b"] == 0 {
		t.Fatalf("random strategy never picked one child: %v", seen)
	}
}

func TestFindEligibleProvidersStrategyRoundRobinAlternates(t *testing.T) {
	tp := dualSlotTopology(StrategyRoundRobin)
	ResetRoundRobinForTest()
	want := []string{"deepseek-a", "deepseek-b", "deepseek-a", "deepseek-b"}
	for i, name := range want {
		got, err := FindEligibleProviders(tp, refsFor("deepseek-a", "deepseek-b"), "deepseek-chat", "/v1/chat/completions")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got[0].Name != name {
			t.Fatalf("round robin pick %d = %q, want %q", i, got[0].Name, name)
		}
	}
}

func TestFindEligibleProvidersStrategySkipsIneligibleChild(t *testing.T) {
	tp := dualSlotTopology(StrategyRandom)
	refs := refsFor("deepseek-a") // deepseek-b has no ref: not eligible
	got, err := FindEligibleProviders(tp, refs, "deepseek-chat", "/v1/chat/completions")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Name != "deepseek-a" {
		t.Fatalf("expected only deepseek-a, got %+v", got)
	}
}
