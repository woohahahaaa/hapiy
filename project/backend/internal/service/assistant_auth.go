package service

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// The console assistant posts every turn back to the relay over loopback so
// the request shares dispatch, rewrites, failover and the usage log with
// external apps. It must not hold a user-managed downstream token, though: a
// token row shows up in the token list, where a user can read its key, reuse
// it from another machine, rotate it, disable it or delete it and silently
// break the assistant.
//
// Instead, one random secret is generated per process and kept in memory. The
// console stamps it on each loopback call; TokenAuth accepts that call only
// when the secret matches and removes the headers before the relay can copy
// them upstream or into a captured log. Nothing is persisted, so there is no
// key to show, copy or tamper with.
const (
	internalRelayHeader     = "X-Hapiy-Internal-Call"
	internalRelayUserHeader = "X-Hapiy-Internal-User"
	// InternalAssistantName labels assistant traffic in the usage log and
	// live-request panel. It is not a row in the token table.
	InternalAssistantName = "内置助手"
)

var internalRelaySecret = newInternalRelaySecret()

func newInternalRelaySecret() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		log.Fatalf("generate internal relay secret: %v", err)
	}
	return hex.EncodeToString(buf)
}

// ApplyInternalRelayAuth stamps an in-process console call with the
// per-process secret. user attributes the turn to the dashboard account.
func ApplyInternalRelayAuth(req *http.Request, user string) {
	req.Header.Set(internalRelayHeader, internalRelaySecret)
	req.Header.Set(internalRelayUserHeader, strings.TrimSpace(user))
}

// VerifyInternalRelayAuth reports whether the request is the console's own
// loopback call and returns the dashboard user it belongs to. The headers are
// removed on every path so a client cannot forward them to an upstream. A
// matching secret is only accepted from an address assigned to this machine,
// so the value is useless if it ever leaves the box.
func VerifyInternalRelayAuth(c *gin.Context) (string, bool) {
	provided := c.GetHeader(internalRelayHeader)
	user := strings.TrimSpace(c.GetHeader(internalRelayUserHeader))
	c.Request.Header.Del(internalRelayHeader)
	c.Request.Header.Del(internalRelayUserHeader)
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(internalRelaySecret)) != 1 {
		return "", false
	}
	if !requestCameFromThisMachine(c.Request) {
		return "", false
	}
	return user, true
}

// requestCameFromThisMachine reports whether the connection's source address
// is loopback or one of the host's own interface addresses. cfg.Host can bind
// a specific LAN address, in which case the internal call's source is that
// address rather than 127.0.0.1.
func requestCameFromThisMachine(req *http.Request) bool {
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && ipnet.IP.Equal(ip) {
			return true
		}
	}
	return false
}

// RetireLegacyAssistantToken removes the token row older builds created for
// the console assistant. The assistant now authenticates with the in-memory
// secret above, so a persisted row would only expose a usable key.
func RetireLegacyAssistantToken(db *gorm.DB) error {
	result := db.Where("name = ?", InternalAssistantName).Delete(&model.Token{})
	if result.Error != nil {
		return fmt.Errorf("remove legacy built-in assistant token: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		log.Printf("removed %d legacy built-in assistant token(s)", result.RowsAffected)
	}
	return nil
}
