package handler

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/gorm"
)

// ruleNameTaken returns true when a rule with the same name already
// exists in the same domain. excludeID lets UpdateRule skip itself so
// editing a rule keeps its current name valid.
func ruleNameTaken(db *gorm.DB, ruleType, name, excludeID string) (bool, error) {
	if name == "" {
		return false, nil
	}
	q := db.Where("name = ?", name).Where("id <> ?", excludeID)
	switch ruleType {
	case RuleTypeRewrite:
		var n int64
		if err := q.Model(&model.RewriteRule{}).Count(&n).Error; err != nil {
			return false, err
		}
		return n > 0, nil
	case RuleTypeHeartbeat:
		var n int64
		if err := q.Model(&model.HeartbeatRule{}).Count(&n).Error; err != nil {
			return false, err
		}
		return n > 0, nil
	case RuleTypeConcurrency:
		var n int64
		if err := q.Model(&model.ConcurrencyRule{}).Count(&n).Error; err != nil {
			return false, err
		}
		return n > 0, nil
	case RuleTypeFailover:
		var n int64
		if err := q.Model(&model.FailoverRule{}).Count(&n).Error; err != nil {
			return false, err
		}
		return n > 0, nil
	case RuleTypeRewriteResponse:
		var n int64
		if err := q.Model(&model.ResponseRewriteRule{}).Count(&n).Error; err != nil {
			return false, err
		}
		return n > 0, nil
	}
	return false, fmt.Errorf("unknown rule type %q", ruleType)
}

// Rule type constants
const (
	RuleTypeRewrite         = "rewrite"
	RuleTypeHeartbeat       = "heartbeat"
	RuleTypeConcurrency     = "concurrency"
	RuleTypeFailover        = "failover"
	RuleTypeRewriteResponse = "rewrite-response"
)

func ListRules(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ruleType := c.Param("type")
		limit := parseInt(c.Query("limit"), 50)
		offset := parseInt(c.Query("offset"), 0)

		switch ruleType {
		case RuleTypeRewrite:
			var r []model.RewriteRule
			var total int64
			if err := db.Model(&model.RewriteRule{}).Count(&total).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := db.Model(&model.RewriteRule{}).Order("id asc").Limit(limit).Offset(offset).Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": r, "total": total})
		case RuleTypeHeartbeat:
			var r []model.HeartbeatRule
			var total int64
			if err := db.Model(&model.HeartbeatRule{}).Count(&total).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := db.Model(&model.HeartbeatRule{}).Order("id asc").Limit(limit).Offset(offset).Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": r, "total": total})
		case RuleTypeConcurrency:
			var r []model.ConcurrencyRule
			var total int64
			if err := db.Model(&model.ConcurrencyRule{}).Count(&total).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := db.Model(&model.ConcurrencyRule{}).Order("id asc").Limit(limit).Offset(offset).Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": r, "total": total})
		case RuleTypeFailover:
			var r []model.FailoverRule
			var total int64
			if err := db.Model(&model.FailoverRule{}).Count(&total).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := db.Model(&model.FailoverRule{}).Order("id asc").Limit(limit).Offset(offset).Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": r, "total": total})
		case RuleTypeRewriteResponse:
			var r []model.ResponseRewriteRule
			var total int64
			if err := db.Model(&model.ResponseRewriteRule{}).Count(&total).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := db.Model(&model.ResponseRewriteRule{}).Order("id asc").Limit(limit).Offset(offset).Find(&r).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": r, "total": total})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule type"})
			return
		}
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
			if dup, err := ruleNameTaken(db, RuleTypeRewrite, r.Name, ""); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			} else if dup {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("改写规则名称 %q 已存在", r.Name)})
				return
			}
			rule = &r
		case RuleTypeHeartbeat:
			var r model.HeartbeatRule
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			if dup, err := ruleNameTaken(db, RuleTypeHeartbeat, r.Name, ""); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			} else if dup {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("心跳规则名称 %q 已存在", r.Name)})
				return
			}
			rule = &r
		case RuleTypeConcurrency:
			var r model.ConcurrencyRule
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			if dup, err := ruleNameTaken(db, RuleTypeConcurrency, r.Name, ""); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			} else if dup {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("并发规则名称 %q 已存在", r.Name)})
				return
			}
			rule = &r
		case RuleTypeFailover:
			var r model.FailoverRule
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			if err := r.Validate(); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			if dup, err := ruleNameTaken(db, RuleTypeFailover, r.Name, ""); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			} else if dup {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("自动禁用规则名称 %q 已存在", r.Name)})
				return
			}
			rule = &r
		case RuleTypeRewriteResponse:
			var r model.ResponseRewriteRule
			if err := c.ShouldBindJSON(&r); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			if dup, err := ruleNameTaken(db, RuleTypeRewriteResponse, r.Name, ""); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			} else if dup {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("响应改写规则名称 %q 已存在", r.Name)})
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
			if err := r.Validate(); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			if dup, err := ruleNameTaken(db, RuleTypeFailover, r.Name, id); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			} else if dup {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("自动禁用规则名称 %q 已存在", r.Name)})
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
			if dup, err := ruleNameTaken(db, RuleTypeRewriteResponse, r.Name, id); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			} else if dup {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("响应改写规则名称 %q 已存在", r.Name)})
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
