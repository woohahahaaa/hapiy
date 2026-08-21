package service

import (
	"errors"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// newPairsTestWriter opens an in-memory SQLite DB, auto-migrates the
// log_captures table, and returns a LogCaptureWriter bound to it. This
// mirrors the production schema (jsonb columns work on sqlite as text).
func newPairsTestWriter(t *testing.T) *LogCaptureWriter {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.LogCapture{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return &LogCaptureWriter{db: db}
}

// writeRow inserts a single LogCapture row for testing. The body is stored
// in RequestBody regardless of stage, matching the production WriteLog
// behavior (see logfile.go lines 53-82: every stage's body lands in
// RequestBody; ResponseBody/ResponseStatus are never set by WriteLog).
// headers is a string→string map because that is the real wire shape, but
// we store it as JSONMap (map[string]interface{}) like WriteLog does.
func writeRow(t *testing.T, w *LogCaptureWriter, rid, typ, stage string, body map[string]any, status int, headers map[string]string, ts time.Time) {
	t.Helper()
	row := model.LogCapture{
		RequestID:      rid,
		Type:           typ,
		Stage:          stage,
		CreatedAt:      ts,
		ResponseStatus: status,
	}
	if body != nil {
		row.RequestBody = model.JSONMap(body)
	}
	if headers != nil {
		m := make(model.JSONMap, len(headers))
		for k, v := range headers {
			m[k] = v
		}
		row.Headers = m
	}
	if err := w.db.Create(&row).Error; err != nil {
		t.Fatalf("create row: %v", err)
	}
}

// findSummaryByRequestID returns the summary with the given request_id, or
// fails the test if not found. Used across multiple test cases.
func findSummaryByRequestID(t *testing.T, summaries []LogCapturePairSummary, rid string) LogCapturePairSummary {
	t.Helper()
	for _, s := range summaries {
		if s.RequestID == rid {
			return s
		}
	}
	t.Fatalf("summary with request_id %q not found; have %d summaries", rid, len(summaries))
	return LogCapturePairSummary{}
}

// TestListPairs_request_plus_single_response: one request_id has request
// before/after (bodies differ) and response before/after (bodies differ).
// Expect: total==1, TypeLabel=="请求+响应", HasRequest && HasResponse &&
// ResponseCount==1, HasRewrite==true.
func TestListPairs_request_plus_single_response(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	writeRow(t, w, "r1", "request", "request_before", map[string]any{"a": 1}, 0, nil, now)
	writeRow(t, w, "r1", "request", "request_after", map[string]any{"a": 2}, 0, nil, now.Add(1*time.Second))
	writeRow(t, w, "r1", "response", "response_before", map[string]any{"b": 1}, 0, nil, now.Add(2*time.Second))
	writeRow(t, w, "r1", "response", "response_after", map[string]any{"b": 2}, 200, nil, now.Add(3*time.Second))

	summaries, total, err := w.ListPairs(LogListParams{Limit: 50, Offset: 0})
	if err != nil {
		t.Fatalf("ListPairs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(summaries) != 1 {
		t.Fatalf("len(summaries) = %d, want 1", len(summaries))
	}
	s := summaries[0]
	if s.RequestID != "r1" {
		t.Fatalf("RequestID = %q, want r1", s.RequestID)
	}
	if s.TypeLabel != "请求+响应" {
		t.Fatalf("TypeLabel = %q, want 请求+响应", s.TypeLabel)
	}
	if !s.HasRequest {
		t.Fatalf("HasRequest = false, want true")
	}
	if !s.HasResponse {
		t.Fatalf("HasResponse = false, want true")
	}
	if s.ResponseCount != 1 {
		t.Fatalf("ResponseCount = %d, want 1", s.ResponseCount)
	}
	if !s.HasRewrite {
		t.Fatalf("HasRewrite = false, want true (both request and response bodies differ)")
	}
}

// TestListPairs_request_plus_multi_response: one request_id with one
// request before/after pair and two response before/after pairs (4 response
// rows). Both response pairs' bodies differ. Expect ResponseCount==2,
// TypeLabel=="请求+响应×2".
func TestListPairs_request_plus_multi_response(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	writeRow(t, w, "r1", "request", "request_before", map[string]any{"a": 1}, 0, nil, now)
	writeRow(t, w, "r1", "request", "request_after", map[string]any{"a": 2}, 0, nil, now.Add(1*time.Second))

	// first response pair
	writeRow(t, w, "r1", "response", "response_before", map[string]any{"b": 1}, 0, nil, now.Add(2*time.Second))
	writeRow(t, w, "r1", "response", "response_after", map[string]any{"b": 2}, 200, nil, now.Add(3*time.Second))
	// second response pair (different body so Modified==true)
	writeRow(t, w, "r1", "response", "response_before", map[string]any{"c": 1}, 0, nil, now.Add(4*time.Second))
	writeRow(t, w, "r1", "response", "response_after", map[string]any{"c": 2}, 201, nil, now.Add(5*time.Second))

	summaries, total, err := w.ListPairs(LogListParams{Limit: 50, Offset: 0})
	if err != nil {
		t.Fatalf("ListPairs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(summaries) != 1 {
		t.Fatalf("len(summaries) = %d, want 1", len(summaries))
	}
	s := summaries[0]
	if s.ResponseCount != 2 {
		t.Fatalf("ResponseCount = %d, want 2", s.ResponseCount)
	}
	if s.TypeLabel != "请求+响应×2" {
		t.Fatalf("TypeLabel = %q, want 请求+响应×2", s.TypeLabel)
	}
	if !s.HasRewrite {
		t.Fatalf("HasRewrite = false, want true (both request and both responses differ)")
	}

	// Verify the full assembly has both responses' Modified set.
	full, err := w.ReadPair("r1")
	if err != nil {
		t.Fatalf("ReadPair: %v", err)
	}
	if len(full.Responses) != 2 {
		t.Fatalf("Responses len = %d, want 2", len(full.Responses))
	}
	if !full.Responses[0].Modified {
		t.Fatalf("Responses[0].Modified = false, want true")
	}
	if !full.Responses[1].Modified {
		t.Fatalf("Responses[1].Modified = false, want true")
	}
	if full.Responses[0].Status != 200 {
		t.Fatalf("Responses[0].Status = %d, want 200 (from after row)", full.Responses[0].Status)
	}
	if full.Responses[1].Status != 201 {
		t.Fatalf("Responses[1].Status = %d, want 201 (from after row)", full.Responses[1].Status)
	}
}

// TestListPairs_request_only: one request_id with only request_before (no
// request_after, no responses). Expect TypeLabel=="请求", !HasResponse,
// ResponseCount==0, !HasRewrite.
func TestListPairs_request_only(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	writeRow(t, w, "r1", "request", "request_before", map[string]any{"a": 1}, 0, nil, now)

	summaries, total, err := w.ListPairs(LogListParams{Limit: 50, Offset: 0})
	if err != nil {
		t.Fatalf("ListPairs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	s := summaries[0]
	if s.TypeLabel != "请求+不完整" {
		t.Fatalf("TypeLabel = %q, want 请求+不完整", s.TypeLabel)
	}
	if s.HasResponse {
		t.Fatalf("HasResponse = true, want false")
	}
	if s.ResponseCount != 0 {
		t.Fatalf("ResponseCount = %d, want 0", s.ResponseCount)
	}
	if s.HasRewrite {
		t.Fatalf("HasRewrite = true, want false (no after stage)")
	}
	if !s.HasRequest {
		t.Fatalf("HasRequest = false, want true")
	}
	if !s.IsIncomplete {
		t.Fatalf("IsIncomplete = false, want true")
	}
}

// TestListPairs_response_only: one request_id with only response_before (no
// request rows at all). Expect TypeLabel=="响应", !HasRequest.
func TestListPairs_response_only(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	writeRow(t, w, "r1", "response", "response_before", map[string]any{"b": 1}, 0, nil, now)

	summaries, total, err := w.ListPairs(LogListParams{Limit: 50, Offset: 0})
	if err != nil {
		t.Fatalf("ListPairs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	s := summaries[0]
	if s.TypeLabel != "响应" {
		t.Fatalf("TypeLabel = %q, want 响应", s.TypeLabel)
	}
	if s.HasRequest {
		t.Fatalf("HasRequest = true, want false")
	}
	if !s.HasResponse {
		t.Fatalf("HasResponse = false, want true")
	}
	if s.ResponseCount != 1 {
		t.Fatalf("ResponseCount = %d, want 1", s.ResponseCount)
	}
}

// TestListPairs_header_filter_hits_request_not_response: ridA has a request
// row with header x-trace=abc; ridB has only response rows without that
// header. Filter HeaderKey=x-trace, HeaderValue=abc. Expect only ridA
// returned, total==1.
func TestListPairs_header_filter_hits_request_not_response(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	writeRow(t, w, "ridA", "request", "request_before", map[string]any{"a": 1}, 0,
		map[string]string{"x-trace": "abc"}, now)
	writeRow(t, w, "ridA", "response", "response_before", map[string]any{"b": 1}, 200, nil, now.Add(1*time.Second))

	// ridB: response-only, no x-trace header anywhere
	writeRow(t, w, "ridB", "response", "response_before", map[string]any{"b": 2}, 200, nil, now.Add(2*time.Second))

	summaries, total, err := w.ListPairs(LogListParams{
		Limit:        50,
		HeaderKey:    "x-trace",
		HeaderValue:  "abc",
	})
	if err != nil {
		t.Fatalf("ListPairs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1 (only ridA matches header)", total)
	}
	if len(summaries) != 1 {
		t.Fatalf("len = %d, want 1", len(summaries))
	}
	if summaries[0].RequestID != "ridA" {
		t.Fatalf("RequestID = %q, want ridA", summaries[0].RequestID)
	}
}

// TestListPairs_type_filter_request_includes_pairs_with_responses: ridA has
// request+response; ridB has response only. Filter Types=["request"]. Expect
// only ridA returned (ridB excluded — it has no request row), total==1.
func TestListPairs_type_filter_request_includes_pairs_with_responses(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	// ridA: request + response
	writeRow(t, w, "ridA", "request", "request_before", map[string]any{"a": 1}, 0, nil, now)
	writeRow(t, w, "ridA", "response", "response_before", map[string]any{"b": 1}, 200, nil, now.Add(1*time.Second))

	// ridB: response only
	writeRow(t, w, "ridB", "response", "response_before", map[string]any{"b": 2}, 200, nil, now.Add(2*time.Second))

	summaries, total, err := w.ListPairs(LogListParams{
		Limit: 50,
		Types: []string{"request"},
	})
	if err != nil {
		t.Fatalf("ListPairs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1 (only ridA has a request row)", total)
	}
	if len(summaries) != 1 || summaries[0].RequestID != "ridA" {
		t.Fatalf("expected only ridA, got %+v", summaries)
	}
}

// TestListPairs_type_filter_response_excludes_request_only_pair: ridA is
// request-only; ridB is response-only. Filter Types=["response"]. Expect
// only ridB returned, ridA excluded, total==1.
func TestListPairs_type_filter_response_excludes_request_only_pair(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	// ridA: request only
	writeRow(t, w, "ridA", "request", "request_before", map[string]any{"a": 1}, 0, nil, now)

	// ridB: response only
	writeRow(t, w, "ridB", "response", "response_before", map[string]any{"b": 1}, 200, nil, now.Add(1*time.Second))

	summaries, total, err := w.ListPairs(LogListParams{
		Limit: 50,
		Types: []string{"response"},
	})
	if err != nil {
		t.Fatalf("ListPairs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1 (only ridB has a response row)", total)
	}
	if len(summaries) != 1 || summaries[0].RequestID != "ridB" {
		t.Fatalf("expected only ridB, got %+v", summaries)
	}
}

// TestListPairs_pagination: 5 request_ids with ascending created_at. We
// insert them in ASC order. ListPairs orders by MIN(created_at) DESC
// (newest-first). With Limit=2, Offset=2 we expect the 3rd and 4th newest
// (i.e. the 3rd and 2nd oldest → rids[2] and rids[1] in the ASC insertion
// order). Concretely: insertion ASC ids are r0..r4; DESC page order is
// r4,r3,r2,r1,r0; page[2..3] (offset=2 limit=2) is r2,r1. So we assert
// summaries[0].RequestID=="r2" and summaries[1].RequestID=="r1".
func TestListPairs_pagination(t *testing.T) {
	w := newPairsTestWriter(t)
	base := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	// Insert 5 rids in ASC time order: r0 oldest .. r4 newest.
	for i := 0; i < 5; i++ {
		writeRow(t, w, "r"+itoa(i), "request", "request_before",
			map[string]any{"i": i}, 0, nil, base.Add(time.Duration(i)*time.Second))
	}

	summaries, total, err := w.ListPairs(LogListParams{Limit: 2, Offset: 2})
	if err != nil {
		t.Fatalf("ListPairs: %v", err)
	}
	if total != 5 {
		t.Fatalf("total = %d, want 5", total)
	}
	if len(summaries) != 2 {
		t.Fatalf("len = %d, want 2", len(summaries))
	}
	// DESC order is r4,r3,r2,r1,r0; offset=2 → start at r2; limit=2 → [r2, r1].
	if summaries[0].RequestID != "r2" {
		t.Fatalf("summaries[0].RequestID = %q, want r2", summaries[0].RequestID)
	}
	if summaries[1].RequestID != "r1" {
		t.Fatalf("summaries[1].RequestID = %q, want r1", summaries[1].RequestID)
	}
}

// TestReadPair_returns_full_bodies_and_404_for_unknown: a known request_id
// returns a *LogCapturePairFull with Request.Modified and Responses[0].Modified
// set correctly. An unknown request_id returns gorm.ErrRecordNotFound
// (asserted via errors.Is).
func TestReadPair_returns_full_bodies_and_404_for_unknown(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	writeRow(t, w, "r1", "request", "request_before", map[string]any{"a": 1}, 0, nil, now)
	writeRow(t, w, "r1", "request", "request_after", map[string]any{"a": 2}, 0, nil, now.Add(1*time.Second))
	writeRow(t, w, "r1", "response", "response_before", map[string]any{"b": 1}, 0, nil, now.Add(2*time.Second))
	writeRow(t, w, "r1", "response", "response_after", map[string]any{"b": 2}, 200, nil, now.Add(3*time.Second))

	full, err := w.ReadPair("r1")
	if err != nil {
		t.Fatalf("ReadPair known: %v", err)
	}
	if full == nil {
		t.Fatalf("full = nil, want non-nil")
	}
	if full.RequestID != "r1" {
		t.Fatalf("RequestID = %q, want r1", full.RequestID)
	}
	if full.Request == nil {
		t.Fatalf("Request = nil, want non-nil")
	}
	if !full.Request.Modified {
		t.Fatalf("Request.Modified = false, want true (bodies a:1 vs a:2)")
	}
	if full.Request.Before == nil {
		t.Fatalf("Request.Before = nil, want non-nil")
	}
	if full.Request.After == nil {
		t.Fatalf("Request.After = nil, want non-nil")
	}
	if got, ok := full.Request.Before.Body["a"].(float64); !ok || got != 1 {
		t.Fatalf("Request.Before.Body[a] = %v (%T), want float64(1)", full.Request.Before.Body["a"], full.Request.Before.Body["a"])
	}
	if got, ok := full.Request.After.Body["a"].(float64); !ok || got != 2 {
		t.Fatalf("Request.After.Body[a] = %v (%T), want float64(2)", full.Request.After.Body["a"], full.Request.After.Body["a"])
	}
	if len(full.Responses) != 1 {
		t.Fatalf("Responses len = %d, want 1", len(full.Responses))
	}
	if !full.Responses[0].Modified {
		t.Fatalf("Responses[0].Modified = false, want true (bodies b:1 vs b:2)")
	}
	if full.Responses[0].Status != 200 {
		t.Fatalf("Responses[0].Status = %d, want 200 (from after row)", full.Responses[0].Status)
	}

	// Unknown request_id → gorm.ErrRecordNotFound.
	unknown, err := w.ReadPair("does-not-exist")
	if err == nil {
		t.Fatalf("ReadPair unknown: err = nil, want ErrRecordNotFound")
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("ReadPair unknown: err = %v, want gorm.ErrRecordNotFound", err)
	}
	if unknown != nil {
		t.Fatalf("ReadPair unknown: result = %v, want nil", unknown)
	}
}

// TestListPairs_system_type_filtered_out: ridA has a real pair (request +
// response) PLUS a system row sharing the same request_id. ListPairs with
// Types=["request","response"] must count only the pair (system does not
// inflate the count, and the pair still appears once). The summary's
// ProviderID/Source/Prefix come from the non-system rows.
// (system rows never carry prefix/source/provider in production; we set
// them on the request row and verify the summary picks them up.)
func TestListPairs_system_type_filtered_out(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	// Build a full row with Prefix/Source/ProviderID via a direct Create,
	// because writeRow helper doesn't set those fields.
	reqRow := model.LogCapture{
		RequestID:  "ridA",
		Type:       "request",
		Stage:      "request_before",
		Prefix:     "pfx",
		Source:     "src",
		ProviderID: "prov-1",
		RequestBody: model.JSONMap{"a": 1},
		CreatedAt:  now,
	}
	if err := w.db.Create(&reqRow).Error; err != nil {
		t.Fatalf("create reqRow: %v", err)
	}

	respRow := model.LogCapture{
		RequestID:    "ridA",
		Type:          "response",
		Stage:         "response_before",
		Prefix:        "pfx",
		Source:        "src",
		ProviderID:    "prov-1",
		RequestBody:   model.JSONMap{"b": 1},
		ResponseStatus: 200,
		CreatedAt:     now.Add(1 * time.Second),
	}
	if err := w.db.Create(&respRow).Error; err != nil {
		t.Fatalf("create respRow: %v", err)
	}

	// System row on the same request_id — must NOT inflate the count.
	sysRow := model.LogCapture{
		RequestID: "ridA",
		Type:       "system",
		Stage:      "request_before", // stage irrelevant for system; just a placeholder
		SystemLog:  model.JSONSlice{"sys-event"},
		CreatedAt:  now.Add(2 * time.Second),
	}
	if err := w.db.Create(&sysRow).Error; err != nil {
		t.Fatalf("create sysRow: %v", err)
	}

	summaries, total, err := w.ListPairs(LogListParams{
		Limit: 50,
		Types: []string{"request", "response"},
	})
	if err != nil {
		t.Fatalf("ListPairs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1 (system row must not inflate the pair count)", total)
	}
	if len(summaries) != 1 {
		t.Fatalf("len = %d, want 1", len(summaries))
	}
	s := summaries[0]
	if s.RequestID != "ridA" {
		t.Fatalf("RequestID = %q, want ridA", s.RequestID)
	}
	if s.Prefix != "pfx" {
		t.Fatalf("Prefix = %q, want pfx (from non-system rows)", s.Prefix)
	}
	if s.Source != "src" {
		t.Fatalf("Source = %q, want src", s.Source)
	}
	if s.ProviderID != "prov-1" {
		t.Fatalf("ProviderID = %q, want prov-1", s.ProviderID)
	}
}

// TestReadPair_assembles_multi_response_by_ordinal: one request_id with 2
// response_before and 2 response_after rows. The 1st pair's bodies differ,
// the 2nd pair's bodies also differ. Responses[0].Status and [1].Status must
// come from the after-stage rows (200 and 201 respectively). Both Modified
// flags true.
func TestReadPair_assembles_multi_response_by_ordinal(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	// Request before only (no after) so Request.Modified is false; we only
	// care about responses here.
	writeRow(t, w, "r1", "request", "request_before", map[string]any{"a": 1}, 0, nil, now)

	// Two response_before rows in ASC time order (the assembly sorts by
	// CreatedAt ASC, so the order here is the ordinal order).
	writeRow(t, w, "r1", "response", "response_before", map[string]any{"b": 1}, 0, nil, now.Add(1*time.Second))
	writeRow(t, w, "r1", "response", "response_before", map[string]any{"c": 1}, 0, nil, now.Add(3*time.Second))
	// Two response_after rows, ASC time order matching the before rows by ordinal.
	writeRow(t, w, "r1", "response", "response_after", map[string]any{"b": 2}, 200, nil, now.Add(2*time.Second))
	writeRow(t, w, "r1", "response", "response_after", map[string]any{"c": 2}, 201, nil, now.Add(4*time.Second))

	full, err := w.ReadPair("r1")
	if err != nil {
		t.Fatalf("ReadPair: %v", err)
	}
	if len(full.Responses) != 2 {
		t.Fatalf("Responses len = %d, want 2", len(full.Responses))
	}
	if !full.Responses[0].Modified {
		t.Fatalf("Responses[0].Modified = false, want true (b:1 vs b:2)")
	}
	if !full.Responses[1].Modified {
		t.Fatalf("Responses[1].Modified = false, want true (c:1 vs c:2)")
	}
	if full.Responses[0].Status != 200 {
		t.Fatalf("Responses[0].Status = %d, want 200 (from after[0])", full.Responses[0].Status)
	}
	if full.Responses[1].Status != 201 {
		t.Fatalf("Responses[1].Status = %d, want 201 (from after[1])", full.Responses[1].Status)
	}
	// Sanity: the before/after bodies matched by ordinal. JSON numbers
	// round-trip as float64, so we assert via .(float64).
	if got, ok := full.Responses[0].Before.Body["b"].(float64); !ok || got != 1 {
		t.Fatalf("Responses[0].Before.Body[b] = %v (%T), want float64(1)", full.Responses[0].Before.Body["b"], full.Responses[0].Before.Body["b"])
	}
	if got, ok := full.Responses[1].Before.Body["c"].(float64); !ok || got != 1 {
		t.Fatalf("Responses[1].Before.Body[c] = %v (%T), want float64(1)", full.Responses[1].Before.Body["c"], full.Responses[1].Before.Body["c"])
	}
	if got, ok := full.Responses[0].After.Body["b"].(float64); !ok || got != 2 {
		t.Fatalf("Responses[0].After.Body[b] = %v (%T), want float64(2)", full.Responses[0].After.Body["b"], full.Responses[0].After.Body["b"])
	}
	if got, ok := full.Responses[1].After.Body["c"].(float64); !ok || got != 2 {
		t.Fatalf("Responses[1].After.Body[c] = %v (%T), want float64(2)", full.Responses[1].After.Body["c"], full.Responses[1].After.Body["c"])
	}
}

// TestReadPair_exposes_merged_timing: rows carry stage timings across the
// response stages; assembleFull merges the first non-nil value of each field
// into LogCapturePairFull.Timing. Request rows have none, response rows split
// the fields across before/after — the merge picks the non-nil ones.
func TestReadPair_exposes_merged_timing(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)

	connect := 12
	queue := 3
	reqRewrite := 5
	respRewrite := 7

	// request_before row carries no timings (request stage has no resp).
	writeRow(t, w, "r1", "request", "request_before", map[string]any{"a": 1}, 0, nil, now)
	// response_before carries connect + queue + request rewrite.
	respBefore := model.LogCapture{
		RequestID:        "r1",
		Type:             "response",
		Stage:            "response_before",
		CreatedAt:        now.Add(1 * time.Second),
		ConnectMs:        &connect,
		QueueWaitMs:      &queue,
		RequestRewriteMs: &reqRewrite,
	}
	if err := w.db.Create(&respBefore).Error; err != nil {
		t.Fatalf("create respBefore: %v", err)
	}
	// response_after carries response rewrite on top.
	respAfter := model.LogCapture{
		RequestID:         "r1",
		Type:              "response",
		Stage:             "response_after",
		CreatedAt:         now.Add(2 * time.Second),
		ConnectMs:         &connect,
		QueueWaitMs:       &queue,
		RequestRewriteMs:  &reqRewrite,
		ResponseRewriteMs: &respRewrite,
	}
	if err := w.db.Create(&respAfter).Error; err != nil {
		t.Fatalf("create respAfter: %v", err)
	}

	full, err := w.ReadPair("r1")
	if err != nil {
		t.Fatalf("ReadPair: %v", err)
	}
	if full.Timing == nil {
		t.Fatalf("Timing = nil, want non-nil")
	}
	if full.Timing.ConnectMs == nil || *full.Timing.ConnectMs != connect {
		t.Fatalf("Timing.ConnectMs = %v, want %d", full.Timing.ConnectMs, connect)
	}
	if full.Timing.QueueWaitMs == nil || *full.Timing.QueueWaitMs != queue {
		t.Fatalf("Timing.QueueWaitMs = %v, want %d", full.Timing.QueueWaitMs, queue)
	}
	if full.Timing.RequestRewriteMs == nil || *full.Timing.RequestRewriteMs != reqRewrite {
		t.Fatalf("Timing.RequestRewriteMs = %v, want %d", full.Timing.RequestRewriteMs, reqRewrite)
	}
	if full.Timing.ResponseRewriteMs == nil || *full.Timing.ResponseRewriteMs != respRewrite {
		t.Fatalf("Timing.ResponseRewriteMs = %v, want %d", full.Timing.ResponseRewriteMs, respRewrite)
	}
	if full.Timing.FirstByteMs != nil || full.Timing.StreamRewriteMs != nil {
		t.Fatalf("Timing.FirstByteMs/StreamRewriteMs should be nil, got %v/%v",
			full.Timing.FirstByteMs, full.Timing.StreamRewriteMs)
	}
}

// TestReadPair_timing_nil_when_no_timings: a pair with no stage timings on
// any row exposes Timing == nil (not an empty object).
func TestReadPair_timing_nil_when_no_timings(t *testing.T) {
	w := newPairsTestWriter(t)
	now := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)
	writeRow(t, w, "r1", "request", "request_before", map[string]any{"a": 1}, 0, nil, now)
	writeRow(t, w, "r1", "response", "response_before", map[string]any{"b": 1}, 0, nil, now.Add(1*time.Second))

	full, err := w.ReadPair("r1")
	if err != nil {
		t.Fatalf("ReadPair: %v", err)
	}
	if full.Timing != nil {
		t.Fatalf("Timing = %+v, want nil (no timing fields on rows)", full.Timing)
	}
}

// itoa is a tiny local helper to avoid importing strconv just for one use.
func itoa(i int) string {
	return string(rune('0' + i))
}
