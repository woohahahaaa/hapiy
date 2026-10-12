package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Rule-note categories: which relay stage produced an outcome. They are
// rendered into the usage record's event_detail and the log capture detail,
// and drive the 请求改写 / 响应改写 markers on the capture list.
const (
	RuleCategoryRequest  = "请求改写"
	RuleCategoryResponse = "响应改写"
	RuleCategoryFailover = "故障转移"
)

// Rule-note statuses.
const (
	RuleStatusHit      = "hit"       // 条件命中且规则生效
	RuleStatusNoEffect = "no_effect" // 条件命中但没有任何修改（例如引用源不存在）
	RuleStatusFailed   = "failed"    // 条件命中但执行出错
	RuleStatusMiss     = "miss"      // 条件未命中
)

// RuleNote records what one configured rule did on a single request. Notes
// are stored on the log capture rows as a JSON array (model.LogCapture
// .RuleNotes) so both the display text and the aggregated flags (did this
// stage engage at all / did anything fail) derive from the same data.
type RuleNote struct {
	Category string `json:"category"`
	RuleID   string `json:"rule_id,omitempty"`
	Rule     string `json:"rule,omitempty"`
	Status   string `json:"status"`
	Reason   string `json:"reason,omitempty"`
}

// ParseRuleNotes decodes the stored JSON array; empty or non-JSON input
// yields nil so callers render nothing rather than garbage.
func ParseRuleNotes(text string) []RuleNote {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || !strings.HasPrefix(trimmed, "[") {
		return nil
	}
	var notes []RuleNote
	if err := json.Unmarshal([]byte(trimmed), &notes); err != nil {
		return nil
	}
	return notes
}

// RuleNotesJSON encodes notes for storage; "" when there are none.
func RuleNotesJSON(notes []RuleNote) string {
	if len(notes) == 0 {
		return ""
	}
	encoded, err := json.Marshal(notes)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// RuleNotesText renders notes as newline-joined display lines.
func RuleNotesText(notes []RuleNote) string {
	lines := make([]string, 0, len(notes))
	for _, n := range notes {
		if line := n.Line(); line != "" {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

// RuleNotesOf returns the notes whose category is one of cats, preserving
// order.
func RuleNotesOf(notes []RuleNote, cats ...string) []RuleNote {
	out := make([]RuleNote, 0, len(notes))
	for _, n := range notes {
		for _, c := range cats {
			if n.Category == c {
				out = append(out, n)
				break
			}
		}
	}
	return out
}

// RuleNotesEngaged reports whether any note in cats engaged its rule — i.e.
// its status is not 未命中. It drives the 请求改写 / 响应改写 markers, which
// deliberately say only which stage ran, not how it went.
func RuleNotesEngaged(notes []RuleNote, cats ...string) bool {
	for _, n := range notes {
		if n.Status == RuleStatusMiss {
			continue
		}
		for _, c := range cats {
			if n.Category == c {
				return true
			}
		}
	}
	return false
}

// Line renders the human-readable one-liner for a note.
func (n RuleNote) Line() string {
	switch n.Status {
	case RuleStatusHit:
		if n.Reason != "" {
			return n.prefix() + fmt.Sprintf("：命中并生效（%s）", n.Reason)
		}
		return n.prefix() + "：命中并生效"
	case RuleStatusNoEffect:
		if n.Reason != "" {
			return n.prefix() + fmt.Sprintf("：命中但未生效（%s）", n.Reason)
		}
		return n.prefix() + "：命中但未生效"
	case RuleStatusFailed:
		if n.Reason != "" {
			return n.prefix() + fmt.Sprintf("：命中但执行失败（%s）", n.Reason)
		}
		return n.prefix() + "：命中但执行失败"
	case RuleStatusMiss:
		return n.prefix() + "：未命中"
	}
	return ""
}

func (n RuleNote) prefix() string {
	if n.Rule == "" {
		return "[" + n.Category + "]"
	}
	return "[" + n.Category + "] " + n.Rule
}
