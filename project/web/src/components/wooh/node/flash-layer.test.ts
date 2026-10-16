import { describe, expect, it } from 'vitest'
import { flashKeyframeStyle, nodeFlashKeyframeName } from './flash-layer'
import type { FlowLayerOverlay } from '@/modules/flow-hub'

// handle / handlebar 与节点框的覆盖层共用这一份动画参数；它们不再各写一套，
// 所以这里锁住"层 → 关键帧名 + 时长"的映射。
describe('flashKeyframeStyle', () => {
  it('returns nothing when no layer is active', () => {
    expect(flashKeyframeStyle()).toEqual({})
    expect(flashKeyframeStyle([])).toEqual({})
  })

  it('maps one layer to its keyframe name and the shared step duration', () => {
    const layer: FlowLayerOverlay = { runId: 5, color: '#38bdf8', loop: 0 }
    expect(flashKeyframeStyle([layer])).toMatchObject({
      animationName: nodeFlashKeyframeName(layer),
      animationDuration: '340ms',
      animationIterationCount: '1',
      animationFillMode: 'both',
      animationTimingFunction: 'linear',
    })
  })

  it('lists stacked layers in order so DOM order decides the winner', () => {
    const layers: FlowLayerOverlay[] = [
      { runId: 5, color: '#38bdf8', loop: 1 },
      { runId: 9, color: '#f97316', loop: 2 },
    ]
    const style = flashKeyframeStyle(layers)
    expect(style.animationName).toBe('node-flash-5-1, node-flash-9-2')
    expect(style.animationDuration).toBe('340ms, 340ms')
  })
})
