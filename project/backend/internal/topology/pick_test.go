package topology

import "testing"

func pickable(name string, weight float64, strategy string) EligibleProvider {
	return EligibleProvider{
		Node:     FlatNode{ID: name},
		Name:     name,
		Weight:   weight,
		EntryID:  "re",
		SlotID:   "ps",
		Strategy: strategy,
	}
}

func TestPickEligibleProviderSequentialPicksFirst(t *testing.T) {
	got, ok := PickEligibleProvider([]EligibleProvider{
		pickable("a", 1, ""),
		pickable("b", 1, ""),
	})
	if !ok || got.Name != "a" {
		t.Fatalf("sequential: want a, got %+v ok=%v", got, ok)
	}
}

func TestPickEligibleProviderRandomUsesBoth(t *testing.T) {
	seen := map[string]int{}
	const n = 200
	for i := 0; i < n; i++ {
		got, ok := PickEligibleProvider([]EligibleProvider{
			pickable("a", 1, StrategyRandom),
			pickable("b", 1, StrategyRandom),
		})
		if !ok {
			t.Fatalf("pick %d: not ok", i)
		}
		seen[got.Name]++
	}
	if seen["a"] == 0 || seen["b"] == 0 {
		t.Fatalf("random strategy never picked one child: %v", seen)
	}
}

func TestPickEligibleProviderRoundRobinAlternates(t *testing.T) {
	ResetRoundRobinForTest()
	want := []string{"a", "b", "a", "b"}
	for i, name := range want {
		got, ok := PickEligibleProvider([]EligibleProvider{
			pickable("a", 1, StrategyRoundRobin),
			pickable("b", 1, StrategyRoundRobin),
		})
		if !ok || got.Name != name {
			t.Fatalf("round robin pick %d = %q ok=%v, want %q", i, got.Name, ok, name)
		}
	}
}

func TestPickEligibleProviderEntryWeighted(t *testing.T) {
	// Two entries: "a" weight 1 (only provider), "b" weight 3. Over 200
	// picks the heavier entry must win more often; both must appear.
	seen := map[string]int{}
	const n = 200
	providers := []EligibleProvider{
		pickable("a", 1, ""), pickable("a2", 1, ""),
		pickable("b", 3, ""),
	}
	providers[0].EntryID = "re-a"
	providers[1].EntryID = "re-a"
	providers[2].EntryID = "re-b"
	for i := 0; i < n; i++ {
		got, ok := PickEligibleProvider(providers)
		if !ok {
			t.Fatalf("pick %d: not ok", i)
		}
		seen[got.EntryID]++
	}
	if seen["re-a"] == 0 || seen["re-b"] == 0 {
		t.Fatalf("entry weights never picked one entry: %v", seen)
	}
	if seen["re-b"] <= seen["re-a"] {
		t.Fatalf("expected re-b (weight 3) to dominate re-a (weight 1), got %v", seen)
	}
}

func TestPickEligibleProviderEmpty(t *testing.T) {
	if _, ok := PickEligibleProvider(nil); ok {
		t.Fatalf("expected not ok on empty set")
	}
}