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
