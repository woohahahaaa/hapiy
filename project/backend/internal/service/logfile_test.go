package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestLogFileWriter(t *testing.T) *LogFileWriter {
	t.Helper()
	return &LogFileWriter{dir: t.TempDir()}
}

func TestWriteLog_writes_json_to_prefix_subdirectory(t *testing.T) {
	// Given
	writer := newTestLogFileWriter(t)
	ts := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	data := &LogCaptureData{RequestID: "req-123", Timestamp: ts, Type: "response", Prefix: "_relay"}

	// When
	writer.WriteLog(data)

	// Then
	files, err := os.ReadDir(filepath.Join(writer.dir, "_relay"))
	if err != nil {
		t.Fatalf("read prefix dir: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("files: want 1, got %d", len(files))
	}
	name := files[0].Name()
	if !strings.HasSuffix(name, "-req-123-response.json") {
		t.Fatalf("filename: unexpected %q", name)
	}
	content, err := os.ReadFile(filepath.Join(writer.dir, "_relay", name))
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if !strings.Contains(string(content), `"request_id": "req-123"`) {
		t.Fatalf("content missing request_id: %s", content)
	}
}

func TestWriteLog_sanitizes_request_id_and_prefix(t *testing.T) {
	// Given
	writer := newTestLogFileWriter(t)
	data := &LogCaptureData{RequestID: "../../etc/passwd", Timestamp: time.Now(), Type: "request", Prefix: "../escape"}

	// When
	writer.WriteLog(data)

	// Then: no file escapes the base dir
	baseEntries, err := os.ReadDir(writer.dir)
	if err != nil {
		t.Fatalf("read base dir: %v", err)
	}
	if len(baseEntries) != 1 {
		t.Fatalf("base entries: want 1 (sanitized prefix dir), got %d", len(baseEntries))
	}
	if !baseEntries[0].IsDir() {
		t.Fatalf("expected a sanitized prefix directory")
	}
}

func TestListFiles_filters_and_paginates_newest_first(t *testing.T) {
	// Given
	writer := newTestLogFileWriter(t)
	base := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	for i, prefix := range []string{"", "_relay"} {
		for _, typ := range []string{"request", "response", "system"} {
			writer.WriteLog(&LogCaptureData{
				RequestID: "req" + string(rune('a'+i)),
				Timestamp: base.Add(time.Duration(i) * time.Hour),
				Type:      typ,
				Prefix:    prefix,
			})
		}
	}

	// When: filter by type and paginate
	entries, total, err := writer.ListFiles(LogListParams{Types: []string{"response"}, Limit: 1, Offset: 0})
	if err != nil {
		t.Fatalf("list files: %v", err)
	}

	// Then
	if total != 2 {
		t.Fatalf("total: want 2, got %d", total)
	}
	if len(entries) != 1 {
		t.Fatalf("page size: want 1, got %d", len(entries))
	}
	if !strings.HasSuffix(entries[0].Name, "-response.json") {
		t.Fatalf("page entry: unexpected %q", entries[0].Name)
	}

	// When: filter by prefix
	prefixed, prefixedTotal, err := writer.ListFiles(LogListParams{Prefix: "_relay"})
	if err != nil {
		t.Fatalf("list by prefix: %v", err)
	}	// Then
	if prefixedTotal != 3 {
		t.Fatalf("prefix total: want 3, got %d", prefixedTotal)
	}
	for _, entry := range prefixed {
		if entry.Prefix != "_relay" {
			t.Fatalf("entry prefix: want _relay, got %q", entry.Prefix)
		}
	}
}

func TestReadFile_returns_content_and_rejects_traversal(t *testing.T) {
	// Given
	writer := newTestLogFileWriter(t)
	writer.WriteLog(&LogCaptureData{RequestID: "req-1", Timestamp: time.Now(), Type: "request", Prefix: "cap"})

	files, _, err := writer.ListFiles(LogListParams{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("files: want 1, got %d", len(files))
	}

	// When
	content, err := writer.ReadFile(files[0].ID)

	// Then
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(content), `"request_id": "req-1"`) {
		t.Fatalf("content: %s", content)
	}

	// When: traversal attempt
	_, err = writer.ReadFile("../hapiy.db")
	// Then
	if err == nil {
		t.Fatalf("traversal must be rejected")
	}
}

func TestParseLogFileName_round_trips_dashed_request_id(t *testing.T) {
	// Given
	ts := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	name := fileTimestamp(ts) + "-abcd-1234-efgh-response.json"

	// When
	parsed, id, typ, ok := parseLogFileName(name)

	// Then
	if !ok {
		t.Fatalf("parse failed")
	}
	if !parsed.Equal(ts) {
		t.Fatalf("timestamp: want %v, got %v", ts, parsed)
	}
	if id != "abcd-1234-efgh" {
		t.Fatalf("id: want abcd-1234-efgh, got %q", id)
	}
	if typ != "response" {
		t.Fatalf("type: want response, got %q", typ)
	}
}
