package model

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func InitDB(path string) (*gorm.DB, error) {
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}
	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&User{},
		&Channel{},
		&Token{},
		&Log{},
		&RewriteRule{},
		&ResponseRewriteRule{},
		&HeartbeatRule{},
		&ConcurrencyRule{},
		&FailoverRule{},
		&TopologyConfig{},
		&PriceConfig{},
	)
}
