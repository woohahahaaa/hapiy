package service

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// LogCaptureStageRow is one stage's full data within a pair.
type LogCaptureStageRow struct {
	Headers   model.JSONMap `json:"headers,omitempty"`
	Body      model.JSONMap `json:"body,omitempty"`
	Status    int            `json:"status,omitempty"`
	Error     string         `json:"error,omitempty"`
	CreatedAt time.Time     `json:"created_at"`
}

// LogCaptureRequestNode is the request half of a pair (1 request, paired by ordinal).
type LogCaptureRequestNode struct {
	Before   *LogCaptureStageRow `json:"before,omitempty"`
	After    *LogCaptureStageRow `json:"after,omitempty"`
	Modified bool               `json:"modified"`
}

// LogCaptureResponseNode is one response within a pair (paired by ordinal after sort by CreatedAt).
type LogCaptureResponseNode struct {
	Before   *LogCaptureStageRow `json:"before,omitempty"`
	After    *LogCaptureStageRow `json:"after,omitempty"`
	Status   int                 `json:"status,omitempty"`
	Modified bool               `json:"modified"`
}

// LogCapturePairSummary is the list-endpoint shape (no bodies) for table render.
type LogCapturePairSummary struct {
	RequestID    string    `json:"request_id"`
	TypeLabel    string    `json:"type_label"`
	Prefix       string    `json:"prefix"`
	Source       string    `json:"source"`
	ProviderID   string    `json:"provider_id"`
	ProviderName string    `json:"provider_name"`
	ModelName    string    `json:"model_name"`
	TokenName    string    `json:"token_name"`
	CreatedAt    time.Time `json:"created_at"`
	HasRequest   bool      `json:"has_request"`
	HasResponse  bool      `json:"has_response"`
	ResponseCount int     `json:"response_count"`
	HasRewrite   bool      `json:"has_rewrite"`
	IsStream     bool      `json:"is_stream"`
	HasError     bool      `json:"has_error"`
	IsIncomplete bool      `json:"is_incomplete"`
}

// LogCaptureTiming is the per-request stage timing breakdown surfaced on
// the read endpoint. Values are nil when a stage did not apply.
type LogCaptureTiming struct {
	ConnectMs         *int `json:"connect_ms,omitempty"`
	FirstByteMs       *int `json:"first_byte_ms,omitempty"`
	RequestRewriteMs  *int `json:"request_rewrite_ms,omitempty"`
	ResponseRewriteMs *int `json:"response_rewrite_ms,omitempty"`
	StreamRewriteMs   *int `json:"stream_rewrite_ms,omitempty"`
	QueueWaitMs       *int `json:"queue_wait_ms,omitempty"`
}

// LogCapturePairFull is the read-endpoint shape with full bodies.
type LogCapturePairFull struct {
	RequestID  string                   `json:"request_id"`
	Prefix     string                   `json:"prefix"`
	Source     string                   `json:"source"`
	ProviderID string                   `json:"provider_id"`
	CreatedAt  time.Time                `json:"created_at"`
	Request    *LogCaptureRequestNode   `json:"request,omitempty"`
	Responses  []LogCaptureResponseNode `json:"responses"`
	Error      string                   `json:"error,omitempty"`
	Timing     *LogCaptureTiming        `json:"timing,omitempty"`
	IsStream   bool                     `json:"is_stream"`
}

// filterSystemFromTypes returns the input slice with any "system" entry
// removed. The pairs endpoint never surfaces system rows as pairs; they are
// not part of the request/response lifecycle. A new slice is returned (the
// input is not mutated); if no types remain, nil is returned so callers can
// treat "no type filter" uniformly.
func filterSystemFromTypes(types []string) []string {
	if len(types) == 0 {
		return nil
	}
	out := make([]string, 0, len(types))
	for _, t := range types {
		if t == "system" {
			continue
		}
		out = append(out, t)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// ListPairs returns a paginated list of pair summaries, newest-first by
// MIN(created_at) within each request_id group. The "包含" type filter
// keeps any pair that has at least one row of the given type; system rows
// are stripped from params.Types before any SQL is built.
//
// The query is two steps:
//  1. find the page's request_ids (GROUP BY request_id, ORDER BY
//     MIN(created_at) DESC, LIMIT/OFFSET) plus a matching total count of
//     DISTINCT request_id.
//  2. fetch every non-aggregating row for those request_ids and assemble
//     summaries Go-side, preserving the request_ids' order.
//
// Splitting the query this way (instead of one grouped query) keeps header
// and time filters applied to ANY row in the pair while still returning one
// row per pair: the WHERE in step 1 filters which request_ids qualify, and
// step 2 fetches ALL rows for a qualified request_id (including rows that
// individually would not match the filter — which is exactly the "pair
// contains a matching row" semantic the dashboard wants).
func (w *LogCaptureWriter) ListPairs(params LogListParams) ([]LogCapturePairSummary, int, error) {
	if w == nil {
		return nil, 0, nil
	}

	filteredTypes := filterSystemFromTypes(params.Types)

	// Step 1A: page of request_ids, newest-first by MIN(created_at).
	idQuery := w.db.Model(&model.LogCapture{}).
		Select("request_id").
		Group("request_id").
		Order("MIN(created_at) DESC")
	idQuery = applyPairFilters(idQuery, params, filteredTypes)

	var requestIDs []string
	if err := idQuery.
		Limit(params.Limit).
		Offset(params.Offset).
		Find(&requestIDs).Error; err != nil {
		return nil, 0, err
	}
	if len(requestIDs) == 0 {
		return []LogCapturePairSummary{}, 0, nil
	}

	// Step 1B: total count of DISTINCT request_id under the SAME filters. We
	// reuse applyPairFilters on a fresh Session so the Limit/Offset from the
	// chain above does not leak into the count (gorm chains are mutable, so
	// the count must be built from a clean Model, not from idQuery).
	countQuery := w.db.Session(&gorm.Session{}).
		Model(&model.LogCapture{}).
		Distinct("request_id")
	countQuery = applyPairFilters(countQuery, params, filteredTypes)
	var total int64
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Step 2: fetch ALL rows for the page's request_ids, ordered for stable
	// Go-side grouping. We order by request_id ASC, created_at ASC; the
	// request_id ASC here is just for stable iteration — we re-sort the
	// assembled summaries to match the requestIDs order (newest-first).
	var allRows []model.LogCapture
	if err := w.db.
		Where("request_id IN ?", requestIDs).
		Order("request_id, created_at ASC").
		Find(&allRows).Error; err != nil {
		return nil, 0, err
	}

	// Step 3: group by request_id and assemble. We must preserve the
	// requestIDs order (newest-first DESC) in the returned slice, so we
	// build a rid→summary map and then emit in the requestIDs order.
	groups := make(map[string][]model.LogCapture, len(requestIDs))
	for i := range allRows {
		rid := allRows[i].RequestID
		groups[rid] = append(groups[rid], allRows[i])
	}

	summaries := make([]LogCapturePairSummary, 0, len(requestIDs))
	for _, rid := range requestIDs {
		rows := groups[rid]
		if len(rows) == 0 {
			// Should not happen — the id query found this rid, so at least
			// one row exists. Defensive: skip rather than emit an empty entry.
			continue
		}
		summaries = append(summaries, assembleSummary(rid, rows))
	}
	return summaries, int(total), nil
}

// ReadPair returns the full pair (with bodies) for a given request_id, or
// gorm.ErrRecordNotFound if no rows exist for it.
func (w *LogCaptureWriter) ReadPair(requestId string) (*LogCapturePairFull, error) {
	if w == nil {
		return nil, gorm.ErrRecordNotFound
	}
	var rows []model.LogCapture
	if err := w.db.
		Where("request_id = ?", requestId).
		Order("created_at ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return assembleFull(requestId, rows), nil
}

// applyPairFilters adds the Prefix / time / "包含" type / header filters to
// a gorm query. It is shared by the id-page query and the total-count query
// in ListPairs so the two see exactly the same row set. The query is mutated
// in place and also returned for chaining. filteredTypes must already have
// "system" stripped.
func applyPairFilters(q *gorm.DB, params LogListParams, filteredTypes []string) *gorm.DB {
	if params.Prefix != "" {
		q = q.Where("prefix = ?", params.Prefix)
	}
	if !params.From.IsZero() {
		q = q.Where("created_at >= ?", params.From)
	}
	if !params.To.IsZero() {
		q = q.Where("created_at <= ?", params.To)
	}
	if len(filteredTypes) > 0 {
		// "包含" semantic: a pair qualifies if ANY of its rows has one of
		// these types. Implemented as request_id IN (a subquery over the
		// same table), so the GROUP BY in the caller inherits the narrowed
		// request_id set.
		q = q.Where("request_id IN (SELECT DISTINCT request_id FROM log_captures WHERE type IN ?)", filteredTypes)
	}
	if params.HeaderKey != "" && params.HeaderValue != "" {
		// Same "包含" idea for headers: a pair qualifies if ANY row carries
		// the given header key+value. The json_extract path mirrors the
		// existing ListFiles header filter (sqlite jsonb is queryable as
		// text via json_extract).
		q = q.Where("request_id IN (SELECT DISTINCT request_id FROM log_captures WHERE json_extract(headers, ?) = ?)",
			"$."+params.HeaderKey, params.HeaderValue)
	}
	if params.TokenName != "" {
		q = q.Where("token_name = ?", params.TokenName)
	}
	if params.ProviderName != "" {
		q = q.Where("provider_name = ?", params.ProviderName)
	}
	if params.ModelName != "" {
		q = q.Where("model_name = ?", params.ModelName)
	}
	if params.Source != "" {
		q = ApplySourceFilter(q, params.Source)
	}
	return q
}

// assembleSummary builds the list-endpoint (no-body) summary for one
// request_id's rows. rows may arrive in any order; we sort by created_at ASC
// first so "earliest row" and the stage split are deterministic. System rows
// are ignored here (they were filtered out of the SQL already, but defensively
// skip them too in case a future caller passes unfiltered rows).
func assembleSummary(rid string, rows []model.LogCapture) LogCapturePairSummary {
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].CreatedAt.Before(rows[j].CreatedAt)
	})

	// Earliest row provides Prefix/Source/ProviderID (any row in the group
	// should agree; we use the earliest for determinism).
	earliest := rows[0]
	s := LogCapturePairSummary{
		RequestID:    rid,
		Prefix:       earliest.Prefix,
		Source:       earliest.Source,
		ProviderID:   earliest.ProviderID,
		ProviderName: earliest.ProviderName,
		ModelName:    earliest.ModelName,
		TokenName:    earliest.TokenName,
		CreatedAt:    earliest.CreatedAt,
	}

	reqBefore, reqAfter, rspBefore, rspAfter := splitStages(rows)
	hasRequest := len(reqBefore) > 0 || len(reqAfter) > 0
	hasResponse := len(rspBefore) > 0 || len(rspAfter) > 0
	responseCount := max(len(rspBefore), len(rspAfter))

	s.HasRequest = hasRequest
	s.HasResponse = hasResponse
	s.ResponseCount = responseCount

	// HasRewrite = the request node shows a body change, or any response
	// node shows a body change. We reuse the same body-comparison the full
	// assembler uses, to keep the summary and the full render consistent.
	reqModified := false
	if hasRequest {
		reqModified = isModified(stageRow(first(reqBefore)), stageRow(first(reqAfter)))
	}
	rspModified := false
	for i := 0; i < responseCount; i++ {
		before := stageRow(at(rspBefore, i))
		after := stageRow(at(rspAfter, i))
		if isModified(before, after) {
			rspModified = true
			break
		}
	}
	s.HasRewrite = reqModified || rspModified
	s.IsStream = responseIsStream(rows)

	// HasError = any captured row carries an error string or any response
	// surfaced a 4xx/5xx status (after preferred, before fallback).
	s.HasError = pairHasError(rows, rspBefore, rspAfter)

	// IsIncomplete = a request was sent but no matching response was fully
	// captured (no response rows at all, or response_before without after).
	s.IsIncomplete = pairIsIncomplete(hasRequest, rspBefore, rspAfter)

	s.TypeLabel = typeLabel(hasRequest, hasResponse, responseCount, s.HasError, s.IsIncomplete)
	return s
}

// assembleFull builds the read-endpoint (with-bodies) shape for one
// request_id's rows. rows are sorted by created_at ASC first; system rows
// are skipped (they are not part of the request/response lifecycle and would
// only confuse the stage split).
func assembleFull(rid string, rows []model.LogCapture) *LogCapturePairFull {
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].CreatedAt.Before(rows[j].CreatedAt)
	})

	earliest := rows[0]
	full := &LogCapturePairFull{
		RequestID:  rid,
		Prefix:     earliest.Prefix,
		Source:     earliest.Source,
		ProviderID: earliest.ProviderID,
		CreatedAt:  earliest.CreatedAt,
		Responses:  []LogCaptureResponseNode{},
		IsStream:   responseIsStream(rows),
	}

	reqBefore, reqAfter, rspBefore, rspAfter := splitStages(rows)
	hasRequest := len(reqBefore) > 0 || len(reqAfter) > 0
	if hasRequest {
		full.Request = &LogCaptureRequestNode{
			Before:   stageRow(first(reqBefore)),
			After:    stageRow(first(reqAfter)),
			Modified: isModified(stageRow(first(reqBefore)), stageRow(first(reqAfter))),
		}
	}

	responseCount := max(len(rspBefore), len(rspAfter))
	for i := 0; i < responseCount; i++ {
		before := stageRow(at(rspBefore, i))
		after := stageRow(at(rspAfter, i))
		node := LogCaptureResponseNode{
			Before:   before,
			After:    after,
			Modified: isModified(before, after),
		}
		// Prefer the after-stage status; fall back to before's status only
		// when after is absent or after's status is 0 (unset). This matches
		// the "the response status is what the server eventually returned"
		// intuition: a rewrite that changes status is surfaced via after.
		if after != nil && after.Status != 0 {
			node.Status = after.Status
		} else if before != nil {
			node.Status = before.Status
		}
		full.Responses = append(full.Responses, node)
	}

	// Surface the first non-empty Error across the whole pair as the pair's
	// error (any row's error is interesting to the dashboard). We scan in
	// the already-sorted ASC order so the earliest error wins on ties.
	for i := range rows {
		if rows[i].Error != "" {
			full.Error = rows[i].Error
			break
		}
	}
	// Timing fields are written on every row of the request (logfile.go
	// WriteLog copies them unconditionally), so merge across the response
	// rows to surface the non-nil ones.
	full.Timing = mergeTiming(rows)
	return full
}

// mergeTiming combines the first non-nil value of each stage-timing field
// across a request's rows, returning nil when no row carries any timing.
func mergeTiming(rows []model.LogCapture) *LogCaptureTiming {
	var t LogCaptureTiming
	any := false
	for i := range rows {
		r := &rows[i]
		if r.ConnectMs != nil && t.ConnectMs == nil {
			t.ConnectMs = r.ConnectMs
			any = true
		}
		if r.FirstByteMs != nil && t.FirstByteMs == nil {
			t.FirstByteMs = r.FirstByteMs
			any = true
		}
		if r.RequestRewriteMs != nil && t.RequestRewriteMs == nil {
			t.RequestRewriteMs = r.RequestRewriteMs
			any = true
		}
		if r.ResponseRewriteMs != nil && t.ResponseRewriteMs == nil {
			t.ResponseRewriteMs = r.ResponseRewriteMs
			any = true
		}
		if r.StreamRewriteMs != nil && t.StreamRewriteMs == nil {
			t.StreamRewriteMs = r.StreamRewriteMs
			any = true
		}
		if r.QueueWaitMs != nil && t.QueueWaitMs == nil {
			t.QueueWaitMs = r.QueueWaitMs
			any = true
		}
	}
	if !any {
		return nil
	}
	return &t
}

// responseIsStream reports whether any response row of a pair carries an
// SSE Content-Type header. This is the pair-level "stream" marker the
// dashboard mirrors from the request-log page.
func responseIsStream(rows []model.LogCapture) bool {
	for i := range rows {
		r := &rows[i]
		if r.Type != "response" || r.Headers == nil {
			continue
		}
		for k, v := range r.Headers {
			if !strings.EqualFold(k, "Content-Type") {
				continue
			}
			s, ok := v.(string)
			if ok && strings.Contains(strings.ToLower(s), "text/event-stream") {
				return true
			}
		}
	}
	return false
}

// splitStages partitions rows by Stage, dropping system rows (Type=="system"
// OR Stage not in the four known values). Each returned slice preserves the
// input order (caller already sorted ASC). Response rows that are complete
// placeholders — no headers, no body, no status, no error — are dropped so a
// failed relay's empty capture rows never inflate the response count or render
// as blank nodes.
func splitStages(rows []model.LogCapture) (reqBefore, reqAfter, rspBefore, rspAfter []model.LogCapture) {
	for i := range rows {
		r := rows[i]
		if r.Type == "system" {
			continue
		}
		switch r.Stage {
		case "request_before":
			reqBefore = append(reqBefore, r)
		case "request_after":
			reqAfter = append(reqAfter, r)
		case "response_before":
			if emptyResponsePlaceholder(r) {
				continue
			}
			rspBefore = append(rspBefore, r)
		case "response_after":
			if emptyResponsePlaceholder(r) {
				continue
			}
			rspAfter = append(rspAfter, r)
		}
	}
	return
}

// emptyResponsePlaceholder reports whether a response row carries no captured
// data at all (no headers/body/status/error). Such rows are written by legacy
// relays on failure and only serve to inflate the pair's response count.
func emptyResponsePlaceholder(r model.LogCapture) bool {
	if r.Error != "" || r.ResponseStatus != 0 {
		return false
	}
	if len(r.Headers) > 0 || len(r.RequestBody) > 0 || len(r.ResponseBody) > 0 {
		return false
	}
	return true
}

// stageRow maps a single LogCapture row to the stage-row shape used by the
// assembler. Per logfile.go WriteLog (lines 53-82), the body is ALWAYS stored
// in RequestBody regardless of stage — even for response_before/response_after,
// the captured body lands in RequestBody. ResponseBody is never populated by
// WriteLog, so we read the body from RequestBody here. Status comes from
// ResponseStatus (also only meaningfully set for response_after rows in
// practice, but we surface whatever was stored).
func stageRow(r *model.LogCapture) *LogCaptureStageRow {
	if r == nil {
		return nil
	}
	return &LogCaptureStageRow{
		Headers:   r.Headers,
		Body:      r.RequestBody,
		Status:    r.ResponseStatus,
		Error:     r.Error,
		CreatedAt: r.CreatedAt,
	}
}

// isModified reports whether the before/after stages of a node differ in body
// or headers. A node is "modified" only if BOTH before and after exist;
// nil on either side → not modified (we only have one half). Headers count
// because header-only rewrites (e.g. adding x-opencode-session) leave the body
// byte-identical and would otherwise read as "not rewritten" in the log view.
func isModified(before, after *LogCaptureStageRow) bool {
	if before == nil || after == nil {
		return false
	}
	if !jsonMapEqual(before.Headers, after.Headers) {
		return true
	}
	return !jsonMapEqual(before.Body, after.Body)
}

// jsonMapEqual compares two captured maps by their marshalled bytes; nil and
// empty compare equal so a missing map never reads as a change. Marshalling is
// deterministic because encoding/json sorts map keys lexicographically.
func jsonMapEqual(a, b model.JSONMap) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	ab, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return bytes.Equal(ab, bb)
}

// typeLabel renders the Chinese label for a pair's shape:
//   - response-only               → "响应"
//   - request-only (0 responses)  → "请求"
//   - request + 1 response        → "请求+响应"
//   - request + N>1 responses     → "请求+响应×N"
// hasError / isIncomplete append suffixes (+报错, +不完整) so a glance at the
// list flags broken captures without opening the detail.
func typeLabel(hasRequest, hasResponse bool, responseCount int, hasError, isIncomplete bool) string {
	var base string
	switch {
	case !hasRequest && hasResponse:
		base = "响应"
	case hasRequest && responseCount == 0:
		base = "请求"
	case responseCount == 1:
		base = "请求+响应"
	default:
		base = "请求+响应×" + strconv.Itoa(responseCount)
	}
	if hasError {
		base += "+报错"
	}
	if isIncomplete {
		base += "+不完整"
	}
	return base
}

// pairHasError reports whether any captured row carries an error string or
// any response surfaced a 4xx/5xx status. Response status is read from the
// after row when present, otherwise the before row.
func pairHasError(rows []model.LogCapture, rspBefore, rspAfter []model.LogCapture) bool {
	for _, r := range rows {
		if r.Error != "" {
			return true
		}
	}
	for i := 0; i < len(rspAfter) || i < len(rspBefore); i++ {
		var status int
		if i < len(rspAfter) {
			status = rspAfter[i].ResponseStatus
		} else {
			status = rspBefore[i].ResponseStatus
		}
		if status >= 400 {
			return true
		}
	}
	return false
}

// pairIsIncomplete reports whether a request was sent but no full response
// was captured: no response rows at all, or response_before without a
// matching response_after (stream dropped mid-flight).
func pairIsIncomplete(hasRequest bool, rspBefore, rspAfter []model.LogCapture) bool {
	if !hasRequest {
		return false
	}
	if len(rspAfter) == 0 && len(rspBefore) == 0 {
		return true
	}
	for i := 0; i < len(rspBefore); i++ {
		if i >= len(rspAfter) {
			return true
		}
	}
	return false
}

// first returns the first element of a slice or nil. Used for the request
// node, which only ever uses the first before/after row (extras are ignored;
// in practice there is only one of each).
func first(s []model.LogCapture) *model.LogCapture {
	if len(s) == 0 {
		return nil
	}
	r := s[0]
	return &r
}

// at returns a pointer to the i-th element of a slice, or nil if out of range.
// Used for the response nodes' ordinal pairing.
func at(s []model.LogCapture, i int) *model.LogCapture {
	if i < 0 || i >= len(s) {
		return nil
	}
	r := s[i]
	return &r
}

// max returns the larger of two ints. Go 1.21+ has builtin max, but we
// support older toolchains for this module (no max usage elsewhere in the
// service package to inline against), so we define a local helper.
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
