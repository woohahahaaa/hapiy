import { useState } from 'react'
import { SlotContainer } from '@/components/node/slot/slot-container'
import { AppIcon } from '@/components/AppIcon'
import { topologyConfig } from '@/config/topology-config'
import { SlotEnableControl } from '@/components/node/slot/slot-enable-control'
import { RewriteTestDialog } from '@/components/RewriteTestDialog'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { SlotItemDragProps, ResponseModifySlotEntry } from '@/components/node/slot/items'
import type { ResponseRewriteRule } from '@/lib/dashboard-api'
import { NodeExecutorResponseModify } from '@/components/node/executor/sub/response-modify'

export interface NodeSlotResponseModifyProps {
  onSelectExecutor?: (token: string | null) => void
  selectedExecutorToken?: string | null
  title: string
  entries: readonly ResponseModifySlotEntry[]
  rules: readonly ResponseRewriteRule[]
  flashLayers?: readonly FlowLayerOverlay[]
  dragProps: (entryIndex: number) => SlotItemDragProps
  onChangeEntry: (next: ResponseModifySlotEntry) => void
  onDeleteEntry: (index: number) => void
  onAddEntry: () => void
  externallyDisabled?: boolean
  enabled: boolean
  onToggleEnabled?: (enabled: boolean) => void
}

// 响应改写插槽节点：测试按钮标题栏 + 响应改写业务条目列表。
export function NodeSlotResponseModify({
  title,
  entries,
  rules,
  flashLayers,
  dragProps,
  onChangeEntry,
  onDeleteEntry,
  onAddEntry,
  externallyDisabled,
  enabled,
  onToggleEnabled,
  onSelectExecutor,
  selectedExecutorToken,
}: NodeSlotResponseModifyProps) {
  const [testOpen, setTestOpen] = useState(false)
  const boundEntries = entries
    .filter((e): e is ResponseModifySlotEntry => 'ruleId' in e)
    .sort((a, b) => a.index - b.index)
  const testRules = boundEntries
    .map((e) => rules.find((r) => r.id === e.ruleId))
    .filter((r): r is { id: string; name: string; script: string; status: boolean } => r != null && r.status)
  const titleBadge = (
    <div className="flex items-center justify-between">
      <span>{title}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="nodrag nopan flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] transition-colors hover:bg-muted/50 hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); setTestOpen(true); }}
        >
          测试
        </button>
        <SlotEnableControl
          variant="switch"
          enabled={enabled}
          onToggle={onToggleEnabled ?? (() => {})}
        />
      </div>
    </div>
  )
  return (
    <>
      <SlotContainer
        title={titleBadge}
        onAddNode={onAddEntry}
        style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
        externallyDisabled={externallyDisabled}
      onExecutorPick={onSelectExecutor}
      >
        {[...entries].sort((left, right) => left.index - right.index).map((entry) => (
          <NodeExecutorResponseModify
            key={entry.id}
            token={entry.id}
            picked={selectedExecutorToken === entry.id}
            onPickToken={onSelectExecutor}
            entry={entry}
            rules={rules}
            onChange={onChangeEntry}
            onDelete={() => onDeleteEntry(entry.index)}
            flashLayers={flashLayers}
            {...dragProps(entry.index)}
          />
        ))}
      </SlotContainer>
      {testOpen && (
        <RewriteTestDialog
          open={testOpen}
          onClose={() => setTestOpen(false)}
          rules={testRules}
          type="rewrite-response"
          preselectedRuleId={null}
          readonlyRule={true}
          showSelector={false}
        />
      )}
    </>
  )
}