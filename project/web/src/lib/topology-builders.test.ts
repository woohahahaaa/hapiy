import { describe, expect, it } from 'vitest'
import { computeWorkflowPlacements } from './topology-builders'
import { topologyConfig } from '../config/topology-config'

const { rowGap } = topologyConfig.layout
const { provider } = topologyConfig.initialPositions

describe('computeWorkflowPlacements', () => {
  it('keeps the saved position of laid-out workflows', () => {
    const layout = { 'pv-a': { x: 460, y: 300 } }
    const result = computeWorkflowPlacements(['a'], layout, 80)
    expect(result.get('a')).toEqual({ baseX: 460, baseY: 300 })
  })

  it('places the first unplaced workflow a full row below the lowest existing node', () => {
    const layout = { 'pv-a': { x: 460, y: 300 } }
    const result = computeWorkflowPlacements(['a', 'b'], layout, 80)
    expect(result.get('b')).toEqual({ baseX: 460, baseY: 300 + 80 + rowGap })
  })

  it('stacks consecutive unplaced workflows so they never share a row', () => {
    const layout = { 'pv-a': { x: 460, y: 300 } }
    const result = computeWorkflowPlacements(['a', 'b', 'c'], layout, 80)
    const firstUnplacedY = 300 + 80 + rowGap
    expect(result.get('b')).toEqual({ baseX: 460, baseY: firstUnplacedY })
    expect(result.get('c')).toEqual({ baseX: 460, baseY: firstUnplacedY + 80 + rowGap })
  })

  it('aligns unplaced workflows with the left edge of the first laid-out workflow', () => {
    const layout = {
      'pv-a': { x: 600, y: 100 },
      'pv-b': { x: 600, y: 400 },
    }
    const result = computeWorkflowPlacements(['a', 'b', 'c'], layout, 80)
    expect(result.get('c')).toEqual({ baseX: 600, baseY: 400 + 80 + rowGap })
  })

  it('falls back to config defaults when nothing is laid out', () => {
    const result = computeWorkflowPlacements(['a'], {}, 80)
    expect(result.get('a')).toEqual({ baseX: provider.x, baseY: rowGap })
  })
})
