package topology

import (
	"encoding/json"
	"fmt"
	"sort"
)

// NodeKind is the flat topology node type. A "request entry" carries the
// workflow master switch and weight; a "provider" is a selectable upstream
// bound to a configured provider; a "slot" is a processing stage (requestModify,
// responseModify, etc.) that holds zero or more provider/slot child nodes.
type NodeKind string

const (
	KindRequestEntry NodeKind = "requestEntry"
	KindProvider     NodeKind = "provider"
	KindSlot         NodeKind = "slot"
)

// Node is one element of the flat topology. IDs are unique strings. A provider
// node carries the provider's configured name (resolved against the Provider
// table at plan time). A request-entry node carries the master switch and weight.
type FlatNode struct {
	ID       string          `json:"id"`
	Kind     NodeKind        `json:"kind"`
	Name     string          `json:"name,omitempty"`      // provider configured name for KindProvider
	SlotType string          `json:"slot_type,omitempty"` // for KindSlot
	Enabled  bool            `json:"enabled"`             // request-entry master switch / provider mini-switch
	Weight   float64         `json:"weight,omitempty"`    // request-entry weight in [0,1]
	Entries  json.RawMessage `json:"entries,omitempty"`   // for KindSlot: rule entries, opaque to the engine
}

// Wire is one directed connection in the flat topology.
type Wire struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

// Topology is the flat, non-nested representation of the canvas: a flat node
// list plus a flat wire list. The user edits nodes/wires; dispatch reads the
// active request entries and walks the wires to pick a provider and its chain.
type Topology struct {
	Nodes []FlatNode `json:"nodes"`
	Wires []Wire     `json:"wires"`
}

// ProviderRef is the minimal provider facts dispatch needs to decide whether a
// provider node can serve a request.
type ProviderRef struct {
	Name     string
	Status   bool   // Provider table status
	Enabled  bool   // provider node mini-switch in its slot
	Workflow bool   // master-switch activation (derived from its request entry)
	Models   map[string]struct{}
	Paths    map[string]struct{} // supported endpoint paths; empty set = any
}

// Chain is one complete, runnable single-line pipeline starting at a provider.
// It is what dispatch returns: the chosen provider plus the ordered slot types
// that follow it in the wiring.
type Chain struct {
	ProviderID  string   // provider node ID (KindProvider)
	ProviderName string  // configured provider name
	Weight      float64  // request-entry weight
	SlotTypes   []string // slot types reachable after the provider, in wire order
}

// ValidateTopology checks the flat model's structural invariants: node IDs are
// unique, wire endpoints exist, no self-loops, and every node has at most one
// outgoing wire (the output-single constraint). It returns an error for any
// illegal topology so bad data never reaches dispatch.
func ValidateTopology(t *Topology) error {
	if t == nil {
		return fmt.Errorf("topology is nil")
	}
	nodes := make(map[string]FlatNode, len(t.Nodes))
	for _, n := range t.Nodes {
		if n.ID == "" {
			return fmt.Errorf("node has empty id")
		}
		if _, dup := nodes[n.ID]; dup {
			return fmt.Errorf("duplicate node id %q", n.ID)
		}
		switch n.Kind {
		case KindRequestEntry, KindProvider, KindSlot:
		default:
			return fmt.Errorf("node %q has unknown kind %q", n.ID, n.Kind)
		}
		if n.Kind == KindRequestEntry {
			if n.Weight < 0 || n.Weight > 1 {
				return fmt.Errorf("request entry %q weight must be in [0,1], got %v", n.ID, n.Weight)
			}
		}
		nodes[n.ID] = n
	}
	for _, w := range t.Wires {
		if w.Source == "" || w.Target == "" {
			return fmt.Errorf("wire has empty endpoint")
		}
		if w.Source == w.Target {
			return fmt.Errorf("self-loop on node %q", w.Source)
		}
		if _, ok := nodes[w.Source]; !ok {
			return fmt.Errorf("wire references unknown source %q", w.Source)
		}
		if _, ok := nodes[w.Target]; !ok {
			return fmt.Errorf("wire references unknown target %q", w.Target)
		}
	}
	// Output-single constraint: every node has at most one outgoing wire.
	outCount := make(map[string]int, len(nodes))
	for _, w := range t.Wires {
		outCount[w.Source]++
	}
	for id, count := range outCount {
		if count > 1 {
			return fmt.Errorf("node %q has %d outgoing wires; at most 1 allowed", id, count)
		}
	}
	return nil
}

// activeRequestEntries returns the enabled request entries with positive weight.
func activeRequestEntries(t *Topology) []FlatNode {
	entries := make([]FlatNode, 0)
	for _, n := range t.Nodes {
		if n.Kind == KindRequestEntry && n.Enabled && n.Weight > 0 {
			entries = append(entries, n)
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	return entries
}

// outgoing returns the single target a node connects to, or "".
func outgoing(t *Topology, id string) string {
	for _, w := range t.Wires {
		if w.Source == id {
			return w.Target
		}
	}
	return ""
}

// collectChain walks from a provider node along the single-output wires,
// collecting the slot types it passes through until a node with no outgoing
// wire (or a non-slot) is reached.
func collectChain(t *Topology, provider FlatNode) []string {
	slotTypes := make([]string, 0)
	cur := provider.ID
	visited := map[string]bool{cur: true}
	for {
		next := outgoing(t, cur)
		if next == "" {
			break
		}
		if visited[next] {
			break
		}
		visited[next] = true
		node, ok := nodeByID(t, next)
		if !ok {
			break
		}
		if node.Kind == KindSlot && node.SlotType != "" {
			slotTypes = append(slotTypes, node.SlotType)
		}
		cur = next
	}
	return slotTypes
}

func nodeByID(t *Topology, id string) (FlatNode, bool) {
	for _, n := range t.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return FlatNode{}, false
}

// EligibleProvider is a provider node that can serve the request, tagged with
// its entry weight.
type EligibleProvider struct {
	Node   FlatNode
	Name   string
	Weight float64
	Chain  []string
}

// FindEligibleProviders walks the active request entries and returns every
// provider node reachable from them that can serve the request. Each entry's
// downstream provider is tagged with the entry's weight. A provider must be
// enabled (mini-switch), its configured provider must be Status-enabled and
// match the model, and (when the provider declares paths) the request path.
func FindEligibleProviders(t *Topology, refs map[string]ProviderRef, model, path string) ([]EligibleProvider, error) {
	if err := ValidateTopology(t); err != nil {
		return nil, err
	}
	entries := activeRequestEntries(t)
	result := make([]EligibleProvider, 0)
	seen := map[string]bool{}
	for _, entry := range entries {
		// Walk from the entry through provider slots / provider nodes. The
		// entry's output is the first hop; follow until we hit provider nodes.
		cur := outgoing(t, entry.ID)
		visited := map[string]bool{entry.ID: true}
		for cur != "" && !visited[cur] {
			visited[cur] = true
			node, ok := nodeByID(t, cur)
			if !ok {
				break
			}
			if node.Kind == KindProvider {
				ref, ok := refs[node.Name]
				if !ok || !ref.Status || !node.Enabled || !ref.Enabled || !ref.Workflow {
					// provider unavailable — skip, keep walking its slot output? A
					// provider is a leaf for selection (single provider per entry
					// chain), so stop this branch.
					break
				}
				if !providerSupports(ref, model, path) {
					break
				}
				chain := collectChain(t, node)
				key := node.ID + ":" + entry.ID
				if seen[key] {
					break
				}
				seen[key] = true
				result = append(result, EligibleProvider{
					Node:   node,
					Name:   node.Name,
					Weight: entry.Weight,
					Chain:  chain,
				})
				break
			}
			cur = outgoing(t, cur)
		}
	}
	return result, nil
}

func providerSupports(ref ProviderRef, model, path string) bool {
	if len(ref.Models) > 0 {
		if _, ok := ref.Models[model]; !ok {
			return false
		}
	}
	if len(ref.Paths) > 0 {
		if _, ok := ref.Paths[path]; !ok {
			return false
		}
	}
	return true
}

// DuplicateActivation is one provider that is reachable from more than one
// enabled request entry, which the system forbids (a provider may only be
// active in a single workflow).
type DuplicateActivation struct {
	ProviderName string
	EntryIDs     []string
}

// FindDuplicateActivations walks the enabled request entries and reports any
// provider reachable from more than one of them. It is the source of truth for
// the frontend's "同一个 Provider 不能在多个工作流中被激活" rule.
func FindDuplicateActivations(t *Topology) []DuplicateActivation {
	entryProvider := map[string]string{}
	conflicts := map[string][]string{}
	entries := activeRequestEntries(t)
	for _, entry := range entries {
		cur := outgoing(t, entry.ID)
		visited := map[string]bool{entry.ID: true}
		for cur != "" && !visited[cur] {
			visited[cur] = true
			node, ok := nodeByID(t, cur)
			if !ok {
				break
			}
			if node.Kind == KindProvider {
				if prior, exists := entryProvider[node.Name]; exists && prior != entry.ID {
					conflicts[node.Name] = append(conflicts[node.Name], entry.ID)
				} else if !exists {
					entryProvider[node.Name] = entry.ID
				}
				break
			}
			cur = outgoing(t, cur)
		}
	}
	result := make([]DuplicateActivation, 0, len(conflicts))
	for name, ids := range conflicts {
		result = append(result, DuplicateActivation{ProviderName: name, EntryIDs: ids})
	}
	return result
}
