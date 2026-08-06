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
}

func Load() *Config {
	return &Config{
		Env:          getEnv("HAPIY_ENV", "development"),
		Host:         getEnv("HAPIY_HOST", "0.0.0.0"),
		Port:         getEnv("HAPIY_PORT", "8080"),
		DatabasePath: getEnv("HAPIY_DB_PATH", "./hapiy.db"),
		JWTSecret:    getEnv("HAPIY_JWT_SECRET", "change-me-in-production"),
		LogDir:       getEnv("HAPIY_LOG_DIR", "./logs"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
