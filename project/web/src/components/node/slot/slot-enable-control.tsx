import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'

export interface SlotEnableControlProps {
  enabled: boolean
  deadlineAt?: number | null
  variant?: 'switch' | 'countdown'
  onToggle: (enabled: boolean) => void
  onSetDeadline?: (deadlineAt: number | null) => void
  onStartCapture?: (deadlineAt: number) => void
  onAutoClose?: () => void
}

// 插槽右上角的通用启用控制：switch 模式为常开/常关，countdown 模式开启后
// 倒计时自动关闭（原日志抓取行为，现为所有插槽的通用能力）。
export function SlotEnableControl({
  enabled,
  deadlineAt,
  variant = 'switch',
  onToggle,
  onSetDeadline,
  onStartCapture,
  onAutoClose,
}: SlotEnableControlProps) {
  const { t } = useTranslation('node')
  if (variant === 'switch') {
    return (
      <Switch
        checked={enabled}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={enabled ? t('common:action.disable') : t('common:action.enable')}
        className="nodrag nopan shrink-0"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      />
    )
  }

  return (
    <CountdownControl
      enabled={enabled}
      deadlineAt={deadlineAt ?? null}
      onToggle={onToggle}
      onSetDeadline={(d) => onSetDeadline?.(d)}
      onStartCapture={onStartCapture}
      onAutoClose={onAutoClose}
    />
  )
}

function CountdownControl({
  enabled,
  deadlineAt,
  onToggle,
  onStartCapture,
  onAutoClose,
}: {
  enabled: boolean
  deadlineAt: number | null
  onToggle: (enabled: boolean) => void
  onSetDeadline: (deadlineAt: number | null) => void
  onStartCapture?: (deadlineAt: number) => void
  onAutoClose?: () => void
}) {
  const { t } = useTranslation('node')
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
    onToggle(false)
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

  const handleToggle = (next: boolean) => {
    if (next) {
      setDialogOpen(true)
    } else {
      onToggle(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {capturing && (
          <span className="whitespace-nowrap text-[10px]">
            {t('slotEnableControl.remaining', { hours: remainingHours, minutes: remainingMinutes, seconds: remainingSeconds })}
          </span>
        )}
        <Switch
          checked={capturing}
          onCheckedChange={handleToggle}
          aria-label={capturing ? t('slotEnableControl.close') : t('slotEnableControl.open')}
          className="nodrag nopan shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        />
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('slotEnableControl.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button size="sm" disabled={totalSeconds <= 0} onClick={handleConfirm}>
                {t('common:action.confirm')}
              </Button>
            </>
          }>
            <div className="flex items-end justify-center gap-2">
              <TimeField label={t('slotEnableControl.hours')} value={hours} onChange={setHours} />
              <TimeField label={t('slotEnableControl.minutes')} value={minutes} onChange={setMinutes} />
              <TimeField label={t('slotEnableControl.seconds')} value={seconds} onChange={setSeconds} />
            </div>
          </DialogScrollBody>
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