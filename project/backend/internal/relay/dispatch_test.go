package relay

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/hapiy/hapiy/internal/topology"
	"gorm.io/gorm"
)

// seedFlatTopology writes a flat topology to the config row the engine reads.
func seedFlatTopology(t *testing.T, db *gorm.DB, flat string) {
	t.Helper()
	if err := db.AutoMigrate(&model.TopologyConfig{}); err != nil {
		t.Fatalf("automigrate topology config: %v", err)
	}
	if err := db.Where("id = ?", topology.ConfigRowID).Delete(&model.TopologyConfig{}).Error; err != nil {
		t.Fatalf("clear topology config: %v", err)
	}
	config := model.TopologyConfig{ID: topology.ConfigRowID, Version: 1, Flat: flat}
	if err := db.Create(&config).Error; err != nil {
		t.Fatalf("create topology config: %v", err)
	}
}

func TestDispatch_rejectsWhenTopologyHasNoEligibleProvider(t *testing.T) {
	engine, db := newTestEngine(t)
	provider := model.Provider{
		ID:              "p1",
		Name:            "p1",
		BaseURLs:        `["https://a.example.com"]`,
		Keys:            `["k"]`,
		Models:          `[{"model":"m1"}]`,
		Status:          true,
		WorkflowEnabled: true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	// Topology present, but the provider node's mini-switch is OFF. Dispatch
	// must reject instead of degrading to SelectProvider (which ignores the
	// topology switch and would happily serve p1).
	seedFlatTopology(t, db, `{"nodes":[
		{"id":"e1","kind":"requestEntry","name":"entry","enabled":true,"weight":1},
		{"id":"ps1","kind":"slot","slot_type":"provider","enabled":true},
		{"id":"pv1","kind":"provider","name":"p1","enabled":false}
	],"wires":[{"source":"e1","target":"ps1"},{"source":"ps1","target":"pv1"}]}`)

	if _, err := engine.Dispatch("m1", "/v1/chat/completions", nil); err == nil {
		t.Fatal("expected dispatch to reject: topology exists but provider node is disabled")
	}
}

func TestDispatch_flatTopologySelectsEnabledProvider(t *testing.T) {
	engine, db := newTestEngine(t)
	provider := model.Provider{
		ID:              "p1",
		Name:            "p1",
		BaseURLs:        `["https://a.example.com"]`,
		Keys:            `["k"]`,
		Models:          `[{"model":"m1"}]`,
		Status:          true,
		WorkflowEnabled: true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	seedFlatTopology(t, db, `{"nodes":[
		{"id":"e1","kind":"requestEntry","name":"entry","enabled":true,"weight":1},
		{"id":"ps1","kind":"slot","slot_type":"provider","enabled":true},
		{"id":"pv1","kind":"provider","name":"p1","enabled":true}
	],"wires":[{"source":"e1","target":"ps1"},{"source":"ps1","target":"pv1"}]}`)

	result, err := engine.Dispatch("m1", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if result.Provider == nil || result.Provider.Name != "p1" {
		t.Fatalf("expected provider p1, got %+v", result.Provider)
	}
}

func TestRecordDispatchRejection_writesLogCaptureRow(t *testing.T) {
	engine, db := newTestEngine(t)
	if err := db.AutoMigrate(&model.TopologyConfig{}, &model.LogCapture{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	service.InitLogCaptureWriter(db)
	seedFlatTopology(t, db, `{"nodes":[
		{"id":"e1","kind":"requestEntry","name":"entry","enabled":true,"weight":1},
		{"id":"ps1","kind":"slot","slot_type":"provider","enabled":true},
		{"id":"pv1","kind":"provider","name":"p1","enabled":true},
		{"id":"lo1","kind":"slot","slot_type":"logOutput","enabled":true,"entries":[
			{"id":"lo-e1","slotType":"logOutput","index":1,"enabled":true,
			 "config":{"prefix":"/rejects","record_request":true,"record_response":true,"record_system":true}}
		]}
	],"wires":[{"source":"e1","target":"ps1"},{"source":"ps1","target":"pv1"},{"source":"pv1","target":"lo1"}]}`)

	engine.RecordDispatchRejection(
		&RelayRequest{
			RequestID: "req-r",
			Headers:   map[string]string{"x-test": "1"},
			Body:      map[string]interface{}{"model": "m1"},
			Path:      "/v1/chat/completions",
		},
		errors.New("no provider available for model m1"),
	)

	var rows []model.LogCapture
	if err := db.Where("request_id = ?", "req-r").Find(&rows).Error; err != nil {
		t.Fatalf("query captures: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("want 1 capture row, got %d", len(rows))
	}
	row := rows[0]
	if row.Stage != "request_before" {
		t.Fatalf("stage: want request_before, got %q", row.Stage)
	}
	if row.Prefix != "/rejects" {
		t.Fatalf("prefix: want /rejects, got %q", row.Prefix)
	}
	if !strings.Contains(row.Error, "no provider available") {
		t.Fatalf("error: want rejection message, got %q", row.Error)
	}
	if row.RequestBody == nil {
		t.Fatal("expected request body captured (record_request=true)")
	}

	// No logOutput node in the topology: the same rejection must not write
	// any capture row. Same db, so the global writer is bound to this one.
	if err := db.Where("id = ?", topology.ConfigRowID).Delete(&model.TopologyConfig{}).Error; err != nil {
		t.Fatalf("clear topology config: %v", err)
	}
	seedFlatTopology(t, db, `{"nodes":[
		{"id":"e1","kind":"requestEntry","name":"entry","enabled":true,"weight":1},
		{"id":"ps1","kind":"slot","slot_type":"provider","enabled":true},
		{"id":"pv1","kind":"provider","name":"p1","enabled":false}
	],"wires":[{"source":"e1","target":"ps1"},{"source":"ps1","target":"pv1"}]}`)
	engine.RecordDispatchRejection(
		&RelayRequest{RequestID: "req-n", Path: "/v1/chat/completions"},
		errors.New("no provider available for model m1"),
	)
	var count int64
	if err := db.Model(&model.LogCapture{}).Where("request_id = ?", "req-n").Count(&count).Error; err != nil {
		t.Fatalf("count captures: %v", err)
	}
	if count != 0 {
		t.Fatalf("want 0 capture rows without logOutput node, got %d", count)
	}
}

func TestRelayRequestFailure_skipsLogCaptureWhenNodeDisabled(t *testing.T) {
	engine, db := newTestEngine(t)
	if err := db.AutoMigrate(&model.LogCapture{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	service.InitLogCaptureWriter(db)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	}))
	defer server.Close()
	provider := model.Provider{
		ID: "p", Name: "p", BaseURLs: `["` + server.URL + `"]`, Keys: `["k"]`,
		Models: `[]`, Status: true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	disabled := false
	assignment := model.TopologySlotAssignment{
		ID: "lo-a", ProviderID: provider.ID, SlotType: "logOutput", Order: 1,
		Enabled: true, NodeEnabled: &disabled,
		Config: `{"prefix":"test","record_request":true,"record_response":true,"record_system":true}`,
	}
	if err := db.Create(&assignment).Error; err != nil {
		t.Fatalf("create assignment: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	plan, err := engine.GetPlan(provider.ID)
	if err != nil {
		t.Fatalf("get plan: %v", err)
	}
	if len(plan.LogOutputs) != 1 || plan.LogOutputs[0].NodeEnabled {
		t.Fatalf("expected one logOutput assignment with node switch off, got %+v", plan.LogOutputs)
	}

	if _, err := engine.RelayRequest(context.Background(), plan, &RelayRequest{RequestID: "req-fail", Path: "/v1/chat/completions"}); err == nil {
		t.Fatal("expected upstream 500 error")
	}

	var count int64
	if err := db.Model(&model.LogCapture{}).Where("request_id = ?", "req-fail").Count(&count).Error; err != nil {
		t.Fatalf("count captures: %v", err)
	}
	if count != 0 {
		t.Fatalf("want 0 capture rows when logOutput node switch is off, got %d", count)
	}
}