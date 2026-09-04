package middleware

import (
	"net/http"
	"runtime"
	"sync/atomic"

	"github.com/gin-gonic/gin"
)

// OverloadProtection provides overload protection based on system metrics.
// Reference: New API middleware - returns 503 when thresholds exceeded.

type OverloadConfig struct {
	Enabled         bool
	CPUThreshold    int // percentage
	MemThreshold    int // percentage
	MaxActiveReqs   int // max concurrent requests
	MaxQueuedReqs   int // max queue depth
}

var defaultOverloadConfig = OverloadConfig{
	Enabled:       true,
	CPUThreshold:  80,
	MemThreshold:  85,
	MaxActiveReqs: 1000,
	MaxQueuedReqs: 500,
}

var (
	activeRequests atomic.Int32
	queuedRequests atomic.Int32
)

// OverloadProtection returns 503 when system is overloaded.
func OverloadProtection(cfg *OverloadConfig) gin.HandlerFunc {
	if cfg == nil {
		cfg = &defaultOverloadConfig
	}

	return func(c *gin.Context) {
		if !cfg.Enabled {
			c.Next()
			return
		}

		// Check active requests
		active := activeRequests.Load()
		if active >= int32(cfg.MaxActiveReqs) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": "server overloaded: too many active requests",
					"type":    "overloaded",
				},
			})
			c.Abort()
			return
		}

		// Check memory (simplified - in production use gopsutil)
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		memPercent := int(m.Sys * 100 / (1024 * 1024 * 1024)) // rough estimate
		if memPercent > cfg.MemThreshold {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": "server overloaded: memory threshold exceeded",
					"type":    "overloaded",
				},
			})
			c.Abort()
			return
		}

		// Track request
		activeRequests.Add(1)
		defer activeRequests.Add(-1)

		c.Next()
	}
}

// GetActiveRequests returns current active request count
func GetActiveRequests() int {
	return int(activeRequests.Load())
}

// GetQueuedRequests returns current queued request count
func GetQueuedRequests() int {
	return int(queuedRequests.Load())
}
