import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { version as appVersion } from '../../../package.json'

import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/wooh/dialog'
import { useUpdateStatus } from '@/lib/update'

// fmtMB renders bytes as "12.3 MB" for the upgrade progress/speed line.
function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// UpgradePhase is what the progress line tells the user: a download with a
// percentage, the silent verify/swap step after it, or the backend restart that
// briefly takes the API away.
type UpgradePhase = 'downloading' | 'installing' | 'restarting'

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
  const [phase, setPhase] = useState<UpgradePhase>('downloading')
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
    setPhase('downloading')
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
    // apply() answers before the download starts, so everything from here is
    // the live upgrade: download bytes, then verify/swap, then the restart.
    // The backend exits and the manager brings it back, so polls fail for a
    // few seconds — that is the restart, not a freeze, and it gets its own
    // phase instead of leaving the download line stuck at 100%.
    let lastDone = 0
    let lastAt = Date.now()
    let sawUpgrading = false
    let restartSince = 0
    let downSince = 0
    for (let i = 0; i < 1800; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
      const poll = await refresh()
      const snap = poll.status
      const now = Date.now()

      if (snap) {
        downSince = 0
        if (snap.current === target) {
          window.location.reload()
          return
        }
        if (snap.phase === 'restarting') {
          // The swap is done; the old process is about to exit.
          sawUpgrading = true
        }
        if (snap.upgrading) {
          sawUpgrading = true
          restartSince = 0
          if (snap.phase === 'restarting') {
            setPhase('restarting')
          } else if (
            snap.phase === 'installing' ||
            (snap.downloadTotal > 0 && snap.downloadDone >= snap.downloadTotal)
          ) {
            setPhase('installing')
          } else {
            setPhase('downloading')
          }
          if ((snap.downloadDone ?? 0) > 0) {
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
        } else if (snap.upgradeError) {
          setUpgrading(false)
          showNotice(t('update.upgradeFailed', { message: snap.upgradeError }), 'error')
          return
        } else if (sawUpgrading) {
          // Files were swapped; the process is about to exit. Wait for the
          // version to change instead of calling a successful upgrade failed.
          setPhase('restarting')
          if (restartSince === 0) restartSince = now
          if (now - restartSince > 90_000) {
            setUpgrading(false)
            showNotice(t('update.notRestarted'), 'error')
            return
          }
        } else if (i > 15) {
          // Nothing ever started: the click never reached the download.
          setUpgrading(false)
          showNotice(t('update.notExecuted'), 'error')
          return
        }
      } else if (poll.unauthorized) {
        // The restarted backend is answering but no longer knows this session
        // (older builds keep sessions in memory). Reload so the login gate can
        // take over instead of polling a 401 until the timeout.
        setPhase('restarting')
        window.setTimeout(() => window.location.reload(), 800)
        return
      } else {
        // apply() succeeded, so a dead API is the restart itself. A later
        // successful poll puts the download/install phase back if it was only
        // a blip, but a backend that never comes back is a real failure.
        setPhase('restarting')
        if (downSince === 0) downSince = now
        if (now - downSince > 90_000) {
          setUpgrading(false)
          showNotice(t('update.notRestarted'), 'error')
          return
        }
      }
    }
    setUpgrading(false)
    showNotice(t('update.timeout'), 'error')
  }

  const progressText = (() => {
    if (!upgrading) return ''
    const target = status?.latest ?? ''
    if (phase === 'restarting') return t('update.restarting', { version: target })
    if (phase === 'installing') return t('update.installing', { version: target })
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
              <span className="text-sm text-muted-foreground">{t('update.current')}</span>
              <span className="text-sm font-medium text-foreground">{`v${current}`}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={checkBusy || upgrading || Boolean(status?.checking)}
              onClick={() => void handleCheck()}
            >
              {checkBusy || status?.checking ? t('update.checking') : t('update.check')}
            </Button>
            {status?.available && !upgrading && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-amber-600">
                  {t('update.latest', { version: status.latest })}
                </span>
                <Button size="sm" onClick={() => setConfirmOpen(true)}>
                  {t('update.upgrade')}
                </Button>
              </div>
            )}
            {upgrading && (
              <div className="flex items-start gap-2">
                <AppIcon
                  name="progress_activity"
                  size={14}
                  className="mt-0.5 shrink-0 animate-spin text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">{progressText}</p>
              </div>
            )}
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
