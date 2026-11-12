package relay

import (
	"sync"

	"github.com/hapiy/hapiy/internal/common"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/topology"
)

// channelStrategy collapses a provider's stored per-dimension strategy onto
// the two supported values. An empty stored value falls back to the dimension
// default: keys default to balanced (spread the pool), base URLs default to
// sequential (first address first).
func channelStrategy(stored, dimension string) string {
	switch stored {
	case topology.StrategyBalanced:
		return topology.StrategyBalanced
	case topology.StrategySequential:
		return topology.StrategySequential
	}
	if dimension == model.FailoverDimensionKey {
		return topology.StrategyBalanced
	}
	return topology.StrategySequential
}

// selectChannelIndex resolves which key or base URL an upstream attempt uses.
// An explicit requested index (channel-affinity recall or a failover rotation)
// wins while that value is still enabled; otherwise the provider's strategy
// for this dimension picks among enabled values: sequential takes the first,
// balanced takes the one with the fewest in-flight requests and rotates ties.
// Key and base URL selection are independent of each other.
func (e *Engine) selectChannelIndex(providerID, dimension string, values []string, requested int, storedStrategy string) int {
	if requested >= 0 && requested < len(values) && !e.isDisabled(providerID, dimension, values[requested]) {
		return requested
	}
	if channelStrategy(storedStrategy, dimension) != topology.StrategyBalanced {
		return e.firstEnabledIndex(providerID, dimension, values, -1)
	}
	// One query for the whole dimension instead of one per candidate; only
	// needed on the balanced path.
	disabled := e.disabledSet(providerID, dimension)
	best := -1
	bestLoad := 0
	tied := make([]int, 0, len(values))
	for index, value := range values {
		if disabled[value] {
			continue
		}
		var load int
		switch dimension {
		case model.FailoverDimensionKey:
			load = common.Global().KeyInFlight(providerID, index)
		case model.FailoverDimensionBaseURL:
			load = common.Global().BaseURLInFlight(providerID, index)
		}
		switch {
		case best < 0 || load < bestLoad:
			best = index
			bestLoad = load
			tied = append(tied[:0], index)
		case load == bestLoad:
			tied = append(tied, index)
		}
	}
	if best < 0 {
		return -1
	}
	if len(tied) == 1 {
		return best
	}
	return tied[channelRoundRobin(providerID+"|"+dimension, len(tied))]
}

// disabledSet returns the auto-disabled values of one provider+dimension.
func (e *Engine) disabledSet(providerID, dimension string) map[string]bool {
	disabled := map[string]bool{}
	if e.db == nil || providerID == "" {
		return disabled
	}
	var states []model.AutoDisableState
	if err := e.db.Model(&model.AutoDisableState{}).
		Where("provider_id = ? AND dimension = ? AND disabled = ?", providerID, dimension, true).
		Find(&states).Error; err != nil {
		return disabled
	}
	for _, state := range states {
		disabled[state.Value] = true
	}
	return disabled
}

var (
	channelRRMu   sync.Mutex
	channelRRNext = map[string]int{}
)

// channelRoundRobin rotates the tie-break cursor for one provider+dimension so
// idle channels share traffic instead of always using the first.
func channelRoundRobin(key string, n int) int {
	channelRRMu.Lock()
	defer channelRRMu.Unlock()
	index := channelRRNext[key] % n
	channelRRNext[key]++
	return index
}
