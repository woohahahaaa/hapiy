package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// User model
type User struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Username  string    `gorm:"uniqueIndex;not null" json:"username"`
	Password  string    `gorm:"not null" json:"-"`
	Role      string    `gorm:"default:'admin'" json:"role"`
	Status    bool      `gorm:"default:true" json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == "" {
		u.ID = uuid.New().String()
	}
	return nil
}

// Channel model (upstream provider)
type Channel struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name      string    `gorm:"not null" json:"name"`
	BaseURLs  string    `gorm:"type:text" json:"base_urls"` // JSON array
	Keys      string    `gorm:"type:text" json:"keys"`      // JSON array
	Endpoints string    `gorm:"type:text" json:"endpoints"` // JSON array
	Models    string    `gorm:"type:text" json:"models"`    // JSON array
	Status    bool      `gorm:"default:true" json:"status"`
	Weight    int       `gorm:"default:1" json:"weight"`
	Priority  int       `gorm:"default:0" json:"priority"`
	AutoBan   bool      `gorm:"default:true" json:"auto_ban"`
	Group     string    `gorm:"default:''" json:"group"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (c *Channel) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.New().String()
	}
	return nil
}

// Token model (downstream API key)
type Token struct {
	ID          string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name        string    `gorm:"not null" json:"name"`
	Key         string    `gorm:"uniqueIndex;not null" json:"key"`
	HistoryKeys string    `gorm:"type:text" json:"history_keys"` // JSON array
	Quota       *float64  `json:"quota"`
	UsedQuota   float64   `gorm:"default:0" json:"used_quota"`
	Status      bool      `gorm:"default:true" json:"status"`
	UserID      string    `json:"user_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (t *Token) BeforeCreate(tx *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	return nil
}

// Log model (usage log)
type Log struct {
	ID               string    `gorm:"primaryKey;type:uuid" json:"id"`
	UserID           string    `json:"user_id"`
	TokenName        string    `json:"token_name"`
	ChannelName      string    `json:"channel_name"`
	ModelName        string    `json:"model_name"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	IsStream         bool      `json:"is_stream"`
	Quota            float64   `json:"quota"`
	UseTime          int       `json:"use_time"` // milliseconds
	Status           string    `json:"status"`   // success / failed
	IP               string    `json:"ip"`
	RequestID        string    `json:"request_id"`
	ErrorMessage     string    `json:"error_message"`
	CreatedAt        time.Time `json:"created_at"`
}

func (l *Log) BeforeCreate(tx *gorm.DB) error {
	if l.ID == "" {
		l.ID = uuid.New().String()
	}
	return nil
}

// RewriteRule model
type RewriteRule struct {
	ID     string `gorm:"primaryKey;type:uuid" json:"id"`
	Name   string `gorm:"not null" json:"name"`
	Script string `gorm:"type:text" json:"script"`
	Status bool   `gorm:"not null" json:"status"`
}

func (r *RewriteRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// ResponseRewriteRule model
type ResponseRewriteRule struct {
	ID     string `gorm:"primaryKey;type:uuid" json:"id"`
	Name   string `gorm:"not null" json:"name"`
	Script string `gorm:"type:text" json:"script"`
	Status bool   `gorm:"not null" json:"status"`
}

func (r *ResponseRewriteRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// HeartbeatRule model
type HeartbeatRule struct {
	ID             string `gorm:"primaryKey;type:uuid" json:"id"`
	Name           string `gorm:"not null" json:"name"`
	MatchCondition string `gorm:"default:'*'" json:"match_condition"`
	ReplyContent   string `gorm:"not null" json:"reply_content"`
	Timeout        int    `gorm:"default:30" json:"timeout"`
	Status         bool   `gorm:"not null" json:"status"`
}

func (r *HeartbeatRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// ConcurrencyRule model
type ConcurrencyRule struct {
	ID            string `gorm:"primaryKey;type:uuid" json:"id"`
	Name          string `gorm:"not null" json:"name"`
	Scope         string `gorm:"default:'global'" json:"scope"`
	MaxConcurrent int    `gorm:"default:10" json:"max_concurrent"`
	QueueEnabled  bool   `gorm:"default:true" json:"queue_enabled"`
	Status        bool   `gorm:"not null" json:"status"`
}

func (r *ConcurrencyRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// FailoverRule model
type FailoverRule struct {
	ID              string `gorm:"primaryKey;type:uuid" json:"id"`
	Name            string `gorm:"not null" json:"name"`
	PrimaryChannel  string `json:"primary_channel"`
	FallbackChannel string `json:"fallback_channel"`
	Condition       string `gorm:"default:'timeout'" json:"condition"`
	Status          bool   `gorm:"not null" json:"status"`
}

func (r *FailoverRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// TopologyConfig model (stores node graph configuration)
type TopologyConfig struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Version   int       `gorm:"default:1" json:"version"`
	Nodes     string    `gorm:"type:text" json:"nodes"` // JSON array of nodes
	Edges     string    `gorm:"type:text" json:"edges"` // JSON array of edges
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// PriceConfig model — per-model pricing; units are per 1M tokens.
type PriceConfig struct {
	ID              string    `gorm:"primaryKey;type:uuid" json:"id"`
	Model           string    `gorm:"uniqueIndex;not null" json:"model"`
	InputPrice      float64   `gorm:"default:0" json:"input_price"`
	OutputPrice     float64   `gorm:"default:0" json:"output_price"`
	CacheWritePrice float64   `gorm:"default:0" json:"cache_write_price"`
	CacheReadPrice  float64   `gorm:"default:0" json:"cache_read_price"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (p *PriceConfig) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}

func (t *TopologyConfig) BeforeCreate(tx *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	return nil
}

// TopologyNode model — hard data of a topology node (id/type/parent/slot/payload).
// Positions are intentionally NOT stored; the frontend derives layout locally.
type TopologyNode struct {
	ID           string    `gorm:"primaryKey;type:uuid" json:"id"`
	Type         string    `gorm:"not null;index" json:"type"` // modelHub | channel | slot
	ParentID     *string   `gorm:"index" json:"parent_id"`     // for slot nodes: the channel id
	SlotType     *string   `json:"slot_type"`                  // requestModify / responseModify / autoReply / concurrency / autoSwitch / logOutput
	ChannelID    *string   `gorm:"index" json:"channel_id"`    // for slot nodes: the parent channel id
	ModelHubID   *string   `json:"model_hub_id"`               // future use
	Name         string    `gorm:"not null" json:"name"`
	ProviderName *string   `json:"provider_name"`            // backend channel name when type=channel
	Payload      string    `gorm:"type:text" json:"payload"` // free-form per-type JSON blob
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (n *TopologyNode) BeforeCreate(tx *gorm.DB) error {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}
	return nil
}
