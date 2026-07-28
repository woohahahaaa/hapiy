package handler

import (
	"net/http"

	"github.com/hapiy/hapiy/internal/common"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RuntimeMetrics(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"data": common.Global().Snapshot()})
	}
}
