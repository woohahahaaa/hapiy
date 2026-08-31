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
// 模型价格参考供应商 path (stored models.dev snapshot × the model's
// multiplier, converted through the global billing currency) applies. Any
// provider model not in either mode — legacy "rate mode" rows, providers
// missing a price reference, rows where the snapshot could not be captured —
// resolves to 0 so the 模型信息 table does not silently take over billing.
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
	if ref, rate, ok := referenceModePrices(request.provider, request.modelName); ok {
		total := float64(usage.PromptTokens)/tokensPerMillion*ref.Input +
			float64(usage.CompletionTokens)/tokensPerMillion*ref.Output +
			float64(usage.CacheWriteTokens)/tokensPerMillion*ref.CacheWrite +
			float64(usage.CacheReadTokens)/tokensPerMillion*ref.CacheRead
		quota := total * rate
		currency := service.GetBillingCurrency(db)
		if currency == "CNY" {
			quota *= service.GetExchangeRate(db)
		}
		return quota, currency
	}
	return 0, ""
}

// modelRefPrices are the read-only models.dev price snapshot captured when a
// provider model uses 模型价格参考供应商 mode. Amounts are USD per 1M
// tokens; billing applies the model's multiplier and the global
// currency/exchange rules.
type modelRefPrices struct {
	Input      float64 `json:"input"`
	CacheWrite float64 `json:"cacheWrite"`
	CacheRead  float64 `json:"cacheRead"`
	Output     float64 `json:"output"`
}

// referenceModePrices returns the models.dev snapshot and multiplier for a
// provider model configured in 模型价格参考供应商 mode (referenceProvider
// plus a captured referencePrices snapshot). ok is false when the mode is
// not set or the snapshot is missing, so callers fall through to the legacy
// global PriceConfig path during the transition.
func referenceModePrices(provider *model.Provider, modelName string) (*modelRefPrices, float64, bool) {
	if provider == nil || strings.TrimSpace(provider.Models) == "" {
		return nil, 0, false
	}
	var entries []struct {
		Model             string          `json:"model"`
		ReferenceProvider string          `json:"referenceProvider"`
		ReferencePrices   *modelRefPrices `json:"referencePrices"`
		Rate              string          `json:"rate"`
	}
	if err := json.Unmarshal([]byte(provider.Models), &entries); err != nil {
		return nil, 0, false
	}
	for _, entry := range entries {
		if !strings.EqualFold(strings.TrimSpace(entry.Model), strings.TrimSpace(modelName)) {
			continue
		}
		if entry.ReferenceProvider == "" || entry.ReferencePrices == nil {
			return nil, 0, false
		}
		return entry.ReferencePrices, parseFraction(entry.Rate), true
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
