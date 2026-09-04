package affinity

import "testing"

func TestLookupNoRules(t *testing.T) {
	cs := CompileRules(&AffinitySetting{Enabled: true, DefaultTTLSeconds: 30, Rules: []Rule{}})
	res := cs.Lookup(&Request{Model: "gpt-4", Path: "/v1/chat/completions"})
	if res.Matched {
		t.Fatalf("expected no match with zero rules")
	}
}

func TestLookupMatchByHeaderFields(t *testing.T) {
	cs := CompileRules(&AffinitySetting{
		Enabled:           true,
		DefaultTTLSeconds: 30,
		Rules: []Rule{{
			Name:            "r1",
			Enabled:         true,
			SessionIDFields: []string{"X-Session-Id"},
		}},
	})

	req := &Request{
		Model:   "gpt-4",
		Path:    "/v1/chat/completions",
		Headers: map[string]string{"x-session-id": "abc"},
	}
	res := cs.Lookup(req)
	if res.Matched {
		t.Fatalf("expected miss before Record")
	}
	if res.CacheKey == "" {
		t.Fatalf("expected a cache key on miss")
	}
	if res.SessionID != "abc" {
		t.Fatalf("expected SessionID=abc, got %q", res.SessionID)
	}

	cs.Record("r1", "abc", "gpt-4", Triple{ProviderName: "p1", KeyIndex: 2, BaseURLIndex: 0}, 30)
	res = cs.Lookup(req)
	if !res.Matched {
		t.Fatalf("expected hit after Record")
	}
	if res.Triple.ProviderName != "p1" || res.Triple.KeyIndex != 2 {
		t.Fatalf("unexpected triple: %+v", res.Triple)
	}
}

func TestLookupModelCacheIsolation(t *testing.T) {
	cs := CompileRules(&AffinitySetting{
		Enabled:           true,
		DefaultTTLSeconds: 30,
		Rules: []Rule{{
			Name:            "r",
			Enabled:         true,
			SessionIDFields: []string{"X-Session-Id"},
		}},
	})
	req := &Request{
		Model:   "gpt-4",
		Headers: map[string]string{"X-Session-Id": "abc"},
	}
	cs.Record("r", "abc", "gpt-4", Triple{ProviderName: "p1", KeyIndex: 0, BaseURLIndex: 0}, 30)

	if res := cs.Lookup(&Request{Model: "claude-3", Headers: map[string]string{"X-Session-Id": "abc"}}); res.Matched {
		t.Fatalf("expected miss because model is part of the cache key")
	}
	if res := cs.Lookup(req); !res.Matched {
		t.Fatalf("expected hit for same session+model")
	}
}

func TestLookupModelFieldReadFromBody(t *testing.T) {
	cs := CompileRules(&AffinitySetting{
		Enabled:           true,
		DefaultTTLSeconds: 30,
		Rules: []Rule{{
			Name:           "r",
			Enabled:        true,
			SessionIDFields: []string{"X-Session-Id"},
			ModelFields:     []string{"model_alias", "model"},
		}},
	})
	req := &Request{
		Headers: map[string]string{"X-Session-Id": "s1"},
		Body:    []byte(`{"model_alias":"gpt-4-from-body","model":"gpt-4"}`),
	}
	// First lookup misses (nothing recorded); the extracted model alias
	// must still reflect the body-path reading.
	miss := cs.Lookup(req)
	if miss.Matched {
		t.Fatalf("expected miss before Record")
	}
	if miss.ModelName != "gpt-4-from-body" {
		t.Fatalf("expected ModelName=gpt-4-from-body, got %q", miss.ModelName)
	}

	cs.Record("r", "s1", "gpt-4-from-body", Triple{ProviderName: "p1"}, 30)
	res := cs.Lookup(req)
	if !res.Matched {
		t.Fatalf("expected hit after Record")
	}
	if res.ModelName != "gpt-4-from-body" {
		t.Fatalf("expected ModelName=gpt-4-from-body, got %q", res.ModelName)
	}
}

func TestLookupRuleDisabled(t *testing.T) {
	cs := CompileRules(&AffinitySetting{
		Enabled: true,
		Rules: []Rule{{
			Name:            "off",
			Enabled:         false,
			SessionIDFields: []string{"X"},
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
			Name:            "r",
			Enabled:         true,
			SessionIDFields: []string{"X"},
		}},
	})
	if res := cs.Lookup(&Request{Model: "gpt", Headers: map[string]string{"X": "v"}}); res.Matched {
		t.Fatalf("global disabled must block matching")
	}
}

func TestLookupMatchBySessionOnly(t *testing.T) {
	cs := CompileRules(&AffinitySetting{
		Enabled:           true,
		DefaultTTLSeconds: 30,
		Rules: []Rule{{
			Name:            "r",
			Enabled:         true,
			SessionIDFields: []string{"X-Session-Id"},
		}},
	})
	req := &Request{
		Model:   "gpt-4",
		Headers: map[string]string{"X-Session-Id": "s1"},
	}
	cs.Record("r", "s1", "gpt-4", Triple{ProviderName: "p1"}, 30)

	if res := cs.Lookup(&Request{Model: "gpt-4", Headers: map[string]string{"X-Session-Id": "s2"}}); res.Matched {
		t.Fatalf("expected miss because session id changed")
	}
	if res := cs.Lookup(req); !res.Matched {
		t.Fatalf("expected hit for matching session+model")
	}
}
