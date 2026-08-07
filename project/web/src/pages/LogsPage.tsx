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
import { DataTable, type ColumnDef } from '@/components/ui/DataTable'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
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
  const [clearDialogOpen, setClearDialogOpen] = useState(false)

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

  const handleClearFiltered = useCallback(async () => {
    try {
      const filters: Record<string, unknown> = {}
      if (modelFilter !== 'all') filters.model = modelFilter
      if (statusFilter !== 'all') filters.status = statusFilter
      if (searchText) filters.token = searchText
      const deleted = await dashboardApi.clearLogs({ scope: 'filtered', filters })
      setClearDialogOpen(false)
      toast(`已清空 ${deleted} 条记录`)
      if (offset > 0) {
        setOffset(0)
      } else {
        void fetchLogs()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败')
    }
  }, [modelFilter, statusFilter, searchText, offset, fetchLogs])

  const handleClearAll = useCallback(async () => {
    try {
      const deleted = await dashboardApi.clearLogs({ scope: 'all' })
      setClearDialogOpen(false)
      setLogs([])
      setTotal(0)
      setOffset(0)
      toast(`已清空全部 ${deleted} 条记录`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败')
    }
  }, [])

  const models = useMemo(() => {
    const fromLogs = [...new Set(logs.map((l) => l.modelName))]
    if (modelFilter !== 'all' && !fromLogs.includes(modelFilter)) {
      fromLogs.push(modelFilter)
    }
    return fromLogs
  }, [logs, modelFilter])

  const columns: ColumnDef<UsageLog>[] = [
    { key: 'createdAt', label: '时间', isTime: true },
    { key: 'userId', label: '用户' },
    { key: 'tokenName', label: '令牌' },
    { key: 'providerName', label: '供应商' },
    { key: 'modelName', label: '模型' },
    {
      key: 'promptTokens',
      label: 'Tokens',
      render: (v, row) => `${v} / ${row.completionTokens}`,
    },
    {
      key: 'isStream',
      label: '流式',
      render: (v) => (v ? 'SSE' : '-'),
    },
    {
      key: 'quota',
      label: '消耗',
      render: (v) => {
        const q = v as number
        return q > 0 ? `¥${q.toFixed(2)}` : '-'
      },
    },
    {
      key: 'useTime',
      label: '耗时',
      render: (v) => `${(v as number / 1000).toFixed(1)}s`,
    },
    {
      key: 'status',
      label: '状态',
      render: (v) => {
        const s = v as string
        return (
          <span className={s === 'success' ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
            {s === 'success' ? '成功' : '失败'}
          </span>
        )
      },
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="使用记录"
        status={total > 0 ? `${total} 条记录` : undefined}
      />
      <div className="flex-1 p-6">
        <DataTable
          id="logs"
          columns={columns}
          data={logs}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={LIMIT}
          onOffsetChange={setOffset}
          onRetry={fetchLogs}
          filters={
            <>
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
            </>
          }
          actions={
            <>
              <Button variant="outline" size="sm">
                导出
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setClearDialogOpen(true)}
              >
                清空
              </Button>
            </>
          }
        />
        </div>

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空当前筛选条件下的所有内容，确认吗？</DialogTitle>
            <DialogDescription>
              此操作不可恢复，清空后无法找回相关记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setClearDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleClearFiltered()}>
              清空当前页面的
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleClearAll()}>
              清空所有页面的
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
