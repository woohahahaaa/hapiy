package affinity

import (
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTestStore(t *testing.T) (*Store, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.Setting{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return NewStore(db), db
}

func TestLoadDefaults(t *testing.T) {
	store, _ := newTestStore(t)
	setting, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if setting.Enabled {
		t.Fatalf("expected disabled by default")
	}
	if setting.TTLSeconds != DefaultTTLSeconds {
		t.Fatalf("expected default ttl %d, got %d", DefaultTTLSeconds, setting.TTLSeconds)
	}
	if len(setting.SessionIDFields) != 0 || len(setting.ModelFields) != 0 {
		t.Fatalf("expected empty field lists, got %+v", setting)
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	store, _ := newTestStore(t)
	saved := &Setting{
		Enabled:         true,
		SessionIDFields: []string{"X-Session-Id", "X-Conversation-Id"},
		ModelFields:     []string{"model"},
		TTLSeconds:      600,
	}
	if err := store.Save(saved); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if !loaded.Enabled || loaded.TTLSeconds != 600 {
		t.Fatalf("unexpected enabled/ttl: %+v", loaded)
	}
	if len(loaded.SessionIDFields) != 2 || loaded.SessionIDFields[0] != "X-Session-Id" {
		t.Fatalf("unexpected session fields: %+v", loaded.SessionIDFields)
	}
}

func TestSaveNormalizesInvalidTTL(t *testing.T) {
	store, _ := newTestStore(t)
	if err := store.Save(&Setting{Enabled: true, TTLSeconds: 0}); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.TTLSeconds != DefaultTTLSeconds {
		t.Fatalf("expected ttl normalized to %d, got %d", DefaultTTLSeconds, loaded.TTLSeconds)
	}
}

// The pre-merge layout stored rules and the fallback in separate settings;
// Load must derive the merged config from both so an upgrade keeps the
// configured fields.
func TestLoadDerivesFromLegacySettings(t *testing.T) {
	store, db := newTestStore(t)
	legacyRules := `{"enabled":true,"default_ttl_seconds":900,"rules":[` +
		`{"name":"off","enabled":false,"session_id_fields":["X-Ignored"]},` +
		`{"name":"workbuddy","enabled":true,"session_id_fields":["X-Session-Id"],"model_fields":["model"],"ttl_seconds":300}]}`
	legacyFallback := `{"enabled":true,"session_id_fields":["X-Conversation-Id"],"model_fields":["model_name"]}`
	if err := db.Create(&model.Setting{Key: legacyRulesKey, Value: legacyRules}).Error; err != nil {
		t.Fatalf("seed legacy rules: %v", err)
	}
	if err := db.Create(&model.Setting{Key: legacyFallbackKey, Value: legacyFallback}).Error; err != nil {
		t.Fatalf("seed legacy fallback: %v", err)
	}

	setting, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if !setting.Enabled {
		t.Fatalf("expected enabled from legacy config")
	}
	if setting.TTLSeconds != 300 {
		t.Fatalf("expected the enabled rule's ttl 300, got %d", setting.TTLSeconds)
	}
	wantSession := []string{"X-Session-Id", "X-Conversation-Id"}
	if len(setting.SessionIDFields) != len(wantSession) {
		t.Fatalf("unexpected session fields: %+v", setting.SessionIDFields)
	}
	for i, want := range wantSession {
		if setting.SessionIDFields[i] != want {
			t.Fatalf("session field %d: want %q, got %q", i, want, setting.SessionIDFields[i])
		}
	}
	if len(setting.ModelFields) != 2 || setting.ModelFields[0] != "model" || setting.ModelFields[1] != "model_name" {
		t.Fatalf("unexpected model fields: %+v", setting.ModelFields)
	}
}

func TestLoadLegacyDisabled(t *testing.T) {
	store, db := newTestStore(t)
	legacyFallback := `{"enabled":false,"session_id_fields":["X-Session-Id"]}`
	if err := db.Create(&model.Setting{Key: legacyFallbackKey, Value: legacyFallback}).Error; err != nil {
		t.Fatalf("seed legacy fallback: %v", err)
	}
	setting, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if setting.Enabled {
		t.Fatalf("a disabled legacy fallback must not enable the merged setting")
	}
}

func TestExtractHeaderField(t *testing.T) {
	req := &Request{Headers: map[string]string{"x-session-id": " abc ", "X-Other": "v"}}
	if got := ExtractHeaderField(req, []string{"X-Missing", "X-Session-Id"}); got != "abc" {
		t.Fatalf("expected first non-empty header trimmed, got %q", got)
	}
	if got := ExtractHeaderField(req, []string{"X-Missing"}); got != "" {
		t.Fatalf("expected empty when no field matches, got %q", got)
	}
}

func TestExtractBodyField(t *testing.T) {
	req := &Request{Body: []byte(`{"model_alias":"gpt-4-from-body","model":"gpt-4"}`)}
	if got := ExtractBodyField(req, []string{"model_alias", "model"}); got != "gpt-4-from-body" {
		t.Fatalf("expected first readable body path, got %q", got)
	}
	if got := ExtractBodyField(&Request{}, []string{"model"}); got != "" {
		t.Fatalf("expected empty for an empty body, got %q", got)
	}
}
