import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Dialog, DialogContent, DialogHeader, DialogScrollBody, DialogTitle } from '@/components/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'
import { i18n } from '@/i18n/i18n'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { Token, TokenInput } from '@/lib/dashboard-api'

type TokenFormProps = {
  readonly token: Token | null
  readonly onSave: (token: TokenInput) => void
  readonly isSaving: boolean
}

function toErrorMessage(error: unknown): string {
  return error instanceof DashboardApiError ? error.message : i18n.t('token:errors.unexpected')
}

export function TokenPage() {
  const { t } = useTranslation('token')
  const [tokens, setTokens] = useState<readonly Token[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [editing, setEditing] = useState<Token | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Token | null>(null)

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
      return dashboardApi.updateToken(editing.id, token)
    })
    if (saved) {
      setEditing(null)
      setIsDialogOpen(false)
    }
  }

  const copyToClipboard = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
    } catch (err) {
      setError(err instanceof Error ? t('toast.copyFailedWith', { message: err.message }) : t('toast.copyFailed'))
    }
  }

  const columns: ColumnDef<Token>[] = [
    {
      key: 'name',
      label: t('columns.name'),
      defaultWidth: { kind: 'pixel', value: 160 },
      render: (_, row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'key',
      label: 'Token',
      defaultWidth: { kind: 'pixel', value: 220 },
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <code className="rounded-none bg-muted px-2 py-1 text-xs font-mono">{row.key.slice(0, 12)}...</code>
          <Button variant="ghost" size="icon" onClick={() => void copyToClipboard(row.key)}>
            <AppIcon name="content_copy" />
          </Button>
        </div>
      ),
    },
    {
      key: 'quota',
      label: t('columns.quota'),
      defaultWidth: { kind: 'pixel', value: 220 },
      render: (_, row) =>
        row.quota === null ? (
          <span className="text-xs">{t('list.unlimited')}</span>
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
      label: t('columns.status'),
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, row) => (
        <span className={row.status ? 'text-success' : 'text-destructive'}>
          {row.status ? t('common:action.enable') : t('common:action.disable')}
        </span>
      ),
    },
    {
      key: 'id',
      label: t('columns.actions'),
      defaultWidth: { kind: 'pixel', value: 160 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => void runMutation(() => dashboardApi.toggleToken(row.id))}
          >
            {row.status ? t('common:action.disable') : t('common:action.enable')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={isSaving}
            onClick={() => {
              setEditing(row)
              setIsDialogOpen(true)
            }}
          >
            <AppIcon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={isSaving}
            onClick={() => setDeleting(row)}
          >
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('description')}
        status={t('list.statusCount', { count: total })}
      />
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
          emptyText={t('list.empty')}
          onRetry={() => void loadTokens(offset, limit)}
          actions={
            <>
              <Button
                onClick={() => {
                  setEditing(null)
                  setIsDialogOpen(true)
                }}
                disabled={isSaving}
              >
                <AppIcon name="add" data-icon="inline-start" />{t('list.add')}
              </Button>
            </>
          }
        />

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent scrollFooter>
            <DialogHeader>
              <DialogTitle>{editing ? t('dialog.editTitle') : t('list.add')}</DialogTitle>
            </DialogHeader>
            <TokenForm
              token={editing}
              onSave={handleSave}
              isSaving={isSaving}
            />
          </DialogContent>
        </Dialog>

        <ConfirmDeleteDialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
          title={t('dialog.deleteTitle')}
          description={t('dialog.deleteDescription', { name: deleting?.name ?? '' })}
          busy={isSaving}
          onConfirm={() => {
            if (deleting) {
              const token = deleting
              setDeleting(null)
              void runMutation(() => dashboardApi.deleteToken(token.id))
            }
          }}
        />
      </div>
    </div>
  )
}

function TokenForm({ token, onSave, isSaving }: TokenFormProps) {
  const { t } = useTranslation('token')
  const [name, setName] = useState(token?.name ?? '')
  const [quota, setQuota] = useState(token?.quota?.toString() ?? '')

  return (
    <DialogScrollBody footer={
      <>
        <Button disabled={isSaving || !name.trim()} onClick={() => onSave({ name: name.trim(), quota: quota === '' ? null : Number(quota), status: token?.status ?? true })}>
          {isSaving ? t('actions.saving') : t('common:action.save')}
        </Button>
      </>
    }>
      <FieldGroup>
      <Field>
        <FieldLabel htmlFor="token-name">{t('columns.name')}</FieldLabel>
        <Input id="token-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Production Token" />
      </Field>
      {token ? (
        <Field>
          <FieldLabel>Token</FieldLabel>
          <code className="block rounded-none bg-muted px-2 py-2 text-xs font-mono">{token.key}</code>
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">{t('form.serverGenerates')}</p>
      )}
      <Field>
        <FieldLabel htmlFor="token-quota">{t('form.quotaLabel')}</FieldLabel>
        <Input id="token-quota" type="number" value={quota} onChange={(event) => setQuota(event.target.value)} placeholder={t('form.unlimitedPlaceholder')} />
      </Field>
        </FieldGroup>
    </DialogScrollBody>
  )
}
