package handler

import (
	"math"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// newQuotaTestDB returns an in-memory DB migrated with the current schema
// so quota tests can store settings (billing currency / exchange rate).
func newQuotaTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestParseFraction_whenInvalidRate(t *testing.T) {
	if got := parseFraction("not-a-rate"); got != 1 {
		t.Fatalf("rate: want 1, got %v", got)
	}
}

func TestComputeQuota_explicitUsdPrices(t *testing.T) {
	db := newQuotaTestDB(t)
	provider := &model.Provider{Models: `[{"model":"gpt-4o","rate":"1","prices":{"input":"$5","cacheWrite":"$1","cacheRead":"$0.5","output":"$15"}}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000, CompletionTokens: 500000, CacheWriteTokens: 200000, CacheReadTokens: 300000}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: "gpt-4o", usage: usage})

	// 1M × $5 + 0.5M × $15 + 0.2M × $1 + 0.3M × $0.5, all per 1M tokens
	want := 5 + 7.5 + 0.2 + 0.15
	if math.Abs(quota-want) > 0.000000001 {
		t.Fatalf("quota: want %v, got %v", want, quota)
	}
	if currency != "USD" {
		t.Fatalf("currency: want USD, got %v", currency)
	}
}

func TestComputeQuota_explicitCnyPrices(t *testing.T) {
	db := newQuotaTestDB(t)
	provider := &model.Provider{Models: `[{"model":"deepseek","prices":{"input":"¥2","cacheWrite":"¥0.5","cacheRead":"¥0.25","output":"¥6"}}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000, CompletionTokens: 500000, CacheWriteTokens: 200000, CacheReadTokens: 300000}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: "deepseek", usage: usage})

	want := 2 + 3 + 0.1 + 0.075
	if math.Abs(quota-want) > 0.000000001 {
		t.Fatalf("quota: want %v, got %v", want, quota)
	}
	if currency != "CNY" {
		t.Fatalf("currency: want CNY, got %v", currency)
	}
}

func TestComputeQuota_explicitPricesOverrideGlobalCurrency(t *testing.T) {
	db := newQuotaTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "CNY"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	// Explicit USD prices must win over the CNY global setting and skip the
	// exchange-rate multiplication entirely.
	provider := &model.Provider{Models: `[{"model":"gpt-4o","prices":{"input":"$5","cacheWrite":"$0","cacheRead":"$0","output":"$15"}}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000, CompletionTokens: 500000}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: "gpt-4o", usage: usage})

	want := 5 + 7.5
	if math.Abs(quota-want) > 0.000000001 {
		t.Fatalf("quota: want %v, got %v", want, quota)
	}
	if currency != "USD" {
		t.Fatalf("currency: want USD, got %v", currency)
	}
}

func TestComputeQuota_emptyPricesFallBackToZero(t *testing.T) {
	db := newQuotaTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "USD"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	// A prices object with all-empty strings has no currency and must fall
	// through to 0 (the 模型信息 table no longer drives billing).
	provider := &model.Provider{Models: `[{"model":"gpt-4o","rate":"2","prices":{"input":"","cacheWrite":"","cacheRead":"","output":""}}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000, CompletionTokens: 500000}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: "gpt-4o", usage: usage})

	if quota != 0 {
		t.Fatalf("quota: want 0, got %v", quota)
	}
	if currency != "" {
		t.Fatalf("currency: want empty, got %v", currency)
	}
}

func TestComputeQuota_noMatchReturnsZeroAndEmptyCurrency(t *testing.T) {
	db := newQuotaTestDB(t)
	provider := &model.Provider{Models: `[{"model":"gpt-4o"}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: "unknown-model", usage: usage})

	if quota != 0 {
		t.Fatalf("quota: want 0, got %v", quota)
	}
	if currency != "" {
		t.Fatalf("currency: want empty, got %v", currency)
	}
}

func TestComputeQuota_ignoresRateForAnotherModelEntry(t *testing.T) {
	db := newQuotaTestDB(t)
	// Two models; requesting the one without prices/config yields 0.
	provider := &model.Provider{Models: `[{"model":"a","rate":"2"},{"model":"b","prices":{"input":"$1","cacheWrite":"$1","cacheRead":"$1","output":"$1"}}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000}

	quota, _ := computeQuota(db, quotaRequest{provider: provider, modelName: "a", usage: usage})

	if quota != 0 {
		t.Fatalf("quota: want 0, got %v", quota)
	}
}

func TestComputeQuota_referenceModeSnapshot(t *testing.T) {
	db := newQuotaTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "USD"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	usage := &relay.UsageInfo{PromptTokens: 1000000, CompletionTokens: 1000000, CacheWriteTokens: 1000000, CacheReadTokens: 1000000}
	// 模型价格参考供应商: snapshot USD prices with an editable multiplier.
	provider := &model.Provider{Models: `[{"model":"deepseek-chat","referenceProvider":"DeepInfra","referencePrices":{"input":0.27,"cacheWrite":0.27,"cacheRead":0.27,"output":1.1},"rate":"2"}]`}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: "DEEPSEEK-CHAT", usage: usage})

	expected := (0.27 + 1.1 + 0.27 + 0.27) * 2
	if math.Abs(quota-expected) > 0.000000001 {
		t.Fatalf("quota: want %.12f, got %.12f", expected, quota)
	}
	if currency != "USD" {
		t.Fatalf("currency: want USD, got %v", currency)
	}
}

func TestComputeQuota_referenceModeAppliesGlobalCNY(t *testing.T) {
	db := newQuotaTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "CNY"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	if err := db.Create(&model.Setting{Key: "exchange_rate_usd_cny", Value: "7.2"}).Error; err != nil {
		t.Fatalf("set rate: %v", err)
	}
	usage := &relay.UsageInfo{PromptTokens: 1000000}
	provider := &model.Provider{Models: `[{"model":"m","referenceProvider":"OpenRouter","referencePrices":{"input":1,"cacheWrite":1,"cacheRead":1,"output":1},"rate":"1/2"}]`}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: "m", usage: usage})

	expected := 1 * 0.5 * 7.2
	if math.Abs(quota-expected) > 0.000000001 {
		t.Fatalf("quota: want %.12f, got %.12f", expected, quota)
	}
	if currency != "CNY" {
		t.Fatalf("currency: want CNY, got %v", currency)
	}
}

func TestComputeQuota_referenceModeWithoutSnapshotResolvesToZero(t *testing.T) {
	db := newQuotaTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "USD"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	// referenceProvider set but no snapshot → the 模型信息 table no longer
	// fills the gap, so the row bills as 0 until the user refreshes the
	// snapshot.
	provider := &model.Provider{Models: `[{"model":"gpt-4o","referenceProvider":"OpenRouter","rate":"2"}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000, CompletionTokens: 500000}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: "gpt-4o", usage: usage})

	if quota != 0 {
		t.Fatalf("quota: want 0 (no snapshot), got %v", quota)
	}
	if currency != "" {
		t.Fatalf("currency: want empty, got %v", currency)
	}
}

func TestResolveModelPrices_caseInsensitiveMatch(t *testing.T) {
	provider := &model.Provider{Models: `[{"model":"GPT-4O","prices":{"input":"$1","cacheWrite":"$2","cacheRead":"$3","output":"$4"}}]`}

	prices, ok := resolveModelPrices(provider, "gpt-4o")
	if !ok {
		t.Fatal("resolve: want ok, got false")
	}
	if prices.Input != "$1" || prices.Output != "$4" || prices.CacheWrite != "$2" || prices.CacheRead != "$3" {
		t.Fatalf("prices: got %+v", prices)
	}
}

func TestResolveModelPrices_whenMissingPrices(t *testing.T) {
	provider := &model.Provider{Models: `[{"model":"gpt-4o","rate":"1"}]`}

	if _, ok := resolveModelPrices(provider, "gpt-4o"); ok {
		t.Fatal("resolve: want false when prices absent")
	}
}

func TestPricesCurrency_firstNonEmptyWins(t *testing.T) {
	if got := pricesCurrency(&modelPrices{Input: "¥2.5"}); got != "CNY" {
		t.Fatalf("currency: want CNY, got %v", got)
	}
	if got := pricesCurrency(&modelPrices{Input: "", CacheWrite: "", CacheRead: "$0.5"}); got != "USD" {
		t.Fatalf("currency: want USD, got %v", got)
	}
	if got := pricesCurrency(&modelPrices{}); got != "" {
		t.Fatalf("currency: want empty, got %v", got)
	}
	if got := pricesCurrency(nil); got != "" {
		t.Fatalf("currency: want empty for nil, got %v", got)
	}
}

func TestParsePriceValue_stripsSymbolAndWhitespace(t *testing.T) {
	cases := []struct {
		in   string
		want float64
	}{
		{"$1.5", 1.5},
		{"¥ 2", 2},
		{"￥3.25", 3.25},
		{"$", 0},
		{"", 0},
		{"abc", 0},
		{"-$5", 0},
		{"10$", 0},
		{"$ 1 0", 10},
		{"¥ 2 .5", 2.5},
	}
	for _, tc := range cases {
		if got := parsePriceValue(tc.in); math.Abs(got-tc.want) > 0.000000001 {
			t.Fatalf("parsePriceValue(%q): want %v, got %v", tc.in, tc.want, got)
		}
	}
}