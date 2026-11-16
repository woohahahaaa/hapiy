package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newCaptureTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.LogCapture{}); err != nil {
		t.Fatal(err)
	}
	return db
}

// TestCaptureWritesBodyAndFilesToDisk proves the capture row carries a key
// instead of a body, and that the file slice is stored next to it with a URL
// the dashboard can preview.
func TestCaptureWritesBodyAndFilesToDisk(t *testing.T) {
	base := t.TempDir()
	InitCaptureStore(base)
	t.Cleanup(func() { InitCaptureStore(base) })

	db := newCaptureTestDB(t)
	writer := &LogCaptureWriter{db: db}

	writer.WriteLog(&LogCaptureData{
		RequestID: "req-capture-1",
		Stage:     "request_before",
		Type:      "request",
		ModelName: "gpt-image-2.6",
		Request: &HTTPCapture{
			Headers: map[string]string{"Content-Type": "multipart/form-data; boundary=x"},
			Body: map[string]interface{}{
				"model":  "gpt-image-2.6",
				"prompt": "把背景换成纯白",
				"image": map[string]interface{}{
					"$file":        float64(0),
					"filename":     "ref.png",
					"content_type": "image/png",
					"size":         float64(7),
				},
			},
		},
		Files: []CapturedFile{{
			Index:       0,
			FieldName:   "image",
			Filename:    "ref.png",
			ContentType: "image/png",
			Data:        []byte("PNGDATA"),
		}},
	})

	var row model.LogCapture
	if err := db.Where("request_id = ?", "req-capture-1").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.BodyKey == "" {
		t.Fatalf("body key missing: the body must not be stored in the row")
	}
	if len(row.RequestBody) != 0 {
		t.Fatalf("body should live on disk, row still carries %d inline entries", len(row.RequestBody))
	}

	raw, err := os.ReadFile(filepath.Join(base, filepath.FromSlash(row.BodyKey)))
	if err != nil {
		t.Fatalf("read captured body: %v", err)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("captured body is not JSON: %v", err)
	}
	file, ok := body["image"].(map[string]interface{})
	if !ok {
		t.Fatalf("file marker missing from the captured body: %v", body)
	}
	if file["url"] == nil || file["key"] == nil {
		t.Fatalf("file marker carries no preview link: %v", file)
	}

	// The slice itself is on disk, byte for byte.
	files, err := filepath.Glob(filepath.Join(base, "*", "req-capture-1", "files", "0-ref.png"))
	if err != nil || len(files) != 1 {
		t.Fatalf("captured file slice missing: %v %v", files, err)
	}
	stored, err := os.ReadFile(files[0])
	if err != nil || string(stored) != "PNGDATA" {
		t.Fatalf("captured file bytes: %q %v", stored, err)
	}

	// The read API still hands back a body, hydrated from disk.
	full, err := writer.ReadPair("req-capture-1")
	if err != nil {
		t.Fatalf("read pair: %v", err)
	}
	if full.Request == nil || full.Request.Before == nil {
		t.Fatalf("pair lost its request node")
	}
	if full.Request.Before.Body["prompt"] != "把背景换成纯白" {
		t.Fatalf("hydrated body lost its fields: %v", full.Request.Before.Body)
	}

	// Deleting the captures deletes the bytes too.
	if _, err := writer.DeleteFiles(LogDeleteParams{All: true}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	remaining, err := filepath.Glob(filepath.Join(base, "*", "req-capture-1"))
	if err != nil || len(remaining) != 0 {
		t.Fatalf("capture directory survived the delete: %v", remaining)
	}
}

func TestCaptureStoreRejectsKeysEscapingRoot(t *testing.T) {
	base := t.TempDir()
	InitCaptureStore(base)
	store := Captures()
	if store == nil {
		t.Fatal("store not initialized")
	}
	for _, key := range []string{"../secret", "/etc/passwd", "a/../../b"} {
		if _, err := store.Get(key); err == nil {
			t.Fatalf("key %q escaped the capture root", key)
		}
	}
}
