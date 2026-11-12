package topology

import "testing"

// TestNormalizeFlatTopology_wiresMinimalProviderSlot locks the minimal topology
// fix: a provider slot whose cards are adjacent but that has no outgoing wire
// (请求入口 → 供应商插槽 → 供应商) used to be a dispatch dead end. Normalization
// adds slot → primary (first enabled child) so the wire always exists.
func TestNormalizeFlatTopology_wiresMinimalProviderSlot(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "entry", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "pslot", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-off", Kind: KindProvider, Name: "off", Enabled: false},
			{ID: "prov-on", Kind: KindProvider, Name: "on", Enabled: true},
		},
		Wires: []Wire{{Source: "entry", Target: "pslot"}},
	}

	NormalizeFlatTopology(tp)

	found := 0
	for _, w := range tp.Wires {
		if w.Source == "pslot" {
			found++
			if w.Target != "prov-on" {
				t.Fatalf("primary wire targets %q, want the first enabled child %q", w.Target, "prov-on")
			}
		}
	}
	if found != 1 {
		t.Fatalf("provider slot wires = %d, want 1: %+v", found, tp.Wires)
	}
	if err := ValidateTopology(tp); err != nil {
		t.Fatalf("normalized topology must validate: %v", err)
	}

	// Idempotent: a second run must not add a duplicate wire.
	NormalizeFlatTopology(tp)
	found = 0
	for _, w := range tp.Wires {
		if w.Source == "pslot" {
			found++
		}
	}
	if found != 1 {
		t.Fatalf("second normalization added a duplicate wire: %+v", tp.Wires)
	}
}

// TestNormalizeFlatTopology_keepsExistingWiring verifies a slot that already
// wires into a provider chain is left untouched (no second outgoing wire).
func TestNormalizeFlatTopology_keepsExistingWiring(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "entry", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "pslot", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "a", Enabled: true},
			{ID: "rm", Kind: KindSlot, SlotType: "requestModify", Enabled: true},
		},
		Wires: []Wire{
			{Source: "entry", Target: "pslot"},
			{Source: "pslot", Target: "prov-a"},
			{Source: "prov-a", Target: "rm"},
		},
	}

	NormalizeFlatTopology(tp)

	if len(tp.Wires) != 3 {
		t.Fatalf("wires changed: %+v", tp.Wires)
	}
}

// TestNormalizeFlatTopology_ignoresChildlessSlot verifies an empty provider
// slot stays empty — there is no card to wire to.
func TestNormalizeFlatTopology_ignoresChildlessSlot(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "entry", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "pslot", Kind: KindSlot, SlotType: "provider", Enabled: true},
		},
		Wires: []Wire{{Source: "entry", Target: "pslot"}},
	}

	NormalizeFlatTopology(tp)

	if len(tp.Wires) != 1 {
		t.Fatalf("childless slot gained a wire: %+v", tp.Wires)
	}
}

// TestFindEligibleProviders_minimalTopology dispatches through the repaired
// minimal wiring: entry → provider slot → provider, with nothing downstream.
func TestFindEligibleProviders_minimalTopology(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "entry", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "pslot", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "银河gpt-image", ProviderID: "p-image", Enabled: true},
		},
		Wires: []Wire{{Source: "entry", Target: "pslot"}},
	}
	NormalizeFlatTopology(tp)
	refs := map[string]ProviderRef{
		"p-image": {
			ID:       "p-image",
			Name:     "银河gpt-image",
			Status:   true,
			Enabled:  true,
			Workflow: true,
			Models:   map[string]struct{}{"gpt-image-2.6": {}},
			ModelPaths: map[string]map[string]struct{}{
				"gpt-image-2.6": {"/v1/images/edits": {}},
			},
		},
	}

	got, err := FindEligibleProviders(tp, refs, "gpt-image-2.6", "/v1/images/edits", nil)
	if err != nil {
		t.Fatalf("find eligible: %v", err)
	}
	if len(got) != 1 || got[0].ProviderID != "p-image" {
		t.Fatalf("eligible = %+v, want the single minimal provider", got)
	}
	if len(got[0].Chain) != 0 {
		t.Fatalf("chain = %v, want empty (no downstream wired)", got[0].Chain)
	}
	pick, ok := PickEligibleProvider(got, nil)
	if !ok || pick.ProviderID != "p-image" {
		t.Fatalf("pick = %+v (ok=%v), want the minimal provider", pick, ok)
	}
}
