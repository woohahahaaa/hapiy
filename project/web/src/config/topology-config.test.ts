import { describe, expect, it } from 'vitest'
import {
  topologyConfig,
  nodeRenderBounds,
  fallbackNodeSize,
} from './topology-config'

describe('topology-config render bounds', () => {
  it('render.node exposes shared 200/300 min/max for Provider and slot items', () => {
    expect(topologyConfig.render.node.minWidth).toBe(200)
    expect(topologyConfig.render.node.maxWidth).toBe(300)
  })

  it('nodeRenderBounds export equals render.node', () => {
    expect(nodeRenderBounds).toEqual(topologyConfig.render.node)
    expect(nodeRenderBounds.minWidth).toBe(200)
    expect(nodeRenderBounds.maxWidth).toBe(300)
  })

  it('render.modelHub has padding but no min/max', () => {
    expect(topologyConfig.render.modelHub.paddingX).toBeGreaterThan(0)
    expect(topologyConfig.render.modelHub.paddingY).toBeGreaterThan(0)
    expect(topologyConfig.render.modelHub).not.toHaveProperty('minWidth')
    expect(topologyConfig.render.modelHub).not.toHaveProperty('maxWidth')
  })

  it('render.slot has padding and contentGap', () => {
    expect(topologyConfig.render.slot.padding).toBeGreaterThan(0)
    expect(topologyConfig.render.slot.contentGap).toBeGreaterThanOrEqual(0)
  })

  it('config has no provider padding field (padding stays in component)', () => {
    expect(topologyConfig.render).not.toHaveProperty('provider')
    expect(topologyConfig).not.toHaveProperty('providerPadding')
  })

  it('config has no legacy nodeDimensions or dagre sections', () => {
    expect(topologyConfig).not.toHaveProperty('nodeDimensions')
    expect(topologyConfig).not.toHaveProperty('dagre')
    expect(topologyConfig).not.toHaveProperty('fallbackNodeDimension')
  })

  it('fallbackNodeSize has width and height', () => {
    expect(fallbackNodeSize.width).toBeGreaterThan(0)
    expect(fallbackNodeSize.height).toBeGreaterThan(0)
    expect(fallbackNodeSize).toEqual(topologyConfig.fallbackNodeSize)
  })
})

describe('topology-config layout gaps', () => {
  it('layout exposes distinct edge-to-edge gap fields', () => {
    expect(topologyConfig.layout.nodeGap).toBeGreaterThan(0)
    expect(topologyConfig.layout.rowGap).toBeGreaterThan(0)
    expect(topologyConfig.layout.modelHubGap).toBeGreaterThan(0)
    expect(topologyConfig.layout.groupGap).toBeGreaterThan(0)
    expect(topologyConfig.layout.marginX).toBeGreaterThan(0)
    expect(topologyConfig.layout.marginY).toBeGreaterThan(0)
  })
})
