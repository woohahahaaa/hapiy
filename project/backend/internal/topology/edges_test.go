package topology

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func strPtr2(s string) *string { return &s }

// testEdgesDocument builds a three-workflow canonical document:
// two providers differ, p-c is a duplicate of p-b (instance index 1).
func testEdgesDocument() Document {
	return Document{
		{
			{Type: "provider", ProviderID: strPtr2("p-a")},
			{Type: "requestModify", Name: "r1"},
			{Type: "responseModify", Name: "rv1"},
		},
		{
			{Type: "provider", ProviderID: strPtr2("p-b")},
			{Type: "concurrency", Name: "c1"},
			{Type: "autoSwitch", Name: "f1"},
		},
		{
			{Type: "provider", ProviderID: strPtr2("p-b")},
			{Type: "logOutput", Name: "log1"},
		},
	}
}

func edgesFromJSON(t *testing.T, raw string) EdgeDocument {
	t.Helper()
	var edges EdgeDocument
	if err := json.Unmarshal([]byte(raw), &edges); err != nil {
		t.Fatalf("parse edges: %v", err)
	}
	return edges
}

func TestWorkflowRefs_derives_numbered_keys_per_provider(t *testing.T) {
	keys, err := WorkflowRefs(testEdgesDocument())
	if err != nil {
		t.Fatalf("WorkflowRefs: %v", err)
	}
	want := map[string]bool{
		"w-p-a-0": true,
		"w-p-b-0": true,
		"w-p-b-1": true,
	}
	if !reflect.DeepEqual(keys, want) {
		t.Fatalf("keys: got %v, want %v", keys, want)
	}
}

func TestWorkflowRefs_rejects_non_provider_first_node(t *testing.T) {
	doc := Document{{{Type: "requestModify", Name: "x"}}}
	if _, err := WorkflowRefs(doc); err == nil {
		t.Fatal("expected error for non-provider first node")
	}
}

func TestValidSlotRef(t *testing.T) {
	keys := map[string]bool{"w-p-a-0": true}
	valid := []string{
		"slot-w-p-a-0-requestModify",
		"slot-w-p-a-0-logOutput",
	}
	for _, ref := range valid {
		if !validSlotRef(ref, keys) {
			t.Errorf("ref %q should be valid", ref)
		}
	}
	invalid := []string{
		"slot-w-p-z-0-requestModify", // unknown key
		"slot-w-p-a-1-requestModify", // unknown (a only has instance 0)
		"slot-w-p-a-0-bogus",         // unknown slot type
		"slot-w-p-a-0",               // missing slot type
		"pv-w-p-a-0",                 // provider ref, not slot
		"w-p-a-0-requestModify",      // missing slot- prefix
		"",                           // empty
	}
	for _, ref := range invalid {
		if validSlotRef(ref, keys) {
			t.Errorf("ref %q should be invalid", ref)
		}
	}
}

func TestValidateTopologyEdges_valid_cluster_and_flow_ref(t *testing.T) {
	doc := testEdgesDocument()
	raw := `[
		[["pv-w-p-a-0","slot-w-p-a-0-requestModify"],["slot-w-p-a-0-autoReply"],["slot-w-p-a-0-responseModify"]],
		[
			["pv-w-p-b-0","slot-w-p-b-0-concurrency"],
			["slot-w-p-b-0-autoSwitch"],
			["slot-w-p-b-0-logOutput"]
		]
	]`
	if err := ValidateEdges(edgesFromJSON(t, raw), doc); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

func TestExpandTopologyEdges_flat_chains(t *testing.T) {
	raw := `[
		["pv-w-p-a-0","slot-w-p-a-0-requestModify"],
		["pv-w-p-b-0","slot-w-p-b-0-concurrency","slot-w-p-b-0-logOutput"]
	]`
	got, err := Expand(edgesFromJSON(t, raw))
	if err != nil {
		t.Fatalf("expand: %v", err)
	}
	want := [][]string{
		{"pv-w-p-a-0", "slot-w-p-a-0-requestModify"},
		{"pv-w-p-b-0", "slot-w-p-b-0-concurrency", "slot-w-p-b-0-logOutput"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expand: got %v, want %v", got, want)
	}
}

func TestExpandTopologyEdges_merge_cluster_N_to_1(t *testing.T) {
	// Two providers merge into a shared tail slot.
	raw := `[
		[
			["pv-w-p-a-0","slot-w-p-a-0-requestModify"],
			["pv-w-p-b-0","slot-w-p-b-0-concurrency"],
			["slot-w-p-b-0-logOutput"]
		]
	]`
	got, err := Expand(edgesFromJSON(t, raw))
	if err != nil {
		t.Fatalf("expand: %v", err)
	}
	want := [][]string{
		{"pv-w-p-a-0", "slot-w-p-a-0-requestModify", "slot-w-p-b-0-logOutput"},
		{"pv-w-p-b-0", "slot-w-p-b-0-concurrency", "slot-w-p-b-0-logOutput"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expand: got %v, want %v", got, want)
	}
}

func TestExpandTopologyEdges_shared_tail_consumed_by_flow_ref(t *testing.T) {
	// Two chains merge into w-p-a-0 responseModify; a flow ref continues the
	// resulting chain(s).
	raw := `[
		[
			["pv-w-p-a-0","slot-w-p-a-0-requestModify"],
			["pv-w-p-b-0","slot-w-p-b-0-concurrency"],
			["slot-w-p-a-0-autoReply"]
		],
		[
			["slot-w-p-a-0-autoReply"],
			["slot-w-p-a-0-responseModify"]
		]
	]`
	got, err := Expand(edgesFromJSON(t, raw))
	if err != nil {
		t.Fatalf("expand: %v", err)
	}
	want := [][]string{
		{"pv-w-p-a-0", "slot-w-p-a-0-requestModify", "slot-w-p-a-0-autoReply", "slot-w-p-a-0-responseModify"},
		{"pv-w-p-b-0", "slot-w-p-b-0-concurrency", "slot-w-p-a-0-autoReply", "slot-w-p-a-0-responseModify"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expand: got %v, want %v", got, want)
	}
}

func TestExpandTopologyEdges_nested_cluster_participant_does_not_leak_pool(t *testing.T) {
	// A nested cluster participant expands in isolation and is continued by the
	// outer tail; its provider must not survive as a standalone chain.
	raw := `[
		[
			[
				["pv-w-p-a-0","slot-w-p-a-0-requestModify"],
				["slot-w-p-a-0-autoReply"],
				["slot-w-p-a-0-responseModify"]
			],
			["pv-w-p-b-0","slot-w-p-b-0-concurrency"],
			["slot-w-p-b-0-logOutput"]
		]
	]`
	got, err := Expand(edgesFromJSON(t, raw))
	if err != nil {
		t.Fatalf("expand: %v", err)
	}
	want := [][]string{
		{"pv-w-p-a-0", "slot-w-p-a-0-requestModify", "slot-w-p-a-0-responseModify", "slot-w-p-b-0-logOutput"},
		{"pv-w-p-b-0", "slot-w-p-b-0-concurrency", "slot-w-p-b-0-logOutput"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expand: got %v, want %v", got, want)
	}
}

func TestDefaultTopologyEdges_builds_full_chain_per_workflow(t *testing.T) {
	doc := testEdgesDocument()
	edges, err := DefaultEdges(doc)
	if err != nil {
		t.Fatalf("default: %v", err)
	}
	if err := ValidateEdges(edges, doc); err != nil {
		t.Fatalf("default edges must validate: %v", err)
	}
	got, err := Expand(edges)
	if err != nil {
		t.Fatalf("expand default: %v", err)
	}
	want := [][]string{
		{"pv-w-p-a-0", "slot-w-p-a-0-requestModify", "slot-w-p-a-0-responseModify", "slot-w-p-a-0-concurrency", "slot-w-p-a-0-autoSwitch", "slot-w-p-a-0-logOutput"},
		{"pv-w-p-b-0", "slot-w-p-b-0-requestModify", "slot-w-p-b-0-responseModify", "slot-w-p-b-0-concurrency", "slot-w-p-b-0-autoSwitch", "slot-w-p-b-0-logOutput"},
		{"pv-w-p-b-1", "slot-w-p-b-1-requestModify", "slot-w-p-b-1-responseModify", "slot-w-p-b-1-concurrency", "slot-w-p-b-1-autoSwitch", "slot-w-p-b-1-logOutput"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expand default: got %d chains, want %d\n%v", len(got), len(want), got)
	}
}

func TestValidateTopologyEdges_rejects_unknown_provider(t *testing.T) {
	raw := `[["pv-w-p-z-0","slot-w-p-a-0-requestModify"]]`
	err := ValidateEdges(edgesFromJSON(t, raw), testEdgesDocument())
	if err == nil || !strings.Contains(err.Error(), "unknown provider ref") {
		t.Fatalf("expected unknown provider error, got %v", err)
	}
}

func TestValidateTopologyEdges_rejects_unknown_slot(t *testing.T) {
	raw := `[["pv-w-p-a-0","slot-w-p-a-0-requestModify","slot-w-p-a-0-bogus"]]`
	err := ValidateEdges(edgesFromJSON(t, raw), testEdgesDocument())
	if err == nil || !strings.Contains(err.Error(), "unknown slot ref") {
		t.Fatalf("expected unknown slot error, got %v", err)
	}
}

func TestValidateTopologyEdges_rejects_duplicate_provider_across_chains(t *testing.T) {
	// A single provider appearing in more than one chain is invalid (1 -> N).
	raw := `[
		["pv-w-p-a-0","slot-w-p-a-0-requestModify"],
		["pv-w-p-a-0","slot-w-p-a-0-responseModify"]
	]`
	err := ValidateEdges(edgesFromJSON(t, raw), testEdgesDocument())
	if err == nil || !strings.Contains(err.Error(), "more than one edge chain") {
		t.Fatalf("expected duplicate provider error, got %v", err)
	}
}

func TestValidateTopologyEdges_rejects_duplicate_slot_in_chain(t *testing.T) {
	raw := `[["pv-w-p-a-0","slot-w-p-a-0-requestModify","slot-w-p-a-0-requestModify"]]`
	err := ValidateEdges(edgesFromJSON(t, raw), testEdgesDocument())
	if err == nil || !strings.Contains(err.Error(), "more than once") {
		t.Fatalf("expected duplicate slot error, got %v", err)
	}
}

func TestValidateTopologyEdges_rejects_non_slot_after_provider(t *testing.T) {
	raw := `[["pv-w-p-a-0","pv-w-p-b-0"]]`
	err := ValidateEdges(edgesFromJSON(t, raw), testEdgesDocument())
	if err == nil || !strings.Contains(err.Error(), "non-slot ref") {
		t.Fatalf("expected non-slot ref error, got %v", err)
	}
}

func TestValidateTopologyEdges_rejects_empty_unit(t *testing.T) {
	err := ValidateEdges(edgesFromJSON(t, `[[]]`), testEdgesDocument())
	if err == nil || !strings.Contains(err.Error(), "must not be empty") {
		t.Fatalf("expected empty unit error, got %v", err)
	}
}

func TestValidateTopologyEdges_accepts_draft_slot_fragment(t *testing.T) {
	// A top-level slot-headed chain is a draft; execution ignores it.
	raw := `[["slot-w-p-a-0-requestModify","slot-w-p-a-0-responseModify"]]`
	if err := ValidateEdges(edgesFromJSON(t, raw), testEdgesDocument()); err != nil {
		t.Fatalf("draft fragment should validate: %v", err)
	}
}

func TestValidateTopologyEdges_rejects_shared_tail_starting_with_provider(t *testing.T) {
	raw := `[
		[
			["pv-w-p-a-0","slot-w-p-a-0-requestModify"],
			["pv-w-p-b-0","slot-w-p-b-0-concurrency"],
			["pv-w-p-a-0"]
		]
	]`
	err := ValidateEdges(edgesFromJSON(t, raw), testEdgesDocument())
	if err == nil || !strings.Contains(err.Error(), "shared tail must start with a slot ref") {
		t.Fatalf("expected shared-tail error, got %v", err)
	}
}

func TestValidateTopologyEdges_rejects_empty_cluster(t *testing.T) {
	err := ValidateEdges(edgesFromJSON(t, `[[["pv-w-p-a-0"]]]`), testEdgesDocument())
	if err == nil {
		t.Fatal("expected cluster parse error for single-member cluster")
	}
}