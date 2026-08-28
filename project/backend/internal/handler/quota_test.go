package handler

import (
	"math"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
)

func TestComputeQuota_whenPriceAndFractionRate(t *testing.T) {
	db := newPriceTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "USD"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	price := model.PriceConfig{
		Model:           "deepseek-v4-flash",
		InputPrice:      0.14,
		OutputPrice:     0.28,
		CacheWritePrice: 0.56,
		CacheReadPrice:  0.07,
	}
	if err := db.Create(&price).Error; err != nil {
		t.Fatalf("create price: %v", err)
	}
	provider := &model.Provider{Models: `[{"model":"deepseek-v4-flash","rate":"1/7"}]`}
	usage := &relay.UsageInfo{
		PromptTokens:     1000000,
		CompletionTokens: 1000000,
		CacheWriteTokens: 1000000,
		CacheReadTokens:  1000000,
	}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: price.Model, usage: usage})
	expected := (0.14 + 0.28 + 0.56 + 0.07) / 7
	if math.Abs(quota-expected) > 0.000000001 {
		t.Fatalf("quota: want %.12f, got %.12f", expected, quota)
	}
	if currency != "USD" {
		t.Fatalf("currency: want USD, got %v", currency)
	}
}

func TestComputeQuota_whenRequestUsesAlias(t *testing.T) {
	db := newPriceTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "USD"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	price := model.PriceConfig{Model: "canonical-model", InputPrice: 2, Aliases: `["alias-model"]`}
	if err := db.Create(&price).Error; err != nil {
		t.Fatalf("create price: %v", err)
	}
	provider := &model.Provider{Models: `[{"model":"alias-model","rate":"1/2"}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000}

	quota, _ := computeQuota(db, quotaRequest{provider: provider, modelName: "ALIAS-MODEL", usage: usage})
	if quota != 1 {
		t.Fatalf("quota: want 1, got %v", quota)
	}
}

func TestComputeQuota_whenCurrencyCNY(t *testing.T) {
	db := newPriceTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "CNY"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	if err := db.Create(&model.Setting{Key: "exchange_rate_usd_cny", Value: "7.2"}).Error; err != nil {
		t.Fatalf("set rate: %v", err)
	}
	price := model.PriceConfig{Model: "m", InputPrice: 1, OutputPrice: 1, CacheWritePrice: 1, CacheReadPrice: 1}
	if err := db.Create(&price).Error; err != nil {
		t.Fatalf("create price: %v", err)
	}
	usage := &relay.UsageInfo{PromptTokens: 1000000, CompletionTokens: 1000000, CacheWriteTokens: 1000000, CacheReadTokens: 1000000}

	quota, currency := computeQuota(db, quotaRequest{provider: nil, modelName: "m", usage: usage})
	expected := 4 * 7.2
	if math.Abs(quota-expected) > 0.000000001 {
		t.Fatalf("quota: want %.12f, got %.12f", expected, quota)
	}
	if currency != "CNY" {
		t.Fatalf("currency: want CNY, got %v", currency)
	}
}

func TestParseFraction_whenInvalidRate(t *testing.T) {
	if got := parseFraction("not-a-rate"); got != 1 {
		t.Fatalf("rate: want 1, got %v", got)
	}
}

func TestComputeQuota_explicitUsdPrices(t *testing.T) {
	db := newPriceTestDB(t)
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
	db := newPriceTestDB(t)
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
	db := newPriceTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "CNY"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	if err := db.Create(&model.PriceConfig{Model: "gpt-4o", InputPrice: 100, OutputPrice: 100}).Error; err != nil {
		t.Fatalf("create price: %v", err)
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

func TestComputeQuota_emptyPricesFallBackToGlobal(t *testing.T) {
	db := newPriceTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "USD"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	if err := db.Create(&model.PriceConfig{Model: "gpt-4o", InputPrice: 5, OutputPrice: 15}).Error; err != nil {
		t.Fatalf("create price: %v", err)
	}
	// A prices object with all-empty strings has no currency and must fall
	// back to the global path (rate multiplier applies).
	provider := &model.Provider{Models: `[{"model":"gpt-4o","rate":"2","prices":{"input":"","cacheWrite":"","cacheRead":"","output":""}}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000, CompletionTokens: 500000}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: "gpt-4o", usage: usage})

	want := (5 + 7.5) * 2
	if math.Abs(quota-want) > 0.000000001 {
		t.Fatalf("quota: want %v, got %v", want, quota)
	}
	if currency != "USD" {
		t.Fatalf("currency: want USD, got %v", currency)
	}
}

func TestComputeQuota_noMatchReturnsZeroAndEmptyCurrency(t *testing.T) {
	db := newPriceTestDB(t)
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

func TestComputeQuota_boundRateUsesBoundRowPrices(t *testing.T) {
	db := newPriceTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "USD"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	// The bound model-info row (by internal ID) is the rate source: its prices
	// × the multiplier, not the global row matched by name.
	bound := model.PriceConfig{
		Model:           "deepseek-v4-flash",
		ProviderID:      "DeepSeek",
		InputPrice:      10,
		OutputPrice:     20,
		CacheWritePrice: 30,
		CacheReadPrice:  40,
	}
	if err := db.Create(&bound).Error; err != nil {
		t.Fatalf("create bound price: %v", err)
	}
	// A second row with the same model name but a different supplier must NOT
	// be picked up by the binding.
	if err := db.Create(&model.PriceConfig{
		Model:      "deepseek-v4-flash",
		ProviderID: "OpenRouter",
		InputPrice: 1,
		OutputPrice: 1,
		CacheWritePrice: 1,
		CacheReadPrice: 1,
	}).Error; err != nil {
		t.Fatalf("create global price: %v", err)
	}
	provider := &model.Provider{Models: `[{"model":"deepseek-v4-flash","rate":"2","ratePriceConfigId":"` + bound.ID + `"}]`}
	usage := &relay.UsageInfo{
		PromptTokens:     1000000,
		CompletionTokens: 1000000,
		CacheWriteTokens: 1000000,
		CacheReadTokens:  1000000,
	}

	quota, currency := computeQuota(db, quotaRequest{provider: provider, modelName: bound.Model, usage: usage})
	expected := (10.0 + 20 + 30 + 40) * 2
	if math.Abs(quota-expected) > 0.000000001 {
		t.Fatalf("quota: want %.12f, got %.12f", expected, quota)
	}
	if currency != "USD" {
		t.Fatalf("currency: want USD, got %v", currency)
	}
}

func TestComputeQuota_deletedBindingResolvesToZero(t *testing.T) {
	db := newPriceTestDB(t)
	if err := db.Create(&model.Setting{Key: "billing_currency", Value: "USD"}).Error; err != nil {
		t.Fatalf("set currency: %v", err)
	}
	// A rate binding whose model-info row was deleted contributes zero prices
	// (bound row lookup misses), so quota is 0 even though a global row for the
	// same model name exists.
	if err := db.Create(&model.PriceConfig{Model: "deepseek-v4-flash", InputPrice: 5, OutputPrice: 5}).Error; err != nil {
		t.Fatalf("create price: %v", err)
	}
	provider := &model.Provider{Models: `[{"model":"deepseek-v4-flash","rate":"7","ratePriceConfigId":"missing-id"}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000}

	quota, _ := computeQuota(db, quotaRequest{provider: provider, modelName: "deepseek-v4-flash", usage: usage})
	if quota != 0 {
		t.Fatalf("quota: want 0, got %v", quota)
	}
}

func TestComputeQuota_ignoresRateForAnotherModelEntry(t *testing.T) {
	db := newPriceTestDB(t)
	// Two models; requesting the one without prices/config yields 0.
	provider := &model.Provider{Models: `[{"model":"a","rate":"2"},{"model":"b","prices":{"input":"$1","cacheWrite":"$1","cacheRead":"$1","output":"$1"}}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000}

	quota, _ := computeQuota(db, quotaRequest{provider: provider, modelName: "a", usage: usage})

	if quota != 0 {
		t.Fatalf("quota: want 0, got %v", quota)
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