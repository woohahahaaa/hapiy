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
		// Get stats for last 24 hours
		since := time.Now().Add(-24 * time.Hour)

		var stats struct {
			TotalRequests      int64
			SuccessCount       int64
			FailedCount        int64
			TotalTokens        int64
			AverageLatency     float64
		}

		db.Model(&model.Log{}).
			Where("created_at >= ?", since).
			Count(&stats.TotalRequests)

		db.Model(&model.Log{}).
			Where("created_at >= ? AND status = ?", since, "success").
			Count(&stats.SuccessCount)

		db.Model(&model.Log{}).
			Where("created_at >= ? AND status = ?", since, "failed").
			Count(&stats.FailedCount)

		db.Model(&model.Log{}).
			Where("created_at >= ? AND status = ?", since, "success").
			Select("SUM(prompt_tokens + completion_tokens)").
			Scan(&stats.TotalTokens)

		db.Model(&model.Log{}).
			Where("created_at >= ?", since).
			Select("AVG(use_time)").
			Scan(&stats.AverageLatency)

		c.JSON(http.StatusOK, gin.H{"data": stats})
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
