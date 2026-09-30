package model

import (
	"os"
	"path/filepath"
	"testing"
)

func fileSize(t *testing.T, path string) int64 {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	return fi.Size()
}

func TestShrinkDatabaseReclaimsFreedPages(t *testing.T) {
	path := filepath.Join(t.TempDir(), "verify.db")
	db, err := InitDB(path)
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	if err := db.Exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, payload BLOB)").Error; err != nil {
		t.Fatalf("create: %v", err)
	}
	for i := 0; i < 200; i++ {
		if err := db.Exec("INSERT INTO blobs (payload) VALUES (zeroblob(100000))").Error; err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	bloated := fileSize(t, path)
	if bloated < 10_000_000 {
		t.Fatalf("expected bloated file, got %d", bloated)
	}
	if err := db.Exec("DELETE FROM blobs").Error; err != nil {
		t.Fatalf("delete: %v", err)
	}
	if fileSize(t, path) != bloated {
		t.Fatalf("delete should not shrink the file")
	}
	if err := ShrinkDatabase(db); err != nil {
		t.Fatalf("ShrinkDatabase: %v", err)
	}
	shrunk := fileSize(t, path)
	t.Logf("bloated=%d shrunk=%d", bloated, shrunk)
	if shrunk >= bloated/2 {
		t.Fatalf("ShrinkDatabase did not reclaim: %d -> %d", bloated, shrunk)
	}

	// No free pages -> no-op, must not error.
	if err := ShrinkDatabase(db); err != nil {
		t.Fatalf("ShrinkDatabase no-op: %v", err)
	}
	if fileSize(t, path) != shrunk {
		t.Fatalf("no-op ShrinkDatabase changed the file size")
	}
}
