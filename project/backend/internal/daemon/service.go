package daemon

// Autostart service management: `hapiy service install|uninstall|start|stop|
// status`. The per-platform unit writers live in service_darwin.go /
// service_linux.go / service_windows.go; this file owns the shared dispatch,
// the status exit-code contract (so install scripts can machine-check whether
// autostart really took), and the install-location/env glue.

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// `hapiy service status` exit codes: let install scripts decide whether
// autostart is in place instead of grepping localized text.
//
//	0  installed and running
//	3  not installed
//	4  installed but paused (returns at next login)
const (
	serviceExitNotInstalled    = 3
	serviceExitInstalledPaused = 4
)

// serviceStatusExit carries a nonzero status exit without printing a second
// error to stderr: runService prints the body to stdout and main exits with
// the code silently.
type serviceStatusExit struct{ code int }

func (e serviceStatusExit) Error() string { return fmt.Sprintf("service: exit %d", e.code) }

// ExitCode translates a status-exit error into a process exit code; ok=false
// means it is an ordinary error that main prints and exits 1 for.
func ExitCode(err error) (int, bool) {
	var se serviceStatusExit
	if errors.As(err, &se) {
		return se.code, true
	}
	return 0, false
}

// RunService is the `hapiy service` entry.
func RunService(args []string) error {
	action := ""
	if len(args) > 0 {
		action = args[0]
		args = args[1:]
	}
	quiet := false
	for _, a := range args {
		switch a {
		case "--quiet", "-q":
			quiet = true
		default:
			return fmt.Errorf("service: unexpected argument %q", a)
		}
	}
	switch action {
	case "install":
		return serviceInstall()
	case "uninstall":
		return serviceUninstall()
	case "start":
		return serviceStart(false)
	case "stop":
		return serviceStop(quiet)
	case "status":
		return serviceStatus()
	case "", "help":
		printServiceUsage()
		return nil
	default:
		return fmt.Errorf("service: unknown action %q (expected: install | uninstall | start | stop | status)", action)
	}
}

func printServiceUsage() {
	fmt.Print(`hapiy service — autostart at login + restart on crash

Usage:
  hapiy service install      install and start the autostart service
  hapiy service uninstall    stop and remove it
  hapiy service start        start the installed service
  hapiy service stop         pause it (returns at next login; --quiet for scripts)
  hapiy service status       show service and backend state
`)
}

// serviceExecutable returns the path the unit should execute. Deliberately no
// symlink resolution: the unit points at the stable entry the installer/upgrade
// keeps rewriting, so replacing the real file never needs a unit reinstall.
func serviceExecutable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("service: locate executable: %w", err)
	}
	if abs, err := filepath.Abs(exe); err == nil {
		exe = abs
	}
	return exe, nil
}

// serviceExtraEnv is the environment the installed backend runs with, rooted in
// the install location (~/.hapiy) rather than the launcher's cwd. HAPIY_WEB_DIST
// is only added when a webdist actually sits next to the binary.
func serviceExtraEnv() [][2]string {
	exe, _ := serviceExecutable()
	appDir := filepath.Dir(exe)
	pairs := [][2]string{
		{"HAPIY_ENV", "production"},
		{"HAPIY_PORT", port()},
		{"HAPIY_STATE_DIR", stateDir()},
		{"HAPIY_DB_PATH", filepath.Join(stateDir(), "hapiy.db")},
		{"HAPIY_LOG_DIR", filepath.Join(stateDir(), "logs")},
	}
	if info, err := os.Stat(filepath.Join(appDir, "webdist")); err == nil && info.IsDir() {
		pairs = append(pairs, [2]string{"HAPIY_WEB_DIST", filepath.Join(appDir, "webdist")})
	}
	return pairs
}

// printServiceBackend prints backend health and log path; shared by the three
// platform status implementations.
func printServiceBackend() {
	if running, ok := probeBackend(); ok {
		fmt.Printf("backend: running (port %s, version %s)\n", port(), running)
	} else {
		fmt.Println("backend: not responding")
	}
	fmt.Printf("log: %s\n", logPath())
}

// stopLocalBackendForService stops the manually started local stack (supervisor
// + serve) so the autostart service owns the backend. Identity comes only from
// the pidfiles, never from process-name guessing. Idempotent when nothing runs.
func stopLocalBackendForService() {
	stopSupervisor()
	stopServe()
}

// waitServiceBackend waits for the service manager to bring the backend healthy;
// a timeout is only a note, not an install failure.
func waitServiceBackend(timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if running, ok := probeBackend(); ok {
			fmt.Printf("service: backend running (port %s, version %s)\n", port(), running)
			return
		}
		time.Sleep(time.Second)
	}
	fmt.Printf("service: backend not healthy yet (log: %s)\n", logPath())
}

// xmlEscape escapes the XML reserved characters in a value (paths with & fall
// over otherwise).
func xmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}
