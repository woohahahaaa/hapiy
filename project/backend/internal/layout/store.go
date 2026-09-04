package layout

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// LayoutRowID is the single LayoutConfig row key shared by handler and relay.
const LayoutRowID = "topology-layout"

// Layout is the canvas node-position map: keys are node IDs, values are
// their (x, y) screen coordinates. ReactFlow emits fractional positions
// (e.g. 193.5), so coordinates are float64.
type Layout map[string]struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Store loads and saves the topology canvas layout from the LayoutConfig row.
type Store struct {
	db *gorm.DB
}

// NewStore builds a layout store bound to a database.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// ConfigMeta is the version metadata attached to the stored layout, used by
// clients to detect edits made from another tab.
type ConfigMeta struct {
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Load reads the current layout. It returns an empty layout (nil-safe) when
// no layout has ever been saved.
func (s *Store) Load() (*Layout, error) {
	layout, _, err := s.LoadWithMeta()
	return layout, err
}

// LoadWithMeta reads the current layout together with the config row's
// version metadata. It returns an empty layout (nil-safe) when no layout has
// ever been saved; the meta then has Version 0.
func (s *Store) LoadWithMeta() (*Layout, ConfigMeta, error) {
	var config model.LayoutConfig
	if err := s.db.Where("id = ?", LayoutRowID).First(&config).Error; err != nil {
		return &Layout{}, ConfigMeta{}, nil
	}
	if config.Layout == "" {
		return &Layout{}, ConfigMeta{Version: config.Version, UpdatedAt: config.UpdatedAt}, nil
	}
	var layout Layout
	if err := json.Unmarshal([]byte(config.Layout), &layout); err != nil {
		return nil, ConfigMeta{}, fmt.Errorf("decode layout: %w", err)
	}
	return &layout, ConfigMeta{Version: config.Version, UpdatedAt: config.UpdatedAt}, nil
}

// Save persists the layout on the LayoutConfig row, bumping the version on
// every save so clients can detect concurrent edits. Last-write-wins: the
// caller does not need to pass the expected version.
func (s *Store) Save(layout *Layout) error {
	raw, err := json.Marshal(layout)
	if err != nil {
		return fmt.Errorf("encode layout: %w", err)
	}
	var config model.LayoutConfig
	err = s.db.Where("id = ?", LayoutRowID).First(&config).Error
	if err == gorm.ErrRecordNotFound {
		config = model.LayoutConfig{ID: LayoutRowID, Version: 1, Layout: string(raw)}
		return s.db.Create(&config).Error
	}
	if err != nil {
		return fmt.Errorf("load layout config: %w", err)
	}
	config.Layout = string(raw)
	config.Version++
	return s.db.Model(&model.LayoutConfig{}).Where("id = ?", LayoutRowID).
		Updates(map[string]interface{}{
			"layout":  config.Layout,
			"version": config.Version,
		}).Error
}
