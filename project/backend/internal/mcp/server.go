// Package mcp exposes hapiy's gateway data over the Model Context Protocol.
//
// The endpoint is mounted at /mcp (Streamable HTTP, stateless JSON responses).
// It stays closed until the operator turns it on in 设置 → 其他 → MCP; every
// request must then carry the generated key as `Authorization: Bearer ...`.
// Tools are read-only: agents can inspect providers, models, usage, request
// logs, the forwarding topology and the managed agent configs, but nothing in
// this package writes to the database or the relay engine.
package mcp

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
)

const (
	// SettingEnabled gates the endpoint. Anything but "true" makes /mcp
	// answer 404, so a disabled endpoint is indistinguishable from a missing
	// route.
	SettingEnabled = "mcp_enabled"
	// SettingAPIKey holds the Bearer key every request must present.
	SettingAPIKey = "mcp_api_key"
	// EndpointPath is where Handler is meant to be mounted.
	EndpointPath = "/mcp"
)

// ServerInstructions are handed to clients during initialize. They describe
// the gateway and, more importantly, tell the agent that nothing here mutates
// configuration.
const ServerInstructions = `hapiy 是自托管 AI 网关。这里的工具只能读取网关数据：供应商、可用模型、用量统计、请求日志、转发拓扑、被托管的 Agent 配置文件。不会修改任何配置；需要改配置时提示用户到 hapiy 控制台操作。时间参数一律使用 RFC3339。`

// NewServer builds the MCP server with every tool registered.
func NewServer(db *gorm.DB, version string) *mcp.Server {
	s := mcp.NewServer(
		&mcp.Implementation{Name: "hapiy", Version: version},
		&mcp.ServerOptions{Instructions: ServerInstructions},
	)
	registerTools(s, db)
	return s
}

// Handler returns the gin handler for EndpointPath. A single server instance
// is shared by all requests (the transport is stateless, so every request
// carries its own session data).
func Handler(db *gorm.DB, version string) gin.HandlerFunc {
	srv := NewServer(db, version)
	stream := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return srv },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true},
	)
	return func(c *gin.Context) {
		if !Enabled(db) {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "mcp endpoint is disabled"})
			return
		}
		ok, err := Authorized(c.Request, db)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if !ok {
			c.Header("WWW-Authenticate", `Bearer realm="hapiy-mcp"`)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid MCP key"})
			return
		}
		stream.ServeHTTP(c.Writer, c.Request)
	}
}

// Enabled reports whether the endpoint is switched on. A settings read
// failure counts as disabled so a broken database never exposes the tools.
func Enabled(db *gorm.DB) bool {
	value, err := service.GetSetting(db, SettingEnabled)
	return err == nil && strings.TrimSpace(value) == "true"
}

// Authorized validates the request's Bearer key against the stored MCP key.
// An empty stored key denies everything.
func Authorized(r *http.Request, db *gorm.DB) (bool, error) {
	want, err := ServiceKey(db)
	if err != nil {
		return false, err
	}
	if want == "" {
		return false, nil
	}
	got, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		return false, nil
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1, nil
}

// ServiceKey returns the configured MCP key ("" when unset).
func ServiceKey(db *gorm.DB) (string, error) {
	value, err := service.GetSetting(db, SettingAPIKey)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func bearerToken(header string) (string, bool) {
	const prefix = "bearer "
	if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return "", false
	}
	token := strings.TrimSpace(header[len(prefix):])
	return token, token != ""
}

// Status is the payload the settings page reads and writes.
type Status struct {
	Enabled bool   `json:"enabled"`
	APIKey  string `json:"api_key"`
}

// ReadStatus returns the current switch state and key.
func ReadStatus(db *gorm.DB) (Status, error) {
	key, err := ServiceKey(db)
	if err != nil {
		return Status{}, err
	}
	return Status{Enabled: Enabled(db), APIKey: key}, nil
}

// UpdateStatus enables or disables the endpoint. Turning it on without a key
// generates one so the caller can copy it straight away.
func UpdateStatus(db *gorm.DB, enabled bool) (Status, error) {
	key, err := ServiceKey(db)
	if err != nil {
		return Status{}, err
	}
	if enabled && key == "" {
		if key, err = GenerateKey(); err != nil {
			return Status{}, err
		}
		if err := saveSetting(db, SettingAPIKey, key); err != nil {
			return Status{}, err
		}
	}
	if err := saveSetting(db, SettingEnabled, boolString(enabled)); err != nil {
		return Status{}, err
	}
	return Status{Enabled: enabled, APIKey: key}, nil
}

// RotateKey replaces the key and returns the new one. Rotating also switches
// the endpoint on: the only reason to rotate is to hand out a fresh key.
func RotateKey(db *gorm.DB) (Status, error) {
	key, err := GenerateKey()
	if err != nil {
		return Status{}, err
	}
	if err := saveSetting(db, SettingAPIKey, key); err != nil {
		return Status{}, err
	}
	if err := saveSetting(db, SettingEnabled, "true"); err != nil {
		return Status{}, err
	}
	return Status{Enabled: true, APIKey: key}, nil
}

// GenerateKey returns a new random MCP key. The "hm-" prefix mirrors the "hk-"
// prefix of relay tokens so a leaked key is recognizable in logs.
func GenerateKey() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "hm-" + hex.EncodeToString(buf), nil
}

func saveSetting(db *gorm.DB, key, value string) error {
	row := model.Setting{Key: key}
	return db.Where("key = ?", key).Assign(model.Setting{Value: value}).FirstOrCreate(&row).Error
}

func boolString(v bool) string {
	if v {
		return "true"
	}
	return "false"
}
