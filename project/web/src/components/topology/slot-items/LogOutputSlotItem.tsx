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
          value={entry.prefix}
          onChange={(e) => onChange({ ...entry, prefix: e.target.value })}
          placeholder="请输入日志前缀"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">记录内容</span>
        <div className="grid grid-cols-2 gap-x-1 gap-y-1">
          <CheckField
            label="记录原始请求"
            checked={entry.recordRequest}
            onChange={(v) => onChange({ ...entry, recordRequest: v })}
          />
          <CheckField
            label="记录改写后请求"
            checked={entry.recordModifiedRequest}
            onChange={(v) => onChange({ ...entry, recordModifiedRequest: v })}
          />
          <CheckField
            label="记录原始响应"
            checked={entry.recordResponse}
            onChange={(v) => onChange({ ...entry, recordResponse: v })}
          />
          <CheckField
            label="记录改写后响应"
            checked={entry.recordModifiedResponse}
            onChange={(v) => onChange({ ...entry, recordModifiedResponse: v })}
          />
          <CheckField
            label="记录系统日志"
            checked={entry.recordSystem}
            onChange={(v) => onChange({ ...entry, recordSystem: v })}
          />
        </div>
      </div>
      <CheckField
        label="合并流式响应"
        checked={entry.mergeStream}
        onChange={(v) => onChange({ ...entry, mergeStream: v })}
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">自动关闭(分钟)</span>
        <Input
          type="number"
          min={1}
          max={60}
          size="sm"
          className="text-[10px]"
          value={entry.autoCloseMinutes}
          onChange={(e) => {
            const v = e.target.valueAsNumber
            onChange({ ...entry, autoCloseMinutes: Number.isNaN(v) ? entry.autoCloseMinutes : v })
          }}
          placeholder="输入1-60"
        />
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
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
    </div>
  )
}
