package main

import (
	"log"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

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

	// Drop archived topology versions stored in the legacy nested-document
	// format: the version archive was rebuilt around the flat topology, so old
	// snapshots are unreadable and are intentionally discarded (no migration).
	if err := db.Where("1 = 1").Delete(&model.TopologyVersion{}).Error; err != nil {
		log.Printf("Warning: Failed to clear legacy topology versions: %v", err)
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

	// Initialize per-request log file capture (writes JSON files to disk)
	service.InitLogCaptureWriter(db)

	service.InitQuotaLedger(db)

	// Exchange-rate scheduler: daily auto refresh with 30-minute retry on
	// failure when auto refresh is enabled.
	service.StartExchangeRateScheduler(db)

	// Topology auto-archive: startup compensation + 5-minute stable-window.
	stopTopologyArchive := handler.StartTopologyVersionAutoArchive(db)
	defer stopTopologyArchive()

	// Active-request retention: load persisted setting and periodically
	// evict finished entries past their retention window.
	handler.InitActiveRequestRetention(db)
	stopRetentionEviction := common.Global().StartEvictionLoop(30 * time.Second)
	defer stopRetentionEviction()

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
			dashboardAuthed.POST("/logs/clear", handler.ClearLogs(db))
			dashboardAuthed.GET("/logs/stats", handler.GetLogStats(db))
		dashboardAuthed.GET("/logs/capture", handler.ListLogFiles(db))
		dashboardAuthed.GET("/logs/capture/pairs", handler.ListLogCapturePairs(db))
		dashboardAuthed.GET("/logs/capture/pairs/:request_id", handler.ReadLogCapturePair(db))
		dashboardAuthed.GET("/logs/capture/pairs/:request_id/merged-response", handler.ReadLogCaptureMergedResponse(db))
		dashboardAuthed.GET("/logs/capture/:id", handler.ReadLogFile(db))
		dashboardAuthed.POST("/log-capture/clear", handler.ClearLogFiles(db))

			// Users
			dashboardAuthed.GET("/users/me", handler.GetCurrentUser(db))
			dashboardAuthed.PUT("/users/me/username", handler.UpdateUsername(db, sessions))
			dashboardAuthed.PUT("/users/me/password", handler.UpdatePassword(db))

			// Rules (rewrite, heartbeat, concurrency, failover)
			dashboard.GET("/rules/:type", handler.ListRules(db))
			dashboard.POST("/rules/:type", handler.CreateRule(db))
			dashboard.PUT("/rules/:type/:id", handler.UpdateRule(db))
			dashboard.DELETE("/rules/:type/:id", handler.DeleteRule(db))
			dashboard.POST("/rules/:type/:id/test", handler.TestRewriteRule(db))

			// Models (per-model pricing & info)
			dashboard.GET("/models", handler.ListPrices(db))
			dashboard.POST("/models", handler.CreatePrice(db))
			dashboard.PUT("/models/:id", handler.UpdatePrice(db))
			dashboard.DELETE("/models/:id", handler.DeletePrice(db))
			dashboardAuthed.GET("/models-dev", handler.ModelsDevList())

			// Settings
			dashboardAuthed.GET("/settings", handler.ListSettings(db))
			dashboardAuthed.PUT("/settings", handler.UpsertSetting(db))
			dashboardAuthed.GET("/settings/base-url-paths", handler.ListBaseUrlPaths(db))
			dashboardAuthed.PUT("/settings/base-url-paths", handler.ReplaceBaseUrlPaths(db))
			dashboardAuthed.POST("/exchange-rate/refresh", handler.RefreshExchangeRate(db))
			dashboardAuthed.POST("/exchange-rate/test", handler.TestExchangeRate())

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

			// Topology canvas layout (node positions)
			dashboardAuthed.GET("/layout", handler.GetLayout(db))
			dashboardAuthed.PUT("/layout", handler.PutLayout(db))

			// Channel affinity
			dashboardAuthed.GET("/channel-affinity", handler.GetChannelAffinity(db))
			dashboardAuthed.PUT("/channel-affinity", handler.SaveChannelAffinity(db, engine))

			// Table configs (per-table column display config)
			dashboardAuthed.GET("/table-configs/:id", handler.GetTableConfig(db))
			dashboardAuthed.PUT("/table-configs/:id", handler.UpsertTableConfig(db))

			// Runtime metrics (dashboard-authenticated)
			dashboard.GET("/runtime/metrics", handler.RuntimeMetrics(db))
			dashboardAuthed.GET("/active-requests/config", handler.GetActiveRequestConfig(db))
			dashboardAuthed.PUT("/active-requests/config", handler.PutActiveRequestConfig(db))
			dashboardAuthed.GET("/active-requests", handler.ActiveRequests())
			dashboardAuthed.GET("/events", handler.DashboardEvents())
		}

		// Relay endpoints (token auth)
		relayGroup := v1.Group("")
		relayGroup.Use(middleware.TokenAuth(db))
		{
			// OpenAI-compatible endpoints
			relayGroup.POST("/chat/completions", handler.Relay(db, engine))
			relayGroup.POST("/completions", handler.Relay(db, engine))
			relayGroup.POST("/embeddings", handler.Relay(db, engine))
			relayGroup.POST("/images/generations", handler.Relay(db, engine))
			relayGroup.POST("/audio/speech", handler.Relay(db, engine))
			relayGroup.POST("/audio/transcriptions", handler.Relay(db, engine))
		}
	}

	// Production mode: serve the built frontend from the same Go origin so
	// the API is same-origin (no dev proxy needed).
	registerFrontend(r, cfg.WebDistDir)

	// Start server
	addr := cfg.Host + ":" + cfg.Port
	log.Printf("Server starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
		os.Exit(1)
	}
}

// registerFrontend serves the built frontend (SPA) from distDir when it is
// non-empty: static assets under /assets, an SPA fallback to index.html for
// client-side routes, and 404 for unknown API paths.
func registerFrontend(r *gin.Engine, distDir string) {
	if distDir == "" {
		return
	}
	info, err := os.Stat(distDir)
	if err != nil || !info.IsDir() {
		log.Printf("Warning: frontend dist dir %q not found; serving API only", distDir)
		return
	}
	fileServer := http.FileServer(http.Dir(distDir))
	r.NoRoute(func(c *gin.Context) {
		p := path.Clean(c.Request.URL.Path)
		if p == "." {
			p = "/"
		}
		if p == "/" || strings.HasPrefix(p, "/assets/") {
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		if strings.HasPrefix(p, "/health") ||
			strings.HasPrefix(p, "/metrics") ||
			strings.HasPrefix(p, "/v1") ||
			strings.HasPrefix(p, "/proxy") {
			c.String(http.StatusNotFound, "404 page not found")
			return
		}
		req := c.Request.Clone(c.Request.Context())
		req.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, req)
	})
	log.Printf("Serving frontend from %s (production mode)", distDir)
}
