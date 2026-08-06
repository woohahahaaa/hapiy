package handler

import (
	"net/http"

	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/topology"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetFlatTopology returns the stored flat topology together with its version
// metadata, so clients can detect edits made from another tab.
func GetFlatTopology(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tp, meta, err := topology.NewStore(db).LoadWithMeta()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"nodes":      tp.Nodes,
			"wires":      tp.Wires,
			"version":    meta.Version,
			"updated_at": meta.UpdatedAt,
		}})
	}
}

// SaveFlatTopology validates and persists the flat topology, then refreshes
// the relay engine plans so dispatch uses the new wiring.
func SaveFlatTopology(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		var tp topology.Topology
		if err := c.ShouldBindJSON(&tp); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		store := topology.NewStore(db)
		if err := store.Save(&tp); err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		engine.RefreshPlans()
		_, meta, err := store.LoadWithMeta()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"nodes":      tp.Nodes,
			"wires":      tp.Wires,
			"version":    meta.Version,
			"updated_at": meta.UpdatedAt,
		}})
	}
}

// ValidateFlatTopology checks the flat topology for structural errors and
// duplicate-activation conflicts, returning the list of conflicts so the
// frontend can highlight them.
func ValidateFlatTopology(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tp, err := topology.NewStore(db).Load()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := topology.ValidateTopology(tp); err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": topology.FindDuplicateActivations(tp)})
	}
}
