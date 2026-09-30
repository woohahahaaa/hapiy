import { describe, expect, it } from 'vitest'
import { canvasFromFlat } from './flat-topology'
import { buildCanvasNodes } from './canvas-nodes'
import type { FlatNode, FlatWire } from './dashboard-api'

function entry(id: string): FlatNode {
  return { id, kind: 'requestEntry', enabled: true }
}

function slot(id: string, slotType = 'requestModify'): FlatNode {
  return { id, kind: 'slot', enabled: true, slotType }
}

function switchNode(id: string): FlatNode {
  return { id, kind: 'switch', enabled: true, config: { providers: [], conditions: [] } }
}

function wire(source: string, target: string, branch?: 'yes' | 'no'): FlatWire {
  return branch ? { source, target, branch } : { source, target }
}

function dataOf(nodes: ReturnType<typeof buildCanvasNodes>, id: string): Record<string, unknown> {
  const node = nodes.find((n) => n.id === id)
  if (!node) throw new Error(`node ${id} not found`)
  return node.data as Record<string, unknown>
}

describe('buildCanvasNodes', () => {
  it('renders condition-switch nodes as switch nodes (not slots)', () => {
    const canvas = canvasFromFlat(
      [entry('e'), switchNode('sw'), slot('s1'), slot('s2', 'logOutput')],
      [wire('e', 'sw'), wire('sw', 's1', 'yes'), wire('sw', 's2', 'no')],
    )

    const nodes = buildCanvasNodes(canvas, { providers: [] })
    expect(nodes.find((n) => n.id === 'sw')?.type).toBe('switch')
    expect(nodes.find((n) => n.id === 'e')?.type).toBe('requestEntry')
    expect(nodes.find((n) => n.id === 's1')?.type).toBe('slot')
  })

  it('assigns the incoming-wire count to the handlebar segment count', () => {
    const canvas = canvasFromFlat(
      [entry('e1'), entry('e2'), slot('s')],
      [wire('e1', 's'), wire('e2', 's')],
    )

    const nodes = buildCanvasNodes(canvas, { providers: [] })
    expect(dataOf(nodes, 's').connectionCount).toBe(2)
  })

  it('defaults missing handlers to no-ops so the preview stays read-only', () => {
    const canvas = canvasFromFlat(
      [entry('e'), switchNode('sw'), slot('s', 'logOutput')],
      [wire('e', 'sw'), wire('sw', 's', 'yes')],
    )

    const nodes = buildCanvasNodes(canvas, { providers: [] })
    const sw = dataOf(nodes, 'sw')
    expect(() => (sw.onSaveConfig as (name: string, config: unknown) => void)('x', {})).not.toThrow()
    const s = dataOf(nodes, 's')
    expect(() => (s.onToggleEnabled as (enabled: boolean) => void)(true)).not.toThrow()
  })
})
