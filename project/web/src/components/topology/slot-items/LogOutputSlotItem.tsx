import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { SlotItemCard } from './SlotItemCard'
import type { LogOutputSlotEntry, SlotItemDragProps } from './types'

interface LogOutputSlotItemProps extends SlotItemDragProps {
  entry: LogOutputSlotEntry
  onChange: (next: LogOutputSlotEntry) => void
  onDelete: () => void
}

export function LogOutputSlotItem({
  entry,
  onChange,
  onDelete,
  ...drag
}: LogOutputSlotItemProps) {
  const [localPrefix, setLocalPrefix] = useState(entry.prefix)

  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
      {...drag}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">日志前缀</span>
        <Input
          size="sm"
          className="text-[10px]"
          value={localPrefix}
          onChange={(e) => setLocalPrefix(e.target.value)}
          onBlur={() => {
            if (localPrefix !== entry.prefix) {
              onChange({ ...entry, prefix: localPrefix })
            }
          }}
          placeholder="请输入日志前缀"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">记录内容</span>
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
          <CheckField
            label="记录系统"
            checked={entry.recordSystem}
            onChange={(v) => onChange({ ...entry, recordSystem: v })}
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
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </label>
  )
}
