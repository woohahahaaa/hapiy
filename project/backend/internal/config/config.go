package config

import (
	"os"
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
