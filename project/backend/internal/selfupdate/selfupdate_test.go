package selfupdate

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
		ok   bool
	}{
		{"1.2.0", "1.1.9", 1, true},
		{"1.1.0", "1.2.0", -1, true},
		{"1.0.0", "1.0.0", 0, true},
		{"v1.0.0", "1.0.1", -1, true},
		{"1.0", "1.0.0", 0, true},
		{"garbage", "1.0.0", 0, false},
		{"", "1.0.0", 0, false},
	}
	for _, c := range cases {
		got, ok := Compare(c.a, c.b)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("Compare(%q,%q) = (%d,%v), want (%d,%v)", c.a, c.b, got, ok, c.want, c.ok)
		}
	}
}

func TestVerifySHA256(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hapiy-darwin-universal.tar.gz")
	content := []byte("hello hapiy")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	sums := hex.EncodeToString(sum[:]) + "  hapiy-darwin-universal.tar.gz\n"

	if err := verifySHA256(path, "hapiy-darwin-universal.tar.gz", sums); err != nil {
		t.Fatalf("verify valid: %v", err)
	}
	if err := verifySHA256(path, "hapiy-darwin-universal.tar.gz", "deadbeef  hapiy-darwin-universal.tar.gz\n"); err == nil {
		t.Fatal("verify mismatch: want error, got nil")
	}
	if err := verifySHA256(path, "hapiy-darwin-universal.tar.gz", "abc  other.tar.gz\n"); err == nil {
		t.Fatal("verify missing entry: want error, got nil")
	}
}

func TestExtractTarGzRejectsTraversal(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "evil.tar.gz")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	body := []byte("pwned")
	if err := tw.WriteHeader(&tar.Header{Name: "../escape.txt", Mode: 0o644, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	if err := extractArchive(archive, filepath.Join(dir, "out")); err == nil {
		t.Fatal("extract traversal: want error, got nil")
	}
}

func TestAssetNameAndExeName(t *testing.T) {
	if _, ok := AssetName(); !ok {
		t.Skip("no release asset for this platform")
	}
	if ExeName() == "" {
		t.Fatal("ExeName is empty")
	}
}

// The version dialog keys its text off Phase: the download callback must flip
// to installing on the terminal progress report, and a failed upgrade must
// clear the phase so a stale "installing" cannot linger in the dialog.
func TestCheckerPhaseTransitions(t *testing.T) {
	c := NewChecker("1.0.0")
	if got := c.Status().Phase; got != "" {
		t.Fatalf("initial phase = %q, want empty", got)
	}
	if !c.BeginUpgrade() {
		t.Fatal("BeginUpgrade returned false")
	}
	if got := c.Status().Phase; got != PhaseDownloading {
		t.Fatalf("phase after begin = %q, want %q", got, PhaseDownloading)
	}
	c.SetDownloadProgress(10, 100)
	if got := c.Status().Phase; got != PhaseDownloading {
		t.Fatalf("phase mid-download = %q, want %q", got, PhaseDownloading)
	}
	c.SetDownloadProgress(100, 100)
	if got := c.Status().Phase; got != PhaseInstalling {
		t.Fatalf("phase at download end = %q, want %q", got, PhaseInstalling)
	}
	c.SetPhase(PhaseRestarting)
	if got := c.Status().Phase; got != PhaseRestarting {
		t.Fatalf("phase before restart = %q, want %q", got, PhaseRestarting)
	}
	c.EndUpgrade(errors.New("boom"))
	status := c.Status()
	if status.Upgrading || status.Phase != "" || status.UpgradeError == "" {
		t.Fatalf("after failure: %+v, want upgrading=false, phase empty, error set", status)
	}
}
