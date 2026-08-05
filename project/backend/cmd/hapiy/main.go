package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/config"
	"github.com/hapiy/hapiy/internal/handler"
	"github.com/hapiy/hapiy/internal/middleware"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
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

	if err := model.MigrateTopologySchema(db); err != nil {
		log.Fatalf("Failed to migrate legacy topology schema: %v", err)
	}

	creds, err := handler.CreateDefaultAdmin(db)
	if err != nil {
		log.Printf("Warning: Failed to create default admin: %v", err)
	} else if creds.Username != "" {
		log.Printf("================================================================")
		log.Printf("Default admin created: username=%q password=%q", creds.Username, creds.Password)
		log.Printf("Save this password now — it will not be logged again.")
		log.Printf("================================================================")
	}

	// Initialize relay engine (loads providers and compiles execution plans)
	engine := relay.NewEngine(db)
	if err := engine.LoadProviders(); err != nil {
		log.Printf("Warning: Failed to load providers: %v", err)
	}

	// Start background sync for provider config changes
	go engine.SyncLoop()
	defer engine.Stop()

	// Initialize batched log writer (flushes every 5s)
	service.InitLogWriter(db)
	defer service.Logs().Stop()

	service.InitQuotaLedger(db)

	// Topology auto-archive: startup compensation + 5-minute stable-window.
	stopTopologyArchive := handler.StartTopologyVersionAutoArchive(db)
	defer stopTopologyArchive()

	// Create Gin router
	r := gin.Default()

	sessions := middleware.NewSessionStore()

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
		dashboard := v1.Group("/dashboard")
		dashboard.POST("/users/login", handler.Login(db, sessions))
		dashboard.POST("/users/logout", handler.Logout(db, sessions))
		dashboardAuthed := dashboard.Group("")
		dashboardAuthed.Use(middleware.AuthRequired(db, sessions))
		{
			// Providers
			dashboardAuthed.GET("/providers", handler.ListProviders(db))
			dashboardAuthed.POST("/providers", handler.CreateProvider(db, engine))
			dashboardAuthed.GET("/providers/:id", handler.GetProvider(db))
			dashboardAuthed.PUT("/providers/:id", handler.UpdateProvider(db, engine))
			dashboardAuthed.DELETE("/providers/:id", handler.DeleteProvider(db, engine))
			dashboardAuthed.POST("/providers/:id/toggle", handler.ToggleProvider(db, engine))
			dashboardAuthed.POST("/providers/:id/workflow-toggle", handler.ToggleWorkflow(db, engine))
			dashboardAuthed.POST("/providers/fetch-models", handler.FetchModels())

			// Tokens
			dashboardAuthed.GET("/tokens", handler.ListTokens(db))
			dashboardAuthed.POST("/tokens", handler.CreateToken(db))
			dashboardAuthed.GET("/tokens/:id", handler.GetToken(db))
			dashboardAuthed.PUT("/tokens/:id", handler.UpdateToken(db))
			dashboardAuthed.DELETE("/tokens/:id", handler.DeleteToken(db))
			dashboardAuthed.POST("/tokens/:id/toggle", handler.ToggleToken(db))
			dashboardAuthed.POST("/tokens/:id/rotate", handler.RotateTokenKey(db))

			// Logs
			dashboardAuthed.GET("/logs", handler.ListLogs(db))
			dashboardAuthed.GET("/logs/stats", handler.GetLogStats(db))

			// Users
			dashboardAuthed.GET("/users/me", handler.GetCurrentUser(db))
			dashboardAuthed.PUT("/users/me/username", handler.UpdateUsername(db, sessions))
			dashboardAuthed.PUT("/users/me/password", handler.UpdatePassword(db))

			// Rules (rewrite, heartbeat, concurrency, failover)
			dashboard.GET("/rules/:type", handler.ListRules(db))
			dashboard.POST("/rules/:type", handler.CreateRule(db))
			dashboard.PUT("/rules/:type/:id", handler.UpdateRule(db))
			dashboard.DELETE("/rules/:type/:id", handler.DeleteRule(db))

			// Models (per-model pricing & info)
			dashboard.GET("/models", handler.ListPrices(db))
			dashboard.POST("/models", handler.CreatePrice(db))
			dashboard.PUT("/models/:id", handler.UpdatePrice(db))
			dashboard.DELETE("/models/:id", handler.DeletePrice(db))

			// Settings
			dashboardAuthed.GET("/settings", handler.ListSettings(db))
			dashboardAuthed.PUT("/settings", handler.UpsertSetting(db))

			dashboardAuthed.GET("/topology", handler.TopologyGet(db))
			dashboardAuthed.PUT("/topology", handler.TopologyPut(db, engine))
			dashboardAuthed.GET("/topology/versions", handler.TopologyVersionList(db))
			dashboardAuthed.POST("/topology/versions/archive", handler.TopologyVersionArchive(db))
			dashboardAuthed.GET("/topology/versions/:id", handler.TopologyVersionGet(db))
			dashboardAuthed.POST("/topology/versions/:id/restore", handler.TopologyVersionRestore(db, engine))

			// Flat topology (canvas-style node/wire model)
			dashboardAuthed.GET("/flat-topology", handler.GetFlatTopology(db))
			dashboardAuthed.PUT("/flat-topology", handler.SaveFlatTopology(db, engine))
			dashboardAuthed.GET("/flat-topology/validate", handler.ValidateFlatTopology(db))

			// Channel affinity
			dashboardAuthed.GET("/channel-affinity", handler.GetChannelAffinity(db))
			dashboardAuthed.PUT("/channel-affinity", handler.SaveChannelAffinity(db, engine))

			// Runtime metrics (dashboard-authenticated)
			dashboard.GET("/runtime/metrics", handler.RuntimeMetrics(db))
			dashboardAuthed.GET("/active-requests", handler.ActiveRequests())
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
