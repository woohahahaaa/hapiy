import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { JsonHighlight } from '@/components/JsonHighlight'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { toast } from '@/components/ui/toast'
import {
  dashboardApi,
  DashboardApiError,
  type AgentConfigFile,
  type AgentPathCheckResult,
  type AgentOsPaths,
  type AgentSshConfig,
  type AgentTypeRule,
} from '@/lib/dashboard-api'
import { AgentConfigEditorDialog } from '@/components/AgentConfigEditorDialog'

// ── Agent 接管 ──

export type AgentTargetOs = 'windows' | 'mac' | 'custom'

export const TARGET_OS_LABELS: Record<AgentTargetOs, string> = {
  windows: 'Windows',
  mac: 'Mac',
  custom: '自定义',
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
  const osMismatch =
    (targetOs === 'windows' && current_os !== 'windows') ||
    (targetOs === 'mac' && current_os !== 'darwin')

  if (!exists) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-destructive">
        <span className="truncate">
          文件不存在（已检查：{expandedPath}）
          {osMismatch && ` · 目标系统 ${TARGET_OS_LABELS[targetOs]}，当前系统 ${osNameFromCode(current_os)}，路径可能不适用`}
        </span>
      </span>
    )
  }

  if (size === 0) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-warning">
        <span className="truncate">文件存在，大小 0（{expandedPath}）</span>
        <Button type="button" variant="outline" size="sm" onClick={onPreview}>预览</Button>
      </span>
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-2 text-green-600">
      <span className="truncate">文件存在，大小 {formatFileSize(size)}（{expandedPath}）</span>
      <Button type="button" variant="outline" size="sm" onClick={onPreview}>预览</Button>
    </span>
  )
}

const TAB_TRIGGER_CLASS =
  '-mb-px !h-[50px] flex-none !border-x-0 !border-t-0 !border-b-2 border-transparent px-0 text-sm font-medium after:hidden data-[state=active]:!border-primary data-[state=active]:!text-primary'

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
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="配置文件" />
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        <Tabs defaultValue="config" className="flex min-h-0 flex-1 flex-col">
          <TabsList variant="line" className="-mb-px !h-[50px] w-full justify-start gap-6 border-b border-border p-0">
            <TabsTrigger value="config" className={TAB_TRIGGER_CLASS}>接管配置文件</TabsTrigger>
            <TabsTrigger value="rules" className={TAB_TRIGGER_CLASS}>管理规则</TabsTrigger>
          </TabsList>
          <TabsContent value="config" className="flex min-h-0 flex-1 flex-col">
            <AgentConfigFilesTab />
          </TabsContent>
          <TabsContent value="rules" className="flex min-h-0 flex-1 flex-col">
            <AgentTypeRulesTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

// ── Tab 1: 接管配置文件 ──

function AgentConfigFilesTab() {
  const [files, setFiles] = useState<readonly AgentConfigFile[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [takeoverOpen, setTakeoverOpen] = useState(false)
  const [previewing, setPreviewing] = useState<AgentConfigFile | null>(null)
  const [editing, setEditing] = useState<AgentConfigFile | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AgentConfigFile | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listAgentConfigFiles({ limit, offset })
      setFiles(result.files)
      setTotal(result.total)
    } catch (err) {
      setError(toErrorMessage(err, '加载失败'))
    } finally {
      setLoading(false)
    }
  }, [limit, offset])

  useEffect(() => {
    void fetch()
  }, [fetch])

  const handleDelete = async (row: AgentConfigFile) => {
    setMutating(true)
    setConfirmDelete(null)
    try {
      await dashboardApi.deleteAgentConfigFile(row.id)
      toast('已删除')
      void fetch()
    } catch (err) {
      toast.error(toErrorMessage(err, '删除失败'))
    } finally {
      setMutating(false)
    }
  }

  const columns: ColumnDef<AgentConfigFile>[] = useMemo(() => [
    {
      key: 'recordName',
      label: '记录名称',
      defaultWidth: { kind: 'percent', value: 20 },
      defaultOverflow: 'ellipsis',
      accessor: (row) => row.record_name,
    },
    {
      key: 'agentType',
      label: '软件类型',
      defaultWidth: { kind: 'pixel', value: 160 },
      accessor: (row) => row.agent_type,
    },
    {
      key: 'mode',
      label: '模式',
      defaultWidth: { kind: 'pixel', value: 100 },
      accessor: (row) => (row.mode === 'local' ? '本机' : '非本机'),
    },
    {
      key: 'path',
      label: '路径',
      defaultWidth: { kind: 'percent', value: 30 },
      defaultOverflow: 'wrap',
      accessor: (row) => row.path,
    },
    {
      key: 'updatedAt',
      label: '更新时间',
      defaultWidth: { kind: 'pixel', value: 180 },
      slot: {
        line1: (row) => formatDate(row.updated_at),
        line2: (row) => formatTime(row.updated_at),
      },
    },
    {
      key: 'actions',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 100 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={mutating}
            title="预览文件"
            onClick={() => setPreviewing(row)}
          >
            <AppIcon name="open_in_new" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={mutating}
            title="编辑文件"
            onClick={() => setEditing(row)}
          >
            <AppIcon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={mutating}
            title="删除"
            onClick={() => setConfirmDelete(row)}
          >
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ], [mutating])

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
        emptyText="暂无接管配置，点击「接管新的配置文件」添加"
        onRetry={() => void fetch()}
        actions={
          <Button variant="outline" size="sm" onClick={() => setTakeoverOpen(true)}>
            <AppIcon name="add" data-icon="inline-start" />
            接管新的配置文件
          </Button>
        }
      />

      <TakeoverDialog
        open={takeoverOpen}
        onOpenChange={setTakeoverOpen}
        onCreated={() => void fetch()}
      />

      {previewing && (
        <ConfigFilePreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setPreviewing(null)
          }}
          title={previewing.record_name}
          subtitle={previewing.path}
          load={() => dashboardApi.getAgentConfigFileContent(previewing.id)}
        />
      )}

      {editing && (
        <AgentConfigEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          record={editing}
        />
      )}

      <ConfirmDeleteDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title="确认删除"
        description={`将删除接管配置「${confirmDelete?.record_name ?? ''}」，删除后不可恢复。`}
        busy={mutating}
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete)
        }}
      />
    </>
  )
}

// ── Tab 2: 管理规则 ──

function AgentTypeRulesTab() {
  const [rules, setRules] = useState<readonly AgentTypeRule[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [addOpen, setAddOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AgentTypeRule | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AgentTypeRule | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listAgentTypeRules()
      setRules(result.rules)
      setTotal(result.total)
    } catch (err) {
      setError(toErrorMessage(err, '加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetch()
  }, [fetch])

  const handleDelete = async (row: AgentTypeRule) => {
    setMutating(true)
    setConfirmDelete(null)
    try {
      await dashboardApi.deleteAgentTypeRule(row.id)
      toast('已删除')
      void fetch()
    } catch (err) {
      toast.error(toErrorMessage(err, '删除失败'))
    } finally {
      setMutating(false)
    }
  }

  const columns: ColumnDef<AgentTypeRule>[] = useMemo(() => [
    {
      key: 'name',
      label: '名称',
      defaultWidth: { kind: 'percent', value: 50 },
      accessor: (row) => row.name,
    },
    {
      key: 'createdAt',
      label: '创建时间',
      defaultWidth: { kind: 'pixel', value: 180 },
      slot: {
        line1: (row) => formatDate(row.created_at),
        line2: (row) => formatTime(row.created_at),
      },
    },
    {
      key: 'actions',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 90 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={mutating}
            title="编辑"
            onClick={() => setEditingRule(row)}
          >
            <AppIcon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={mutating}
            title="删除"
            onClick={() => setConfirmDelete(row)}
          >
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ], [mutating])

  return (
    <>
      <DataTable
        id="agent-type-rules"
        columns={columns}
        data={rules}
        total={total}
        loading={loading}
        error={error}
        offset={offset}
        limit={limit}
        onOffsetChange={setOffset}
        onLimitChange={setLimit}
        emptyText="暂无规则，点击「添加规则」创建第一条"
        onRetry={() => void fetch()}
        actions={
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <AppIcon name="add" data-icon="inline-start" />
            添加规则
          </Button>
        }
      />

      <RuleDialog
        open={addOpen || editingRule !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false)
            setEditingRule(null)
          }
        }}
        onCreated={() => void fetch()}
        editing={editingRule}
      />

      <ConfirmDeleteDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title="确认删除"
        description={`将删除规则「${confirmDelete?.name ?? ''}」，删除后不可恢复。`}
        busy={mutating}
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete)
        }}
      />
    </>
  )
}

// ── 接管新的配置文件 ──

function TakeoverDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [recordName, setRecordName] = useState('')
  const [mode, setMode] = useState<'local' | 'ssh'>('local')
  const [agentType, setAgentType] = useState('')
  const [targetOs, setTargetOs] = useState<AgentTargetOs>('custom')
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

  useEffect(() => {
    if (!open) return
    setRecordName('')
    setMode('local')
    setAgentType('')
    setTargetOs('custom')
    setPath('')
    setHost('')
    setPort('22')
    setUsername('')
    setAuthType('password')
    setPassword('')
    setPrivateKey('')
    setJumpEnabled(false)
    setJumpHost('')
    setJumpPort('22')
    setJumpUsername('')
    setJumpAuthType('password')
    setJumpPassword('')
    setJumpPrivateKey('')
    setError(null)
    setSaving(false)
    setDetecting(false)
    setCheckResult(null)
    setPreviewOpen(false)
    let cancelled = false
    setLoadingTypes(true)
    setRules([])
    dashboardApi
      .listAgentTypeRules()
      .then((result) => {
        if (!cancelled) setRules(result.rules)
      })
      .catch((err) => {
        if (!cancelled) setError(toErrorMessage(err, '获取软件类型失败'))
      })
      .finally(() => {
        if (!cancelled) setLoadingTypes(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

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
  }

  // Manually pull the preset path template into the path field. Nothing is
  // autofilled; the user decides when to sync from the rule.
  const syncPresetPath = () => {
    setCheckResult(null)
    const preset = ruleForType?.os_paths
    if (mode !== 'local' || targetOs === 'custom' || !preset) return
    const template = targetOs === 'windows' ? preset.windows : preset.mac
    if (template.trim() === '') return
    setPath(template.trim())
  }

  const canSyncPreset =
    mode === 'local' && targetOs !== 'custom' &&
    ruleForType != null &&
    osPathFor(ruleForType.os_paths, targetOs === 'windows' ? 'windows' : 'mac') !== ''

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
    setDetecting(true)
    const timer = setTimeout(() => {
      dashboardApi
        .checkAgentConfigPath(trimmed)
        .then((result) => {
          setCheckResult(result)
        })
        .catch(() => {
          setCheckResult(null)
        })
        .finally(() => {
          setDetecting(false)
        })
    }, 400)
    return () => {
      clearTimeout(timer)
      setDetecting(false)
    }
  }, [open, mode, path])

  const handleSave = async () => {
    if (saving) return
    const trimmedName = recordName.trim()
    const trimmedPath = path.trim()
    if (!trimmedName) {
      setError('请填写记录名称')
      return
    }
    if (!agentType) {
      setError('请选择软件类型')
      return
    }
    if (!trimmedPath) {
      setError(mode === 'local' ? '请填写本机路径' : '请填写远程路径')
      return
    }
    let sshConfig: AgentSshConfig | null = null
    if (mode === 'ssh') {
      if (!host.trim()) {
        setError('请填写主机地址')
        return
      }
      const portNum = Number(port)
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        setError('端口必须是 1-65535 之间的整数')
        return
      }
      if (!username.trim()) {
        setError('请填写用户名')
        return
      }
      if (authType === 'password' && password === '') {
        setError('请填写密码')
        return
      }
      if (authType === 'key' && privateKey.trim() === '') {
        setError('请填写私钥内容')
        return
      }
      if (jumpEnabled) {
        if (!jumpHost.trim()) {
          setError('请填写跳板机主机地址')
          return
        }
        const jumpPortNum = Number(jumpPort)
        if (!Number.isInteger(jumpPortNum) || jumpPortNum < 1 || jumpPortNum > 65535) {
          setError('跳板机端口必须是 1-65535 之间的整数')
          return
        }
        if (!jumpUsername.trim()) {
          setError('请填写跳板机用户名')
          return
        }
        if (jumpAuthType === 'password' && jumpPassword === '') {
          setError('请填写跳板机密码')
          return
        }
        if (jumpAuthType === 'key' && jumpPrivateKey.trim() === '') {
          setError('请填写跳板机私钥内容')
          return
        }
      }
      sshConfig = {
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
      }
    }
    setSaving(true)
    setError(null)
    try {
      await dashboardApi.createAgentConfigFile({
        record_name: trimmedName,
        agent_type: agentType,
        mode,
        path: trimmedPath,
        ssh_config: sshConfig,
      })
      toast('已接管配置')
      onOpenChange(false)
      onCreated()
    } catch (err) {
      setError(toErrorMessage(err, '接管失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="md">
        <DialogHeader>
          <DialogTitle>接管新的配置文件</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>记录名称</FieldLabel>
            <Input value={recordName} onChange={(e) => setRecordName(e.target.value)} placeholder="例如：OpenCode 配置" />
          </Field>

          <Field>
            <FieldLabel>软件类型</FieldLabel>
            <Select value={agentType} onValueChange={handleAgentTypeChange} disabled={loadingTypes}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={loadingTypes ? '加载中…' : '选择软件类型'} />
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
              <p className="text-xs text-muted-foreground">暂无可用软件类型，请先在「管理规则」中添加</p>
            )}
          </Field>

          <Field>
            <FieldLabel>本机/非本机</FieldLabel>
            <div className="flex items-center gap-2">
              <Button type="button" variant={mode === 'local' ? 'default' : 'outline'} size="sm" onClick={() => setMode('local')}>
                本机
              </Button>
              <Button type="button" variant={mode === 'ssh' ? 'default' : 'outline'} size="sm" onClick={() => setMode('ssh')}>
                非本机
              </Button>
            </div>
          </Field>

          {mode === 'local' && (
            <>
              <Field>
                <FieldLabel>系统</FieldLabel>
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={!canSyncPreset}
                    onClick={syncPresetPath}
                  >
                    从预设列同步信息
                  </Button>
                </div>
                {(targetOs === 'windows' || targetOs === 'mac') && (
                  <p className="text-xs text-muted-foreground">
                    点击「从预设列同步信息」可将 {TARGET_OS_LABELS[targetOs]} 默认路径填入下方
                  </p>
                )}
              </Field>

              <Field>
                <FieldLabel>路径</FieldLabel>
                <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/xxx.json" />
                <div className="flex items-center gap-2 text-xs">
                  {detecting ? (
                    <>
                      <AppIcon name="progress_activity" size={14} className="animate-spin" />
                      <span className="text-muted-foreground">正在检测文件…</span>
                    </>
                  ) : checkResult ? (
                    <PathCheckHint result={checkResult} targetOs={targetOs} onPreview={() => setPreviewOpen(true)} />
                  ) : (
                    <span className="text-muted-foreground">输入路径后自动检测文件是否存在</span>
                  )}
                </div>
              </Field>
            </>
          )}

          {mode === 'ssh' && (
            <>
              <Field>
                <FieldLabel>主机</FieldLabel>
                <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="例如：192.168.1.100" />
              </Field>
              <Field>
                <FieldLabel>端口</FieldLabel>
                <Input type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} placeholder="22" />
              </Field>
              <Field>
                <FieldLabel>用户名</FieldLabel>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="例如：root" />
              </Field>
              <Field>
                <FieldLabel>认证方式</FieldLabel>
                <Select value={authType} onValueChange={(v) => setAuthType(v as 'password' | 'key')}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="password">密码</SelectItem>
                      <SelectItem value="key">私钥</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {authType === 'password' ? (
                <Field>
                  <FieldLabel>密码</FieldLabel>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="SSH 密码" />
                </Field>
              ) : (
                <Field>
                  <FieldLabel>私钥内容</FieldLabel>
                  <Textarea value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} rows={6} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                </Field>
              )}

              <Field orientation="horizontal" className="items-center justify-between rounded-md border border-border px-3 py-2">
                <FieldLabel>跳板模式</FieldLabel>
                <div className="flex items-center gap-1.5">
                  <span className={jumpEnabled ? 'text-sm font-medium' : 'text-sm text-muted-foreground'}>{jumpEnabled ? '已开启' : '已关闭'}</span>
                  <Switch checked={jumpEnabled} onCheckedChange={setJumpEnabled} />
                </div>
              </Field>
              {jumpEnabled && (
                <>
                  <Field>
                    <FieldLabel>跳板机主机</FieldLabel>
                    <Input value={jumpHost} onChange={(e) => setJumpHost(e.target.value)} placeholder="例如：192.168.1.100" />
                  </Field>
                  <Field>
                    <FieldLabel>跳板机端口</FieldLabel>
                    <Input type="number" min={1} max={65535} value={jumpPort} onChange={(e) => setJumpPort(e.target.value)} placeholder="22" />
                  </Field>
                  <Field>
                    <FieldLabel>跳板机用户名</FieldLabel>
                    <Input value={jumpUsername} onChange={(e) => setJumpUsername(e.target.value)} placeholder="例如：root" />
                  </Field>
                  <Field>
                    <FieldLabel>跳板机认证方式</FieldLabel>
                    <Select value={jumpAuthType} onValueChange={(v) => setJumpAuthType(v as 'password' | 'key')}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="password">密码</SelectItem>
                          <SelectItem value="key">私钥</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  {jumpAuthType === 'password' ? (
                    <Field>
                      <FieldLabel>跳板机密码</FieldLabel>
                      <Input type="password" value={jumpPassword} onChange={(e) => setJumpPassword(e.target.value)} placeholder="跳板机 SSH 密码" />
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel>跳板机私钥内容</FieldLabel>
                      <Textarea value={jumpPrivateKey} onChange={(e) => setJumpPrivateKey(e.target.value)} rows={6} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                    </Field>
                  )}
                </>
              )}

              <Field>
                <FieldLabel>远程路径</FieldLabel>
                <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/xxx.json" />
                <p className="text-xs text-muted-foreground">仅支持 .json 文件</p>
              </Field>
            </>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">{error}</div>
            </div>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {previewOpen && (
        <ConfigFilePreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={recordName.trim()}
          subtitle={path.trim()}
          load={() => dashboardApi.readAgentConfigPath(path.trim())}
          onSave={async () => {
            await dashboardApi.createAgentConfigFile({
              record_name: recordName.trim(),
              agent_type: agentType,
              mode: 'local' as const,
              path: path.trim(),
              ssh_config: null,
            })
            toast('已接管配置')
            onOpenChange(false)
            onCreated()
          }}
        />
      )}
    </Dialog>
  )
}

// ── 文件预览（只读，始终读取磁盘最新版本）──

function ConfigFilePreviewDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  load,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle: string
  load: () => Promise<string>
  onSave?: () => Promise<void>
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Always re-read the live file when the preview opens so the user sees
  // the current disk version, not any stale/edited copy.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setContent(null)
    setLoading(true)
    setFetchError(null)
    setSaveError(null)
    load()
      .then((text) => {
        if (!cancelled) setContent(text)
      })
      .catch((err) => {
        if (!cancelled) setFetchError(toErrorMessage(err, '读取失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // load is captured per open; it is recreated by callers with fresh closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSave = async () => {
    if (saving || !onSave) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave()
    } catch (err) {
      setSaveError(toErrorMessage(err, '保存失败'))
      setSaving(false)
      return
    }
    setSaving(false)
  }

  const busy = loading || saving

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onOpenChange(false)
      }}
    >
      <DialogContent
        width="full"
        height="full"
        bare className="flex flex-col overflow-hidden"
      >
        <DialogHeader className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-6 py-4">
          <DialogTitle className="text-base">预览 — {title}</DialogTitle>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {subtitle}
          </span>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
          {fetchError && (
            <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                {fetchError}
              </div>
            </div>
          )}
          {saveError && (
            <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                {saveError}
              </div>
            </div>
          )}
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              正在加载文件内容…
            </div>
          ) : (
            content !== null && (
              <JsonHighlight
                value={content}
                className="min-h-0 flex-1"
              />
            )
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            关闭
          </Button>
          {onSave && (
            <Button onClick={() => void handleSave()} disabled={busy}>
              {saving ? '保存中...' : '保存'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── 添加 / 编辑规则 ──

function RuleDialog({
  open,
  onOpenChange,
  onCreated,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
  editing: AgentTypeRule | null
}) {
  const [name, setName] = useState('')
  const [windowsPath, setWindowsPath] = useState('')
  const [macPath, setMacPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setWindowsPath(editing?.os_paths.windows ?? '')
      setMacPath(editing?.os_paths.mac ?? '')
      setError(null)
      setSaving(false)
    }
  }, [open, editing])

  const handleSave = async () => {
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请填写名称')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await dashboardApi.updateAgentTypeRule(editing.id, {
          name: trimmed,
          windows: windowsPath.trim(),
          mac: macPath.trim(),
        })
      } else {
        await dashboardApi.createAgentTypeRule(trimmed)
      }
      toast(editing ? '已更新' : '已添加')
      onOpenChange(false)
      onCreated()
    } catch (err) {
      setError(toErrorMessage(err, editing ? '更新失败' : '添加失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>名称</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：opencode" />
          </Field>
          <Field>
            <FieldLabel>Windows 默认路径</FieldLabel>
            <Input
              value={windowsPath}
              onChange={(e) => setWindowsPath(e.target.value)}
              placeholder="例如：%USERPROFILE%\.config\opencode\opencode.json"
            />
            <p className="text-xs text-muted-foreground">支持 %APPDATA%、%USERPROFILE% 等环境变量</p>
          </Field>
          <Field>
            <FieldLabel>Mac 默认路径</FieldLabel>
            <Input
              value={macPath}
              onChange={(e) => setMacPath(e.target.value)}
              placeholder="例如：~/.config/opencode/opencode.json"
            />
            <p className="text-xs text-muted-foreground">支持 ~ 和 $HOME</p>
          </Field>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">{error}</div>
            </div>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={() => void handleSave()} disabled={saving || name.trim() === ''}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── 删除确认 ──

function ConfirmDeleteDialog({
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? '删除中...' : '确认删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
