package relay

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
)

func TestIsFailoverEligible_matchesByCondition(t *testing.T) {
	cases := []struct {
		name     string
		rule     *model.FailoverRule
		outcome  upstreamOutcome
		wantName string
		want     bool
	}{
		{
			name: "timeout matches transport error",
			rule: &model.FailoverRule{Condition: "timeout", FallbackProvider: "fallback"},
			outcome: upstreamOutcome{transport: true, err: errors.New("boom")},
			wantName: "fallback",
			want: true,
		},
		{
			name: "rate_limit matches 429",
			rule: &model.FailoverRule{Condition: "rate_limit", FallbackProvider: "fallback"},
			outcome: upstreamOutcome{statusCode: 429},
			wantName: "fallback",
			want: true,
		},
		{
			name: "error matches 500",
			rule: &model.FailoverRule{Condition: "error", FallbackProvider: "fallback"},
			outcome: upstreamOutcome{statusCode: 500},
			wantName: "fallback",
			want: true,
		},
		{
			name: "error does not match 200",
			rule: &model.FailoverRule{Condition: "error", FallbackProvider: "fallback"},
			outcome: upstreamOutcome{statusCode: 200},
			want: false,
		},
		{
			name: "timeout does not match http 500",
			rule: &model.FailoverRule{Condition: "timeout", FallbackProvider: "fallback"},
			outcome: upstreamOutcome{statusCode: 500},
			want: false,
		},
		{
			name: "no fallback name on rule: ignored",
			rule: &model.FailoverRule{Condition: "error"},
			outcome: upstreamOutcome{statusCode: 500},
			want: false,
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
