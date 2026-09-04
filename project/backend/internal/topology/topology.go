package topology

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ConfigRowID is the single TopologyConfig row key shared by handler and relay.
const ConfigRowID = "topology-main"

type RequestOrigin struct {
	EntryID        string
	ProviderSlotID string
	ProviderID     string
}

// Node is one node of a workflow in the canonical topology document.
type Node struct {
	Type       string          `json:"type"`
	Name       string          `json:"name"`
	ProviderID *string         `json:"provider_id,omitempty"`
	RuleID     *string         `json:"rule_id,omitempty"`
	Order      *int            `json:"order,omitempty"`
	Enabled    *bool           `json:"enabled,omitempty"`
	Config     json.RawMessage `json:"config,omitempty"`
}

// Document is the canonical topology document: one workflow per element, each
// starting with a provider node.
type Document [][]Node

// EdgeDocument is the visual wiring layer. Format (recursive, mirrors the
// canvas):
//
//	TopologyEdgeDocument := [ Unit* ]
//	Unit                   := Chain | Cluster
//	Chain                  := [ Ref* ]        // first ref starts a chain
//	Cluster                := [ Unit*, Tail ] // participants share the tail
//	Tail                   := Chain (starts with a slot ref) | Cluster
//	Ref                    := "pv-<key>" | "slot-<key>-<slotType>"
//
// A top-level Chain must start with a provider ref. A top-level Chain that
// starts with a slot ref is a "draft" fragment — the execution engine ignores
// it (it is excluded just like a workflow switched off). Inside a Cluster, a
// slot-headed participant is a flow reference: it continues every
// already-expanded chain whose last ref matches that slot.
type EdgeDocument []json.RawMessage

// SlotOrder is the fixed stage order. Both handler validation and the relay
// execution plan order by this sequence.
var SlotOrder = []string{"requestModify", "responseModify", "autoReply", "concurrency", "autoSwitch", "logOutput"}

// SlotRanks maps every slot type to its execution stage.
var SlotRanks = map[string]int{
	"requestModify":  0,
	"responseModify": 1,
	"autoReply":      2,
	"concurrency":    3,
	"autoSwitch":     4,
	"logOutput":      5,
}

// WorkflowRefs derives the set of valid workflow keys from the canonical
// document. Keys are numbered per provider_id in document order, matching the
// frontend's makeWorkflowKey ("w-{providerId}-{index}").
func WorkflowRefs(document Document) (map[string]bool, error) {
	providerRefs := map[string]bool{}
	seen := map[string]int{}
	for wi, workflow := range document {
		if len(workflow) == 0 || workflow[0].Type != "provider" {
			return nil, fmt.Errorf("workflow %d first node must be provider", wi+1)
		}
		if workflow[0].ProviderID == nil {
			return nil, fmt.Errorf("workflow %d provider_id missing", wi+1)
		}
		idx := seen[*workflow[0].ProviderID]
		seen[*workflow[0].ProviderID] = idx + 1
		key := fmt.Sprintf("w-%s-%d", *workflow[0].ProviderID, idx)
		providerRefs[key] = true
	}
	return providerRefs, nil
}

// validSlotRef checks "slot-{key}-{slotType}" against the workflow keys and
// the fixed slot-type order. It deliberately does NOT require the slot to
// exist in the document: the canvas always renders every slot type per
// workflow, so a connection may target a slot that currently has no rule
// bound (it simply has nothing to execute).
func validSlotRef(ref string, providerKeys map[string]bool) bool {
	if !strings.HasPrefix(ref, "slot-") {
		return false
	}
	rest := strings.TrimPrefix(ref, "slot-")
	lastDash := strings.LastIndex(rest, "-")
	if lastDash < 0 {
		return false
	}
	if !providerKeys[rest[:lastDash]] {
		return false
	}
	slotType := rest[lastDash+1:]
	for _, t := range SlotOrder {
		if t == slotType {
			return true
		}
	}
	return false
}

// ValidateEdges checks the wiring layer against the canonical document. It
// returns an error for any illegal topology so that bad edges never reach the
// database. The check runs on every PUT and again on every GET (defense in
// depth: a stale document must not silently corrupt the execution plan).
func ValidateEdges(edges EdgeDocument, document Document) error {
	providerKeys, err := WorkflowRefs(document)
	if err != nil {
		return err
	}
	expanded, err := Expand(edges)
	if err != nil {
		return err
	}
	seenProvider := map[string]bool{}
	for _, chain := range expanded {
		if len(chain) == 0 {
			return fmt.Errorf("edge chain must not be empty")
		}
		if !strings.HasPrefix(chain[0], "pv-") && !strings.HasPrefix(chain[0], "slot-") {
			return fmt.Errorf("edge chain %v: ref %q must start with pv- or slot-", chain, chain[0])
		}
		if strings.HasPrefix(chain[0], "slot-") {
			for _, ref := range chain {
				if !validSlotRef(ref, providerKeys) {
					return fmt.Errorf("edge chain %v: unknown slot ref %q", chain, ref)
				}
			}
			continue
		}
		key := strings.TrimPrefix(chain[0], "pv-")
		if !providerKeys[key] {
			return fmt.Errorf("edge chain %v: unknown provider ref %q", chain, chain[0])
		}
		if seenProvider[key] {
			return fmt.Errorf("provider %q appears in more than one edge chain", key)
		}
		seenProvider[key] = true
		slots := map[string]bool{}
		for _, ref := range chain[1:] {
			if !strings.HasPrefix(ref, "slot-") {
				return fmt.Errorf("edge chain %v: non-slot ref %q after provider", chain, ref)
			}
			if !validSlotRef(ref, providerKeys) {
				return fmt.Errorf("edge chain %v: unknown slot ref %q", chain, ref)
			}
			if slots[ref] {
				return fmt.Errorf("edge chain %v: slot %q appears more than once in the chain", chain, ref)
			}
			slots[ref] = true
		}
	}
	return nil
}

// chainNode is one element of the edges document: either a []string chain or
// a nested [][]json.RawMessage cluster.
type chainNode struct {
	refs    []string
	cluster []chainNode
	isChain bool
}

func parseChainNode(raw json.RawMessage) (chainNode, error) {
	var probe []json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return chainNode{}, fmt.Errorf("edge unit must be an array: %w", err)
	}
	if len(probe) == 0 {
		return chainNode{}, fmt.Errorf("edge unit must not be empty")
	}
	allStrings := true
	for _, item := range probe {
		var s string
		if err := json.Unmarshal(item, &s); err != nil {
			allStrings = false
			break
		}
	}
	if allStrings {
		refs := make([]string, len(probe))
		for i, item := range probe {
			if err := json.Unmarshal(item, &refs[i]); err != nil {
				return chainNode{}, fmt.Errorf("edge chain ref: %w", err)
			}
		}
		return chainNode{refs: refs, isChain: true}, nil
	}
	children := make([]chainNode, len(probe))
	for i, item := range probe {
		child, err := parseChainNode(item)
		if err != nil {
			return chainNode{}, err
		}
		children[i] = child
	}
	if len(children) < 2 {
		return chainNode{}, fmt.Errorf("edge cluster must contain at least a chain and a shared tail")
	}
	return chainNode{cluster: children, isChain: false}, nil
}

// Expand flattens the nested structure into full chains.
//
// Cluster semantics: every participant chain is continued by the shared tail.
// A slot-headed participant is a flow reference — it continues every chain in
// the pool whose last ref equals that slot (this is what makes multi-level
// sharing work, e.g. two chains merging into R, then R and a third chain
// merging into L). Continuation consumes the source chain so it is not
// referenced twice.
func Expand(edges EdgeDocument) ([][]string, error) {
	pool := [][]string{}
	for _, raw := range edges {
		node, err := parseChainNode(raw)
		if err != nil {
			return nil, err
		}
		if err := expandNode(node, &pool); err != nil {
			return nil, err
		}
	}
	return pool, nil
}

func expandNode(node chainNode, pool *[][]string) error {
	if node.isChain {
		*pool = append(*pool, node.refs)
		return nil
	}
	return expandCluster(node.cluster, pool)
}

// expandCluster processes one Cluster: participants first (their chains enter
// the pool / match flow refs), then the shared tail continues them.
func expandCluster(cluster []chainNode, pool *[][]string) error {
	if len(cluster) < 2 {
		return fmt.Errorf("edge cluster must contain at least a chain and a shared tail")
	}
	participants := cluster[:len(cluster)-1]
	tail := cluster[len(cluster)-1]

	tails, err := continuationOf(tail)
	if err != nil {
		return err
	}

	newChains := [][]string{}
	flowRefs := []string{}
	for _, p := range participants {
		if p.isChain {
			if strings.HasPrefix(p.refs[0], "pv-") {
				newChains = append(newChains, p.refs)
			} else {
				flowRefs = append(flowRefs, p.refs[0])
			}
			continue
		}
		local := [][]string{}
		if err := expandCluster(p.cluster, &local); err != nil {
			return err
		}
		newChains = append(newChains, local...)
	}

	matched := [][]string{}
	kept := [][]string{}
	flowSet := map[string]bool{}
	for _, ref := range flowRefs {
		flowSet[ref] = true
	}
	for _, c := range *pool {
		if len(c) > 0 && flowSet[c[len(c)-1]] {
			matched = append(matched, c)
		} else {
			kept = append(kept, c)
		}
	}

	continued := [][]string{}
	for _, c := range newChains {
		for _, t := range tails {
			continued = append(continued, appendChain(c, t))
		}
	}
	for _, c := range matched {
		for _, t := range tails {
			continued = append(continued, appendChain(c, t))
		}
	}
	*pool = append(kept, continued...)
	return nil
}

func appendChain(base, tail []string) []string {
	out := make([]string, 0, len(base)+len(tail))
	out = append(out, base...)
	out = append(out, tail...)
	return out
}

// continuationOf resolves a Tail into slot-headed chain continuations.
func continuationOf(tail chainNode) ([][]string, error) {
	if tail.isChain {
		if len(tail.refs) == 0 {
			return nil, fmt.Errorf("edge shared tail must not be empty")
		}
		if strings.HasPrefix(tail.refs[0], "pv-") {
			return nil, fmt.Errorf("edge shared tail must start with a slot ref, got %q", tail.refs[0])
		}
		return [][]string{tail.refs}, nil
	}
	pool := [][]string{}
	if err := expandCluster(tail.cluster, &pool); err != nil {
		return nil, err
	}
	if len(pool) == 0 {
		return nil, fmt.Errorf("edge shared tail cluster expands to nothing")
	}
	return pool, nil
}

// DefaultEdges builds the fully-connected chain for every workflow (provider →
// every slot type in fixed order). It is the fallback for empty or legacy
// stored edges and matches the pre-Edges rendering exactly.
func DefaultEdges(document Document) (EdgeDocument, error) {
	providerKeys, err := WorkflowRefs(document)
	if err != nil {
		return nil, err
	}
	out := make(EdgeDocument, 0, len(providerKeys))
	keys := make([]string, 0, len(providerKeys))
	for key := range providerKeys {
		keys = append(keys, key)
	}
	sortStrings(keys)
	for _, key := range keys {
		chain := []string{"pv-" + key}
		for _, slotType := range SlotOrder {
			chain = append(chain, "slot-"+key+"-"+slotType)
		}
		raw, err := json.Marshal(chain)
		if err != nil {
			return nil, err
		}
		out = append(out, raw)
	}
	return out, nil
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

// NormalizeEdgesForSave returns the client wiring, or the default
// fully-connected chain when the client sent none. Client-supplied edges are
// validated strictly so bad topology never reaches the database.
func NormalizeEdgesForSave(edges EdgeDocument, document Document) (EdgeDocument, error) {
	if len(edges) == 0 {
		return DefaultEdges(document)
	}
	if err := ValidateEdges(edges, document); err != nil {
		return nil, err
	}
	return edges, nil
}

// ResolveEdges validates the stored wiring layer. Empty or invalid edges
// (legacy "[]" data, or a corrupted store) fall back to the default
// fully-connected chain so rendering and execution never break.
func ResolveEdges(edges EdgeDocument, document Document) (EdgeDocument, error) {
	if len(edges) > 0 && ValidateEdges(edges, document) == nil {
		return edges, nil
	}
	return DefaultEdges(document)
}

// ReachableSlotTypes returns the set of slot types that the given provider's
// workflow instance(s) connect to in the wiring layer. The execution plan, like
// the canvas, runs only the reachable slots; a workflow whose chain was broken
// off (or that is not part of any chain) contributes nothing to execute. The
// reference schema is "slot-w-{providerID}-{idx}-{slotType}", so we match only
// this provider's own slots and ignore shared slots owned by other workflows.
func ReachableSlotTypes(document Document, edges EdgeDocument, providerID string) (map[string]bool, error) {
	providerKeys, err := WorkflowRefs(document)
	if err != nil {
		return nil, err
	}
	prefix := "w-" + providerID + "-"
	instanceKeys := map[string]bool{}
	for key := range providerKeys {
		if strings.HasPrefix(key, prefix) {
			instanceKeys[key] = true
		}
	}
	expanded, err := Expand(edges)
	if err != nil {
		return nil, err
	}
	reachable := map[string]bool{}
	for _, chain := range expanded {
		if len(chain) == 0 || !strings.HasPrefix(chain[0], "pv-") {
			continue
		}
		key := strings.TrimPrefix(chain[0], "pv-")
		if !instanceKeys[key] {
			continue
		}
		for _, ref := range chain[1:] {
			if !strings.HasPrefix(ref, "slot-"+key+"-") {
				continue
			}
			slotType := strings.TrimPrefix(ref, "slot-"+key+"-")
			reachable[slotType] = true
		}
	}
	return reachable, nil
}
