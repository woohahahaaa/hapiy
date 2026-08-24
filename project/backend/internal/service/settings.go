package service

import (
	"errors"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// defaultSettings contains the built-in default values for system settings.
// These are returned when the database has no value for a key.
var defaultSettings = map[string]string{
	"default_model_list_endpoint":        "/v1/models",
	"own_model_list_endpoint":            "/models",
	"automatic_disable_recovery_minutes": "60",
	"recovery_ttfb_seconds":              "0",
}

// GetSetting returns the value for a system setting key.
// Priority: database value > hardcoded default > "".
func GetSetting(db *gorm.DB, key string) (string, error) {
	var setting model.Setting
	err := db.Where("key = ?", key).First(&setting).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if def, ok := defaultSettings[key]; ok {
			return def, nil
		}
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if setting.Value == "" {
		if def, ok := defaultSettings[key]; ok {
			return def, nil
		}
	}
	return setting.Value, nil
}
