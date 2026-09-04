import { describe, expect, it } from 'vitest'
import { rerouteWiresAroundRemoved } from './flat-topology'
import type { FlatWire } from './dashboard-api'

const wire = (source: string, target: string): FlatWire => ({ source, target })

describe('rerouteWiresAroundRemoved', () => {
  it('reroutes a middle node delete: entry → pslot → modify → response becomes entry → pslot → response', () => {
    const wires = [
      wire('entry', 'pslot'),
      wire('pslot', 'modify'),
      wire('modify', 'response'),
    ]
    expect(rerouteWiresAroundRemoved(wires, ['modify'])).toEqual([
      wire('entry', 'pslot'),
      wire('pslot', 'response'),
    ])
  })

  it('deleting a head node (no predecessor) just removes it and its wires', () => {
    const wires = [wire('entry', 'modify'), wire('modify', 'response')]
    expect(rerouteWiresAroundRemoved(wires, ['entry'])).toEqual([wire('modify', 'response')])
  })

  it('deleting a tail node (no successor) just removes it and its wires', () => {
    const wires = [wire('entry', 'modify'), wire('modify', 'response')]
    expect(rerouteWiresAroundRemoved(wires, ['response'])).toEqual([wire('entry', 'modify')])
  })

  it('reroutes across two adjacent removed middles to the last surviving target', () => {
    const wires = [wire('entry', 'm1'), wire('m1', 'm2'), wire('m2', 'response')]
    expect(rerouteWiresAroundRemoved(wires, ['m1', 'm2'])).toEqual([wire('entry', 'response')])
  })

  it('reroutes around a provider hop: slot → prov → next becomes slot → next', () => {
    const wires = [
      wire('pslot', 'prov'),
      wire('prov', 'requestModify'),
      wire('requestModify', 'responseModify'),
    ]
    expect(rerouteWiresAroundRemoved(wires, ['prov'])).toEqual([
      wire('pslot', 'requestModify'),
      wire('requestModify', 'responseModify'),
    ])
  })

  it('deleting a provider slot also removes its provider child and reroutes around both', () => {
    const wires = [
      wire('entry', 'pslot'),
      wire('pslot', 'prov'),
      wire('prov', 'requestModify'),
      wire('requestModify', 'responseModify'),
    ]
    expect(rerouteWiresAroundRemoved(wires, ['pslot', 'prov'])).toEqual([
      wire('entry', 'requestModify'),
      wire('requestModify', 'responseModify'),
    ])
  })

  it('reroutes across a whole removed segment in a batch delete', () => {
    const wires = [
      wire('entry', 'pslot'),
      wire('pslot', 'prov'),
      wire('prov', 'requestModify'),
      wire('requestModify', 'responseModify'),
    ]
    expect(rerouteWiresAroundRemoved(wires, ['pslot', 'prov', 'requestModify'])).toEqual([
      wire('entry', 'responseModify'),
    ])
  })

  it('keeps unrelated wires untouched', () => {
    const wires = [
      wire('entry', 'modify'),
      wire('modify', 'response'),
      wire('otherEntry', 'otherSlot'),
    ]
    expect(rerouteWiresAroundRemoved(wires, ['modify'])).toEqual([
      wire('entry', 'response'),
      wire('otherEntry', 'otherSlot'),
    ])
  })

  it('returns the same list when nothing is removed', () => {
    const wires = [wire('entry', 'modify')]
    expect(rerouteWiresAroundRemoved(wires, [])).toEqual(wires)
  })
})
