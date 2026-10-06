package handler

// Self-update: version checking and one-click upgrade. Version comparison,
// download, checksum verification and in-place replacement all live in
// internal/selfupdate; this file wires it into the HTTP API and the
// `hapiy upgrade` command, plus the "swap done → restart" finishing move.

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/daemon"
	"github.com/hapiy/hapiy/internal/selfupdate"
	"github.com/hapiy/hapiy/internal/version"
)

// UpdateController owns the periodic version checker and the upgrade state for
// one running backend.
type UpdateController struct {
	checker    *selfupdate.Checker
	webDistDir string
	// beforeRestart runs just before the process exits into the new binary
	// (e.g. to persist state). May be nil.
	beforeRestart func()
}

// NewUpdateController builds the controller; webDistDir is the frontend dist
// directory to replace on upgrade (may be empty in API-only runs).
func NewUpdateController(webDistDir string) *UpdateController {
	return &UpdateController{
		checker:    selfupdate.NewChecker(version.Version),
		webDistDir: webDistDir,
	}
}

// Start runs the periodic checker until ctx is cancelled. The first check
// happens a few seconds after startup, then every 6 hours.
func (u *UpdateController) Start(ctx context.Context) {
	go u.checker.Run(ctx)
}

// StatusHandler serves GET /v1/dashboard/update.
func (u *UpdateController) StatusHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"data": u.checker.Status()})
	}
}

// CheckHandler serves POST /v1/dashboard/update/check (the "检查更新" button).
func (u *UpdateController) CheckHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()
		u.checker.CheckNow(ctx)
		c.JSON(http.StatusOK, gin.H{"data": u.checker.Status()})
	}
}

// ApplyHandler serves POST /v1/dashboard/update/apply. It responds immediately
// (the download happens in the background) so the page can show progress; the
// process then exits and the manager restarts the new binary.
func (u *UpdateController) ApplyHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !u.checker.BeginUpgrade() {
			respondError(c, http.StatusConflict, "UPDATE_IN_PROGRESS", "已有升级正在进行")
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true, "message": "升级中..."}})
		go u.runUpgrade()
	}
}

// runUpgrade performs a background in-place upgrade and restarts on success.
func (u *UpdateController) runUpgrade() {
	exe := resolveExePath()
	dist := resolveWebDistDir(u.webDistDir, exe)
	_, updated, err := selfupdate.Upgrade(context.Background(), version.Version, exe, dist, u.checker.SetDownloadProgress)
	if err != nil {
		u.checker.EndUpgrade(err)
		fmt.Fprintf(os.Stderr, "hapiy update: %v\n", err)
		return
	}
	if !updated {
		u.checker.EndUpgrade(nil)
		return
	}
	if u.beforeRestart != nil {
		u.beforeRestart()
	}
	fmt.Fprintln(os.Stderr, "hapiy update: files replaced; restarting into the new version")
	daemon.RestartForUpgrade(exe)
}

// RunUpgrade implements the `hapiy upgrade` CLI: check, download, verify, swap,
// then re-exec the freshly installed binary's `up` so the backend actually
// restarts into it.
func RunUpgrade(webDistDir string) error {
	exe := resolveExePath()
	dist := resolveWebDistDir(webDistDir, exe)

	fmt.Printf("hapiy upgrade: current version %s\n", version.Version)
	lastPrint := time.Time{}
	printed := false
	progress := func(done, total int64) {
		if printed && time.Since(lastPrint) < 300*time.Millisecond {
			return
		}
		printed = true
		lastPrint = time.Now()
		if total > 0 {
			fmt.Fprintf(os.Stderr, "\r下载中 %3.0f%%  %.1f/%.1f MB   ",
				float64(done)/float64(total)*100, mb(done), mb(total))
		} else {
			fmt.Fprintf(os.Stderr, "\r下载中 %.1f MB   ", mb(done))
		}
	}
	latest, updated, err := selfupdate.Upgrade(context.Background(), version.Version, exe, dist, progress)
	if printed {
		fmt.Fprintln(os.Stderr)
	}
	if err != nil {
		return err
	}
	if !updated {
		fmt.Printf("hapiy upgrade: already up to date (latest %s)\n", latest)
		return nil
	}
	fmt.Printf("hapiy upgrade: updated to %s; restarting backend...\n", latest)
	// Must exec the new file: this process still holds the old version in
	// memory, so calling up() locally would compare against the old version.
	cmd := exec.Command(exe, "up")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("upgrade: restart with new binary: %w", err)
	}
	return nil
}

// resolveExePath follows the running executable to its real file: the user may
// have launched a symlink (~/.local/bin/hapiy), and replacing the link itself
// would be wrong.
func resolveExePath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		return resolved
	}
	return exe
}

// resolveWebDistDir picks the dist directory to replace: the configured one,
// else <exeDir>/webdist when it exists.
func resolveWebDistDir(configured, exe string) string {
	if configured != "" {
		return configured
	}
	if exe == "" {
		return ""
	}
	guess := filepath.Join(filepath.Dir(exe), "webdist")
	if info, err := os.Stat(guess); err == nil && info.IsDir() {
		return guess
	}
	return ""
}

func mb(n int64) float64 {
	return float64(n) / (1 << 20)
}
