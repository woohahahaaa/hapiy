import { describe, expect, it } from 'vitest'
import { canvasWireHandles } from './flat-topology'
import type { FlatNode, FlatWire } from './dashboard-api'

function entry(id: string): FlatNode {
  return { id, kind: 'requestEntry', enabled: true }
}

function slot(id: string, slotType = 'provider'): FlatNode {
  return { id, kind: 'slot', enabled: true, slotType }
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
