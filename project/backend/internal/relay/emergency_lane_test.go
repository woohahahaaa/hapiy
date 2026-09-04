package relay

import (
	"testing"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// emergencyTopologyFlat seeds a normal entry (e1) serving p1 and an
// 应急入口 (e2) serving p2, both for model m1.
const emergencyTopologyFlat = `{"nodes":[
	{"id":"e1","kind":"requestEntry","name":"entry","enabled":true,"weight":1},
	{"id":"ps1","kind":"slot","slot_type":"provider","enabled":true},
	{"id":"pv1","kind":"provider","provider_id":"p1","enabled":true},
	{"id":"e2","kind":"requestEntry","name":"emergency","enabled":true,"weight":1,"emergency":true},
	{"id":"ps2","kind":"slot","slot_type":"provider","enabled":true},
	{"id":"pv2","kind":"provider","provider_id":"p2","enabled":true}
],"wires":[{"source":"e1","target":"ps1"},{"source":"ps1","target":"pv1"},
	{"source":"e2","target":"ps2"},{"source":"ps2","target":"pv2"}]}`

func seedEmergencyProviders(t *testing.T, db *gorm.DB) {
	t.Helper()
	providers := []model.Provider{
		{ID: "p1", Name: "p1", BaseURLs: `["https://n.example.com"]`, Keys: `["k1"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "p2", Name: "p2", BaseURLs: `["https://e.example.com"]`, Keys: `["k2"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
}

func setProviderStatus(t *testing.T, engine *Engine, db *gorm.DB, id string, status bool) {
	t.Helper()
	if err := db.Model(&model.Provider{}).Where("id = ?", id).Update("status", status).Error; err != nil {
		t.Fatalf("update provider status: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("reload providers: %v", err)
	}
}

func TestDispatch_emergencyServesOnlyWhenNormalEmpty(t *testing.T) {
	engine, db := newTestEngine(t)
	seedEmergencyProviders(t, db)
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	seedFlatTopology(t, db, emergencyTopologyFlat)

	got, err := engine.Dispatch("m1", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if got.Provider == nil || got.Provider.ID != "p1" || got.EntryID != "e1" {
		t.Fatalf("expected normal provider p1 via e1, got provider=%v entry=%q", got.Provider, got.EntryID)
	}

	setProviderStatus(t, engine, db, "p1", false)
	got, err = engine.Dispatch("m1", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("dispatch during outage: %v", err)
	}
	if got.Provider == nil || got.Provider.ID != "p2" || got.EntryID != "e2" {
		t.Fatalf("expected emergency provider p2 via e2, got provider=%v entry=%q", got.Provider, got.EntryID)
	}

	setProviderStatus(t, engine, db, "p1", true)
	got, err = engine.Dispatch("m1", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("dispatch after recovery: %v", err)
	}
	if got.Provider == nil || got.Provider.ID != "p1" {
		t.Fatalf("expected revert to p1 after recovery, got %v", got.Provider)
	}
}

func TestDispatch_ruleAffinityIsLaneScoped(t *testing.T) {
	engine, db := newTestEngine(t)
	seedEmergencyProviders(t, db)
	if err := affinity.NewStore(db).Save(&affinity.AffinitySetting{Rules: []affinity.Rule{{Name: "by-user", Enabled: true, SessionIDFields: []string{"X-User"}}}}); err != nil {
		t.Fatalf("save affinity rules: %v", err)
	}
	engine.ReloadAffinity()
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	seedFlatTopology(t, db, emergencyTopologyFlat)
	req := &affinity.Request{Model: "m1", Headers: map[string]string{"X-User": "alice"}}

	setProviderStatus(t, engine, db, "p1", false)
	first, err := engine.Dispatch("m1", "", req)
	if err != nil {
		t.Fatalf("dispatch during outage: %v", err)
	}
	if first.Provider.ID != "p2" {
		t.Fatalf("expected emergency provider p2 during outage, got %v", first.Provider)
	}
	engine.Affinity().Record(first.AffinityMatch.RuleName, first.AffinityMatch.SessionID, first.AffinityMatch.ModelName,
		affinity.Triple{ProviderName: "p2", KeyIndex: -1, BaseURLIndex: -1, EntryID: "e2"}, 60)

	setProviderStatus(t, engine, db, "p1", true)
	got, err := engine.Dispatch("m1", "", req)
	if err != nil {
		t.Fatalf("dispatch after recovery: %v", err)
	}
	if got.Provider.ID != "p1" {
		t.Fatalf("expected revert to p1 despite cached emergency affinity, got %v", got.Provider)
	}

	setProviderStatus(t, engine, db, "p1", false)
	got, err = engine.Dispatch("m1", "", req)
	if err != nil {
		t.Fatalf("dispatch during second outage: %v", err)
	}
	if got.Provider.ID != "p2" {
		t.Fatalf("expected emergency affinity recall of p2, got %v", got.Provider)
	}
	if got.AffinityMatch == nil || !got.AffinityMatch.Matched {
		t.Fatalf("expected a matched (recalled) affinity, got %+v", got.AffinityMatch)
	}
}

func TestDispatch_fallbackAffinityIsLaneScoped(t *testing.T) {
	engine, db := newTestEngine(t)
	seedEmergencyProviders(t, db)
	if err := affinity.NewFallbackStore(db).Save(&affinity.FallbackSetting{Enabled: true, SessionIDFields: []string{"X-Session-Id"}, ModelFields: []string{"model"}}); err != nil {
		t.Fatalf("save fallback setting: %v", err)
	}
	engine.ReloadFallbackAffinity()
	if err := db.AutoMigrate(&model.RequestChannelHistory{}); err != nil {
		t.Fatalf("automigrate history: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	seedFlatTopology(t, db, emergencyTopologyFlat)
	history := model.RequestChannelHistory{SessionID: "s1", Model: "m1", ProviderID: "p2", KeyIndex: 0, BaseURLIndex: 0, EntryID: "e2"}
	if err := db.Create(&history).Error; err != nil {
		t.Fatalf("create history row: %v", err)
	}
	req := &affinity.Request{Model: "m1", Headers: map[string]string{"X-Session-Id": "s1"}}

	got, err := engine.Dispatch("m1", "", req)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if got.Provider.ID != "p1" {
		t.Fatalf("expected normal provider p1 despite emergency fallback history, got %v", got.Provider)
	}

	setProviderStatus(t, engine, db, "p1", false)
	got, err = engine.Dispatch("m1", "", req)
	if err != nil {
		t.Fatalf("dispatch during outage: %v", err)
	}
	if got.Provider.ID != "p2" || got.KeyIndex != 0 || got.BaseURLIndex != 0 {
		t.Fatalf("expected fallback reuse of p2 (key 0, url 0), got provider=%v key=%d url=%d", got.Provider, got.KeyIndex, got.BaseURLIndex)
	}
}
