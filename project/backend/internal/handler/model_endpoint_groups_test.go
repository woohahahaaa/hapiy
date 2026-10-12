package handler

import (
	"github.com/hapiy/hapiy/internal/model"
	"testing"
)

func TestManagedModelGroupsUseModelEndpoints(t *testing.T) {
	p := model.Provider{Models: `[{"model":"chat","endpoints":["/v1/chat/completions"]},{"model":"responses","endpoints":["/v1/responses"]},{"model":"any","endpoints":[]}]`}
	paths := effectiveProviderEndpoints(p)
	if len(paths) != 2 {
		t.Fatalf("paths: %v", paths)
	}
	names := uniqueSorted(membersModelNamesForEndpoint([]model.Provider{p}, "/v1/responses", nil))
	if len(names) != 2 || names[0] != "responses" || names[1] != "any" {
		t.Fatalf("group leaked incompatible model: %v", names)
	}
}

// TestManagedModelGroupsMergeByEndpointRule pins the glob-rule grouping:
// "/chat/completions" and "/v1/chat/completions" share "*completion*", so a
// group on either endpoint keeps both endpoints' models while an unrelated
// protocol stays out. Endpoints matching no rule keep grouping by exact
// string.
func TestManagedModelGroupsMergeByEndpointRule(t *testing.T) {
	protocols := []model.AgentProtocol{
		{Name: "responses", EndpointTags: []string{"*responses*"}},
		{Name: "completion", EndpointTags: []string{"*completion*"}},
	}
	p := model.Provider{Models: `[{"model":"chat","endpoints":["/chat/completions"]},{"model":"chat2","endpoints":["/v1/chat/completions"]},{"model":"responses","endpoints":["/v1/responses"]}]`}
	names := uniqueSorted(membersModelNamesForEndpoint([]model.Provider{p}, "/v1/chat/completions", protocols))
	if len(names) != 2 || names[0] != "chat" || names[1] != "chat2" {
		t.Fatalf("rule group must union both completion endpoints: %v", names)
	}
	names = uniqueSorted(membersModelNamesForEndpoint([]model.Provider{p}, "/v1/responses", protocols))
	if len(names) != 1 || names[0] != "responses" {
		t.Fatalf("responses group must not leak: %v", names)
	}
}

// TestMembersByRuleUnionsEndpoints pins the member union used by the
// managed view / sync: every provider contributing an endpoint of the same
// rule joins the group, deduplicated and stable.
func TestMembersByRuleUnionsEndpoints(t *testing.T) {
	protocols := []model.AgentProtocol{
		{Name: "completion", EndpointTags: []string{"*completion*"}},
	}
	live := map[string][]model.Provider{
		"/chat/completions":    {{ID: "a", Name: "A"}},
		"/v1/chat/completions": {{ID: "b", Name: "B"}},
		"/v1/embeddings":       {{ID: "c", Name: "C"}},
	}
	members := membersByRule(live, "/v1/chat/completions", protocols)
	if len(members) != 2 || members[0].ID != "a" || members[1].ID != "b" {
		t.Fatalf("members: %+v", members)
	}
}

// TestRepresentativeEndpointIsStable pins the canonical endpoint a rule
// group is named after: shortest first, ties broken lexicographically, so
// provider order / link order can never flip the choice.
func TestRepresentativeEndpointIsStable(t *testing.T) {
	if got := representativeEndpoint([]string{"/v1/chat/completions", "/chat/completions"}); got != "/chat/completions" {
		t.Fatalf("shortest must win, got %q", got)
	}
	if got := representativeEndpoint([]string{"/chat/completions", "/v1/chat/completions"}); got != "/chat/completions" {
		t.Fatalf("input order must not matter, got %q", got)
	}
	if got := representativeEndpoint([]string{"/b", "/a"}); got != "/a" {
		t.Fatalf("equal length ties break lexicographically, got %q", got)
	}
}

// TestEndpointRuleMapClassifies covers the map the 托管 dialog groups by:
// endpoints hitting a rule carry its canonical path / name / tag, endpoints
// hitting nothing stay out of the map (they keep grouping by exact string).
func TestEndpointRuleMapClassifies(t *testing.T) {
	protocols := []model.AgentProtocol{
		{Name: "responses", EndpointTags: []string{"*responses*"}},
		{Name: "completion", EndpointTags: []string{"*completion*"}},
	}
	got := endpointRuleMap([]string{"/v1/chat/completions", "/chat/completions", "/v1/embeddings"}, protocols)
	if _, ok := got["/v1/embeddings"]; ok {
		t.Fatalf("rule-less endpoint must stay out of the map: %+v", got)
	}
	info, ok := got["/v1/chat/completions"]
	if !ok {
		t.Fatalf("completion endpoint missing: %+v", got)
	}
	if info.Canonical != "/chat/completions" || info.RuleIndex != 1 || info.RuleName != "completion" || info.Tag != "*completion*" {
		t.Fatalf("unexpected rule info: %+v", info)
	}
}

func managedRuleForTest(t *testing.T) model.AgentTypeRule {
	t.Helper()
	rule := model.AgentTypeRule{Name: "test-agent"}
	if err := rule.SetJsonPaths(model.AgentJsonPaths{
		Provider:        "providers",
		Model:           "providers.{provider_id}.models",
		ModelsContainer: "array",
	}); err != nil {
		t.Fatalf("json paths: %v", err)
	}
	if err := rule.SetProtocols([]model.AgentProtocol{
		{Name: "responses", EndpointTags: []string{"*responses*"}},
		{Name: "completion", EndpointTags: []string{"*completion*"}},
	}); err != nil {
		t.Fatalf("protocols: %v", err)
	}
	return rule
}

// TestDeriveManagedProviderReportsRuleForPreFoldGroup pins the fix for rows
// saved before rule folding existed: the stored "/v1/chat/completions" group
// keeps its endpoint and suffix (no silent rename / baseURL change), but the
// view reports the rule it now hits, the endpoints that rule covers, and the
// models of every folded endpoint.
func TestDeriveManagedProviderReportsRuleForPreFoldGroup(t *testing.T) {
	rule := managedRuleForTest(t)
	providers := []model.Provider{{
		ID:     "p1",
		Name:   "A",
		Status: true,
		Models: `[{"model":"chat","endpoints":["/chat/completions","/v1/chat/completions"]},{"model":"resp","endpoints":["/v1/responses"]}]`,
	}}
	m := model.ManagedAgentProvider{ID: "m1", Name: "HAPIY", APIKey: "hk-test"}
	if err := m.SetProviderIDs([]string{"p1"}); err != nil {
		t.Fatalf("provider ids: %v", err)
	}
	if err := m.SetGroups([]model.ManagedAgentGroup{
		{Endpoint: "/v1/chat/completions", Suffix: "_c", ModelSources: map[string]string{}},
	}); err != nil {
		t.Fatalf("groups: %v", err)
	}
	row := model.AgentConfigFile{ID: "f1", Path: "~/.config/agent/config.json"}
	view := deriveManagedProvider(rule, row, providers, "{}", m, "http://gw/proxy")
	if len(view.Groups) != 1 {
		t.Fatalf("groups: %+v", view.Groups)
	}
	g := view.Groups[0]
	if g.Endpoint != "/v1/chat/completions" || g.Suffix != "_c" {
		t.Fatalf("stored endpoint / suffix must survive: %+v", g)
	}
	if g.RuleName != "completion" || g.RuleTag != "*completion*" {
		t.Fatalf("rule must be reported: %+v", g)
	}
	if len(g.Hits) != 2 || g.Hits[0] != "/chat/completions" || g.Hits[1] != "/v1/chat/completions" {
		t.Fatalf("hits: %v", g.Hits)
	}
	if len(g.ModelNames) != 1 || g.ModelNames[0] != "chat" {
		t.Fatalf("models must stay on the routed side: %v", g.ModelNames)
	}
}

// TestDeriveManagedProviderMergesSameRuleSuffix pins the view-side merge:
// stored groups of one rule with the same suffix become ONE provider block
// when written (rebuildManagedBlocks keys by endpoint+suffix, and folding
// makes two endpoints share a rule), so the view must show one group with
// both endpoints' models; a different suffix stays a group of its own.
func TestDeriveManagedProviderMergesSameRuleSuffix(t *testing.T) {
	rule := managedRuleForTest(t)
	providers := []model.Provider{
		{ID: "p1", Name: "A", Status: true, Models: `[{"model":"chat","endpoints":["/chat/completions"]}]`},
		{ID: "p2", Name: "B", Status: true, Models: `[{"model":"chat2","endpoints":["/v1/chat/completions"]}]`},
		{ID: "p3", Name: "C", Status: true, Models: `[{"model":"resp","endpoints":["/v1/responses"]}]`},
	}
	m := model.ManagedAgentProvider{ID: "m1", Name: "HAPIY", APIKey: "hk-test"}
	if err := m.SetProviderIDs([]string{"p1", "p2", "p3"}); err != nil {
		t.Fatalf("provider ids: %v", err)
	}
	if err := m.SetGroups([]model.ManagedAgentGroup{
		{Endpoint: "/chat/completions", Suffix: "_c", ProviderIDs: []string{"p1"}, ModelSources: map[string]string{"chat": "A"}},
		{Endpoint: "/v1/chat/completions", Suffix: "_c", ProviderIDs: []string{"p2"}, ModelSources: map[string]string{"chat2": "B"}},
		{Endpoint: "/v1/responses", Suffix: "_r", ProviderIDs: []string{"p3"}, ModelSources: map[string]string{}},
	}); err != nil {
		t.Fatalf("groups: %v", err)
	}
	row := model.AgentConfigFile{ID: "f1", Path: "~/.config/agent/config.json"}
	view := deriveManagedProvider(rule, row, providers, "{}", m, "http://gw/proxy")
	if len(view.Groups) != 2 {
		t.Fatalf("want 2 groups, got %+v", view.Groups)
	}
	merged := view.Groups[0]
	if merged.Endpoint != "/chat/completions" || merged.Suffix != "_c" {
		t.Fatalf("merged group keeps the first stored endpoint: %+v", merged)
	}
	if len(merged.Hits) != 2 {
		t.Fatalf("merged hits: %v", merged.Hits)
	}
	if len(merged.ModelNames) != 2 || merged.ModelNames[0] != "chat" || merged.ModelNames[1] != "chat2" {
		t.Fatalf("merged models: %v", merged.ModelNames)
	}
	if len(merged.ProviderIDs) != 2 || len(merged.ModelSources) != 2 {
		t.Fatalf("merged provider ids / sources: %+v", merged)
	}
	if view.Groups[1].Endpoint != "/v1/responses" || view.Groups[1].RuleTag != "*responses*" {
		t.Fatalf("second group must stay separate: %+v", view.Groups[1])
	}
}
