package relay

import (
	"math"
	"testing"

	"github.com/hapiy/hapiy/internal/topology"
)

func ep(name string, weight float64) topology.EligibleProvider {
	return topology.EligibleProvider{Node: topology.FlatNode{ID: name}, Name: name, Weight: weight}
}

// TestWeightedPickEqualWeights guards the normalization bug where cumulative
// weights were compared against the raw [0,1) roll (cum==1 for the first
// equal-weight entry => always picked). With the fix, 1/1 must be ~50/50.
func TestWeightedPickEqualWeights(t *testing.T) {
	eligible := []topology.EligibleProvider{ep("a", 1), ep("b", 1)}
	const n = 200_000
	counts := map[string]int{}
	for i := 0; i < n; i++ {
		counts[weightedPick(eligible).Name]++
	}
	for _, name := range []string{"a", "b"} {
		frac := float64(counts[name]) / n
		if math.Abs(frac-0.5) > 0.03 {
			t.Fatalf("weight 1/1: %s picked %.3f of the time, want ~0.5", name, frac)
		}
	}
}

func TestWeightedPickUnequalWeights(t *testing.T) {
	eligible := []topology.EligibleProvider{ep("a", 1), ep("b", 3)}
	const n = 200_000
	counts := map[string]int{}
	for i := 0; i < n; i++ {
		counts[weightedPick(eligible).Name]++
	}
	if frac := float64(counts["a"]) / n; math.Abs(frac-0.25) > 0.03 {
		t.Fatalf("weight 1/3: a picked %.3f of the time, want ~0.25", frac)
	}
}

func TestWeightedPickZeroWeightsFallsBackToFirst(t *testing.T) {
	eligible := []topology.EligibleProvider{ep("a", 0), ep("b", 0)}
	for i := 0; i < 50; i++ {
		if got := weightedPick(eligible).Name; got != "a" {
			t.Fatalf("zero weights: picked %q, want first", got)
		}
	}
}

func TestWeightedPickSingleEligible(t *testing.T) {
	eligible := []topology.EligibleProvider{ep("only", 1)}
	for i := 0; i < 50; i++ {
		if got := weightedPick(eligible).Name; got != "only" {
			t.Fatalf("single eligible: picked %q, want only", got)
		}
	}
}