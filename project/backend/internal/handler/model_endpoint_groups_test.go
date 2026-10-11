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
