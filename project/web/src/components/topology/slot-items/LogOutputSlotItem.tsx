import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { SlotItemCard } from './SlotItemCard'
import type { LogLevel, LogOutputSlotEntry, LogTarget } from './types'

const LOG_TARGET_OPTIONS: { value: LogTarget; label: string }[] = [
  { value: 'file', label: '文件' },
  { value: 'console', label: '控制台' },
  { value: 'both', label: '两者' },
]

const LOG_LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
]

interface LogOutputSlotItemProps {
  entry: LogOutputSlotEntry
  onChange: (next: LogOutputSlotEntry) => void
  onDelete: () => void
  hasRequestRewrite: boolean
  hasResponseRewrite: boolean
}

export function LogOutputSlotItem({
  entry,
  onChange,
  onDelete,
  hasRequestRewrite,
  hasResponseRewrite,
}: LogOutputSlotItemProps) {
  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">输出目标</span>
          <Select
            value={entry.logTarget}
            onValueChange={(v) => onChange({ ...entry, logTarget: v as LogTarget })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_TARGET_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">日志级别</span>
          <Select
            value={entry.logLevel}
            onValueChange={(v) => onChange({ ...entry, logLevel: v as LogLevel })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">存储路径</span>
        <Input
          className="h-7 font-mono text-[10px]"
          value={entry.logPath}
          onChange={(e) => onChange({ ...entry, logPath: e.target.value })}
          placeholder="/var/log/hapiy/"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">记录内容</span>
        <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 text-[10px]">
          <RecordRow
            label="请求修改前"
            checked={entry.recordRequestBefore}
            onChange={(v) => onChange({ ...entry, recordRequestBefore: v })}
          />
          <RecordRow
            label="请求修改后"
            checked={entry.recordRequestAfter}
            disabled={!hasRequestRewrite}
            disabledHint="当前未添加请求改写节点"
            onChange={(v) => onChange({ ...entry, recordRequestAfter: v })}
          />
          <RecordRow
            label="响应修改前"
            checked={entry.recordResponseBefore}
            onChange={(v) => onChange({ ...entry, recordResponseBefore: v })}
          />
          <RecordRow
            label="响应修改后"
            checked={entry.recordResponseAfter}
            disabled={!hasResponseRewrite}
            disabledHint="当前未添加响应改写节点"
            onChange={(v) => onChange({ ...entry, recordResponseAfter: v })}
          />
        </div>
      </div>
    </SlotItemCard>
  )
}

function RecordRow({
  label,
  checked,
  disabled,
  disabledHint,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  disabledHint?: string
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className={`flex items-center gap-1 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      title={disabled ? disabledHint : undefined}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="size-3.5"
      />
      <span className="leading-none text-foreground">{label}</span>
    </label>
  )
}