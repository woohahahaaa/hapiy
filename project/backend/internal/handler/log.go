package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func ListLogs(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var logs []model.Log
		query := db.Order("created_at DESC")

		// Filters
		if modelName := c.Query("model"); modelName != "" {
			query = query.Where("model_name = ?", modelName)
		}
		if providerName := c.Query("provider"); providerName != "" {
			query = query.Where("provider_name = ?", providerName)
		}
		if status := c.Query("status"); status != "" {
			query = query.Where("status = ?", status)
		}
		if logType := c.Query("type"); logType != "" {
			switch logType {
			case "channel_disabled":
				query = query.Where("source = ?", service.LogSourceChannelDisabled)
			case "channel_recovered_auto":
				query = query.Where("source = ?", service.LogSourceChannelRecoveredAuto)
			case "channel_recovered_manual":
				query = query.Where("source = ?", service.LogSourceChannelRecoveredManual)
			case "system_admin":
				query = query.Where("source = ?", service.LogSourceSystemAdmin)
			case "request":
				query = query.Where("source NOT IN ?", []string{
					service.LogSourceChannelDisabled,
					service.LogSourceChannelRecoveredAuto,
					service.LogSourceChannelRecoveredManual,
					service.LogSourceSystemAdmin,
				})
			}
		}
		if tokenName := c.Query("token"); tokenName != "" {
			query = query.Where("token_name = ?", tokenName)
		}
		if rid := c.Query("request_id"); rid != "" {
			query = query.Where("request_id = ?", rid)
		}
		if from := c.Query("from"); from != "" {
			if t, err := time.Parse(time.RFC3339, from); err == nil {
				query = query.Where("created_at >= ?", t)
			}
		}
		if to := c.Query("to"); to != "" {
			if t, err := time.Parse(time.RFC3339, to); err == nil {
				query = query.Where("created_at <= ?", t)
			}
		}

		// Pagination
		limit := 50
		if l := c.Query("limit"); l != "" {
			limit = parseInt(l, 50)
		}
		offset := 0
		if o := c.Query("offset"); o != "" {
			offset = parseInt(o, 0)
		}

		var total int64
		query.Model(&model.Log{}).Count(&total)
		query = query.Limit(limit).Offset(offset)

		if err := query.Find(&logs).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data":  logs,
			"total": total,
		})
	}
}

// GetLogStats returns lifetime-cumulative usage stats read from the
// usage_counters table. Range / from / to query params are parsed for
// backward compatibility but ignored — the counter is decoupled from
// the logs table and represents all-time totals since the last reset.
func GetLogStats(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Range/from/to are silently accepted but no longer applied — the
		// counter is lifetime-cumulative.
		_ = c.Query("range")
		_ = c.Query("from")
		_ = c.Query("to")

		var counter model.UsageCounter
		err := db.First(&counter, "id = ?", 1).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var avgLatency float64
		if counter.SuccessCount > 0 {
			avgLatency = float64(counter.TotalUseTimeMs) / float64(counter.SuccessCount)
		}
		var cacheHitRate float64
		if denom := counter.CacheHitTokens + counter.CacheMissTokens; denom > 0 {
			cacheHitRate = float64(counter.CacheHitTokens) / float64(denom)
		}
		var throughput float64
		if counter.TotalUseTimeMs > 0 {
			throughput = float64(counter.TotalTokens) * 1000.0 / float64(counter.TotalUseTimeMs)
		}

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"total_requests":  counter.TotalRequests,
			"success_count":   counter.SuccessCount,
			"failed_count":    counter.FailedCount,
			"total_tokens":    counter.TotalTokens,
			"average_latency": avgLatency,
			"total_cost":      counter.TotalCost,
			"cache_hit_rate":  cacheHitRate,
			"throughput":      throughput,
			"models":          []struct{}{},
		}})
	}
}

// ClearUsage resets the lifetime usage counter to zero. The logs table
// is NOT touched — the two stores are intentionally independent.
func ClearUsage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := db.Exec("DELETE FROM usage_counters WHERE id = ?", 1).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": true})
	}
}

// ClearLogs deletes usage log records from the database. Body (optional):
// {scope: "filtered"|"all", filters?}. filtered mode removes rows matching the
// filters (token/provider/model/status/from/to, mirroring ListLogs); all mode
// removes every row. Responds {deleted}.
func ClearLogs(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Scope   string `json:"scope"`
			Filters struct {
				Token    string `json:"token"`
				Provider string `json:"provider"`
				Model    string `json:"model"`
				Status   string `json:"status"`
				From     string `json:"from"`
				To       string `json:"to"`
			} `json:"filters"`
		}
		_ = c.ShouldBindJSON(&body)
		query := db
		if body.Scope != "all" {
			if body.Filters.Token != "" {
				query = query.Where("token_name = ?", body.Filters.Token)
			}
			if body.Filters.Provider != "" {
				query = query.Where("provider_name = ?", body.Filters.Provider)
			}
			if body.Filters.Model != "" {
				query = query.Where("model_name = ?", body.Filters.Model)
			}
			if body.Filters.Status != "" {
				query = query.Where("status = ?", body.Filters.Status)
			}
			if t, err := time.Parse(time.RFC3339, body.Filters.From); err == nil {
				query = query.Where("created_at >= ?", t)
			}
			if t, err := time.Parse(time.RFC3339, body.Filters.To); err == nil {
				query = query.Where("created_at <= ?", t)
			}
		} else {
			query = query.Where("1 = 1")
		}
		result := query.Delete(&model.Log{})
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": result.RowsAffected})
	}
}

func parseInt(s string, defaultVal int) int {
	if s == "" {
		return defaultVal
	}
	var result int
	for _, c := range s {
		if c < '0' || c > '9' {
			return defaultVal
		}
		result = result*10 + int(c-'0')
	}
	return result
}
