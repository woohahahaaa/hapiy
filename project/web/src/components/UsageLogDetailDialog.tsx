import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { UsageLog } from '@/lib/dashboard-api'

// Format a stage time in seconds: 0 shows "0s", values above 0 floor at 0.1s.
function fmtSeconds(val: number): string {
  if (val < 0) return '-'
  if (val === 0) return '0s'
  return `${Math.max(0.1, val / 1000).toFixed(1)}s`
}

// Event records (自动禁用/自动恢复/手动恢复/系统管理) carry an empty status.
function isEventLog(row: UsageLog): boolean {
  return row.status === ''
}

export function UsageLogDetailDialog({ log, onOpenChange }: { readonly log: UsageLog | null; readonly onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={log !== null} onOpenChange={onOpenChange}>
      <DialogContent width="sm">
        <DialogHeader>
          <DialogTitle>记录详情 {log?.id ?? ''}</DialogTitle>
        </DialogHeader>
        {log && <LogDetailFields log={log} />}
      </DialogContent>
    </Dialog>
  )
}

function LogDetailFields({ log }: { log: UsageLog }) {
  const date = new Date(log.createdAt)
  const timeText = Number.isNaN(date.getTime())
    ? log.createdAt
    : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  return (
    <div className="space-y-4 text-xs">
      <FieldGroup>
        <DetailRow className="col-span-2" label="请求 id" value={log.requestId || '-'} />
        <DetailRow className="col-span-2" label="时间" value={timeText} />
        <DetailRow className="col-span-2" label="令牌" value={log.tokenName || '-'} />
        <DetailRow className="col-span-2" label="供应商" value={log.providerName || '-'} />
        <DetailRow className="col-span-2" label="模型" value={log.modelName || '-'} />
        <DetailRow className="col-span-2" label="来源" value={log.source || '-'} />
        <div className="col-span-2 flex items-baseline gap-2">
          <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">上游 URL</span>
          <span className="break-all font-mono">{log.upstreamUrl || '-'}</span>
        </div>
      </FieldGroup>
      <FieldGroup>
        <DetailRow
          className="col-span-2"
          label="Tokens"
          value={
            isEventLog(log) ? '-' : (
              <span>
                <span className="text-muted-foreground/40">输入</span> {log.promptTokens}（
                <span className="text-muted-foreground/40">缓存写入</span> {log.promptCacheMissTokens} /{' '}
                <span className="text-muted-foreground/40">缓存读取</span> {log.promptCacheHitTokens}）/{' '}
                <span className="text-muted-foreground/40">输出</span> {log.completionTokens}
              </span>
            )
          }
        />
        <DetailRow className="col-span-2" label="流式" value={log.isStream ? 'SSE' : '-'} />
        <DetailRow className="col-span-2" label="消耗" value={log.quota > 0 ? formatQuota(log) : '-'} />
      </FieldGroup>
      <FieldGroup>
        {isEventLog(log) ? <DetailRow className="col-span-2" label="耗时" value="-" /> : (
          <DetailRow
            className="col-span-2"
            label="耗时"
            value={
              <span className="space-y-1">
                <span className="block">{`${(log.useTime / 1000).toFixed(1)}s`}</span>
                <span className="block text-muted-foreground/60">
                  排队 {fmtSeconds(log.queueWaitMs)} · 请求改写 {fmtSeconds(log.requestRewriteMs)} · 连接{' '}
                  {fmtSeconds(log.connectMs)} · 首字 {fmtSeconds(log.firstByteMs)} · 响应改写{' '}
                  {fmtSeconds(log.responseRewriteMs)} · 流式改写 {fmtSeconds(log.streamRewriteMs)}
                </span>
              </span>
            }
          />
        )}
      </FieldGroup>
      <FieldGroup>
        <DetailRow
          className="col-span-2"
          label="渠道亲和性"
          value={
            log.affinityReuse === ''
              ? '-'
              : (() => {
                  const labels: Record<string, string> = {
                    none: '创建渠道',
                    partial: '部分复用',
                    full: '复用渠道',
                  }
                  const state = labels[log.affinityReuse] ?? log.affinityReuse
                  const partLabels: Record<string, string> = {
                    provider: 'Provider',
                    baseurl: 'Base URL',
                    key: 'Key',
                  }
                  const parts = log.affinityReuseParts.map((p) => partLabels[p] ?? p).join('、')
                  return parts ? `${state}（复用：${parts}）` : state
                })()
          }
        />
        <DetailRow
          className="col-span-2"
          label="状态"
          value={log.status === 'success' ? '成功' : log.status === 'failed' ? '失败' : (log.errorMessage || log.source || '-')}
        />
        {log.status === 'failed' && log.errorMessage && (
          <div className="col-span-2 flex items-baseline gap-2">
            <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">详细信息</span>
            <span className="break-words whitespace-pre-wrap text-destructive">{log.errorMessage}</span>
          </div>
        )}
      </FieldGroup>
    </div>
  )
}

function FieldGroup({ children }: { children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 h-px bg-border" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</div>
    </section>
  )
}

function DetailRow({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">{label}</span>
      <span className="break-words text-foreground">{value}</span>
    </div>
  )
}

function formatQuota(log: UsageLog): string {
  const symbol = log.currency === 'USD' ? '$' : '¥'
  return `${symbol}${log.quota.toFixed(6).replace(/\.?0+$/, '')}`
}
