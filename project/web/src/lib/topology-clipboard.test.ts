import { describe, expect, it } from 'vitest'
import type { FlatNode, FlatTopology, FlatWire } from './dashboard-api'
import {
  buildCopySnapshot,
  pasteTopologySnapshot,
  sameFlatTopology,
  type TopologyClipboardSnapshot,
} from './topology-clipboard'

function node(partial: Partial<FlatNode> & { id: string; kind: FlatNode['kind'] }): FlatNode {
  return { enabled: true, ...partial }
}

/** Deterministic id factory: a sequence of 8-char ids. */
function seq(start = 0): () => string {
  let n = start
  return () => {
    n += 1
    return n.toString(16).padStart(8, '0')
  }
}

const entry = (id: string): FlatNode => node({ id, kind: 'requestEntry', name: '入口' })
const slot = (id: string, slotType = 'requestModify'): FlatNode =>
  node({ id, kind: 'slot', slotType, enabled: true })
const pslot = (id: string): FlatNode => node({ id, kind: 'slot', slotType: 'provider', enabled: true })
const prov = (id: string, name: string): FlatNode => node({ id, kind: 'provider', name, enabled: true })

const wire = (source: string, target: string): FlatWire => ({ source, target })

describe('buildCopySnapshot', () => {
  const nodes: FlatNode[] = [
    entry('entry-aaa'),
    pslot('pslot-bbb'),
    prov('prov-ccc', 'alpha'),
    prov('prov-ddd', 'beta'),
    slot('requestModify-eee'),
  ]
  const wires: FlatWire[] = [
    wire('entry-aaa', 'pslot-bbb'),
    wire('pslot-bbb', 'prov-ccc'),
    wire('prov-ccc', 'requestModify-eee'),
    wire('prov-ddd', 'requestModify-eee'),
  ]

  it('returns null when nothing is selected', () => {
    expect(buildCopySnapshot(nodes, wires, new Set())).toBeNull()
  })

  it('ignores model-derived ids and unknown ids', () => {
    const snapshot = buildCopySnapshot(nodes, wires, new Set(['model-entry-aaa-gpt', 'ghost']))
    expect(snapshot).toBeNull()
  })

  it('copies a selected entry with only its internal wires', () => {
    const snapshot = buildCopySnapshot(nodes, wires, new Set(['entry-aaa']))
    expect(snapshot).not.toBeNull()
    expect(snapshot!.nodes.map((n) => n.id)).toEqual(['entry-aaa'])
    expect(snapshot!.wires).toEqual([])
  })

  it('pulls provider children into a selected provider slot', () => {
    const snapshot = buildCopySnapshot(nodes, wires, new Set(['pslot-bbb']))!
    expect(snapshot.nodes.map((n) => n.id).sort()).toEqual(['prov-ccc', 'prov-ddd', 'pslot-bbb'])
    // Only the primary provider's nesting wire is internal; boundary wires dropped.
    expect(snapshot.wires).toEqual([wire('pslot-bbb', 'prov-ccc')])
    expect(snapshot.wires.some((w) => w.source === 'entry-aaa')).toBe(false)
    expect(snapshot.wires.some((w) => w.target === 'requestModify-eee')).toBe(false)
  })

  it('keeps every wire internal to a copied workflow', () => {
    const snapshot = buildCopySnapshot(nodes, wires, new Set(['pslot-bbb', 'requestModify-eee']))!
    expect(snapshot.nodes.map((n) => n.id).sort()).toEqual([
      'prov-ccc',
      'prov-ddd',
      'pslot-bbb',
      'requestModify-eee',
    ])
    expect(snapshot.wires).toEqual([
      wire('pslot-bbb', 'prov-ccc'),
      wire('prov-ccc', 'requestModify-eee'),
      wire('prov-ddd', 'requestModify-eee'),
    ])
    expect(snapshot.wires.some((w) => w.source === 'entry-aaa')).toBe(false)
  })
})

describe('pasteTopologySnapshot', () => {
  const snapshot: TopologyClipboardSnapshot = {
    nodes: [entry('entry-aaa'), pslot('pslot-bbb'), prov('prov-ccc', 'alpha')],
    wires: [wire('entry-aaa', 'pslot-bbb'), wire('pslot-bbb', 'prov-ccc')],
  }

  it('returns null for an empty snapshot', () => {
    expect(pasteTopologySnapshot({ nodes: [], wires: [] }, new Set(), seq())).toBeNull()
  })

  it('gives every node a fresh id and remaps wires through the id map', () => {
    const result = pasteTopologySnapshot(snapshot, new Set(), seq())!
    const ids = new Set(result.nodes.map((n) => n.id))
    expect(ids.has('entry-aaa')).toBe(false)
    expect(ids.has('pslot-bbb')).toBe(false)
    expect(ids.has('prov-ccc')).toBe(false)
    expect(result.idMap.get('entry-aaa')).toBe(result.nodes.find((n) => n.kind === 'requestEntry')!.id)
    expect(result.wires).toEqual([
      { source: result.idMap.get('entry-aaa'), target: result.idMap.get('pslot-bbb') },
      { source: result.idMap.get('pslot-bbb'), target: result.idMap.get('prov-ccc') },
    ])
  })

  it('keeps the original node payloads (kind/slotType/name)', () => {
    const result = pasteTopologySnapshot(snapshot, new Set(), seq())!
    const copied = result.nodes.find((n) => n.kind === 'requestEntry')!
    expect(copied).toMatchObject({ kind: 'requestEntry', name: '入口', enabled: true })
    const slotNode = result.nodes.find((n) => n.kind === 'slot')!
    expect(slotNode.slotType).toBe('provider')
  })

  it('never collides with existing ids', () => {
    // Force the factory to keep producing the id of an existing node.
    const existing = new Set(['entry-00000001'])
    const result = pasteTopologySnapshot(snapshot, existing, seq())!
    for (const n of result.nodes) expect(existing.has(n.id)).toBe(false)
    expect(result.nodes.every((n) => !n.id.endsWith('00000001'))).toBe(true)
  })

  it('skips wires whose endpoints were not copied', () => {
    const partial: TopologyClipboardSnapshot = {
      nodes: [entry('entry-aaa')],
      wires: [wire('entry-aaa', 'pslot-bbb'), wire('pslot-bbb', 'prov-ccc')],
    }
    const result = pasteTopologySnapshot(partial, new Set(), seq())!
    expect(result.wires).toEqual([])
  })
})

describe('sameFlatTopology', () => {
  it('detects identical and different topologies', () => {
    const a: FlatTopology = { nodes: [entry('entry-a')], wires: [] }
    const b: FlatTopology = { nodes: [{ ...entry('entry-a'), enabled: false }], wires: [] }
    const c: FlatTopology = { nodes: [entry('entry-a'), slot('requestModify-b')], wires: [] }
    expect(sameFlatTopology(a, a)).toBe(true)
    expect(sameFlatTopology(a, b)).toBe(false)
    expect(sameFlatTopology(a, c)).toBe(false)
  })
})
