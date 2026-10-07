package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newBackupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "test.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.Provider{},
		&model.Token{},
		&model.Setting{},
		&model.BackupRecord{},
	); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	SetBackupBaseDir(dir)
	t.Cleanup(func() { SetBackupBaseDir("") })
	return db
}

func TestRunBackupDetectsNoChange(t *testing.T) {
	db := newBackupTestDB(t)
	if err := db.Create(&model.Provider{ID: "p1", Name: "one"}).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}

	first, err := RunBackup(db, BackupOptions{Modules: []string{"providers"}, Path: "backups"})
	if err != nil {
		t.Fatalf("first backup: %v", err)
	}
	if !first.FileCreated || first.Record.Unchanged {
		t.Fatalf("first run should write a file, got created=%v unchanged=%v", first.FileCreated, first.Record.Unchanged)
	}
	info, err := os.Stat(filepath.Join(first.Record.Path, first.Record.FileName))
	if err != nil {
		t.Fatalf("stat backup file: %v", err)
	}
	if info.Size() == 0 || first.Record.SizeBytes == 0 {
		t.Fatalf("backup file should not be empty")
	}

	second, err := RunBackup(db, BackupOptions{Modules: []string{"providers"}, Path: "backups"})
	if err != nil {
		t.Fatalf("second backup: %v", err)
	}
	if second.FileCreated || !second.Record.Unchanged || second.Record.FileName != "" {
		t.Fatalf("unchanged run must not write a file: created=%v unchanged=%v name=%q",
			second.FileCreated, second.Record.Unchanged, second.Record.FileName)
	}

	if err := db.Model(&model.Provider{}).Where("id = ?", "p1").Update("name", "two").Error; err != nil {
		t.Fatalf("update provider: %v", err)
	}
	third, err := RunBackup(db, BackupOptions{Modules: []string{"providers"}, Path: "backups"})
	if err != nil {
		t.Fatalf("third backup: %v", err)
	}
	if !third.FileCreated || third.Record.Unchanged {
		t.Fatalf("changed content should write a new file")
	}

	records, total, err := ListBackupRecords(db, 10, 0)
	if err != nil {
		t.Fatalf("list records: %v", err)
	}
	if total != 3 || len(records) != 3 {
		t.Fatalf("expected 3 records, got total=%d len=%d", total, len(records))
	}
	if records[0].ID != third.Record.ID {
		t.Fatalf("records should be newest first")
	}
}

func TestRestoreBackupRoundTrip(t *testing.T) {
	db := newBackupTestDB(t)
	token := model.Token{ID: "t1", Name: "before", Key: "k1", Status: true}
	if err := db.Create(&token).Error; err != nil {
		t.Fatalf("create token: %v", err)
	}

	backup, err := RunBackup(db, BackupOptions{Modules: []string{"tokens"}, Path: "backups"})
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	if backup.Record.ModulesList[0] != "tokens" {
		t.Fatalf("record modules not stored: %#v", backup.Record.ModulesList)
	}

	if err := db.Model(&model.Token{}).Where("id = ?", "t1").Update("name", "after").Error; err != nil {
		t.Fatalf("update token: %v", err)
	}
	if err := db.Create(&model.Token{ID: "t2", Name: "extra", Key: "k2", Status: true}).Error; err != nil {
		t.Fatalf("create extra token: %v", err)
	}

	result, err := RestoreBackup(db, backup.Record.ID)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if len(result.Modules) != 1 || result.Modules[0] != "tokens" {
		t.Fatalf("restore modules: %#v", result.Modules)
	}
	if result.SafetyBackup == nil || result.SafetyBackup.FileName == "" {
		t.Fatalf("restore should write a pre-restore safety backup")
	}
	if _, err := os.Stat(filepath.Join(result.SafetyBackup.Path, result.SafetyBackup.FileName)); err != nil {
		t.Fatalf("safety backup file missing: %v", err)
	}

	var tokens []model.Token
	if err := db.Order("id").Find(&tokens).Error; err != nil {
		t.Fatalf("list tokens: %v", err)
	}
	if len(tokens) != 1 || tokens[0].ID != "t1" || tokens[0].Name != "before" {
		t.Fatalf("restore did not bring back the original rows: %#v", tokens)
	}
}

func TestUnchangedRecordCannotRestore(t *testing.T) {
	db := newBackupTestDB(t)
	if err := db.Create(&model.Token{ID: "t1", Name: "one", Key: "k1", Status: true}).Error; err != nil {
		t.Fatalf("create token: %v", err)
	}
	if _, err := RunBackup(db, BackupOptions{Modules: []string{"tokens"}, Path: "backups"}); err != nil {
		t.Fatalf("first backup: %v", err)
	}
	second, err := RunBackup(db, BackupOptions{Modules: []string{"tokens"}, Path: "backups"})
	if err != nil {
		t.Fatalf("second backup: %v", err)
	}
	if !second.Record.Unchanged {
		t.Fatalf("expected unchanged record")
	}
	if _, err := RestoreBackup(db, second.Record.ID); err == nil {
		t.Fatalf("restoring an unchanged record should fail")
	}
}

func TestResolveBackupDir(t *testing.T) {
	SetBackupBaseDir("/base")
	t.Cleanup(func() { SetBackupBaseDir("") })

	if got := ResolveBackupDir("backups"); got != filepath.Clean("/base/backups") {
		t.Fatalf("relative path: got %q", got)
	}
	if got := ResolveBackupDir("/data/backups"); got != filepath.Clean("/data/backups") {
		t.Fatalf("absolute path: got %q", got)
	}
	if got := ResolveBackupDir(""); got != filepath.Clean("/base/"+DefaultBackupPath) {
		t.Fatalf("empty path: got %q", got)
	}
}

func TestReadBackupModulesDefaultAndOverride(t *testing.T) {
	db := newBackupTestDB(t)

	defaults := ReadBackupModules(db)
	if len(defaults) != 6 || defaults[0] != "topology" {
		t.Fatalf("unexpected defaults: %#v", defaults)
	}
	if err := db.Create(&model.Setting{Key: SettingBackupModules, Value: `["tokens","usage"]`}).Error; err != nil {
		t.Fatalf("save setting: %v", err)
	}
	selected := ReadBackupModules(db)
	if len(selected) != 2 || selected[0] != "tokens" || selected[1] != "usage" {
		t.Fatalf("unexpected selection: %#v", selected)
	}
}
