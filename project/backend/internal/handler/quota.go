package handler

import (
	"encoding/json"
	"strconv"
	"strings"

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

func computeQuota(db *gorm.DB, request quotaRequest) float64 {
	if db == nil || request.usage == nil {
		return 0
	}
	price, found := findPriceConfig(db, request.modelName)
	if !found {
		return 0
	}
	usage := request.usage
	total := float64(usage.PromptTokens)/tokensPerMillion*price.InputPrice +
		float64(usage.CompletionTokens)/tokensPerMillion*price.OutputPrice +
		float64(usage.CacheWriteTokens)/tokensPerMillion*price.CacheWritePrice +
		float64(usage.CacheReadTokens)/tokensPerMillion*price.CacheReadPrice
	quota := total * parseModelRate(request.provider, request.modelName)
	if service.GetBillingCurrency(db) == "CNY" {
		quota *= service.GetExchangeRate(db)
	}
	return quota
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
