package topology

import "testing"

func refsFor(names ...string) map[string]ProviderRef {
	m := map[string]ProviderRef{}
	for _, n := range names {
		m[n] = ProviderRef{Name: n}
	}
	return m
}

func dualSlotTopology(strategy string) *Topology {
	slot := FlatNode{ID: "slot-p", Kind: KindSlot, SlotType: "provider", Enabled: true}
	return &Topology{
		Nodes: []FlatNode{
			{ID: "entry", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "entry-x", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			slot,
			{ID: "prov-a", Kind: KindProvider, Name: "galaxy-gpt", Enabled: true},
			{ID: "prov-b", Kind: KindProvider, Name: "galaxy-gpt", Enabled: true},
			{ID: "modify", Kind: KindSlot, SlotType: "requestModify", Enabled: true},
		},
		Wires: []Wire{
			{Source: "entry", Target: "slot-p"},
			{Source: "entry-x", Target: "slot-p"},
			{Source: "slot-p", Target: "prov-a"},
			{Source: "prov-b", Target: "modify"},
		},
	}
}

func TestFindEligibleProvidersSameProviderTwoEntriesWeightsPick(t *testing.T) {
	tp := dualSlotTopology(StrategyRandom)
	got, err := FindEligibleProviders(tp, refsFor("galaxy-gpt", "galaxy-gpt"), "galaxy-v4", "/v1/chat/completions")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 eligible providers, got %d", len(got))
	}
	picked := map[string]int{}
	for i := 0; i < 300; i++ {
		p, err := FindEligibleProviders(tp, refsFor("galaxy-gpt", "galaxy-gpt"), "galaxy-v4", "/v1/chat/completions")
		if err != nil {
			t.Fatalf("pick %d: %v", i, err)
		}
		if len(p) != 1 {
			t.Fatalf("pick %d: want 1, got %d", i, len(p))
		}
		picked[p[0].EntryID]++
	}
	if picked[got[0].EntryID] == 0 || picked[got[1].EntryID] == 0 {
		t.Fatalf("both entries must be picked across runs: %v", picked)
	}
}
