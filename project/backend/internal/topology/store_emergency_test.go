package topology

import (
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestStore_roundTripsEmergencyEntry(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.TopologyConfig{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "e1", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "e2", Kind: KindRequestEntry, Enabled: true, Weight: 1, Emergency: true},
		},
	}
	store := NewStore(db)
	if err := store.Save(tp); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	var emergency *FlatNode
	for i := range loaded.Nodes {
		if loaded.Nodes[i].ID == "e2" {
			emergency = &loaded.Nodes[i]
		}
	}
	if emergency == nil || !emergency.Emergency {
		t.Fatalf("emergency flag lost on round-trip: %+v", loaded.Nodes)
	}
	if HasEmergencyEntries(loaded) != true || EntryIsEmergency(loaded, "e1") != false || EntryIsEmergency(loaded, "e2") != true {
		t.Fatalf("lane helpers disagree with stored flag")
	}
}

// TestStore_loadNormalizesMinimalProviderSlot writes a legacy flat document
// (provider slot with an adjacent card but no outgoing wire, exactly what the
// old editor persisted) straight to the row and verifies Load heals it in
// memory, and Save persists the healed form.
func TestStore_loadNormalizesMinimalProviderSlot(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.TopologyConfig{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	legacy := `{"nodes":[` +
		`{"id":"entry","kind":"requestEntry","enabled":true,"weight":1},` +
		`{"id":"pslot","kind":"slot","slot_type":"provider","enabled":true},` +
		`{"id":"prov-a","kind":"provider","name":"银河gpt-image","provider_id":"p-image","enabled":true}` +
		`],"wires":[{"source":"entry","target":"pslot"}]}`
	if err := db.Create(&model.TopologyConfig{ID: ConfigRowID, Version: 1, Flat: legacy}).Error; err != nil {
		t.Fatalf("seed legacy config: %v", err)
	}

	loaded, err := NewStore(db).Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	healed := false
	for _, w := range loaded.Wires {
		if w.Source == "pslot" && w.Target == "prov-a" {
			healed = true
		}
	}
	if !healed {
		t.Fatalf("Load did not heal the minimal provider slot: %+v", loaded.Wires)
	}

	if err := NewStore(db).Save(loaded); err != nil {
		t.Fatalf("save healed topology: %v", err)
	}
	reloaded, err := NewStore(db).Load()
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if len(reloaded.Wires) != 2 {
		t.Fatalf("persisted wires = %+v, want entry→slot and slot→provider", reloaded.Wires)
	}
}

// TestStore_saveNormalizesMinimalProviderSlot verifies Save repairs a raw
// payload that arrives without the internal wire (defense-in-depth for direct
// API writers).
func TestStore_saveNormalizesMinimalProviderSlot(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.TopologyConfig{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	tp := &Topology{
		Nodes: []FlatNode{
			{ID: "entry", Kind: KindRequestEntry, Enabled: true, Weight: 1},
			{ID: "pslot", Kind: KindSlot, SlotType: "provider", Enabled: true},
			{ID: "prov-a", Kind: KindProvider, Name: "银河gpt-image", ProviderID: "p-image", Enabled: true},
		},
		Wires: []Wire{{Source: "entry", Target: "pslot"}},
	}
	if err := NewStore(db).Save(tp); err != nil {
		t.Fatalf("save: %v", err)
	}
	healed := false
	for _, w := range tp.Wires {
		if w.Source == "pslot" && w.Target == "prov-a" {
			healed = true
		}
	}
	if !healed {
		t.Fatalf("Save did not heal the payload in place: %+v", tp.Wires)
	}
}
