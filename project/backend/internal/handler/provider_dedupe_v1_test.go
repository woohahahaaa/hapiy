package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newProviderDedupeTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Provider{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func createDedupeTestProvider(t *testing.T, db *gorm.DB, value *bool) *model.Provider {
	t.Helper()
	provider := &model.Provider{Name: "dedupe-test", Status: true, DedupeV1Suffix: value}
	if err := db.Create(provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	return provider
}

// TestProviderDedupeV1Suffix_defaultsToTrue covers both create paths:
// an omitted value gets the column default, while an explicit false is
// persisted as false instead of being swallowed by GORM's zero-value skip.
func TestProviderDedupeV1Suffix_defaultsToTrue(t *testing.T) {
	db := newProviderDedupeTestDB(t)
	omitted := createDedupeTestProvider(t, db, nil)
	explicitFalse := createDedupeTestProvider(t, db, boolPtr(false))

	var gotOmitted model.Provider
	if err := db.First(&gotOmitted, "id = ?", omitted.ID).Error; err != nil {
		t.Fatalf("reload omitted: %v", err)
	}
	if gotOmitted.DedupeV1Suffix == nil || !*gotOmitted.DedupeV1Suffix {
		t.Fatalf("omitted value: want true, got %+v", gotOmitted.DedupeV1Suffix)
	}

	var gotFalse model.Provider
	if err := db.First(&gotFalse, "id = ?", explicitFalse.ID).Error; err != nil {
		t.Fatalf("reload false: %v", err)
	}
	if gotFalse.DedupeV1Suffix == nil || *gotFalse.DedupeV1Suffix {
		t.Fatalf("explicit false: want false, got %+v", gotFalse.DedupeV1Suffix)
	}
}

func TestSetProviderDedupeV1Suffix_updatesOnlyThatField(t *testing.T) {
	db := newProviderDedupeTestDB(t)
	provider := createDedupeTestProvider(t, db, boolPtr(true))

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PUT("/providers/:id/dedupe-v1", SetProviderDedupeV1Suffix(db))

	body, _ := json.Marshal(map[string]bool{"dedupe_v1_suffix": false})
	req := httptest.NewRequest(http.MethodPut, "/providers/"+provider.ID+"/dedupe-v1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got model.Provider
	if err := db.First(&got, "id = ?", provider.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.DedupeV1Suffix == nil || *got.DedupeV1Suffix {
		t.Fatalf("dedupe_v1_suffix: want false, got %+v", got.DedupeV1Suffix)
	}
	if got.Name != provider.Name {
		t.Fatalf("name changed: want %q, got %q", provider.Name, got.Name)
	}
}

func TestSetProviderDedupeV1Suffix_unknownProvider404(t *testing.T) {
	db := newProviderDedupeTestDB(t)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PUT("/providers/:id/dedupe-v1", SetProviderDedupeV1Suffix(db))

	req := httptest.NewRequest(http.MethodPut, "/providers/missing/dedupe-v1", bytes.NewBufferString(`{"dedupe_v1_suffix":false}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func boolPtr(v bool) *bool { return &v }
