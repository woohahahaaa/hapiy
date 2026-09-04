package topology

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// Store loads and saves the flat topology from the TopologyConfig row.
type Store struct {
	db *gorm.DB
}

// NewStore builds a flat topology store bound to a database.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// ConfigMeta is the version metadata attached to the stored flat topology,
// used by clients to detect edits made from another tab.
type ConfigMeta struct {
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Load reads the current flat topology. It returns an empty topology (nil-safe)
// when no flat data has ever been saved.
func (s *Store) Load() (*Topology, error) {
	tp, _, err := s.LoadWithMeta()
	return tp, err
}

// LoadWithMeta reads the current flat topology together with the config row's
// version metadata. It returns an empty topology (nil-safe) when no flat data
// has ever been saved; the meta then has Version 0.
func (s *Store) LoadWithMeta() (*Topology, ConfigMeta, error) {
	var config model.TopologyConfig
	if err := s.db.Where("id = ?", ConfigRowID).First(&config).Error; err != nil {
		return &Topology{}, ConfigMeta{}, nil
	}
	if config.Flat == "" {
		return &Topology{}, ConfigMeta{Version: config.Version, UpdatedAt: config.UpdatedAt}, nil
	}
	var tp Topology
	if err := json.Unmarshal([]byte(config.Flat), &tp); err != nil {
		return nil, ConfigMeta{}, fmt.Errorf("decode flat topology: %w", err)
	}
	return &tp, ConfigMeta{Version: config.Version, UpdatedAt: config.UpdatedAt}, nil
}

// Save validates and persists the flat topology on the TopologyConfig row,
// bumping the version on every save so clients can detect concurrent edits.
func (s *Store) Save(tp *Topology) error {
	if err := ValidateTopology(tp); err != nil {
		return err
	}
	raw, err := json.Marshal(tp)
	if err != nil {
		return fmt.Errorf("encode flat topology: %w", err)
	}
	var config model.TopologyConfig
	err = s.db.Where("id = ?", ConfigRowID).First(&config).Error
	if err == gorm.ErrRecordNotFound {
		config = model.TopologyConfig{ID: ConfigRowID, Version: 1, Flat: string(raw)}
		return s.db.Create(&config).Error
	}
	if err != nil {
		return fmt.Errorf("load topology config: %w", err)
	}
	config.Flat = string(raw)
	config.Version++
	return s.db.Model(&model.TopologyConfig{}).Where("id = ?", ConfigRowID).
		Updates(map[string]interface{}{
			"flat":    config.Flat,
			"version": config.Version,
		}).Error
}
