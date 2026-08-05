package affinity

import "testing"

func TestLookupNoRules(t *testing.T) {
	cs := CompileRules(&AffinitySetting{Enabled: true, DefaultTTLSeconds: 30, Rules: []Rule{}})
	res := cs.Lookup(&Request{Model: "gpt-4", Path: "/v1/chat/completions"})
	if res.Matched {
		t.Fatalf("expected no match with zero rules")
	}
}

func TestLookupModelPathAndHeader(t *testing.T) {
	cs := CompileRules(&AffinitySetting{
		Enabled:          true,
		DefaultTTLSeconds: 30,
		Rules: []Rule{{
			Name:       "r1",
			Enabled:    true,
			ModelRegex: []string{"gpt-.*"},
			PathRegex:  []string{"/v1/chat/completions"},
			KeySources: []KeySource{{Type: SourceRequestHeader, Key: "X-Session-Id"}},
		}},
	})

	req := &Request{
		Model:   "gpt-4",
		Path:    "/v1/chat/completions",
		Headers: map[string]string{"x-session-id": "abc"},
	}
	// First lookup: no recall yet.
	res := cs.Lookup(req)
	if res.Matched {
		t.Fatalf("expected miss before Record")
	}
	if res.CacheKey == "" {
		t.Fatalf("expected a cache key on miss")
	}

	// Record a successful triple and recall it.
	cs.Record("r1", false, "gpt-4", "abc", Triple{ProviderName: "p1", KeyIndex: 2, BaseURLIndex: 0}, 30)
	res = cs.Lookup(req)
	if !res.Matched {
		t.Fatalf("expected hit after Record")
	}
	if res.Triple.ProviderName != "p1" || res.Triple.KeyIndex != 2 {
		t.Fatalf("unexpected triple: %+v", res.Triple)
	}
}

func TestLookupModelScoped(t *testing.T) {
	cs := CompileRules(&AffinitySetting{
		Enabled:           true,
		DefaultTTLSeconds: 30,
		Rules: []Rule{{
			Name:             "r",
			Enabled:          true,
			ModelRegex:       []string{".*"},
			KeySources:       []KeySource{{Type: SourceGJSON, Path: "session.id"}},
			IncludeModelName: true,
		}},
	})
	req := &Request{
		Model: "gpt-4",
		Body:  []byte(`{"session":{"id":"s1"}}`),
	}
	cs.Record("r", true, "gpt-4", "s1", Triple{ProviderName: "p1", KeyIndex: 0, BaseURLIndex: 0}, 30)

	// Same session, different model -> should NOT match the gpt-4 recall.
	other := &Request{Model: "claude-3", Body: []byte(`{"session":{"id":"s1"}}`)}
	if res := cs.Lookup(other); res.Matched {
		t.Fatalf("expected cross-model miss when IncludeModelName is set")
	}
	if res := cs.Lookup(req); !res.Matched {
		t.Fatalf("expected hit for same model")
	}
}

func TestLookupRuleDisabled(t *testing.T) {
	cs := CompileRules(&AffinitySetting{
		Enabled: true,
		Rules: []Rule{{
			Name:       "off",
			Enabled:    false,
			ModelRegex: []string{".*"},
			KeySources: []KeySource{{Type: SourceRequestHeader, Key: "X"}},
		}},
	})
	res := cs.Lookup(&Request{Model: "gpt", Headers: map[string]string{"X": "v"}})
	if res.Matched {
		t.Fatalf("disabled rule must not match")
	}
}

func TestGlobalDisabled(t *testing.T) {
	cs := CompileRules(&AffinitySetting{
		Enabled: false,
		Rules: []Rule{{
			Name:       "r",
			Enabled:    true,
			ModelRegex: []string{".*"},
			KeySources: []KeySource{{Type: SourceRequestHeader, Key: "X"}},
		}},
	})
	if res := cs.Lookup(&Request{Model: "gpt", Headers: map[string]string{"X": "v"}}); res.Matched {
		t.Fatalf("global disabled must block matching")
	}
}
