import { SlotContainer } from '@/components/topology/SlotContainer'
import { AppIcon } from '@/components/AppIcon'
import { topologyConfig } from '@/config/topology-config'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import { NodeExecutorProvider, type FlatProviderChild } from '@/components/node/executor/sub/provider'

export type ProviderStrategy = 'sequential' | 'random' | 'roundRobin'

export interface NodeSlotProviderProps {
  title: string
  children: readonly FlatProviderChild[]
  providers: readonly string[]
  takenLabels: Set<string>
  providerFlashLayers?: ReadonlyMap<string, readonly FlowLayerOverlay[]>
  strategy: ProviderStrategy
  onCycleStrategy?: () => void
  onAddProvider?: () => void
  onSelectProvider?: (providerId: string, name: string) => void
  onToggleProvider?: (providerId: string, enabled: boolean) => void
  onDeleteProvider?: (providerId: string) => void
  externallyDisabled?: boolean
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
  dragIndex,
  overIndex,
  onDragStart,
  onDragOver,
  onDrop,
}: NodeSlotProviderProps) {
  const strategyLabel = {
    sequential: '按顺序',
    random: '随机',
    roundRobin: '轮询',
  } as const
  const titleBadge = (
    <div className="flex items-center justify-between">
      <span>{title}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCycleStrategy?.() }}
        className="nodrag nopan flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        {strategyLabel[strategy]}
        <AppIcon name="refresh" size={10} />
      </button>
    </div>
  )
  return (
    <SlotContainer
      title={titleBadge}
      onAddNode={onAddProvider}
      style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
      externallyDisabled={externallyDisabled}
    >
      {children.map((child, i) => (
        <NodeExecutorProvider
          key={child.id}
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
          onSelect={(name) => onSelectProvider?.(child.id, name)}
          onDelete={() => onDeleteProvider?.(child.id)}
        />
      ))}
    </SlotContainer>
  )
}