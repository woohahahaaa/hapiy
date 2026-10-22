package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ChatThread is one conversation in the in-console Agent panel. Threads are
// owned by the dashboard account (UserID = username) so the same conversation
// list shows up in every browser signed into that account.
type ChatThread struct {
	ID string `gorm:"primaryKey;type:uuid" json:"id"`
	// UserID is the dashboard username, not a foreign key: the account table
	// predates this feature and usernames are unique.
	UserID string `gorm:"index;not null" json:"-"`
	Title  string `gorm:"not null;default:''" json:"title"`
	// Model and ProviderID are the last choice made in this thread; an empty
	// ProviderID means "自动" (dispatch through the topology).
	Model      string    `gorm:"not null;default:''" json:"model"`
	ProviderID string    `gorm:"not null;default:''" json:"provider_id"`
	Archived   bool      `gorm:"not null;default:false" json:"archived"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (t *ChatThread) BeforeCreate(tx *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	return nil
}

// ChatMessage is one turn inside a ChatThread.
type ChatMessage struct {
	ID       string `gorm:"primaryKey;type:uuid" json:"id"`
	ThreadID string `gorm:"index;not null" json:"thread_id"`
	Role     string `gorm:"not null" json:"role"` // "user" | "assistant"
	Content  string `gorm:"type:text" json:"content"`
	Model    string `json:"model"`
	// ProviderID/ProviderName record which channel answered, so a thread can
	// show where each reply came from (empty for user messages).
	ProviderID   string    `gorm:"not null;default:''" json:"provider_id"`
	ProviderName string    `gorm:"not null;default:''" json:"provider_name"`
	Error        string    `gorm:"type:text" json:"error"`
	CreatedAt    time.Time `json:"created_at"`
}

func (m *ChatMessage) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.New().String()
	}
	return nil
}
