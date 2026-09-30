//go:build windows

package daemon

import (
	"errors"
	"fmt"
	"os"
	"os/exec"

	"golang.org/x/sys/windows"
)

// applyDetach detaches the supervisor from the Explorer / app shell that
// double-clicked it: DETACHED_PROCESS has no console, and CREATE_NEW_PROCESS_GROUP
// + CREATE_NO_WINDOW keep a shell exit or window close from touching it. For a
// windowsgui build there is no stderr anyway; the supervisor wires its child's
// stdout/stderr into the log file itself.
func applyDetach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &windows.SysProcAttr{
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS | windows.CREATE_NO_WINDOW,
	}
}

// processAlive probes via OpenProcess; Windows has no kill(pid, 0), so a failed
// open means the process is gone.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	_ = windows.CloseHandle(h)
	return true
}

// terminateProcess kills the process. Windows has no SIGTERM, so Kill is the
// only option; serve's state is mirrored on disk, so at most one window of
// state is lost.
func terminateProcess(pid int) error {
	if pid <= 0 {
		return fmt.Errorf("invalid pid %d", pid)
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		// Same meaning as ESRCH on unix: already gone.
		return nil
	}
	if err := proc.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return fmt.Errorf("terminate pid %d: %w", pid, err)
	}
	return nil
}
