package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

// auditSkips are dashboard endpoints whose behavior is already recorded by
// their own handlers (channel disable/recover events) or that are
// side-effect-free and too noisy to record (fetches, tests).
var auditSkips = map[string]struct{}{
	"/v1/dashboard/providers/fetch-models":                       {},
	"/v1/dashboard/rules/:type/:id/test":                         {},
	"/v1/dashboard/exchange-rate/test":                           {},
	"/v1/dashboard/disabled-records/:id/replay":                  {},
	"/v1/dashboard/disabled-records/:id/restore-direct":          {},
	"/v1/dashboard/providers/disable-status/reset-all":           {},
	"/v1/dashboard/providers/:id/disable-status/reset-dimension": {},
}

// auditLabels maps dashboard write routes to their "系统管理" event label.
// Keys are METHOD + FullPath so that PUT/DELETE on the same path get
// distinct labels; path segments match the main.go registration exactly.
var auditLabels = map[string]string{
	"POST /v1/dashboard/providers":                     "新建供应商",
	"PUT /v1/dashboard/providers/:id":                  "修改供应商",
	"DELETE /v1/dashboard/providers/:id":               "删除供应商",
	"POST /v1/dashboard/providers/:id/toggle":          "启用/停用供应商",
	"POST /v1/dashboard/providers/:id/workflow-toggle": "切换供应商工作流",

	"POST /v1/dashboard/tokens":            "新建令牌",
	"PUT /v1/dashboard/tokens/:id":         "修改令牌",
	"DELETE /v1/dashboard/tokens/:id":      "删除令牌",
	"POST /v1/dashboard/tokens/:id/toggle": "启用/停用令牌",
	"POST /v1/dashboard/tokens/:id/rotate": "轮换令牌密钥",

	"POST /v1/dashboard/logs/clear":        "清空使用记录",
	"POST /v1/dashboard/log-capture/clear": "清空抓取日志",

	"PUT /v1/dashboard/users/me/username": "修改用户名",
	"PUT /v1/dashboard/users/me/password": "修改密码",

	"POST /v1/dashboard/rules/:type":       "新建规则",
	"PUT /v1/dashboard/rules/:type/:id":    "修改规则",
	"DELETE /v1/dashboard/rules/:type/:id": "删除规则",

	"POST /v1/dashboard/models":       "新建模型价格",
	"PUT /v1/dashboard/models/:id":    "修改模型价格",
	"DELETE /v1/dashboard/models/:id": "删除模型价格",

	"PUT /v1/dashboard/settings":                "修改系统设置",
	"PUT /v1/dashboard/settings/base-url-paths": "更新 BaseURL 路径",
	"POST /v1/dashboard/exchange-rate/refresh":  "刷新汇率",

	"PUT /v1/dashboard/topology":                       "保存拓扑",
	"POST /v1/dashboard/topology/versions/archive":     "归档拓扑版本",
	"POST /v1/dashboard/topology/versions/:id/restore": "恢复拓扑版本",
	"PUT /v1/dashboard/flat-topology":                  "保存工作流",
	"PUT /v1/dashboard/layout":                         "更新布局",
	"PUT /v1/dashboard/channel-affinity":               "修改渠道亲和性",
	"PUT /v1/dashboard/table-configs/:id":              "更新表格配置",
	"PUT /v1/dashboard/active-requests/config":         "修改监控配置",
}

// AuditSystemAdmin records a "系统管理" log row for every dashboard write
// operation that is not already recorded by its own handler and not in
// auditSkips. Reads never log. Errors never log (only >=400 responses are
// skipped, so non-2xx writes produce no audit entry).
func AuditSystemAdmin(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead || c.Request.Method == http.MethodOptions {
			return
		}
		fullPath := c.FullPath()
		if fullPath == "" {
			return
		}
		if c.Writer.Status() >= http.StatusBadRequest {
			return
		}
		if _, ok := auditSkips[fullPath]; ok {
			return
		}
		label, ok := auditLabels[c.Request.Method+" "+fullPath]
		if !ok {
			label = c.Request.Method + " " + strings.TrimPrefix(fullPath, "/v1/dashboard")
		}
		service.LogEvent(service.LogSourceSystemAdmin, "", label)
	}
}
