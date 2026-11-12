import { describe, expect, it } from 'vitest'
import { canvasFromFlat, canvasWireHandles, flatWiresFromCanvas } from './flat-topology'
import type { FlatNode, FlatWire } from './dashboard-api'

function entry(id: string): FlatNode {
  return { id, kind: 'requestEntry', enabled: true }
}

function slot(id: string, slotType = 'provider'): FlatNode {
  return { id, kind: 'slot', enabled: true, slotType }
}

function provider(id: string, enabled = true): FlatNode {
  return { id, kind: 'provider', enabled, name: id, providerId: `p-${id}` }
}

function switchNode(id: string): FlatNode {
  return { id, kind: 'switch', enabled: true, config: { providers: [], conditions: [] } }
}

function wire(source: string, target: string, branch?: 'yes' | 'no'): FlatWire {
  return branch ? { source, target, branch } : { source, target }
}

describe('canvasWireHandles', () => {
  it('keeps switch branch source handles and anchors each target to seg-0', () => {
    const topLevel = [entry('e'), switchNode('sw'), slot('a'), slot('b')]
    const wires = [wire('e', 'sw'), wire('sw', 'a', 'yes'), wire('sw', 'b', 'no')]

    expect(canvasWireHandles(wires, topLevel)).toEqual([
      { sourceHandle: undefined, targetHandle: 'seg-0' },
      { sourceHandle: 'yes', targetHandle: 'seg-0' },
      { sourceHandle: 'no', targetHandle: 'seg-0' },
    ])
  })

  it('assigns sequential seg-i target handles for multiple wires into one slot', () => {
    const topLevel = [entry('e'), slot('s'), slot('t')]
    const wires = [wire('e', 's'), wire('t', 's')]

    expect(canvasWireHandles(wires, topLevel)).toEqual([
      { sourceHandle: undefined, targetHandle: 'seg-0' },
      { sourceHandle: undefined, targetHandle: 'seg-1' },
    ])
  })

  it('leaves the target handle unset for non-rail targets', () => {
    const topLevel = [entry('e')]
    const wires = [wire('e', 'e')]

    expect(canvasWireHandles(wires, topLevel)).toEqual([
      { sourceHandle: undefined, targetHandle: undefined },
    ])
  })

  it('does not set a source handle for plain (branchless) wires', () => {
    const topLevel = [entry('e'), slot('s')]
    expect(canvasWireHandles([wire('e', 's')], topLevel)[0].sourceHandle).toBeUndefined()
  })
})

describe('flatWiresFromCanvas provider slot wiring', () => {
  it('wires slot → primary provider even without a downstream (minimal topology)', () => {
    const nodes: FlatNode[] = [entry('e'), slot('s'), provider('a')]
    const collapsed = canvasFromFlat(nodes, [wire('e', 's')])

    const saved = flatWiresFromCanvas(collapsed)

    expect(saved).toEqual([wire('e', 's'), wire('s', 'a')])
    // Round-trip stays stable: reloading and saving again keeps the internal wire.
    expect(flatWiresFromCanvas(canvasFromFlat(nodes, saved))).toEqual(saved)
  })

  it('skips disabled cards when choosing the primary', () => {
    const nodes: FlatNode[] = [entry('e'), slot('s'), provider('a', false), provider('b')]
    const collapsed = canvasFromFlat(nodes, [wire('e', 's')])

    expect(flatWiresFromCanvas(collapsed)).toEqual([wire('e', 's'), wire('s', 'b')])
  })

  it('leaves a childless provider slot untouched', () => {
    const nodes: FlatNode[] = [entry('e'), slot('s')]
    const collapsed = canvasFromFlat(nodes, [wire('e', 's')])

    expect(flatWiresFromCanvas(collapsed)).toEqual([wire('e', 's')])
  })

  it('keeps the existing expansion when the slot has a downstream', () => {
    const nodes: FlatNode[] = [
      entry('e'), slot('s'), provider('a'), provider('b'), slot('rm', 'requestModify'),
    ]
    const wires = [wire('e', 's'), wire('s', 'a'), wire('a', 'rm'), wire('b', 'rm')]

    expect(flatWiresFromCanvas(canvasFromFlat(nodes, wires))).toEqual(wires)
  })
})
