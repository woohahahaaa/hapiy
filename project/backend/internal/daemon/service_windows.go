//go:build windows

package daemon

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
)

const serviceWindowsTaskName = "hapiy"

func serviceLauncherPath() (string, error) {
	exe, err := serviceExecutable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(exe), "hapiy-service.cmd"), nil
}

// serviceLauncherContents is a tiny launcher that pins the install-rooted
// environment (Task Scheduler XML has no EnvironmentVariables) and then runs
// `up --supervise`, which owns crash restarts and log collection.
func serviceLauncherContents(exe string, env [][2]string) string {
	var b strings.Builder
	b.WriteString("@echo off\r\n")
	for _, kv := range env {
		fmt.Fprintf(&b, "set \"%s=%s\"\r\n", kv[0], strings.ReplaceAll(kv[1], "\"", ""))
	}
	fmt.Fprintf(&b, "\"%s\" up --supervise\r\n", exe)
	return b.String()
}

// serviceTaskXML starts the launcher at logon. The launcher's supervisor keeps
// serve alive.
func serviceTaskXML(launcher, userID string) string {
	triggerUser := ""
	if userID != "" {
		triggerUser = "      <UserId>" + xmlEscape(userID) + "</UserId>\n"
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>hapiy: start at logon, keep it running.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
%s    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>/c "%s"</Arguments>
    </Exec>
  </Actions>
</Task>
`, triggerUser, xmlEscape(launcher))
}

func utf16LEWithBOM(s string) []byte {
	units := utf16.Encode([]rune(s))
	buf := make([]byte, 2+len(units)*2)
	buf[0], buf[1] = 0xFF, 0xFE
	for i, u := range units {
		binary.LittleEndian.PutUint16(buf[2+i*2:], u)
	}
	return buf
}

func serviceInstalled() bool {
	return exec.Command("schtasks", "/Query", "/TN", serviceWindowsTaskName).Run() == nil
}

// serviceActive uses the PowerShell State enum, avoiding schtasks' localized
// output.
func serviceActive() bool {
	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command",
		"(Get-ScheduledTask -TaskName '"+serviceWindowsTaskName+"').State").Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(out)) == "Running"
}

func serviceInstall() error {
	exe, err := serviceExecutable()
	if err != nil {
		return err
	}
	launcher, err := serviceLauncherPath()
	if err != nil {
		return err
	}
	if err := os.WriteFile(launcher, []byte(serviceLauncherContents(exe, serviceExtraEnv())), 0o644); err != nil {
		return fmt.Errorf("service: write launcher: %w", err)
	}
	RecordPort(port())
	userID := ""
	if u, err := user.Current(); err == nil {
		userID = u.Username
	}
	tmp, err := os.CreateTemp("", "hapiy-task-*.xml")
	if err != nil {
		return fmt.Errorf("service: create temp file: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(utf16LEWithBOM(serviceTaskXML(launcher, userID))); err != nil {
		tmp.Close()
		return fmt.Errorf("service: write task xml: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("service: write task xml: %w", err)
	}
	// Stop any old instance first: IgnoreNew silently no-ops /Run otherwise.
	_, _ = exec.Command("schtasks", "/End", "/TN", serviceWindowsTaskName).CombinedOutput()
	stopLocalBackendForService()
	if out, err := exec.Command("schtasks", "/Create", "/F", "/TN", serviceWindowsTaskName, "/XML", tmp.Name()).CombinedOutput(); err != nil {
		return fmt.Errorf("service: schtasks /Create: %v: %s", err, strings.TrimSpace(string(out)))
	}
	if out, err := exec.Command("schtasks", "/Run", "/TN", serviceWindowsTaskName).CombinedOutput(); err != nil {
		return fmt.Errorf("service: schtasks /Run: %v: %s", err, strings.TrimSpace(string(out)))
	}
	fmt.Println("service: installed and started (Task Scheduler, starts at logon)")
	fmt.Println("service: crash restarts are handled by the `up --supervise` daemon")
	fmt.Println("service: pause with `hapiy service stop`; remove with `hapiy service uninstall`")
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
	if out, err := exec.Command("schtasks", "/Run", "/TN", serviceWindowsTaskName).CombinedOutput(); err != nil {
		return fmt.Errorf("service: schtasks /Run: %v: %s", err, strings.TrimSpace(string(out)))
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
	_, _ = exec.Command("schtasks", "/End", "/TN", serviceWindowsTaskName).CombinedOutput()
	// Ending the task alone may not take the child serve with it: clean up by
	// pidfile identity so the port frees and the local stack can take over.
	stopLocalBackendForService()
	fmt.Println("service: paused (returns at next logon; start now: hapiy service start)")
	return nil
}

func serviceUninstall() error {
	if !serviceInstalled() {
		fmt.Println("service: not installed; nothing to remove")
		return nil
	}
	if out, err := exec.Command("schtasks", "/Delete", "/F", "/TN", serviceWindowsTaskName).CombinedOutput(); err != nil {
		return fmt.Errorf("service: schtasks /Delete: %v: %s", err, strings.TrimSpace(string(out)))
	}
	if launcher, err := serviceLauncherPath(); err == nil {
		_ = os.Remove(launcher)
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
		fmt.Println("service: installed and running (Task Scheduler, starts at logon, up daemon restarts serve)")
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
