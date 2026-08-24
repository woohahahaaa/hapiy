package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

// Relay handles OpenAI-compatible API requests
func Relay(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
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
			useTime := int(time.Since(startTime).Milliseconds())
			service.LogRelayFailure(service.LogRelayFailureInput{
				TokenName: getString(tokenName),
				UserID:    getString(userID),
				RequestID: c.GetString("request_id"),
				IP:        c.ClientIP(),
				UseTimeMs: useTime,
				Error:     err,
			})
			common.Global().EndRequest(c.GetString("request_id"), "", false, int64(useTime), 0, "invalid_request")
			c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body"})
			return
		}

		var relayReq relay.RelayRequest
		if err := json.Unmarshal(bodyBytes, &relayReq); err != nil {
			useTime := int(time.Since(startTime).Milliseconds())
			service.LogRelayFailure(service.LogRelayFailureInput{
				TokenName: getString(tokenName),
				UserID:    getString(userID),
				RequestID: c.GetString("request_id"),
				IP:        c.ClientIP(),
				UseTimeMs: useTime,
				Error:     err,
			})
			common.Global().EndRequest(c.GetString("request_id"), "", false, int64(useTime), 0, "invalid_request")
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
		relayReq.Path = c.Request.URL.Path
		relayReq.SourceMark = c.GetHeader("X-Hapiy-Source")
		relayReq.UserID = getString(userID)
		relayReq.TokenName = getString(tokenName)
		if tokenID, ok := tokenIDRaw.(string); ok {
			relayReq.TokenID = tokenID
		}

		common.Global().TrackActiveRequest(common.ActiveRequest{
			RequestID: relayReq.RequestID,
			Model:     relayReq.Model,
			TokenName: getString(tokenName),
			UserID:    getString(userID),
			Source:    service.ResolveSourceMark(relayReq.SourceMark, relayReq.Path),
			Stream:    relayReq.Stream,
			StartTime: startTime,
			Stage:     "queued",
		})

		// Select provider for the model (channel affinity -> flat topology ->
		// provider fallback).
		dispatchResult, err := engine.Dispatch(relayReq.Model, c.Request.URL.Path, &affinity.Request{
			Model:   relayReq.Model,
			Path:    c.Request.URL.Path,
			Headers: relayReq.Headers,
			Body:    bodyBytes,
		})
		if err != nil {
			engine.RecordDispatchRejection(&relayReq, err)
			logRelayError(c, userID, tokenName, relayReq.Model, "", err, startTime, &relayReq, "")
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": fmt.Sprintf("无法为 %s 找到可用供应商，请检查：模型名（区分大小写）、endpoints 端点限制、供应商/工作流开关、自动禁用状态、拓扑接线。", relayReq.Model),
					"type":    "service_unavailable",
				},
			})
			return
		}
		provider := dispatchResult.Provider
		relayReq.KeyIndex = dispatchResult.KeyIndex
		relayReq.BaseURLIndex = dispatchResult.BaseURLIndex
		relayReq.TopologyOrigin = dispatchResult.Origin
		common.Global().TrackActiveRequest(common.ActiveRequest{
			RequestID:   relayReq.RequestID,
			Model:       relayReq.Model,
			TokenName:   getString(tokenName),
			UserID:      getString(userID),
			Provider:    provider.Name,
			Source:      service.ResolveSourceMark(relayReq.SourceMark, relayReq.Path),
			Stream:      relayReq.Stream,
			StartTime:   startTime,
			Stage:       "queued",
			PathNodeIds: dispatchResult.PathNodeIDs,
		})

		// Endpoint whitelist: an empty endpoints array means unrestricted; a
		// non-empty one requires an exact pathSuffix match. Malformed config is
		// treated as empty rather than rejecting every request.
		var allowed []string
		if provider.Endpoints != "" {
			var eps []struct {
				Name       string `json:"name"`
				PathSuffix string `json:"pathSuffix"`
			}
			if err := json.Unmarshal([]byte(provider.Endpoints), &eps); err == nil {
				for _, e := range eps {
					if s := strings.TrimSpace(e.PathSuffix); s != "" {
						allowed = append(allowed, s)
					}
				}
			}
		}
		if len(allowed) > 0 {
			matched := false
			for _, p := range allowed {
				if relayReq.Path == p {
					matched = true
					break
				}
			}
			if !matched {
				err := fmt.Errorf("endpoint not allowed: %s (allowed: %s)", relayReq.Path, strings.Join(allowed, ", "))
				logRelayError(c, userID, tokenName, relayReq.Model, provider.Name, err, startTime, &relayReq, "")
				c.JSON(http.StatusBadRequest, gin.H{
					"error": gin.H{
						"message": err.Error(),
						"type":    "invalid_request_error",
					},
				})
				return
			}
		}

		// Get execution plan
		plan := dispatchResult.Plan

		// Execute relay request. Live progress is pushed through the engine's
		// Progress callback so stages that happen inside RelayRequest (queue,
		// upstream connect) are surfaced truthfully instead of lingering on
		// the initial queued stage.
		requestID := c.GetString("request_id")
		flowStarted := false
		relayReq.Progress = func(stage string) {
			common.Global().UpdateActiveRequestProgress(requestID, stage, 0, 0)
			if stage == "connecting" {
				// The request has passed the concurrency gate (or none was
				// configured) and is about to hit the upstream: notify
				// dashboard subscribers so the topology can animate.
				flowStarted = true
				dashboardEventsHub.publish("request_started", map[string]any{
					"model":      relayReq.Model,
					"provider":   provider.Name,
					"request_id": requestID,
				})
			}
		}
		resp, err := engine.RelayRequest(c.Request.Context(), plan, &relayReq)
		if err != nil {
			if flowStarted {
				dashboardEventsHub.publish("request_finished", map[string]any{
					"model":      relayReq.Model,
					"provider":   provider.Name,
					"request_id": requestID,
				})
			}
			logRelayError(c, userID, tokenName, relayReq.Model, provider.Name, err, startTime, &relayReq, upstreamURLFromResp(resp))
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

		// Set response headers
		for k, v := range resp.Headers {
			c.Header(k, v)
		}

		if dispatchResult.AffinityMatch != nil {
			match := dispatchResult.AffinityMatch
			engine.Affinity().Record(match.RuleName, match.SessionID, match.ModelName, affinity.Triple{
				ProviderName: provider.Name,
				KeyIndex:     relayReq.KeyIndex,
				BaseURLIndex: relayReq.BaseURLIndex,
			}, 0)
		}

		// Forward the response first so use_time spans the full transfer for
		// streaming requests; the log row is written after the stream ends.
		firstByteMs := -1
		clientDisconnected := false
		if relayReq.Stream {
			common.Global().UpdateActiveRequestProgress(requestID, "waiting_upstream", 0, 0)
			firstByteMs, clientDisconnected = handleStreamingResponse(c, resp, requestID)
		} else {
			common.Global().UpdateActiveRequestProgress(requestID, "receiving", 0, 0)
			firstByteMs = handleNonStreamingResponse(c, resp)
		}

		// Backfill stream timings on log capture rows when the request has
		// any log output configured. FirstByteMs and StreamRewriteMs are only
		// known after the stream body is fully forwarded.
		if relayReq.Stream && plan != nil && len(plan.LogOutputs) > 0 {
			writer := service.LogCapture()
			if writer != nil {
				writer.UpdateStreamTimings(relayReq.RequestID, firstByteMs, resp.StreamRewriteTotalMs())
				if captured := resp.StreamCapturedBytes(); len(captured) > 0 {
					writer.UpdateStreamBody(relayReq.RequestID, captured)
				}
			}
		}

		// Log successful request
		useTime := int(time.Since(startTime).Milliseconds())
		logEntry := model.Log{
			UserID:            getString(userID),
			TokenName:         getString(tokenName),
			ProviderName:      provider.Name,
			ModelName:         relayReq.Model,
			Source:            service.ResolveSourceMark(relayReq.SourceMark, relayReq.Path),
			IsStream:          relayReq.Stream,
			Status:            "success",
			IP:                c.ClientIP(),
			RequestID:         c.GetString("request_id"),
			UseTime:           useTime,
			ConnectMs:         intPtr(resp.ConnectMs),
			FirstByteMs:       intPtr(firstByteMs),
			RequestRewriteMs:  intPtr(resp.RequestRewriteMs),
			ResponseRewriteMs: intPtr(resp.ResponseRewriteMs),
			StreamRewriteMs:   intPtr(resp.StreamRewriteTotalMs()),
			QueueWaitMs:       intPtr(resp.QueueWaitMs),
			UpstreamURL:       resp.UpstreamURL,
		}
		if resp.Usage != nil {
			logEntry.PromptTokens = resp.Usage.PromptTokens
			logEntry.CompletionTokens = resp.Usage.CompletionTokens
			logEntry.PromptCacheMissTokens = resp.Usage.CacheWriteTokens
			logEntry.PromptCacheHitTokens = resp.Usage.CacheReadTokens
			logEntry.Quota, logEntry.Currency = computeQuota(db, quotaRequest{
				provider:  provider,
				modelName: relayReq.Model,
				usage:     resp.Usage,
			})
			if logEntry.Currency == "" {
				logEntry.Currency = service.GetBillingCurrency(db)
			}
		}

		service.Logs().Write(&logEntry)

		if tokenID, ok := tokenIDRaw.(string); ok && tokenID != "" && resp.Usage != nil {
			tokens := int64(resp.Usage.PromptTokens + resp.Usage.CompletionTokens)
			if err := service.Quota().Charge(tokenID, tokens); err != nil {
				log.Printf("Failed to charge quota for token %s: %v", tokenID, err)
			}
		}

		outcome := "completed"
		if clientDisconnected {
			outcome = "client_disconnected"
		}
		if flowStarted {
			dashboardEventsHub.publish("request_finished", map[string]any{
				"model":      relayReq.Model,
				"provider":   provider.Name,
				"request_id": requestID,
			})
		}
		common.Global().EndRequest(relayReq.RequestID, relayReq.Model, true, int64(useTime),
			int64(logEntry.PromptTokens+logEntry.CompletionTokens), outcome)
	}
}

// isConcurrencyRejectionError is a retained helper for tests that want
// to assert the 429 path without going through the live engine.
func isConcurrencyRejectionError(err error) bool {
	return errors.Is(err, relay.ErrConcurrencyRejected)
}

// intPtr converts an int to a *int, mapping -1 (stage not applicable) to nil
// so the JSON row omits the field.
func intPtr(v int) *int {
	if v < 0 {
		return nil
	}
	return &v
}

// Reuses MergeLLMBody so both non-SSE JSON and SSE bodies yield usage.
func extractUsageInfo(body []byte, contentType string) *relay.UsageInfo {
	if len(body) == 0 {
		return nil
	}
	merged, err := service.MergeLLMBody(string(body), contentType)
	if err != nil {
		return nil
	}
	obj, ok := merged.(map[string]any)
	if !ok {
		return nil
	}
	raw, ok := obj["usage"]
	if !ok || raw == nil {
		return nil
	}
	usage, ok := raw.(map[string]any)
	if !ok {
		return nil
	}

	asInt := func(keys ...string) int {
		for _, k := range keys {
			switch v := usage[k].(type) {
			case float64:
				return int(v)
			case int:
				return v
			case int64:
				return int(v)
			case json.Number:
				if i, err := v.Int64(); err == nil {
					return int(i)
				}
			}
		}
		return 0
	}

	// OpenAI uses prompt_tokens/completion_tokens; Anthropic uses
	// input_tokens/output_tokens.
	prompt := asInt("prompt_tokens", "input_tokens")
	completion := asInt("completion_tokens", "output_tokens")
	cacheWrite := asInt("prompt_cache_miss_tokens", "cache_creation_input_tokens")
	cacheRead := asInt("prompt_cache_hit_tokens", "cache_read_input_tokens")
	if prompt == 0 && completion == 0 {
		return nil
	}
	return &relay.UsageInfo{
		PromptTokens:     prompt,
		CompletionTokens: completion,
		TotalTokens:      prompt + completion,
		CacheWriteTokens: cacheWrite,
		CacheReadTokens:  cacheRead,
	}
}

func handleNonStreamingResponse(c *gin.Context, resp *relay.RelayResponse) int {
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read response"})
		return -1
	}
	resp.Usage = extractUsageInfo(bodyBytes, resp.Headers["content-type"])
	c.Data(resp.StatusCode, "application/json", bodyBytes)
	return int(time.Since(resp.FirstByteAt).Milliseconds())
}

// handleStreamingResponse forwards the SSE body and returns the elapsed
// milliseconds from upstream headers until the first body byte (-1 when the
// stream produced no bytes, e.g. it errored immediately), plus whether the
// client disconnected before the stream finished.
func handleStreamingResponse(c *gin.Context, resp *relay.RelayResponse, requestID string) (int, bool) {
	defer resp.Body.Close()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return -1, false
	}

	firstByteMs := -1
	buf := make([]byte, 4096)
	var captured []byte
	var chunks int64
	var bytesReceived int64
	var lastProgressUpdate time.Time
	clientDisconnected := false
	for {
		if c.Request.Context().Err() != nil {
			clientDisconnected = true
			break
		}
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if firstByteMs < 0 {
				firstByteMs = int(time.Since(resp.FirstByteAt).Milliseconds())
			}
			if _, writeErr := c.Writer.Write(buf[:n]); writeErr != nil {
				clientDisconnected = true
				break
			}
			flusher.Flush()
			if c.Request.Context().Err() != nil {
				clientDisconnected = true
				break
			}
			captured = append(captured, buf[:n]...)
			chunks++
			bytesReceived += int64(n)
			if time.Since(lastProgressUpdate) >= 500*time.Millisecond {
				common.Global().UpdateActiveRequestProgress(requestID, "receiving_stream", chunks, bytesReceived)
				lastProgressUpdate = time.Now()
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			if c.Request.Context().Err() != nil || errors.Is(err, context.Canceled) {
				clientDisconnected = true
			}
			break
		}
	}
	resp.Usage = extractUsageInfo(captured, resp.Headers["content-type"])
	return firstByteMs, clientDisconnected
}

func logRelayError(c *gin.Context, userID, tokenName interface{}, modelName string, providerName string, err error, startTime time.Time, req *relay.RelayRequest, upstreamURL string) {
	useTime := int(time.Since(startTime).Milliseconds())
	service.Logs().Write(&model.Log{
		UserID:       getString(userID),
		TokenName:    getString(tokenName),
		ProviderName: providerName,
		ModelName:    modelName,
		Source:       service.ResolveSourceMark(req.SourceMark, req.Path),
		Status:       "failed",
		IP:           c.ClientIP(),
		RequestID:    c.GetString("request_id"),
		ErrorMessage: err.Error(),
		UseTime:      useTime,
		UpstreamURL:  upstreamURL,
	})
	outcome := "upstream_error"
	if errors.Is(err, relay.ErrConcurrencyRejected) {
		outcome = "queued_rejected"
	}
	if errors.Is(err, relay.ErrNoProvider) {
		outcome = "failed"
	}
	common.Global().EndRequest(c.GetString("request_id"), modelName, false, int64(useTime), 0, outcome)
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

// upstreamURLFromResp returns the upstream URL the relay attempted,
// or "" when the engine returned no response (e.g. parse/concurrency
// failures that never reached the upstream call).
func upstreamURLFromResp(resp *relay.RelayResponse) string {
	if resp == nil {
		return ""
	}
	return resp.UpstreamURL
}
