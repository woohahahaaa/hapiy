// Package daemon owns hapiy's backend lifecycle. The shell keepalive loop that
// used to live in alive.sh is folded in here so every entry point — the shell
// script, the macOS app shell and the Windows app shell — delegates to one
// command instead of each re-implementing platform-specific backgrounding.
//
// Two forms:
//
//   - "hapiy up" (default): idempotent "make sure the backend is running".
//     Probes /health, and if it is not up, re-execs a detached
//     "hapiy up --supervise" and waits up to 60s for health.
//   - "hapiy up --supervise" (internal flag, re-exec'd above): a long-lived
//     loop that runs "hapiy serve", piping its stdout/stderr (panics included)
//     into ~/.hapiy/log/hapiy.log, and respawns it 1s after it exits.
//
// "hapiy down" stops the supervisor first, then the backend. "hapiy status"
// inspects all of it. The port is taken from HAPIY_PORT (default 8080); the
// state directory from HAPIY_STATE_DIR (default ~/.hapiy).
package daemon

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/version"
)

const (
	// waitTimeout caps how long "up" waits for the backend to become healthy.
	waitTimeout = 60 * time.Second
	// probeInterval is the health-probe cadence while waiting.
	probeInterval = time.Second
	// restartGrace is how long we wait for a killed process to actually exit.
	restartGrace = 10 * time.Second
)

func stateDir() string {
	if d := os.Getenv("HAPIY_STATE_DIR"); d != "" {
		return d
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".hapiy"
	}
	return filepath.Join(home, ".hapiy")
}

func logPath() string           { return filepath.Join(stateDir(), "log", "hapiy.log") }
func supervisorPIDPath() string { return filepath.Join(stateDir(), "up.pid") }
func servePIDPath() string      { return filepath.Join(stateDir(), "serve.pid") }
func portPath() string          { return filepath.Join(stateDir(), "port") }

// port resolves the backend port in priority order: HAPIY_PORT env, then the
// handshake file recorded by the running server (so `status`/`up`/`down` and
// the autostart service all agree without repeating the env), then 8080.
func port() string {
	if p := os.Getenv("HAPIY_PORT"); p != "" {
		return p
	}
	if b, err := os.ReadFile(portPath()); err == nil {
		if p := strings.TrimSpace(string(b)); p != "" {
			return p
		}
	}
	return "8080"
}

// RecordPort persists the port the server actually bound so every later CLI
// call and the service agree on it. Called by `serve` at startup.
func RecordPort(p string) {
	if p == "" {
		return
	}
	if err := os.MkdirAll(stateDir(), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(portPath(), []byte(p+"\n"), 0o644)
}

func healthURL() string { return "http://127.0.0.1:" + port() + "/health" }

// backendHealthy probes /health. Status < 500 means the serve process is
// alive, even if an endpoint reports a business error.
func backendHealthy() bool {
	_, ok := probeBackend()
	return ok
}

// probeBackend GETs /health and returns the version the running backend
// reports alongside the health verdict. A missing version (old build) comes
// back empty, which needsRestart treats as a mismatch.
func probeBackend() (string, bool) {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(healthURL())
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	return readHealthVersion(resp.Body), resp.StatusCode < 500
}

// readHealthVersion pulls "version" out of the /health body. A malformed or
// empty body yields "", which callers treat as an old/unknown build.
func readHealthVersion(r io.Reader) string {
	var body struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(r).Decode(&body); err != nil {
		return ""
	}
	return body.Version
}

// needsRestart reports whether the running backend's version differs from the
// binary this process is. Empty running version means the response had no
// version field — an old build, exactly what this command is meant to fix.
func needsRestart(running, want string) bool {
	return running != want
}

// HandleUp is the "hapiy up" entry. --supervise selects the internal daemon
// loop; anything else runs the idempotent ensure.
func HandleUp(args []string) {
	supervise := false
	for _, a := range args {
		if a == "--supervise" || a == "-supervise" {
			supervise = true
		}
	}
	var err error
	if supervise {
		err = superviseLoop()
	} else {
		err = up()
	}
	fatal("up", err)
}

// up makes sure a healthy backend of the right version is running: happy path
// returns immediately; a version mismatch restarts the stale backend; otherwise
// it (re)starts the detached supervisor and waits for health.
func up() error {
	if running, ok := probeBackend(); ok {
		if !needsRestart(running, version.Version) {
			fmt.Printf("hapiy up: backend already running on 127.0.0.1:%s (version %s)\n", port(), running)
			return nil
		}
		fmt.Printf("hapiy up: backend version %q does not match %s; restarting\n", running, version.Version)
		restartStaleBackend()
	}
	if serviceActive() {
		// The autostart service owns the backend: ask it to start, never spawn
		// a local supervisor, or the two fight over the port and pidfiles.
		fmt.Println("hapiy up: backend is managed by the autostart service; asking it to start")
		if err := serviceStart(true); err != nil {
			fmt.Fprintf(os.Stderr, "hapiy: autostart service start failed: %v\n", err)
		}
	} else {
		if serviceInstalled() {
			fmt.Println("hapiy up: autostart service is paused; using the local supervisor (service returns at next login)")
		}
		if !supervisorAlive() {
			if err := spawnSupervisor(); err != nil {
				return err
			}
		}
	}
	deadline := time.Now().Add(waitTimeout)
	for {
		if running, ok := probeBackend(); ok && !needsRestart(running, version.Version) {
			fmt.Printf("hapiy up: backend ready (port %s, log %s)\n", port(), logPath())
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("backend not ready after %s (log: %s)", waitTimeout, logPath())
		}
		time.Sleep(probeInterval)
	}
}

// restartStaleBackend stops the supervisor first (so it cannot respawn the old
// serve), then the version-mismatched backend, clearing the way for `up` to
// bring up the new binary.
func restartStaleBackend() {
	stopSupervisor()
	stopServe()
}

// RestartForUpgrade is called after an in-place upgrade has swapped the binary.
// It exits this process so the manager that owns the backend restarts the new
// file: the autostart service or the local supervisor respawn automatically; a
// foreground-only run gets a fresh detached supervisor first.
func RestartForUpgrade(exePath string) {
	if !serviceActive() && !supervisorAlive() {
		cmd := exec.Command(exePath, "up")
		cmd.Env = os.Environ()
		applyDetach(cmd)
		if err := cmd.Start(); err == nil {
			_ = cmd.Process.Release()
		}
	}
	// Give the /api/update/apply response time to reach the client.
	time.Sleep(300 * time.Millisecond)
	os.Exit(0)
}

// spawnSupervisor re-execs this binary as a detached "up --supervise". The
// platform-specific detachment lives in proc_unix.go / proc_windows.go, so
// callers (shell / Swift / Windows shell) never handle platform differences.
func spawnSupervisor() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	cmd := exec.Command(exe, "up", "--supervise")
	cmd.Env = os.Environ()
	applyDetach(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start supervisor %s: %w", exe, err)
	}
	// Not Wait: the supervisor must outlive this call. Release only drops the
	// local handle.
	return cmd.Process.Release()
}

// superviseLoop is the long-lived daemon: run "serve", log everything, and
// respawn 1s after each exit.
func superviseLoop() error {
	if err := os.MkdirAll(filepath.Dir(logPath()), 0o755); err != nil {
		return fmt.Errorf("create log dir for %q: %w", logPath(), err)
	}
	logFile, err := os.OpenFile(logPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("open log %q: %w", logPath(), err)
	}
	defer logFile.Close()

	// De-duplicate: if a live supervisor already holds the pidfile, yield.
	claimed, err := claimSupervisor(supervisorPIDPath())
	if err != nil {
		return err
	}
	if !claimed {
		fmt.Printf("hapiy up: supervisor already running (%s); exiting\n", supervisorPIDPath())
		return nil
	}
	defer os.Remove(supervisorPIDPath())

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	logLine := func(format string, args ...any) {
		fmt.Fprintf(logFile, "%s  [supervisor] %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
	}
	logLine("supervising %s serve (supervisor pid=%d)", exe, os.Getpid())
	for {
		cmd := exec.Command(exe, "serve")
		cmd.Env = os.Environ()
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		if err := cmd.Start(); err != nil {
			logLine("serve failed to start: %v; retrying in 1s", err)
			time.Sleep(time.Second)
			continue
		}
		_ = os.WriteFile(servePIDPath(), []byte(strconv.Itoa(cmd.Process.Pid)+"\n"), 0o644)
		runErr := cmd.Wait()
		_ = os.Remove(servePIDPath())
		logLine("serve exited: %v; restarting in 1s", runErr)
		time.Sleep(time.Second)
	}
}

// claimSupervisor takes the pidfile with O_EXCL and writes its own PID. Returns
// false when a live supervisor already owns it; a stale (dead) pidfile is
// replaced.
func claimSupervisor(path string) (bool, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, fmt.Errorf("create state dir for %q: %w", path, err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			_, writeErr := fmt.Fprintf(f, "%d\n", os.Getpid())
			closeErr := f.Close()
			if writeErr != nil || closeErr != nil {
				_ = os.Remove(path)
				if writeErr == nil {
					writeErr = closeErr
				}
				return false, fmt.Errorf("write pidfile %q: %w", path, writeErr)
			}
			return true, nil
		}
		if !os.IsExist(err) {
			return false, fmt.Errorf("create pidfile %q: %w", path, err)
		}
		if owner := readPIDFile(path); owner > 0 && processAlive(owner) {
			return false, nil
		}
		if rmErr := os.Remove(path); rmErr != nil && !os.IsNotExist(rmErr) {
			return false, fmt.Errorf("remove stale pidfile %q: %w", path, rmErr)
		}
	}
	return false, fmt.Errorf("cannot claim pidfile %q (another supervisor is racing)", path)
}

// supervisorAlive reports whether the pidfile names a live supervisor; stale
// records are removed.
func supervisorAlive() bool {
	pid := readPIDFile(supervisorPIDPath())
	if pid <= 0 {
		return false
	}
	if processAlive(pid) {
		return true
	}
	_ = os.Remove(supervisorPIDPath())
	return false
}

// stopSupervisor terminates the recorded supervisor. Already-dead counts as
// success (idempotent).
func stopSupervisor() {
	path := supervisorPIDPath()
	pid := readPIDFile(path)
	if pid <= 0 || !processAlive(pid) {
		return
	}
	if err := terminateProcess(pid); err != nil {
		fmt.Fprintf(os.Stderr, "hapiy: terminate supervisor pid %d: %v\n", pid, err)
		return
	}
	waitProcessGone(pid, restartGrace)
	_ = os.Remove(path)
}

// stopServe terminates the recorded backend process.
func stopServe() {
	path := servePIDPath()
	pid := readPIDFile(path)
	if pid <= 0 || !processAlive(pid) {
		_ = os.Remove(path)
		return
	}
	if err := terminateProcess(pid); err != nil {
		fmt.Fprintf(os.Stderr, "hapiy: terminate backend pid %d: %v\n", pid, err)
	}
	waitProcessGone(pid, restartGrace)
	_ = os.Remove(path)
}

// HandleDown is the "hapiy down" entry: supervisor first, then backend, so the
// supervisor cannot respawn what we just killed.
func HandleDown(_ []string) {
	stopSupervisor()
	stopServe()
	if backendHealthy() {
		fatal("down", fmt.Errorf("backend still answering on %s; something else is respawning it", healthURL()))
	}
	fmt.Println("hapiy down: stopped; no listener answers on 127.0.0.1:" + port())
}

// HandleStatus is the "hapiy status" entry.
func HandleStatus(_ []string) {
	exe, _ := os.Executable()
	fmt.Printf("binary:      %s\n", exe)
	fmt.Printf("state dir:   %s\n", stateDir())
	fmt.Printf("log:         %s\n", logPath())
	fmt.Printf("port:        %s\n", port())

	if pid := readPIDFile(supervisorPIDPath()); processAlive(pid) {
		fmt.Printf("supervisor:  pid %d (running)\n", pid)
	} else {
		fmt.Printf("supervisor:  not running\n")
	}
	if pid := readPIDFile(servePIDPath()); processAlive(pid) {
		fmt.Printf("backend:     pid %d (running)\n", pid)
	} else {
		fmt.Printf("backend:     not running\n")
	}
	if backendHealthy() {
		fmt.Printf("health:      ok (%s)\n", healthURL())
	} else {
		fmt.Printf("health:      not responding\n")
	}

	fmt.Printf("---- last lines of %s ----\n", logPath())
	tailFile(logPath(), 15)
}

// readPIDFile parses a pidfile, returning 0 when it is absent or malformed.
func readPIDFile(path string) int {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 {
		return 0
	}
	return pid
}

// waitProcessGone polls until the pid disappears or the timeout elapses.
func waitProcessGone(pid int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for processAlive(pid) && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
}

// tailFile prints the last n lines of a file, or a placeholder when missing.
func tailFile(path string, n int) {
	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Println("(no log yet)")
		return
	}
	lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	fmt.Println(strings.Join(lines, "\n"))
}

// fatal prints an error and exits, unless err is nil.
func fatal(cmd string, err error) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "hapiy %s: %v\n", cmd, err)
		os.Exit(1)
	}
}
