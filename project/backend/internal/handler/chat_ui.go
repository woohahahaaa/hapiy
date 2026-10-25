package handler

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// chatUIResultTimeout bounds how long a tool waits for the console to finish
// the user-path operation it asked for. The browser is normally attached, so
// this only fires when the tab is closed mid-turn.
const chatUIResultTimeout = 90 * time.Second

// chatUIActionResult is what the console reports back after it has performed
// an action through the normal UI path (open dialog, fill, save/confirm).
type chatUIActionResult struct {
	OK      bool           `json:"ok"`
	Message string         `json:"message,omitempty"`
	Data    map[string]any `json:"data,omitempty"`
}

type chatUIActionWaiter struct {
	user string
	ch   chan chatUIActionResult
}

// chatUIActionWaiters holds the in-flight console actions. The chat handler
// registers a waiter before publishing the action and blocks until the console
// reports the outcome (or the timeout fires).
var chatUIActionWaiters sync.Map

// awaitChatUIAction blocks until the console reports the action result.
func awaitChatUIAction(ctx context.Context, user, id string) (chatUIActionResult, error) {
	waiter := &chatUIActionWaiter{user: user, ch: make(chan chatUIActionResult, 1)}
	chatUIActionWaiters.Store(id, waiter)
	defer chatUIActionWaiters.Delete(id)

	timer := time.NewTimer(chatUIResultTimeout)
	defer timer.Stop()
	select {
	case result := <-waiter.ch:
		return result, nil
	case <-timer.C:
		return chatUIActionResult{}, errors.New("控制台没有在 " + chatUIResultTimeout.String() + " 内确认操作结果")
	case <-ctx.Done():
		return chatUIActionResult{}, ctx.Err()
	}
}

// CompleteChatUIAction receives the console's report for one action:
// POST /v1/dashboard/chat/ui-actions/:id/result.
func CompleteChatUIAction() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		user := chatUser(c)
		var body chatUIActionResult
		if err := c.ShouldBindJSON(&body); err != nil {
			respondError(c, http.StatusBadRequest, "REQUEST_BODY_INVALID", "请求体格式错误")
			return
		}
		raw, ok := chatUIActionWaiters.Load(id)
		if !ok {
			respondError(c, http.StatusNotFound, "CHAT_UI_ACTION_NOT_FOUND", "操作已结束或不存在")
			return
		}
		waiter, ok := raw.(*chatUIActionWaiter)
		if !ok || waiter.user != user {
			respondError(c, http.StatusForbidden, "CHAT_UI_ACTION_FORBIDDEN", "无权确认该操作")
			return
		}
		select {
		case waiter.ch <- body:
		default:
			// Already answered; a duplicate report is harmless.
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"received": true}})
	}
}
