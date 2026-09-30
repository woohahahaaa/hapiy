package daemon

import (
	"fmt"
	"os"
	"path/filepath"
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