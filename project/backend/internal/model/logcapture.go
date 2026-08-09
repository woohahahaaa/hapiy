package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// JSONMap is a jsonb-compatible map that implements sql.Scanner and driver.Valuer.
type JSONMap map[string]interface{}

func (m JSONMap) Value() (driver.Value, error) {
	if m == nil {
		return nil, nil
	}
	return json.Marshal(m)
}

func (m *JSONMap) Scan(src interface{}) error {
	if src == nil {
		*m = nil
		return nil
	}
	var bytes []byte
	switch v := src.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("JSONMap: unsupported source type")
	}
	return json.Unmarshal(bytes, m)
}

// JSONSlice is a jsonb-compatible slice that implements sql.Scanner and driver.Valuer.
type JSONSlice []interface{}

func (s JSONSlice) Value() (driver.Value, error) {
	if s == nil {
		return nil, nil
	}
	return json.Marshal(s)
}

func (s *JSONSlice) Scan(src interface{}) error {
	if src == nil {
		*s = nil
		return nil
	}
	var bytes []byte
	switch v := src.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("JSONSlice: unsupported source type")
	}
	return json.Unmarshal(bytes, s)
}

// LogCapture stores the full request/response capture data in the database.
// Each row corresponds to one log event (request-before, request-after,
// response-before, response-after, or system) for a single log output node.
type LogCapture struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	RequestID      string    `gorm:"not null;index" json:"request_id"`
	Type           string    `gorm:"not null;index" json:"type"` // request | response | system
	Prefix         string    `json:"prefix"`
	Source         string    `json:"source"`
	ProviderID     string    `json:"provider_id"`
	Stage          string    `json:"stage"` // request_before | request_after | response_before | response_after
	Headers        JSONMap   `gorm:"type:jsonb" json:"headers,omitempty"`
	RequestBody    JSONMap   `gorm:"type:jsonb" json:"request_body,omitempty"`
	ResponseBody   JSONMap   `gorm:"type:jsonb" json:"response_body,omitempty"`
	ResponseStatus int       `json:"response_status,omitempty"`
	SystemLog      JSONSlice `gorm:"type:jsonb" json:"system_log,omitempty"`
	Error          string    `json:"error,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

func (l *LogCapture) BeforeCreate(tx *gorm.DB) error {
	if l.ID == "" {
		l.ID = uuid.New().String()
	}
	return nil
}