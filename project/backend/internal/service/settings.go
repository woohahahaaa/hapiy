package service

import (
	"errors"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// GetSetting returns the value for a system setting key, or "" when unset.
func GetSetting(db *gorm.DB, key string) (string, error) {
	var setting model.Setting
	err := db.Where("key = ?", key).First(&setting).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return setting.Value, nil
}
