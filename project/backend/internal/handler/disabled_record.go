package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	providerops "github.com/hapiy/hapiy/internal/provider"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/gorm"
)

// ListDisabledRecords returns every still-open DisabledRecord sorted by
// disabled_at descending. Resolved rows are filtered out so the table
// stays focused on work that actually needs attention.
func ListDisabledRecords(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := providerops.ListPendingRecords(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": rows})
	}
}

// ReplayDisabledRecord triggers a manual replay of a recorded disable
// event. On success the underlying disable is cleared (with cascade),
// and the response includes whether the replay resolved the row.
func ReplayDisabledRecord(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		record, resolved, err := providerops.ReplayRecord(db, engine, id)
		if err != nil {
			if errors.Is(err, providerops.ErrRecordNotFound) {
				respondError(c, http.StatusNotFound, "DISABLED_RECORD_NOT_FOUND", "记录不存在")
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": record, "resolved": resolved})
	}
}

// ExtendDisabledRecordCountdown pushes a record's countdown deadline
// forward by `minutes` — timed-recovery mode lets the user defer a
// past-deadline record's recovery to the next cycle instead of either
// restoring immediately or waiting for auto-recovery to fire.
func ExtendDisabledRecordCountdown(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var body struct {
			Minutes int `json:"minutes"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			respondError(c, http.StatusBadRequest, "REQUEST_BODY_MALFORMED", "请求体格式无效")
			return
		}
		record, extended, err := providerops.ExtendRecordCountdown(db, id, body.Minutes)
		if err != nil {
			switch {
			case errors.Is(err, providerops.ErrMinutesInvalid):
				respondError(c, http.StatusBadRequest, "MINUTES_INVALID", err.Error())
			case errors.Is(err, providerops.ErrRecordNotFound):
				respondError(c, http.StatusNotFound, "DISABLED_RECORD_NOT_FOUND", "记录不存在")
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": record, "extended": extended})
	}
}

// RestoreDisabledRecordDirectly clears the disable state behind a record
// without running a probe — an explicit user action. The record row and
// its underlying AutoDisableState are reset.
func RestoreDisabledRecordDirectly(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := providerops.RestoreRecordDirectly(db, engine, id); err != nil {
			if errors.Is(err, providerops.ErrRecordNotFound) {
				respondError(c, http.StatusNotFound, "DISABLED_RECORD_NOT_FOUND", "记录不存在")
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}, "resolved": true})
	}
}
