package topology

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"
	"sync"
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

// Provider slot child-picking strategies. Strategy lives on the provider slot
// node and decides which of its eligible provider children serves a request.
const (
	StrategySequential = "sequential" // first eligible child in display order (default)
	StrategyRandom     = "random"     // uniform random among eligible children
	StrategyRoundRobin = "roundRobin" // rotate one eligible child per request
)

// Node is one element of the flat topology. IDs are unique strings. A provider
// node carries the provider's configured name (resolved against the Provider
// table at plan time). A request-entry node carries the master switch and weight.
type FlatNode struct {
	ID            string          `json:"id"`
	Kind          NodeKind        `json:"kind"`
	Name          string          `json:"name,omitempty"`            // provider configured name for KindProvider (binding fallback)
	ProviderID    string          `json:"provider_id,omitempty"`     // for KindProvider: stable key of the provider record; survives renames
	SlotType      string          `json:"slot_type,omitempty"`       // for KindSlot
	Enabled       bool            `json:"enabled"`                   // request-entry master switch / provider mini-switch / logOutput slot master switch
	Weight        float64         `json:"weight,omitempty"`          // request-entry weight in [0,1]
	Entries       json.RawMessage `json:"entries,omitempty"`         // for KindSlot: rule entries, opaque to the engine
	LogDeadlineAt *int64          `json:"log_deadline_at,omitempty"` // logOutput slot-level deadline, Unix epoch ms
	Strategy      string          `json:"strategy,omitempty"`        // provider slot child-picking strategy: sequential|random|roundRobin
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
	ID       string // provider record ID (stable).
	Name     string
	Status   bool // Provider table status
	Disabled bool
	Enabled  bool // provider node mini-switch in its slot
	Workflow bool // master-switch activation (derived from its request entry)
	Models   map[string]struct{}
	Paths    map[string]struct{} // supported endpoint paths; empty set = any
}

// refKey returns the identifier a provider node binds to: its stored
// provider_id when present (rename-safe), else its configured name. Lookups
// must use the same key on both sides of the binding.
func refKey(n FlatNode) string {
	if n.ProviderID != "" {
		return n.ProviderID
	}
	return n.Name
}

// Chain is one complete, runnable single-line pipeline starting at a provider.
// It is what dispatch returns: the chosen provider plus the ordered slot types
// that follow it in the wiring.
type Chain struct {
	ProviderID   string   // provider node ID (KindProvider)
	ProviderName string   // configured provider name
	Weight       float64  // request-entry weight
	SlotTypes    []string // slot types reachable after the provider, in wire order
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
		if n.Strategy != "" && !validStrategy(n.Strategy) {
			return fmt.Errorf("node %q has unknown strategy %q", n.ID, n.Strategy)
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
// its entry weight and its stable binding.
type EligibleProvider struct {
	Node       FlatNode
	Name       string
	ProviderID string // stable provider record id; empty on legacy name-only bindings
	Weight     float64
	Chain      []string
	// EntryID is the request entry whose workflow selected this provider,
	// so callers can reconstruct the exact node path the request traverses.
	EntryID string
}

// FindEligibleProviders walks the active request entries and returns every
// provider node reachable from them that can serve the request. Each entry's
// downstream provider is tagged with the entry's weight. A provider must be
// enabled (mini-switch), its configured provider must be Status-enabled and
// match the model, and (when the provider declares paths) the request path.
// When a provider slot holds several providers, the slot's "按顺序" semantics
// apply: if the provider the walk lands on cannot serve the request, the next
// child of the same slot (in array order) is tried.
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
				slotID, pickable := slotRunFor(t, refs, node, model, path)
				var selected FlatNode
				if len(pickable) > 0 {
					switch slotStrategy(t, slotID) {
					case StrategyRandom:
						selected = pickable[rand.Intn(len(pickable))]
					case StrategyRoundRobin:
						selected = pickable[roundRobinIndex(slotID, len(pickable))]
					default:
						selected = pickable[0]
					}
				}
				if selected.ID == "" {
					break
				}
				chain := collectChain(t, selected)
				key := selected.ID + ":" + entry.ID
				if seen[key] {
					break
				}
				seen[key] = true
				result = append(result, EligibleProvider{
					Node:       selected,
					Name:       selected.Name,
					ProviderID: selected.ProviderID,
					Weight:     entry.Weight,
					Chain:      chain,
					EntryID:    entry.ID,
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

// BuildRequestPath walks the single-output wire chain starting at a request
// entry and returns every node ID it passes through, including the provider
// child and each slot node. This is the exact node path a dispatched request
// traverses (request entry -> provider entries -> slots), used by the
// dashboard to light the flow path without re-deriving it from the live
// topology, which may change after the request starts.
func BuildRequestPath(t *Topology, entryID, providerID string) []string {
	if t == nil || entryID == "" || providerID == "" {
		return nil
	}
	path := make([]string, 0, 8)
	seen := map[string]bool{}
	cur := entryID
	for cur != "" && !seen[cur] {
		seen[cur] = true
		path = append(path, cur)
		if cur == providerID {
			cur = outgoing(t, cur)
			continue
		}
		if node, ok := nodeByID(t, cur); ok && node.Kind == KindSlot && node.SlotType == "provider" {
			cur = providerID
			continue
		}
		cur = outgoing(t, cur)
	}
	return path
}

func FindProviderSlotAlternatives(t *Topology, refs map[string]ProviderRef, model, path, entryID, providerID string) []EligibleProvider {
	if t == nil || entryID == "" || providerID == "" {
		return nil
	}
	cur := outgoing(t, entryID)
	visited := map[string]bool{entryID: true}
	for cur != "" && !visited[cur] {
		visited[cur] = true
		node, ok := nodeByID(t, cur)
		if !ok {
			return nil
		}
		if node.Kind == KindSlot && node.SlotType == "provider" {
			result := make([]EligibleProvider, 0)
			for _, child := range providerChildren(t, node.ID) {
				if !providerEligible(refs, child, model, path) {
					continue
				}
				result = append(result, EligibleProvider{Node: child, Name: child.Name, ProviderID: child.ProviderID, Chain: collectChain(t, child), EntryID: entryID})
			}
			return result
		}
		if node.Kind == KindProvider && node.ID == providerID {
			return nil
		}
		cur = outgoing(t, cur)
	}
	return nil
}

func providerChildren(t *Topology, slotID string) []FlatNode {
	children := make([]FlatNode, 0)
	for index, node := range t.Nodes {
		if node.ID != slotID {
			continue
		}
		for _, child := range t.Nodes[index+1:] {
			if child.Kind != KindProvider {
				break
			}
			children = append(children, child)
		}
		break
	}
	return children
}

// providerEligible reports whether the provider node can serve the request:
// its bound provider must be present and Status-enabled, the node's own
// mini-switch must be on, and it must support the model (and path).
func providerEligible(refs map[string]ProviderRef, node FlatNode, model, path string) bool {
	ref, ok := refs[refKey(node)]
	if !ok || !ref.Status || ref.Disabled || !node.Enabled || !ref.Enabled || !ref.Workflow {
		return false
	}
	return providerSupports(ref, model, path)
}

func validStrategy(s string) bool {
	switch s {
	case StrategySequential, StrategyRandom, StrategyRoundRobin:
		return true
	}
	return false
}

// slotRunFor returns the containing provider slot's ID ("" when node is not
// inside a provider slot) and every eligible provider child of that slot in
// display order, starting at the wire-landed node. The array adjacency and
// stop rules mirror the old sequential fallback: children are the providers
// listed directly after the slot until a non-provider node appears.
func slotRunFor(t *Topology, refs map[string]ProviderRef, node FlatNode, model, path string) (string, []FlatNode) {
	idx := -1
	slotID := ""
	for i, n := range t.Nodes {
		if n.ID == node.ID {
			idx = i
			break
		}
		if n.Kind == KindSlot && n.SlotType == "provider" {
			slotID = n.ID
		}
		if n.Kind == KindRequestEntry {
			slotID = ""
		}
	}
	if idx < 0 {
		return "", nil
	}
	pickable := make([]FlatNode, 0, 2)
	if providerEligible(refs, node, model, path) {
		pickable = append(pickable, node)
	}
	for i := idx + 1; i < len(t.Nodes); i++ {
		n := t.Nodes[i]
		if n.Kind != KindProvider {
			break
		}
		if providerEligible(refs, n, model, path) {
			pickable = append(pickable, n)
		}
	}
	return slotID, pickable
}

func slotStrategy(t *Topology, slotID string) string {
	if slotID == "" {
		return ""
	}
	for _, n := range t.Nodes {
		if n.ID == slotID && n.Kind == KindSlot {
			return n.Strategy
		}
	}
	return ""
}

var (
	rrMu   sync.Mutex
	rrNext = map[string]int{}
)

func roundRobinIndex(slotID string, n int) int {
	rrMu.Lock()
	defer rrMu.Unlock()
	i := rrNext[slotID] % n
	rrNext[slotID]++
	return i
}

// ResetRoundRobinForTest clears the per-slot round-robin cursors.
func ResetRoundRobinForTest() {
	rrMu.Lock()
	defer rrMu.Unlock()
	rrNext = map[string]int{}
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
				key := refKey(node)
				if prior, exists := entryProvider[key]; exists && prior != entry.ID {
					conflicts[node.Name] = append(conflicts[node.Name], entry.ID)
				} else if !exists {
					entryProvider[key] = entry.ID
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
