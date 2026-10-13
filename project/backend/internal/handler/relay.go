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
	"github.com/hapiy/hapiy/internal/i18n"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/publicFunction"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

// i18nMessage localizes the "no usable provider" relay error by the client
// language. When dispatch attached a classified reason (model unknown,
// endpoint unsupported by every provider of the model, or only
// auto-disabled providers left) the message says exactly that instead of
// the generic checklist. The message is returned verbatim to the caller
// (the dashboard or an external client) so it must match the active
// language.
func i18nMessage(r *http.Request, modelName string, err error) string {
	lang := i18n.Lang(r)
	var noProvider *relay.NoProviderError
	if errors.As(err, &noProvider) {
		switch noProvider.Reason {
		case relay.NoProviderReasonModelUnknown:
			return i18n.S(
				lang,
				fmt.Sprintf("无法为 %s 找到可用供应商：该模型未在任何已启用（开关打开）的供应商的模型列表中声明，请检查模型名（区分大小写）与供应商/工作流开关。", modelName),
				fmt.Sprintf("No usable provider found for %s: the model is not declared by any enabled provider. Check the model name (case-sensitive) and the provider/workflow switches.", modelName),
			)
		case relay.NoProviderReasonPathUnsupported:
			allowed := strings.Join(noProvider.AllowedPaths, ", ")
			if allowed == "" {
				allowed = "—"
			}
			return i18n.S(
				lang,
				fmt.Sprintf("无法为 %s 找到可用供应商：该模型不支持请求路径 %s（模型声明的 Endpoint：%s）。请在供应商页对应模型行补充该 Endpoint，或改用模型支持的路径。", modelName, noProvider.Path, allowed),
				fmt.Sprintf("No usable provider found for %s: the model does not support path %s (declared endpoints: %s). Add the endpoint on the model row in the provider page, or use a supported path.", modelName, noProvider.Path, allowed),
			)
		case relay.NoProviderReasonProviderDisabled:
			names := strings.Join(noProvider.DisabledProviders, ", ")
			if names == "" {
				names = "—"
			}
			return i18n.S(
				lang,
				fmt.Sprintf("无法为 %s 找到可用供应商：支持该请求路径的供应商（%s）已被自动禁用（故障转移中），且没有其他可用供应商。", modelName, names),
				fmt.Sprintf("No usable provider found for %s: the provider(s) supporting this path (%s) are auto-disabled (failover), and no other provider can serve it.", modelName, names),
			)
		}
	}
	return i18n.S(
		lang,
		fmt.Sprintf("无法为 %s 找到可用供应商，请检查：模型名（区分大小写）、Endpoints 白名单、供应商/工作流开关、故障转移状态、拓扑接线。", modelName),
		fmt.Sprintf("No usable provider found for %s. Check: model name (case-sensitive), endpoint limits, provider/workflow switches, failover status, and topology wiring.", modelName),
	)
}

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
				TokenName:     getString(tokenName),
				UserID:        getString(userID),
				RequestID:     c.GetString("request_id"),
				IP:            c.ClientIP(),
				DownstreamURL: service.RequestURL(c, service.SourceMark(c), c.Request.URL.Path),
				UseTimeMs:     useTime,
				Error:         err,
			})
			common.Global().EndRequest(c.GetString("request_id"), "", false, int64(useTime), 0, "invalid_request")
			c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body"})
			return
		}

		var relayReq relay.RelayRequest
		if err := json.Unmarshal(bodyBytes, &relayReq); err != nil {
			useTime := int(time.Since(startTime).Milliseconds())
			service.LogRelayFailure(service.LogRelayFailureInput{
				TokenName:     getString(tokenName),
				UserID:        getString(userID),
				RequestID:     c.GetString("request_id"),
				IP:            c.ClientIP(),
				DownstreamURL: service.RequestURL(c, service.SourceMark(c), c.Request.URL.Path),
				UseTimeMs:     useTime,
				Error:         err,
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
		relayReq.SourceMark = service.SourceMark(c)
		relayReq.DownstreamURL = service.RequestURL(c, relayReq.SourceMark, relayReq.Path)
		relayReq.UserID = getString(userID)
		relayReq.TokenName = getString(tokenName)
		relayReq.IP = c.ClientIP()
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
			logRelayError(c, userID, tokenName, relayReq.Model, "", err, startTime, &relayReq, "", "", "")
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": i18nMessage(c.Request, relayReq.Model, err),
					"type":    "service_unavailable",
				},
			})
			return
		}
		provider := dispatchResult.Provider
		relayReq.KeyIndex = dispatchResult.KeyIndex
		relayReq.BaseURLIndex = dispatchResult.BaseURLIndex
		relayReq.TopologyOrigin = dispatchResult.Origin
		relayReq.EntryID = dispatchResult.EntryID
		affinityReuse := dispatchResult.AffinityReuse
		if dispatchResult.AffinityNew && affinityReuse == "" {
			affinityReuse = "new"
		}
		// The dispatch-time recall only sees the incoming headers. Hand the
		// outcome to the pipeline: it re-runs the recall once the request
		// rewrite has run, and a session the rewrite changed there wins over
		// this one.
		relayReq.AffinityDispatchState = affinityReuse
		common.Global().TrackActiveRequest(common.ActiveRequest{
			RequestID:     relayReq.RequestID,
			Model:         relayReq.Model,
			TokenName:     getString(tokenName),
			UserID:        getString(userID),
			Provider:      provider.Name,
			ProviderID:    provider.ID,
			Source:        service.ResolveSourceMark(relayReq.SourceMark, relayReq.Path),
			Stream:        relayReq.Stream,
			StartTime:     startTime,
			Stage:         "queued",
			PathNodeIds:   dispatchResult.PathNodeIDs,
			AffinityReuse: affinityReuse,
		})

		// Endpoint whitelist: the model's own endpoint list wins when
		// declared; a model without one falls back to the provider-level
		// endpoints; both empty means unrestricted. Dispatch already
		// applies the same rule — this post-check mirrors it so a
		// mismatched path can never reach the upstream.
		allowed := relay.PathsForModel(provider, relayReq.Model)
		if len(allowed) > 0 {
			matched := false
			for _, p := range allowed {
				if relayReq.Path == p {
					matched = true
					break
				}
			}
			if !matched {
				err := fmt.Errorf("endpoint not allowed for model %s: %s (allowed: %s)", relayReq.Model, relayReq.Path, strings.Join(allowed, ", "))
				logRelayError(c, userID, tokenName, relayReq.Model, provider.Name, err, startTime, &relayReq, "", "", "")
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
		// Wrap the gin request context in one the 掐断 (kill) endpoint can
		// cancel, and register the cancel func under the request ID so a kill
		// reaches this exact in-flight request. Cancelling aborts the upstream
		// call, the concurrency-gate wait, and any streamed body read.
		killCtx, cancelRequest := context.WithCancel(c.Request.Context())
		common.Global().TrackCancel(requestID, cancelRequest)
		defer common.Global().ClearCancel(requestID)

		resp, err := engine.RelayRequest(killCtx, plan, &relayReq)
		if err != nil {
			if flowStarted {
				dashboardEventsHub.publish("request_finished", map[string]any{
					"model":      relayReq.Model,
					"provider":   provider.Name,
					"request_id": requestID,
				})
			}
			failKey, failBaseURL := channelFromResp(resp)
			// 转移后仍失败：失败行归到「实际尝试的供应商」（fallback 目标），
			// 而不是 dispatch 的初始供应商，使用记录才读得懂。
			errProviderName := provider.Name
			if relayReq.ServedProviderID != "" && relayReq.ServedProviderID != provider.ID {
				if p, err2 := engine.GetProvider(relayReq.ServedProviderID); err2 == nil && p != nil {
					errProviderName = p.Name
				}
			}
			logRelayError(c, userID, tokenName, relayReq.Model, errProviderName, err, startTime, &relayReq, upstreamURLFromResp(resp), failKey, failBaseURL)
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

		// The post-rewrite recall can override the dispatch-time affinity
		// outcome (the request rewrite changed the session it belongs to);
		// keep the live card in step with what the usage log will record.
		if relayReq.AffinityAfterRewrite {
			common.Global().UpdateActiveRequestAffinity(relayReq.RequestID, relayReq.AffinityReuse)
		}

		// Set response headers
		for k, v := range resp.Headers {
			c.Header(k, v)
		}

		// 记录中的供应商以「实际服务」为准：provider 维度转移后走的是
		// fallback 供应商，若还按 dispatch 的 provider 记，使用记录会
		// 把成功错记到失败方头上。
		recordProvider := provider
		if relayReq.ServedProviderID != "" && relayReq.ServedProviderID != provider.ID {
			if p, err := engine.GetProvider(relayReq.ServedProviderID); err == nil && p != nil {
				recordProvider = p
			}
		}

		affinityReuseParts := strings.Join(dispatchResult.AffinityReuseParts, ",")
		// The post-rewrite recall wins when the request rewrite changed the
		// session the request belongs to: it read the same snapshot the
		// history records, so its channel and state are the authoritative
		// ones. The usage log notes that the decision came after the rewrite.
		affinityAfterRewrite := false
		if relayReq.AffinityAfterRewrite {
			affinityReuse = relayReq.AffinityReuse
			affinityReuseParts = strings.Join(relayReq.AffinityReuseParts, ",")
			affinityAfterRewrite = true
		}

		// Forward the response first so use_time spans the full transfer for
		// streaming requests; the log row is written after the stream ends.
		firstByteMs := -1
		clientDisconnected := false
		if relayReq.Stream {
			common.Global().UpdateActiveRequestProgress(requestID, "waiting_upstream", 0, 0)
			firstByteMs, clientDisconnected = handleStreamingResponse(c, resp, requestID, db)
		} else {
			common.Global().UpdateActiveRequestProgress(requestID, "receiving", 0, 0)
			firstByteMs = handleNonStreamingResponse(c, resp, db)
			common.Global().UpdateActiveRequestFirstByte(requestID, int64(firstByteMs))
		}

		// Streaming response rewrites are applied event by event; their
		// per-rule outcomes are only known once the stream has been fully
		// forwarded, so collect them before the usage log is written.
		if relayReq.Stream {
			relayReq.RuleNotes = append(relayReq.RuleNotes, resp.StreamRewriteNotes()...)
		}

		// Backfill stream timings and rule notes on log capture rows when
		// the request has any log output configured. FirstByteMs and
		// StreamRewriteMs are only known after the stream body is fully
		// forwarded.
		if relayReq.Stream && plan != nil && len(plan.LogOutputs) > 0 {
			writer := service.LogCapture()
			if writer != nil {
				writer.UpdateStreamTimings(relayReq.RequestID, firstByteMs, resp.StreamRewriteTotalMs())
				writer.UpdateRuleNotes(relayReq.RequestID, service.RuleNotesOf(relayReq.RuleNotes, service.RuleCategoryResponse, service.RuleCategoryFailover))
				if captured := resp.StreamCapturedBytes(); len(captured) > 0 {
					writer.UpdateStreamBody(relayReq.RequestID, captured)
				}
			}
		}

		// Log successful request
		useTime := int(time.Since(startTime).Milliseconds())
		logEntry := model.Log{
			UserID:               getString(userID),
			TokenName:            getString(tokenName),
			ProviderName:         recordProvider.Name,
			ModelName:            relayReq.Model,
			Source:               service.ResolveSourceMark(relayReq.SourceMark, relayReq.Path),
			IsStream:             relayReq.Stream,
			Status:               "success",
			AffinityReuse:        affinityReuse,
			AffinityReuseParts:   affinityReuseParts,
			AffinityAfterRewrite: affinityAfterRewrite,
			IP:                   c.ClientIP(),
			RequestID:            c.GetString("request_id"),
			UseTime:              useTime,
			ConnectMs:            intPtr(resp.ConnectMs),
			FirstByteMs:          intPtr(firstByteMs),
			RequestRewriteMs:     intPtr(resp.RequestRewriteMs),
			ResponseRewriteMs:    intPtr(resp.ResponseRewriteMs),
			StreamRewriteMs:      intPtr(resp.StreamRewriteTotalMs()),
			QueueWaitMs:          intPtr(resp.QueueWaitMs),
			UpstreamURL:          resp.UpstreamURL,
			ProviderKey:          resp.ProviderKey,
			ProviderBaseURL:      resp.ProviderBaseURL,
			DownstreamURL:        relayReq.DownstreamURL,
		}
		if resp.Usage != nil {
			logEntry.PromptTokens = resp.Usage.PromptTokens
			logEntry.CompletionTokens = resp.Usage.CompletionTokens
			logEntry.PromptCacheMissTokens = resp.Usage.CacheWriteTokens
			logEntry.PromptCacheHitTokens = resp.Usage.CacheReadTokens
			logEntry.Quota, logEntry.Currency = computeQuota(db, quotaRequest{
				provider:  recordProvider,
				modelName: relayReq.Model,
				usage:     resp.Usage,
			})
			if logEntry.Currency == "" {
				logEntry.Currency = service.GetBillingCurrency(db)
			}
		}

		// Post-response speed condition: rules with a speed limit feed the
		// failover hit counters when the full-request speed (connect
		// included) falls below the limit. The finished response cannot be
		// re-routed, but the auto-disable protects future requests. Runs
		// before the log row is queued so the speed outcome lands in the
		// same row's rule notes.
		if totalTokens := logEntry.PromptTokens + logEntry.CompletionTokens; totalTokens > 0 && useTime > 0 {
			engine.RecordResponseSpeedOutcome(plan, &relayReq, useTime, totalTokens)
		}

		// 规则命中情况（请求改写/响应改写/故障转移 + 命中未生效原因）写在
		// 使用记录详情的最后。
		logEntry.EventDetail = service.RuleNotesText(relayReq.RuleNotes)
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
		if common.Global().WasKilled(requestID) {
			outcome = "killed"
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

// tokenUsageFieldsSettingKey is the settings key holding the per-field gjson
// path lists used to read token usage from upstream response bodies.
const tokenUsageFieldsSettingKey = "token_usage_fields"

func loadTokenUsageFields(db *gorm.DB) publicfunction.TokenUsageFields {
	if db == nil {
		return publicfunction.DefaultTokenUsageFields()
	}
	var setting model.Setting
	if err := db.Where("key = ?", tokenUsageFieldsSettingKey).First(&setting).Error; err != nil {
		return publicfunction.DefaultTokenUsageFields()
	}
	return publicfunction.ParseTokenUsageFields(setting.Value)
}

// Reuses MergeLLMBody so both non-SSE JSON and SSE bodies yield usage, then
// reads the token counters through the shared publicfunction extractor with
// the configured gjson paths.
func extractUsageInfo(db *gorm.DB, body []byte, contentType string) *relay.UsageInfo {
	if len(body) == 0 {
		return nil
	}
	merged, err := service.MergeLLMBody(string(body), contentType)
	if err != nil {
		return nil
	}
	mergedBytes, err := json.Marshal(merged)
	if err != nil {
		return nil
	}
	u := publicfunction.ExtractTokenUsage(mergedBytes, loadTokenUsageFields(db))
	if u.PromptTokens == 0 && u.CompletionTokens == 0 {
		return nil
	}
	return &relay.UsageInfo{
		PromptTokens:     int(u.PromptTokens),
		CompletionTokens: int(u.CompletionTokens),
		TotalTokens:      int(u.PromptTokens + u.CompletionTokens),
		CacheWriteTokens: int(u.CacheWriteTokens),
		CacheReadTokens:  int(u.CacheReadTokens),
	}
}

func handleNonStreamingResponse(c *gin.Context, resp *relay.RelayResponse, db *gorm.DB) int {
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read response"})
		return -1
	}
	resp.Usage = extractUsageInfo(db, bodyBytes, resp.Headers["content-type"])
	c.Data(resp.StatusCode, "application/json", bodyBytes)
	return int(time.Since(resp.FirstByteAt).Milliseconds())
}

// handleStreamingResponse forwards the SSE body and returns the elapsed
// milliseconds from upstream headers until the first body byte (-1 when the
// stream produced no bytes, e.g. it errored immediately), plus whether the
// client disconnected before the stream finished.
func handleStreamingResponse(c *gin.Context, resp *relay.RelayResponse, requestID string, db *gorm.DB) (int, bool) {
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
				common.Global().UpdateActiveRequestFirstByte(requestID, int64(firstByteMs))
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
	resp.Usage = extractUsageInfo(db, captured, resp.Headers["content-type"])
	return firstByteMs, clientDisconnected
}

func logRelayError(c *gin.Context, userID, tokenName interface{}, modelName string, providerName string, err error, startTime time.Time, req *relay.RelayRequest, upstreamURL, providerKey, providerBaseURL string) {
	useTime := int(time.Since(startTime).Milliseconds())
	ruleNotes := ""
	if req != nil {
		ruleNotes = service.RuleNotesText(req.RuleNotes)
	}
	service.Logs().Write(&model.Log{
		UserID:          getString(userID),
		TokenName:       getString(tokenName),
		ProviderName:    providerName,
		ModelName:       modelName,
		Source:          service.ResolveSourceMark(req.SourceMark, req.Path),
		Status:          "failed",
		IP:              c.ClientIP(),
		RequestID:       c.GetString("request_id"),
		ErrorMessage:    err.Error(),
		EventDetail:     ruleNotes,
		UseTime:         useTime,
		UpstreamURL:     upstreamURL,
		ProviderKey:     providerKey,
		ProviderBaseURL: providerBaseURL,
		DownstreamURL:   req.DownstreamURL,
	})
	outcome := "upstream_error"
	if errors.Is(err, relay.ErrConcurrencyRejected) {
		outcome = "queued_rejected"
	}
	if errors.Is(err, relay.ErrNoProvider) {
		outcome = "failed"
	}
	if common.Global().WasKilled(c.GetString("request_id")) {
		outcome = "killed"
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

// channelFromResp returns the provider key and base URL the relay actually
// used, or empty strings when the engine never reached the upstream call.
func channelFromResp(resp *relay.RelayResponse) (key, baseURL string) {
	if resp == nil {
		return "", ""
	}
	return resp.ProviderKey, resp.ProviderBaseURL
}
