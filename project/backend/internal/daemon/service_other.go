//go:build !darwin && !linux && !windows

package daemon

import "errors"

// Other platforms (*BSD, …) have no service-manager implementation yet: the
// detached `hapiy up` supervisor still works, just without login autostart.
var errServiceUnsupported = errors.New("service: autostart is not supported on this platform")

func serviceInstalled() bool { return false }

func serviceActive() bool { return false }

func serviceInstall() error { return errServiceUnsupported }

func serviceUninstall() error { return errServiceUnsupported }

func serviceStart(quiet bool) error { return errServiceUnsupported }

func serviceStop(quiet bool) error { return errServiceUnsupported }

func serviceStatus() error { return errServiceUnsupported }
