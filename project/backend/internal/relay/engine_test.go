package relay

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// newTestEngine builds an in-memory SQLite engine that mirrors the production
// AutoMigrate shape so cache rebuilds can be exercised against real SQL.
func newTestEngine(t *testing.T) (*Engine, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.Channel{},
		&model.RewriteRule{},
		&model.ResponseRewriteRule{},
		&model.HeartbeatRule{},
		&model.ConcurrencyRule{},
		&model.FailoverRule{},
		&model.TopologyState{},
		&model.TopologySlotAssignment{},
	); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return NewEngine(db), db
}

func TestLoadChannels_compiles_only_enabled_assigned_rules_in_explicit_order(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	channel := model.Channel{ID: "channel-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	rules := []model.RewriteRule{
		{ID: "rewrite-1", Name: "one", Status: true},
		{ID: "rewrite-2", Name: "two", Status: true},
		{ID: "global-unassigned", Name: "unassigned", Status: true},
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := db.Create(&rules).Error; err != nil {
		t.Fatalf("create rules: %v", err)
	}
	assignments := []model.TopologySlotAssignment{
		{ID: "second", ChannelID: channel.ID, SlotType: "requestModify", Order: 2, Enabled: true, RuleID: stringPointer("rewrite-1"), Config: `{}`},
		{ID: "first", ChannelID: channel.ID, SlotType: "requestModify", Order: 1, Enabled: true, RuleID: stringPointer("rewrite-2"), Config: `{}`},
		{ID: "disabled", ChannelID: channel.ID, SlotType: "requestModify", Order: 3, Enabled: false, RuleID: stringPointer("global-unassigned"), Config: `{}`},
	}
	if err := db.Create(&assignments).Error; err != nil {
		t.Fatalf("create assignments: %v", err)
	}

	// When
	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("load channels: %v", err)
	}
	plan, err := engine.GetPlan(channel.ID)

	// Then
	if err != nil {
		t.Fatalf("get plan: %v", err)
	}
	if len(plan.RewriteRules) != 2 || plan.RewriteRules[0].ID != "rewrite-2" || plan.RewriteRules[1].ID != "rewrite-1" {
		t.Fatalf("unexpected rewrite rules: %+v", plan.RewriteRules)
	}
}

func TestLoadChannels_leaves_optional_plan_empty_without_assignments(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	channel := model.Channel{ID: "channel-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	globalRule := model.RewriteRule{ID: "global", Name: "global", Status: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := db.Create(&globalRule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}

	// When
	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("load channels: %v", err)
	}
	plan, err := engine.GetPlan(channel.ID)

	// Then
	if err != nil {
		t.Fatalf("get plan: %v", err)
	}
	if len(plan.RewriteRules) != 0 || plan.HeartbeatRule != nil || plan.ConcurrencyRule != nil || len(plan.FailoverRules) != 0 {
		t.Fatalf("optional plan was populated globally: %+v", plan)
	}
}

func TestRefreshPlans_preserves_working_plan_when_candidate_has_disabled_rule(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	channel := model.Channel{ID: "channel-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("initial load: %v", err)
	}
	disabledRule := model.RewriteRule{ID: "disabled", Name: "disabled", Status: false}
	assignment := model.TopologySlotAssignment{ID: "bad", ChannelID: channel.ID, SlotType: "requestModify", Order: 1, Enabled: true, RuleID: stringPointer(disabledRule.ID), Config: `{}`}
	if err := db.Create(&disabledRule).Error; err != nil {
		t.Fatalf("create disabled rule: %v", err)
	}
	if err := db.Create(&assignment).Error; err != nil {
		t.Fatalf("create assignment: %v", err)
	}

	// When
	err := engine.RefreshPlans()

	// Then
	if err == nil {
		t.Fatal("refresh unexpectedly succeeded")
	}
	plan, getErr := engine.GetPlan(channel.ID)
	if getErr != nil || len(plan.RewriteRules) != 0 {
		t.Fatalf("working plan was removed or changed: plan=%+v err=%v", plan, getErr)
	}
}

func TestInvalidatePlan_preserves_working_plan_when_candidate_fails(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	channel := model.Channel{ID: "channel-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("initial load: %v", err)
	}
	disabledRule := model.RewriteRule{ID: "disabled", Name: "disabled", Status: false}
	assignment := model.TopologySlotAssignment{ID: "bad", ChannelID: channel.ID, SlotType: "requestModify", Order: 1, Enabled: true, RuleID: stringPointer(disabledRule.ID), Config: `{}`}
	if err := db.Create(&disabledRule).Error; err != nil {
		t.Fatalf("create disabled rule: %v", err)
	}
	if err := db.Create(&assignment).Error; err != nil {
		t.Fatalf("create assignment: %v", err)
	}

	// When
	engine.InvalidatePlan(channel.ID)
	plan, err := engine.GetPlan(channel.ID)

	// Then
	if err != nil {
		t.Fatalf("working plan was removed: %v", err)
	}
	if len(plan.RewriteRules) != 0 {
		t.Fatalf("working plan changed after failed invalidation: %+v", plan.RewriteRules)
	}
}

func stringPointer(value string) *string {
	return &value
}

func TestLoadChannelsDropsDisabledChannels(t *testing.T) {
	engine, db := newTestEngine(t)

	enabled := model.Channel{
		ID:       "channel-enabled",
		Name:     "enabled",
		BaseURLs: "[]",
		Keys:     "[]",
		Models:   "[]",
		Status:   true,
	}
	if err := db.Create(&enabled).Error; err != nil {
		t.Fatalf("create enabled channel: %v", err)
	}

	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("first load: %v", err)
	}
	if _, err := engine.GetChannel("channel-enabled"); err != nil {
		t.Fatalf("enabled channel should be present after first load: %v", err)
	}

	if err := db.Model(&model.Channel{}).
		Where("id = ?", "channel-enabled").
		Update("status", false).Error; err != nil {
		t.Fatalf("disable channel: %v", err)
	}

	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("second load: %v", err)
	}
	if _, err := engine.GetChannel("channel-enabled"); err == nil {
		t.Fatalf("disabled channel must be evicted from cache after LoadChannels")
	}

	if _, err := engine.GetPlan("channel-enabled"); err == nil {
		t.Fatalf("plan for disabled channel must be evicted")
	}
}

func TestLoadChannelsDropsDeletedChannels(t *testing.T) {
	engine, db := newTestEngine(t)

	ch := model.Channel{
		ID:       "channel-doomed",
		Name:     "doomed",
		BaseURLs: "[]",
		Keys:     "[]",
		Models:   "[]",
		Status:   true,
	}
	if err := db.Create(&ch).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("first load: %v", err)
	}
	if _, err := engine.GetChannel("channel-doomed"); err != nil {
		t.Fatalf("channel should be present after first load: %v", err)
	}

	if err := db.Delete(&model.Channel{}, "id = ?", "channel-doomed").Error; err != nil {
		t.Fatalf("delete channel: %v", err)
	}
	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("second load: %v", err)
	}
	if _, err := engine.GetChannel("channel-doomed"); err == nil {
		t.Fatalf("deleted channel must be evicted from cache after LoadChannels")
	}
}

func TestRelayRequest_runs_selected_response_and_log_stages_in_pipeline_order(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	responseRule := model.ResponseRewriteRule{ID: "response-rule", Name: "response", Status: true}
	if err := db.Create(&responseRule).Error; err != nil {
		t.Fatalf("create response rule: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	plan := &ExecutionPlan{
		Channel:              &model.Channel{BaseURLs: `["` + server.URL + `"]`, Keys: `["key"]`},
		ResponseRewriteRules: []*model.ResponseRewriteRule{&responseRule},
		LogOutputs:           []LogOutputAssignment{{ID: "log", Order: 1, Config: `{}`}},
	}
	events := make([]topologyStageEvent, 0, 5)
	engine.topologyStageHook = func(event topologyStageEvent) {
		events = append(events, event)
	}

	// When
	response, err := engine.RelayRequest(context.Background(), plan, &RelayRequest{})

	// Then
	if err != nil {
		t.Fatalf("relay request: %v", err)
	}
	defer response.Body.Close()
	if _, err := io.ReadAll(response.Body); err != nil {
		t.Fatalf("read response: %v", err)
	}
	wantStages := []topologyStage{
		topologyStageRequestBefore,
		topologyStageRequestAfter,
		topologyStageResponseBefore,
		topologyStageResponseRewrite,
		topologyStageResponseAfter,
	}
	if len(events) != len(wantStages) {
		t.Fatalf("event count: want %d, got %d (%+v)", len(wantStages), len(events), events)
	}
	for index, want := range wantStages {
		if events[index].Stage != want {
			t.Fatalf("stage %d: want %q, got %q", index, want, events[index].Stage)
		}
		if index != 3 && len(events[index].LogOutputs) != 1 {
			t.Fatalf("stage %q did not receive selected log output: %+v", want, events[index].LogOutputs)
		}
	}
	if len(events[3].ResponseRewriteRules) != 1 || events[3].ResponseRewriteRules[0].ID != responseRule.ID {
		t.Fatalf("response rewrite stage did not receive selected rule: %+v", events[3].ResponseRewriteRules)
	}
}
