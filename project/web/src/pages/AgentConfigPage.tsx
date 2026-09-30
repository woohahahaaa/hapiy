import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { DialogCodeEditor } from '@/components/dialog/code-editor'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { i18n } from '@/i18n/i18n'
import {
  dashboardApi,
  DashboardApiError,
  type AgentConfigFile,
  type AgentPathCheckResult,
  type AgentOsPaths,
  type AgentSshConfig,
  type AgentSshProbeResult,
  type AgentTypeRule,
} from '@/lib/dashboard-api'
import { AgentConfigEditorDialog } from '@/components/dialog/agent-config-editor'
import { AgentModelsDialog } from '@/components/dialog/agent-models'

// ── Agent 接管 ──

export type AgentTargetOs = 'windows' | 'mac' | 'other'

export const TARGET_OS_LABELS: Record<AgentTargetOs, string> = {
  windows: 'Windows',
  mac: 'Mac',
  other: i18n.t('agentConfig:os.other'),
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function osNameFromCode(code: string): string {
  switch (code) {
    case 'windows':
      return 'Windows'
    case 'darwin':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return code
  }
}

export function osPathFor(osPaths: AgentOsPaths | undefined, targetOs: 'windows' | 'mac'): string {
  if (!osPaths) return ''
  return (targetOs === 'windows' ? osPaths.windows : osPaths.mac).trim()
}

function blankSshConfig(): AgentSshConfig {
  return {
    host: '',
    port: 22,
    username: '',
    auth_type: 'password',
    jump_enabled: false,
  }
}

function SshProbeRow({ label, result }: { readonly label: string; readonly result: AgentSshProbeResult }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={
          result.ok
            ? 'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white'
            : 'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white'
        }
        aria-hidden
      >
        {result.ok ? '✓' : '✗'}
      </span>
      <span className={result.ok ? 'text-xs font-medium text-green-600' : 'text-xs font-medium text-destructive'}>{label}</span>
      {result.ok && result.detail && <span className="truncate text-xs text-muted-foreground">· {result.detail}</span>}
      {!result.ok && result.error && <span className="truncate text-xs text-destructive" title={result.error}>· {result.error}</span>}
    </div>
  )
}

function SshTestResultPanel({
  result,
}: {
  readonly result: { readonly connect: AgentSshProbeResult; readonly read: AgentSshProbeResult; readonly write: AgentSshProbeResult }
}) {
  const { t } = useTranslation('agentConfig')
  return (
    <div className="rounded-xs border border-border bg-muted/30 p-3">
      <div className="flex flex-col gap-1.5">
        <SshProbeRow label={t('sshProbe.connect')} result={result.connect} />
        <SshProbeRow label={t('sshProbe.readPath')} result={result.read} />
        <SshProbeRow label={t('sshProbe.writeProbe')} result={result.write} />
      </div>
    </div>
  )
}

// ── Agent 接管: 路径检测提示 ──

function PathCheckHint({
  result,
  targetOs,
  onPreview,
}: {
  result: AgentPathCheckResult
  targetOs: AgentTargetOs
  onPreview: () => void
}) {
  const { exists, size, current_os, expandedPath } = result
  const { t } = useTranslation('agentConfig')
  const osMismatch =
    (targetOs === 'windows' && current_os !== 'windows') ||
    (targetOs === 'mac' && current_os !== 'darwin')

  if (!exists) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-destructive">
        <span className="truncate">
          {t('pathCheck.notExists', { path: expandedPath })}
          {osMismatch && t('pathCheck.osMismatch', { target: TARGET_OS_LABELS[targetOs], current: osNameFromCode(current_os) })}
        </span>
      </span>
    )
  }

  if (size === 0) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-warning">
        <span className="truncate">{t('pathCheck.existsZero', { path: expandedPath })}</span>
        <Button type="button" variant="outline" size="sm" onClick={onPreview}>{t('pathCheck.preview')}</Button>
      </span>
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-2 text-green-600">
      <span className="truncate">{t('pathCheck.existsSize', { size: formatFileSize(size), path: expandedPath })}</span>
      <Button type="button" variant="outline" size="sm" onClick={onPreview}>{t('pathCheck.preview')}</Button>
    </span>
  )
}

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : fallback
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function AgentConfigPage() {
  const { t } = useTranslation('agentConfig')
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <div className="flex min-h-0 flex-1 flex-col p-6">
        <AgentConfigFilesTab />
      </div>
    </div>
  )
}

// ── Tab 1: 接管配置文件 ──

function AgentConfigFilesTab() {
  const { t } = useTranslation('agentConfig')
  const [files, setFiles] = useState<readonly AgentConfigFile[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [takeoverOpen, setTakeoverOpen] = useState(false)
  const [editing, setEditing] = useState<AgentConfigFile | null>(null)
  const [editingRecord, setEditingRecord] = useState<AgentConfigFile | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AgentConfigFile | null>(null)
  const [managingModels, setManagingModels] = useState<AgentConfigFile | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listAgentConfigFiles({ limit, offset })
      setFiles(result.files)
      setTotal(result.total)
    } catch (err) {
      setError(toErrorMessage(err, t('errors.loadFailed')))
    } finally {
      setLoading(false)
    }
  }, [limit, offset, t])

  useEffect(() => {
    void fetch()
  }, [fetch])

  const handleDelete = async (row: AgentConfigFile) => {
    setMutating(true)
    setConfirmDelete(null)
    try {
      await dashboardApi.deleteAgentConfigFile(row.id)
      toast(t('toast.deleted'))
      void fetch()
    } catch (err) {
      toast.error(toErrorMessage(err, t('errors.deleteFailed')))
    } finally {
      setMutating(false)
    }
  }

  const columns: ColumnDef<AgentConfigFile>[] = useMemo(() => [
    {
      key: 'recordName',
      label: t('columns.recordName'),
      defaultWidth: { kind: 'percent', value: 20 },
      defaultOverflow: 'ellipsis',
      accessor: (row) => row.record_name,
    },
    {
      key: 'agentType',
      label: t('columns.agentType'),
      defaultWidth: { kind: 'pixel', value: 160 },
      accessor: (row) => row.agent_type,
    },
    {
      key: 'mode',
      label: t('columns.mode'),
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_value, row) => {
        const isLocal = (row as { mode?: string }).mode === 'local'
        return isLocal ? (
          <Badge variant="outline">{t('badge.local')}</Badge>
        ) : (
          <Badge variant="default">SSH</Badge>
        )
      },
    },
    {
      key: 'path',
      label: t('columns.path'),
      defaultWidth: { kind: 'percent', value: 30 },
      defaultOverflow: 'wrap',
      accessor: (row) => row.path,
    },
    {
      key: 'updatedAt',
      label: t('columns.updatedAt'),
      defaultWidth: { kind: 'pixel', value: 180 },
      slot: {
        line1: (row) => formatDate(row.updated_at),
        line2: (row) => formatTime(row.updated_at),
      },
    },
    {
      key: 'actions',
      label: t('columns.actions'),
      defaultWidth: { kind: 'pixel', value: 320 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={mutating} onClick={() => setEditing(row)}>
            {t('actions.editConfigFile')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={mutating}
            onClick={() => setManagingModels(row)}
          >
            {t('actions.manageModels')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={mutating}
            title={t('actions.editRecord')}
            onClick={() => setEditingRecord(row)}
          >
            <AppIcon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={mutating}
            title={t('common:action.delete')}
            onClick={() => setConfirmDelete(row)}
          >
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ], [mutating, t])

  return (
    <>
      <DataTable
        id="agent-config-files"
        columns={columns}
        data={files}
        total={total}
        loading={loading}
        error={error}
        offset={offset}
        limit={limit}
        onOffsetChange={setOffset}
        onLimitChange={setLimit}
        emptyText={t('empty.files')}
        onRetry={() => void fetch()}
        actions={
          <Button variant="outline" size="sm" onClick={() => setTakeoverOpen(true)}>
            <AppIcon name="add" data-icon="inline-start" />
            {t('takeover.add')}
          </Button>
        }
      />

      <AgentConfigFormDialog
        open={takeoverOpen}
        onOpenChange={setTakeoverOpen}
        onCreated={() => void fetch()}
      />

      {editing && (
        <AgentConfigEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          record={editing}
          onRestored={() => void fetch()}
        />
      )}

      {editingRecord && (
        <AgentConfigFormDialog
          record={editingRecord}
          open
          onOpenChange={(open) => {
            if (!open) setEditingRecord(null)
          }}
          onSaved={() => void fetch()}
        />
      )}

      <ConfirmDeleteDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title={t('confirmDelete.title')}
        description={t('confirmDelete.description', { name: confirmDelete?.record_name ?? '' })}
        busy={mutating}
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete)
        }}
      />

      <AgentModelsDialog
        open={managingModels !== null}
        onOpenChange={(open) => {
          if (!open) setManagingModels(null)
        }}
        record={managingModels}
        fetchModels={(id) => dashboardApi.getAgentConfigFileModels(id)}
      />
    </>
  )
}

// ── 接管新的配置文件 ──

function AgentConfigFormDialog({
  open,
  onOpenChange,
  onCreated,
  onSaved,
  record,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
  onSaved?: () => void
  record?: AgentConfigFile
}) {
  const { t } = useTranslation('agentConfig')
  const [recordName, setRecordName] = useState('')
  const [mode, setMode] = useState<'local' | 'ssh'>('local')
  const [agentType, setAgentType] = useState('')
  const [targetOs, setTargetOs] = useState<AgentTargetOs>('other')
  const [presetSyncSuggested, setPresetSyncSuggested] = useState(false)
  const [path, setPath] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [authType, setAuthType] = useState<'password' | 'key'>('password')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [jumpEnabled, setJumpEnabled] = useState(false)
  const [jumpHost, setJumpHost] = useState('')
  const [jumpPort, setJumpPort] = useState('22')
  const [jumpUsername, setJumpUsername] = useState('')
  const [jumpAuthType, setJumpAuthType] = useState<'password' | 'key'>('password')
  const [jumpPassword, setJumpPassword] = useState('')
  const [jumpPrivateKey, setJumpPrivateKey] = useState('')
  const [rules, setRules] = useState<readonly AgentTypeRule[]>([])
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Path detection state (本机模式 only).
  const [detecting, setDetecting] = useState(false)
  const [checkResult, setCheckResult] = useState<AgentPathCheckResult | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  // SSH capability probe state (connect/read/write).
  const [sshTesting, setSshTesting] = useState(false)
  const [sshTestResult, setSshTestResult] = useState<
    | { readonly connect: AgentSshProbeResult; readonly read: AgentSshProbeResult; readonly write: AgentSshProbeResult }
    | null
  >(null)

  useEffect(() => {
    if (!open) return
    const ssh = record?.ssh_config
    setRecordName(record?.record_name ?? '')
    setMode(record?.mode ?? 'local')
    setAgentType(record?.agent_type ?? '')
    setTargetOs(record?.target_os ?? 'other')
    setPresetSyncSuggested(false)
    setPath(record?.path ?? '')
    setHost(ssh?.host ?? '')
    setPort(String(ssh?.port ?? 22))
    setUsername(ssh?.username ?? '')
    setAuthType(ssh?.auth_type ?? 'password')
    setPassword('')
    setPrivateKey('')
    setJumpEnabled(ssh?.jump_enabled ?? false)
    setJumpHost(ssh?.jump_host ?? '')
    setJumpPort(String(ssh?.jump_port ?? 22))
    setJumpUsername(ssh?.jump_username ?? '')
    setJumpAuthType(ssh?.jump_auth_type ?? 'password')
    setJumpPassword('')
    setJumpPrivateKey('')
    setError(null)
    setSaving(false)
    setDetecting(false)
    setCheckResult(null)
    setPreviewOpen(false)
    setSshTesting(false)
    setSshTestResult(null)
    let cancelled = false
    setLoadingTypes(true)
    setRules([])
    dashboardApi
      .listAgentTypeRules()
      .then((result) => {
        if (!cancelled) setRules(result.rules)
      })
      .catch((err) => {
        if (!cancelled) setError(toErrorMessage(err, t('errors.fetchTypesFailed')))
      })
      .finally(() => {
        if (!cancelled) setLoadingTypes(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, record, t])

  const ruleForType = useMemo(
    () => rules.find((rule) => rule.name === agentType) ?? null,
    [rules, agentType]
  )

  const handleAgentTypeChange = (value: string) => {
    setAgentType(value)
    setCheckResult(null)
  }

  const handleTargetOsChange = (value: AgentTargetOs) => {
    setTargetOs(value)
    setCheckResult(null)
    setPresetSyncSuggested(value !== 'other')
  }

  // Clear SSH-only state when switching modes so the local tab doesn't
  // inherit leftover probe results from an SSH attempt.
  useEffect(() => {
    if (mode !== 'ssh') {
      setSshTestResult(null)
      setSshTesting(false)
    }
    if (mode !== 'local') {
      setCheckResult(null)
      setDetecting(false)
    }
  }, [mode])

  // Manually pull the preset path template into the path field. Nothing is
  // autofilled; the user decides when to sync from the rule. Works for both
  // local and SSH modes — the SSH path field is the only thing that uses
  // the preset, the rest of the SSH fields stay separate.
  //
  // The button stays clickable for every OS the user picked; missing
  // software-type or missing template is reported as a toast so the user
  // knows exactly why nothing happened. The "other" OS is hidden entirely
  // (canSyncPreset).
  const syncPresetPath = () => {
    if (targetOs === 'other') return
    if (!ruleForType) {
      toast.error(t('toast.selectAgentTypeFirst'))
      return
    }
    const preset = ruleForType.os_paths
    const template = targetOs === 'windows' ? preset.windows : preset.mac
    if (template.trim() === '') {
      toast.error(t('toast.noDefaultPath', { type: ruleForType.name, os: TARGET_OS_LABELS[targetOs] }))
      return
    }
    setCheckResult(null)
    setPath(template.trim())
    setPresetSyncSuggested(false)
  }

  const canSyncPreset = targetOs !== 'other'

  const runPathCheck = useCallback(async () => {
    const trimmed = path.trim()
    if (mode !== 'local' || trimmed === '') {
      setDetecting(false)
      setCheckResult(null)
      return
    }
    setDetecting(true)
    try {
      setCheckResult(await dashboardApi.checkAgentConfigPath(trimmed))
    } catch {
      setCheckResult(null)
    } finally {
      setDetecting(false)
    }
  }, [mode, path])

  // Debounced path existence check, local mode only. If the user edited the
  // autofilled path it still triggers a normal check.
  useEffect(() => {
    if (!open || mode !== 'local') {
      setDetecting(false)
      setCheckResult(null)
      return
    }
    const trimmed = path.trim()
    if (trimmed === '') {
      setDetecting(false)
      setCheckResult(null)
      return
    }
    const timer = setTimeout(() => {
      void runPathCheck()
    }, 400)
    return () => {
      clearTimeout(timer)
      setDetecting(false)
    }
  }, [open, mode, path, runPathCheck])

  const handleSave = async () => {
    if (saving) return
    const trimmedName = recordName.trim()
    const trimmedPath = path.trim()
    if (!trimmedName) {
      setError(t('validation.recordNameRequired'))
      return
    }
    if (!agentType) {
      setError(t('validation.agentTypeRequired'))
      return
    }
    if (!trimmedPath) {
      setError(mode === 'local' ? t('validation.localPathRequired') : t('validation.remotePathRequired'))
      return
    }
    let sshConfig: AgentSshConfig | null = null
    if (mode === 'ssh') {
      if (!host.trim()) {
        setError(t('validation.hostRequired'))
        return
      }
      const portNum = Number(port)
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        setError(t('validation.portRange'))
        return
      }
      if (!username.trim()) {
        setError(t('validation.usernameRequired'))
        return
      }
      if (!record && authType === 'password' && password === '') {
        setError(t('validation.passwordRequired'))
        return
      }
      if (!record && authType === 'key' && privateKey.trim() === '') {
        setError(t('validation.privateKeyRequired'))
        return
      }
      if (jumpEnabled) {
        if (!jumpHost.trim()) {
          setError(t('validation.jumpHostRequired'))
          return
        }
        const jumpPortNum = Number(jumpPort)
        if (!Number.isInteger(jumpPortNum) || jumpPortNum < 1 || jumpPortNum > 65535) {
          setError(t('validation.jumpPortRange'))
          return
        }
        if (!jumpUsername.trim()) {
          setError(t('validation.jumpUsernameRequired'))
          return
        }
        if (!record && jumpAuthType === 'password' && jumpPassword === '') {
          setError(t('validation.jumpPasswordRequired'))
          return
        }
        if (!record && jumpAuthType === 'key' && jumpPrivateKey.trim() === '') {
          setError(t('validation.jumpPrivateKeyRequired'))
          return
        }
      }
      sshConfig = {
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        auth_type: authType,
        password: authType === 'password' && password !== '' ? password : undefined,
        private_key: authType === 'key' && privateKey.trim() !== '' ? privateKey.trim() : undefined,
        jump_enabled: jumpEnabled,
        jump_host: jumpEnabled ? jumpHost.trim() : undefined,
        jump_port: jumpEnabled ? Number(jumpPort) : undefined,
        jump_username: jumpEnabled ? jumpUsername.trim() : undefined,
        jump_auth_type: jumpEnabled ? jumpAuthType : undefined,
        jump_password: jumpEnabled && jumpAuthType === 'password' && jumpPassword !== '' ? jumpPassword : undefined,
        jump_private_key: jumpEnabled && jumpAuthType === 'key' && jumpPrivateKey.trim() !== '' ? jumpPrivateKey.trim() : undefined,
      }
    }
    setSaving(true)
    setError(null)
    try {
      const input = {
        record_name: trimmedName,
        agent_type: agentType,
        mode,
        target_os: targetOs === 'other' ? null : targetOs,
        path: trimmedPath,
        ssh_config: sshConfig,
      }
      if (record) {
        await dashboardApi.updateAgentConfigFile(record.id, input)
      } else {
        await dashboardApi.createAgentConfigFile(input)
      }
      toast(record ? t('toast.updatedRecord') : t('toast.takenOver'))
      onOpenChange(false)
      if (record) onSaved?.()
      else onCreated?.()
    } catch (err) {
      setError(toErrorMessage(err, record ? t('errors.updateFailed') : t('errors.takeoverFailed')))
    } finally {
      setSaving(false)
    }
  }

  // Build an unsaved AgentSshConfig from the current form state and a
  // short Chinese validation message if anything is missing. Returning a
  // partial cfg alongside the message keeps callers simple — they just
  // look at error first.
  const buildSshConfigForProbe = useCallback((): { readonly cfg: AgentSshConfig; readonly error: string | null } => {
    if (!host.trim()) return { cfg: blankSshConfig(), error: t('validation.hostRequired') }
    const portNum = Number(port)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return { cfg: blankSshConfig(), error: t('validation.portRange') }
    }
    if (!username.trim()) return { cfg: blankSshConfig(), error: t('validation.usernameRequired') }
    if (authType === 'password' && password === '') {
      return { cfg: blankSshConfig(), error: t('validation.passwordRequired') }
    }
    if (authType === 'key' && privateKey.trim() === '') {
      return { cfg: blankSshConfig(), error: t('validation.privateKeyRequired') }
    }
    if (jumpEnabled) {
      if (!jumpHost.trim()) return { cfg: blankSshConfig(), error: t('validation.jumpHostRequired') }
      const jumpPortNum = Number(jumpPort)
      if (!Number.isInteger(jumpPortNum) || jumpPortNum < 1 || jumpPortNum > 65535) {
        return { cfg: blankSshConfig(), error: t('validation.jumpPortRange') }
      }
      if (!jumpUsername.trim()) return { cfg: blankSshConfig(), error: t('validation.jumpUsernameRequired') }
      if (jumpAuthType === 'password' && jumpPassword === '') {
        return { cfg: blankSshConfig(), error: t('validation.jumpPasswordRequired') }
      }
      if (jumpAuthType === 'key' && jumpPrivateKey.trim() === '') {
        return { cfg: blankSshConfig(), error: t('validation.jumpPrivateKeyRequired') }
      }
    }
    return {
      cfg: {
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        auth_type: authType,
        password: authType === 'password' ? password : undefined,
        private_key: authType === 'key' ? privateKey.trim() : undefined,
        jump_enabled: jumpEnabled,
        jump_host: jumpEnabled ? jumpHost.trim() : undefined,
        jump_port: jumpEnabled ? Number(jumpPort) : undefined,
        jump_username: jumpEnabled ? jumpUsername.trim() : undefined,
        jump_auth_type: jumpEnabled ? jumpAuthType : undefined,
        jump_password: jumpEnabled && jumpAuthType === 'password' ? jumpPassword : undefined,
        jump_private_key: jumpEnabled && jumpAuthType === 'key' ? jumpPrivateKey.trim() : undefined,
      },
      error: null,
    }
  }, [host, port, username, authType, password, privateKey, jumpEnabled, jumpHost, jumpPort, jumpUsername, jumpAuthType, jumpPassword, jumpPrivateKey, t])

  const runSshTest = useCallback(async () => {
    const { cfg, error } = buildSshConfigForProbe()
    if (error) {
      const failed: AgentSshProbeResult = { ok: false, error }
      setSshTestResult({ connect: failed, read: failed, write: failed })
      return
    }
    setSshTesting(true)
    setSshTestResult(null)
    try {
      const result = await dashboardApi.testAgentSshConnection({
        ssh_config: cfg,
        path: path.trim(),
        target_os: targetOs,
      })
      setSshTestResult(result)
    } catch (err) {
      const failed: AgentSshProbeResult = { ok: false, error: toErrorMessage(err, t('errors.testFailed')) }
      setSshTestResult({ connect: failed, read: failed, write: failed })
    } finally {
      setSshTesting(false)
    }
  }, [buildSshConfigForProbe, path, targetOs, t])

  // Shared "目标系统 + 同步预设Agent信息" row. Rendered immediately above
  // the path field in both local and SSH modes so the operator can sync a
  // preset as soon as they pick the target OS. The sync button is hidden
  // for the "other" OS since the presets only cover windows / mac.
  //
  // In SSH mode the target OS also drives which probe commands the backend
  // runs ("cat" / mktemp for POSIX, "type" / %TEMP% for Windows), so the
  // hint highlights the choice so the operator doesn't leave it on "other".
  const targetOsField = (
    <Field>
      <FieldLabel>{t('form.osLabel')}</FieldLabel>
      <div className="flex items-center gap-2">
        {(Object.keys(TARGET_OS_LABELS) as AgentTargetOs[]).map((os) => (
          <Button
            key={os}
            type="button"
            variant={targetOs === os ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleTargetOsChange(os)}
          >
            {TARGET_OS_LABELS[os]}
          </Button>
        ))}
        {canSyncPreset && (
          <>
            <span aria-hidden className="mx-2 h-8 w-px shrink-0 bg-border" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={presetSyncSuggested ? '!border-primary !text-primary' : undefined}
              onClick={syncPresetPath}
            >
              {t('form.syncPresetButton')}
            </Button>
          </>
        )}
      </div>
      {mode === 'ssh' && targetOs === 'other' && (
        <p className="text-xs text-warning">{t('form.osWarning')}</p>
      )}
      {(targetOs === 'windows' || targetOs === 'mac') && (
        <p className="text-xs text-muted-foreground">
          {t('form.syncPresetHint', { os: TARGET_OS_LABELS[targetOs] })}
        </p>
      )}
    </Field>
  )

  // When all three SSH probes (connect/read/write) succeed, the operator
  // gets one more action: open the remote file in the existing preview
  // dialog. It stays hidden until then so an unreadable remote host can't
  // be probed via "preview".
  const sshAllOk =
    sshTestResult !== null &&
    sshTestResult.connect.ok &&
    sshTestResult.read.ok &&
    sshTestResult.write.ok

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="md" scrollFooter>
        <DialogHeader>
          <DialogTitle>{record ? t('form.titleEdit') : t('form.titleCreate')}</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? t('form.saving') : record ? t('form.saveEdit') : t('common:action.save')}
            </Button>
          </>
        }>
          <FieldGroup>
          <Field>
            <FieldLabel>{t('form.recordNameLabel')}</FieldLabel>
            <Input value={recordName} onChange={(e) => setRecordName(e.target.value)} placeholder={t('form.recordNamePlaceholder')} />
          </Field>

          <Field>
            <FieldLabel>{t('form.agentTypeLabel')}</FieldLabel>
            <Select value={agentType} onValueChange={handleAgentTypeChange} disabled={loadingTypes}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={loadingTypes ? t('common:state.loading') : t('form.agentTypePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {rules.map((rule) => (
                    <SelectItem key={rule.id} value={rule.name}>{rule.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {!loadingTypes && rules.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('form.noAgentTypes')}</p>
            )}
          </Field>

          <Field>
            <FieldLabel>{t('form.modeLabel')}</FieldLabel>
            <div className="flex items-center gap-2">
              <Button type="button" variant={mode === 'local' ? 'default' : 'outline'} size="sm" onClick={() => setMode('local')}>
                {t('form.modeLocal')}
              </Button>
              <Button type="button" variant={mode === 'ssh' ? 'default' : 'outline'} size="sm" onClick={() => setMode('ssh')}>
                SSH
              </Button>
            </div>
          </Field>

          {mode === 'local' && (
            <>
              {targetOsField}
              <Field>
                <FieldLabel>{t('form.pathLabel')}</FieldLabel>
                <div className="flex gap-2">
                  <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/xxx.json" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={path.trim() === '' || detecting}
                    onClick={() => void runPathCheck()}
                  >
                    {detecting ? <AppIcon name="progress_activity" size={14} className="animate-spin" /> : t('form.detectPath')}
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {detecting ? (
                    <>
                      <AppIcon name="progress_activity" size={14} className="animate-spin" />
                      <span className="text-muted-foreground">{t('form.detectingFile')}</span>
                    </>
                  ) : checkResult ? (
                    <PathCheckHint result={checkResult} targetOs={targetOs} onPreview={() => setPreviewOpen(true)} />
                  ) : (
                    <span className="text-muted-foreground">{t('form.pathAutoCheckHint')}</span>
                  )}
                </div>
              </Field>
            </>
          )}

          {mode === 'ssh' && (
            <>
              <Field>
                <FieldLabel>{t('form.hostLabel')}</FieldLabel>
                <div className="flex gap-2">
                  <Input className="flex-1" value={host} onChange={(e) => setHost(e.target.value)} placeholder={t('form.hostPlaceholder')} />
                  <Input className="w-24" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} placeholder={t('form.portPlaceholder')} />
                </div>
              </Field>
              <Field>
                <FieldLabel>{t('form.userAuthLabel')}</FieldLabel>
                <div className="flex gap-2">
                  <Input className="flex-1" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('form.usernamePlaceholder')} />
                  <Select value={authType} onValueChange={(v) => setAuthType(v as 'password' | 'key')}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="password">{t('form.authPassword')}</SelectItem>
                        <SelectItem value="key">{t('form.authKey')}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </Field>
              {authType === 'password' ? (
                <Field>
                  <FieldLabel>{t('form.passwordLabel')}</FieldLabel>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={record ? t('form.passwordUnchangedPlaceholder') : t('form.sshPasswordPlaceholder')} />
                </Field>
              ) : (
                <Field>
                  <FieldLabel>{t('form.privateKeyLabel')}</FieldLabel>
                  <Textarea value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} rows={6} placeholder={record ? t('form.passwordUnchangedPlaceholder') : '-----BEGIN OPENSSH PRIVATE KEY-----'} />
                </Field>
              )}

              <div className="flex items-center gap-2">
                <Switch checked={jumpEnabled} onCheckedChange={setJumpEnabled} />
                <span className="text-sm font-medium">{t('form.jumpMode')}</span>
              </div>

              {jumpEnabled && (
                <>
                  <Field>
                    <FieldLabel>{t('form.jumpHostLabel')}</FieldLabel>
                    <div className="flex gap-2">
                      <Input className="flex-1" value={jumpHost} onChange={(e) => setJumpHost(e.target.value)} placeholder={t('form.hostPlaceholder')} />
                      <Input className="w-24" type="number" min={1} max={65535} value={jumpPort} onChange={(e) => setJumpPort(e.target.value)} placeholder={t('form.portPlaceholder')} />
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel>{t('form.jumpUserAuthLabel')}</FieldLabel>
                    <div className="flex gap-2">
                      <Input className="flex-1" value={jumpUsername} onChange={(e) => setJumpUsername(e.target.value)} placeholder={t('form.usernamePlaceholder')} />
                      <Select value={jumpAuthType} onValueChange={(v) => setJumpAuthType(v as 'password' | 'key')}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="password">{t('form.authPassword')}</SelectItem>
                            <SelectItem value="key">{t('form.authKey')}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </Field>
                  {jumpAuthType === 'password' ? (
                    <Field>
                      <FieldLabel>{t('form.jumpPasswordLabel')}</FieldLabel>
                      <Input type="password" value={jumpPassword} onChange={(e) => setJumpPassword(e.target.value)} placeholder={record ? t('form.passwordUnchangedPlaceholder') : t('form.jumpSshPasswordPlaceholder')} />
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel>{t('form.jumpPrivateKeyLabel')}</FieldLabel>
                      <Textarea value={jumpPrivateKey} onChange={(e) => setJumpPrivateKey(e.target.value)} rows={6} placeholder={record ? t('form.passwordUnchangedPlaceholder') : '-----BEGIN OPENSSH PRIVATE KEY-----'} />
                    </Field>
                  )}
                </>
              )}

              {targetOsField}

              <Field>
                <FieldLabel>{t('form.remotePathLabel')}</FieldLabel>
                <div className="flex gap-2">
                  <Input className="flex-1" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/xxx.json" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sshTesting || targetOs === 'other'}
                    title={targetOs === 'other' ? t('form.sshTestTitle') : undefined}
                    onClick={() => void runSshTest()}
                  >
                    {sshTesting ? <AppIcon name="progress_activity" size={14} className="animate-spin" /> : t('form.sshTestButton')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('form.sshJsonOnlyHint')}</p>
                {sshTestResult && <SshTestResultPanel result={sshTestResult} />}
                {sshAllOk && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="!border-primary !text-primary w-fit"
                    onClick={() => setPreviewOpen(true)}
                  >
                    {t('actions.previewRemoteFile')}
                  </Button>
                )}
              </Field>
            </>
          )}

          {error && (
            <div className="rounded-xs border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">{error}</div>
            </div>
          )}
        </FieldGroup>
        </DialogScrollBody>
      </DialogContent>

      {previewOpen && (
        <DialogCodeEditor
          mode="preview"
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={recordName.trim()}
          subtitle={path.trim()}
          loadContent={() => {
            const trimmed = path.trim()
            if (mode === 'ssh') {
              const { cfg, error } = buildSshConfigForProbe()
              if (error) return Promise.reject(new Error(error))
              return dashboardApi.readAgentConfigRemotePath(cfg, trimmed, targetOs)
            }
            return dashboardApi.readAgentConfigPath(trimmed)
          }}
        />
      )}
    </Dialog>
  )
}

// ── 删除确认 ──

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  busy?: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation('agentConfig')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm" scrollFooter>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="destructive" onClick={onConfirm} disabled={busy}>
              {busy ? t('confirmDelete.busy') : t('confirmDelete.confirm')}
            </Button>
          </>
        } />
      </DialogContent>
    </Dialog>
  )
}
