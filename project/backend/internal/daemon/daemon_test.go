package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadPIDFile(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name    string
		content string
		want    int
	}{
		{"missing", "", 0},
		{"valid", "1234\n", 1234},
		{"garbage", "not-a-pid", 0},
		{"zero", "0\n", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(dir, tc.name)
			if tc.content != "" {
				if err := os.WriteFile(path, []byte(tc.content), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if got := readPIDFile(path); got != tc.want {
				t.Fatalf("readPIDFile(%s) = %d, want %d", tc.name, got, tc.want)
			}
		})
	}
}

func TestClaimSupervisor(t *testing.T) {
	path := filepath.Join(t.TempDir(), "up.pid")

	// Fresh path: first claim wins and records our own pid.
	claimed, err := claimSupervisor(path)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if !claimed {
		t.Fatal("first claim should win")
	}
	if got := readPIDFile(path); got != os.Getpid() {
		t.Fatalf("pidfile = %d, want %d", got, os.Getpid())
	}

	// Second claim while the owner (us) is alive must yield.
	claimed, err = claimSupervisor(path)
	if err != nil {
		t.Fatalf("second claim: %v", err)
	}
	if claimed {
		t.Fatal("second claim should yield to a live supervisor")
	}

	// A stale pidfile (dead pid) is replaced.
	if err := os.WriteFile(path, []byte(fmt.Sprintf("%d\n", 999999)), 0o644); err != nil {
		t.Fatal(err)
	}
	claimed, err = claimSupervisor(path)
	if err != nil {
		t.Fatalf("stale claim: %v", err)
	}
	if !claimed {
		t.Fatal("stale pidfile should be replaced")
	}
	if got := readPIDFile(path); got != os.Getpid() {
		t.Fatalf("pidfile after stale reclaim = %d, want %d", got, os.Getpid())
	}
	os.Remove(path)
}

// TestRecordServePort pins the rule that keeps <state>/port the console port:
// only a production server may write it. A development serve is the API
// sidecar behind Vite, and its 8080 used to overwrite the 18009 alive had
// remembered, so the next ./alive.sh run started on the wrong port.
func TestRecordServePort(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HAPIY_STATE_DIR", dir)
	path := filepath.Join(dir, "port")

	RecordServePort("development", "8080")
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("development serve wrote %s (err %v), want the file untouched", path, err)
	}

	RecordServePort("production", "18009")
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("production serve did not record its port: %v", err)
	}
	if want := "18009\n"; string(got) != want {
		t.Fatalf("port file = %q, want %q", got, want)
	}
}

// TestServeEnv checks the supervised serve is told the port its supervisor
// probes, so `up` cannot end up watching 18009 while the child binds 8080.
func TestServeEnv(t *testing.T) {
	t.Setenv("HAPIY_PORT", "")

	state := t.TempDir()
	t.Setenv("HAPIY_STATE_DIR", state)
	if err := os.WriteFile(filepath.Join(state, "port"), []byte("18009\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := lastEnvValue(serveEnv(), "HAPIY_PORT"); got != "18009" {
		t.Fatalf("serveEnv HAPIY_PORT = %q, want 18009 (from the port file)", got)
	}

	// No file, no env: fall back to the default, still agreeing with port().
	t.Setenv("HAPIY_STATE_DIR", t.TempDir())
	if got := lastEnvValue(serveEnv(), "HAPIY_PORT"); got != "8080" {
		t.Fatalf("serveEnv HAPIY_PORT = %q, want 8080 (default)", got)
	}
}

// TestServeEnvFillsStateLayout is the regression test for the desktop shell's
// crash loop. The macOS/Windows shells run `hapiy up` with nothing but
// HAPIY_PORT, and the supervised serve then resolved its database (and the
// encryption key next to it) against the caller's cwd — the macOS app's is "/",
// where nothing can be written. serve exited on startup, the supervisor
// restarted it every second, and the window sat on "服务未启动 / 重启失败" with
// no way to tell why. The layout now follows the state dir unless the caller
// set it.
func TestServeEnvFillsStateLayout(t *testing.T) {
	state := t.TempDir()
	t.Setenv("HAPIY_STATE_DIR", state)
	t.Setenv("HAPIY_PORT", "18009")
	t.Setenv("HAPIY_DB_PATH", "")
	t.Setenv("HAPIY_LOG_DIR", "")
	t.Setenv("HAPIY_WEB_DIST", "")

	env := serveEnv()
	for _, tc := range []struct{ key, want string }{
		{"HAPIY_STATE_DIR", state},
		{"HAPIY_DB_PATH", filepath.Join(state, "hapiy.db")},
		{"HAPIY_LOG_DIR", filepath.Join(state, "logs")},
	} {
		if got := lastEnvValue(env, tc.key); got != tc.want {
			t.Fatalf("%s = %q, want %q", tc.key, got, tc.want)
		}
	}

	// A layout the caller set wins (alive.sh and the dev sidecar pass their own).
	t.Setenv("HAPIY_DB_PATH", "/custom/live.db")
	if got := lastEnvValue(serveEnv(), "HAPIY_DB_PATH"); got != "/custom/live.db" {
		t.Fatalf("HAPIY_DB_PATH = %q, want the caller's /custom/live.db", got)
	}
}

// TestStateLayoutEnvWebDist keeps HAPIY_WEB_DIST tied to a webdist that really
// sits next to the binary, so the console is served from the install location
// and an API-only install stays API-only.
func TestStateLayoutEnvWebDist(t *testing.T) {
	state := t.TempDir()
	t.Setenv("HAPIY_STATE_DIR", state)

	appDir := t.TempDir()
	exe := filepath.Join(appDir, "hapiy")
	if got := envPair(stateLayoutEnv(exe), "HAPIY_WEB_DIST"); got != "" {
		t.Fatalf("HAPIY_WEB_DIST = %q with no webdist, want none", got)
	}

	webDist := filepath.Join(appDir, "webdist")
	if err := os.Mkdir(webDist, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := envPair(stateLayoutEnv(exe), "HAPIY_WEB_DIST"); got != webDist {
		t.Fatalf("HAPIY_WEB_DIST = %q, want %q", got, webDist)
	}
}

// lastEnvValue reads the value os/exec would pick: duplicate keys keep the last.
func lastEnvValue(env []string, key string) string {
	value := ""
	for _, kv := range env {
		if strings.HasPrefix(kv, key+"=") {
			value = strings.TrimPrefix(kv, key+"=")
		}
	}
	return value
}

// envPair reads one value out of the [][2]string form the service units use.
func envPair(pairs [][2]string, key string) string {
	for _, kv := range pairs {
		if kv[0] == key {
			return kv[1]
		}
	}
	return ""
}
