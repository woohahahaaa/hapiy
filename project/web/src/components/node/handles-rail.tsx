import { Handle, Position } from '@xyflow/react'
import { topologyConfig } from '@/config/topology-config'
import { FlashLayer, nodeFlashKeyframeName } from '@/components/node/flash-layer'
import type { FlowLayerOverlay } from '@/modules/flow-hub'

// 左侧 handlebar 的统一实现：请求入口（每个模型一段）与 slot（单段，
// 条跟随节点高度）共用同一份几何逻辑，闪效直接点亮整条 bar。

export interface HandlesRailProps {
  /** 节点自身测得的高度；0 = 未知 */
  height: number
  /** 段数 = 连进来的线数（入口 = 模型数，slot = incoming wire 数） */
  segmentCount: number
  /** 每段的 handle id（入口 = 模型 id；slot 省略则匿名） */
  segmentIds?: readonly (string | null)[]
  /** bar 颜色 = 所在节点自身的外边框颜色；不传则中性边框色 */
  borderColor?: string
  flashLayers?: readonly FlowLayerOverlay[]
}

/** 上下各 12px 的 padding（原 8px 的 3 倍） */
const railPadding = 24

export function HandlesRail({
  height,
  segmentCount,
  segmentIds,
  borderColor,
  flashLayers = [],
}: HandlesRailProps) {
  const target = topologyConfig.handles.provider.target
  const gap = topologyConfig.handles.provider.segmentGap
  const natural = segmentCount * target.height + Math.max(0, segmentCount - 1) * gap
  // 统一规则：随段数（连线）增长，上限 = 节点高度 - padding。
  const maxTotal = height > 0 ? height - railPadding : 0
  const scale = maxTotal > 0 && natural > maxTotal ? maxTotal / natural : 1
  const segH = target.height * scale
  const step = (target.height + gap) * scale
  const total = Math.max(natural * scale, segH)
  const centerOffset = segmentCount === 1 ? (total - segH) / 2 : 0

  return (
    <div
      className="absolute left-0 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ width: target.width, height: total, borderRadius: target.width / 3 }}
    >
      {segmentCount > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-[inherit] border-2 border-solid bg-background"
          style={{
            width: target.width,
            height: total,
            borderColor: borderColor ?? 'var(--color-border)',
          }}
        />
      )}
      {Array.from({ length: segmentCount }, (_, i) => (
        <Handle
          key={segmentIds && segmentIds[i] != null ? segmentIds[i] : `seg-${i}`}
          type="target"
          position={Position.Left}
          id={segmentIds && segmentIds[i] != null ? segmentIds[i]! : undefined}
          style={{
            top: centerOffset + i * step,
            width: target.width,
            height: segH,
            transform: 'translate(-50%, 0)',
            background: 'transparent',
            border: 'none',
            opacity: 0,
          }}
        />
      ))}
      {flashLayers.map((layer) => (
        <FlashLayer key={nodeFlashKeyframeName(layer)} layer={layer} className="rounded-[inherit]" />
      ))}
    </div>
  )
}