import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { LogCapturePreviewDialog } from '@/components/LogCapturePreviewDialog'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

  const hasPrev = offset > 0
  const hasNext = offset + LIMIT < total
  const pageText = total > 0 ? `第 ${Math.floor(offset / LIMIT) + 1} 页，共 ${total} 条` : ''

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="日志抓取"
        status={total > 0 ? `${total} 条记录` : undefined}
      />
      <div className="flex-1 p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
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
        </div>

        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead>文件夹</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                    加载中...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-xs text-destructive">{error}</span>
                      <Button variant="outline" size="sm" onClick={() => void fetchFiles()}>
                        重试
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : files.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                    暂无抓取日志
                  </TableCell>
                </TableRow>
              ) : (
                files.map((file) => (
                  <TableRow
                    key={file.id}
                    className="cursor-pointer"
                    onClick={() => setPreview(file)}
                  >
                    <TableCell className="font-mono text-xs">{file.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {file.prefix}
                    </TableCell>
                    <TableCell>
                      <Badge variant={TYPE_VARIANTS[file.type]}>
                        {TYPE_LABELS[file.type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{formatSize(file.size)}</TableCell>
                    <TableCell className="font-mono text-xs">{file.created_at}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPreview(file)
                        }}
                      >
                        查看
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {pageText}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => setOffset(offset + LIMIT)}
            >
              下一页
            </Button>
          </div>
        </div>
      </div>

      <LogCapturePreviewDialog
        fileId={preview?.id ?? ''}
        fileName={preview?.name ?? ''}
        open={preview !== null}
        onClose={() => setPreview(null)}
      />
    </div>
  )
}
