package service

import (
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Token{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func TestQuotaChargeAccumulates(t *testing.T) {
	db := newTestDB(t)
	ledger := &QuotaLedger{db: db}

	quota := 100.0
	token := model.Token{
		ID:        "tok-1",
		Name:      "test",
		Key:       "k-1",
		Status:    true,
		Quota:     &quota,
		UsedQuota: 0,
	}
	if err := db.Create(&token).Error; err != nil {
		t.Fatalf("create token: %v", err)
	}

	if err := ledger.Charge("tok-1", 30); err != nil {
		t.Fatalf("first charge: %v", err)
	}
	if err := ledger.Charge("tok-1", 45); err != nil {
		t.Fatalf("second charge: %v", err)
	}

	var updated model.Token
	if err := db.First(&updated, "id = ?", "tok-1").Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if updated.UsedQuota != 75 {
		t.Fatalf("used_quota = %.2f, want 75", updated.UsedQuota)
	}
}

func TestQuotaChargeIgnoresNonPositive(t *testing.T) {
	db := newTestDB(t)
	ledger := &QuotaLedger{db: db}

	quota := 10.0
	token := model.Token{ID: "tok-2", Name: "test", Key: "k-2", Status: true, Quota: &quota, UsedQuota: 5}
	if err := db.Create(&token).Error; err != nil {
		t.Fatalf("create token: %v", err)
	}

	if err := ledger.Charge("tok-2", 0); err != nil {
		t.Fatalf("zero charge: %v", err)
	}
	if err := ledger.Charge("tok-2", -10); err != nil {
		t.Fatalf("negative charge: %v", err)
	}

	var updated model.Token
	if err := db.First(&updated, "id = ?", "tok-2").Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if updated.UsedQuota != 5 {
		t.Fatalf("used_quota must remain 5, got %.2f", updated.UsedQuota)
	}
}