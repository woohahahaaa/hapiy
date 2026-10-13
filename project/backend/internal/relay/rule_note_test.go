package relay

import (
	"strings"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
)

// The motivating case: a header set-from-ref whose source header the client
// never sent. The rule hits (no conditions) but changes nothing — before
// this feature the capture just looked unmodified with no explanation.
func TestRewriteNotes_missingRefHeaderReportsNoEffect(t *testing.T) {
	chain, err := compileRewriteChain("r1", `[
		{"path":"header.x-opencode-session","mode":"set","value":{"ref":"X-Session-Id"},"scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	headers := map[string]string{"Authorization": "Bearer hk-x"}
	body, out, notes, err := applyRewriteChainsWithNotes(
		[]byte(`{"model":"m"}`),
		headers,
		[]CompiledRewriteChain{{RuleID: "r1", RuleName: "为 opencode go 添加x-opencode-session", Ops: chain}},
		service.RuleCategoryRequest,
	)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if !strings.HasPrefix(string(body), `{"model"`) {
		t.Fatalf("body must stay untouched, got %s", body)
	}
	if _, ok := out["x-opencode-session"]; ok {
		t.Fatalf("missing ref source must not write the header, got %q", out["x-opencode-session"])
	}
	want := "[请求改写] 为 opencode go 添加x-opencode-session：命中但未生效（引用源 X-Session-Id 不存在）"
	if got := service.RuleNotesText(notes); got != want {
		t.Fatalf("note text = %q, want %q", got, want)
	}
}

// A ref whose source exists reports 命中并生效, and a rule whose conditions
// do not match reports 未命中 — the three states must stay distinguishable.
func TestRewriteNotes_hitAndMiss(t *testing.T) {
	hitChain, err := compileRewriteChain("r1", `[
		{"path":"header.x-session","mode":"set","value":{"ref":"X-Session-Id"},"scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile hit: %v", err)
	}
	missChain, err := compileRewriteChain("r2", `[
		{"path":"temperature","mode":"set","value":0.1,"conditions":[{"path":"model","op":"eq","value":"other","scope":"body"}]}
	]`)
	if err != nil {
		t.Fatalf("compile miss: %v", err)
	}
	chains := []CompiledRewriteChain{
		{RuleID: "r1", RuleName: "拷贝会话", Ops: hitChain},
		{RuleID: "r2", RuleName: "改了别的模型的温度", Ops: missChain},
	}
	_, out, notes, err := applyRewriteChainsWithNotes(
		[]byte(`{"model":"m","temperature":0.7}`),
		map[string]string{"X-Session-Id": "ses_1"},
		chains,
		service.RuleCategoryRequest,
	)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["x-session"] != "ses_1" {
		t.Fatalf("ref source should be copied, got %q", out["x-session"])
	}
	want := "[请求改写] 拷贝会话：命中并生效\n[请求改写] 改了别的模型的温度：未命中"
	if got := service.RuleNotesText(notes); got != want {
		t.Fatalf("note text = %q, want %q", got, want)
	}
}

// A cross-domain ref whose source is absent reports 命中但未生效 with the domain
// prefix kept, so the note says which domain was read.
func TestRewriteNotes_crossDomainMissingSourceReportsNoEffect(t *testing.T) {
	headerChain, err := compileRewriteChain("r1", `[
		{"path":"header.x-from-body","mode":"set","value":{"ref":"body.messages.0.content"},"scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile header: %v", err)
	}
	_, _, notes, err := applyRewriteChainsWithNotes([]byte(`{}`), nil,
		[]CompiledRewriteChain{{RuleID: "r1", RuleName: "取 body 首句", Ops: headerChain}}, service.RuleCategoryRequest)
	if err != nil {
		t.Fatalf("apply header: %v", err)
	}
	want := "[请求改写] 取 body 首句：命中但未生效（引用源 body.messages.0.content 不存在）"
	if got := service.RuleNotesText(notes); got != want {
		t.Fatalf("note text = %q, want %q", got, want)
	}

	bodyChain, err := compileRewriteChain("r2", `[
		{"path":"session","mode":"set","value":{"ref":"header.X-Session-Id"}}
	]`)
	if err != nil {
		t.Fatalf("compile body: %v", err)
	}
	_, _, notes, err = applyRewriteChainsWithNotes([]byte(`{}`), map[string]string{"Authorization": "Bearer hk-x"},
		[]CompiledRewriteChain{{RuleID: "r2", RuleName: "取会话头", Ops: bodyChain}}, service.RuleCategoryRequest)
	if err != nil {
		t.Fatalf("apply body: %v", err)
	}
	want = "[请求改写] 取会话头：命中但未生效（引用源 header.X-Session-Id 不存在）"
	if got := service.RuleNotesText(notes); got != want {
		t.Fatalf("note text = %q, want %q", got, want)
	}
}

// The same note contract holds for a set-from-hash op whose source is absent.
func TestRewriteNotes_hashMissingSourceReportsNoEffect(t *testing.T) {
	chain, err := compileRewriteChain("r1", `[
		{"path":"header.x-opencode-session","mode":"set","value":{"hash":"body.messages.1.content"},"scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, _, notes, err := applyRewriteChainsWithNotes([]byte(`{"model":"m"}`), nil,
		[]CompiledRewriteChain{{RuleID: "r1", RuleName: "派发会话 id", Ops: chain}}, service.RuleCategoryRequest)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	want := "[请求改写] 派发会话 id：命中但未生效（引用源 body.messages.1.content 不存在）"
	if got := service.RuleNotesText(notes); got != want {
		t.Fatalf("note text = %q, want %q", got, want)
	}
}

// A body op whose target path is absent reports 命中但未生效 with the path,
// so a rule silently doing nothing is explainable.
func TestRewriteNotes_missingBodyPathReportsNoEffect(t *testing.T) {
	chain, err := compileRewriteChain("r1", `[
		{"path":"messages.0.content","mode":"replace","from":"a","to":"b"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, _, notes, err := applyRewriteChainsWithNotes([]byte(`{"model":"m"}`), nil,
		[]CompiledRewriteChain{{RuleID: "r1", RuleName: "替换失败路径", Ops: chain}}, service.RuleCategoryResponse)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	want := "[响应改写] 替换失败路径：命中但未生效（目标路径 messages.0.content 不存在）"
	if got := service.RuleNotesText(notes); got != want {
		t.Fatalf("note text = %q, want %q", got, want)
	}
}

// applyCompiledRewriteRules must persist the per-rule notes on the request
// so both the capture rows and the usage record can render them.
func TestApplyCompiledRewriteRules_recordsRuleNotes(t *testing.T) {
	eng := &Engine{}
	plan := &ExecutionPlan{CompiledRewrite: []CompiledRewriteChain{{
		RuleID:   "r1",
		RuleName: "为 opencode go 添加x-opencode-session",
		Ops:      mustChain(t, `[{"path":"header.x-opencode-session","mode":"set","value":{"ref":"X-Session-Id"},"scope":"header"}]`),
	}}}
	req := &RelayRequest{
		Headers: map[string]string{"Authorization": "Bearer hk-x"},
		Body:    map[string]interface{}{"model": "deepseek-v4.1-flash"},
	}
	if err := eng.applyCompiledRewriteRules(plan, req); err != nil {
		t.Fatalf("applyCompiledRewriteRules: %v", err)
	}
	want := "[请求改写] 为 opencode go 添加x-opencode-session：命中但未生效（引用源 X-Session-Id 不存在）"
	if got := service.RuleNotesText(req.RuleNotes); got != want {
		t.Fatalf("req notes = %q, want %q", got, want)
	}
	if _, ok := req.Headers["x-opencode-session"]; ok {
		t.Fatalf("header must stay absent, got %q", req.Headers["x-opencode-session"])
	}
}

// captureRuleNotes splits the per-request notes into the capture stage that
// should display them: request rewrite on the request nodes, response
// rewrite and failover on the response nodes.
func TestCaptureRuleNotes_splitsByStage(t *testing.T) {
	req := &RelayRequest{RuleNotes: []service.RuleNote{
		{Category: service.RuleCategoryRequest, RuleID: "r1", Rule: "req", Status: service.RuleStatusHit},
		{Category: service.RuleCategoryFailover, RuleID: "f1", Rule: "fo", Status: service.RuleStatusMiss},
		{Category: service.RuleCategoryResponse, RuleID: "r2", Rule: "rsp", Status: service.RuleStatusHit},
	}}
	if got := captureRuleNotes(topologyStageRequestBefore, req); len(got) != 0 {
		t.Fatalf("request_before must carry no notes, got %q", service.RuleNotesText(got))
	}
	if got := service.RuleNotesText(captureRuleNotes(topologyStageRequestAfter, req)); got != "[请求改写] req：命中并生效" {
		t.Fatalf("request_after notes = %q", got)
	}
	want := "[故障转移] fo：未命中\n[响应改写] rsp：命中并生效"
	if got := service.RuleNotesText(captureRuleNotes(topologyStageResponseAfter, req)); got != want {
		t.Fatalf("response_after notes = %q, want %q", got, want)
	}
}

// appendFailoverNotes records the matched rule's outcome and 未命中 for the
// other rules; replaceFailoverNote swaps a late speed outcome in place so a
// rule never reports two contradictory statuses.
func TestFailoverNotes_matchedMissAndReplace(t *testing.T) {
	rules := []*model.FailoverRule{
		{ID: "f1", Name: "主转移"},
		{ID: "f2", Name: "备用转移"},
	}
	req := &RelayRequest{}
	appendFailoverNotes(req, rules, nil)
	want := "[故障转移] 主转移：未命中\n[故障转移] 备用转移：未命中"
	if got := service.RuleNotesText(req.RuleNotes); got != want {
		t.Fatalf("miss notes = %q, want %q", got, want)
	}

	req = &RelayRequest{}
	appendFailoverNotes(req, rules, failoverNote(rules[0], service.RuleStatusHit, "已转移至 back"))
	want = "[故障转移] 主转移：命中并生效（已转移至 back）\n[故障转移] 备用转移：未命中"
	if got := service.RuleNotesText(req.RuleNotes); got != want {
		t.Fatalf("hit notes = %q, want %q", got, want)
	}

	replaceFailoverNote(req, *failoverNote(rules[1], service.RuleStatusHit, "响应速度 3.0 token/s 低于规则限制 5 token/s"))
	want = "[故障转移] 主转移：命中并生效（已转移至 back）\n[故障转移] 备用转移：命中并生效（响应速度 3.0 token/s 低于规则限制 5 token/s）"
	if got := service.RuleNotesText(req.RuleNotes); got != want {
		t.Fatalf("replaced notes = %q, want %q", got, want)
	}
	if len(req.RuleNotes) != 2 {
		t.Fatalf("replace must not append a second note for the same rule, got %d", len(req.RuleNotes))
	}
}
