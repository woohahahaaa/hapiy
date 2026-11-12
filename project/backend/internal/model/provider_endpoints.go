package model

import (
	"encoding/json"
	"strings"
	"unicode"

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

// SplitEndpointPaths splits one endpoint field value into request paths the
// way the console form does: whitespace, commas and semicolons (ASCII or
// full-width) separate entries, a missing leading slash is added, and blank or
// duplicate paths are dropped while the input order is kept.
func SplitEndpointPaths(raw string) []string {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		switch r {
		case ',', '，', ';', '；', '、':
			return true
		}
		return unicode.IsSpace(r)
	})
	out := make([]string, 0, len(fields))
	seen := map[string]bool{}
	for _, field := range fields {
		path := field
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}
		if seen[path] {
			continue
		}
		seen[path] = true
		out = append(out, path)
	}
	return out
}

// NormalizeModelEndpoints repairs model endpoint lists saved before the console
// split free-form endpoint input (e.g. "/a,/b" or "/a /b" stored as one entry).
// Each list is re-split, given a leading slash and deduped; providers that are
// already clean are left untouched. A list that normalizes to nothing stays
// as-is, so a restriction never silently turns into "unrestricted".
func NormalizeModelEndpoints(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var providers []Provider
		if err := tx.Find(&providers).Error; err != nil {
			return err
		}
		for _, p := range providers {
			var models []map[string]json.RawMessage
			if json.Unmarshal([]byte(p.Models), &models) != nil || len(models) == 0 {
				continue
			}
			changed := false
			for _, m := range models {
				var own []string
				if json.Unmarshal(m["endpoints"], &own) != nil || len(own) == 0 {
					continue
				}
				paths := SplitEndpointPaths(strings.Join(own, " "))
				if len(paths) == 0 || sameEndpointPaths(own, paths) {
					continue
				}
				encoded, err := json.Marshal(paths)
				if err != nil {
					return err
				}
				m["endpoints"] = encoded
				changed = true
			}
			if !changed {
				continue
			}
			raw, err := json.Marshal(models)
			if err != nil {
				return err
			}
			if err := tx.Model(&Provider{}).Where("id = ?", p.ID).Update("models", string(raw)).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func sameEndpointPaths(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
