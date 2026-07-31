import { describe, expect, it } from 'vitest'
import {
  getTopologyNodeDimension,
  getTopologyLayoutDimension,
  topologyConfig,
} from './topology-config'

describe('topology-config dimensions', () => {
  it('every node dimension advertises min/max width and a height', () => {
    for (const [name, dim] of Object.entries(topologyConfig.nodeDimensions)) {
      expect(dim.minWidth, `${name}.minWidth`).toBeGreaterThan(0)
      expect(dim.maxWidth, `${name}.maxWidth`).toBeGreaterThan(0)
      expect(dim.maxWidth, `${name}.maxWidth >= minWidth`).toBeGreaterThanOrEqual(dim.minWidth)
      expect(dim.height, `${name}.height`).toBeGreaterThan(0)
    }
  })

  it('getTopologyNodeDimension returns the configured range, not a fixed width', () => {
    const channel = getTopologyNodeDimension('channel')
    expect(channel).toEqual(topologyConfig.nodeDimensions.channel)
    expect(channel).not.toHaveProperty('width')
  })

  it('getTopologyNodeDimension falls back to the fallback range for unknown types', () => {
    const fallback = getTopologyNodeDimension('does-not-exist')
    expect(fallback).toEqual(topologyConfig.fallbackNodeDimension)
  })

  it('getTopologyLayoutDimension reserves the widest possible width for dagre', () => {
    for (const name of Object.keys(topologyConfig.nodeDimensions)) {
      const layout = getTopologyLayoutDimension(name)
      const dim = getTopologyNodeDimension(name)
      expect(layout.width).toBe(dim.maxWidth)
      expect(layout.height).toBe(dim.height)
    }
  })
})
