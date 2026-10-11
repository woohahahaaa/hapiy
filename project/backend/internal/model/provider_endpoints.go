package model

import (
	"encoding/json"
	"strings"

	"gorm.io/gorm"
)

// MigrateProviderEndpoints moves the old provider whitelist onto models that
// have no explicit whitelist. Unknown model fields (including prices) survive.
func MigrateProviderEndpoints(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var providers []Provider
		if err := tx.Where("endpoints <> '' AND endpoints <> '[]'").Find(&providers).Error; err != nil {
			return err
		}
		for _, p := range providers {
			var legacy []struct {
				PathSuffix string `json:"pathSuffix"`
			}
			if json.Unmarshal([]byte(p.Endpoints), &legacy) != nil {
				continue
			}
			paths := []string{}
			seen := map[string]bool{}
			for _, ep := range legacy {
				path := strings.TrimSpace(ep.PathSuffix)
				if path != "" && !seen[path] {
					paths = append(paths, path)
					seen[path] = true
				}
			}
			var models []map[string]json.RawMessage
			if len(paths) == 0 || json.Unmarshal([]byte(p.Models), &models) != nil || len(models) == 0 {
				continue
			}
			encoded, err := json.Marshal(paths)
			if err != nil {
				return err
			}
			for _, m := range models {
				var own []string
				if json.Unmarshal(m["endpoints"], &own) != nil || len(own) == 0 {
					m["endpoints"] = encoded
				}
			}
			raw, err := json.Marshal(models)
			if err != nil {
				return err
			}
			if err := tx.Model(&Provider{}).Where("id = ?", p.ID).Updates(map[string]interface{}{"models": string(raw), "endpoints": "[]"}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
