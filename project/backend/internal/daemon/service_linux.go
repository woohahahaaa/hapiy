//go:build linux

package daemon

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const serviceLinuxUnitName = "hapiy.service"

func serviceUnitPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("service: locate home dir: %w", err)
	}
	return filepath.Join(home, ".config", "systemd", "user", serviceLinuxUnitName), nil
}

// serviceUnitContents is the systemd user unit: Restart=always handles crash
// restarts; enable runs it when the user manager starts (login, or boot with
// linger on).
func serviceUnitContents(exe, logPath string, env [][2]string) string {
	var envLines strings.Builder
	for _, kv := range env {
		fmt.Fprintf(&envLines, "Environment=%s\n", systemdEnv(kv[0], kv[1]))
	}
	return fmt.Sprintf(`[Unit]
Description=hapiy (autostart at login, restart on crash)

[Service]
ExecStart=%s serve
Restart=always
RestartSec=1
%sStandardOutput=append:%s
StandardError=append:%s

[Install]
WantedBy=default.target
`, systemdExec(exe), envLines.String(), logPath, logPath)
}

// systemdExec quotes a path with spaces or other special characters (systemd
// exec syntax).
func systemdExec(exe string) string {
	if strings.ContainsAny(exe, " \t\"'\\") {
		return strconv.Quote(exe)
	}
	return exe
}

// systemdEnv renders one Environment= assignment, quoting the value when it
// contains whitespace or quotes.
func systemdEnv(key, value string) string {
	if strings.ContainsAny(value, " \t\"'\\") {
		return key + "=" + strconv.Quote(value)
	}
	return key + "=" + value
}

func systemctlUser(args ...string) (string, error) {
	full := append([]string{"--user"}, args...)
	out, err := exec.Command("systemctl", full...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func serviceInstalled() bool {
	path, err := serviceUnitPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(path)
	return err == nil
}

func serviceActive() bool {
	out, err := systemctlUser("is-active", serviceLinuxUnitName)
	if err != nil {
		return false
	}
	switch out {
	case "active", "activating", "reloading":
		return true
	}
	return false
}

// lingerEnabled reports whether systemd linger is on (no loginctl or a failed
// query counts as off; only affects the hint text).
func lingerEnabled() bool {
	user := os.Getenv("USER")
	if user == "" {
		return false
	}
	out, err := exec.Command("loginctl", "show-user", user, "--property=Linger", "--value").Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(out)) == "yes"
}

func serviceInstall() error {
	exe, err := serviceExecutable()
	if err != nil {
		return err
	}
	logPath := logPath()
	path, err := serviceUnitPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("service: create systemd user dir: %w", err)
	}
	// systemd append: only creates the file, not its parents, so a missing dir
	// makes the unit fail to start.
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return fmt.Errorf("service: create log dir: %w", err)
	}
	if err := os.WriteFile(path, []byte(serviceUnitContents(exe, logPath, serviceExtraEnv())), 0o644); err != nil {
		return fmt.Errorf("service: write unit: %w", err)
	}
	RecordPort(port())
	if out, err := systemctlUser("daemon-reload"); err != nil {
		return fmt.Errorf("service: systemctl daemon-reload: %v: %s", err, out)
	}
	if out, err := systemctlUser("enable", serviceLinuxUnitName); err != nil {
		return fmt.Errorf("service: systemctl enable: %v: %s", err, out)
	}
	// A re-install may leave the old service running: let systemd stop it (its
	// Restart=always would race a manual kill), clear the manual stack, then
	// restart with the new unit.
	_, _ = systemctlUser("stop", serviceLinuxUnitName)
	stopLocalBackendForService()
	if out, err := systemctlUser("restart", serviceLinuxUnitName); err != nil {
		return fmt.Errorf("service: systemctl restart: %v: %s", err, out)
	}
	fmt.Printf("service: installed and started (unit: %s)\n", path)
	fmt.Println("service: starts at login and restarts on crash (Restart=always)")
	if !lingerEnabled() {
		if user := os.Getenv("USER"); user != "" {
			fmt.Printf("service: note: to keep it running without a login: sudo loginctl enable-linger %s\n", user)
		}
	}
	waitServiceBackend(30 * time.Second)
	return nil
}

func serviceStart(quiet bool) error {
	if !serviceInstalled() {
		return errors.New("service: not installed (run `hapiy service install` first)")
	}
	if serviceActive() {
		if !quiet {
			fmt.Println("service: already running")
		}
		return nil
	}
	stopLocalBackendForService()
	if out, err := systemctlUser("start", serviceLinuxUnitName); err != nil {
		return fmt.Errorf("service: systemctl start: %v: %s", err, out)
	}
	if !quiet {
		fmt.Println("service: started")
	}
	waitServiceBackend(30 * time.Second)
	return nil
}

func serviceStop(quiet bool) error {
	if !serviceInstalled() {
		if !quiet {
			fmt.Println("service: not installed; nothing to stop")
		}
		return nil
	}
	if !serviceActive() {
		if !quiet {
			fmt.Println("service: installed but not running; nothing to stop")
		}
		return nil
	}
	if out, err := systemctlUser("stop", serviceLinuxUnitName); err != nil {
		return fmt.Errorf("service: systemctl stop: %v: %s", err, out)
	}
	fmt.Println("service: paused (returns at next login/boot; start now: hapiy service start)")
	return nil
}

func serviceUninstall() error {
	path, err := serviceUnitPath()
	if err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		fmt.Println("service: not installed; nothing to remove")
		return nil
	}
	_, _ = systemctlUser("disable", "--now", serviceLinuxUnitName)
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("service: remove unit: %w", err)
	}
	_, _ = systemctlUser("daemon-reload")
	fmt.Println("service: uninstalled (autostart removed)")
	return nil
}

func serviceStatus() error {
	code := 0
	switch {
	case !serviceInstalled():
		fmt.Println("service: not installed (install: hapiy service install)")
		code = serviceExitNotInstalled
	case serviceActive():
		fmt.Println("service: installed and running (systemd --user, starts at login, Restart=always)")
	default:
		fmt.Println("service: installed but not running (start now: hapiy service start)")
		code = serviceExitInstalledPaused
	}
	printServiceBackend()
	if code != 0 {
		return serviceStatusExit{code}
	}
	return nil
}
