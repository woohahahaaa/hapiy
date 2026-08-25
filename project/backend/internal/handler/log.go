package handler

import (
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

		var until *time.Time
		if to := c.Query("to"); to != "" {
			if t, err := time.Parse(time.RFC3339, to); err == nil {
				until = &t
			}
		}
		if from := c.Query("from"); from != "" {
			if t, err := time.Parse(time.RFC3339, from); err == nil {
				since = &t
			}
		}

		applyRange := func(q *gorm.DB) *gorm.DB {
			if since != nil {
				q = q.Where("created_at >= ?", *since)
			}
			if until != nil {
				q = q.Where("created_at <= ?", *until)
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
