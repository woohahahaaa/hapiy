package relay

import (
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// newTestEngine builds an in-memory SQLite engine that mirrors the production
// AutoMigrate shape so cache rebuilds can be exercised against real SQL.
func newTestEngine(t *testing.T) (*Engine, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.Channel{},
		&model.RewriteRule{},
		&model.ResponseRewriteRule{},
		&model.HeartbeatRule{},
		&model.ConcurrencyRule{},
		&model.FailoverRule{},
	); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return NewEngine(db), db
}

func TestLoadChannelsDropsDisabledChannels(t *testing.T) {
	engine, db := newTestEngine(t)

	enabled := model.Channel{
		ID:       "channel-enabled",
		Name:     "enabled",
		BaseURLs: "[]",
		Keys:     "[]",
		Models:   "[]",
		Status:   true,
	}
	if err := db.Create(&enabled).Error; err != nil {
		t.Fatalf("create enabled channel: %v", err)
	}

	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("first load: %v", err)
	}
	if _, err := engine.GetChannel("channel-enabled"); err != nil {
		t.Fatalf("enabled channel should be present after first load: %v", err)
	}

	if err := db.Model(&model.Channel{}).
		Where("id = ?", "channel-enabled").
		Update("status", false).Error; err != nil {
		t.Fatalf("disable channel: %v", err)
	}

	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("second load: %v", err)
	}
	if _, err := engine.GetChannel("channel-enabled"); err == nil {
		t.Fatalf("disabled channel must be evicted from cache after LoadChannels")
	}

	if _, err := engine.GetPlan("channel-enabled"); err == nil {
		t.Fatalf("plan for disabled channel must be evicted")
	}
}

func TestLoadChannelsDropsDeletedChannels(t *testing.T) {
	engine, db := newTestEngine(t)

	ch := model.Channel{
		ID:       "channel-doomed",
		Name:     "doomed",
		BaseURLs: "[]",
		Keys:     "[]",
		Models:   "[]",
		Status:   true,
	}
	if err := db.Create(&ch).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("first load: %v", err)
	}
	if _, err := engine.GetChannel("channel-doomed"); err != nil {
		t.Fatalf("channel should be present after first load: %v", err)
	}

	if err := db.Delete(&model.Channel{}, "id = ?", "channel-doomed").Error; err != nil {
		t.Fatalf("delete channel: %v", err)
	}
	if err := engine.LoadChannels(); err != nil {
		t.Fatalf("second load: %v", err)
	}
	if _, err := engine.GetChannel("channel-doomed"); err == nil {
		t.Fatalf("deleted channel must be evicted from cache after LoadChannels")
	}
}