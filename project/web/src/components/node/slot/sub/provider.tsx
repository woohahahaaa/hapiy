import { useTranslation } from 'react-i18next'
import { SlotContainer } from '@/components/node/slot/slot-container'
import { slotNodeActive } from '@/components/node/effectiveness'
import { AppIcon } from '@/components/AppIcon'
import { topologyConfig } from '@/config/topology-config'
import { SlotEnableControl } from '@/components/node/slot/slot-enable-control'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import { NodeExecutorProvider, type FlatProviderChild, type ProviderOption } from '@/components/node/executor/sub/provider'

export type ProviderStrategy = 'sequential' | 'random' | 'roundRobin'

export interface NodeSlotProviderProps {
  title: string
  children: readonly FlatProviderChild[]
  providers: readonly ProviderOption[]
  takenLabels: Set<string>
  providerFlashLayers?: ReadonlyMap<string, readonly FlowLayerOverlay[]>
  strategy: ProviderStrategy
  onCycleStrategy?: () => void
  onAddProvider?: () => void
  onSelectProvider?: (nodeId: string, providerId: string) => void
  onToggleProvider?: (providerId: string, enabled: boolean) => void
  onDeleteProvider?: (providerId: string) => void
  externallyDisabled?: boolean
  enabled: boolean
  onToggleEnabled?: (enabled: boolean) => void
  onSelectExecutor?: (token: string | null) => void
  selectedExecutorToken?: string | null
  dragIndex: number | null
  overIndex: number | null
  onDragStart: (i: number) => void
  onDragOver: (i: number) => void
  onDrop: (i: number) => void
}

// 供应商插槽节点：策略标题栏 + 供应商业务卡片列表。
export function NodeSlotProvider({
  title,
  children,
  providers,
  takenLabels,
  providerFlashLayers,
  strategy,
  onCycleStrategy,
  onAddProvider,
  onSelectProvider,
  onToggleProvider,
  onDeleteProvider,
  externallyDisabled,
  enabled,
  onToggleEnabled,
  onSelectExecutor,
  selectedExecutorToken,
  dragIndex,
  overIndex,
  onDragStart,
  onDragOver,
  onDrop,
}: NodeSlotProviderProps) {
  const { t } = useTranslation('node')
  const strategyLabel = {
    sequential: t('slotProvider.strategySequential'),
    random: t('slotProvider.strategyRandom'),
    roundRobin: t('slotProvider.strategyRoundRobin'),
  } as const
  const titleBadge = (
    <div className="flex items-center justify-between">
      <span>{title}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCycleStrategy?.() }}
          className="nodrag nopan flex items-center gap-1 rounded-sm border border-border-subtle px-2 py-0.5 text-[10px] transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {strategyLabel[strategy]}
          <AppIcon name="refresh" size={10} />
        </button>
        <SlotEnableControl
          variant="switch"
          enabled={enabled}
          onToggle={onToggleEnabled ?? (() => {})}
        />
      </div>
    </div>
  )
    const active = slotNodeActive(enabled, undefined, externallyDisabled ?? false)
  return (
    <SlotContainer
      title={titleBadge}
      onAddNode={onAddProvider}
      style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
      externallyDisabled={externallyDisabled}
      active={active}
      onExecutorPick={onSelectExecutor}
    >
      {children.map((child, i) => (
        <NodeExecutorProvider
          key={child.id}
          token={child.id}
          picked={selectedExecutorToken === child.id}
          onPickToken={onSelectExecutor}
          index={i + 1}
          child={child}
          providers={providers}
          takenLabels={takenLabels}
          flashLayers={providerFlashLayers?.get(child.id)}
          isDragging={dragIndex === i}
          isDragOver={overIndex === i && dragIndex !== null && dragIndex !== i}
          onDragStart={() => onDragStart(i)}
          onDragOver={() => onDragOver(i)}
          onDrop={() => onDrop(i)}
          onToggle={(enabled) => onToggleProvider?.(child.id, enabled)}
          onSelect={(providerId) => onSelectProvider?.(child.id, providerId)}
          onDelete={() => onDeleteProvider?.(child.id)}
        />
      ))}
    </SlotContainer>
  )
}