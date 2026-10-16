import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { FLOW_STEP_MS, type FlowLayerOverlay } from '@/modules/flow-hub'

// 统一动画事件命名：节点发光 flash，连线光束 edge-flow。
export const NODE_FLASH_PREFIX = 'node-flash'
export const EDGE_FLOW_PREFIX = 'node-edge-flow'

export function nodeFlashKeyframeName(layer: FlowLayerOverlay): string {
  return `${NODE_FLASH_PREFIX}-${layer.runId}-${layer.loop}`
}

export function edgeFlowKeyframeName(runId: number, edgeId: string): string {
  const safeId = edgeId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${EDGE_FLOW_PREFIX}-${runId}-${safeId}`
}

// 点亮动画的公共参数：节点框的覆盖层、handle、handlebar 共用同一份关键帧名
// 与时长，哪一处要点亮都直接引用这里，不再各写一套动画值。多层叠加时关键帧
// 按顺序列出（同属性后一个生效，等价于 DOM 里后画的盖住先画的）。
export function flashKeyframeStyle(layers: readonly FlowLayerOverlay[] = []): CSSProperties {
  if (layers.length === 0) return {}
  return {
    animationName: layers.map(nodeFlashKeyframeName).join(', '),
    animationDuration: layers.map(() => `${FLOW_STEP_MS}ms`).join(', '),
    animationIterationCount: layers.map(() => '1').join(', '),
    animationFillMode: layers.map(() => 'both').join(', '),
    animationTimingFunction: layers.map(() => 'linear').join(', '),
  }
}

interface FlashLayerProps {
  layer: FlowLayerOverlay
  className?: string
}

// 节点类动画的统一播放层：发光边框 span + 一次性 keyframe。
// 各节点组件在自身体内调用（内化），实现与命名只有这一份。
// 缺省 node-frame-inset：所在框内侧的同心圆角（框圆角 - 边框宽），
// 挂在无边框容器上（如左侧 handlebar）时改传 node-frame。
export function FlashLayer({ layer, className = 'node-frame-inset' }: FlashLayerProps) {
  const kfName = nodeFlashKeyframeName(layer)
  return (
    <span
      key={kfName}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 border', className)}
      style={flashKeyframeStyle([layer])}
    >
      <style>{`@keyframes ${kfName}{0%{border-color:var(--border);box-shadow:0 0 0 transparent}50%{border-color:${layer.color};box-shadow:0 0 8px ${layer.color},inset 0 0 2px ${layer.color}}100%{border-color:var(--border);box-shadow:0 0 0 transparent}}`}</style>
    </span>
  )
}