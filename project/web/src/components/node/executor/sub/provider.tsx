import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { cn } from '@/lib/utils'
import type { FlowLayerOverlay } from '@/modules/flow-hub'

export interface FlatProviderChild {
  readonly id: string
  readonly label: string
  readonly baseURLCount: number
  readonly keyCount: number
  readonly modelCount: number
  readonly enabled: boolean
  readonly providerStatus: boolean
  readonly autoDisabled: boolean
}

export interface NodeExecutorProviderProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  index: number
  child: FlatProviderChild
  providers: readonly string[]
  takenLabels: Set<string>
  flashLayers?: readonly FlowLayerOverlay[]
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onToggle: (enabled: boolean) => void
  onSelect: (name: string) => void
  onDelete: () => void
}

// 供应商业务节点：单张供应商卡片（选择、禁用/自动禁用徽标、URL/Key/模型计数）。
// 所有插槽条目中唯一"个体级点亮"（flash 层按 child.id 独立查询）的业务。
export function NodeExecutorProvider({ index, child, providers, takenLabels, flashLayers, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onToggle, onSelect, onDelete, token, picked, onPickToken }: NodeExecutorProviderProps) {
  const filteredProviders = providers.filter((n) => n === child.label || !takenLabels.has(n))
  const state = child.autoDisabled ? 'auto-disabled' : child.providerStatus ? 'enabled' : 'disabled'
  return (
    <SlotItemCard
      index={index}
      enabled={child.enabled}
      onToggleEnabled={onToggle}
      onDelete={onDelete}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      isDragging={isDragging}
      isDragOver={isDragOver}
      flashLayers={flashLayers}
      token={token}
      picked={picked}
      onPickToken={onPickToken}
      className={cn(
        state === 'disabled' && 'opacity-60',
        state === 'auto-disabled' && 'opacity-60',
      )}
    >
      <div className="space-y-1.5">
        <Select value={child.label ?? ''} onValueChange={(value) => value && onSelect(value)}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="选择供应商" />
          </SelectTrigger>
          <SelectContent>
            {filteredProviders.map((name) => (
              <SelectItem key={name} value={name} disabled={name !== child.label && takenLabels.has(name)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {child.label && (
          state !== 'enabled' ? (
            <span
              className={cn(
                'pl-2.5 text-xs font-medium',
                state === 'disabled' ? 'text-destructive' : 'text-warning',
              )}
            >
              {state === 'disabled' ? '禁用' : '自动禁用'}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span>{child.baseURLCount} URL{child.baseURLCount !== 1 ? 's' : ''}</span>
              <span>{child.keyCount} Key{child.keyCount !== 1 ? 's' : ''}</span>
              <span>{child.modelCount} 模型</span>
            </div>
          )
        )}
      </div>
    </SlotItemCard>
  )
}