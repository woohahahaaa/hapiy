import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface NodeExecutorLogOutputProps {
  title: string
  enabled: boolean
  deadlineAt: number | null
  onToggle?: (enabled: boolean) => void
  onSetDeadline?: (deadlineAt: number | null) => void
  onStartCapture?: (deadlineAt: number) => void
  onAutoClose?: () => void
}

// 日志抓取业务节点：插槽标题栏（开启/关闭 + 时长设置对话框 + 倒计时）。
export function NodeExecutorLogOutput({
  title,
  enabled,
  deadlineAt,
  onToggle,
  onStartCapture,
  onAutoClose,
}: NodeExecutorLogOutputProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [hours, setHours] = useState('0')
  const [minutes, setMinutes] = useState('5')
  const [seconds, setSeconds] = useState('0')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (deadlineAt === null || !enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [deadlineAt, enabled])

  const capturing = enabled && deadlineAt !== null && deadlineAt > now

  useEffect(() => {
    if (!enabled || deadlineAt === null) return
    if (now < deadlineAt) return
    onToggle?.(false)
    onAutoClose?.()
  }, [deadlineAt, enabled, now, onToggle, onAutoClose])

  const totalSeconds =
    (Number.isNaN(Number(hours)) ? 0 : Number(hours)) * 3600 +
    (Number.isNaN(Number(minutes)) ? 0 : Number(minutes)) * 60 +
    (Number.isNaN(Number(seconds)) ? 0 : Number(seconds))

  const handleConfirm = () => {
    if (totalSeconds <= 0) return
    setDialogOpen(false)
    onStartCapture?.(Date.now() + totalSeconds * 1000)
  }

  const remaining = capturing && deadlineAt !== null ? Math.max(0, deadlineAt - now) : 0
  const remainingHours = Math.floor(remaining / 3600000)
  const remainingMinutes = Math.floor((remaining % 3600000) / 60000)
  const remainingSeconds = Math.floor((remaining % 60000) / 1000)

  const buttonClass =
    'nodrag nopan inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] transition-colors hover:bg-muted/50 hover:text-foreground'

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span>{title}</span>
        <div className="flex items-center gap-2">
          {capturing && (
            <span className="whitespace-nowrap text-[10px]">
              剩余 {remainingHours}小时{remainingMinutes}分{remainingSeconds}秒
            </span>
          )}
          <button
            type="button"
            className={buttonClass}
            onClick={(e) => {
              e.stopPropagation()
              if (capturing) {
                onToggle?.(false)
              } else {
                setDialogOpen(true)
              }
            }}
          >
            {capturing ? '关闭' : '开启'}
          </button>
        </div>
      </div>
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
      <span className="text-[10px]">{label}</span>
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