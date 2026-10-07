package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BackupRecord is one entry in the data-backup history. Unchanged records mark
// a run that found no difference from the previously backed-up content: no new
// file is written for them (FileName is empty).
type BackupRecord struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	SizeBytes int64     `json:"size_bytes"`
	// Modules is the JSON-encoded list of backed-up module ids.
	Modules string `gorm:"type:text" json:"-"`
	// ModulesList mirrors Modules for JSON (de)serialization; not a column.
	ModulesList []string `gorm:"-" json:"modules"`
	// Path is the absolute directory holding the backup file.
	Path string `json:"path"`
	// FileName is empty for unchanged records; otherwise hapiy-*.db.
	FileName string `json:"file_name"`
	// Source records why the backup ran: manual / auto / pre-restore.
	Source string `json:"source"`
	// Unchanged marks a run whose content matched the previous record.
	Unchanged bool `json:"unchanged"`
	// Digest identifies the backed-up content so later runs can detect that
	// nothing changed. Internal only.
	Digest string `gorm:"type:text" json:"-"`
}

func (r *BackupRecord) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

func (r *BackupRecord) BeforeSave(tx *gorm.DB) error {
	if r.ModulesList != nil {
		b, err := json.Marshal(r.ModulesList)
		if err != nil {
			return err
		}
		r.Modules = string(b)
	}
	return nil
}

func (r *BackupRecord) AfterFind(tx *gorm.DB) error {
	r.ModulesList = nil
	if r.Modules == "" {
		return nil
	}
	return json.Unmarshal([]byte(r.Modules), &r.ModulesList)
}
