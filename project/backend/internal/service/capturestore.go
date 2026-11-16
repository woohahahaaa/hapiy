package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CapturedFile is one file slice hapiy received and shows in the log capture
// view. The bytes never enter the database: they are written next to the
// request's captured body and linked from it by key.
type CapturedFile struct {
	Index       int
	FieldName   string
	Filename    string
	ContentType string
	Data        []byte
}

// captureMaxBodyBytes caps a single captured body. A capture is a debugging
// aid, not a backup: a body larger than this is recorded as an omission
// instead of filling the disk.
const captureMaxBodyBytes = 20 << 20

// captureMaxFileBytes caps one captured file slice.
const captureMaxFileBytes = 20 << 20

// CaptureStore writes captured request/response bodies and their file slices
// to disk. Bodies live under <base>/<date>/<request_id>/, one file per stage,
// with any multipart slices in a files/ subdirectory next to the body.
type CaptureStore struct {
	base string
	mu   sync.Mutex
}

var globalCaptureStore *CaptureStore

// InitCaptureStore wires the store to the given base directory (normally
// <state dir>/captures). It runs once at startup; tests call it again to
// redirect the store into a temporary directory.
func InitCaptureStore(base string) {
	globalCaptureStore = &CaptureStore{base: resolveCaptureBase(base)}
}

// Captures returns the global capture store. Nil when it was never
// initialized.
func Captures() *CaptureStore {
	return globalCaptureStore
}

// resolveCaptureBase falls back to <state dir>/captures when the caller has no
// path to hand: HAPIY_STATE_DIR, then ~/.hapiy, then ./captures.
func resolveCaptureBase(base string) string {
	if base != "" {
		return base
	}
	if dir := os.Getenv("HAPIY_STATE_DIR"); dir != "" {
		return filepath.Join(dir, "captures")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "captures"
	}
	return filepath.Join(home, ".hapiy", "captures")
}

// Base returns the store's root directory ("" for a nil store).
func (s *CaptureStore) Base() string {
	if s == nil {
		return ""
	}
	return s.base
}

// Put writes one captured body and returns the key the row stores in place of
// the body itself.
func (s *CaptureStore) Put(requestID, stage string, content []byte) (string, error) {
	if s == nil || requestID == "" || stage == "" {
		return "", errors.New("capture store: missing request id or stage")
	}
	if len(content) > captureMaxBodyBytes {
		content = []byte(fmt.Sprintf(`{"__omitted":true,"size":%d}`, len(content)))
	}
	key := filepath.ToSlash(filepath.Join(time.Now().Format("2006-01-02"), sanitizeSegment(requestID), sanitizeSegment(stage)+".json"))
	return key, s.write(key, content)
}

// PutFile writes one file slice of a request and returns its key. Repeated
// calls for the same slice (request_before and request_after capture the same
// upload) are a cheap no-op.
func (s *CaptureStore) PutFile(requestID string, file CapturedFile) (string, error) {
	if s == nil || requestID == "" {
		return "", errors.New("capture store: missing request id")
	}
	if len(file.Data) > captureMaxFileBytes {
		return "", errors.New("capture store: file slice too large")
	}
	name := sanitizeSegment(file.Filename)
	if name == "" {
		name = "file"
	}
	key := filepath.ToSlash(filepath.Join(
		time.Now().Format("2006-01-02"),
		sanitizeSegment(requestID),
		"files",
		fmt.Sprintf("%d-%s", file.Index, name),
	))
	return key, s.write(key, file.Data)
}

// PutAt overwrites an existing key. Backfills (a streamed response body only
// known after the stream ends) must land on the same file the row points at.
func (s *CaptureStore) PutAt(key string, content []byte) error {
	if s == nil {
		return errors.New("capture store: not initialized")
	}
	if len(content) > captureMaxBodyBytes {
		content = []byte(fmt.Sprintf(`{"__omitted":true,"size":%d}`, len(content)))
	}
	return s.write(key, content)
}

// Get reads a captured blob by key. Keys coming from a row are relative paths
// inside the store; anything escaping the root is rejected.
func (s *CaptureStore) Get(key string) ([]byte, error) {
	path, err := s.resolve(key)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(path)
}

// DeleteRequests removes the capture directories of the given requests.
func (s *CaptureStore) DeleteRequests(requestIDs []string) {
	if s == nil {
		return
	}
	for _, requestID := range requestIDs {
		if requestID == "" {
			continue
		}
		matches, err := filepath.Glob(filepath.Join(s.base, "*", sanitizeSegment(requestID)))
		if err != nil {
			continue
		}
		for _, dir := range matches {
			_ = os.RemoveAll(dir)
		}
	}
}

// DeleteAll empties the store.
func (s *CaptureStore) DeleteAll() {
	if s == nil || s.base == "" {
		return
	}
	entries, err := os.ReadDir(s.base)
	if err != nil {
		return
	}
	for _, entry := range entries {
		_ = os.RemoveAll(filepath.Join(s.base, entry.Name()))
	}
}

// write stores one blob, creating the parent directory on demand.
func (s *CaptureStore) write(key string, content []byte) error {
	path, err := s.resolve(key)
	if err != nil {
		return err
	}
	if info, statErr := os.Stat(path); statErr == nil && info.Size() == int64(len(content)) {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// resolve maps a stored key to an absolute path inside the store root.
func (s *CaptureStore) resolve(key string) (string, error) {
	if s == nil || s.base == "" {
		return "", errors.New("capture store: not initialized")
	}
	clean := filepath.Clean(filepath.FromSlash(key))
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return "", fmt.Errorf("capture store: invalid key %q", key)
	}
	root, err := filepath.Abs(s.base)
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, clean)
	if !strings.HasPrefix(path, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("capture store: key escapes root %q", key)
	}
	return path, nil
}

// sanitizeSegment keeps a path segment safe: no separators, no traversal.
func sanitizeSegment(value string) string {
	replaced := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '.', r == '-', r == '_':
			return r
		}
		return '_'
	}, value)
	replaced = strings.Trim(replaced, ".")
	if len(replaced) > 96 {
		replaced = replaced[:96]
	}
	return replaced
}
