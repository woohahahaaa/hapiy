package service

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newExchangeTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Setting{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func TestFetchRateFromAPI_ratesShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"result":"success","rates":{"USD":1,"CNY":7.2345}}`))
	}))
	defer server.Close()

	rate, err := FetchRateFromAPI(server.URL)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if math.Abs(rate-7.2345) > 0.0000001 {
		t.Fatalf("rate: want 7.2345, got %v", rate)
	}
}

func TestFetchRateFromAPI_conversionRatesShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"conversion_rates":{"CNY":7.19}}`))
	}))
	defer server.Close()

	rate, err := FetchRateFromAPI(server.URL)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if math.Abs(rate-7.19) > 0.0000001 {
		t.Fatalf("rate: want 7.19, got %v", rate)
	}
}

func TestFetchRateFromAPI_dataShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":{"CNY":"7.31"}}`))
	}))
	defer server.Close()

	rate, err := FetchRateFromAPI(server.URL)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if math.Abs(rate-7.31) > 0.0000001 {
		t.Fatalf("rate: want 7.31, got %v", rate)
	}
}

func TestFetchRateFromAPI_missingCNY(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"rates":{"USD":1}}`))
	}))
	defer server.Close()

	if _, err := FetchRateFromAPI(server.URL); err == nil {
		t.Fatal("expected error when CNY missing")
	}
}

func TestBillingCurrencyDefaultsToCNY(t *testing.T) {
	db := newExchangeTestDB(t)
	if got := GetBillingCurrency(db); got != "CNY" {
		t.Fatalf("currency: want CNY, got %v", got)
	}
	if err := db.Create(&model.Setting{Key: SettingBillingCurrency, Value: "USD"}).Error; err != nil {
		t.Fatalf("set: %v", err)
	}
	if got := GetBillingCurrency(db); got != "USD" {
		t.Fatalf("currency: want USD, got %v", got)
	}
}

func TestExchangeRateDefaultAndSave(t *testing.T) {
	db := newExchangeTestDB(t)
	if got := GetExchangeRate(db); math.Abs(got-7.2) > 0.0000001 {
		t.Fatalf("rate: want default 7.2, got %v", got)
	}
	if err := SaveExchangeRate(db, 7.88); err != nil {
		t.Fatalf("save: %v", err)
	}
	if got := GetExchangeRate(db); math.Abs(got-7.88) > 0.0000001 {
		t.Fatalf("rate: want 7.88, got %v", got)
	}
}
