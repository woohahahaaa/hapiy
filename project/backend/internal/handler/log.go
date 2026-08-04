package handler

import (
	"net/http"
	"time"

	"github.com/hapiy/hapiy/internal/model"
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
		if status := c.Query("status"); status != "" {
			query = query.Where("status = ?", status)
		}
		if tokenName := c.Query("token"); tokenName != "" {
			query = query.Where("token_name = ?", tokenName)
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

func GetLogStats(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var since *time.Time
		switch c.Query("range") {
		case "1d":
			t := time.Now().Add(-24 * time.Hour)
			since = &t
		case "7d":
			t := time.Now().Add(-7 * 24 * time.Hour)
			since = &t
		case "30d":
			t := time.Now().Add(-30 * 24 * time.Hour)
			since = &t
		}

		applyRange := func(q *gorm.DB) *gorm.DB {
			if since != nil {
				return q.Where("created_at >= ?", *since)
			}
			return q
		}

		var stats struct {
			TotalRequests  int64   `json:"total_requests"`
			SuccessCount   int64   `json:"success_count"`
			FailedCount    int64   `json:"failed_count"`
			TotalTokens    int64   `json:"total_tokens"`
			AverageLatency float64 `json:"average_latency"`
		}

		applyRange(db.Model(&model.Log{})).Count(&stats.TotalRequests)
		applyRange(db.Model(&model.Log{})).Where("status = ?", "success").Count(&stats.SuccessCount)
		applyRange(db.Model(&model.Log{})).Where("status = ?", "failed").Count(&stats.FailedCount)
		applyRange(db.Model(&model.Log{})).Where("status = ?", "success").
			Select("SUM(prompt_tokens + completion_tokens)").
			Scan(&stats.TotalTokens)
		applyRange(db.Model(&model.Log{})).Select("AVG(use_time)").Scan(&stats.AverageLatency)

		var modelStats []struct {
			Model  string `json:"model"`
			Count  int64  `json:"count"`
			Tokens int64  `json:"tokens"`
		}
		applyRange(db.Model(&model.Log{})).
			Select("model_name as model, COUNT(*) as count, SUM(prompt_tokens + completion_tokens) as tokens").
			Group("model_name").
			Scan(&modelStats)

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"total_requests":  stats.TotalRequests,
			"success_count":   stats.SuccessCount,
			"failed_count":    stats.FailedCount,
			"total_tokens":    stats.TotalTokens,
			"average_latency": stats.AverageLatency,
			"models":          modelStats,
		}})
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
