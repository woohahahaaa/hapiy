package topology

import (
	"encoding/json"
	"testing"
)

func node(id string, kind NodeKind) FlatNode {
	return FlatNode{ID: id, Kind: kind, Enabled: true, Weight: 1}
}

func TestValidateTopologyBasic(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			node("re", KindRequestEntry),
			node("slot-provider", KindSlot),
			node("prov-a", KindProvider),
		},
		Wires: []Wire{
			{Source: "re", Target: "slot-provider"},
			{Source: "slot-provider", Target: "prov-a"},
		},
	}
	if err := ValidateTopology(tp); err != nil {
		t.Fatalf("expected valid topology, got %v", err)
	}
}

func TestValidateTopologyRejectsDuplicateNode(t *testing.T) {
	tp := &Topology{Nodes: []FlatNode{node("re", KindRequestEntry), node("re", KindRequestEntry)}}
	if err := ValidateTopology(tp); err == nil {
		t.Fatalf("expected duplicate id error")
	}
}

func TestValidateTopologyRejectsUnknownWireSource(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{node("re", KindRequestEntry)},
		Wires: []Wire{{Source: "ghost", Target: "re"}},
	}
	if err := ValidateTopology(tp); err == nil {
		t.Fatalf("expected unknown source error")
	}
}

func TestBuildRequestPathFollowsSelectedProviderAtProviderSlot(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "entry", Kind: KindRequestEntry, Enabled: true},
			{ID: "provider-slot", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "provider-moreai", Kind: KindProvider, Name: "MoreAI-Anthropic", Enabled: true},
			{ID: "provider-deepseek", Kind: KindProvider, Name: "deepseek", Enabled: true},
			{ID: "request-modify", Kind: KindSlot, SlotType: "requestModify", Enabled: true},
		},
		Wires: []Wire{
			{Source: "entry", Target: "provider-slot"},
			{Source: "provider-slot", Target: "provider-moreai"},
			{Source: "provider-moreai", Target: "request-modify"},
			{Source: "provider-deepseek", Target: "request-modify"},
		},
	}

	path := BuildRequestPath(tp, "entry", "provider-deepseek", "", nil)
	expected := []string{"entry", "provider-slot", "provider-deepseek", "request-modify"}
	if len(path) != len(expected) {
		t.Fatalf("path length = %d, want %d: %v", len(path), len(expected), path)
	}
	for i, got := range path {
		if got != expected[i] {
			t.Fatalf("path[%d] = %q, want %q: %v", i, got, expected[i], path)
		}
	}
}

func TestBuildRequestPathRoutesSwitchBranch(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "entry", Kind: KindRequestEntry, Enabled: true},
			{ID: "provider-slot", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "provider-a", Kind: KindProvider, Name: "opencode go", ProviderID: "p-opencode", Enabled: true},
			{ID: "switch", Kind: KindSwitch},
			{ID: "auto-yes", Kind: KindSlot, SlotType: "autoSwitch", Enabled: true},
			{ID: "auto-no", Kind: KindSlot, SlotType: "autoSwitch", Enabled: true},
		},
		// 否分支故意排在是分支前面：分支解析必须按 branch 标签而非线序。
		Wires: []Wire{
			{Source: "entry", Target: "provider-slot"},
			{Source: "provider-slot", Target: "provider-a"},
			{Source: "provider-a", Target: "switch"},
			{Source: "switch", Target: "auto-no", Branch: BranchNo},
			{Source: "switch", Target: "auto-yes", Branch: BranchYes},
		},
	}
	wantYes := true
	eval := func(_ json.RawMessage, ctx SwitchEvalContext) bool { return wantYes }

	expectedYes := []string{"entry", "provider-slot", "provider-a", "switch", "auto-yes"}
	if path := BuildRequestPath(tp, "entry", "provider-a", "gpt-4", eval); !equalStrings(path, expectedYes) {
		t.Fatalf("是分支 path = %v, want %v", path, expectedYes)
	}

	wantYes = false
	expectedNo := []string{"entry", "provider-slot", "provider-a", "switch", "auto-no"}
	if path := BuildRequestPath(tp, "entry", "provider-a", "gpt-4", eval); !equalStrings(path, expectedNo) {
		t.Fatalf("否分支 path = %v, want %v", path, expectedNo)
	}

	// 无 eval：维持旧行为（第一条出边）。
	if path := BuildRequestPath(tp, "entry", "provider-a", "", nil); !equalStrings(path, expectedNo) {
		t.Fatalf("nil eval 应走第一条出边 = %v, want %v", path, expectedNo)
	}
}

func TestFindEligibleProvidersTracksSwitchBranchSlotIDs(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "entry", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "provider-slot", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "provider", Kind: KindProvider, Name: "opencode go", ProviderID: "p-opencode", Enabled: true},
			{ID: "switch", Kind: KindSwitch},
			{ID: "auto-yes", Kind: KindSlot, SlotType: "autoSwitch", Enabled: true},
			{ID: "auto-no", Kind: KindSlot, SlotType: "autoSwitch", Enabled: true},
		},
		Wires: []Wire{
			{Source: "entry", Target: "provider-slot"},
			{Source: "provider-slot", Target: "provider"},
			{Source: "provider", Target: "switch"},
			{Source: "switch", Target: "auto-yes", Branch: BranchYes},
			{Source: "switch", Target: "auto-no", Branch: BranchNo},
		},
	}
	refs := map[string]ProviderRef{
		"p-opencode": {ID: "p-opencode", Name: "opencode go", Status: true, Enabled: true, Workflow: true},
	}
	wantYes := true
	eval := func(_ json.RawMessage, _ SwitchEvalContext) bool { return wantYes }

	got, err := FindEligibleProviders(tp, refs, "model", "/v1/chat/completions", eval)
	if err != nil || len(got) != 1 || !equalStrings(got[0].SlotNodeIDs, []string{"provider-slot", "auto-yes"}) {
		t.Fatalf("yes branch slot IDs = %+v, err=%v", got, err)
	}
	wantYes = false
	got, err = FindEligibleProviders(tp, refs, "model", "/v1/chat/completions", eval)
	if err != nil || len(got) != 1 || !equalStrings(got[0].SlotNodeIDs, []string{"provider-slot", "auto-no"}) {
		t.Fatalf("no branch slot IDs = %+v, err=%v", got, err)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestValidateTopologyRejectsMultipleOutputs(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{node("a", KindSlot), node("b", KindSlot), node("c", KindSlot)},
		Wires: []Wire{{Source: "a", Target: "b"}, {Source: "a", Target: "c"}},
	}
	if err := ValidateTopology(tp); err == nil {
		t.Fatalf("expected multiple-output error")
	}
}

func TestValidateTopologyRejectsWeightOutOfRange(t *testing.T) {
	bad := node("re", KindRequestEntry)
	bad.Weight = 2.5
	tp := &Topology{Nodes: []FlatNode{bad}}
	if err := ValidateTopology(tp); err == nil {
		t.Fatalf("expected weight out-of-range error")
	}
}

func TestFindEligibleProvidersBasic(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "re", Kind: KindRequestEntry, Enabled: true, Weight: 0.5},
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
		"deepseek": {
			Name: "deepseek", Status: true, Enabled: true, Workflow: true,
			Models: map[string]struct{}{"deepseek-chat": {}},
		},
	}
	got, err := FindEligibleProviders(tp, refs, "deepseek-chat", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 eligible provider, got %d", len(got))
	}
	if got[0].Weight != 0.5 {
		t.Fatalf("expected weight 0.5, got %v", got[0].Weight)
	}
	if len(got[0].Chain) != 1 || got[0].Chain[0] != "requestModify" {
		t.Fatalf("expected chain [requestModify], got %v", got[0].Chain)
	}
}

func TestFindEligibleProvidersFiltersDisabledEntry(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "re-off", Kind: KindRequestEntry, Enabled: false, Weight: 1},
			{ID: "ps", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "deepseek", Enabled: true},
		},
		Wires: []Wire{
			{Source: "re-off", Target: "ps"},
			{Source: "ps", Target: "prov-a"},
		},
	}
	refs := map[string]ProviderRef{
		"deepseek": {Name: "deepseek", Status: true, Enabled: true, Workflow: true, Models: map[string]struct{}{"deepseek-chat": {}}},
	}
	got, err := FindEligibleProviders(tp, refs, "deepseek-chat", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected 0 eligible with disabled entry, got %d", len(got))
	}
}

func TestFindEligibleProvidersModelMismatch(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			node("re", KindRequestEntry),
			{ID: "ps", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "deepseek", Enabled: true},
		},
		Wires: []Wire{
			{Source: "re", Target: "ps"},
			{Source: "ps", Target: "prov-a"},
		},
	}
	refs := map[string]ProviderRef{
		"deepseek": {Name: "deepseek", Status: true, Enabled: true, Workflow: true, Models: map[string]struct{}{"other": {}}},
	}
	got, _ := FindEligibleProviders(tp, refs, "deepseek-chat", "/v1/chat/completions", nil)
	if len(got) != 0 {
		t.Fatalf("expected 0 eligible on model mismatch, got %d", len(got))
	}
}

func TestFindEligibleProvidersProviderStatusOff(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			node("re", KindRequestEntry),
			{ID: "ps", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "deepseek", Enabled: true},
		},
		Wires: []Wire{
			{Source: "re", Target: "ps"},
			{Source: "ps", Target: "prov-a"},
		},
	}
	refs := map[string]ProviderRef{
		"deepseek": {Name: "deepseek", Status: false, Enabled: true, Workflow: true, Models: map[string]struct{}{"deepseek-chat": {}}},
	}
	got, _ := FindEligibleProviders(tp, refs, "deepseek-chat", "/v1/chat/completions", nil)
	if len(got) != 0 {
		t.Fatalf("expected 0 eligible when provider status off, got %d", len(got))
	}
}

func TestFindEligibleProvidersSequentialSlotFallback(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "re", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "ps", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "duoyuan", Enabled: true},
			{ID: "prov-b", Kind: KindProvider, Name: "moreai", Enabled: true},
			{ID: "prov-off", Kind: KindProvider, Name: "disabled", Enabled: false},
			{ID: "rm", Kind: KindSlot, SlotType: "requestModify", Enabled: true},
		},
		Wires: []Wire{
			{Source: "re", Target: "ps"},
			{Source: "ps", Target: "prov-a"},
			{Source: "prov-a", Target: "rm"},
			{Source: "prov-b", Target: "rm"},
			{Source: "prov-off", Target: "rm"},
		},
	}
	refs := map[string]ProviderRef{
		"duoyuan":  {Name: "duoyuan", Status: true, Enabled: true, Workflow: true, Models: map[string]struct{}{"deepseek-chat": {}}},
		"moreai":   {Name: "moreai", Status: true, Enabled: true, Workflow: true, Models: map[string]struct{}{"minimax-m3": {}}},
		"disabled": {Name: "disabled", Status: true, Enabled: true, Workflow: true, Models: map[string]struct{}{"minimax-m3": {}}},
	}

	// The wired provider doesn't support the model; the slot's next active
	// child (moreai) must be selected, skipping the disabled one.
	got, err := FindEligibleProviders(tp, refs, "minimax-m3", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 eligible provider, got %d", len(got))
	}
	if got[0].Name != "moreai" {
		t.Fatalf("expected fallback to moreai, got %s", got[0].Name)
	}
	if len(got[0].Chain) != 1 || got[0].Chain[0] != "requestModify" {
		t.Fatalf("expected chain [requestModify], got %v", got[0].Chain)
	}

	// The wired provider supports the model: no fallback, it stays primary.
	got, err = FindEligibleProviders(tp, refs, "deepseek-chat", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Name != "duoyuan" {
		t.Fatalf("expected duoyuan to stay primary, got %+v", got)
	}

	// No child supports the model: nothing eligible.
	got, err = FindEligibleProviders(tp, refs, "unknown-model", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected 0 eligible for unknown model, got %d", len(got))
	}
}

func TestFindDuplicateActivationsNone(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			node("re", KindRequestEntry),
			{ID: "ps", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "deepseek", Enabled: true},
		},
		Wires: []Wire{{Source: "re", Target: "ps"}, {Source: "ps", Target: "prov-a"}},
	}
	if got := FindDuplicateActivations(tp); len(got) != 0 {
		t.Fatalf("expected no conflicts, got %+v", got)
	}
}

func TestFindDuplicateActivationsDetectsConflict(t *testing.T) {
	tp := &Topology{
		Nodes: []FlatNode{
			node("re-a", KindRequestEntry),
			node("re-b", KindRequestEntry),
			{ID: "ps-a", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "ps-b", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-x", Kind: KindProvider, Name: "deepseek", Enabled: true},
		},
		Wires: []Wire{
			{Source: "re-a", Target: "ps-a"},
			{Source: "ps-a", Target: "prov-x"},
			{Source: "re-b", Target: "ps-b"},
			{Source: "ps-b", Target: "prov-x"},
		},
	}
	got := FindDuplicateActivations(tp)
	if len(got) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(got))
	}
	if got[0].ProviderName != "deepseek" {
		t.Fatalf("expected conflict on deepseek, got %s", got[0].ProviderName)
	}
	if len(got[0].EntryIDs) != 1 {
		t.Fatalf("expected 1 conflicting entry (the later one), got %v", got[0].EntryIDs)
	}
}

func TestFindDuplicateActivationsDisabledEntrySkips(t *testing.T) {
	off := node("re-off", KindRequestEntry)
	off.Enabled = false
	tp := &Topology{
		Nodes: []FlatNode{
			node("re-a", KindRequestEntry),
			off,
			{ID: "ps-a", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "ps-off", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-x", Kind: KindProvider, Name: "deepseek", Enabled: true},
		},
		Wires: []Wire{
			{Source: "re-a", Target: "ps-a"},
			{Source: "ps-a", Target: "prov-x"},
			{Source: "re-off", Target: "ps-off"},
			{Source: "ps-off", Target: "prov-x"},
		},
	}
	if got := FindDuplicateActivations(tp); len(got) != 0 {
		t.Fatalf("expected no conflict with disabled entry, got %+v", got)
	}
}
