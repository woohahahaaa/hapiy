package main

import (
	"log"
	"os"

	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/config"
	"github.com/hapiy/hapiy/internal/handler"
	"github.com/hapiy/hapiy/internal/middleware"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Set Gin mode
	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Initialize database
	db, err := model.InitDB(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Auto-migrate models
	if err := model.AutoMigrate(db); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Create default admin user
	if err := handler.CreateDefaultAdmin(db); err != nil {
		log.Printf("Warning: Failed to create default admin: %v", err)
	}

	// Initialize relay engine (loads channels and compiles execution plans)
	engine := relay.NewEngine(db)
	if err := engine.LoadChannels(); err != nil {
		log.Printf("Warning: Failed to load channels: %v", err)
	}

	// Start background sync for channel config changes
	go engine.SyncLoop()
	defer engine.Stop()

	// Initialize batched log writer (flushes every 5s)
	service.InitLogWriter(db)
	defer service.Logs().Stop()

	// Create Gin router
	r := gin.Default()

	// Middleware
	r.Use(middleware.CORS())
	r.Use(middleware.RequestID())
	r.Use(func(c *gin.Context) {
		c.Set("db", db)
		c.Next()
	})

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Metrics endpoint (no auth required for monitoring)
	r.GET("/metrics", func(c *gin.Context) {
		c.JSON(200, common.Global().Snapshot())
	})

	// API v1 routes
	v1 := r.Group("/v1")
	{
		// Overload protection on all relay endpoints
		v1.Use(middleware.OverloadProtection(nil))
		// Dashboard API (requires auth in production)
		dashboard := v1.Group("/dashboard")
		dashboard.Use(middleware.AuthRequired(db))
		{
			// Channels
			dashboard.GET("/channels", handler.ListChannels(db))
			dashboard.POST("/channels", handler.CreateChannel(db, engine))
			dashboard.GET("/channels/:id", handler.GetChannel(db))
			dashboard.PUT("/channels/:id", handler.UpdateChannel(db, engine))
			dashboard.DELETE("/channels/:id", handler.DeleteChannel(db, engine))
			dashboard.POST("/channels/:id/toggle", handler.ToggleChannel(db, engine))

			// Tokens
			dashboard.GET("/tokens", handler.ListTokens(db))
			dashboard.POST("/tokens", handler.CreateToken(db))
			dashboard.GET("/tokens/:id", handler.GetToken(db))
			dashboard.PUT("/tokens/:id", handler.UpdateToken(db))
			dashboard.DELETE("/tokens/:id", handler.DeleteToken(db))
			dashboard.POST("/tokens/:id/toggle", handler.ToggleToken(db))
			dashboard.POST("/tokens/:id/rotate", handler.RotateTokenKey(db))

			// Logs
			dashboard.GET("/logs", handler.ListLogs(db))
			dashboard.GET("/logs/stats", handler.GetLogStats(db))

			// Users
			dashboard.GET("/users/me", handler.GetCurrentUser(db))
			dashboard.POST("/users/login", handler.Login(db))
			dashboard.POST("/users/logout", handler.Logout(db))

			// Rules (rewrite, heartbeat, concurrency, failover)
			dashboard.GET("/rules/:type", handler.ListRules(db))
			dashboard.POST("/rules/:type", handler.CreateRule(db))
			dashboard.PUT("/rules/:type/:id", handler.UpdateRule(db))
			dashboard.DELETE("/rules/:type/:id", handler.DeleteRule(db))

			// Runtime metrics (dashboard-authenticated)
			dashboard.GET("/runtime/metrics", handler.RuntimeMetrics(db))
		}

		// Relay endpoints (token auth)
		relayGroup := v1.Group("")
		relayGroup.Use(middleware.TokenAuth(db))
		{
			// OpenAI-compatible endpoints
			relayGroup.POST("/chat/completions", handler.Relay(engine))
			relayGroup.POST("/completions", handler.Relay(engine))
			relayGroup.POST("/embeddings", handler.Relay(engine))
			relayGroup.POST("/images/generations", handler.Relay(engine))
			relayGroup.POST("/audio/speech", handler.Relay(engine))
			relayGroup.POST("/audio/transcriptions", handler.Relay(engine))
		}
	}

	// Start server
	addr := cfg.Host + ":" + cfg.Port
	log.Printf("Server starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
		os.Exit(1)
	}
}
