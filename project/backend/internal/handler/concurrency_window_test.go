package handler

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newConcurrencyWindowTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.ConcurrencyWindowCounter{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func TestListConcurrencyWindows_returns_occupancy_rows(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newConcurrencyWindowTestDB(t)
	rows := []model.ConcurrencyWindowCounter{
		{NodeID: "concurrency-1", MaxCount: 10, WindowCount: 3},
		{NodeID: "concurrency-2", MaxCount: 5, WindowCount: 5},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("seed rows: %v", err)
	}

	rec := httptest.NewRecorder()
	router := gin.New()
	router.GET("/concurrency/windows", ListConcurrencyWindows(db))
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/concurrency/windows", nil))

	if rec.Code != 200 {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data []struct {
			NodeID      string `json:"node_id"`
			WindowCount int    `json:"window_count"`
			MaxCount    int    `json:"max_count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Data) != 2 {
		t.Fatalf("want 2 windows, got %d", len(body.Data))
	}
	want := map[string]struct{ window, max int }{
		"concurrency-1": {window: 3, max: 10},
		"concurrency-2": {window: 5, max: 5},
	}
	for _, w := range body.Data {
		got, ok := want[w.NodeID]
		if !ok {
			t.Fatalf("unexpected node_id %q", w.NodeID)
		}
		if w.WindowCount != got.window || w.MaxCount != got.max {
			t.Errorf("node %s: want (%d,%d), got (%d,%d)", w.NodeID, got.window, got.max, w.WindowCount, w.MaxCount)
		}
	}
}

func TestListConcurrencyWindows_empty_on_new_database(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newConcurrencyWindowTestDB(t)

	rec := httptest.NewRecorder()
	router := gin.New()
	router.GET("/concurrency/windows", ListConcurrencyWindows(db))
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/concurrency/windows", nil))

	if rec.Code != 200 {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data []any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Data == nil || len(body.Data) != 0 {
		t.Fatalf("want empty data array, got %#v", body.Data)
	}
}