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

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
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
	if alternatives := topology.FindProviderSlotAlternatives(topologySnapshot, engine.buildFlatProviderRefs(), "m1", "/v1/chat/completions", "entry", "primary", nil); len(alternatives) != 2 {
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
			Condition:            "timeout",
			MatchPatterns:        []string{"可用预算已用尽"},
			Dimension:            model.FailoverDimensionProvider,
			AutoDisable:          true,
			DisableThreshold:     3,
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

func TestRelayWithFailover_countsFailuresOnRotatedKeys(t *testing.T) {
	db := newRelayTestDB(t, &model.Provider{}, &model.AutoDisableState{}, &model.FailoverHitCounter{})
	upstream := failingServer(t, http.StatusTooManyRequests, "usage limit reached")
	provider := &model.Provider{ID: "primary", Name: "primary"}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{
		Provider: provider,
		BaseURLs: []string{upstream.URL},
		Keys:     []string{"key-1", "key-2"},
		FailoverRules: []*model.FailoverRule{{
			Condition:            "error",
			MatchPatterns:        []string{"usage limit reached"},
			Dimension:            model.FailoverDimensionKey,
			AutoDisable:          true,
			DisableThreshold:     2,
			DisableWindowMinutes: 5,
		}},
	}

	for i := 0; i < 3; i++ {
		_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{})
	}

	if !engine.isDisabled(provider.ID, model.FailoverDimensionKey, "key-1") {
		t.Fatal("initial key should be disabled after two failures")
	}
	if !engine.isDisabled(provider.ID, model.FailoverDimensionKey, "key-2") {
		t.Fatal("rotated key should be disabled after two failures")
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
			Condition:            "timeout",
			MatchPatterns:        []string{"可用预算已用尽"},
			Dimension:            model.FailoverDimensionProvider,
			AutoDisable:          true,
			DisableThreshold:     3,
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

func TestRelayWithFailover_successfulRotationKeepsFailedEntityCounter(t *testing.T) {
	// Threshold=2; a successful rotation to another baseURL must not clear the
	// failing baseURL's counter because the success was on a different entity.
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
			Condition:            "timeout",
			MatchPatterns:        []string{"可用预算已用尽"},
			Dimension:            model.FailoverDimensionBaseURL,
			AutoDisable:          true,
			DisableThreshold:     2,
			DisableWindowMinutes: 5,
		}},
	}

	for i := 0; i < 2; i++ {
		_, _ = engine.relayWithFailover(context.Background(), plan, &RelayRequest{BaseURLIndex: 0})
	}

	if !engine.isDisabled(provider.ID, model.FailoverDimensionBaseURL, failing.URL) {
		t.Fatal("failing baseURL should be disabled after two failures despite successful rotations")
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
			Condition:            "timeout",
			MatchPatterns:        []string{"可用预算已用尽"},
			Dimension:            model.FailoverDimensionProvider,
			AutoDisable:          true,
			DisableThreshold:     3,
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

func TestTTFBForSlowUpstream_countsSlowHeaders_beforeBody(t *testing.T) {
	// 响应头 1.5s 后才到、body 立即返回：新口径从「请求发出」计时，
	// 1.5s > 1s 阈值必须算超时（旧口径从响应头后才开始算，测不出这类慢）。
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(1500 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`ok`))
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
		t.Fatalf("expected slow headers to count toward TTFB, got %d", got)
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

// TestRelayWithFailover_affinityHitBreaksAffinityAndFallsBack verifies the
// affinity-hit contract: a request dispatched through channel affinity has
// no TopologyOrigin, but carrying EntryID it must still fail over to an
// eligible sibling provider, and the failover must sever the affinity
// bindings (rule cache key + fallback history row) that pinned the request
// to the failing entity.
func TestRelayWithFailover_affinityHitBreaksAffinityAndFallsBack(t *testing.T) {
	primaryHits := 0
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		primaryHits++
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"Go usage limit exceeded"}}`))
	}))
	defer primary.Close()
	alternate := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer alternate.Close()

	db := newRelayTestDB(t, &model.Provider{}, &model.TopologyConfig{}, &model.RequestChannelHistory{},
		&model.TopologySlotAssignment{}, &model.Setting{}, &model.FailoverHitCounter{}, &model.AutoDisableState{})
	primaryProvider := &model.Provider{ID: "primary", Name: "primary", BaseURLs: `[` + strconv.Quote(primary.URL) + `]`, Keys: `["k"]`, Status: true, WorkflowEnabled: true}
	alternateProvider := &model.Provider{ID: "alternate", Name: "alternate", BaseURLs: `[` + strconv.Quote(alternate.URL) + `]`, Keys: `["k"]`, Status: true, WorkflowEnabled: true}
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
	],"wires":[
		{"source":"entry","target":"provider-slot"},
		{"source":"provider-slot","target":"primary-node"},
		{"source":"provider-slot","target":"alternate-node"}
	]}`}).Error; err != nil {
		t.Fatalf("create topology: %v", err)
	}
	eng := NewEngine(db)
	rule := &model.FailoverRule{ID: "rule-1", Name: "供应商：转移", Condition: "timeout", Status: true,
		Dimension: model.FailoverDimensionProvider, AutoDisable: false, MatchPatterns: []string{"走过","usage limit"}}
	primaryPlan := &ExecutionPlan{ID: "primary", Provider: primaryProvider, BaseURLs: []string{primary.URL}, Keys: []string{"k"}, FailoverRules: []*model.FailoverRule{rule}}
	alternatePlan := &ExecutionPlan{ID: "alternate", Provider: alternateProvider, BaseURLs: []string{alternate.URL}, Keys: []string{"k"}}
	eng.plans = map[string]*ExecutionPlan{"primary": primaryPlan, "alternate": alternatePlan}
	eng.providers = map[string]*model.Provider{"primary": primaryProvider, "alternate": alternateProvider}

	// Seed a rule-affinity binding like a previously successful request would.
	ruleName, sessionID, modelName := "workbuddy", "sess-1", "glm-5.3-flash"
	affKey := eng.Affinity().Record(ruleName, sessionID, modelName, affinity.Triple{ProviderName: "primary", EntryID: "entry"}, 600)
	// Seed a fallback-affinity history row pinning (session, model) to primary.
	history := model.RequestChannelHistory{SessionID: sessionID, Model: modelName, ProviderID: "primary", EntryID: "entry"}
	if err := db.Create(&history).Error; err != nil {
		t.Fatalf("create history: %v", err)
	}
	eng.fallbackMu.Lock()
	eng.fallbackConfig = &affinity.FallbackSetting{Enabled: true, SessionIDFields: []string{"X-Session-Id"}, ModelFields: []string{"model"}}
	eng.fallbackMu.Unlock()
	if eng.fallbackSetting() == nil || !eng.fallbackSetting().Enabled {
		t.Fatal("fallback affinity should be enabled")
	}

	// When: an affinity-hit request (no TopologyOrigin, EntryID set) hits 429.
	relayReq := &RelayRequest{
		Model: modelName, Path: "/v1/chat/completions", EntryID: "entry", AffinityCacheKey: affKey,
		Headers: map[string]string{"X-Session-Id": sessionID},
	}
	resp, err := eng.relayWithFailover(context.Background(), primaryPlan, relayReq)
	if err != nil {
		t.Fatalf("relay should recover via alternate, got: %v", err)
	}
	if resp == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected alternate 200, got %+v", resp)
	}
	_ = resp.Body.Close()
	if relayReq.ServedProviderID != "alternate" {
		t.Fatalf("ServedProviderID should record the actual serving provider, got %q", relayReq.ServedProviderID)
	}

	// Then: rule affinity cache entry is gone and fallback history row deleted.
	if m := eng.Affinity().Lookup(&affinity.Request{Model: modelName, Headers: map[string]string{"X-Session-Id": sessionID}}); m.Matched {
		t.Fatal("rule affinity must be broken after failover")
	}
	var count int64
	if err := db.Model(&model.RequestChannelHistory{}).Where("session_id = ? AND model = ?", sessionID, modelName).Count(&count).Error; err != nil {
		t.Fatalf("count history: %v", err)
	}
	if count != 0 {
		t.Fatalf("fallback history should be deleted after failover, got %d rows", count)
	}
}

// TestRelayRequest_affinityHitFailoverRebuildsHistoryToServedProvider runs
// the full RelayRequest pipeline: affinity-hit request, provider-dimension
// failover to a sibling, and the success-path affinity recording. The
// fallback history must be rebuilt pointing at the ACTUAL serving provider
// (alternate), not the dispatched failing one — otherwise the next request
// would be pinned back to the failing provider.
func TestRelayRequest_affinityHitFailoverRebuildsHistoryToServedProvider(t *testing.T) {
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"Go usage limit exceeded"}}`))
	}))
	defer primary.Close()
	alternate := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer alternate.Close()

	db := newRelayTestDB(t, &model.Provider{}, &model.TopologyConfig{}, &model.RequestChannelHistory{},
		&model.TopologySlotAssignment{}, &model.Setting{}, &model.FailoverHitCounter{}, &model.AutoDisableState{},
		&model.Log{})
	service.InitLogWriter(db)
	primaryProvider := &model.Provider{ID: "primary", Name: "primary", BaseURLs: `[` + strconv.Quote(primary.URL) + `]`, Keys: `["k"]`, Status: true, WorkflowEnabled: true}
	alternateProvider := &model.Provider{ID: "alternate", Name: "alternate", BaseURLs: `[` + strconv.Quote(alternate.URL) + `]`, Keys: `["k"]`, Status: true, WorkflowEnabled: true}
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
	],"wires":[
		{"source":"entry","target":"provider-slot"},
		{"source":"provider-slot","target":"primary-node"},
		{"source":"provider-slot","target":"alternate-node"}
	]}`}).Error; err != nil {
		t.Fatalf("create topology: %v", err)
	}
	eng := NewEngine(db)
	eng.providers = map[string]*model.Provider{"primary": primaryProvider, "alternate": alternateProvider}
	rule := &model.FailoverRule{ID: "rule-1", Name: "供应商：转移", Condition: "timeout", Status: true,
		Dimension: model.FailoverDimensionProvider, AutoDisable: false, MatchPatterns: []string{"usage limit"}}
	primaryPlan := &ExecutionPlan{ID: "primary", Provider: primaryProvider, BaseURLs: []string{primary.URL}, Keys: []string{"k"}, FailoverRules: []*model.FailoverRule{rule}}
	eng.plans = map[string]*ExecutionPlan{"primary": primaryPlan, "alternate": {ID: "alternate", Provider: alternateProvider, BaseURLs: []string{alternate.URL}, Keys: []string{"k"}}}
	eng.fallbackMu.Lock()
	eng.fallbackConfig = &affinity.FallbackSetting{Enabled: true, SessionIDFields: []string{"X-Session-Id"}, ModelFields: []string{"model"}}
	eng.fallbackMu.Unlock()

	req := &RelayRequest{
		Model: "glm-5.3-flash", Path: "/v1/chat/completions", EntryID: "entry",
		Headers: map[string]string{"X-Session-Id": "sess-1"},
	}
	if _, err := eng.RelayRequest(context.Background(), primaryPlan, req); err != nil {
		t.Fatalf("RelayRequest should recover via alternate: %v", err)
	}

	var row model.RequestChannelHistory
	if err := db.Where("session_id = ? AND model = ?", "sess-1", "glm-5.3-flash").First(&row).Error; err != nil {
		t.Fatalf("fallback history should be rebuilt after success: %v", err)
	}
	if row.ProviderID != "alternate" {
		t.Fatalf("history must point at the served provider, got %q", row.ProviderID)
	}
	if row.KeyIndex != 0 || row.BaseURLIndex != 0 {
		t.Fatalf("history channel indices should be the served key/baseURL, got %d/%d", row.KeyIndex, row.BaseURLIndex)
	}

	// 转移成功后，使用记录应保留一条「原始失败」行（provider 转移前
	// 的上游错误），否则复盘只能看到 success，看不到转移发生。
	service.Logs().Flush()
	var failRows int64
	if err := db.Model(&model.Log{}).
		Where("status = ? AND provider_name = ? AND error_message LIKE ?", "failed", "primary", "%usage limit%").
		Count(&failRows).Error; err != nil {
		t.Fatalf("count failed log rows: %v", err)
	}
	if failRows != 1 {
		t.Fatalf("expected exactly 1 failed row for the transferred attempt, got %d", failRows)
	}
}

// TestRelayRequest_failedTransferWritesServedProviderRow verifies the
// failure-at-fallback path: when the original provider fails and the
// fallback provider also fails, the handler writes the failed row under
// the fallback provider actually tried (ServedProviderID), not the
// dispatched one — relayWithFailover must expose the attempted provider.
func TestRelayRequest_failedTransferWritesServedProviderRow(t *testing.T) {
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"Go usage limit exceeded"}}`))
	}))
	defer primary.Close()
	alternate := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"alt down"}`))
	}))
	defer alternate.Close()

	db := newRelayTestDB(t, &model.Provider{}, &model.TopologyConfig{}, &model.RequestChannelHistory{},
		&model.TopologySlotAssignment{}, &model.Setting{}, &model.FailoverHitCounter{}, &model.AutoDisableState{},
		&model.Log{})
	service.InitLogWriter(db)
	primaryProvider := &model.Provider{ID: "primary", Name: "primary", BaseURLs: `[` + strconv.Quote(primary.URL) + `]`, Keys: `["k"]`, Status: true, WorkflowEnabled: true}
	alternateProvider := &model.Provider{ID: "alternate", Name: "alternate", BaseURLs: `[` + strconv.Quote(alternate.URL) + `]`, Keys: `["k"]`, Status: true, WorkflowEnabled: true}
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
	],"wires":[
		{"source":"entry","target":"provider-slot"},
		{"source":"provider-slot","target":"primary-node"},
		{"source":"provider-slot","target":"alternate-node"}
	]}`}).Error; err != nil {
		t.Fatalf("create topology: %v", err)
	}
	eng := NewEngine(db)
	eng.providers = map[string]*model.Provider{"primary": primaryProvider, "alternate": alternateProvider}
	rule := &model.FailoverRule{ID: "rule-1", Name: "供应商：转移", Condition: "timeout", Status: true,
		Dimension: model.FailoverDimensionProvider, AutoDisable: false, MatchPatterns: []string{"usage limit"}}
	primaryPlan := &ExecutionPlan{ID: "primary", Provider: primaryProvider, BaseURLs: []string{primary.URL}, Keys: []string{"k"}, FailoverRules: []*model.FailoverRule{rule}}
	eng.plans = map[string]*ExecutionPlan{"primary": primaryPlan, "alternate": {ID: "alternate", Provider: alternateProvider, BaseURLs: []string{alternate.URL}, Keys: []string{"k"}}}

	req := &RelayRequest{Model: "m1", Path: "/v1/chat/completions", EntryID: "entry"}
	if _, err := eng.RelayRequest(context.Background(), primaryPlan, req); err == nil {
		t.Fatal("expected error when both primary and fallback fail")
	}
	if req.ServedProviderID != "alternate" {
		t.Fatalf("ServedProviderID must expose the attempted fallback provider, got %q", req.ServedProviderID)
	}
}
