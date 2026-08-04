import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { dashboardApi, type UsageLog } from '@/lib/dashboard-api'

const LIMIT = 20

export function LogsPage() {
  const [logs, setLogs] = useState<readonly UsageLog[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchText, setSearchText] = useState('')
  const mountedRef = useRef(true)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listLogs({
        model: modelFilter !== 'all' ? modelFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        token: searchText || undefined,
        limit: LIMIT,
        offset,
      })
      if (!mountedRef.current) return
      setLogs(result.logs)
      setTotal(result.total)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [modelFilter, statusFilter, searchText, offset])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  const handleFilterChange = useCallback(
    (setter: (v: string) => void, value: string | null) => {
      setter(value ?? 'all')
      setOffset(0)
    },
    [],
  )

  const models = useMemo(() => {
    const fromLogs = [...new Set(logs.map((l) => l.modelName))]
    if (modelFilter !== 'all' && !fromLogs.includes(modelFilter)) {
      fromLogs.push(modelFilter)
    }
    return fromLogs
  }, [logs, modelFilter])

  const hasPrev = offset > 0
  const hasNext = offset + LIMIT < total
  const pageText = total > 0 ? `第 ${Math.floor(offset / LIMIT) + 1} 页，共 ${total} 条` : ''

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="使用日志"
        status={total > 0 ? `${total} 条记录` : undefined}
      />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center gap-3">
          <Input
            placeholder="搜索令牌..."
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value)
              setOffset(0)
            }}
            className="w-56"
          />
          <Select
            value={modelFilter}
            onValueChange={(value) => handleFilterChange(setModelFilter, value)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部模型</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(value) => handleFilterChange(setStatusFilter, value)}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="ml-auto">
            导出
          </Button>
        </div>

        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>令牌</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>流式</TableHead>
                <TableHead>消耗</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-8">
                    加载中...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-xs text-destructive">{error}</span>
                      <Button variant="outline" size="sm" onClick={() => void fetchLogs()}>
                        重试
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-8">
                    暂无日志记录
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs">{log.createdAt}</TableCell>
                    <TableCell className="text-xs">{log.userId}</TableCell>
                    <TableCell className="text-xs">{log.tokenName}</TableCell>
                    <TableCell className="text-xs">{log.providerName}</TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {log.modelName}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {log.promptTokens} / {log.completionTokens}
                    </TableCell>
                    <TableCell className="text-xs">
                      {log.isStream ? 'SSE' : '-'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {log.quota > 0 ? `¥${log.quota.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {(log.useTime / 1000).toFixed(1)}s
                    </TableCell>
                    <TableCell>
                      <span
                        className={log.status === 'success' ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
                      >
                        {log.status === 'success' ? '成功' : '失败'}
                      </span>
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
    </div>
  )
}
