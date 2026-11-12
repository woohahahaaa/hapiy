package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newTokenAuthTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Token{}); err != nil {
		t.Fatal(err)
	}
	return db
}

// The console assistant must reach the relay without a token row: its turn
// would otherwise expose a copyable key in the token list and break when the
// user disables or deletes that row.
func TestTokenAuthAcceptsInternalAssistantCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(TokenAuth(newTokenAuthTestDB(t)))
	r.POST("/proxy/__内置助手/chat/completions", func(c *gin.Context) {
		if got := c.GetString("token_name"); got != service.InternalAssistantName {
			t.Errorf("token_name = %q, want %q", got, service.InternalAssistantName)
		}
		if got := c.GetString("user_id"); got != "alice" {
			t.Errorf("user_id = %q, want alice", got)
		}
		if _, exists := c.Get("token_id"); exists {
			t.Error("internal call must not carry a token id (no quota to charge)")
		}
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/proxy/__内置助手/chat/completions", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	service.ApplyInternalRelayAuth(req, "alice")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

func TestTokenAuthRejectsUnmarkedAssistantCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(TokenAuth(newTokenAuthTestDB(t)))
	r.POST("/proxy/__内置助手/chat/completions", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/proxy/__内置助手/chat/completions", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
