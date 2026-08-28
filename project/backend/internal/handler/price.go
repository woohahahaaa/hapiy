package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// validatePriceConfig validates the persisted form of a PriceConfig and
// returns a Chinese-message error when the input is invalid.
func validatePriceConfig(price *model.PriceConfig) error {
	if price.Model == "" {
		return errors.New("model 不能为空")
	}
	if price.ContextLength < 0 {
		return errors.New("context_length 不能为负数")
	}
	if price.MaxToken < 0 {
		return errors.New("max_token 不能为负数")
	}
	if price.Rate == "" {
		return nil
	}
	var rate []model.PriceRule
	if err := json.Unmarshal([]byte(price.Rate), &rate); err != nil {
		return errors.New("rate 不是有效的 JSON 数组")
	}
	for _, rule := range rate {
		if rule.Multiplier < 0 {
			return errors.New("倍率规则 multiplier 不能为负数")
		}
		if _, err := regexp.Compile(rule.Pattern); err != nil {
			return errors.New("倍率规则 pattern 不是有效的正则表达式")
		}
	}
	return nil
}

// validatePriceNames enforces the naming uniqueness rules after the
// (model, provider) composite-key redesign:
//   - the same normalized (model, provider) pair may be stored only once
//   - an alias must not collide with any other row's model or alias (matching
//     by alias stays unambiguous across providers)
func validatePriceNames(db *gorm.DB, price *model.PriceConfig) error {
	normModel := normalizePriceName(price.Model)
	normProvider := normalizePriceName(price.ProviderID)

	var prices []model.PriceConfig
	if err := db.Find(&prices).Error; err != nil {
		return fmt.Errorf("查询历史模型: %w", err)
	}

	// Composite (model, provider) uniqueness, case-insensitive, excluding self.
	for _, existing := range prices {
		if existing.ID == price.ID {
			continue
		}
		if normalizePriceName(existing.Model) == normModel &&
			normalizePriceName(existing.ProviderID) == normProvider &&
			normModel != "" {
			return fmt.Errorf("模型名称 %q 与上游供应商 %q 的组合已存在", price.Model, price.ProviderID)
		}
	}

	// The model name and aliases must not trip the matching resolvers of other
	// rows: an alias always counts globally (matching by alias must stay
	// unambiguous), while a model name only conflicts with an existing alias.
	type namedRow struct {
		model   string
		aliases []string
	}
	rows := make([]namedRow, 0, len(prices))
	for _, existing := range prices {
		if existing.ID == price.ID {
			continue
		}
		rows = append(rows, namedRow{model: normalizePriceName(existing.Model), aliases: priceAliasesOf(&existing)})
	}
	for _, row := range rows {
		for _, alias := range row.aliases {
			if alias == normModel && normModel != "" {
				return fmt.Errorf("名称 %q 已被历史模型或别名占用", price.Model)
			}
		}
	}

	// Alias uniqueness against every other row's model and aliases.
	aliases, err := priceAliases(price)
	if err != nil {
		return err
	}
	seen := make(map[string]struct{}, len(aliases))
	for _, alias := range aliases {
		if _, exists := seen[alias]; exists || alias == normModel {
			return fmt.Errorf("名称 %q 重复", alias)
		}
		seen[alias] = struct{}{}
	}
	for _, row := range rows {
		occupied := make(map[string]struct{}, len(row.aliases)+1)
		occupied[row.model] = struct{}{}
		for _, alias := range row.aliases {
			occupied[alias] = struct{}{}
		}
		for _, alias := range aliases {
			if _, exists := occupied[alias]; exists {
				return fmt.Errorf("名称 %q 已被历史模型或别名占用", alias)
			}
		}
	}
	return nil
}

func priceAliases(price *model.PriceConfig) ([]string, error) {
	if strings.TrimSpace(price.Aliases) == "" {
		return nil, nil
	}
	var aliases []string
	if err := json.Unmarshal([]byte(price.Aliases), &aliases); err != nil {
		return nil, errors.New("aliases 不是有效的 JSON 数组")
	}
	result := make([]string, 0, len(aliases))
	for _, alias := range aliases {
		if normalized := normalizePriceName(alias); normalized != "" {
			result = append(result, normalized)
		}
	}
	return result, nil
}

func priceAliasesOf(price *model.PriceConfig) []string {
	aliases, err := priceAliases(price)
	if err != nil {
		return nil
	}
	return aliases
}

func normalizePriceName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func ListPrices(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var prices []model.PriceConfig
		limit := parseInt(c.Query("limit"), 50)
		offset := parseInt(c.Query("offset"), 0)
		var total int64
		if err := db.Model(&model.PriceConfig{}).Count(&total).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.Order("model asc").Limit(limit).Offset(offset).Find(&prices).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": prices, "total": total})
	}
}

func CreatePrice(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var price model.PriceConfig
		if err := c.ShouldBindJSON(&price); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := validatePriceConfig(&price); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := validatePriceNames(db, &price); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := db.Create(&price).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": price})
	}
}

func UpdatePrice(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var price model.PriceConfig
		if err := db.First(&price, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "price not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var patch model.PriceConfig
		if err := c.ShouldBindJSON(&patch); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if patch.Model != "" {
			price.Model = patch.Model
		}
		price.InputPrice = patch.InputPrice
		price.OutputPrice = patch.OutputPrice
		price.CacheWritePrice = patch.CacheWritePrice
		price.CacheReadPrice = patch.CacheReadPrice
	price.ContextLength = patch.ContextLength
	price.MaxToken = patch.MaxToken
	price.SupportedTypes = patch.SupportedTypes
	price.Aliases = patch.Aliases
	price.Endpoints = patch.Endpoints
	price.ThinkingLevels = patch.ThinkingLevels
	price.Rate = patch.Rate
	price.ProviderID = patch.ProviderID
		// Validate the merged record: a partial update without a model keeps the
		// existing non-empty model, while the new fields are taken verbatim.
		if err := validatePriceConfig(&price); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := validatePriceNames(db, &price); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := db.Save(&price).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": price})
	}
}

func DeletePrice(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := db.Delete(&model.PriceConfig{}, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "price deleted"})
	}
}

type priceReference struct {
	ProviderID   string `json:"provider_id"`
	ProviderName string `json:"provider_name"`
	Model        string `json:"model"`
}

// PriceReferences lists the provider models whose rate-mode entries are bound
// to the given PriceConfig row (by its internal ID). It powers the delete
// confirmation: a non-empty list warns that deleting the row breaks those
// providers' price calcutions.
func PriceReferences(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var providers []model.Provider
		if err := db.Find(&providers).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		refs := make([]priceReference, 0)
		for _, provider := range providers {
			if strings.TrimSpace(provider.Models) == "" {
				continue
			}
			var entries []struct {
				Model         string `json:"model"`
				PriceConfigID string `json:"priceConfigId"`
			}
			if err := json.Unmarshal([]byte(provider.Models), &entries); err != nil {
				continue
			}
			for _, entry := range entries {
				if entry.PriceConfigID == id {
					refs = append(refs, priceReference{
						ProviderID:   provider.ID,
						ProviderName: provider.Name,
						Model:        entry.Model,
					})
				}
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": refs})
	}
}
