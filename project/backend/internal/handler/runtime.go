package handler

import (
	"net/http"
	"strconv"

	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const activeRequestRetentionKey = "active_requests_retention_minutes"

// DefaultActiveRequestRetentionMinutes is used when no setting is stored yet.
const DefaultActiveRequestRetentionMinutes = 5

// InitActiveRequestRetention loads the persisted retention setting into the
// global metrics at startup.
func InitActiveRequestRetention(db *gorm.DB) {
	var setting model.Setting
	if err := db.First(&setting, "key = ?", activeRequestRetentionKey).Error; err != nil {
		return
	}
	if minutes, err := strconv.ParseFloat(setting.Value, 64); err == nil {
		common.Global().SetRetentionMinutes(minutes)
	}
}

// GetActiveRequestConfig returns the current retention setting.
func GetActiveRequestConfig(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var setting model.Setting
		err := db.First(&setting, "key = ?", activeRequestRetentionKey).Error
		if err == nil {
			if minutes, convErr := strconv.ParseFloat(setting.Value, 64); convErr == nil {
				c.JSON(http.StatusOK, gin.H{"data": gin.H{"retention_minutes": minutes}})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"retention_minutes": DefaultActiveRequestRetentionMinutes}})
	}
}

// PutActiveRequestConfig validates and persists the retention setting, then
// applies it to the live metrics.
func PutActiveRequestConfig(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			RetentionMinutes float64 `json:"retention_minutes"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.RetentionMinutes < 0 || req.RetentionMinutes > 1440 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "retention_minutes 必须在 0-1440 之间"})
			return
		}

		setting := model.Setting{Key: activeRequestRetentionKey, Value: strconv.FormatFloat(req.RetentionMinutes, 'f', -1, 64)}
		if err := db.Where("key = ?", setting.Key).
			Assign(model.Setting{Value: setting.Value}).
			FirstOrCreate(&setting).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		common.Global().SetRetentionMinutes(req.RetentionMinutes)
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"retention_minutes": req.RetentionMinutes}})
	}
}

func RuntimeMetrics(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"data": common.Global().Snapshot()})
	}
}

func ActiveRequests() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"data": common.Global().ActiveRequests()})
	}
}

// KillActiveRequest aborts an in-flight request by cancelling the context the
// relay handler registered under its request ID. Returns 404 when no in-flight
// request matches (it already finished, or never reached the relay stage).
func KillActiveRequest() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.Param("requestId")
		if !common.Global().CancelRequest(requestID) {
			c.JSON(http.StatusNotFound, gin.H{"error": "请求不存在或已结束"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"request_id": requestID}})
	}
}
