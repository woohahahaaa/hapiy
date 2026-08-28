package handler

import (
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

const tokensPerMillion = 1000000.0

type quotaRequest struct {
	provider  *model.Provider
	modelName string
	usage     *relay.UsageInfo
}

// computeQuota returns the quota amount and the billing currency it was
// computed in ("USD" or "CNY"). A model with explicit per-model prices
// (provider.Models entry "prices") is billed with those prices in the model's
// own currency, which overrides the global billing currency; otherwise the
// global PriceConfig × model rate × [exchange when global currency is CNY]
// path applies. An empty currency (with zero quota) means no pricing matched.
func computeQuota(db *gorm.DB, request quotaRequest) (float64, string) {
	if db == nil || request.usage == nil {
		return 0, ""
	}
	usage := request.usage
	if prices, ok := resolveModelPrices(request.provider, request.modelName); ok {
		if currency := pricesCurrency(prices); currency != "" {
			quota := float64(usage.PromptTokens)/tokensPerMillion*parsePriceValue(prices.Input) +
				float64(usage.CompletionTokens)/tokensPerMillion*parsePriceValue(prices.Output) +
				float64(usage.CacheWriteTokens)/tokensPerMillion*parsePriceValue(prices.CacheWrite) +
				float64(usage.CacheReadTokens)/tokensPerMillion*parsePriceValue(prices.CacheRead)
			return quota, currency
		}
	}
	price, found := findPriceConfig(db, request.modelName)
	if !found {
		return 0, ""
	}
	total := float64(usage.PromptTokens)/tokensPerMillion*price.InputPrice +
		float64(usage.CompletionTokens)/tokensPerMillion*price.OutputPrice +
		float64(usage.CacheWriteTokens)/tokensPerMillion*price.CacheWritePrice +
		float64(usage.CacheReadTokens)/tokensPerMillion*price.CacheReadPrice
	if bound, rate, ok := modelRateBinding(db, request.provider, request.modelName); ok {
		// Rate mode is bound to a specific model-info row: price = that row's
		// prices × the configured multiplier. A deleted binding resolves to 0.
		total = float64(usage.PromptTokens)/tokensPerMillion*bound.InputPrice +
			float64(usage.CompletionTokens)/tokensPerMillion*bound.OutputPrice +
			float64(usage.CacheWriteTokens)/tokensPerMillion*bound.CacheWritePrice +
			float64(usage.CacheReadTokens)/tokensPerMillion*bound.CacheReadPrice
		quota := total * rate
		currency := service.GetBillingCurrency(db)
		if currency == "CNY" {
			quota *= service.GetExchangeRate(db)
		}
		return quota, currency
	}
	quota := total * parseModelRate(request.provider, request.modelName)
	currency := service.GetBillingCurrency(db)
	if currency == "CNY" {
		quota *= service.GetExchangeRate(db)
	}
	return quota, currency
}

// modelRateBinding returns the model-info row a rate-mode provider model is
// bound to (by PriceConfig ID) together with its multiplier. ok is false when
// the model has no binding (rate mode without an upstream supplier selected,
// resolved by the legacy global PriceConfig × rate path instead) or when the
// provider is explicit-pricing. A binding whose row was deleted still resolves:
// the row is missing so it contributes zero prices (ok stays true, zero rows).
func modelRateBinding(db *gorm.DB, provider *model.Provider, modelName string) (*model.PriceConfig, float64, bool) {
	if db == nil || provider == nil || strings.TrimSpace(provider.Models) == "" {
		return nil, 0, false
	}
	var entries []struct {
		Model         string `json:"model"`
		Rate          string `json:"rate"`
		PriceConfigID string `json:"priceConfigId"`
	}
	if err := json.Unmarshal([]byte(provider.Models), &entries); err != nil {
		return nil, 0, false
	}
	for _, entry := range entries {
		if !strings.EqualFold(strings.TrimSpace(entry.Model), strings.TrimSpace(modelName)) {
			continue
		}
		if entry.PriceConfigID == "" {
			return nil, 0, false
		}
		var bound model.PriceConfig
		err := db.First(&bound, "id = ?", entry.PriceConfigID).Error
		if err != nil {
			bound = model.PriceConfig{}
		}
		return &bound, parseFraction(entry.Rate), true
	}
	return nil, 0, false
}

// modelPrices are explicit per-model prices, stored as strings with a "$" or
// "¥" symbol prefix (e.g. "$1.50"), in units of per 1M tokens. The presence of
// a non-null prices object switches the model to fixed-price billing: the
// amounts replace the global PriceConfig and the symbol selects the billing
// currency, overriding the system-wide billing currency.
type modelPrices struct {
	Input      string `json:"input"`
	CacheWrite string `json:"cacheWrite"`
	CacheRead  string `json:"cacheRead"`
	Output     string `json:"output"`
}

// resolveModelPrices returns the explicit prices for modelName on the provider.
func resolveModelPrices(provider *model.Provider, modelName string) (*modelPrices, bool) {
	if provider == nil || strings.TrimSpace(provider.Models) == "" {
		return nil, false
	}
	var entries []struct {
		Model  string       `json:"model"`
		Prices *modelPrices `json:"prices"`
	}
	if err := json.Unmarshal([]byte(provider.Models), &entries); err != nil {
		return nil, false
	}
	for _, entry := range entries {
		if strings.EqualFold(strings.TrimSpace(entry.Model), strings.TrimSpace(modelName)) {
			if entry.Prices != nil {
				return entry.Prices, true
			}
			return nil, false
		}
	}
	return nil, false
}

// pricesCurrency derives the model's billing currency from the symbol prefix
// of its prices: "$" maps to USD, "¥"/"￥" to CNY. The first non-empty price
// wins; all-empty prices yield "" so callers fall back to the global currency.
func pricesCurrency(prices *modelPrices) string {
	if prices == nil {
		return ""
	}
	for _, value := range []string{prices.Input, prices.CacheWrite, prices.CacheRead, prices.Output} {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		r, _ := utf8.DecodeRuneInString(value)
		switch r {
		case '$':
			return "USD"
		case '¥', '￥':
			return "CNY"
		}
	}
	return ""
}

// parsePriceValue strips the currency symbol and whitespace from a price
// string and parses the numeric amount. Invalid or negative input yields 0.
func parsePriceValue(value string) float64 {
	value = strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			return -1
		}
		return r
	}, value)
	value = strings.TrimLeft(value, "$¥￥")
	if value == "" {
		return 0
	}
	amount, err := strconv.ParseFloat(value, 64)
	if err != nil || amount < 0 {
		return 0
	}
	return amount
}

func findPriceConfig(db *gorm.DB, modelName string) (model.PriceConfig, bool) {
	var prices []model.PriceConfig
	if err := db.Find(&prices).Error; err != nil {
		return model.PriceConfig{}, false
	}
	for _, price := range prices {
		if matchesPriceConfig(price, modelName) {
			return price, true
		}
	}
	return model.PriceConfig{}, false
}

func matchesPriceConfig(price model.PriceConfig, modelName string) bool {
	if strings.EqualFold(strings.TrimSpace(price.Model), strings.TrimSpace(modelName)) {
		return true
	}
	var aliases []string
	if err := json.Unmarshal([]byte(price.Aliases), &aliases); err != nil {
		return false
	}
	for _, alias := range aliases {
		if strings.EqualFold(strings.TrimSpace(alias), strings.TrimSpace(modelName)) {
			return true
		}
	}
	return false
}

func parseModelRate(provider *model.Provider, modelName string) float64 {
	if provider == nil || strings.TrimSpace(provider.Models) == "" {
		return 1
	}
	var entries []struct {
		Model string `json:"model"`
		Rate  string `json:"rate"`
	}
	if err := json.Unmarshal([]byte(provider.Models), &entries); err != nil {
		return 1
	}
	for _, entry := range entries {
		if strings.EqualFold(strings.TrimSpace(entry.Model), strings.TrimSpace(modelName)) {
			return parseFraction(entry.Rate)
		}
	}
	return 1
}

// parseFraction preserves the supplier UI's supported rate forms: decimals
// and inline fractions such as "1/2". Invalid input keeps the neutral rate.
func parseFraction(value string) float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 1
	}
	parts := strings.Split(value, "/")
	if len(parts) == 2 {
		numerator, numeratorErr := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
		denominator, denominatorErr := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
		if numeratorErr == nil && denominatorErr == nil && denominator != 0 {
			return numerator / denominator
		}
	}
	if rate, err := strconv.ParseFloat(value, 64); err == nil {
		return rate
	}
	return 1
}
