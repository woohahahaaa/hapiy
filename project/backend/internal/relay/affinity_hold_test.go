package relay

import (
	"testing"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/model"
)

func TestDispatch_firstRequestTakesHoldOfChannel(t *testing.T) {
	// Given: two eligible providers, an affinity rule that applies to the
	// request, and no cached channel yet (fresh session).
	engine, db := newTestEngine(t)
	providers := []model.Provider{
		{ID: "deepseek", Name: "deepseek", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "newly-enabled", Name: "newly-enabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	if err := affinity.NewStore(db).Save(&affinity.AffinitySetting{Rules: []affinity.Rule{{Name: "by-user", Enabled: true, SessionIDFields: []string{"X-User"}}}}); err != nil {
		t.Fatalf("save affinity rules: %v", err)
	}
	engine.ReloadAffinity()
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	req := &affinity.Request{Model: "m1", Headers: map[string]string{"X-User": "alice"}}

	// When: first request dispatches (no cache, so it lands via normal
	// selection) and the handler records the channel that served it.
	first, err := engine.Dispatch("m1", "", req)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if first.AffinityMatch == nil || first.AffinityMatch.Matched {
		t.Fatalf("expected a weak (unmatched) affinity match on first dispatch, got %+v", first.AffinityMatch)
	}
	engine.Affinity().Record(first.AffinityMatch.RuleName, first.AffinityMatch.SessionID, first.AffinityMatch.ModelName,
		affinity.Triple{ProviderName: first.Provider.Name, KeyIndex: -1, BaseURLIndex: -1}, 60)

	// Then: the next request must recall the same provider, even though a
	// new provider became available in between — not fall back to selection.
	second, err := engine.Dispatch("m1", "", req)
	if err != nil {
		t.Fatalf("second dispatch: %v", err)
	}
	if second.Provider.Name != first.Provider.Name {
		t.Fatalf("affinity did not hold: first=%q second=%q", first.Provider.Name, second.Provider.Name)
	}
	if second.AffinityReuse != AffinityReuseFull && second.AffinityReuse != AffinityReusePartial {
		t.Fatalf("expected affinity reuse on second dispatch, got %q", second.AffinityReuse)
	}
}

func TestDispatch_affinityBeatsSequentialSlotOrder(t *testing.T) {
	// Given: a sequential provider slot listing duoyuan FIRST and deepseek
	// second, both eligible. The session's affinity is already pinned to
	// deepseek (from before the workflow was reordered).
	engine, db := newTestEngine(t)
	providers := []model.Provider{
		{ID: "duoyuan", Name: "duoyuan", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "deepseek", Name: "deepseek", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	if err := affinity.NewStore(db).Save(&affinity.AffinitySetting{Rules: []affinity.Rule{{Name: "by-user", Enabled: true, SessionIDFields: []string{"X-User"}}}}); err != nil {
		t.Fatalf("save affinity rules: %v", err)
	}
	engine.ReloadAffinity()
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	seedFlatTopology(t, db, `{"nodes":[
		{"id":"entry","kind":"requestEntry","enabled":true,"weight":1},
		{"id":"slot","kind":"slot","slot_type":"provider","enabled":true,"strategy":"sequential"},
		{"id":"duoyuan-node","kind":"provider","provider_id":"duoyuan","enabled":true},
		{"id":"deepseek-node","kind":"provider","provider_id":"deepseek","enabled":true}
	],"wires":[{"source":"entry","target":"slot"},{"source":"slot","target":"duoyuan-node"}]}`)
	req := &affinity.Request{Model: "m1", Headers: map[string]string{"X-User": "alice"}}
	engine.Affinity().Record("by-user", "alice", "m1", affinity.Triple{ProviderName: "deepseek", EntryID: "entry"}, 60)

	// When: the session's next request dispatches.
	got, err := engine.Dispatch("m1", "", req)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}

	// Then: affinity must win over the sequential slot order, entry-scoped.
	if got.Provider.Name != "deepseek" {
		t.Fatalf("affinity should beat sequential order, got %q", got.Provider.Name)
	}
	if got.EntryID != "entry" {
		t.Fatalf("expected entry-scoped dispatch via entry, got %q", got.EntryID)
	}
	if got.AffinityReuse != AffinityReusePartial {
		t.Fatalf("expected partial reuse (-1 indices), got %q", got.AffinityReuse)
	}
}