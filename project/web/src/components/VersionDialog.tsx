import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { version as appVersion } from '../../package.json'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/dialog'
import { useUpdateStatus } from '@/lib/update'

// fmtMB renders bytes as "12.3 MB" for the upgrade progress/speed line.
function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type Notice = { readonly text: string; readonly kind: 'ok' | 'error' }

// VersionDialog shows the running version and drives check/upgrade. The logic
// mirrors the upstream (OpenBoss) version panel: a check button becomes an
// "upgrade" action when a newer release exists, with a confirm step and a live
// progress line (percent / size / speed) while the download runs.
export function VersionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('common')
  const { status, refresh, check, apply } = useUpdateStatus(15_000)
  const [checkBusy, setCheckBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [speedBps, setSpeedBps] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeTimer = useRef<number | null>(null)

  const current = status?.current || appVersion

  const showNotice = (text: string, kind: 'ok' | 'error') => {
    setNotice({ text, kind })
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null)
      noticeTimer.current = null
    }, 8000)
  }

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    },
    [],
  )

  const handleCheck = async () => {
    if (checkBusy || upgrading || status?.checking) return
    setCheckBusy(true)
    const snap = await check()
    setCheckBusy(false)
    if (!snap) {
      showNotice(t('update.checkFailed'), 'error')
      return
    }
    if (snap.checking) return // a scheduled check is already running
    if (snap.available) return // the banner/upgrade button appears
    showNotice(t('update.upToDate', { version: snap.current }), 'ok')
  }

  const startUpgrade = async () => {
    const target = status?.latest
    if (!target || upgrading) return
    setUpgrading(true)
    setConfirmOpen(false)
    setNotice(null)
    setProgress(null)
    setSpeedBps(0)
    const res = await apply()
    if (!res.ok) {
      setUpgrading(false)
      showNotice(t('update.upgradeFailed', { message: res.message }), 'error')
      return
    }
    // The backend exits and the manager restarts it, so the API is briefly
    // unreachable — that is normal. Poll once a second for progress until the
    // reported version changes, then reload; capped at 30 minutes (the
    // download itself is only cut when it stalls, see the backend watchdog).
    let lastDone = 0
    let lastAt = Date.now()
    for (let i = 0; i < 1800; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
      const snap = await refresh()
      const now = Date.now()
      if (snap?.upgrading && (snap.downloadDone ?? 0) > 0) {
        const done = snap.downloadDone
        if (done < lastDone) {
          // A fresh download (retry) restarts the speed baseline.
          lastDone = 0
          lastAt = now
        }
        const dt = (now - lastAt) / 1000
        if (dt >= 0.5 && done >= lastDone) {
          setSpeedBps((done - lastDone) / dt)
          lastDone = done
          lastAt = now
        }
        setProgress({ done, total: snap.downloadTotal ?? 0 })
      }
      if (snap?.current === target) {
        window.location.reload()
        return
      }
      if (snap && !snap.upgrading && snap.upgradeError) {
        setUpgrading(false)
        showNotice(t('update.upgradeFailed', { message: snap.upgradeError }), 'error')
        return
      }
      if (snap && !snap.upgrading && !snap.upgradeError && i > 15) {
        setUpgrading(false)
        showNotice(t('update.notExecuted'), 'error')
        return
      }
    }
    setUpgrading(false)
    showNotice(t('update.timeout'), 'error')
  }

  const progressText = (() => {
    if (!upgrading) return ''
    const target = status?.latest ?? ''
    if (!progress || progress.done <= 0) return t('update.prepare', { version: target })
    const pct =
      progress.total > 0
        ? ` · ${Math.min(100, Math.floor((progress.done / progress.total) * 100))}%`
        : ''
    const size =
      progress.total > 0
        ? `（${fmtMB(progress.done)}/${fmtMB(progress.total)}）`
        : `（${fmtMB(progress.done)}）`
    const speed = speedBps > 0 ? ` · ${fmtMB(speedBps)}/s` : ''
    return `${t('update.downloading', { version: target })}${pct}${size}${speed}`
  })()

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent width="xs">
          <DialogHeader>
            <DialogTitle>{t('update.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-1">
            <div className="flex items-baseline justify-between">
              <span className="font-hapiy-logo text-3xl leading-none text-foreground">hapiy</span>
              <span className="text-sm text-muted-foreground">{`v${current}`}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={checkBusy || upgrading || Boolean(status?.checking)}
                onClick={() => void handleCheck()}
              >
                {checkBusy || status?.checking ? t('update.checking') : t('update.check')}
              </Button>
              {status?.available && !upgrading && (
                <>
                  <span className="text-xs text-amber-600">
                    {t('update.latest', { version: status.latest })}
                  </span>
                  <Button size="sm" onClick={() => setConfirmOpen(true)}>
                    {t('update.upgrade')}
                  </Button>
                </>
              )}
            </div>
            {upgrading && <p className="text-xs text-muted-foreground">{progressText}</p>}
            {notice && (
              <p className={notice.kind === 'error' ? 'text-xs text-destructive' : 'text-xs text-emerald-600'}>
                {notice.text}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent width="xs">
          <DialogHeader>
            <DialogTitle>{t('update.upgradeTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t('update.upgradeConfirm', { from: current, to: status?.latest ?? '' })}
          </p>
          <DialogFooter showCloseButton={false}>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button size="sm" onClick={() => void startUpgrade()}>
              {t('update.upgradeNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
