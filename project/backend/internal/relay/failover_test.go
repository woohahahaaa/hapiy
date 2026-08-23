package relay

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

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
	db := newRelayTestDB(t, &model.ProviderDisableState{})
	state := model.ProviderDisableState{ProviderID: "provider", Dimension: model.FailoverDimensionKey, Value: "bad", Disabled: true}
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
	db := newRelayTestDB(t, &model.Provider{}, &model.ProviderDisableState{})
	provider := model.Provider{ID: "provider", Name: "provider", AutoDisabled: false}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	engine := NewEngine(db)
	plan := &ExecutionPlan{Provider: &provider, BaseURLs: []string{"https://upstream.example"}, Keys: []string{"key"}}
	rule := &model.FailoverRule{Actions: []model.FailoverAction{{Dimension: model.FailoverDimensionProvider, RetryCount: 1, AutoDisable: true}}}

	// When
	err := engine.applyFailoverAction(plan, &RelayRequest{BaseURLIndex: 0, KeyIndex: 0}, rule.Actions[0])

	// Then
	if err != nil {
		t.Fatalf("apply actions: %v", err)
	}
	if !engine.isDisabled(provider.ID, model.FailoverDimensionProvider, provider.ID) {
		t.Fatal("provider state was not persisted")
	}
	var reloaded model.Provider
	if err := db.First(&reloaded, "id = ?", provider.ID).Error; err != nil {
		t.Fatalf("reload provider: %v", err)
	}
	if !reloaded.AutoDisabled {
		t.Fatal("legacy provider auto-disabled flag was not synchronized")
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
			{Condition: "error", FallbackProvider: "fallback"},
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
	db := newRelayTestDB(t, &model.Provider{}, &model.ProviderDisableState{}, &model.TopologyConfig{}, &model.TopologySlotAssignment{})
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
	primaryPlan := &ExecutionPlan{ID: "primary", Provider: primaryProvider, BaseURLs: []string{primary.URL}, Keys: []string{"key"}, FailoverRules: []*model.FailoverRule{{Condition: "error", Actions: []model.FailoverAction{{Dimension: model.FailoverDimensionProvider}}}}}
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
			{Condition: "error", FallbackProvider: "fallback"},
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
