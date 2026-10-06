// Package version is the single source of truth for the hapiy backend version.
// It is reported by `hapiy version`, echoed by /health, and compared against
// the latest GitHub release by the self-update checker.
package version

// Version is the running build's version (x.y.z). Bump it by hand, or let
// scripts/release.sh take an explicit value.
const Version = "1.0.0"
