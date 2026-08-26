import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import type { LogOutputSlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import { createDebouncedCommit, shouldNotifyOnDisable, type DebouncedCommit } from './debounce'

export const PREFIX_DEBOUNCE_MS = 400

export interface NodeExecutorLogOutputItemProps extends SlotItemDragProps {
  entry: LogOutputSlotEntry
  onChange: (next: LogOutputSlotEntry) => void
  onDelete: () => void
  onAutoClose?: () => void
}

// 日志抓取业务条目：日志前缀 + 记录请求/响应开关。
export function NodeExecutorLogOutputItem({
  entry,
  onChange,
  onDelete,
  onAutoClose,
  ...drag
}: NodeExecutorLogOutputItemProps) {
  const [localPrefix, setLocalPrefix] = useState(entry.prefix)

  const onChangeRef = useRef(onChange)
  const entryRef = useRef(entry)
  useEffect(() => {
    onChangeRef.current = onChange
    entryRef.current = entry
  })

  // Debounced commit: fires 400ms after typing stops, on blur, or on unmount —
  // so a typed-but-unblurred prefix is never lost (e.g. node deleted mid-edit).
  const prefixDebouncerRef = useRef<DebouncedCommit<string> | null>(null)
  useEffect(() => {
    prefixDebouncerRef.current = createDebouncedCommit<string>(PREFIX_DEBOUNCE_MS, (prefix) => {
      const current = entryRef.current
      if (prefix === current.prefix) return
      onChangeRef.current({ ...current, prefix })
    })
    return () => {
      prefixDebouncerRef.current?.dispose()
      prefixDebouncerRef.current = null
    }
  }, [])

  // 条目被停用时通知父级（关闭抓取中的倒计时等状态）。
  // 只在 enabled true→false 过渡时触发一次，挂载时（即使初始为 false）不触发。
  const prevEnabledRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (shouldNotifyOnDisable(prevEnabledRef.current, entry.enabled)) {
      onAutoClose?.()
    }
    prevEnabledRef.current = entry.enabled
  }, [entry.enabled, onAutoClose])

  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
      {...drag}
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px]">日志前缀</span>
          <Input
            size="sm"
            className="text-[10px]"
            value={localPrefix}
            onChange={(e) => {
              setLocalPrefix(e.target.value)
              prefixDebouncerRef.current?.schedule(e.target.value)
            }}
            onBlur={() => prefixDebouncerRef.current?.flush()}
            placeholder="请输入日志前缀"
          />
        </div>
        <div className="flex flex-col gap-1">
          <CheckField
            label="记录请求"
            checked={entry.recordRequest}
            onChange={(v) => onChange({ ...entry, recordRequest: v })}
          />
          <CheckField
            label="记录响应"
            checked={entry.recordResponse}
            onChange={(v) => onChange({ ...entry, recordResponse: v })}
          />
        </div>
      </div>
    </SlotItemCard>
  )
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <span className="text-xs">{label}</span>
    </label>
  )
}