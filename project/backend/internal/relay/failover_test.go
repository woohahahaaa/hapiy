package relay

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/topology"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newRelayTestDB(t *testing.T, models ...interface{}) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(models...); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}

func failingServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestIsFailoverEligible_matchesByCondition(t *testing.T) {
	cases := []struct {
		name     string
		rule     *model.FailoverRule
		outcome  upstreamOutcome
		wantName string
		want     bool
	}{
		{
			name:     "timeout matches transport error",
			rule:     &model.FailoverRule{Condition: "timeout", FallbackProvider: "fallback"},
			outcome:  upstreamOutcome{transport: true, err: errors.New("boom")},
			wantName: "fallback",
			want:     true,
		},
		{
			name:     "rate_limit matches 429",
			rule:     &model.FailoverRule{Condition: "rate_limit", FallbackProvider: "fallback"},
			outcome:  upstreamOutcome{statusCode: 429},
			wantName: "fallback",
			want:     true,
		},
		{
			name:     "error matches 500",
			rule:     &model.FailoverRule{Condition: "error", FallbackProvider: "fallback"},
			outcome:  upstreamOutcome{statusCode: 500},
			wantName: "fallback",
			want:     true,
		},
		{
			name:    "error does not match 200",
			rule:    &model.FailoverRule{Condition: "error", FallbackProvider: "fallback"},
			outcome: upstreamOutcome{statusCode: 200},
			want:    false,
		},
		{
			name:    "timeout does not match http 500",
			rule:    &model.FailoverRule{Condition: "timeout", FallbackProvider: "fallback"},
			outcome: upstreamOutcome{statusCode: 500},
			want:    false,
		},
		{
			name:    "no fallback name on rule: ignored",
			rule:    &model.FailoverRule{Condition: "error"},
			outcome: upstreamOutcome{statusCode: 500},
			want:    false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			name, ok := isFailoverEligible(tc.outcome, []*model.FailoverRule{tc.rule})
			if ok != tc.want {
				t.Fatalf("ok mismatch: want %v, got %v", tc.want, ok)
			}
			if name != tc.wantName {
				t.Fatalf("name mismatch: want %q, got %q", tc.wantName, name)
			}
		})
	}
}

func TestMatchingFailoverRule_returnsFirstEnabledTopologyRule_whenKeywordsMatch(t *testing.T) {
	// Given
	rules := []*model.FailoverRule{
		{ID: "first", Status: true, Keywords: []string{"quota"}},
		{ID: "second", Status: true, Keywords: []string{"quota"}},
	}

	// When
	rule, matched := matchingFailoverRule(upstreamOutcome{message: "quota exceeded"}, rules)

	// Then
	if !matched || rule.ID != "first" {
		t.Fatalf("matched rule: want first, got %#v", rule)
	}
}

func TestRuleMatchesOutcome_usesLiteralKeywordOR_whenKeywordsProvided(t *testing.T) {
	// Given
	rule := &model.FailoverRule{Condition: "rate_limit", Keywords: []string{"quota exceeded", "account blocked"}}

	// When
	matched := ruleMatchesOutcome(rule, upstreamOutcome{statusCode: http.StatusInternalServerError, message: "upstream: account blocked"})

	// Then
	if !matched {
		t.Fatal("expected literal keyword match")
	}
}

func TestMatchingFailoverRule_matchesHTTPStatusKeyword_whenUpstreamReturnsError(t *testing.T) {
	// Given
	rules := []*model.FailoverRule{
		{ID: "status", Status: true, Keywords: []string{"429"}},
		{ID: "text", Status: true, Keywords: []string{"rate limit"}},
	}
	outcome := classifyOutcome(&RelayResponse{StatusCode: http.StatusTooManyRequests}, errors.New("rate limit exceeded"))

	// When
	rule, matched := matchingFailoverRule(outcome, rules)

	// Then
	if outcome.message != "HTTP 429: rate limit exceeded" {
		t.Fatalf("outcome message: want %q, got %q", "HTTP 429: rate limit exceeded", outcome.message)
	}
	if !matched || rule.ID != "status" {
		t.Fatalf("matched rule: want status, got %#v", rule)
	}
}

func TestEngineFirstEnabledIndex_skipsPersistedDisabledDimension_whenSelecting(t *testing.T) {
	// Given
	db := newRelayTestDB(t, &model.AutoDisableState{})
	state := model.AutoDisableState{ProviderID: "provider", Dimension: model.FailoverDimensionKey, Value: "bad", Disabled: true}
	if err := db.Create(&state).Error; err != nil {
		t.Fatalf("create state: %v", err)
	}
	engine := NewEngine(db)

	// When
	index := engine.firstEnabledIndex("provider", model.FailoverDimensionKey, []string{"bad", "good"}, -1)

	// Then
	if index != 1 {
		t.Fatalf("index: want 1, got %d", index)
	}
}

func TestEngineApplyFailoverActions_persistsConfiguredProviderDisable_whenAutoDisableEnabled(t *testing.T) {
	// Given
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{})
	provider := model.Provider{ID: "provider", Name: "provider"}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{Provider: &provider, BaseURLs: []string{"https://upstream.example"}, Keys: []string{"key"}}

	// When
	err := engine.applyFailoverAction(plan, &RelayRequest{BaseURLIndex: 0, KeyIndex: 0}, model.FailoverDimensionProvider, nil, upstreamOutcome{})

	// Then
	if err != nil {
		t.Fatalf("apply actions: %v", err)
	}
	if !engine.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID) {
		t.Fatal("provider state was not persisted")
	}
	var state model.AutoDisableState
	if err := db.First(&state, "provider_id = ? AND dimension = ?", provider.ID, model.FailoverDimensionProvider).Error; err != nil {
		t.Fatalf("reload disable state: %v", err)
	}
	if !state.Disabled {
		t.Fatal("provider disable state was not persisted as disabled")
	}
}

func TestRelayWithFailover_autoDisablesProvider_whenMatchPatternMatchesHTTP429Body(t *testing.T) {
	// Given
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{}, &model.FailoverHitCounter{})
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte("可用预算已用尽"))
	}))
	defer primary.Close()
	provider := &model.Provider{ID: "primary", Name: "primary"}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{
		Provider: provider,
		BaseURLs: []string{primary.URL},
		Keys:     []string{"key"},
		FailoverRules: []*model.FailoverRule{
			{
				Condition:     "timeout",
				MatchPatterns: []string{"可用预算已用尽"},
				Dimension:     model.FailoverDimensionProvider,
				AutoDisable:   true,
			},
		},
	}

	// When
	_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{})

	// Then
	if !engine.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID) {
		t.Fatal("provider was not auto-disabled")
	}
}

func TestRelayWithFailover_retriesOnceOnError(t *testing.T) {
	primaryHits := 0
	fallbackHits := 0
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		primaryHits++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackHits++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer fallback.Close()

	eng := NewEngine(nil)
	primaryPlan := &ExecutionPlan{
		ID:       "primary",
		Provider: &model.Provider{ID: "primary", Name: "primary"},
		BaseURLs: []string{primary.URL},
		Keys:     []string{"k"},
		FailoverRules: []*model.FailoverRule{
			{Condition: "error", Dimension: model.FailoverDimensionProvider, FallbackProvider: "fallback"},
		},
	}
	fallbackPlan := &ExecutionPlan{
		ID:       "fallback",
		Provider: &model.Provider{ID: "fallback", Name: "fallback"},
		BaseURLs: []string{fallback.URL},
		Keys:     []string{"k"},
	}
	eng.plansMu.Lock()
	eng.plans["primary"] = primaryPlan
	eng.plans["fallback"] = fallbackPlan
	eng.plansMu.Unlock()
	eng.providersMu.Lock()
	eng.providers["primary"] = primaryPlan.Provider
	eng.providers["fallback"] = fallbackPlan.Provider
	eng.providersMu.Unlock()

	resp, err := eng.relayWithFailover(context.Background(), primaryPlan, &RelayRequest{})
	if err != nil {
		t.Fatalf("relay: %v", err)
	}
	defer resp.Body.Close()
	if primaryHits != 1 {
		t.Fatalf("primary hits: want 1, got %d", primaryHits)
	}
	if fallbackHits != 1 {
		t.Fatalf("fallback hits: want 1 (single retry), got %d", fallbackHits)
	}
}

func TestRelayWithFailover_emptyFallbackUsesSameProviderSlotOrder(t *testing.T) {
	// Given
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{}, &model.TopologyConfig{}, &model.TopologySlotAssignment{})
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()
	alternate := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer alternate.Close()
	primaryProvider := &model.Provider{ID: "primary", Name: "primary", BaseURLs: `[` + strconv.Quote(primary.URL) + `]`, Keys: `["key"]`, Status: true, WorkflowEnabled: true}
	alternateProvider := &model.Provider{ID: "alternate", Name: "alternate", BaseURLs: `[` + strconv.Quote(alternate.URL) + `]`, Keys: `["key"]`, Status: true, WorkflowEnabled: true}
	if err := db.Create(primaryProvider).Error; err != nil {
		t.Fatalf("create primary: %v", err)
	}
	if err := db.Create(alternateProvider).Error; err != nil {
		t.Fatalf("create alternate: %v", err)
	}
	if err := db.Create(&model.TopologyConfig{ID: topology.ConfigRowID, Version: 1, Flat: `{"nodes":[
		{"id":"entry","kind":"requestEntry","enabled":true,"weight":1},
		{"id":"provider-slot","kind":"slot","slot_type":"provider","enabled":true},
		{"id":"primary-node","kind":"provider","provider_id":"primary","enabled":true},
		{"id":"alternate-node","kind":"provider","provider_id":"alternate","enabled":true}
	],"wires":[{"source":"entry","target":"provider-slot"},{"source":"provider-slot","target":"primary-node"}]}`}).Error; err != nil {
		t.Fatalf("create topology: %v", err)
	}
	engine := NewEngine(db)
	primaryPlan := &ExecutionPlan{ID: "primary", Provider: primaryProvider, BaseURLs: []string{primary.URL}, Keys: []string{"key"}, FailoverRules: []*model.FailoverRule{{Condition: "error", Dimension: model.FailoverDimensionProvider}}}
	alternatePlan := &ExecutionPlan{ID: "alternate", Provider: alternateProvider, BaseURLs: []string{alternate.URL}, Keys: []string{"key"}}
	engine.plans = map[string]*ExecutionPlan{"primary": primaryPlan, "alternate": alternatePlan}
	engine.providers = map[string]*model.Provider{"primary": primaryProvider, "alternate": alternateProvider}
	topologySnapshot, err := topology.NewStore(db).Load()
	if err != nil {
		t.Fatalf("load topology: %v", err)
	}
	if alternatives := topology.FindProviderSlotAlternatives(topologySnapshot, engine.buildFlatProviderRefs(), "m1", "/v1/chat/completions", "entry", "primary"); len(alternatives) != 2 {
		t.Fatalf("alternatives: want 2, got %#v", alternatives)
	}

	// When
	resp, err := engine.relayWithFailover(context.Background(), primaryPlan, &RelayRequest{Model: "m1", Path: "/v1/chat/completions", TopologyOrigin: &topology.RequestOrigin{EntryID: "entry", ProviderSlotID: "provider-slot", ProviderID: "primary"}})

	// Then
	if err != nil {
		t.Fatalf("relay: %v", err)
	}
	if resp == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected alternate provider response, got %+v", resp)
	}
	_ = resp.Body.Close()
}

func TestRelayWithFailover_doesNotLoopOnFallbackError(t *testing.T) {
	primaryHits := 0
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		primaryHits++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()

	eng := NewEngine(nil)
	primaryPlan := &ExecutionPlan{
		ID:       "primary",
		Provider: &model.Provider{ID: "primary", Name: "primary"},
		BaseURLs: []string{primary.URL},
		Keys:     []string{"k"},
		FailoverRules: []*model.FailoverRule{
			{Condition: "error", Dimension: model.FailoverDimensionProvider, FallbackProvider: "fallback"},
		},
	}
	fallbackPlan := &ExecutionPlan{
		ID:       "fallback",
		Provider: &model.Provider{ID: "fallback", Name: "fallback"},
		BaseURLs: []string{primary.URL}, // same broken endpoint
		Keys:     []string{"k"},
	}
	eng.plansMu.Lock()
	eng.plans["primary"] = primaryPlan
	eng.plans["fallback"] = fallbackPlan
	eng.plansMu.Unlock()
	eng.providersMu.Lock()
	eng.providers["primary"] = primaryPlan.Provider
	eng.providers["fallback"] = fallbackPlan.Provider
	eng.providersMu.Unlock()

	_, err := eng.relayWithFailover(context.Background(), primaryPlan, &RelayRequest{})
	if err == nil {
		t.Fatal("expected error after exhausted primary+fallback")
	}
	// Primary + single fallback retry = 2 total. The fallback must NOT
	// trigger another failover (would yield 3+).
	if primaryHits != 2 {
		t.Fatalf("expected exactly 2 hits (primary + 1 retry), got %d", primaryHits)
	}
}

func TestRelayWithFailover_returnsOriginalErrorWhenNoRuleMatches(t *testing.T) {
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()

	eng := NewEngine(nil)
	plan := &ExecutionPlan{
		ID:       "primary",
		Provider: &model.Provider{ID: "primary", Name: "primary"},
		BaseURLs: []string{primary.URL},
		Keys:     []string{"k"},
		FailoverRules: []*model.FailoverRule{
			{Condition: "rate_limit", FallbackProvider: "fallback"},
		},
	}
	eng.plansMu.Lock()
	eng.plans["primary"] = plan
	eng.plansMu.Unlock()
	eng.providersMu.Lock()
	eng.providers["primary"] = plan.Provider
	eng.providersMu.Unlock()

	// 500 is not 429, so the rate_limit rule doesn't match; expect
	// the original upstream error to bubble up unchanged.
	_, err := eng.relayWithFailover(context.Background(), plan, &RelayRequest{})
	if err == nil {
		t.Fatal("expected error from upstream 500")
	}
	if !contains(err.Error(), "500") {
		t.Fatalf("expected 500 in error, got %v", err)
	}
}

func TestRelayWithFailover_returnsOriginalErrorWhenFallbackMissing(t *testing.T) {
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()

	eng := NewEngine(nil)
	plan := &ExecutionPlan{
		ID:       "primary",
		Provider: &model.Provider{ID: "primary", Name: "primary"},
		BaseURLs: []string{primary.URL},
		Keys:     []string{"k"},
		FailoverRules: []*model.FailoverRule{
			{Condition: "error", FallbackProvider: "nonexistent"},
		},
	}
	eng.plansMu.Lock()
	eng.plans["primary"] = plan
	eng.plansMu.Unlock()
	eng.providersMu.Lock()
	eng.providers["primary"] = plan.Provider
	eng.providersMu.Unlock()

	_, err := eng.relayWithFailover(context.Background(), plan, &RelayRequest{})
	if err == nil {
		t.Fatal("expected error when fallback provider is unresolvable")
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestRelayWithFailover_defaultThresholdOne_disablesOnFirstMatch(t *testing.T) {
	// Given: no explicit DisableThreshold -> behaves as 1 (legacy contract)
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{}, &model.FailoverHitCounter{})
	upstream := failingServer(t, http.StatusTooManyRequests, "可用预算已用尽")
	provider := &model.Provider{ID: "primary", Name: "primary"}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{
		Provider: provider,
		BaseURLs: []string{upstream.URL},
		Keys:     []string{"key"},
		FailoverRules: []*model.FailoverRule{{
			Condition:     "timeout",
			MatchPatterns: []string{"可用预算已用尽"},
			Dimension:     model.FailoverDimensionProvider,
			AutoDisable:   true,
		}},
	}

	// When
	_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{})

	// Then: a single match disables the provider (preserves today's behavior)
	if !engine.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID) {
		t.Fatal("provider should be disabled on the first match with default threshold 1")
	}
}

func TestRelayWithFailover_belowThreshold_doesNotDisable(t *testing.T) {
	// Given: threshold=3, no fallback so the request surfaces its error
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{}, &model.FailoverHitCounter{})
	upstream := failingServer(t, http.StatusTooManyRequests, "可用预算已用尽")
	provider := &model.Provider{ID: "primary", Name: "primary"}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{
		Provider: provider,
		BaseURLs: []string{upstream.URL},
		Keys:     []string{"key"},
		FailoverRules: []*model.FailoverRule{{
			Condition:          "timeout",
			MatchPatterns:      []string{"可用预算已用尽"},
			Dimension:          model.FailoverDimensionProvider,
			AutoDisable:        true,
			DisableThreshold:   3,
			DisableWindowMinutes: 5,
		}},
	}

	// When: two requests, threshold is 3
	_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{})
	_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{})

	// Then: still not disabled, counter should be at 2
	if engine.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID) {
		t.Fatal("provider was disabled before reaching the threshold")
	}
	var counter model.FailoverHitCounter
	if err := db.First(&counter, "provider_id = ? AND dimension = ?", provider.ID, model.FailoverDimensionProvider).Error; err != nil {
		t.Fatalf("counter missing: %v", err)
	}
	if counter.HitCount != 2 {
		t.Fatalf("hit count: want 2, got %d", counter.HitCount)
	}
}

func TestRelayWithFailover_hittingThreshold_disables(t *testing.T) {
	// Given: threshold=3, no fallback so requests surface their error
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{}, &model.FailoverHitCounter{})
	upstream := failingServer(t, http.StatusTooManyRequests, "可用预算已用尽")
	provider := &model.Provider{ID: "primary", Name: "primary"}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{
		Provider: provider,
		BaseURLs: []string{upstream.URL},
		Keys:     []string{"key"},
		FailoverRules: []*model.FailoverRule{{
			Condition:          "timeout",
			MatchPatterns:      []string{"可用预算已用尽"},
			Dimension:          model.FailoverDimensionProvider,
			AutoDisable:        true,
			DisableThreshold:   3,
			DisableWindowMinutes: 5,
		}},
	}

	// When: 3 consecutive failures
	for i := 0; i < 3; i++ {
		_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{})
	}

	// Then: provider disabled, counter dropped
	if !engine.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID) {
		t.Fatal("provider should be disabled after the third match")
	}
	var leftover model.FailoverHitCounter
	if err := db.First(&leftover, "provider_id = ?", provider.ID).Error; err == nil {
		t.Fatalf("hit counter should be cleared on disable, found %+v", leftover)
	}
}

func TestRelayWithFailover_successResetsCounter(t *testing.T) {
	// Threshold=3; rotation must succeed on the second baseURL so the
	// failing key/baseURL counter is reset by clearFailoverHit.
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{}, &model.FailoverHitCounter{})
	failing := failingServer(t, http.StatusTooManyRequests, "可用预算已用尽")
	working := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer working.Close()
	provider := &model.Provider{ID: "primary", Name: "primary"}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{
		Provider: provider,
		BaseURLs: []string{failing.URL, working.URL},
		Keys:     []string{"key"},
		FailoverRules: []*model.FailoverRule{{
			Condition:          "timeout",
			MatchPatterns:      []string{"可用预算已用尽"},
			Dimension:          model.FailoverDimensionBaseURL,
			AutoDisable:        true,
			DisableThreshold:   3,
			DisableWindowMinutes: 5,
		}},
	}

	for i := 0; i < 4; i++ {
		_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{BaseURLIndex: 0})
	}

	if engine.isDisabled(provider.ID, model.FailoverDimensionBaseURL, failing.URL) {
		t.Fatal("failing baseURL should not be disabled — successful rotations reset the counter")
	}
}

func TestRelayWithFailover_windowExpiryResetsCounter(t *testing.T) {
	// Given: threshold=3 with a 1-minute window. Two hits land, time is
	// rewound past the window, then a third hit must NOT trigger a
	// disable because the counter should restart at 1.
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{}, &model.FailoverHitCounter{})
	upstream := failingServer(t, http.StatusTooManyRequests, "可用预算已用尽")
	provider := &model.Provider{ID: "primary", Name: "primary"}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{
		Provider: provider,
		BaseURLs: []string{upstream.URL},
		Keys:     []string{"key"},
		FailoverRules: []*model.FailoverRule{{
			Condition:          "timeout",
			MatchPatterns:      []string{"可用预算已用尽"},
			Dimension:          model.FailoverDimensionProvider,
			AutoDisable:        true,
			DisableThreshold:   3,
			DisableWindowMinutes: 1,
		}},
	}

	_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{})
	_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{})

	// Rewind the seeded counter so the next hit is "outside the window".
	if err := db.Model(&model.FailoverHitCounter{}).
		Where("provider_id = ?", provider.ID).
		Update("first_hit_at", time.Now().Add(-2*time.Minute)).Error; err != nil {
		t.Fatalf("rewind counter: %v", err)
	}
	_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{})

	if engine.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID) {
		t.Fatal("provider should not be disabled — window expired and counter reset")
	}
	var counter model.FailoverHitCounter
	if err := db.First(&counter, "provider_id = ?", provider.ID).Error; err != nil {
		t.Fatalf("counter missing: %v", err)
	}
	if counter.HitCount != 1 {
		t.Fatalf("hit count after window reset: want 1, got %d", counter.HitCount)
	}
}

func TestTTFBForSlowUpstream_returnsMs_whenFirstByteOverLimit(t *testing.T) {
	// Given: upstream delays the first body byte 1.2s, rule limit is 1s.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush() // headers arrive immediately
		time.Sleep(1200 * time.Millisecond)
		_, _ = w.Write([]byte(`x`))
	}))
	defer upstream.Close()
	engine := NewEngine(nil)
	plan := &ExecutionPlan{
		Provider: &model.Provider{ID: "p", Name: "p"},
		FailoverRules: []*model.FailoverRule{
			{TTFBSeconds: 1, Status: true, Dimension: model.FailoverDimensionProvider},
		},
	}
	resp, err := engine.performUpstreamCall(context.Background(), &ExecutionPlan{
		Provider: &model.Provider{ID: "p", Name: "p"},
		BaseURLs: []string{upstream.URL},
		Keys:     []string{"k"},
	}, &RelayRequest{})
	if err != nil {
		t.Fatalf("upstream call: %v", err)
	}
	if got := engine.ttfbForSlowUpstream(plan, resp); got < 1000 {
		t.Fatalf("expected first byte ms > 1000, got %d", got)
	}
	// The probe reader must still deliver the first byte to the consumer.
	buf := make([]byte, 1)
	if _, err := io.ReadFull(resp.Body, buf); err != nil || string(buf) != "x" {
		t.Fatalf("expected body to still be readable, got %q err=%v", buf, err)
	}
	_ = resp.Body.Close()
}

func TestTTFBForSlowUpstream_returnsZero_whenFirstByteWithinLimit(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`ok`))
	}))
	defer upstream.Close()
	engine := NewEngine(nil)
	plan := &ExecutionPlan{
		Provider: &model.Provider{ID: "p", Name: "p"},
		FailoverRules: []*model.FailoverRule{
			{TTFBSeconds: 5, Status: true, Dimension: model.FailoverDimensionProvider},
		},
	}
	resp, err := engine.performUpstreamCall(context.Background(), &ExecutionPlan{
		Provider: &model.Provider{ID: "p", Name: "p"},
		BaseURLs: []string{upstream.URL},
		Keys:     []string{"k"},
	}, &RelayRequest{})
	if err != nil {
		t.Fatalf("upstream call: %v", err)
	}
	if got := engine.ttfbForSlowUpstream(plan, resp); got != 0 {
		t.Fatalf("expected 0 (first byte within limit), got %d", got)
	}
	_ = resp.Body.Close()
}

func TestTTFBForSlowUpstream_returnsZero_whenNoRuleHasLimit(t *testing.T) {
	engine := NewEngine(nil)
	plan := &ExecutionPlan{
		Provider: &model.Provider{ID: "p", Name: "p"},
		FailoverRules: []*model.FailoverRule{
			{TTFBSeconds: 0, Status: true},
			{TTFBSeconds: 5, Status: false},
		},
	}
	resp := &RelayResponse{Body: io.NopCloser(strings.NewReader("x"))}
	if got := engine.ttfbForSlowUpstream(plan, resp); got != 0 {
		t.Fatalf("expected 0 (no enabled rule with limit), got %d", got)
	}
}

func TestRuleMatchesOutcome_ttfbExceeded_matchesRuleWithLimit(t *testing.T) {
	rule := &model.FailoverRule{
		TTFBSeconds:   10,
		MatchPatterns: []string{"无关关键词"}, // patterns 不命中也不影响 TTFB OR 条件
		Dimension:     model.FailoverDimensionProvider,
	}
	if !ruleMatchesOutcome(rule, upstreamOutcome{ttfbExceeded: true, ttfbMs: 12000}) {
		t.Fatal("ttfbExceeded should match even when match patterns don't")
	}
	if ruleMatchesOutcome(rule, upstreamOutcome{}) {
		t.Fatal("non-exceeded outcome must not match")
	}
}

func TestRuleMatchesOutcome_ttfbExceeded_doesNotMatchRuleWithoutLimit(t *testing.T) {
	rule := &model.FailoverRule{
		TTFBSeconds: 0,
		Condition:   "timeout",
	}
	if ruleMatchesOutcome(rule, upstreamOutcome{ttfbExceeded: true, ttfbMs: 9999}) {
		t.Fatal("rule without ttfb limit must not match on ttfbExceeded")
	}
}

func TestRelayWithFailover_autoDisablesProvider_whenTTFBExceedsLimit(t *testing.T) {
	// Given: upstream responds successfully but only after 1.2s; rule allows 1s.
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{}, &model.FailoverHitCounter{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// header 立即到达，但 body 首字节拖到 1.2s 之后才发 —— 模拟真正的
		// 「首字慢」场景（老写法 header+body 一起延迟，测不出首字语义）。
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		time.Sleep(1200 * time.Millisecond)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer upstream.Close()
	provider := &model.Provider{ID: "primary", Name: "primary"}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{
		Provider: provider,
		BaseURLs: []string{upstream.URL},
		Keys:     []string{"key"},
		FailoverRules: []*model.FailoverRule{{
			TTFBSeconds: 1,
			Status:      true,
			Dimension:   model.FailoverDimensionProvider,
			AutoDisable: true,
		}},
	}

	// When: the request "succeeds" upstream but the first body byte is slow.
	resp, err := engine.relayWithFailover(context.Background(), plan, &RelayRequest{})
	if err == nil {
		t.Fatal("expected error for slow response after TTFB exceed")
	}
	if resp == nil {
		t.Fatal("expected response to be returned alongside the error")
	}
	// header 秒回（connect 快），慢的是 body 首字节 —— 验证的是首字语义。
	if resp.ConnectMs >= 1000 {
		t.Fatalf("expected fast connect (< 1s), got %d — this scenario must be a body-first-byte timeout", resp.ConnectMs)
	}

	// Then: provider got auto-disabled even though the upstream returned 2xx.
	if !engine.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID) {
		t.Fatal("provider should be auto-disabled when TTFB exceeds the rule limit")
	}
}
