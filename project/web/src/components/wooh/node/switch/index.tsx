import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'
import { FlashLayer, flashKeyframeStyle, nodeFlashKeyframeName } from '@/components/wooh/node/flash-layer'
import { HandlesRail } from '@/components/wooh/node/handles-rail'
import { SwitchConfigDialog } from '@/components/wooh/node/switch/config-dialog'
import { COND_OPS } from '@/components/wooh/rewrite-rule-editor/modes'
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
  providers?: readonly { id: string; name: string; models?: readonly string[] }[]
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
// 正文表格竖向一分为二：左列显示生效供应商与条件明细（baseURL 计数行样式），
// 右列单独划分出「是/否」两条输出（各带一条 pill handlebar）。
export function NodeSwitch({ data, id }: NodeSwitchProps) {
  const { t } = useTranslation('node')
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

  const mode = config?.mode ?? 'provider'

  const pillStyle = (): CSSProperties => {
    return {
      width: 12,
      height: 20,
      borderWidth: 2,
      // 默认 right:0 以所在行 div 的 padding 边为基准（= 卡片内容右缘，
      // 比 2px 边框的外缘靠左 2px），不动会比左侧 handlebar 的 pill 偏
      // 左 2px；right:-2 把 pill 中心线挪到节点右边框竖线上。
      right: -2,
      // 描边色与圆角交给 index.css 的统一规则（--node-lit / --node-radius）：
      // 选中、应急、动态点亮三种状态在这里不再各写一份，只补动画。
      ...flashKeyframeStyle(flashLayers),
    }
  }

  const providerIds = config?.providers ?? []
  const selectedNames = mode === 'model'
    ? (config?.models ?? [])
    : providers.filter((p) => providerIds.includes(p.id)).map((p) => p.name)
  const filterLabel = mode === 'model' ? t('switch.filterModel') : t('switch.filterProvider')
  const conditionSummary =
    (config?.conditions ?? [])
      .map((c) => ('path' in c ? `${c.invert ? t('switch.invertPrefix') : ''}${c.path} ${opLabel(c.op)} ${c.value}`.trim() : `(${c.logic})`))
      .join(' · ')
  const displayTitle = name && name.trim() !== '' ? name : title || t('switch.ruleNamePlaceholder')

  return (
    <>
      <HandlesRail height={nodeHeight} segmentCount={connectionCount} flashLayers={flashLayers} />
      <div
        ref={cardRef}
        className={cn(
          'node-frame relative w-fit border-2 bg-card text-card-foreground border-[var(--node-accent,var(--color-border))]',
          externallyDisabled && 'pointer-events-none',
        )}
        style={{ width: 'fit-content', minWidth: topologyConfig.render.node.minWidth }}
      >
        {flashLayers.map((layer) => (
          <FlashLayer key={nodeFlashKeyframeName(layer)} layer={layer} />
        ))}

        {/* 头部：规则名称 + 「编辑」按钮（无启停开关，在链路中即生效） */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="min-w-0 truncate text-sm font-medium">{displayTitle}</span>
          <button
            type="button"
            className="nodrag nopan flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[13px] transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              setConfigOpen(true)
            }}
          >
            {t('common:action.edit')}
          </button>
        </div>

        {/* 正文表格：竖向一分为二 —— 左列明细，右列「是/否」输出 */}
        <div className="flex items-stretch">
          {/* 左列：生效供应商/模型与条件明细（供应商卡片的 baseURL 行样式） */}
<div className="min-w-0 flex-1 space-y-1 px-3 py-2 text-xs">
            <div>{filterLabel} {selectedNames.length === 0 ? (mode === 'model' ? t('switch.allModels') : t('switch.allProviders')) : selectedNames.join(' · ')}</div>
            <div>{t('switch.conditions')} {(config?.conditions ?? []).length === 0 ? t('switch.notSet') : conditionSummary}</div>
          </div>

          {/* 右列：单独划分出的「是/否」输出（各带一条 pill handlebar） */}
          <div className="flex shrink-0 flex-col border-l border-border">
            <div className="relative flex flex-1 items-center justify-end gap-1.5 px-2 py-1.5">
              <span className="text-[10px]">{t('switch.yes')}</span>
              <Handle
                type="source"
                position={Position.Right}
                id="yes"
                style={pillStyle()}
              />
            </div>
            <div className="relative flex flex-1 items-center justify-end gap-1.5 border-t border-border px-2 py-1.5">
              <span className="text-[10px]">{t('switch.no')}</span>
              <Handle
                type="source"
                position={Position.Right}
                id="no"
                style={pillStyle()}
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