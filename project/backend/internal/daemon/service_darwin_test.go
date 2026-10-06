//go:build darwin

package daemon

import (
	"strings"
	"testing"
)

// The LaunchAgent must run `serve` and carry the install-rooted environment so
// the installed backend uses ~/.hapiy for state and the webdist next to it.
func TestServicePlistContents(t *testing.T) {
	env := [][2]string{
		{"HAPIY_ENV", "production"},
		{"HAPIY_PORT", "18009"},
		{"HAPIY_DB_PATH", "/Users/me/.hapiy/hapiy.db"},
		{"HAPIY_WEB_DIST", "/Users/me/.hapiy/app/webdist"},
	}
	got := servicePlistContents("/Users/me/.hapiy/app/hapiy", "/Users/me/.hapiy/log/hapiy.log", env)

	for _, want := range []string{
		"<string>com.hapiy.agent</string>",
		"<string>/Users/me/.hapiy/app/hapiy</string>",
		"<string>serve</string>",
		"<key>RunAtLoad</key>",
		"<key>KeepAlive</key>",
		"<key>HAPIY_PORT</key><string>18009</string>",
		"<key>HAPIY_WEB_DIST</key><string>/Users/me/.hapiy/app/webdist</string>",
		"<string>/Users/me/.hapiy/log/hapiy.log</string>",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("plist missing %q\n%s", want, got)
		}
	}
}

// XML reserved characters in paths must be escaped or launchd rejects the unit.
func TestServicePlistEscapesAmpersand(t *testing.T) {
	got := servicePlistContents("/Users/a&b/hapiy", "/tmp/l&g.log", nil)
	if strings.Contains(got, "a&b") && !strings.Contains(got, "a&amp;b") {
		t.Fatalf("exe path not XML-escaped:\n%s", got)
	}
	if !strings.Contains(got, "l&amp;g.log") {
		t.Fatalf("log path not XML-escaped:\n%s", got)
	}
}
