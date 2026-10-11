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
	names := uniqueSorted(membersModelNamesForEndpoint([]model.Provider{p}, "/v1/responses"))
	if len(names) != 2 || names[0] != "responses" || names[1] != "any" {
		t.Fatalf("group leaked incompatible model: %v", names)
	}
}
