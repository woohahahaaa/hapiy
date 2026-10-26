import { describe, expect, it } from 'vitest'
import type { FlatNode, FlatTopology, FlatWire } from './dashboard-api'
import { attachProviderToTopology } from './topology-attach'

function node(partial: Partial<FlatNode> & { id: string; kind: FlatNode['kind'] }): FlatNode {
  return { enabled: true, ...partial }
}

const entry = (id: string, extra: Partial<FlatNode> = {}): FlatNode =>
  node({ id, kind: 'requestEntry', name: '入口', weight: 1, ...extra })
const pslot = (id: string): FlatNode => node({ id, kind: 'slot', slotType: 'provider' })
const rewriteSlot = (id: string): FlatNode => node({ id, kind: 'slot', slotType: 'requestModify' })
const prov = (id: string, name: string, providerId?: string): FlatNode =>
  node({ id, kind: 'provider', name, enabled: true, ...(providerId !== undefined ? { providerId } : {}) })

const wire = (source: string, target: string): FlatWire => ({ source, target })
const tp = (nodes: FlatNode[], wires: FlatWire[]): FlatTopology => ({ nodes, wires })

describe('attachProviderToTopology', () => {
  it('creates a new workflow instead of reusing an existing provider slot', () => {
    const base = tp(
      [entry('entry-a'), pslot('pslot-a'), prov('prov-1', 'alpha', 'p-alpha'), rewriteSlot('rm-a')],
      [wire('entry-a', 'pslot-a'), wire('pslot-a', 'prov-1'), wire('prov-1', 'rm-a')],
    )
    const result = attachProviderToTopology(base, { id: 'p-beta', name: 'beta' }, '入口')
    expect(result.kind).toBe('workflowCreated')
    if (result.kind !== 'workflowCreated') return

    const { topology, entryId, slotId } = result
    const card = topology.nodes.find((n) => n.kind === 'provider' && n.providerId === 'p-beta')
    expect(card).toBeDefined()
    expect(card!.enabled).toBe(true)
    // 原有节点和连线原样保留
    expect(topology.nodes.slice(0, base.nodes.length)).toEqual(base.nodes)
    expect(topology.wires.slice(0, base.wires.length)).toEqual(base.wires)
    // 新供应商待在自己的工作流里：入口 → 供应商插槽 → 供应商卡
    expect(topology.wires).toContainEqual(wire(entryId, slotId))
    expect(topology.wires).toContainEqual(wire(slotId, card!.id))
    // 没有挂到别人的插槽上
    expect(topology.wires).not.toContainEqual(wire('pslot-a', card!.id))
  })

  it('skips slots reachable only from disabled entries', () => {
    const base = tp(
      [entry('entry-off', { enabled: false }), pslot('pslot-off'), prov('prov-1', 'alpha', 'p-alpha')],
      [wire('entry-off', 'pslot-off'), wire('pslot-off', 'prov-1')],
    )
    const result = attachProviderToTopology(base, { id: 'p-beta', name: 'beta' }, '请求入口')
    expect(result.kind).toBe('workflowCreated')
    if (result.kind !== 'workflowCreated') return

    const { topology, entryId, slotId } = result
    const card = topology.nodes.find((n) => n.kind === 'provider' && n.providerId === 'p-beta')
    expect(card).toBeDefined()
    // 新建的最小链路：入口 → 供应商插槽 → 供应商卡
    expect(topology.nodes.some((n) => n.id === entryId && n.kind === 'requestEntry')).toBe(true)
    expect(topology.nodes.some((n) => n.id === slotId && n.kind === 'slot')).toBe(true)
    expect(topology.wires).toContainEqual(wire(entryId, slotId))
    expect(topology.wires).toContainEqual(wire(slotId, card!.id))
  })

  it('does not reuse the emergency lane to attach a provider', () => {
    const base = tp(
      [entry('entry-emg', { emergency: true }), pslot('pslot-emg'), prov('prov-1', 'alpha', 'p-alpha')],
      [wire('entry-emg', 'pslot-emg'), wire('pslot-emg', 'prov-1')],
    )
    const result = attachProviderToTopology(base, { id: 'p-beta', name: 'beta' }, '请求入口')
    expect(result.kind).toBe('workflowCreated')
  })

  it('reports exists when the provider already has a card (id or legacy name match)', () => {
    const byId = tp([prov('prov-1', 'alpha', 'p-alpha')], [])
    expect(attachProviderToTopology(byId, { id: 'p-alpha', name: 'alpha' }, '入口').kind).toBe('exists')

    const byName = tp([prov('prov-1', 'alpha')], [])
    expect(attachProviderToTopology(byName, { id: 'p-alpha', name: 'alpha' }, '入口').kind).toBe('exists')
  })
})
