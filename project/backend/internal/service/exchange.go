package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// Billing-related setting keys.
const (
	SettingBillingCurrency   = "billing_currency"
	SettingExchangeRate      = "exchange_rate_usd_cny"
	SettingExchangeAPIURL    = "exchange_rate_api_url"
	SettingExchangeAuto      = "exchange_rate_auto_refresh"
	SettingExchangeUpdatedAt = "exchange_rate_updated_at"
)

var defaultSettingsBilling = map[string]string{
	SettingBillingCurrency: "CNY",
	SettingExchangeRate:    "7.2",
	SettingExchangeAPIURL:  "https://open.er-api.com/v6/latest/USD",
	SettingExchangeAuto:    "true",
}

func init() {
	for k, v := range defaultSettingsBilling {
		if _, ok := defaultSettings[k]; !ok {
			defaultSettings[k] = v
		}
	}
}

// GetBillingCurrency returns the global billing currency ("USD" or "CNY").
func GetBillingCurrency(db *gorm.DB) string {
	value, err := GetSetting(db, SettingBillingCurrency)
	if err != nil {
		return "CNY"
	}
	if value == "USD" {
		return "USD"
	}
	return "CNY"
}

// GetExchangeRate returns the USD→CNY exchange rate used for billing.
func GetExchangeRate(db *gorm.DB) float64 {
	value, err := GetSetting(db, SettingExchangeRate)
	if err != nil {
		return 7.2
	}
	rate, err := strconv.ParseFloat(value, 64)
	if err != nil || rate <= 0 {
		return 7.2
	}
	return rate
}

// SaveExchangeRate persists a fresh USD→CNY rate and stamps the fetch time.
func SaveExchangeRate(db *gorm.DB, rate float64) error {
	if rate <= 0 {
		return errors.New("汇率必须大于 0")
	}
	upsert := func(key, value string) error {
		return db.Where("key = ?", key).
			Assign(model.Setting{Value: value}).
			FirstOrCreate(&model.Setting{Key: key}).Error
	}
	if err := upsert(SettingExchangeRate, strconv.FormatFloat(rate, 'f', 6, 64)); err != nil {
		return err
	}
	return upsert(SettingExchangeUpdatedAt, time.Now().Format(time.RFC3339))
}

// FetchRateFromAPI requests a public exchange-rate endpoint and extracts the
// USD→CNY rate. The response shape varies across providers, so the payload is
// scanned recursively for the first numeric "CNY" field (e.g. rates.CNY,
// conversion_rates.CNY or data.CNY).
func FetchRateFromAPI(apiURL string) (float64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := DefaultClient().Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return 0, fmt.Errorf("汇率接口返回状态码 %d", resp.StatusCode)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return 0, errors.New("汇率接口返回的不是有效 JSON")
	}
	rate, ok := findCNY(payload)
	if !ok {
		return 0, errors.New("汇率接口响应中未找到 CNY 汇率字段")
	}
	return rate, nil
}

func findCNY(node any) (float64, bool) {
	switch n := node.(type) {
	case map[string]any:
		if raw, ok := n["CNY"]; ok {
			if f, ok := toPositiveFloat(raw); ok {
				return f, true
			}
		}
		for _, child := range n {
			if f, ok := findCNY(child); ok {
				return f, true
			}
		}
	case []any:
		for _, child := range n {
			if f, ok := findCNY(child); ok {
				return f, true
			}
		}
	}
	return 0, false
}

func toPositiveFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, v > 0
	case string:
		f, err := strconv.ParseFloat(v, 64)
		return f, err == nil && f > 0
	}
	return 0, false
}

// RefreshExchangeRate fetches a fresh rate from the configured API and saves
// it. Returns the new rate.
func RefreshExchangeRate(db *gorm.DB) (float64, error) {
	apiURL, err := GetSetting(db, SettingExchangeAPIURL)
	if err != nil || apiURL == "" {
		return 0, errors.New("未配置汇率接口地址")
	}
	rate, err := FetchRateFromAPI(apiURL)
	if err != nil {
		return 0, err
	}
	if err := SaveExchangeRate(db, rate); err != nil {
		return 0, err
	}
	return rate, nil
}

// StartExchangeRateScheduler refreshes the rate automatically. When auto
// refresh is enabled, a failed refresh is retried 30 minutes later; successful
// refreshes schedule the next one for 24 hours out. When auto refresh is
// disabled the loop just re-checks the setting daily.
func StartExchangeRateScheduler(db *gorm.DB) {
	go func() {
		for {
			auto, _ := GetSetting(db, SettingExchangeAuto)
			if auto == "true" {
				if _, err := RefreshExchangeRate(db); err == nil {
					time.Sleep(24 * time.Hour)
					continue
				}
				time.Sleep(30 * time.Minute)
				continue
			}
			time.Sleep(24 * time.Hour)
		}
	}()
}
