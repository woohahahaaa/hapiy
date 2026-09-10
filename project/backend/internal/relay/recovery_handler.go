package relay

import (
	"encoding/json"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// RecoveryRequestHandlerKey is the settings-table key holding the
// operations that rewrite the recorded request body before it is stored
// as a pending disabled record and replayed during auto-recovery.
const RecoveryRequestHandlerKey = "recovery_request_handler"

// RecoveryOp rewrites one JSON field of the recorded request body before
// the recovery probe replays it. The intent is to swap out a very long
// user payload (e.g. messages.N.content) for a short token so the replay
// is cheap. Action is "delete" or "replace".
type RecoveryOp struct {
	Path   string `json:"path"`   // gjson/sjson path, e.g. "messages.0.content"
	Action string `json:"action"` // "delete" | "replace"
	Value  string `json:"value"`  // used when action == "replace"
}

// RecoveryRequestHandler is the persisted config: a list of independent
// field operations plus an optional cooldown for body-less records.
// There is no on/off switch — configuring operations enables the rewrite.
// Each op is best-effort: a missing field is skipped without failing the
// others. TimeoutHours > 0 delays auto-replay of records that lost their
// request body (e.g. backfilled rows): they only replay once the cooldown
// has elapsed since the disable.
type RecoveryRequestHandler struct {
	Ops          []RecoveryOp `json:"ops"`
	TimeoutHours int          `json:"timeout_hours"`
}

// recoveryHandler loads the persisted recovery request-handler config.
// A missing, empty or malformed setting means "no rewrite". A handler with
// only a timeout (no ops) is still returned so body-less replay cooldown
// works independently of any field rewrite.
func (e *Engine) recoveryHandler() *RecoveryRequestHandler {
	if e.db == nil {
		return nil
	}
	var setting model.Setting
	if err := e.db.Where("key = ?", RecoveryRequestHandlerKey).First(&setting).Error; err != nil {
		return nil
	}
	var h RecoveryRequestHandler
	if err := json.Unmarshal([]byte(setting.Value), &h); err != nil {
		return nil
	}
	valid := h.Ops[:0]
	for _, op := range h.Ops {
		if op.Path != "" && (op.Action == "delete" || op.Action == "replace") {
			valid = append(valid, op)
		}
	}
	h.Ops = valid
	if len(h.Ops) == 0 && h.TimeoutHours <= 0 {
		return nil
	}
	return &h
}

// applyRecoveryHandler rewrites the given request-body JSON by running
// every configured op in order. Ops whose path does not exist in the
// body are skipped; a failing op never aborts the remaining ones.
// Returns the rewritten bytes and true when at least one op applied.
func applyRecoveryHandler(body []byte, h *RecoveryRequestHandler) ([]byte, bool) {
	if h == nil || len(body) == 0 {
		return body, false
	}
	out := body
	applied := false
	for _, op := range h.Ops {
		if !gjson.GetBytes(out, op.Path).Exists() {
			continue
		}
		var next []byte
		var err error
		switch op.Action {
		case "delete":
			next, err = sjson.DeleteBytes(out, op.Path)
		case "replace":
			// When the replacement value is itself valid JSON (array/object/
			// number/bool), write it as a structured value; a bare string is
			// written as a JSON string.
			var val interface{} = op.Value
			var parsed interface{}
			if json.Unmarshal([]byte(op.Value), &parsed) == nil {
				val = parsed
			}
			next, err = sjson.SetBytes(out, op.Path, val)
		default:
			continue
		}
		if err != nil || !json.Valid(next) {
			continue
		}
		out = next
		applied = true
	}
	return out, applied
}
