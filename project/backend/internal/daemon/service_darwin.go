//go:build darwin

package daemon

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// launchd user-level LaunchAgent: RunAtLoad starts it at login, KeepAlive
// restarts it on crash. System LaunchDaemons are avoided — they need root.
const serviceDarwinLabel = "com.hapiy.agent"

func servicePlistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("service: locate home dir: %w", err)
	}
	return filepath.Join(home, "Library", "LaunchAgents", serviceDarwinLabel+".plist"), nil
}

func serviceDomain() string {
	return fmt.Sprintf("gui/%d", os.Getuid())
}

func serviceTarget() string {
	return serviceDomain() + "/" + serviceDarwinLabel
}

// servicePlistContents is the LaunchAgent body. Split out as a pure function so
// it can be tested without touching launchd.
func servicePlistContents(exe, logPath string, env [][2]string) string {
	var envXML strings.Builder
	if len(env) > 0 {
		envXML.WriteString("  <key>EnvironmentVariables</key>\n  <dict>\n")
		for _, kv := range env {
			fmt.Fprintf(&envXML, "    <key>%s</key><string>%s</string>\n", xmlEscape(kv[0]), xmlEscape(kv[1]))
		}
		envXML.WriteString("  </dict>\n")
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
		<string>serve</string>
	</array>
%s	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ProcessType</key>
	<string>Background</string>
	<key>StandardOutPath</key>
	<string>%s</string>
	<key>StandardErrorPath</key>
	<string>%s</string>
</dict>
</plist>
`, serviceDarwinLabel, xmlEscape(exe), envXML.String(), xmlEscape(logPath), xmlEscape(logPath))
}

func serviceInstalled() bool {
	path, err := servicePlistPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(path)
	return err == nil
}

// serviceActive reports whether the LaunchAgent is loaded. Loaded but not
// currently running (KeepAlive cooldown, just crashed) still counts as active:
// `up` should kickstart it, not spawn a second local supervisor.
func serviceActive() bool {
	return exec.Command("launchctl", "print", serviceTarget()).Run() == nil
}

func serviceInstall() error {
	exe, err := serviceExecutable()
	if err != nil {
		return err
	}
	logPath := logPath()
	path, err := servicePlistPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("service: create LaunchAgents dir: %w", err)
	}
	// launchd only creates the log files, not their parents: a missing dir
	// makes the job half-start (can't open StandardOutPath). Prepare it first.
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return fmt.Errorf("service: create log dir: %w", err)
	}
	if err := os.WriteFile(path, []byte(servicePlistContents(exe, logPath, serviceExtraEnv())), 0o644); err != nil {
		return fmt.Errorf("service: write plist: %w", err)
	}
	RecordPort(port())
	// Unload any old instance so the freshly written config is what loads;
	// bootout errors when nothing is loaded, which is fine.
	_ = exec.Command("launchctl", "bootout", serviceTarget()).Run()
	stopLocalBackendForService()
	if out, err := exec.Command("launchctl", "bootstrap", serviceDomain(), path).CombinedOutput(); err != nil {
		return fmt.Errorf("service: launchctl bootstrap: %v: %s", err, strings.TrimSpace(string(out)))
	}
	fmt.Println("service: installed and started")
	fmt.Printf("service: plist %s\n", path)
	fmt.Println("service: starts at login and restarts on crash (launchd KeepAlive)")
	fmt.Println("service: pause with `hapiy service stop`; remove with `hapiy service uninstall`")
	waitServiceBackend(30 * time.Second)
	return nil
}

func serviceStart(quiet bool) error {
	path, err := servicePlistPath()
	if err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		return errors.New("service: not installed (run `hapiy service install` first)")
	}
	if !serviceActive() {
		// An explicit start also means takeover: let the local stack yield so
		// it does not fight launchd's serve over the port and pidfiles.
		stopLocalBackendForService()
		if out, err := exec.Command("launchctl", "bootstrap", serviceDomain(), path).CombinedOutput(); err != nil {
			return fmt.Errorf("service: launchctl bootstrap: %v: %s", err, strings.TrimSpace(string(out)))
		}
		if !quiet {
			fmt.Println("service: started")
		}
		waitServiceBackend(30 * time.Second)
		return nil
	}
	// Already loaded: kickstart a throttled or stopped instance immediately.
	_ = exec.Command("launchctl", "kickstart", serviceTarget()).Run()
	if !quiet {
		fmt.Println("service: running")
	}
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
	if out, err := exec.Command("launchctl", "bootout", serviceTarget()).CombinedOutput(); err != nil {
		return fmt.Errorf("service: launchctl bootout: %v: %s", err, strings.TrimSpace(string(out)))
	}
	fmt.Println("service: paused (returns at next login; start now: hapiy service start)")
	return nil
}

func serviceUninstall() error {
	path, err := servicePlistPath()
	if err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		fmt.Println("service: not installed; nothing to remove")
		return nil
	}
	_ = exec.Command("launchctl", "bootout", serviceTarget()).Run()
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("service: remove plist: %w", err)
	}
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
		fmt.Println("service: installed and loaded (launchd, starts at login, restarts on crash)")
	default:
		fmt.Println("service: installed but not loaded (start now: hapiy service start)")
		code = serviceExitInstalledPaused
	}
	printServiceBackend()
	if code != 0 {
		return serviceStatusExit{code}
	}
	return nil
}
