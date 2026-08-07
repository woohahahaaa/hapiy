import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { LogCapturePreviewDialog } from '@/components/LogCapturePreviewDialog'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DataTable, type ColumnDef } from '@/components/ui/DataTable'
import {
  dashboardApi,
  type DateRange,
  type LogCaptureFile,
  type LogCaptureType,
} from '@/lib/dashboard-api'

const LIMIT = 20

const TYPE_OPTIONS: readonly { value: LogCaptureType; label: string }[] = [
  { value: 'request', label: '请求' },
  { value: 'response', label: '响应' },
  { value: 'system', label: '系统' },
]

const TYPE_LABELS: Record<LogCaptureType, string> = {
  request: '请求',
  response: '响应',
  system: '系统',
}

const TYPE_VARIANTS: Record<LogCaptureType, 'default' | 'secondary' | 'outline'> = {
  request: 'default',
  response: 'secondary',
  system: 'outline',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function LogCapturePage() {
  const [files, setFiles] = useState<readonly LogCaptureFile[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dateRange, setDateRange] = useState<DateRange>({})
  const [selectedTypes, setSelectedTypes] = useState<readonly LogCaptureType[]>([])
  const [prefix, setPrefix] = useState('')
  const [preview, setPreview] = useState<LogCaptureFile | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const mountedRef = useRef(true)

  const typeQuery = selectedTypes.join(',')

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listLogCaptureFiles({
        prefix: prefix || undefined,
        type: typeQuery || undefined,
        from: dateRange.from,
        to: dateRange.to,
        limit: LIMIT,
        offset,
      })
      if (!mountedRef.current) return
      setFiles(result.files)
      setTotal(result.total)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [prefix, typeQuery, dateRange.from, dateRange.to, offset])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void fetchFiles()
  }, [fetchFiles])

  const toggleType = useCallback((value: LogCaptureType) => {
    setSelectedTypes((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value],
    )
    setOffset(0)
  }, [])

  const handleClear = useCallback(
    async (scope: 'filtered' | 'all') => {
      setClearing(true)
      try {
        await dashboardApi.clearLogCapture({
          scope,
          ...(scope === 'filtered'
            ? {
                prefix: prefix || undefined,
                type: typeQuery || undefined,
                from: dateRange.from,
                to: dateRange.to,
              }
            : {}),
        })
        setClearOpen(false)
        void fetchFiles()
      } catch (err) {
        setError(err instanceof Error ? err.message : '清空失败')
        setClearOpen(false)
      } finally {
        setClearing(false)
      }
    },
    [prefix, typeQuery, dateRange.from, dateRange.to, fetchFiles],
  )

  const columns: ColumnDef<LogCaptureFile>[] = [
    { key: 'created_at', label: '时间', isTime: true },
    { key: 'prefix', label: '文件夹路径' },
    { key: 'source', label: '标记' },
    { key: 'type', label: '类型', render: (v) => <Badge variant={TYPE_VARIANTS[v as LogCaptureType]}>{TYPE_LABELS[v as LogCaptureType]}</Badge> },
    { key: 'name', label: '文件名' },
    { key: 'size', label: '大小', render: (v) => formatSize(v as number) },
    { key: 'id', label: '操作', showEmptyPlaceholder: false, render: (_, row) => <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setPreview(row as LogCaptureFile) }}>查看</Button> },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="日志抓取"
        status={total > 0 ? `${total} 条记录` : undefined}
        actions={undefined}
      />
      <div className="flex-1 p-6">
        <DataTable
          id="capture"
          columns={columns}
          data={files}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={LIMIT}
          onOffsetChange={setOffset}
          emptyText="暂无抓取日志"
          onRetry={() => void fetchFiles()}
          filters={
            <>
              <DateRangeFilter
                value={dateRange}
                onChange={(range) => {
                  setDateRange(range)
                  setOffset(0)
                }}
              />
              <div className="flex items-center gap-3">
                {TYPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex cursor-pointer items-center gap-1.5">
                    <Checkbox
                      checked={selectedTypes.includes(opt.value)}
                      onCheckedChange={() => toggleType(opt.value)}
                    />
                    <span className="text-xs text-muted-foreground">{opt.label}</span>
                  </label>
                ))}
              </div>
              <Input
                placeholder="文件夹前缀..."
                value={prefix}
                onChange={(e) => {
                  setPrefix(e.target.value)
                  setOffset(0)
                }}
                className="w-48"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchFiles()}
              >
                刷新
              </Button>
            </>
          }
          actions={
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setClearOpen(true)}
            >
              清空
            </Button>
          }
        />
      </div>

      <LogCapturePreviewDialog
        fileId={preview?.id ?? ''}
        fileName={preview?.name ?? ''}
        open={preview !== null}
        onClose={() => setPreview(null)}
      />

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空当前筛选条件下的所有内容，确认吗？</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={clearing} onClick={() => setClearOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={clearing}
              onClick={() => void handleClear('filtered')}
            >
              清空当前页面的
            </Button>
            <Button
              variant="destructive"
              disabled={clearing}
              onClick={() => void handleClear('all')}
            >
              清空所有页面的
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
