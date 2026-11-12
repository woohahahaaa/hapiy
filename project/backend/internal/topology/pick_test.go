package topology

import "testing"

func pickable(name string, weight float64, strategy string) EligibleProvider {
	return EligibleProvider{
		Node:       FlatNode{ID: name},
		Name:       name,
		ProviderID: name,
		Weight:     weight,
		EntryID:    "re",
		SlotID:     "ps",
		Strategy:   strategy,
	}
}

func TestPickEligibleProviderSequentialPicksFirst(t *testing.T) {
	got, ok := PickEligibleProvider([]EligibleProvider{
		pickable("a", 1, ""),
		pickable("b", 1, ""),
	}, nil)
	if !ok || got.Name != "a" {
		t.Fatalf("sequential: want a, got %+v ok=%v", got, ok)
	}
}

func TestPickEligibleProviderBalancedPicksLeastLoaded(t *testing.T) {
	loads := map[string]int{"a": 3, "b": 1, "c": 0}
	got, ok := PickEligibleProvider([]EligibleProvider{
		pickable("a", 1, StrategyBalanced),
		pickable("b", 1, StrategyBalanced),
		pickable("c", 1, StrategyBalanced),
	}, func(id string) int { return loads[id] })
	if !ok || got.Name != "c" {
		t.Fatalf("balanced: want c (0 in flight), got %+v ok=%v", got, ok)
	}
}

func TestPickEligibleProviderBalancedRotatesIdleProviders(t *testing.T) {
	ResetRoundRobinForTest()
	seen := map[string]int{}
	const n = 100
	for i := 0; i < n; i++ {
		got, ok := PickEligibleProvider([]EligibleProvider{
			pickable("a", 1, StrategyBalanced),
			pickable("b", 1, StrategyBalanced),
		}, func(string) int { return 0 })
		if !ok {
			t.Fatalf("pick %d: not ok", i)
		}
		seen[got.Name]++
	}
	if seen["a"] != n/2 || seen["b"] != n/2 {
		t.Fatalf("balanced should spread idle providers evenly, got %v", seen)
	}
}

func TestPickEligibleProviderBalancedLegacyValues(t *testing.T) {
	for _, legacy := range []string{strategyLegacyRandom, strategyLegacyRoundRobin} {
		ResetRoundRobinForTest()
		got, ok := PickEligibleProvider([]EligibleProvider{
			pickable("a", 1, legacy),
			pickable("b", 1, legacy),
		}, func(id string) int {
			if id == "a" {
				return 2
			}
			return 0
		})
		if !ok || got.Name != "b" {
			t.Fatalf("legacy %q: want balanced pick b, got %+v ok=%v", legacy, got, ok)
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
		got, ok := PickEligibleProvider(providers, nil)
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
	if _, ok := PickEligibleProvider(nil, nil); ok {
		t.Fatalf("expected not ok on empty set")
	}
}
