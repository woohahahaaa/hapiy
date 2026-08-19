package handler

import (
	"math"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
)

func TestComputeQuota_whenPriceAndFractionRate(t *testing.T) {
	db := newPriceTestDB(t)
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

	quota := computeQuota(db, quotaRequest{provider: provider, modelName: price.Model, usage: usage})
	expected := (0.14 + 0.28 + 0.56 + 0.07) / 7
	if math.Abs(quota-expected) > 0.000000001 {
		t.Fatalf("quota: want %.12f, got %.12f", expected, quota)
	}
}

func TestComputeQuota_whenRequestUsesAlias(t *testing.T) {
	db := newPriceTestDB(t)
	price := model.PriceConfig{Model: "canonical-model", InputPrice: 2, Aliases: `["alias-model"]`}
	if err := db.Create(&price).Error; err != nil {
		t.Fatalf("create price: %v", err)
	}
	provider := &model.Provider{Models: `[{"model":"alias-model","rate":"1/2"}]`}
	usage := &relay.UsageInfo{PromptTokens: 1000000}

	quota := computeQuota(db, quotaRequest{provider: provider, modelName: "ALIAS-MODEL", usage: usage})
	if quota != 1 {
		t.Fatalf("quota: want 1, got %v", quota)
	}
}

func TestParseFraction_whenInvalidRate(t *testing.T) {
	if got := parseFraction("not-a-rate"); got != 1 {
		t.Fatalf("rate: want 1, got %v", got)
	}
}
