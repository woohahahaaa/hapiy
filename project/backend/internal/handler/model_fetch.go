package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/service"
)

// fetchModelsRequest is the client-provided upstream model source.
type fetchModelsRequest struct {
	Endpoint string `json:"endpoint"`
	Key      string `json:"key,omitempty"`
}

// upstreamModelItem is one entry of the upstream {"data": [...]} payload.
type upstreamModelItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// fetchModelsResponseItem is one normalized model entry returned to the client.
type fetchModelsResponseItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// FetchModels proxies the upstream model list from the full endpoint given by
// the client. The endpoint is used verbatim - never with /models appended.
func FetchModels() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req fetchModelsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体格式错误"})
			return
		}

		parsed, err := url.Parse(req.Endpoint)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "接口地址必须是 http(s) URL"})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()

		request, err := http.NewRequestWithContext(ctx, http.MethodGet, req.Endpoint, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无法连接上游: " + truncateErr(err)})
			return
		}
		request.Header.Set("Accept", "application/json")
		if req.Key != "" {
			request.Header.Set("Authorization", "Bearer "+req.Key)
		}

		response, err := service.DefaultClient().Do(request)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无法连接上游: " + truncateErr(err)})
			return
		}
		defer response.Body.Close()

		body, err := io.ReadAll(response.Body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无法连接上游: " + truncateErr(err)})
			return
		}

		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("上游返回错误状态码: %d", response.StatusCode)})
			return
		}

		var payload struct {
			Data []upstreamModelItem `json:"data"`
		}
		if err := json.Unmarshal(body, &payload); err != nil || payload.Data == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "上游响应缺少 data 数组"})
			return
		}

		models := make([]fetchModelsResponseItem, 0, len(payload.Data))
		for _, item := range payload.Data {
			name := item.Name
			if name == "" {
				name = item.ID
			}
			models = append(models, fetchModelsResponseItem{ID: item.ID, Name: name})
		}
		c.JSON(http.StatusOK, gin.H{"data": models})
	}
}

// truncateErr caps error text at a reasonable length for client-facing messages.
func truncateErr(err error) string {
	msg := err.Error()
	const maxRunes = 200
	runes := []rune(msg)
	if len(runes) > maxRunes {
		return string(runes[:maxRunes])
	}
	return msg
}
