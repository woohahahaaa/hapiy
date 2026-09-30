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

interface FlashLayerProps {
  layer: FlowLayerOverlay
  className?: string
}

// 节点类动画的统一播放层：发光边框 span + 一次性 keyframe。
// 各节点组件在自身体内调用（内化），实现与命名只有这一份。
export function FlashLayer({ layer, className = 'rounded-sm' }: FlashLayerProps) {
  const kfName = nodeFlashKeyframeName(layer)
  return (
    <span
      key={kfName}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 border', className)}
      style={{
        animationName: kfName,
        animationDuration: `${FLOW_STEP_MS}ms`,
        animationIterationCount: '1',
        animationFillMode: 'both',
        animationTimingFunction: 'linear',
      }}
    >
      <style>{`@keyframes ${kfName}{0%{border-color:var(--border);box-shadow:0 0 0 transparent}50%{border-color:${layer.color};box-shadow:0 0 8px ${layer.color},inset 0 0 2px ${layer.color}}100%{border-color:var(--border);box-shadow:0 0 0 transparent}}`}</style>
    </span>
  )
}