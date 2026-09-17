package main

import (
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

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

	encKey, err := config.LoadEncryptionKey(cfg)
	if err != nil {
		log.Fatalf("Failed to load encryption key: %v", err)
	}

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
	if err := model.DeduplicateAgentConfigRecordNames(db); err != nil {
		log.Fatalf("Failed to deduplicate agent config records: %v", err)
	}
	if err := model.AutoMigrate(db); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Seed the built-in agent type (opencode) for the 接管配置文件 feature.
	if err := model.EnsureDefaultAgentTypes(db); err != nil {
		log.Fatalf("Failed to seed default agent types: %v", err)
	}

	if err := model.MigrateTopologySchema(db); err != nil {
		log.Fatalf("Failed to migrate legacy topology schema: %v", err)
	}

	// Fold legacy automatic-disable state into the single auto_disable_states
	// table and drop the old dual-source structures.
	if err := model.MigrateAutoDisableState(db); err != nil {
		log.Fatalf("Failed to migrate auto-disable state: %v", err)
	}

	// The 模型信息 module is retired — drop its table so the schema no
	// longer advertises a feature with no UI or handler backing it.
	if err := model.DropPriceConfigTable(db); err != nil {
		log.Fatalf("Failed to drop retired price_configs table: %v", err)
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
	if err := handler.RebuildFlatAssignmentsIfNeeded(db); err != nil {
		log.Fatalf("Failed to rebuild topology assignments: %v", err)
	}
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

	// Auto-recovery scheduler: re-enables disabled providers/BaseURLs/keys
	// either by probing the upstream (probe mode) or after a configured
	// cooldown elapses since the disable (timed mode).
	service.StartRecoverySchedulerWithRecordReplay(db, func() (int, int) {
		var rows []model.DisabledRecord
		if err := db.Where("resolved_at IS NULL").Find(&rows).Error; err != nil {
			log.Printf("auto-recovery: load disabled records: %v", err)
			return 0, 0
		}
		resolved := 0
		for i := range rows {
			if engine.ReplayDisabledRecord(&rows[i]) {
				resolved++
				var p model.Provider
				providerName := ""
				if err := db.First(&p, "id = ?", rows[i].ProviderID).Error; err == nil {
					providerName = p.Name
				}
				service.LogEvent(service.LogSourceChannelRecoveredAuto, providerName, service.ChannelEventMessage(rows[i].Dimension, rows[i].Value), "恢复方式: 自动探针")
			}
		}
		return resolved, len(rows)
	})

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

	// All 404/fallback routing (agent taxi rewrite, own model list, SPA)
	// lives in a single NoRoute handler — see registerNoRoute.
	r.NoRoute(noRouteHandler(db, engine, cfg.WebDistDir))

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
		dashboardAuthed.Use(handler.AuditSystemAdmin(db))
		dashboard.Use(handler.AuditSystemAdmin(db))
		{
			// Providers
			dashboardAuthed.GET("/providers", handler.ListProviders(db))
			dashboardAuthed.POST("/providers", handler.CreateProvider(db, engine))
			dashboardAuthed.GET("/providers/disable-status", handler.ListProviderDisableStatus(db))
			dashboardAuthed.POST("/providers/disable-status/reset-all", handler.ResetAllProviderDisableStatus(db, engine))
			dashboardAuthed.POST("/providers/:id/disable-status/reset-dimension", handler.ResetProviderDisableDimension(db, engine))
			dashboardAuthed.GET("/disabled-records", handler.ListDisabledRecords(db, engine))
			dashboardAuthed.POST("/disabled-records/:id/replay", handler.ReplayDisabledRecord(db, engine))
			dashboardAuthed.POST("/disabled-records/:id/restore-direct", handler.RestoreDisabledRecordDirectly(db, engine))
			dashboardAuthed.POST("/disabled-records/:id/extend-countdown", handler.ExtendDisabledRecordCountdown(db))
			dashboardAuthed.GET("/providers/:id", handler.GetProvider(db))
			dashboardAuthed.PUT("/providers/:id", handler.UpdateProvider(db, engine))
			dashboardAuthed.DELETE("/providers/:id", handler.DeleteProvider(db, engine))
			dashboardAuthed.POST("/providers/:id/toggle", handler.ToggleProvider(db, engine))
			dashboardAuthed.POST("/providers/:id/workflow-toggle", handler.ToggleWorkflow(db, engine))
			dashboardAuthed.POST("/providers/fetch-models", handler.FetchModels())

			// Agent config takeover (接管配置文件) & agent-type rules (管理规则)
			dashboardAuthed.GET("/agent-types", handler.ListAgentTypes(db))
			dashboardAuthed.GET("/agent-type-rules", handler.ListAgentTypeRules(db))
			dashboardAuthed.POST("/agent-type-rules", handler.CreateAgentTypeRule(db))
			dashboardAuthed.PUT("/agent-type-rules/:id", handler.UpdateAgentTypeRule(db))
			dashboardAuthed.DELETE("/agent-type-rules/:id", handler.DeleteAgentTypeRule(db))
			dashboardAuthed.GET("/agent-type-rules/:name/template", handler.GetAgentTypeRuleTemplate())
			dashboardAuthed.GET("/agent-config-files", handler.ListAgentConfigFiles(db))
			dashboardAuthed.POST("/agent-config-files", handler.CreateAgentConfigFile(db, encKey))
			dashboardAuthed.GET("/agent-config-files/check", handler.CheckAgentConfigPath())
			dashboardAuthed.GET("/agent-config-files/read", handler.ReadAgentConfigPath())
			dashboardAuthed.POST("/agent-config-files/read-remote", handler.ReadAgentConfigRemotePath())
			dashboardAuthed.POST("/agent-config-files/test-ssh", handler.TestAgentSshConnection())
			dashboardAuthed.GET("/agent-config-files/:id/content", handler.GetAgentConfigFileContent(db, encKey))
			dashboardAuthed.PUT("/agent-config-files/:id/content", handler.PutAgentConfigFileContent(db, encKey))
			dashboardAuthed.PUT("/agent-config-files/:id", handler.UpdateAgentConfigFile(db, encKey))
			dashboardAuthed.DELETE("/agent-config-files/:id", handler.DeleteAgentConfigFile(db))
			dashboardAuthed.GET("/agent-config-files/:id/models", handler.GetAgentConfigFileModels(db, encKey))
			dashboardAuthed.POST("/agent-config-files/:id/apply-recommendations", handler.ApplyAgentRecommendations(db, encKey))
			dashboardAuthed.POST("/agent-config-files/:id/apply-recommendation-template", handler.ApplyRecommendationTemplate(db, encKey))
			dashboardAuthed.POST("/agent-config-files/:id/apply-recommendation-config", handler.ApplyRecommendationConfig(db, encKey))
			dashboardAuthed.POST("/agent-config-files/:id/sync-model-fields", handler.SyncAgentConfigFileModelFields(db, encKey))
			dashboardAuthed.GET("/agent-config-files/managed-options", handler.ManagedProviderOptions(db))
			dashboardAuthed.GET("/agent-config-files/:id/managed-providers", handler.ListManagedProviders(db, encKey))
			dashboardAuthed.POST("/agent-config-files/:id/managed-providers", handler.CreateManagedProvider(db, encKey))
			dashboardAuthed.PUT("/agent-config-files/:id/managed-providers/:mid", handler.UpdateManagedProvider(db, encKey))
			dashboardAuthed.DELETE("/agent-config-files/:id/managed-providers/:mid", handler.DeleteManagedProvider(db))
			dashboardAuthed.POST("/agent-config-files/:id/managed-providers/:mid/sync", handler.SyncManagedProvider(db, encKey))
			dashboardAuthed.GET("/agent-config-files/:id/model-config-sources", handler.ListAgentModelConfigSources(db))
			dashboardAuthed.PUT("/agent-config-files/:id/model-config-sources", handler.SaveAgentModelConfigSources(db))

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
			dashboardAuthed.GET("/logs/sources", handler.ListLogSources(db))
			dashboardAuthed.GET("/logs/models", handler.ListLogModels(db))
			dashboardAuthed.POST("/usage/clear", handler.ClearUsage(db))
			dashboardAuthed.GET("/logs/capture", handler.ListLogFiles(db))
			dashboardAuthed.GET("/logs/capture/pairs", handler.ListLogCapturePairs(db))
			dashboardAuthed.GET("/logs/capture/pairs/:request_id", handler.ReadLogCapturePair(db))
			dashboardAuthed.GET("/logs/capture/pairs/:request_id/merged-response", handler.ReadLogCaptureMergedResponse(db))
			dashboardAuthed.GET("/logs/capture/prefixes", handler.ListLogCapturePrefixes(db))
			dashboardAuthed.GET("/logs/capture/sources", handler.ListLogCaptureSources(db))
			dashboardAuthed.GET("/logs/capture/models", handler.ListLogCaptureModels(db))
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

			// 并行控制滑动窗口当前占用（前端轮询展示）
			dashboardAuthed.GET("/concurrency/windows", handler.ListConcurrencyWindows(db))

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
			dashboardAuthed.POST("/active-requests/:requestId/kill", handler.KillActiveRequest())
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

	// Agent taxi prefix (`/proxy/__<source>/...`) mirrors the OpenAI-compatible
	// /v1 relay endpoints with the same middleware order, so the production
	// single-origin build accepts the exact URLs agents actually call — e.g.
	// opencode posts `/proxy/__opencode/chat/completions`. The Vite dev server
	// rewrites these to /v1 for the backend; here the source mark is captured
	// into the X-Hapiy-Source header (with the `__` prefix, matching the dev
	// proxy) and the path is rewritten to /v1 so dispatch / endpoint matching /
	// audit logging see identical paths in both modes.
	proxyRelay := r.Group("/proxy/__:source")
	proxyRelay.Use(middleware.OverloadProtection(nil))
	proxyRelay.Use(func(c *gin.Context) {
		src := c.Param("source")
		c.Request.Header.Set("X-Hapiy-Source", "__"+src)
		c.Request.URL.Path = "/v1" + c.Request.URL.Path[len("/proxy/__"+src):]
		c.Next()
	})
	proxyRelay.Use(middleware.TokenAuth(db))
	{
		proxyRelay.POST("/chat/completions", handler.Relay(db, engine))
		proxyRelay.POST("/completions", handler.Relay(db, engine))
		proxyRelay.POST("/embeddings", handler.Relay(db, engine))
		proxyRelay.POST("/images/generations", handler.Relay(db, engine))
		proxyRelay.POST("/audio/speech", handler.Relay(db, engine))
		proxyRelay.POST("/audio/transcriptions", handler.Relay(db, engine))
	}

	// Production mode: serve the built frontend from the same Go origin so
	// the API is same-origin (no dev proxy needed).
	// Nothing to do here: the NoRoute handler already serves webDist when set.

	// Start server
	addr := cfg.Host + ":" + cfg.Port
	log.Printf("Server starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
		os.Exit(1)
	}
}

// noRouteHandler is the single catch-all handler for every mode. Only one
// NoRoute can be registered on a Gin engine, so own-model-list and SPA/dist
// serving share it. In order it:
//
//  1. serves the own model list for any GET whose path ends with the
//     configured `own_model_list_endpoint` (colloquially `<baseurl>/v1/models`).
//  2. when webDist is non-empty, serves the built SPA from it (static assets,
//     index.html fallback for client-side routes, 404 for unknown API paths);
//     otherwise returns plain 404.
//
// The agent taxi prefix `/proxy/__<source>/<path>` is handled by real routes
// registered in main (see proxyRelay), NOT here — running handlers inside the
// NoRoute callback is unsafe because gin pre-sets the 404 status on the
// response writer before the callback runs, which leaks a 404 status line to
// the client for streamed responses.
func noRouteHandler(db *gorm.DB, engine *relay.Engine, webDist string) gin.HandlerFunc {
	if webDist != "" {
		info, err := os.Stat(webDist)
		if err != nil || !info.IsDir() {
			log.Printf("Warning: frontend dist dir %q not found; serving API only", webDist)
			webDist = ""
		} else {
			log.Printf("Serving frontend from %s (production mode)", webDist)
		}
	}
	modelList := func(c *gin.Context) bool {
		endpoint, err := service.GetSetting(db, "own_model_list_endpoint")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "配置读取失败"})
			return true
		}
		expected := strings.TrimSpace(endpoint)
		if c.Request.Method != http.MethodGet || expected == "" ||
			!strings.HasSuffix(c.Request.URL.Path, expected) {
			return false
		}
		middleware.TokenAuth(db)(c)
		if c.IsAborted() {
			return true
		}
		handler.OwnModelList(db, engine)(c)
		return true
	}

	return func(c *gin.Context) {
		if modelList(c) {
			return
		}
		if webDist == "" {
			if c.Request.Method != http.MethodGet {
				c.String(http.StatusNotFound, "404 page not found")
				return
			}
			endpoint, err := service.GetSetting(db, "own_model_list_endpoint")
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "配置读取失败"})
				return
			}
			expected := strings.TrimSpace(endpoint)
			if expected == "" {
				c.JSON(http.StatusNotFound, gin.H{"error": "模型列表接口未配置"})
				return
			}
			c.JSON(http.StatusNotFound, gin.H{"error": "路径不存在"})
			return
		}
		fileServer := http.FileServer(http.Dir(webDist))
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
		// 静态文件（/logo.svg, /manifest.webmanifest, /icon-192.png 等）
		// 先尝试直接 serve，文件不存在才走 SPA fallback 返回 index.html。
		// 否则浏览器请求 manifest / 图标会拿到 index.html（text/html），
		// 导致 PWA 识别不了、图标加载不出来。
		if info, err := os.Stat(filepath.Join(webDist, p)); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		req := c.Request.Clone(c.Request.Context())
		req.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, req)
	}
}
