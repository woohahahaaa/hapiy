package topology

import (
	"encoding/json"
	"fmt"

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

// Load reads the current flat topology. It returns an empty topology (nil-safe)
// when no flat data has ever been saved.
func (s *Store) Load() (*Topology, error) {
	var config model.TopologyConfig
	if err := s.db.Where("id = ?", ConfigRowID).First(&config).Error; err != nil {
		return &Topology{}, nil
	}
	if config.Flat == "" {
		return &Topology{}, nil
	}
	var tp Topology
	if err := json.Unmarshal([]byte(config.Flat), &tp); err != nil {
		return nil, fmt.Errorf("decode flat topology: %w", err)
	}
	return &tp, nil
}

// Save validates and persists the flat topology on the TopologyConfig row.
func (s *Store) Save(tp *Topology) error {
	if err := ValidateTopology(tp); err != nil {
		return err
	}
	raw, err := json.Marshal(tp)
	if err != nil {
		return fmt.Errorf("encode flat topology: %w", err)
	}
	return s.db.Where("id = ?", ConfigRowID).
		Assign(model.TopologyConfig{Flat: string(raw)}).
		FirstOrCreate(&model.TopologyConfig{ID: ConfigRowID}).Error
}
