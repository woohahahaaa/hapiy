import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { providerCardActive } from '@/components/node/effectiveness'
import { computeProviderAvailability, formatAutoDisableSummary } from '@/lib/provider-availability'
import type { ProviderDisableStatus } from '@/lib/dashboard-api'
import type { FlowLayerOverlay } from '@/modules/flow-hub'

export interface FlatProviderChild {
  readonly id: string
  /** 真实供应商记录 ID；'' 表示尚未绑定（或旧数据仅存了 name） */
  readonly providerId: string
  /** 由 providerId 解析出的显示名（旧数据无 providerId 时按 name 兜底） */
  readonly label: string
  readonly baseURLCount: number
  readonly keyCount: number
  readonly modelCount: number
  readonly endpointCount: number
  readonly enabled: boolean
  readonly providerStatus: boolean
  readonly autoDisabled: boolean
  /** 供应商维度的故障转移禁用状态（provider/base_url/key），用于展示逐维度禁用详情 */
  readonly disableStatus?: ProviderDisableStatus | null
}

/** 下拉选项：只含 ID 与显示名，选择与占位检测一律走 ID。 */
export interface ProviderOption {
  readonly id: string
  readonly name: string
}

export interface NodeExecutorProviderProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  index: number
  child: FlatProviderChild
  providers: readonly ProviderOption[]
  takenLabels: Set<string>
  flashLayers?: readonly FlowLayerOverlay[]
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onToggle: (enabled: boolean) => void
  onSelect: (providerId: string) => void
  onDelete: () => void
}

// 供应商业务节点：单张供应商卡片（按 ID 选择、逐维度禁用详情、base URL/Key/模型计数）。
// 所有插槽条目中唯一"个体级点亮"（flash 层按 child.id 独立查询）的业务。
export function NodeExecutorProvider({ index, child, providers, takenLabels, flashLayers, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onToggle, onSelect, onDelete, token, picked, onPickToken }: NodeExecutorProviderProps) {
  const { t } = useTranslation('node')
  // 下拉值 = 真实供应商 ID。旧数据缺失 providerId 时只读地按名称解析到同一 ID，
  // 不新增任何按名字写入的逻辑。
  const selectedId = child.providerId !== ''
    ? child.providerId
    : child.label !== ''
      ? providers.find((opt) => opt.name === child.label)?.id ?? ''
      : ''
  const filteredProviders = providers.filter((opt) => opt.id === selectedId || !takenLabels.has(opt.id))
  const availability = computeProviderAvailability({
    providerDisabled: child.disableStatus?.provider ?? child.autoDisabled,
    baseUrlsDisabled: child.disableStatus?.baseUrls ?? {},
    keysDisabled: child.disableStatus?.keys ?? {},
    baseURLCount: child.baseURLCount,
    keyCount: child.keyCount,
  })
  const autoDisableSummary = formatAutoDisableSummary({
    providerDisabled: child.disableStatus?.provider ?? child.autoDisabled,
    baseUrlsDisabled: child.disableStatus?.baseUrls ?? {},
    keysDisabled: child.disableStatus?.keys ?? {},
    baseURLCount: child.baseURLCount,
    keyCount: child.keyCount,
  })
  const bound = child.providerId !== '' || child.label !== ''
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
        (!providerCardActive(child) || !availability.overall) && 'opacity-60',
      )}
    >
      <div className="space-y-1.5">
        <Select value={selectedId} onValueChange={(value) => value && onSelect(value)}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder={t('provider.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {filteredProviders.map((opt) => (
              <SelectItem key={opt.id} value={opt.id} disabled={opt.id !== selectedId && takenLabels.has(opt.id)}>
                {opt.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {bound && (
          <div className="space-y-1 pl-2.5 text-xs">
            <div className="space-y-1">
              <div>{t('provider.modelKeyCounts', { modelCount: child.modelCount, keyCount: child.keyCount })}</div>
              <div>{t('provider.baseUrlEndpointCounts', { baseURLCount: child.baseURLCount, endpointCount: child.endpointCount })}</div>
            </div>
            {state === 'disabled' && (
              <p className="font-medium text-destructive">{t('provider.disabled')}</p>
            )}
            {autoDisableSummary && <p className="font-medium text-warning">{autoDisableSummary}</p>}
          </div>
        )}
      </div>
    </SlotItemCard>
  )
}
