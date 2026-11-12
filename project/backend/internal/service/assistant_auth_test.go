package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newGinContext(t *testing.T) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/proxy/__内置助手/chat/completions", nil)
	c.Request.RemoteAddr = "127.0.0.1:12345"
	return c
}

func TestVerifyInternalRelayAuthAcceptsAndStripsHeaders(t *testing.T) {
	c := newGinContext(t)
	ApplyInternalRelayAuth(c.Request, "alice")

	user, ok := VerifyInternalRelayAuth(c)
	if !ok || user != "alice" {
		t.Fatalf("verify = %q, %v; want alice, true", user, ok)
	}
	if got := c.Request.Header.Get(internalRelayHeader); got != "" {
		t.Fatalf("secret header must be stripped, got %q", got)
	}
	if got := c.Request.Header.Get(internalRelayUserHeader); got != "" {
		t.Fatalf("user header must be stripped, got %q", got)
	}
}

func TestVerifyInternalRelayAuthRejectsMissingOrWrongSecret(t *testing.T) {
	c := newGinContext(t)
	if _, ok := VerifyInternalRelayAuth(c); ok {
		t.Fatal("missing secret must not authenticate")
	}

	c = newGinContext(t)
	ApplyInternalRelayAuth(c.Request, "alice")
	c.Request.Header.Set(internalRelayHeader, "not-the-secret")
	if _, ok := VerifyInternalRelayAuth(c); ok {
		t.Fatal("wrong secret must not authenticate")
	}
	// Even a rejected header must not travel on to the relay.
	if got := c.Request.Header.Get(internalRelayHeader); got != "" {
		t.Fatalf("rejected secret header must be stripped, got %q", got)
	}
}

func TestVerifyInternalRelayAuthRejectsRemoteSource(t *testing.T) {
	c := newGinContext(t)
	ApplyInternalRelayAuth(c.Request, "alice")
	c.Request.RemoteAddr = "203.0.113.9:12345"

	if _, ok := VerifyInternalRelayAuth(c); ok {
		t.Fatal("the internal secret must not authenticate a non-local connection")
	}
}

func TestRetireLegacyAssistantToken(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Token{}); err != nil {
		t.Fatal(err)
	}
	legacy := model.Token{Name: InternalAssistantName, Key: "hk-legacy", Status: true}
	other := model.Token{Name: "外部应用", Key: "hk-other", Status: true}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}

	if err := RetireLegacyAssistantToken(db); err != nil {
		t.Fatal(err)
	}

	var tokens []model.Token
	if err := db.Find(&tokens).Error; err != nil {
		t.Fatal(err)
	}
	if len(tokens) != 1 || tokens[0].Name != "外部应用" {
		t.Fatalf("remaining tokens = %+v, want only 外部应用", tokens)
	}

	// Idempotent: a second startup must not fail.
	if err := RetireLegacyAssistantToken(db); err != nil {
		t.Fatal(err)
	}
}
