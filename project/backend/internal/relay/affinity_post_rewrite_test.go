package relay

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/model"
)

// postRewriteFixture builds an engine whose affinity setting reads the session
// from X-Session-Id and whose one provider "p1" holds two keys and one base
// URL, so a recalled key index is observable.
func postRewriteFixture(t *testing.T) (*Engine, *ExecutionPlan) {
	t.Helper()
	engine, db := newTestEngine(t)
	provider := &model.Provider{
		ID: "p1", Name: "p1",
		BaseURLs: `["https://base.example"]`, Keys: `["k0","k1"]`,
		Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true,
	}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := affinity.NewStore(db).Save(&affinity.Setting{
		Enabled:         true,
		SessionIDFields: []string{"X-Session-Id"},
		ModelFields:     []string{"model"},
		TTLSeconds:      600,
	}); err != nil {
		t.Fatalf("save affinity setting: %v", err)
	}
	plan := &ExecutionPlan{
		ID:       provider.ID,
		Provider: provider,
		BaseURLs: []string{"https://base.example"},
		Keys:     []string{"k0", "k1"},
	}
	engine.providers = map[string]*model.Provider{provider.ID: provider}
	engine.plans = map[string]*ExecutionPlan{provider.ID: plan}
	engine.ReloadAffinity()
	return engine, plan
}

func TestResolvePostRewriteAffinity_sameProviderReusesKeyAndBaseURL(t *testing.T) {
	// Given: the session's history row is pinned to the provider's second key.
	engine, plan := postRewriteFixture(t)
	if err := engine.db.Create(&model.RequestChannelHistory{
		SessionID: "alice", Model: "m1", ProviderID: "p1",
		KeyIndex: 1, BaseURLIndex: 0, EntryID: "entry",
	}).Error; err != nil {
		t.Fatalf("create history row: %v", err)
	}
	req := &RelayRequest{
		Model: "m1", Path: "/v1/chat/completions", EntryID: "entry",
		Headers:  map[string]string{"X-Session-Id": "alice"},
		KeyIndex: -1, BaseURLIndex: -1,
	}

	// When: the post-rewrite recall runs on headers that now carry the session.
	engine.resolvePostRewriteAffinity(plan, req)

	// Then: the recalled channel is pinned and reported as a full reuse.
	if req.KeyIndex != 1 || req.BaseURLIndex != 0 {
		t.Fatalf("expected recalled channel 1/0, got %d/%d", req.KeyIndex, req.BaseURLIndex)
	}
	if req.AffinityReuse != AffinityReuseFull {
		t.Fatalf("expected full reuse, got %q", req.AffinityReuse)
	}
	if got := len(req.AffinityReuseParts); got != 3 {
		t.Fatalf("expected provider/baseurl/key parts, got %v", req.AffinityReuseParts)
	}
}

func TestResolvePostRewriteAffinity_newBinding(t *testing.T) {
	// Given: a readable session with no history yet.
	engine, plan := postRewriteFixture(t)
	req := &RelayRequest{
		Model: "m1", EntryID: "entry",
		Headers:  map[string]string{"X-Session-Id": "alice"},
		KeyIndex: -1, BaseURLIndex: -1,
	}

	// When / Then: the request establishes a fresh binding, like a "new" at
	// dispatch, and no channel is pinned.
	engine.resolvePostRewriteAffinity(plan, req)
	if req.AffinityReuse != "new" {
		t.Fatalf("expected new binding, got %q", req.AffinityReuse)
	}
	if req.KeyIndex != -1 || req.BaseURLIndex != -1 {
		t.Fatalf("a new binding must not pin a channel, got %d/%d", req.KeyIndex, req.BaseURLIndex)
	}
}

func TestResolvePostRewriteAffinity_ignoresOtherProviderAndOtherEntry(t *testing.T) {
	// Given: history rows that point at another (still loaded) provider, and at
	// another request entry.
	other := &model.Provider{ID: "p2", Name: "p2", BaseURLs: `["https://other.example"]`, Keys: `["k"]`, Status: true, WorkflowEnabled: true}
	cases := []struct {
		name    string
		history model.RequestChannelHistory
	}{
		{"other provider", model.RequestChannelHistory{SessionID: "alice", Model: "m1", ProviderID: "p2", KeyIndex: 0, BaseURLIndex: 0, EntryID: "entry"}},
		{"other entry", model.RequestChannelHistory{SessionID: "alice", Model: "m1", ProviderID: "p1", KeyIndex: 0, BaseURLIndex: 0, EntryID: "other-entry"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			engine, plan := postRewriteFixture(t)
			engine.providers[other.ID] = other
			engine.plans[other.ID] = &ExecutionPlan{ID: other.ID, Provider: other, BaseURLs: []string{"https://other.example"}, Keys: []string{"k"}}
			if err := engine.db.Create(&tc.history).Error; err != nil {
				t.Fatalf("create history row: %v", err)
			}
			req := &RelayRequest{
				Model: "m1", EntryID: "entry",
				Headers:  map[string]string{"X-Session-Id": "alice"},
				KeyIndex: -1, BaseURLIndex: -1,
			}

			// When
			engine.resolvePostRewriteAffinity(plan, req)

			// Then: a hit the rewrite stage cannot honour leaves the request
			// on the channel dispatch already picked.
			if req.AffinityReuse != "" || req.KeyIndex != -1 || req.BaseURLIndex != -1 {
				t.Fatalf("hit %+v must be ignored, got reuse=%q channel=%d/%d",
					tc.history, req.AffinityReuse, req.KeyIndex, req.BaseURLIndex)
			}
		})
	}

	t.Run("forgotten provider", func(t *testing.T) {
		// A row whose provider is gone entirely is not a recall either: the
		// request re-establishes the binding, which reads as "new" — the same
		// label the dispatch-time path gives it.
		engine, plan := postRewriteFixture(t)
		forgotten := model.RequestChannelHistory{SessionID: "alice", Model: "m1", ProviderID: "deleted-provider", KeyIndex: 0, BaseURLIndex: 0, EntryID: "entry"}
		if err := engine.db.Create(&forgotten).Error; err != nil {
			t.Fatalf("create history row: %v", err)
		}
		req := &RelayRequest{
			Model: "m1", EntryID: "entry",
			Headers:  map[string]string{"X-Session-Id": "alice"},
			KeyIndex: -1, BaseURLIndex: -1,
		}
		engine.resolvePostRewriteAffinity(plan, req)
		if req.AffinityReuse != "new" || req.KeyIndex != -1 || req.BaseURLIndex != -1 {
			t.Fatalf("a forgotten provider's row should re-bind, got reuse=%q channel=%d/%d",
				req.AffinityReuse, req.KeyIndex, req.BaseURLIndex)
		}
	})
}

func TestResolvePostRewriteAffinity_outOfRangeIndicesDegradeToPartial(t *testing.T) {
	// Given: a history row whose key index no longer exists (the provider's
	// key pool shrank).
	engine, plan := postRewriteFixture(t)
	if err := engine.db.Create(&model.RequestChannelHistory{
		SessionID: "alice", Model: "m1", ProviderID: "p1",
		KeyIndex: 7, BaseURLIndex: 0, EntryID: "entry",
	}).Error; err != nil {
		t.Fatalf("create history row: %v", err)
	}
	req := &RelayRequest{
		Model: "m1", EntryID: "entry",
		Headers:  map[string]string{"X-Session-Id": "alice"},
		KeyIndex: -1, BaseURLIndex: -1,
	}

	// When
	engine.resolvePostRewriteAffinity(plan, req)

	// Then: only the provider dimension is reused; the indices stay -1 so the
	// relay layer falls back to the first enabled channel.
	if req.AffinityReuse != AffinityReusePartial {
		t.Fatalf("expected partial reuse, got %q", req.AffinityReuse)
	}
	if len(req.AffinityReuseParts) != 1 || req.AffinityReuseParts[0] != "provider" {
		t.Fatalf("expected provider-only parts, got %v", req.AffinityReuseParts)
	}
	if req.KeyIndex != -1 || req.BaseURLIndex != -1 {
		t.Fatalf("out-of-range indices must not be pinned, got %d/%d", req.KeyIndex, req.BaseURLIndex)
	}
}

func TestResolvePostRewriteAffinity_postRewriteHitOverridesEarlierHit(t *testing.T) {
	// Given: dispatch already recalled channel 0/0 from the incoming session,
	// and the request rewrite then switches the request to a session whose
	// history points at the provider's second key.
	engine, plan := postRewriteFixture(t)
	if err := engine.db.Create(&model.RequestChannelHistory{
		SessionID: "alice", Model: "m1", ProviderID: "p1",
		KeyIndex: 1, BaseURLIndex: 0, EntryID: "entry",
	}).Error; err != nil {
		t.Fatalf("create history row: %v", err)
	}
	req := &RelayRequest{
		Model: "m1", EntryID: "entry",
		Headers:  map[string]string{"X-Session-Id": "alice"},
		KeyIndex: 0, BaseURLIndex: 0,
		AffinityDispatchState: AffinityReuseFull,
	}

	// When: the post-rewrite recall sees the rewritten session.
	engine.resolvePostRewriteAffinity(plan, req)

	// Then: the post-rewrite hit wins over the dispatch-time one.
	if req.KeyIndex != 1 || req.BaseURLIndex != 0 {
		t.Fatalf("expected the post-rewrite channel 1/0, got %d/%d", req.KeyIndex, req.BaseURLIndex)
	}
	if req.AffinityReuse != AffinityReuseFull || !req.AffinityAfterRewrite {
		t.Fatalf("expected a marked full reuse, got state=%q marked=%v", req.AffinityReuse, req.AffinityAfterRewrite)
	}
}

func TestResolvePostRewriteAffinity_rewrittenSessionWithNoHistoryDropsThePin(t *testing.T) {
	// Given: dispatch recalled a channel for the incoming session, but the
	// request rewrite moved the request to a session with no history yet.
	engine, plan := postRewriteFixture(t)
	if err := engine.db.Create(&model.RequestChannelHistory{
		SessionID: "alice", Model: "m1", ProviderID: "p1",
		KeyIndex: 1, BaseURLIndex: 0, EntryID: "entry",
	}).Error; err != nil {
		t.Fatalf("create history row: %v", err)
	}
	req := &RelayRequest{
		Model: "m1", EntryID: "entry",
		Headers:  map[string]string{"X-Session-Id": "bob"},
		KeyIndex: 0, BaseURLIndex: 0,
		AffinityDispatchState: AffinityReuseFull,
	}

	// When
	engine.resolvePostRewriteAffinity(plan, req)

	// Then: the rewritten session is what gets recorded, so its fresh binding
	// is the outcome and the earlier pin is dropped.
	if req.AffinityReuse != "new" || !req.AffinityAfterRewrite {
		t.Fatalf("expected a marked new binding, got state=%q marked=%v", req.AffinityReuse, req.AffinityAfterRewrite)
	}
	if req.KeyIndex != -1 || req.BaseURLIndex != -1 {
		t.Fatalf("a new binding must not pin a channel, got %d/%d", req.KeyIndex, req.BaseURLIndex)
	}
}

func TestResolvePostRewriteAffinity_unchangedSessionKeepsDispatchOutcome(t *testing.T) {
	// Given: the rewrite left the session as-is; the post-rewrite recall finds
	// exactly the channel dispatch already resolved.
	engine, plan := postRewriteFixture(t)
	if err := engine.db.Create(&model.RequestChannelHistory{
		SessionID: "alice", Model: "m1", ProviderID: "p1",
		KeyIndex: 1, BaseURLIndex: 0, EntryID: "entry",
	}).Error; err != nil {
		t.Fatalf("create history row: %v", err)
	}
	req := &RelayRequest{
		Model: "m1", EntryID: "entry",
		Headers:  map[string]string{"X-Session-Id": "alice"},
		KeyIndex: 1, BaseURLIndex: 0,
		AffinityDispatchState: AffinityReuseFull,
	}

	// When
	engine.resolvePostRewriteAffinity(plan, req)

	// Then: nothing is overridden and the usage log stays unmarked.
	if req.AffinityAfterRewrite != false || req.AffinityReuse != "" {
		t.Fatalf("identical outcome must not be re-marked, got state=%q marked=%v", req.AffinityReuse, req.AffinityAfterRewrite)
	}
	if req.KeyIndex != 1 || req.BaseURLIndex != 0 {
		t.Fatalf("channel should stay 1/0, got %d/%d", req.KeyIndex, req.BaseURLIndex)
	}
}

func TestResolvePostRewriteAffinity_leavesExplicitChannelPinAlone(t *testing.T) {
	// Given: a caller that already pinned a channel (e.g. a recovery probe).
	engine, plan := postRewriteFixture(t)
	if err := engine.db.Create(&model.RequestChannelHistory{
		SessionID: "alice", Model: "m1", ProviderID: "p1",
		KeyIndex: 1, BaseURLIndex: 0, EntryID: "entry",
	}).Error; err != nil {
		t.Fatalf("create history row: %v", err)
	}
	req := &RelayRequest{
		Model: "m1", EntryID: "entry",
		Headers:  map[string]string{"X-Session-Id": "alice"},
		KeyIndex: 0, BaseURLIndex: 0,
	}

	// When / Then
	engine.resolvePostRewriteAffinity(plan, req)
	if req.KeyIndex != 0 || req.BaseURLIndex != 0 || req.AffinityReuse != "" {
		t.Fatalf("explicit pin was overridden: channel=%d/%d reuse=%q",
			req.KeyIndex, req.BaseURLIndex, req.AffinityReuse)
	}
}

func TestRelayRequest_postRewriteRecallPinsChannelSynthesizedByRule(t *testing.T) {
	// Given: a request whose session header is synthesized by the workflow's
	// own request rewrite (from the body), a history row pinned to the
	// provider's second key, and an upstream that reports the key it received.
	engine, plan := postRewriteFixture(t)
	ops, err := compileRewriteChain("rule-1", `[{"mode":"set","path":"header.x-opencode-session","value":{"hash":"body.messages.1.content"},"scope":"header"}]`)
	if err != nil {
		t.Fatalf("compile rewrite chain: %v", err)
	}
	plan.CompiledRewrite = []CompiledRewriteChain{{RuleID: "rule-1", RuleName: "session from body", Ops: ops}}
	if err := affinity.NewStore(engine.db).Save(&affinity.Setting{
		Enabled:         true,
		SessionIDFields: []string{"x-opencode-session"},
		ModelFields:     []string{"model"},
		TTLSeconds:      600,
	}); err != nil {
		t.Fatalf("save affinity setting: %v", err)
	}
	engine.ReloadAffinity()

	body := map[string]interface{}{"messages": []interface{}{
		map[string]interface{}{"role": "system", "content": "sys"},
		map[string]interface{}{"role": "user", "content": "hello"},
	}}
	if err := engine.db.Create(&model.RequestChannelHistory{
		SessionID: hashID("hello"), Model: "m1", ProviderID: "p1",
		KeyIndex: 1, BaseURLIndex: 0, EntryID: "entry",
	}).Error; err != nil {
		t.Fatalf("create history row: %v", err)
	}
	seen := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		seen <- request.Header.Get("Authorization")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	plan.BaseURLs = []string{server.URL}
	plan.Provider.BaseURLs = `[` + strconv.Quote(server.URL) + `]`

	req := &RelayRequest{
		RequestID: "req-post-affinity", Model: "m1", Path: "/v1/chat/completions",
		EntryID: "entry", Headers: map[string]string{}, Body: body,
		KeyIndex: -1, BaseURLIndex: -1,
	}

	// When: the pipeline runs its second recall after the rewrite.
	resp, err := engine.RelayRequest(context.Background(), plan, req)
	if err != nil {
		t.Fatalf("relay request: %v", err)
	}
	_, _ = io.ReadAll(resp.Body)
	resp.Body.Close()

	// Then: the pinned key served the request and the outcome is reported as
	// a full post-rewrite reuse.
	if got := <-seen; got != "Bearer k1" {
		t.Fatalf("expected the recalled key to serve the request, got %q", got)
	}
	if req.AffinityReuse != AffinityReuseFull || !req.AffinityAfterRewrite {
		t.Fatalf("expected a marked full reuse, got state=%q marked=%v", req.AffinityReuse, req.AffinityAfterRewrite)
	}
	// The recorded history stays on the same channel for the next request.
	var row model.RequestChannelHistory
	if err := engine.db.Where("session_id = ? AND model = ?", hashID("hello"), "m1").First(&row).Error; err != nil {
		t.Fatalf("load history row: %v", err)
	}
	if row.KeyIndex != 1 || row.BaseURLIndex != 0 {
		t.Fatalf("history should stay on the recalled channel, got %d/%d", row.KeyIndex, row.BaseURLIndex)
	}
}
