package middleware

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// A self-upgrade restarts the backend; sessions written to disk must still be
// accepted by the new process, or every open dashboard lands on /login.
func TestSessionStoreSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	first := NewSessionStoreAt(path)
	token := first.Issue("admin")

	second := NewSessionStoreAt(path)
	if user, ok := second.Lookup(token); !ok || user != "admin" {
		t.Fatalf("after reload lookup = %q, %v; want admin, true", user, ok)
	}

	// Logout must drop the token from disk too, not just from memory.
	second.Revoke(token)
	third := NewSessionStoreAt(path)
	if _, ok := third.Lookup(token); ok {
		t.Fatal("revoked token came back after reload")
	}
}

func TestSessionStoreFilePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	NewSessionStoreAt(path).Issue("admin")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("mode = %o, want 600", got)
	}
}

// A damaged state file must not lock the user out: the store starts empty and
// login works again.
func TestSessionStoreIgnoresMalformedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	s := NewSessionStoreAt(path)
	token := s.Issue("admin")
	if user, ok := s.Lookup(token); !ok || user != "admin" {
		t.Fatalf("lookup = %q, %v; want admin, true", user, ok)
	}
}

// Issue/Lookup run on different request goroutines; guard the map against
// concurrent access (the store is shared by every dashboard request).
func TestSessionStoreConcurrentAccess(t *testing.T) {
	s := NewSessionStore()
	done := make(chan struct{})
	for i := 0; i < 8; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			for j := 0; j < 50; j++ {
				token := s.Issue("admin")
				if _, ok := s.Lookup(token); !ok {
					t.Error("token issued and immediately lost")
					return
				}
				s.Revoke(token)
			}
		}()
	}
	for i := 0; i < 8; i++ {
		<-done
	}
}

func TestSessionStoreJSONShape(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	s := NewSessionStoreAt(path)
	token := s.Issue("admin")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var tokens map[string]string
	if err := json.Unmarshal(raw, &tokens); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if tokens[token] != "admin" {
		t.Fatalf("file = %v, want %s -> admin", tokens, token)
	}
}
