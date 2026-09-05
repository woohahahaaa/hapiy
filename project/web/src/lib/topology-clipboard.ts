import type { FlatNode, FlatTopology, FlatWire } from './dashboard-api'
import { canvasFromFlat, PROVIDER_SLOT_TYPE } from './flat-topology'

/** JSON snapshot of the selected subgraph, cached in memory for copy/paste. */
export type TopologyClipboardSnapshot = {
  readonly nodes: readonly FlatNode[]
  readonly wires: readonly FlatWire[]
}

export type IdFactory = () => string

const MODEL_ID_PREFIX = 'model-'

/**
 * Collect the subgraph that should be copied. Model-derived nodes (id starts
 * with `model-`) are excluded — they are recomputed from the topology, not
 * stored in it. Selecting a provider slot automatically pulls in its nested
 * provider children. Only wires whose two endpoints are both in the copied set
 * are kept, so pasting a workflow carries its internal wiring and nothing that
 * would dangle.
 */
export function buildCopySnapshot(
  nodes: readonly FlatNode[],
  wires: readonly FlatWire[],
  selectedIds: ReadonlySet<string>,
): TopologyClipboardSnapshot | null {
  const collapsed = canvasFromFlat(nodes, wires)
  const copyIds = new Set<string>()
  for (const id of selectedIds) {
    if (id.startsWith(MODEL_ID_PREFIX)) continue
    const node = nodes.find((n) => n.id === id)
    if (!node) continue
    copyIds.add(id)
    if (node.kind === 'slot') {
      for (const p of collapsed.providers) {
        if (collapsed.providerSlotOf.get(p.id) === id) copyIds.add(p.id)
      }
    }
  }
  if (copyIds.size === 0) return null
  return {
    nodes: nodes.filter((n) => copyIds.has(n.id)),
    wires: wires.filter((w) => copyIds.has(w.source) && copyIds.has(w.target)),
  }
}

/** The id prefix a flat node should keep when pasted (e.g. `entry-`, `pslot-`). */
function nodeIdPrefix(node: FlatNode): string {
  switch (node.kind) {
    case 'requestEntry':
      return 'entry'
    case 'provider':
      return 'prov'
    case 'slot':
      return node.slotType === PROVIDER_SLOT_TYPE ? 'pslot' : (node.slotType ?? 'pslot')
    case 'switch':
      return 'switch'
  }
}

function makeFreshId(prefix: string, used: ReadonlySet<string>, makeId: IdFactory): string {
  let id = `${prefix}-${makeId()}`
  while (used.has(id)) id = `${prefix}-${makeId()}`
  return id
}

export type PasteResult = {
  readonly nodes: readonly FlatNode[]
  readonly wires: readonly FlatWire[]
  readonly idMap: ReadonlyMap<string, string>
}

/**
 * Re-materialize a copied snapshot as brand-new nodes: every node gets a fresh
 * id that does not collide with `existingIds`, and wires are remapped through
 * the id map. Returns null when the snapshot is empty. `makeId` is injectable
 * for tests; the default produces `crypto.randomUUID()` slices like the rest of
 * the canvas.
 */
export function pasteTopologySnapshot(
  snapshot: TopologyClipboardSnapshot,
  existingIds: ReadonlySet<string>,
  makeId: IdFactory = () => crypto.randomUUID().slice(0, 8),
): PasteResult | null {
  if (snapshot.nodes.length === 0) return null
  const used = new Set(existingIds)
  const idMap = new Map<string, string>()
  const nodes: FlatNode[] = []
  for (const node of snapshot.nodes) {
    const fresh = makeFreshId(nodeIdPrefix(node), used, makeId)
    used.add(fresh)
    idMap.set(node.id, fresh)
    nodes.push({ ...node, id: fresh })
  }
  const wires: FlatWire[] = []
  for (const wire of snapshot.wires) {
    const source = idMap.get(wire.source)
    const target = idMap.get(wire.target)
    if (!source || !target) continue
    wires.push(wire.branch ? { source, target, branch: wire.branch } : { source, target })
  }
  return { nodes, wires, idMap }
}

/** Cheap deep-equality check used to skip no-op history commits. */
export function sameFlatTopology(a: FlatTopology, b: FlatTopology): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
