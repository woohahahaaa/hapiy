import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SlotItemCard } from './SlotItemCard'
import type { LogOutputSlotEntry, SlotItemDragProps } from './types'

interface LogOutputSlotItemProps extends SlotItemDragProps {
  entry: LogOutputSlotEntry
  onChange: (next: LogOutputSlotEntry) => void
  onDelete: () => void
  onAutoClose?: () => void
}

export function LogOutputSlotItem({
  entry,
  onChange,
  onDelete,
  onAutoClose,
  ...drag
}: LogOutputSlotItemProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [hours, setHours] = useState('0')
  const [minutes, setMinutes] = useState('5')
  const [seconds, setSeconds] = useState('0')
  const [now, setNow] = useState(() => Date.now())

  // 倒计时进行中时每秒刷新 now，驱动倒计时文本渲染
  useEffect(() => {
    if (entry.deadlineAt === null || !entry.enabled) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [entry.deadlineAt, entry.enabled])

  // 倒计时结束自动关闭
  useEffect(() => {
    if (entry.deadlineAt === null || !entry.enabled || now < entry.deadlineAt) return
    onChange({ ...entry, enabled: false, deadlineAt: null })
    onAutoClose?.()
  }, [entry.deadlineAt, entry.enabled, now, entry, onChange, onAutoClose])

  const totalSeconds =
    (Number.isNaN(Number(hours)) ? 0 : Number(hours)) * 3600 +
    (Number.isNaN(Number(minutes)) ? 0 : Number(minutes)) * 60 +
    (Number.isNaN(Number(seconds)) ? 0 : Number(seconds))

  const handleConfirm = () => {
    if (totalSeconds <= 0) return
    setDialogOpen(false)
    onChange({ ...entry, enabled: true, deadlineAt: Date.now() + totalSeconds * 1000 })
  }

  const remaining = entry.deadlineAt !== null && entry.enabled ? Math.max(0, entry.deadlineAt - now) : 0
  const remainingHours = Math.floor(remaining / 3600000)
  const remainingMinutes = Math.floor((remaining % 3600000) / 60000)
  const remainingSeconds = Math.floor((remaining % 60000) / 1000)

  const hasDeadline = entry.deadlineAt !== null && entry.enabled

  const toggleButtonClass =
    'nodrag nopan inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground'

  const enableControl = !entry.enabled ? (
    <button
      type="button"
      className={toggleButtonClass}
      onClick={(e) => {
        e.stopPropagation()
        setDialogOpen(true)
      }}
    >
      开始
    </button>
  ) : (
    <div className="nodrag nopan flex items-center gap-1">
      {hasDeadline && (
        <span className="whitespace-nowrap text-[10px] text-muted-foreground">
          {remainingHours}小时{remainingMinutes}分{remainingSeconds}秒
        </span>
      )}
      <button
        type="button"
        className={toggleButtonClass}
        onClick={(e) => {
          e.stopPropagation()
          onChange({ ...entry, enabled: false, deadlineAt: null })
        }}
      >
        关闭
      </button>
    </div>
  )

  return (
    <>
      <SlotItemCard
        index={entry.index}
        enabled={entry.enabled}
        onToggleEnabled={() => {}}
        enableControl={enableControl}
        dimContentWhenDisabled
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
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent width="sm">
          <DialogHeader>
            <DialogTitle>设置开启时长</DialogTitle>
          </DialogHeader>
          <div className="flex items-end justify-center gap-2">
            <TimeField label="时" value={hours} onChange={setHours} />
            <TimeField label="分" value={minutes} onChange={setMinutes} />
            <TimeField label="秒" value={seconds} onChange={setSeconds} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={totalSeconds <= 0} onClick={handleConfirm}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={0}
        max={999}
        step={1}
        className="w-16 text-center"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
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
