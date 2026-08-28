import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppIcon } from '@/components/AppIcon'
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
  type AgentSshConfig,
  type AgentTypeRule,
} from '@/lib/dashboard-api'
import { AgentConfigEditorDialog } from '@/components/AgentConfigEditorDialog'

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

      <AddRuleDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => void fetch()}
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
  const [agentTypes, setAgentTypes] = useState<readonly string[]>([])
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRecordName('')
    setMode('local')
    setAgentType('')
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
    let cancelled = false
    setLoadingTypes(true)
    setAgentTypes([])
    dashboardApi
      .listAgentTypes()
      .then((types) => {
        if (!cancelled) setAgentTypes(types)
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
    if (mode === 'local' && !trimmedPath.toLowerCase().endsWith('.json')) {
      setError('仅支持 .json 文件')
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
            <Select value={agentType} onValueChange={setAgentType} disabled={loadingTypes}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={loadingTypes ? '加载中…' : '选择软件类型'} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {agentTypes.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {!loadingTypes && agentTypes.length === 0 && (
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
            <Field>
              <FieldLabel>路径</FieldLabel>
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/xxx.json" />
              <p className="text-xs text-muted-foreground">仅支持 .json 文件</p>
            </Field>
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
    </Dialog>
  )
}

// ── 添加规则 ──

function AddRuleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setError(null)
      setSaving(false)
    }
  }, [open])

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
      await dashboardApi.createAgentTypeRule(trimmed)
      toast('已添加')
      onOpenChange(false)
      onCreated()
    } catch (err) {
      setError(toErrorMessage(err, '添加失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm">
        <DialogHeader>
          <DialogTitle>添加规则</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>名称</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：opencode" />
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
