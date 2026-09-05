import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'
import { Switch } from '@/components/ui/switch'
import { FlashLayer, nodeFlashKeyframeName } from '@/components/node/flash-layer'
import { HandlesRail } from '@/components/node/handles-rail'
import { SwitchConfigDialog } from '@/components/node/switch/config-dialog'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { SwitchNodeConfig } from '@/lib/dashboard-api'

export interface SwitchNodeData {
  title: string
  /** 连进本节点的线数（驱动左侧 handlebar 段数）；缺省 1 */
  connectionCount?: number
  externallyDisabled?: boolean
  enabled?: boolean
  config?: SwitchNodeConfig
  providers?: readonly { id: string; name: string }[]
  flashLayers?: readonly FlowLayerOverlay[]
  onChangeEnabled?: (enabled: boolean) => void
  onSaveConfig?: (config: SwitchNodeConfig) => void
}

interface NodeSwitchProps {
  data: SwitchNodeData
  id: string
}

// 两条输出 pill（是/否）相对节点垂直中心的偏移：pill 高 20 + 间距 12，
// 各自中心在 ±(20+12)/2 = ±26px 处，与右侧标签保持同一几何。
const BRANCH_OFFSET_PX = 26

export function NodeSwitch({ data, id }: NodeSwitchProps) {
  const {
    title,
    connectionCount = 1,
    externallyDisabled = false,
    enabled = true,
    config,
    providers = [],
    flashLayers = [],
    onChangeEnabled,
    onSaveConfig,
  } = data

  const updateNodeInternals = useUpdateNodeInternals()
  const cardRef = useRef<HTMLDivElement>(null)
  const downPosRef = useRef<{ x: number; y: number } | null>(null)
  const lastHeightRef = useRef(0)
  const [nodeHeight, setNodeHeight] = useState(0)
  const [configOpen, setConfigOpen] = useState(false)

  // 节点高度测量：左侧 handlebar 跟随节点高度（与入口/插槽节点一致）。
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    let rafId: number | null = null
    const applySize = () => {
      rafId = null
      const height = el.offsetHeight
      if (Math.abs(height - lastHeightRef.current) <= 1) return
      lastHeightRef.current = height
      setNodeHeight(height)
      updateNodeInternals(id)
    }
    const ro = new ResizeObserver(() => {
      if (rafId === null) rafId = requestAnimationFrame(applySize)
    })
    ro.observe(el)
    applySize()
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [id, updateNodeInternals])

  const providerIds = config?.providers ?? []
  const selectedCount = providers.filter((p) => providerIds.includes(p.id)).length
  const conditionCount = config?.conditions.length ?? 0
  const providerSummary = selectedCount === 0 ? '全部供应商' : `已选 ${selectedCount} 个`

  // 拖拽（位移 > 3px）结束不弹配置弹窗；只有真正的点击才打开。
  const openConfigOnTap = (e: React.MouseEvent) => {
    const down = downPosRef.current
    downPosRef.current = null
    if (down && (Math.abs(e.clientX - down.x) > 3 || Math.abs(e.clientY - down.y) > 3)) return
    setConfigOpen(true)
  }

  return (
    <>
      <HandlesRail height={nodeHeight} segmentCount={connectionCount} flashLayers={flashLayers} />
      <div
        ref={cardRef}
        className={cn(
          'relative w-fit rounded-lg border-2 border-border bg-card text-card-foreground',
          !enabled && 'opacity-60',
          externallyDisabled && 'pointer-events-none',
        )}
        style={{ width: 'fit-content', minWidth: topologyConfig.render.node.minWidth }}
        onMouseDown={(e) => {
          downPosRef.current = { x: e.clientX, y: e.clientY }
        }}
        onClick={openConfigOnTap}
      >
        {flashLayers.map((layer) => (
          <FlashLayer key={nodeFlashKeyframeName(layer)} layer={layer} className="rounded-lg" />
        ))}

        {/* 头部：状态点 + 名称 + 启用开关（分隔线贯通整卡） */}
        <div className="flex items-center justify-between gap-2 border-b border-border py-2 pl-3 pr-12">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                enabled ? 'bg-[var(--color-primary)]' : 'bg-muted-foreground/50',
              )}
            />
            <span className="truncate text-sm font-medium">{title || '条件开关'}</span>
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={() => onChangeEnabled?.(!enabled)}
            aria-label={enabled ? `${title} 已启用，点击关闭` : `${title} 已停用，点击启用`}
            className="nodrag nopan"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* 节点体：条件摘要 */}
        <div className="flex flex-col gap-2 p-3 pr-12">
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>供应商</span>
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-card-foreground">
              {providerSummary}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>请求条件</span>
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-card-foreground">
              {conditionCount} 条
            </span>
          </div>
        </div>

        {/* 底部说明行（顶部细线贯通整卡） */}
        <div className="border-t border-border px-3 py-1.5 pr-12 text-[10px] text-muted-foreground">
          满足条件 → <span className="font-medium text-foreground">是</span>　·　否则 →{' '}
          <span className="font-medium text-foreground">否</span>
        </div>

        {/* 右侧输出端标签（与 pill 同几何） */}
        <span
          className="pointer-events-none absolute right-4 z-10 -translate-y-1/2 text-[10px] font-medium"
          style={{ top: `calc(50% - ${BRANCH_OFFSET_PX}px)` }}
        >
          是
        </span>
        <span
          className="pointer-events-none absolute right-4 z-10 -translate-y-1/2 text-[10px] font-medium"
          style={{ top: `calc(50% + ${BRANCH_OFFSET_PX}px)` }}
        >
          否
        </span>

        {/* 右侧两条输出 handlebar：是 / 否（ReactFlow source handles） */}
        <Handle
          type="source"
          position={Position.Right}
          id="yes"
          className="!rounded-[4px] !border-border !bg-card"
          style={{
            width: 12,
            height: 20,
            borderWidth: 2,
            top: `calc(50% - ${BRANCH_OFFSET_PX}px)`,
          }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="no"
          className="!rounded-[4px] !border-border !bg-card"
          style={{
            width: 12,
            height: 20,
            borderWidth: 2,
            top: `calc(50% + ${BRANCH_OFFSET_PX}px)`,
          }}
        />

        <SwitchConfigDialog
          open={configOpen}
          onOpenChange={setConfigOpen}
          config={config ?? { providers: [], conditions: [] }}
          providers={providers}
          onSave={(next) => onSaveConfig?.(next)}
        />
      </div>
    </>
  )
}