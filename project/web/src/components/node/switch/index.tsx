import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'
import { FlashLayer, nodeFlashKeyframeName } from '@/components/node/flash-layer'
import { HandlesRail } from '@/components/node/handles-rail'
import { SwitchConfigDialog } from '@/components/node/switch/config-dialog'
import { COND_OPS } from '@/components/rewrite-rule-editor/modes'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { SwitchNodeConfig } from '@/lib/dashboard-api'

export interface SwitchNodeData {
  title: string
  /** 规则名称：节点标题优先显示它；留空回退 title（条件开关）。 */
  name?: string
  /** 连进本节点的线数（驱动左侧 handlebar 段数）；缺省 1 */
  connectionCount?: number
  externallyDisabled?: boolean
  config?: SwitchNodeConfig
  providers?: readonly { id: string; name: string }[]
  flashLayers?: readonly FlowLayerOverlay[]
  onSaveConfig?: (name: string, config: SwitchNodeConfig) => void
}

interface NodeSwitchProps {
  data: SwitchNodeData
  id: string
}

const opLabel = (op: string): string => COND_OPS.find((o) => o.value === op)?.label ?? op

// 条件开关节点：无自身启停开关 —— 在链路中即生效。
// 外壳对齐请求入口：状态点 + 规则名称 + 标题右侧「编辑」按钮。
// 正文表格竖向一分为二：左列显示命中的供应商与条件明细（baseURL 计数行样式），
// 右列单独划分出「是/否」两条输出（各带一条 pill handlebar）。
export function NodeSwitch({ data, id }: NodeSwitchProps) {
  const {
    title,
    name,
    connectionCount = 1,
    externallyDisabled = false,
    config,
    providers = [],
    flashLayers = [],
    onSaveConfig,
  } = data

  const updateNodeInternals = useUpdateNodeInternals()
  const cardRef = useRef<HTMLDivElement>(null)
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
  const selectedNames = providers
    .filter((p) => providerIds.includes(p.id))
    .map((p) => p.name)
  const providerSummary = selectedNames.length === 0 ? '全部供应商' : selectedNames.join(' · ')
  const conditionSummary =
    (config?.conditions ?? [])
      .map((c) => `${c.invert ? '非 ' : ''}${c.path} ${opLabel(c.op)} ${c.value}`.trim())
      .join(' · ')
  const displayTitle = name && name.trim() !== '' ? name : title || '条件开关'

  return (
    <>
      <HandlesRail height={nodeHeight} segmentCount={connectionCount} flashLayers={flashLayers} />
      <div
        ref={cardRef}
        className={cn(
          'relative w-fit rounded-lg border-2 border-border bg-card text-card-foreground',
          externallyDisabled && 'pointer-events-none',
        )}
        style={{ width: 'fit-content', minWidth: topologyConfig.render.node.minWidth }}
      >
        {flashLayers.map((layer) => (
          <FlashLayer key={nodeFlashKeyframeName(layer)} layer={layer} className="rounded-lg" />
        ))}

        {/* 头部：状态点（在链路中即生效，恒亮）+ 规则名称 + 「编辑」按钮 */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-[var(--node-accent,var(--color-primary))]"
            />
            <span className="truncate text-sm font-medium">{displayTitle}</span>
          </span>
          <button
            type="button"
            className="nodrag nopan flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              setConfigOpen(true)
            }}
          >
            编辑
          </button>
        </div>

        {/* 正文表格：竖向一分为二 —— 左列明细，右列「是/否」输出 */}
        <div className="flex items-stretch">
          {/* 左列：命中的供应商与条件明细（供应商卡片的 baseURL 行样式） */}
          <div className="min-w-0 flex-1 space-y-1 px-3 py-2 text-xs">
            <div>供应商 {providerSummary}</div>
            <div>条件 {conditionSummary === '' ? '无条件' : conditionSummary}</div>
          </div>

          {/* 右列：单独划分出的「是/否」输出（各带一条 pill handlebar） */}
          <div className="flex shrink-0 flex-col border-l border-border">
            <div className="relative flex flex-1 items-center justify-end gap-1.5 px-2 py-1.5">
              <span className="text-[10px]">是</span>
              <Handle
                type="source"
                position={Position.Right}
                id="yes"
                className="!rounded-[4px] !border-border !bg-card"
                style={{ width: 12, height: 20, borderWidth: 2 }}
              />
            </div>
            <div className="relative flex flex-1 items-center justify-end gap-1.5 border-t border-border px-2 py-1.5">
              <span className="text-[10px]">否</span>
              <Handle
                type="source"
                position={Position.Right}
                id="no"
                className="!rounded-[4px] !border-border !bg-card"
                style={{ width: 12, height: 20, borderWidth: 2 }}
              />
            </div>
          </div>
        </div>

        <SwitchConfigDialog
          open={configOpen}
          onOpenChange={setConfigOpen}
          name={name}
          config={config ?? { providers: [], conditions: [] }}
          providers={providers}
          onSave={(nextName, next) => onSaveConfig?.(nextName, next)}
        />
      </div>
    </>
  )
}