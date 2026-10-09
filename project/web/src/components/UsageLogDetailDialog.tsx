import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { SecretValue } from '@/components/SecretValue'
import { useProviderKeyNote } from '@/lib/provider-key-notes'
import type { UsageLog } from '@/lib/dashboard-api'

// Format a stage time in seconds: 0 shows "0s", values above 0 floor at 0.1s.
function fmtSeconds(val: number): string {
  if (val < 0) return '-'
  if (val === 0) return '0s'
  return `${Math.max(0.1, val / 1000).toFixed(1)}s`
}

// Event records (故障转移/自动恢复/手动恢复/系统管理) carry an empty status.
function isEventLog(row: UsageLog): boolean {
  return row.status === ''
}

export function UsageLogDetailDialog({ log, onOpenChange }: { readonly log: UsageLog | null; readonly onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('logs')
  return (
    <Dialog open={log !== null} onOpenChange={onOpenChange}>
      <DialogContent width="sm">
        <DialogHeader>
          <DialogTitle>{t('detail.title', { id: log?.id ?? '' })}</DialogTitle>
        </DialogHeader>
        {log && <LogDetailFields log={log} />}
      </DialogContent>
    </Dialog>
  )
}

function LogDetailFields({ log }: { log: UsageLog }) {
  const { t } = useTranslation('logs')
  const keyNote = useProviderKeyNote(log.providerKey)
  const date = new Date(log.createdAt)
  const timeText = Number.isNaN(date.getTime())
    ? log.createdAt
    : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  return (
    <div className="space-y-4 text-xs">
      <FieldGroup>
        <DetailRow className="col-span-2" label={t('detail.requestId')} value={log.requestId || '-'} />
        <DetailRow className="col-span-2" label={t('columns.time')} value={timeText} />
        <DetailRow className="col-span-2" label={t('columns.token')} value={log.tokenName || '-'} />
        <DetailRow className="col-span-2" label={t('columns.provider')} value={log.providerName || '-'} />
        <DetailRow className="col-span-2" label={t('columns.model')} value={log.modelName || '-'} />
        <DetailRow className="col-span-2" label={t('columns.source')} value={log.source || '-'} />
        <div className="col-span-2 flex items-baseline gap-2">
          <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">{t('detail.providerKey')}</span>
          <SecretValue value={log.providerKey || '-'} note={keyNote} />
        </div>
        <div className="col-span-2 flex items-baseline gap-2">
          <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">{t('detail.upstreamUrl')}</span>
          <span className="break-all font-mono leading-relaxed">{log.upstreamUrl || '-'}</span>
        </div>
      </FieldGroup>
      <FieldGroup>
        <DetailRow
          className="col-span-2"
          label={t('columns.tokens')}
          value={
            isEventLog(log) ? '-' : (
              <span>
                <span className="text-muted-foreground/60">{t('tokens.input')}</span> {log.promptTokens}{t('tokens.detailOpen')}
                <span className="text-muted-foreground/60">{t('tokens.cacheWrite')}</span> {log.promptCacheMissTokens} /{' '}
                <span className="text-muted-foreground/60">{t('tokens.cacheRead')}</span> {log.promptCacheHitTokens}{t('tokens.detailClose')}{' '}
                <span className="text-muted-foreground/60">{t('tokens.output')}</span> {log.completionTokens}
              </span>
            )
          }
        />
        <DetailRow className="col-span-2" label={t('columns.stream')} value={log.isStream ? 'SSE' : '-'} />
        <DetailRow className="col-span-2" label={t('columns.quota')} value={log.quota > 0 ? formatQuota(log) : '-'} />
      </FieldGroup>
      <FieldGroup>
        {isEventLog(log) ? <DetailRow className="col-span-2" label={t('columns.latency')} value="-" /> : (
          <DetailRow
            className="col-span-2"
            label={t('columns.latency')}
            value={
              <span className="space-y-1">
                <span className="block">{`${(log.useTime / 1000).toFixed(1)}s`}</span>
                <span className="block text-muted-foreground/60">
                  {t('detail.timing', {
                    queue: fmtSeconds(log.queueWaitMs),
                    requestRewrite: fmtSeconds(log.requestRewriteMs),
                    connect: fmtSeconds(log.connectMs),
                    firstByte: fmtSeconds(log.firstByteMs),
                    responseRewrite: fmtSeconds(log.responseRewriteMs),
                    streamRewrite: fmtSeconds(log.streamRewriteMs),
                  })}
                </span>
              </span>
            }
          />
        )}
      </FieldGroup>
      <FieldGroup>
        <DetailRow
          className="col-span-2"
          label={t('columns.affinity')}
          value={
            log.affinityReuse === ''
              ? '-'
              : (() => {
                  const labels: Record<string, string> = {
                    none: t('affinity.create'),
                    partial: t('affinity.partial'),
                    full: t('affinity.full'),
                  }
                  const state = labels[log.affinityReuse] ?? log.affinityReuse
                  const partLabels: Record<string, string> = {
                    provider: 'Provider',
                    baseurl: 'Base URL',
                    key: 'Key',
                  }
                  const parts = log.affinityReuseParts.map((p) => partLabels[p] ?? p).join(t('affinity.partsSeparator'))
                  return parts ? t('affinity.withParts', { state, parts }) : state
                })()
          }
        />
        <DetailRow
          className="col-span-2"
          label={t('columns.status')}
          value={log.status === 'success' ? t('status.success') : log.status === 'failed' ? t('status.failed') : (log.source || '-')}
        />
        {log.status === 'failed' && log.errorMessage && (
          <div className="col-span-2 flex items-baseline gap-2">
            <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">{t('detail.details')}</span>
            <span className="break-words whitespace-pre-wrap leading-relaxed text-destructive">{log.errorMessage}</span>
          </div>
        )}
        {log.eventDetail && (
          <div className="col-span-2 flex items-baseline gap-2">
            <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">{t('detail.details')}</span>
            <span className="break-words whitespace-pre-wrap leading-relaxed text-foreground">{log.eventDetail}</span>
          </div>
        )}
      </FieldGroup>
    </div>
  )
}

function FieldGroup({ children }: { children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 h-px bg-border-subtle" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</div>
    </section>
  )
}

function DetailRow({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">{label}</span>
      <span className="min-w-0 break-words whitespace-pre-wrap leading-relaxed text-foreground">{value}</span>
    </div>
  )
}

function formatQuota(log: UsageLog): string {
  const symbol = log.currency === 'USD' ? '$' : '¥'
  return `${symbol}${log.quota.toFixed(6).replace(/\.?0+$/, '')}`
}
