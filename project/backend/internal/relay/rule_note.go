package relay

import (
	"fmt"
	"strings"
)

// Rule-note categories: which relay stage produced the outcome. They are
// rendered into the log capture detail (`rule_notes`) and the usage record's
// 详情 (event_detail).
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

// RuleNote records what one configured rule did on a single request. The
// relay collects one note per rule pass; the log capture rows and the usage
// record carry the rendered text so a silent no-op — e.g. a set-from-ref
// whose source header the client never sent — is visible instead of looking
// like the rule never ran.
type RuleNote struct {
	Category string // 请求改写 | 响应改写 | 故障转移
	RuleID   string // rule id (used to replace/aggregate notes, not rendered)
	Rule     string // display name; empty renders as a category-only line
	Status   string // RuleStatus* constants
	Reason   string // why it did not take effect (no_effect / failed)
}

// RuleNoteText renders notes as the newline-joined text stored in the log
// capture rows and the usage log's event_detail. Empty when there are none.
func RuleNoteText(notes []RuleNote) string {
	lines := make([]string, 0, len(notes))
	for _, n := range notes {
		if line := n.line(); line != "" {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

// RuleNotesOf returns the notes whose category is one of cats, preserving
// order. Used to split the per-request notes into the capture stage that
// should carry them.
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

// line renders the human-readable one-liner for a note.
func (n RuleNote) line() string {
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
