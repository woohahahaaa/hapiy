import { useState } from 'react'
import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { ConcurrencyConfigDialog } from './concurrency-config-dialog'
import type { ConcurrencySlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import { parseConcurrencyNodeConfig } from '@/lib/dashboard-api'

export interface NodeExecutorConcurrencyProps extends SlotItemDragProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  entry: ConcurrencySlotEntry
  providers: readonly { id: string; name: string }[]
  onChange: (next: ConcurrencySlotEntry) => void
  onDelete: () => void
}

// 并发控制业务节点：槽位内的一条并行控制条目（配置内联，不再绑定规则）。
// 显示规则摘要 + 「编辑」文字按钮（同条件开关），点击编辑打开配置弹窗。
export function NodeExecutorConcurrency({ entry, providers, onChange, onDelete, token, picked, onPickToken, ...drag }: NodeExecutorConcurrencyProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const config = parseConcurrencyNodeConfig(entry.config)

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id
  const providersLabel = config.providers.length === 0
    ? '全部供应商'
    : config.providers.map(providerName).join('、')

  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
      token={token}
      picked={picked}
      onPickToken={onPickToken}
      {...drag}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-xs">
          <div className="font-medium">
            每 {config.windowMinutes} 分钟内最多 {config.maxCount} 条
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {config.perProvider ? '按供应商分别计算' : '统一计算'} · {providersLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="nodrag nopan shrink-0 rounded-xs border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted/40"
        >
          编辑
        </button>
      </div>
      <ConcurrencyConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        config={config}
        providers={providers}
        onSave={(nextConfig) => onChange({ ...entry, config: nextConfig })}
      />
    </SlotItemCard>
  )
}