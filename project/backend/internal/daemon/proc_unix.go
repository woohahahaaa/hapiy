//go:build unix

package daemon

import (
	"errors"
	"fmt"
	"os/exec"
	"syscall"
)

// applyDetach makes the re-exec'd supervisor a new session leader (Setsid),
// detached from the controlling terminal, so the shell / Finder that launched
// it cannot take it down. stdin is left nil, which os/exec already points at
// /dev/null — exactly what we want.
func applyDetach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}

// processAlive probes with signal 0: nil means alive, EPERM means alive but
// owned by another user, ESRCH means gone.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// terminateProcess sends SIGTERM so serve can shut down cleanly. An already
// gone process counts as success.
func terminateProcess(pid int) error {
	if pid <= 0 {
		return fmt.Errorf("invalid pid %d", pid)
	}
	if err := syscall.Kill(pid, syscall.SIGTERM); err != nil && !errors.Is(err, syscall.ESRCH) {
		return fmt.Errorf("kill(pid=%d, SIGTERM): %w", pid, err)
	}
	return nil
}
