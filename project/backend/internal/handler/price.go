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

func validatePriceNames(db *gorm.DB, price *model.PriceConfig) error {
	candidates, err := priceNames(price)
	if err != nil {
		return err
	}
	seen := make(map[string]struct{}, len(candidates))
	for _, name := range candidates {
		if _, exists := seen[name]; exists {
			return fmt.Errorf("名称 %q 重复", name)
		}
		seen[name] = struct{}{}
	}

	var prices []model.PriceConfig
	if err := db.Find(&prices).Error; err != nil {
		return fmt.Errorf("查询历史模型: %w", err)
	}
	occupied := make(map[string]struct{})
	for _, existing := range prices {
		if existing.ID == price.ID {
			continue
		}
		names, err := priceNames(&existing)
		if err != nil {
			continue
		}
		for _, name := range names {
			occupied[name] = struct{}{}
		}
	}
	for _, name := range candidates {
		if _, exists := occupied[name]; exists {
			return fmt.Errorf("名称 %q 已被历史模型或别名占用", name)
		}
	}
	return nil
}

func priceNames(price *model.PriceConfig) ([]string, error) {
	names := []string{normalizePriceName(price.Model)}
	if strings.TrimSpace(price.Aliases) == "" {
		return names, nil
	}
	var aliases []string
	if err := json.Unmarshal([]byte(price.Aliases), &aliases); err != nil {
		return nil, errors.New("aliases 不是有效的 JSON 数组")
	}
	for _, alias := range aliases {
		if normalized := normalizePriceName(alias); normalized != "" {
			names = append(names, normalized)
		}
	}
	return names, nil
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
