package middleware

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

// CORS middleware
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		} else {
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		}
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

// RequestID middleware
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}
		c.Set("request_id", requestID)
		c.Writer.Header().Set("X-Request-ID", requestID)
		c.Next()
	}
}

func AuthRequired(db *gorm.DB, sessions *SessionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		if sessions == nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "session store not initialised"})
			return
		}
		cookie, err := c.Cookie(sessionCookieName)
		if err != nil || cookie == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
			return
		}
		username, ok := sessions.Lookup(cookie)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session expired"})
			return
		}
		c.Set("user_id", username)
		c.Next()
	}
}

const sessionCookieName = "hapiy_admin_session"

// SessionStore keeps the dashboard login tokens. When path is set the tokens
// are also written to disk, so a backend restart (a self-upgrade, `hapiy up`,
// a crashed supervisor) does not silently log every open dashboard out.
type SessionStore struct {
	mu     sync.RWMutex
	tokens map[string]string
	path   string
}

func NewSessionStore() *SessionStore {
	return &SessionStore{tokens: make(map[string]string)}
}

// NewSessionStoreAt is NewSessionStore plus persistence: tokens already in
// path are loaded, and every issue/revoke rewrites the file. A missing file
// starts empty; an unreadable or malformed one is logged and ignored so a
// damaged state file cannot lock the user out of the dashboard.
func NewSessionStoreAt(path string) *SessionStore {
	s := NewSessionStore()
	s.path = path
	s.load()
	return s
}

func (s *SessionStore) load() {
	if s.path == "" {
		return
	}
	raw, err := os.ReadFile(s.path) // #nosec G304 -- fixed path under the state dir
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("sessions: read %s: %v", s.path, err)
		}
		return
	}
	var tokens map[string]string
	if err := json.Unmarshal(raw, &tokens); err != nil {
		log.Printf("sessions: parse %s: %v", s.path, err)
		return
	}
	if len(tokens) > 0 {
		s.tokens = tokens
	}
}

func (s *SessionStore) Issue(username string) string {
	token := uuid.New().String()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tokens[token] = username
	s.persistLocked()
	return token
}

func (s *SessionStore) Lookup(token string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	username, ok := s.tokens[token]
	return username, ok
}

func (s *SessionStore) Revoke(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tokens, token)
	s.persistLocked()
}

// persistLocked rewrites the token file atomically (temp + rename). The file
// is 0600: a session token is as sensitive as the password that issued it.
func (s *SessionStore) persistLocked() {
	if s.path == "" {
		return
	}
	raw, err := json.Marshal(s.tokens)
	if err != nil {
		log.Printf("sessions: encode %s: %v", s.path, err)
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		log.Printf("sessions: write %s: %v", tmp, err)
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		log.Printf("sessions: replace %s: %v", s.path, err)
	}
}

// TokenAuth middleware (API token authentication)
func TokenAuth(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// The console assistant authenticates with the per-process secret
		// described in service.ApplyInternalRelayAuth, not with a token row:
		// there is no key for a user to read, copy, rotate or delete, and no
		// quota to charge. Verified before the header parsing below because
		// this call carries no Authorization header at all.
		if user, ok := service.VerifyInternalRelayAuth(c); ok {
			c.Set("token_name", service.InternalAssistantName)
			c.Set("user_id", user)
			c.Next()
			return
		}

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			rejectTokenAuth(c, http.StatusUnauthorized, gin.H{"error": "missing authorization header"}, "", "", errors.New("missing authorization header"))
			return
		}

		// Parse Bearer token
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			rejectTokenAuth(c, http.StatusUnauthorized, gin.H{"error": "invalid authorization format"}, "", "", errors.New("invalid authorization format"))
			return
		}

		tokenKey := parts[1]

		// Validate token
		var token model.Token
		if err := db.Where("key = ? AND status = ?", tokenKey, true).First(&token).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				rejectTokenAuth(c, http.StatusUnauthorized, gin.H{"error": "invalid token"}, "", "", err)
			} else {
				rejectTokenAuth(c, http.StatusInternalServerError, gin.H{"error": "internal error"}, "", "", err)
			}
			return
		}

		// Check quota
		if token.Quota != nil && token.UsedQuota >= *token.Quota {
			rejectTokenAuth(c, http.StatusForbidden, gin.H{"error": "quota exceeded"}, token.UserID, token.Name, errors.New("quota exceeded"))
			return
		}

		// Set context
		c.Set("token_id", token.ID)
		c.Set("token_name", token.Name)
		c.Set("user_id", token.UserID)

		c.Next()
	}
}

// rejectTokenAuth writes the HTTP response, records a "failed" log row,
// and aborts the chain. ModelName is best-effort and may be empty when
// the request body is unreadable. Centralised so every token rejection
// is logged the same way regardless of which branch fired.
func rejectTokenAuth(c *gin.Context, status int, body gin.H, userID, tokenName string, err error) {
	service.LogRelayFailure(service.LogRelayFailureInput{
		UserID:        userID,
		TokenName:     tokenName,
		ModelName:     service.ExtractModelFromRequestBody(c),
		RequestID:     c.GetString("request_id"),
		IP:            c.ClientIP(),
		DownstreamURL: service.RequestURL(c, service.SourceMark(c), c.Request.URL.Path),
		Error:         err,
	})
	c.JSON(status, body)
	c.Abort()
}
