import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { getLayoutedElements, layoutFlatCanvas, rankOfNode } from './topology-auto-layout'
import type { NodeSize, NodeSizeMap } from './use-reactflow-node-sizes'
import { canvasFromFlat } from './flat-topology'
import type { FlatNode, FlatWire } from './dashboard-api'

const opts = {
  nodeGap: 20,
  rowGap: 20,
  modelHubGap: 20,
  groupGap: 20,
  marginX: 20,
  marginY: 30,
}

const uuidA = '550e8400-e29b-41d4-a716-446655440000'
const uuidB = '6a1edc11-1eb4-41d4-9be4-9c8e7f4f1ce9'

const flatOpts = {
  ...opts,
  freeSlotRowWidthFactor: 1.5,
  slotBaseWidth: 240,
}

function flatNode(id: string, kind: 'requestEntry' | 'slot', slotType?: string): FlatNode {
  return slotType ? { id, kind, enabled: true, slotType } : { id, kind, enabled: true }
}

function switchNode(id: string): FlatNode {
  return { id, kind: 'switch', enabled: true, config: { providers: [], conditions: [] } }
}

function wire(source: string, target: string, branch?: 'yes' | 'no'): FlatWire {
  return branch ? { source, target, branch } : { source, target }
}

function sizesFrom(entries: Record<string, NodeSize>): NodeSizeMap {
  return new Map(Object.entries(entries))
}

describe('rankOfNode', () => {
  it('assigns rank -1 to modelHub, 0 to provider, 1+ to slot types', () => {
    const nodes: Node[] = [
      { id: 'm', type: 'modelHub', position: { x: 0, y: 0 }, data: {} },
      { id: 'p', type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: 'slot-uuid-requestModify', type: 'slot', position: { x: 0, y: 0 }, data: {} },
      { id: 'slot-uuid-responseModify', type: 'slot', position: { x: 0, y: 0 }, data: {} },
      { id: 'slot-uuid-logOutput', type: 'slot', position: { x: 0, y: 0 }, data: {} },
    ]
    expect(rankOfNode(nodes[0])).toBe(-1)
    expect(rankOfNode(nodes[1])).toBe(0)
    expect(rankOfNode(nodes[2])).toBe(1)
    expect(rankOfNode(nodes[3])).toBe(2)
    expect(rankOfNode(nodes[4])).toBe(5)
  })

  it('parses slot type from the last dash when provider id contains dashes', () => {
    const node: Node = { id: `slot-${uuidA}-autoSwitch`, type: 'slot', position: { x: 0, y: 0 }, data: {} }
    expect(rankOfNode(node)).toBe(4)
  })
})

describe('getLayoutedElements — measured sizes', () => {
  it('horizontal gap is edge-to-edge: next.x = previous.x + previous.width + nodeGap', () => {
    const nodes: Node[] = [
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-requestModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-responseModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      [`pv-${uuidA}`]: { width: 250, height: 80 },
      [`slot-${uuidA}-requestModify`]: { width: 280, height: 150 },
      [`slot-${uuidA}-responseModify`]: { width: 300, height: 120 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], opts, sizes)
    const get = (id: string) => out.find((n) => n.id === id)!

    expect(get(`pv-${uuidA}`).position.x).toBe(20)
    expect(get(`slot-${uuidA}-requestModify`).position.x).toBe(20 + 250 + 20)
    expect(get(`slot-${uuidA}-responseModify`).position.x).toBe(290 + 280 + 20)
  })

  it('vertical gap between workflow rows is edge-to-edge: next.y = previous.y + previous.height + rowGap', () => {
    const nodes: Node[] = [
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-requestModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
      { id: `pv-${uuidB}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidB}-requestModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      [`pv-${uuidA}`]: { width: 250, height: 80 },
      [`slot-${uuidA}-requestModify`]: { width: 280, height: 150 },
      [`pv-${uuidB}`]: { width: 200, height: 60 },
      [`slot-${uuidB}-requestModify`]: { width: 220, height: 100 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], opts, sizes)
    const get = (id: string) => out.find((n) => n.id === id)!

    // Row height is the tallest node; provider centers vertically within the row.
    const slotA = get(`slot-${uuidA}-requestModify`)
    const slotB = get(`slot-${uuidB}-requestModify`)
    const pvB = get(`pv-${uuidB}`)

    expect(slotA.position.y).toBe(30)
    expect(get(`pv-${uuidA}`).position.y).toBe(30 + (150 - 80) / 2)
    expect(slotB.position.y).toBe(30 + 150 + 20)
    expect(pvB.position.y).toBe(30 + 150 + 20 + (100 - 60) / 2)
  })

  it('nodes in a workflow row are vertically centered (share center y)', () => {
    const nodes: Node[] = [
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-requestModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      [`pv-${uuidA}`]: { width: 250, height: 80 },
      [`slot-${uuidA}-requestModify`]: { width: 280, height: 150 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], opts, sizes)
    const get = (id: string) => out.find((n) => n.id === id)!

    const pv = get(`pv-${uuidA}`)
    const slot = get(`slot-${uuidA}-requestModify`)
    expect(pv.position.y + 80 / 2).toBe(slot.position.y + 150 / 2)
  })

  it('modelHub nodes are right-aligned to the model group right edge', () => {
    const nodes: Node[] = [
      { id: 'model-wide', type: 'modelHub', position: { x: 0, y: 0 }, data: {} },
      { id: 'model-narrow', type: 'modelHub', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      'model-wide': { width: 200, height: 50 },
      'model-narrow': { width: 100, height: 40 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], opts, sizes)
    const get = (id: string) => out.find((n) => n.id === id)!

    const wide = get('model-wide')
    const narrow = get('model-narrow')
    expect(wide.position.x + 200).toBe(20 + 200)
    expect(narrow.position.x + 100).toBe(20 + 200)
    expect(wide.position.x).toBe(20)
    expect(narrow.position.x).toBe(120)
  })

  it('workflow group starts after model group right edge + groupGap', () => {
    const nodes: Node[] = [
      { id: 'model-a', type: 'modelHub', position: { x: 0, y: 0 }, data: {} },
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      'model-a': { width: 200, height: 50 },
      [`pv-${uuidA}`]: { width: 250, height: 80 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], opts, sizes)
    const get = (id: string) => out.find((n) => n.id === id)!

    expect(get(`pv-${uuidA}`).position.x).toBe(20 + 200 + 20)
  })

  it('model group and workflow group share the same vertical center', () => {
    const nodes: Node[] = [
      { id: 'model-a', type: 'modelHub', position: { x: 0, y: 0 }, data: {} },
      { id: 'model-b', type: 'modelHub', position: { x: 0, y: 0 }, data: {} },
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      'model-a': { width: 200, height: 50 },
      'model-b': { width: 100, height: 30 },
      [`pv-${uuidA}`]: { width: 250, height: 80 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], opts, sizes)
    const get = (id: string) => out.find((n) => n.id === id)!

    const ma = get('model-a')
    const mb = get('model-b')
    const pv = get(`pv-${uuidA}`)

    const modelTop = Math.min(ma.position.y, mb.position.y)
    const modelBottom = Math.max(ma.position.y + 50, mb.position.y + 30)
    const modelCenter = (modelTop + modelBottom) / 2

    const wfCenter = pv.position.y + 80 / 2
    expect(Math.abs(modelCenter - wfCenter)).toBeLessThan(1)
  })

  it('nodeGap = 0 makes in-row edges touch (no gap)', () => {
    const nodes: Node[] = [
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-requestModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      [`pv-${uuidA}`]: { width: 250, height: 80 },
      [`slot-${uuidA}-requestModify`]: { width: 280, height: 150 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], { ...opts, nodeGap: 0 }, sizes)
    const get = (id: string) => out.find((n) => n.id === id)!
    expect(get(`pv-${uuidA}`).position.x).toBe(20)
    expect(get(`slot-${uuidA}-requestModify`).position.x).toBe(20 + 250)
  })

  it('modelHubGap = 0 makes stacked modelHub edges touch (no gap)', () => {
    const nodes: Node[] = [
      { id: 'm1', type: 'modelHub', position: { x: 0, y: 0 }, data: {} },
      { id: 'm2', type: 'modelHub', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      m1: { width: 100, height: 40 },
      m2: { width: 200, height: 50 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], { ...opts, modelHubGap: 0 }, sizes)
    expect(out[1].position.y - out[0].position.y).toBe(40)
  })
})

describe('getLayoutedElements — fallback and invariants', () => {
  it('missing measurement falls back to fallbackNodeSize (deterministic)', () => {
    const nodes: Node[] = [
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-requestModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-responseModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      [`pv-${uuidA}`]: { width: 250, height: 80 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], opts, sizes)
    const get = (id: string) => out.find((n) => n.id === id)!

    expect(get(`pv-${uuidA}`).position.x).toBe(20)
    expect(get(`slot-${uuidA}-requestModify`).position.x).toBe(290)
    expect(get(`slot-${uuidA}-responseModify`).position.x).toBe(290 + 224 + 20)
  })

  it('no sizes map uses fallbackNodeSize for every node', () => {
    const nodes: Node[] = [
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-requestModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
    ]
    const out = getLayoutedElements(nodes, [] as Edge[], opts)
    const get = (id: string) => out.find((n) => n.id === id)!

    expect(get(`pv-${uuidA}`).position.x).toBe(20)
    expect(get(`slot-${uuidA}-requestModify`).position.x).toBe(20 + 224 + 20)
  })

  it('does not mutate node dimensions — output nodes carry only position', () => {
    const nodes: Node[] = [
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-requestModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      [`pv-${uuidA}`]: { width: 250, height: 80 },
      [`slot-${uuidA}-requestModify`]: { width: 280, height: 150 },
    })
    const out = getLayoutedElements(nodes, [] as Edge[], opts, sizes)

    for (const node of out) {
      expect(node).not.toHaveProperty('width')
      expect(node).not.toHaveProperty('height')
    }
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(nodes[1].position).toEqual({ x: 0, y: 0 })
  })

  it('zoom never enters layout: same sizes produce identical positions', () => {
    const nodes: Node[] = [
      { id: `pv-${uuidA}`, type: 'provider', position: { x: 0, y: 0 }, data: {} },
      { id: `slot-${uuidA}-requestModify`, type: 'slot', position: { x: 0, y: 0 }, data: {} },
    ]
    const sizes = sizesFrom({
      [`pv-${uuidA}`]: { width: 250, height: 80 },
      [`slot-${uuidA}-requestModify`]: { width: 280, height: 150 },
    })
    const a = getLayoutedElements(nodes, [] as Edge[], opts, sizes)
    const b = getLayoutedElements(nodes, [] as Edge[], opts, sizes)
    expect(a.map((n) => n.position)).toEqual(b.map((n) => n.position))
  })
})

describe('layoutFlatCanvas — workflow rows', () => {
  it('row starts at the request entry, then slots in wire chain order', () => {
    const nodes = [
      flatNode('entry-a', 'requestEntry'),
      flatNode('pslot-a', 'slot', 'provider'),
      flatNode('rm-a', 'slot', 'requestModify'),
    ]
    const wires = [
      { source: 'entry-a', target: 'pslot-a' },
      { source: 'pslot-a', target: 'rm-a' },
    ]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'entry-a': { width: 200, height: 60 },
      'pslot-a': { width: 240, height: 100 },
      'rm-a': { width: 240, height: 100 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    expect(out['entry-a'].x).toBe(20)
    expect(out['pslot-a'].x).toBe(20 + 200 + 20)
    expect(out['rm-a'].x).toBe(240 + 240 + 20)
    expect(out['pslot-a'].y).toBe(30)
    expect(out['rm-a'].y).toBe(30)
    expect(out['entry-a'].y).toBe(30 + (100 - 60) / 2)
  })

  it('rows stack vertically with rowGap and entries are ordered by id', () => {
    const nodes = [
      flatNode('entry-b', 'requestEntry'),
      flatNode('pslot-b', 'slot', 'provider'),
      flatNode('entry-a', 'requestEntry'),
      flatNode('pslot-a', 'slot', 'provider'),
    ]
    const wires = [
      { source: 'entry-a', target: 'pslot-a' },
      { source: 'entry-b', target: 'pslot-b' },
    ]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'entry-a': { width: 200, height: 60 },
      'pslot-a': { width: 240, height: 100 },
      'entry-b': { width: 180, height: 50 },
      'pslot-b': { width: 200, height: 80 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    expect(out['entry-a'].y).toBe(30 + (100 - 60) / 2)
    expect(out['pslot-a'].y).toBe(30)
    expect(out['pslot-b'].y).toBe(30 + 100 + 20)
    expect(out['entry-b'].y).toBe(30 + 100 + 20 + (80 - 50) / 2)
  })
})

describe('layoutFlatCanvas — free-floating region', () => {
  it('wraps to a new row when the next group left edge would exceed the width cap', () => {
    // Two connected groups, each a chain of two 240px slots → group width 500 > cap 360.
    const nodes = [
      flatNode('g1-a', 'slot', 'requestModify'),
      flatNode('g1-b', 'slot', 'requestModify'),
      flatNode('g2-a', 'slot', 'requestModify'),
      flatNode('g2-b', 'slot', 'requestModify'),
    ]
    const wires = [
      { source: 'g1-a', target: 'g1-b' },
      { source: 'g2-a', target: 'g2-b' },
    ]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'g1-a': { width: 240, height: 80 },
      'g1-b': { width: 240, height: 80 },
      'g2-a': { width: 240, height: 80 },
      'g2-b': { width: 240, height: 80 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    // Group 1 occupies the whole row (width 500 > cap) and is not split across rows.
    expect(out['g1-a']).toEqual({ x: 20, y: 50 })
    expect(out['g1-b']).toEqual({ x: 20 + 240 + 20, y: 50 })
    // Group 2's left edge (20 + 500 + 20 − 20 > 360) would exceed the cap → wraps.
    expect(out['g2-a']).toEqual({ x: 20, y: 50 + 80 + 20 })
    expect(out['g2-b']).toEqual({ x: 20 + 240 + 20, y: 50 + 80 + 20 })
  })

  it('sorts free-floating groups by their first member id', () => {
    const nodes = [
      flatNode('g1-a', 'slot', 'requestModify'),
      flatNode('g1-b', 'slot', 'requestModify'),
      flatNode('g2-a', 'slot', 'requestModify'),
      flatNode('g2-b', 'slot', 'requestModify'),
    ]
    // Wire list order differs from id order; groups must still sort by first member id.
    const wires = [
      { source: 'g2-a', target: 'g2-b' },
      { source: 'g1-a', target: 'g1-b' },
    ]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'g1-a': { width: 100, height: 80 },
      'g1-b': { width: 100, height: 80 },
      'g2-a': { width: 100, height: 80 },
      'g2-b': { width: 100, height: 80 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    // Group heads g1-a < g2-a: the g1 group is placed first, members in chain order.
    expect(out['g1-a'].x).toBe(20)
    expect(out['g1-b'].x).toBe(20 + 100 + 20)
    expect(out['g2-a'].x).toBe(20 + 100 + 20 + 100 + 20)
    expect(out['g2-b'].x).toBe(20 + 100 + 20 + 100 + 20 + 100 + 20)
  })

  it('places connected free-floating slots as one group in wire-chain order', () => {
    const nodes = [
      flatNode('free-a', 'slot', 'requestModify'),
      flatNode('free-b', 'slot', 'requestModify'),
    ]
    const wires = [{ source: 'free-a', target: 'free-b' }]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'free-a': { width: 240, height: 80 },
      'free-b': { width: 240, height: 100 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    // Group width 500 > cap 360 — still one unit on one row, chain order, vertically centered.
    expect(out['free-a']).toEqual({ x: 20, y: 50 + (100 - 80) / 2 })
    expect(out['free-b']).toEqual({ x: 20 + 240 + 20, y: 50 })
  })

  it('orders branched groups deterministically from the smallest head id', () => {
    const nodes = [
      flatNode('free-b', 'slot', 'requestModify'),
      flatNode('free-c', 'slot', 'requestModify'),
      flatNode('free-a', 'slot', 'requestModify'),
    ]
    const wires = [
      { source: 'free-b', target: 'free-c' },
      { source: 'free-a', target: 'free-c' },
    ]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'free-a': { width: 100, height: 80 },
      'free-b': { width: 100, height: 80 },
      'free-c': { width: 100, height: 80 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    // Heads free-a and free-b: walk starts from free-a → free-c, then free-b.
    expect(out['free-a'].x).toBe(20)
    expect(out['free-c'].x).toBe(20 + 100 + 20)
    expect(out['free-b'].x).toBe(20 + 100 + 20 + 100 + 20)
  })
})

describe('layoutFlatCanvas — switch branches', () => {
  it('hangs the two switch branches below the parent row, left-aligned to the switch', () => {
    const nodes = [
      flatNode('entry-a', 'requestEntry'),
      flatNode('pslot-a', 'slot', 'provider'),
      switchNode('sw-a'),
      flatNode('yes1-a', 'slot', 'requestModify'),
      flatNode('yes2-a', 'slot', 'requestModify'),
      flatNode('no1-a', 'slot', 'requestModify'),
    ]
    const wires = [
      wire('entry-a', 'pslot-a'),
      wire('pslot-a', 'sw-a'),
      wire('sw-a', 'yes1-a', 'yes'),
      wire('sw-a', 'no1-a', 'no'),
      wire('yes1-a', 'yes2-a'),
    ]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'entry-a': { width: 200, height: 60 },
      'pslot-a': { width: 240, height: 100 },
      'sw-a': { width: 120, height: 50 },
      'yes1-a': { width: 240, height: 100 },
      'yes2-a': { width: 240, height: 80 },
      'no1-a': { width: 200, height: 60 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    // Parent row: entry → pslot → switch, centered within the row.
    expect(out['entry-a'].y).toBe(30 + (100 - 60) / 2)
    expect(out['pslot-a'].y).toBe(30)
    expect(out['sw-a'].y).toBe(30 + (100 - 50) / 2)
    expect(out['pslot-a'].x).toBe(240)

    // Branch rows stack below the parent row with rowGap, left-aligned at the switch x.
    const switchX = out['sw-a'].x
    expect(out['yes1-a'].x).toBe(switchX)
    expect(out['yes1-a'].y).toBe(30 + 100 + 20)
    expect(out['yes2-a'].x).toBe(switchX + 240 + 20)
    expect(out['yes2-a'].y).toBe(30 + 100 + 20 + (100 - 80) / 2)
    expect(out['no1-a'].x).toBe(switchX)
    expect(out['no1-a'].y).toBe(30 + 100 + 20 + 100 + 20)
  })

  it('a node with multiple incoming wires belongs to its FIRST incoming row', () => {
    const nodes = [
      flatNode('entry-a', 'requestEntry'),
      flatNode('pslot-a', 'slot', 'provider'),
      switchNode('sw-a'),
      flatNode('yes1-a', 'slot', 'requestModify'),
      flatNode('no1-a', 'slot', 'requestModify'),
      flatNode('merge-c', 'slot', 'responseModify'),
    ]
    // merge-c's first incoming wire comes from yes1-a → it joins the yes branch.
    const wires = [
      wire('entry-a', 'pslot-a'),
      wire('pslot-a', 'sw-a'),
      wire('sw-a', 'yes1-a', 'yes'),
      wire('sw-a', 'no1-a', 'no'),
      wire('yes1-a', 'merge-c'),
      wire('no1-a', 'merge-c'),
    ]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'entry-a': { width: 200, height: 60 },
      'pslot-a': { width: 240, height: 100 },
      'sw-a': { width: 120, height: 50 },
      'yes1-a': { width: 240, height: 100 },
      'no1-a': { width: 200, height: 80 },
      'merge-c': { width: 240, height: 80 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    // merge-c follows yes1-a in the yes branch row, not the no row.
    expect(out['merge-c'].x).toBe(out['yes1-a'].x + 240 + 20)
    expect(out['merge-c'].y).toBe(out['yes1-a'].y + (100 - 80) / 2)
    // The no branch is a lone row left-aligned at the switch.
    expect(out['no1-a'].y).toBe(out['yes1-a'].y + 100 + 20)
    expect(out['no1-a'].x).toBe(out['sw-a'].x)
  })

  it('a switch inside a branch hangs its own two sub-branches below', () => {
    const nodes = [
      flatNode('entry-a', 'requestEntry'),
      switchNode('sw-a'),
      switchNode('sw-b'),
      flatNode('sub-x1', 'slot', 'requestModify'),
      flatNode('sub-x2', 'slot', 'requestModify'),
      flatNode('no1-a', 'slot', 'requestModify'),
    ]
    const wires = [
      wire('entry-a', 'sw-a'),
      wire('sw-a', 'sw-b', 'yes'),
      wire('sw-a', 'no1-a', 'no'),
      wire('sw-b', 'sub-x1', 'yes'),
      wire('sw-b', 'sub-x2', 'no'),
    ]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'entry-a': { width: 200, height: 60 },
      'sw-a': { width: 120, height: 50 },
      'sw-b': { width: 120, height: 50 },
      'sub-x1': { width: 240, height: 80 },
      'sub-x2': { width: 240, height: 80 },
      'no1-a': { width: 200, height: 80 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    // sw-b's row hangs below the entry row, left-aligned at sw-a's x.
    const swAX = out['sw-a'].x
    expect(out['sw-b'].x).toBe(swAX)
    expect(out['sw-b'].y).toBe(30 + 60 + 20)
    // sw-b's own branches hang below sw-b's row.
    expect(out['sub-x1'].x).toBe(out['sw-b'].x)
    expect(out['sub-x1'].y).toBe(out['sw-b'].y + 50 + 20)
    expect(out['sub-x2'].x).toBe(out['sw-b'].x)
    expect(out['sub-x2'].y).toBe(out['sub-x1'].y + 80 + 20)
    // The no branch comes after the whole sw-b block.
    expect(out['no1-a'].x).toBe(swAX)
    expect(out['no1-a'].y).toBe(out['sub-x2'].y + 80 + 20)
  })

  it('both branch arms leave nothing in the free-floating region', () => {
    const nodes = [
      flatNode('entry-a', 'requestEntry'),
      switchNode('sw-a'),
      flatNode('yes1-a', 'slot', 'requestModify'),
      flatNode('no1-a', 'slot', 'requestModify'),
      flatNode('free-1', 'slot', 'requestModify'),
    ]
    const wires = [
      wire('entry-a', 'sw-a'),
      wire('sw-a', 'yes1-a', 'yes'),
      wire('sw-a', 'no1-a', 'no'),
    ]
    const canvas = canvasFromFlat(nodes, wires)
    const sizes = sizesFrom({
      'entry-a': { width: 200, height: 60 },
      'sw-a': { width: 120, height: 50 },
      'yes1-a': { width: 240, height: 80 },
      'no1-a': { width: 200, height: 80 },
      'free-1': { width: 240, height: 80 },
    })
    const out = layoutFlatCanvas(canvas, [] as Node[], flatOpts, sizes)

    // Both branch arms sit in the workflow region; free-1 goes below the block.
    expect(out['yes1-a'].y).toBe(30 + 60 + 20)
    expect(out['no1-a'].y).toBe(30 + 60 + 20 + 80 + 20)
    const blockBottom = out['no1-a'].y + 80
    expect(out['free-1'].y).toBe(blockBottom + 20)
  })
})

describe('layoutFlatCanvas — groups', () => {
  it('positions model group, workflow group and free-floating region', () => {
    const nodes = [
      flatNode('entry-a', 'requestEntry'),
      flatNode('pslot-a', 'slot', 'provider'),
      flatNode('free-1', 'slot', 'requestModify'),
    ]
    const wires = [{ source: 'entry-a', target: 'pslot-a' }]
    const canvas = canvasFromFlat(nodes, wires)
    const rfNodes: Node[] = [{ id: 'hub-a', type: 'modelHub', position: { x: 0, y: 0 }, data: {} }]
    const sizes = sizesFrom({
      'hub-a': { width: 200, height: 50 },
      'entry-a': { width: 200, height: 60 },
      'pslot-a': { width: 240, height: 100 },
      'free-1': { width: 240, height: 80 },
    })
    const out = layoutFlatCanvas(canvas, rfNodes, flatOpts, sizes)

    expect(out['hub-a'].x + 200).toBe(20 + 200)
    expect(out['entry-a'].x).toBe(20 + 200 + 20)
    expect(out['pslot-a'].x).toBe(240 + 200 + 20)
    const modelCenter = out['hub-a'].y + 25
    const wfCenter = out['pslot-a'].y + 50
    expect(Math.abs(modelCenter - wfCenter)).toBeLessThan(1)
    expect(out['free-1'].x).toBe(240)
    expect(out['free-1'].y).toBe(Math.max(30 + 100, 55 + 50) + 20)
  })
})
