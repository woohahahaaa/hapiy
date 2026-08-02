package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/gin-gonic/gin"
)

// Relay handles OpenAI-compatible API requests
func Relay(engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		startTime := time.Now()
		common.Global().BeginRequest()

		// Get token info from context (set by TokenAuth middleware)
		tokenIDRaw, _ := c.Get("token_id")
		tokenName, _ := c.Get("token_name")
		userID, _ := c.Get("user_id")

		// Parse request body
		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			common.Global().EndRequest("", false, int64(time.Since(startTime).Milliseconds()), 0)
			c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body"})
			return
		}

		var relayReq relay.RelayRequest
		if err := json.Unmarshal(bodyBytes, &relayReq); err != nil {
			common.Global().EndRequest("", false, int64(time.Since(startTime).Milliseconds()), 0)
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request format"})
			return
		}

		// Store full body for potential rewrite
		relayReq.Body = make(map[string]interface{})
		json.Unmarshal(bodyBytes, &relayReq.Body)

		// Copy headers
		relayReq.Headers = make(map[string]string)
		for k, v := range c.Request.Header {
			if len(v) > 0 {
				relayReq.Headers[k] = v[0]
			}
		}
		relayReq.RequestID = c.GetString("request_id")
		relayReq.UserID = getString(userID)
		if tokenID, ok := tokenIDRaw.(string); ok {
			relayReq.TokenID = tokenID
		}

		// Select provider for the model
		provider, err := engine.SelectProvider(relayReq.Model)
		if err != nil {
			logRelayError(c, userID, tokenName, relayReq.Model, err, startTime)
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": fmt.Sprintf("no provider available for model: %s", relayReq.Model),
					"type":    "service_unavailable",
				},
			})
			return
		}

		// Get execution plan
		plan, err := engine.GetPlan(provider.ID)
		if err != nil {
			logRelayError(c, userID, tokenName, relayReq.Model, err, startTime)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": gin.H{
					"message": "failed to get execution plan",
					"type":    "internal_error",
				},
			})
			return
		}

		// Execute relay request
		resp, err := engine.RelayRequest(c.Request.Context(), plan, &relayReq)
		if err != nil {
			logRelayError(c, userID, tokenName, relayReq.Model, err, startTime)
			// Concurrency rejection has its own dedicated HTTP status.
			// errors.As walks the wrapped chain so the rewrite stage
			// (which wraps with rule IDs) still surfaces correctly.
			if errors.Is(err, relay.ErrConcurrencyRejected) {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": gin.H{
						"message": "concurrency limit exceeded",
						"type":    "rate_limit_exceeded",
					},
				})
				return
			}
			c.JSON(http.StatusBadGateway, gin.H{
				"error": gin.H{
					"message": "upstream error: " + err.Error(),
					"type":    "upstream_error",
				},
			})
			return
		}

		// Log successful request
		useTime := int(time.Since(startTime).Milliseconds())
		logEntry := model.Log{
			UserID:           getString(userID),
			TokenName:        getString(tokenName),
			ProviderName:     provider.Name,
			ModelName:        relayReq.Model,
			IsStream:         relayReq.Stream,
			Status:           "success",
			IP:               c.ClientIP(),
			RequestID:        c.GetString("request_id"),
			UseTime:          useTime,
		}
		if resp.Usage != nil {
			logEntry.PromptTokens = resp.Usage.PromptTokens
			logEntry.CompletionTokens = resp.Usage.CompletionTokens
		}

		service.Logs().Write(&logEntry)

		if tokenID, ok := tokenIDRaw.(string); ok && tokenID != "" && resp.Usage != nil {
			tokens := int64(resp.Usage.PromptTokens + resp.Usage.CompletionTokens)
			if err := service.Quota().Charge(tokenID, tokens); err != nil {
				log.Printf("Failed to charge quota for token %s: %v", tokenID, err)
			}
		}

		common.Global().EndRequest(relayReq.Model, true, int64(useTime),
			int64(logEntry.PromptTokens+logEntry.CompletionTokens))

		// Set response headers
		for k, v := range resp.Headers {
			c.Header(k, v)
		}

		// Handle streaming vs non-streaming response
		if relayReq.Stream {
			handleStreamingResponse(c, resp)
		} else {
			handleNonStreamingResponse(c, resp)
		}
	}
}

// isConcurrencyRejectionError is a retained helper for tests that want
// to assert the 429 path without going through the live engine.
func isConcurrencyRejectionError(err error) bool {
	return errors.Is(err, relay.ErrConcurrencyRejected)
}

func handleNonStreamingResponse(c *gin.Context, resp *relay.RelayResponse) {
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read response"})
		return
	}
	c.Data(resp.StatusCode, "application/json", bodyBytes)
}

func handleStreamingResponse(c *gin.Context, resp *relay.RelayResponse) {
	defer resp.Body.Close()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return
	}

	// Stream the response
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			c.Writer.Write(buf[:n])
			flusher.Flush()
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
	}
}

func logRelayError(c *gin.Context, userID, tokenName interface{}, modelName string, err error, startTime time.Time) {
	useTime := int(time.Since(startTime).Milliseconds())
	service.Logs().Write(&model.Log{
		UserID:       getString(userID),
		TokenName:    getString(tokenName),
		ModelName:    modelName,
		Status:       "failed",
		IP:           c.ClientIP(),
		RequestID:    c.GetString("request_id"),
		ErrorMessage: err.Error(),
		UseTime:      useTime,
	})
	common.Global().EndRequest(modelName, false, int64(useTime), 0)
}

func getString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
