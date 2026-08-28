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
		if source := c.Query("source"); source != "" {
			query = service.ApplySourceFilter(query, source)
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

// ListLogSources lists the distinct non-empty sources from the logs table,
// sorted ascending, for the dashboard source filter dropdown.
func ListLogSources(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var sources []string
		if err := db.Model(&model.Log{}).
			Distinct("source").
			Where("source != ''").
			Order("source ASC").
			Pluck("source", &sources).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": sources, "total": len(sources)})
	}
}

// ListLogModels lists the distinct non-empty model names from the logs
// table, sorted ascending, for the dashboard model filter dropdown.
func ListLogModels(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var models []string
		if err := db.Model(&model.Log{}).
			Distinct("model_name").
			Where("model_name != ''").
			Order("model_name ASC").
			Pluck("model_name", &models).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": models, "total": len(models)})
	}
}

// GetLogStats returns usage stats. When from/to are present it aggregates
// request rows from the logs table scoped to the time window (success counts
// tokens/cost, failed counts requests, event rows excluded); otherwise it
// returns the lifetime-cumulative usage_counters row.
func GetLogStats(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// "range" is accepted for backward compatibility but not applied.
		_ = c.Query("range")
		fromStr := c.Query("from")
		toStr := c.Query("to")

		var totalRequests, successCount, failedCount, totalTokens int64
		var totalCost float64
		var cacheHitTokens, cacheMissTokens, totalUseTimeMs int64

		if fromStr != "" || toStr != "" {
			query := db.Model(&model.Log{}).
				Select("COALESCE(SUM(CASE WHEN status = 'success' OR status = 'failed' THEN 1 ELSE 0 END), 0) AS total_requests, "+
					"COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success_count, "+
					"COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count, "+
					"COALESCE(SUM(CASE WHEN status = 'success' THEN prompt_tokens + completion_tokens ELSE 0 END), 0) AS total_tokens, "+
					"COALESCE(SUM(CASE WHEN status = 'success' THEN quota ELSE 0 END), 0) AS total_cost, "+
					"COALESCE(SUM(CASE WHEN status = 'success' THEN prompt_cache_hit_tokens ELSE 0 END), 0) AS cache_hit_tokens, "+
					"COALESCE(SUM(CASE WHEN status = 'success' THEN prompt_cache_miss_tokens ELSE 0 END), 0) AS cache_miss_tokens, "+
					"COALESCE(SUM(CASE WHEN status = 'success' THEN use_time ELSE 0 END), 0) AS total_use_time_ms").
				Where("status IN ?", []string{"success", "failed"})
			if fromStr != "" {
				from, err := time.Parse(time.RFC3339, fromStr)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid from: must be RFC3339"})
					return
				}
				query = query.Where("created_at >= ?", from)
			}
			if toStr != "" {
				to, err := time.Parse(time.RFC3339, toStr)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid to: must be RFC3339"})
					return
				}
				query = query.Where("created_at <= ?", to)
			}

			var agg struct {
				TotalRequests   int64
				SuccessCount    int64
				FailedCount     int64
				TotalTokens     int64
				TotalCost       float64
				CacheHitTokens  int64
				CacheMissTokens int64
				TotalUseTimeMs  int64
			}
			if err := query.Scan(&agg).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			totalRequests = agg.TotalRequests
			successCount = agg.SuccessCount
			failedCount = agg.FailedCount
			totalTokens = agg.TotalTokens
			totalCost = agg.TotalCost
			cacheHitTokens = agg.CacheHitTokens
			cacheMissTokens = agg.CacheMissTokens
			totalUseTimeMs = agg.TotalUseTimeMs
		} else {
			var counter model.UsageCounter
			err := db.First(&counter, "id = ?", 1).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			totalRequests = counter.TotalRequests
			successCount = counter.SuccessCount
			failedCount = counter.FailedCount
			totalTokens = counter.TotalTokens
			totalCost = counter.TotalCost
			cacheHitTokens = counter.CacheHitTokens
			cacheMissTokens = counter.CacheMissTokens
			totalUseTimeMs = counter.TotalUseTimeMs
		}

		var avgLatency float64
		if successCount > 0 {
			avgLatency = float64(totalUseTimeMs) / float64(successCount)
		}
		var cacheHitRate float64
		if denom := cacheHitTokens + cacheMissTokens; denom > 0 {
			cacheHitRate = float64(cacheHitTokens) / float64(denom)
		}
		var throughput float64
		if totalUseTimeMs > 0 {
			throughput = float64(totalTokens) * 1000.0 / float64(totalUseTimeMs)
		}

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"total_requests":  totalRequests,
			"success_count":   successCount,
			"failed_count":    failedCount,
			"total_tokens":    totalTokens,
			"average_latency": avgLatency,
			"total_cost":      totalCost,
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
				Source   string `json:"source"`
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
			if body.Filters.Source != "" {
				query = service.ApplySourceFilter(query, body.Filters.Source)
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
