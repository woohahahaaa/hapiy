package handler

import (
	"encoding/json"
	"net/http"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Rule type constants
const (
	RuleTypeRewrite     = "rewrite"
	RuleTypeHeartbeat   = "heartbeat"
	RuleTypeConcurrency = "concurrency"
	RuleTypeFailover          = "failover"
	RuleTypeRewriteResponse   = "rewrite-response"
)

func ListRules(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ruleType := c.Param("type")
		var rules interface{}

		switch ruleType {
		case RuleTypeRewrite:
			var r []model.RewriteRule
			if err := db.Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			rules = r
		case RuleTypeHeartbeat:
			var r []model.HeartbeatRule
			if err := db.Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			rules = r
		case RuleTypeConcurrency:
			var r []model.ConcurrencyRule
			if err := db.Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			rules = r
		case RuleTypeFailover:
			var r []model.FailoverRule
			if err := db.Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			rules = r
		case RuleTypeRewriteResponse:
			var r []model.ResponseRewriteRule
			if err := db.Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			rules = r
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule type"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": rules})
	}
}

func CreateRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ruleType := c.Param("type")
		var rule interface{}

		switch ruleType {
		case RuleTypeRewrite:
			var r model.RewriteRule
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		case RuleTypeHeartbeat:
			var r model.HeartbeatRule
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		case RuleTypeConcurrency:
			var r model.ConcurrencyRule
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		case RuleTypeFailover:
			var r model.FailoverRule
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		case RuleTypeRewriteResponse:
			var r model.ResponseRewriteRule
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule type"})
			return
		}

		if err := db.Create(rule).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"data": rule})
	}
}

func UpdateRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ruleType := c.Param("type")
		id := c.Param("id")

		var rule interface{}

		switch ruleType {
		case RuleTypeRewrite:
			var r model.RewriteRule
			if err := db.First(&r, "id = ?", id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
				return
			}
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		case RuleTypeHeartbeat:
			var r model.HeartbeatRule
			if err := db.First(&r, "id = ?", id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
				return
			}
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		case RuleTypeConcurrency:
			var r model.ConcurrencyRule
			if err := db.First(&r, "id = ?", id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
				return
			}
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		case RuleTypeFailover:
			var r model.FailoverRule
			if err := db.First(&r, "id = ?", id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
				return
			}
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		case RuleTypeRewriteResponse:
			var r model.ResponseRewriteRule
			if err := db.First(&r, "id = ?", id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
				return
			}
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rule = &r
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule type"})
			return
		}

		if err := db.Save(rule).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": rule})
	}
}

func DeleteRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ruleType := c.Param("type")
		id := c.Param("id")

		var modelType interface{}

		switch ruleType {
		case RuleTypeRewrite:
			modelType = &model.RewriteRule{}
		case RuleTypeHeartbeat:
			modelType = &model.HeartbeatRule{}
		case RuleTypeConcurrency:
			modelType = &model.ConcurrencyRule{}
		case RuleTypeFailover:
			modelType = &model.FailoverRule{}
		case RuleTypeRewriteResponse:
			modelType = &model.ResponseRewriteRule{}
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule type"})
			return
		}

		if err := db.Delete(modelType, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "rule deleted"})
	}
}

// TestRewriteRule applies a rule's script against the provided body and
// returns the original and modified bodies so the frontend can display a
// diff. Only rewrite and rewrite-response types are supported.
func TestRewriteRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ruleType := c.Param("type")
		id := c.Param("id")

		var script string
		switch ruleType {
		case RuleTypeRewrite:
			var r model.RewriteRule
			if err := db.First(&r, "id = ?", id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
				return
			}
			if !r.Status {
				c.JSON(http.StatusBadRequest, gin.H{"error": "rule is disabled"})
				return
			}
			script = r.Script
		case RuleTypeRewriteResponse:
			var r model.ResponseRewriteRule
			if err := db.First(&r, "id = ?", id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
				return
			}
			if !r.Status {
				c.JSON(http.StatusBadRequest, gin.H{"error": "rule is disabled"})
				return
			}
			script = r.Script
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "only rewrite and rewrite-response types support test"})
			return
		}

		var input struct {
			Body json.RawMessage `json:"body"`
		}
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		modified, err := relay.ApplyScript(input.Body, script)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}

		var modifiedRaw interface{}
		if err := json.Unmarshal(modified, &modifiedRaw); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "改写结果解析失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"original": input.Body,
			"modified": modifiedRaw,
		}})
	}
}
