import { useCallback, useEffect, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { JsonEditModal, parseJsonEditorArray, type JsonEditorIdMap } from '@/components/JsonEditModal'
import { Button } from '@/components/ui/button'
import { DataTable, type ColumnDef } from '@/components/ui/DataTable'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { Token, TokenInput } from '@/lib/dashboard-api'

type TokenFormProps = {
  readonly token: Token | null
  readonly onSave: (token: TokenInput) => void
  readonly onCancel: () => void
  readonly onRefresh: () => void
  readonly pendingKey: string | null
  readonly isSaving: boolean
}

function toErrorMessage(error: unknown): string {
  return error instanceof DashboardApiError ? error.message : '发生意外错误，请重试'
}

const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function generatePreviewKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let key = 'hk-'
  for (const byte of bytes) {
    key += KEY_CHARS[byte % KEY_CHARS.length]
  }
  return key
}

export function TokenPage() {
  const [tokens, setTokens] = useState<readonly Token[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(20)
  const [editing, setEditing] = useState<Token | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTokens = useCallback(async (currentOffset: number, currentLimit: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listTokens({ limit: currentLimit, offset: currentOffset })
      setTokens(result.tokens)
      setTotal(result.total)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTokens(offset, limit)
  }, [loadTokens, offset, limit])

  const runMutation = async (operation: () => Promise<unknown>) => {
    setIsSaving(true)
    setError(null)
    try {
      await operation()
      await loadTokens(offset, limit)
      return true
    } catch (err) {
      setError(toErrorMessage(err))
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSave = async (token: TokenInput) => {
    const saved = await runMutation(async () => {
      if (!editing) return dashboardApi.createToken(token)
      if (pendingKey) {
        const historyKeys = [editing.key, ...editing.historyKeys].slice(0, 5)
        return dashboardApi.updateToken(editing.id, { ...token, key: pendingKey, historyKeys })
      }
      return dashboardApi.updateToken(editing.id, token)
    })
    if (saved) {
      setEditing(null)
      setPendingKey(null)
      setIsDialogOpen(false)
    }
  }

  const handleRefresh = () => {
    setPendingKey(generatePreviewKey())
  }

  const handleJsonSave = async (data: unknown, idMap: JsonEditorIdMap) => {
    setIsSaving(true)
    setError(null)
    try {
      const parsed = parseJsonEditorArray<Token>(data)
      const currentMap = new Map(tokens.map((t) => [t.id, t]))
      const retainedIds = new Set<string>()
      const ops: Promise<unknown>[] = []

      for (const item of parsed) {
        const id = idMap.get(item.id)
        const tokenInput: TokenInput = {
          name: item.name,
          quota: item.quota,
          status: item.status,
          key: item.key,
          historyKeys: item.historyKeys,
          usedQuota: item.usedQuota,
        }
        if (id && currentMap.has(id)) {
          retainedIds.add(id)
          const { id: _editorId, ...edited } = item
          const currentRecord = currentMap.get(id)
          if (!currentRecord) continue
          const { id: _backendId, ...current } = currentRecord
          if (JSON.stringify(edited) !== JSON.stringify(current)) {
            ops.push(dashboardApi.updateToken(id, tokenInput))
          }
        } else {
          ops.push(dashboardApi.createToken(tokenInput))
        }
      }

      for (const id of currentMap.keys()) {
        if (!retainedIds.has(id)) {
          ops.push(dashboardApi.deleteToken(id))
        }
      }

      const results = await Promise.allSettled(ops)
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      await loadTokens(offset, limit)
      if (failures.length > 0) {
        throw new Error(`${failures.length} 项保存失败`)
      }
    } finally {
      setIsSaving(false)
    }
  }

  const copyToClipboard = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
    } catch (err) {
      setError(err instanceof Error ? `复制失败：${err.message}` : '复制失败')
    }
  }

  const columns: ColumnDef<Token>[] = [
    {
      key: 'name',
      label: '名称',
      render: (_, row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'key',
      label: 'Token',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 text-xs font-mono">{row.key.slice(0, 12)}...</code>
          <Button variant="ghost" size="icon" onClick={() => void copyToClipboard(row.key)}>
            <AppIcon name="content_copy" />
          </Button>
        </div>
      ),
    },
    {
      key: 'quota',
      label: '额度',
      render: (_, row) =>
        row.quota === null ? (
          <span className="text-xs text-muted-foreground">无限制</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs">¥{row.usedQuota} / ¥{row.quota}</span>
            <div className="h-1.5 w-16 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min((row.usedQuota / row.quota) * 100, 100)}%` }}
              />
            </div>
          </div>
        ),
    },
    {
      key: 'status',
      label: '状态',
      render: (_, row) => (
        <span className={row.status ? 'text-success' : 'text-destructive'}>
          {row.status ? '启用' : '禁用'}
        </span>
      ),
    },
    {
      key: 'id',
      label: '操作',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => void runMutation(() => dashboardApi.toggleToken(row.id))}
          >
            {row.status ? '禁用' : '启用'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={isSaving}
            onClick={() => {
              setEditing(row)
              setPendingKey(null)
              setIsDialogOpen(true)
            }}
          >
            <AppIcon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={isSaving}
            onClick={() => void runMutation(() => dashboardApi.deleteToken(row.id))}
          >
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="令牌管理" status={`${total} 个令牌`} />
      <div className="p-6">
        <DataTable<Token>
          id="tokens"
          columns={columns}
          data={tokens}
          total={total}
          loading={isLoading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText="暂无令牌。添加一个令牌开始使用。"
          onRetry={() => void loadTokens(offset, limit)}
          actions={
            <>
              <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={isSaving}>
                <AppIcon name="code" data-icon="inline-start" />编辑 JSON
              </Button>
              <Button
                onClick={() => {
                  setEditing(null)
                  setPendingKey(null)
                  setIsDialogOpen(true)
                }}
                disabled={isSaving}
              >
                <AppIcon name="add" data-icon="inline-start" />添加令牌
              </Button>
            </>
          }
        />

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? '编辑令牌' : '添加令牌'}</DialogTitle>
            </DialogHeader>
            <TokenForm
              token={editing}
              onSave={handleSave}
              onCancel={() => {
                setEditing(null)
                setPendingKey(null)
                setIsDialogOpen(false)
              }}
              onRefresh={handleRefresh}
              pendingKey={pendingKey}
              isSaving={isSaving}
            />
          </DialogContent>
        </Dialog>
        {jsonOpen && (
          <JsonEditModal
            data={tokens}
            onSave={handleJsonSave}
            onClose={() => setJsonOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function TokenForm({ token, onSave, onCancel, onRefresh, pendingKey, isSaving }: TokenFormProps) {
  const [name, setName] = useState(token?.name ?? '')
  const [quota, setQuota] = useState(token?.quota?.toString() ?? '')

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="token-name">名称</FieldLabel>
        <Input id="token-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Production Token" />
      </Field>
      {token ? (
        <Field>
          <FieldLabel>Token</FieldLabel>
          <code className="block rounded bg-muted px-2 py-2 text-xs font-mono">{pendingKey ?? token.key}</code>
          <Button variant="outline" size="sm" className="mt-2" disabled={isSaving} onClick={onRefresh}><AppIcon name="refresh" data-icon="inline-start" />{pendingKey ? '已刷新（保存后生效）' : '刷新'}</Button>
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">服务端会在保存后生成 Token Key。</p>
      )}
      <Field>
        <FieldLabel htmlFor="token-quota">额度 (¥，留空=无限制)</FieldLabel>
        <Input id="token-quota" type="number" value={quota} onChange={(event) => setQuota(event.target.value)} placeholder="无限制" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>取消</Button>
        <Button disabled={isSaving || !name.trim()} onClick={() => onSave({ name: name.trim(), quota: quota === '' ? null : Number(quota), status: token?.status ?? true })}>
          {isSaving ? '保存中...' : '保存'}
        </Button>
      </div>
    </FieldGroup>
  )
}
