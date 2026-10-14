package service

import (
	"testing"
)

// Stored notes round-trip through JSON, render their display lines, and the
// aggregated flags distinguish 未命中 from a rule that engaged (whether it
// took effect or not).
func TestRuleNotes_roundTripEngagedAndProblems(t *testing.T) {
	notes := []RuleNote{
		{Category: RuleCategoryRequest, RuleID: "r1", Rule: "加会话头", Status: RuleStatusNoEffect, Reason: "引用源 X-Session-Id 不存在"},
		{Category: RuleCategoryRequest, RuleID: "r2", Rule: "改温度", Status: RuleStatusMiss},
		{Category: RuleCategoryResponse, RuleID: "r3", Rule: "流式改写", Status: RuleStatusHit},
		{Category: RuleCategoryFailover, RuleID: "f1", Rule: "主转移", Status: RuleStatusFailed, Reason: "无可用回退供应商"},
		{Category: RuleCategoryRequest, RuleID: "r4", Rule: "改标题", Status: RuleStatusPartial, Reason: "目标路径 title 不存在"},
	}
	stored := RuleNotesJSON(notes)
	parsed := ParseRuleNotes(stored)
	if len(parsed) != len(notes) {
		t.Fatalf("parsed %d notes, want %d", len(parsed), len(notes))
	}
	if parsed[0].Reason != notes[0].Reason || parsed[0].Rule != notes[0].Rule {
		t.Fatalf("round trip lost fields: %+v", parsed[0])
	}

	wantText := "[请求改写] 命中·未生效：加会话头（引用源 X-Session-Id 不存在）\n" +
		"[请求改写] 未命中：改温度\n" +
		"[响应改写] 命中·生效：流式改写\n" +
		"[故障转移] 命中·出错：主转移（无可用回退供应商）\n" +
		"[请求改写] 命中·部分生效：改标题（目标路径 title 不存在）"
	if got := RuleNotesText(parsed); got != wantText {
		t.Fatalf("text = %q, want %q", got, wantText)
	}

	if !RuleNotesEngaged(parsed, RuleCategoryRequest) {
		t.Fatalf("request stage engaged (one no_effect) must report true")
	}
	if RuleNotesEngaged(parsed, RuleCategoryFailover) != true {
		t.Fatalf("failed failover rule is still an engagement")
	}
	onlyMiss := []RuleNote{{Category: RuleCategoryRequest, Rule: "x", Status: RuleStatusMiss}}
	if RuleNotesEngaged(onlyMiss, RuleCategoryRequest) {
		t.Fatalf("all-miss notes must not report engagement")
	}

	if got := RuleNotesJSON(nil); got != "" {
		t.Fatalf("empty notes encode as %q, want empty", got)
	}
	if ParseRuleNotes("") != nil || ParseRuleNotes("not json") != nil {
		t.Fatalf("empty/garbage notes must parse to nil")
	}
}
