package config

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	Env          string
	Host         string
	Port         string
	DatabasePath string
	JWTSecret    string
	LogDir       string
	// WebDistDir is the directory containing the built frontend (index.html +
	// assets). Empty means the backend serves API-only (dev mode). When set,
	// the backend also serves static files with SPA fallback.
	WebDistDir string
}

func Load() *Config {
	return &Config{
		Env:          getEnv("HAPIY_ENV", "development"),
		Host:         getEnv("HAPIY_HOST", "0.0.0.0"),
		Port:         getEnv("HAPIY_PORT", "8080"),
		DatabasePath: getEnv("HAPIY_DB_PATH", "./hapiy.db"),
		JWTSecret:    getEnv("HAPIY_JWT_SECRET", "change-me-in-production"),
		LogDir:       getEnv("HAPIY_LOG_DIR", "./logs"),
		WebDistDir:   getEnv("HAPIY_WEB_DIST", ""),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// EncryptionKeyPath returns the on-disk key file location, next to the
// SQLite database so a deployment carries both together.
func EncryptionKeyPath(cfg *Config) string {
	return filepath.Join(filepath.Dir(cfg.DatabasePath), "encryption.key")
}

// LoadEncryptionKey returns the 32-byte AES-GCM key used to encrypt SSH
// credentials at rest for the 接管配置文件 feature. Resolution order:
//  1. HAPIY_ENCRYPTION_KEY env var (hex or base64 of 32 bytes).
//  2. The encryption.key file next to the database (created on first run).
//  3. Otherwise a random key is generated and persisted to that file with
//     0600 permissions, so the key survives restarts.
func LoadEncryptionKey(cfg *Config) ([]byte, error) {
	if env := os.Getenv("HAPIY_ENCRYPTION_KEY"); env != "" {
		if key, err := hex.DecodeString(env); err == nil && len(key) == 32 {
			return key, nil
		}
		if key, err := base64.StdEncoding.DecodeString(env); err == nil && len(key) == 32 {
			return key, nil
		}
		return nil, fmt.Errorf("HAPIY_ENCRYPTION_KEY 必须是 32 字节的 hex 或 base64 编码")
	}
	path := EncryptionKeyPath(cfg)
	if data, err := os.ReadFile(path); err == nil {
		if len(data) != 32 {
			return nil, fmt.Errorf("加密密钥文件 %s 长度无效（应为 32 字节）", path)
		}
		return data, nil
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("生成加密密钥失败: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("创建密钥目录失败: %w", err)
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, fmt.Errorf("写入加密密钥文件失败: %w", err)
	}
	return key, nil
}
