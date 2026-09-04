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
  /**
   * 右半边填充的 Tailwind 背景类：要跟节点本体背景一致，否则 pill 会在
   * executor/entry（bg-card）上变成一个跟卡片底色对不上的色块，暴露出节点
   * 的边框/底色；slot 容器是 bg-background。缺省 bg-card。
   */
  fillBgClass?: string
}

/** 上下各 12px 的 padding（原 8px 的 3 倍） */
const railPadding = 24

export function HandlesRail({
  height,
  segmentCount,
  segmentIds,
  borderColor,
  flashLayers = [],
  fillBgClass = 'bg-card',
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
        <>
          {/* 右半边（压在节点本体上）保持实心 pill；左半边悬空在外只画描边，
              否则 bg 会盖住从左侧连进来的线最后一截。fill 放进一个带 overflow-hidden
              的 pill 形容器里，让直角左缘被圆角裁掉，与描边的弧线对齐。 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 overflow-hidden rounded-[inherit]"
            style={{ width: target.width, height: total }}
          >
            <div
              className={`absolute left-1/2 top-0 h-full ${fillBgClass}`}
              style={{ width: target.width / 2 }}
            />
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-[inherit] border-2 border-solid"
            style={{
              width: target.width,
              height: total,
              borderColor: borderColor ?? 'var(--color-border)',
            }}
          />
        </>
      )}
      {Array.from({ length: segmentCount }, (_, i) => (
        <Handle
          key={segmentIds && segmentIds[i] != null ? segmentIds[i] : `seg-${i}`}
          type="target"
          position={Position.Left}
          // 匿名段也要有稳定 id：React Flow 对无 targetHandle 的 edge 取
          // handleBounds[0]，多线入同一节点时会全部挤到第一个 handle 上。
          id={segmentIds && segmentIds[i] != null ? segmentIds[i]! : `seg-${i}`}
          style={{
            // rail 容器本身向左偏了 target.width/2，CSS 默认的 left:0 会让
            // handle 中心落在 rail 左缘（= 节点左缘外 target.width/2），线
            // 终点就比 pill 左缘再左 target.width/2，看起来"差几像素才到
            // bar"。left:50% + translate(-50%,0) 把 handle 中心拉回节点左
            // 缘，Position.Left 的接线点（handle 左缘）正好落在 pill 左边。
            left: '50%',
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