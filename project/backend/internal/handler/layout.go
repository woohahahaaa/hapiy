package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/layout"
	"gorm.io/gorm"
)

// GetLayout returns the stored topology canvas layout together with its
// version metadata, so clients can detect edits made from another tab. When
// no layout has ever been saved, returns `layout: {}` with `version: 0`
// rather than 404 — the frontend trusts the envelope.
func GetLayout(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		loaded, meta, err := layout.NewStore(db).LoadWithMeta()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if loaded == nil {
			loaded = &layout.Layout{}
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"layout":     *loaded,
			"version":    meta.Version,
			"updated_at": meta.UpdatedAt,
		}})
	}
}

// PutLayout persists the topology canvas layout, bumping the version on
// every save. Last-write-wins; the body does not include an expected version.
// Status codes:
//   - 400 invalid JSON body
//   - 500 save failure
//   - 200 success; the same envelope shape as GetLayout is returned after reload.
func PutLayout(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Layout layout.Layout `json:"layout"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if body.Layout == nil {
			body.Layout = layout.Layout{}
		}
		if err := layout.NewStore(db).Save(&body.Layout); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		reloaded, meta, err := layout.NewStore(db).LoadWithMeta()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if reloaded == nil {
			reloaded = &layout.Layout{}
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"layout":     *reloaded,
			"version":    meta.Version,
			"updated_at": meta.UpdatedAt,
		}})
	}
}
