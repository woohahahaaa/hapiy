package topology

import "testing"

func TestValidateTopology_concurrencySlotAllowsEmptyEntries(t *testing.T) {
	n := FlatNode{ID: "cq", Kind: KindSlot, SlotType: "concurrency", Enabled: true}
	if err := validateConcurrencySlotEntries(n); err != nil {
		t.Fatalf("empty entries should be valid, got %v", err)
	}
	if err := validateConcurrencySlotEntries(FlatNode{ID: "cq", Kind: KindSlot, SlotType: "concurrency", Entries: []byte(`null`)}); err != nil {
		t.Fatalf("null entries should be valid, got %v", err)
	}
}

func TestValidateTopology_concurrencySlotAllowsSingleEntry(t *testing.T) {
	n := FlatNode{ID: "cq", Kind: KindSlot, SlotType: "concurrency", Entries: []byte(`[{"id":"e1","index":0,"config":{"windowMinutes":5,"maxCount":10}}]`)}
	if err := validateConcurrencySlotEntries(n); err != nil {
		t.Fatalf("single entry should be valid, got %v", err)
	}
}

func TestValidateTopology_concurrencySlotRejectsMultipleEntries(t *testing.T) {
	n := FlatNode{ID: "cq", Kind: KindSlot, SlotType: "concurrency", Entries: []byte(`[{"id":"e1","index":0},{"id":"e2","index":1}]`)}
	if err := validateConcurrencySlotEntries(n); err == nil {
		t.Fatalf("two entries should be rejected")
	}
}

func TestValidateTopology_concurrencySlotRejectsScalarEntries(t *testing.T) {
	n := FlatNode{ID: "cq", Kind: KindSlot, SlotType: "concurrency", Entries: []byte(`{"config":{}}`)}
	if err := validateConcurrencySlotEntries(n); err == nil {
		t.Fatalf("object entries should be rejected")
	}
}