package service

import (
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestMigrateLogErrorOrigins_backfillsFailedRows(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Log{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	rows := []model.Log{
		{Status: "failed", UpstreamURL: "https://up.example/v1/chat/completions", ErrorMessage: "HTTP 500"},
		{Status: "failed", ErrorMessage: "no provider available"},
		{Status: "success", UpstreamURL: "https://up.example/v1/chat/completions"},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("create row: %v", err)
		}
	}

	if err := MigrateLogErrorOrigins(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var withURL model.Log
	if err := db.First(&withURL, "id = ?", rows[0].ID).Error; err != nil {
		t.Fatalf("reload upstream row: %v", err)
	}
	if withURL.ErrorOrigin != model.LogErrorOriginUpstream {
		t.Fatalf("failed row with upstream URL: origin = %q, want %q", withURL.ErrorOrigin, model.LogErrorOriginUpstream)
	}
	var withoutURL model.Log
	if err := db.First(&withoutURL, "id = ?", rows[1].ID).Error; err != nil {
		t.Fatalf("reload local row: %v", err)
	}
	if withoutURL.ErrorOrigin != model.LogErrorOriginLocal {
		t.Fatalf("failed row without upstream URL: origin = %q, want %q", withoutURL.ErrorOrigin, model.LogErrorOriginLocal)
	}
	var success model.Log
	if err := db.First(&success, "id = ?", rows[2].ID).Error; err != nil {
		t.Fatalf("reload success row: %v", err)
	}
	if success.ErrorOrigin != "" {
		t.Fatalf("success row must keep an empty origin, got %q", success.ErrorOrigin)
	}

	// Idempotent: a second run leaves the rows untouched.
	if err := MigrateLogErrorOrigins(db); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	if err := db.First(&withURL, "id = ?", rows[0].ID).Error; err != nil {
		t.Fatalf("reload after second run: %v", err)
	}
	if withURL.ErrorOrigin != model.LogErrorOriginUpstream {
		t.Fatalf("second run changed the origin: %q", withURL.ErrorOrigin)
	}
}
