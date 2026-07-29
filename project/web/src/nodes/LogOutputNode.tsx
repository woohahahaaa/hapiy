import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'

interface LogOutputNodeData {
  label?: string
  sourceIds?: string[]
  enabled?: boolean
  logTarget?: 'file' | 'console' | 'both'
  logLevel?: 'info' | 'warn' | 'error'
  logPath?: string
  recordContent?: {
    requestBefore?: boolean
    requestAfter?: boolean
    responseBefore?: boolean
    responseAfter?: boolean
  }
  hasRequestRewrite?: boolean
  hasResponseRewrite?: boolean
}

interface LogOutputNodeProps {
  data: LogOutputNodeData
  id: string
}

const LOG_TARGET_OPTIONS: { value: 'file' | 'console' | 'both'; label: string }[] = [
  { value: 'file', label: '文件' },
  { value: 'console', label: '控制台' },
  { value: 'both', label: '两者' },
]

const LOG_LEVEL_OPTIONS: { value: 'info' | 'warn' | 'error'; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
]

interface RecordCheckboxDef {
  key: keyof NonNullable<LogOutputNodeData['recordContent']>
  label: string
  dependsOn?: 'hasRequestRewrite' | 'hasResponseRewrite'
  disabledTooltip?: string
}

const RECORD_CHECKBOXES: RecordCheckboxDef[] = [
  { key: 'requestBefore', label: '请求修改前' },
  {
    key: 'requestAfter',
    label: '请求修改后',
    dependsOn: 'hasRequestRewrite',
    disabledTooltip: '当前未添加请求改写节点',
  },
  { key: 'responseBefore', label: '响应修改前' },
  {
    key: 'responseAfter',
    label: '响应修改后',
    dependsOn: 'hasResponseRewrite',
    disabledTooltip: '当前未添加响应改写节点',
  },
]

export function LogOutputNode({ data, id }: LogOutputNodeProps) {
  const {
    label = '日志输出',
    sourceIds = [],
    enabled: initialEnabled = true,
    logTarget: initialLogTarget = 'file',
    logLevel: initialLogLevel = 'info',
    logPath: initialLogPath = '',
    recordContent: initialRecordContent = {
      requestBefore: true,
      requestAfter: true,
      responseBefore: true,
      responseAfter: true,
    },
    hasRequestRewrite = true,
    hasResponseRewrite = true,
  } = data

  const [enabled, setEnabled] = useState(initialEnabled)
  const [logTarget, setLogTarget] = useState<'file' | 'console' | 'both'>(initialLogTarget)
  const [logLevel, setLogLevel] = useState<'info' | 'warn' | 'error'>(initialLogLevel)
  const [logPath, setLogPath] = useState(initialLogPath)
  const [recordContent, setRecordContent] = useState(initialRecordContent)

  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(sourceIds.length)

  useEffect(() => {
    if (sourceIds.length !== lenRef.current) {
      lenRef.current = sourceIds.length
      updateNodeInternals(id)
    }
  }, [id, sourceIds, updateNodeInternals])

  // Calculate handle positions
  const n = sourceIds.length
  const segH = 20
  const gap = -2
  const total = n * segH + (n - 1) * gap
  const start = -(total / 2)

  const isCheckboxDisabled = (def: RecordCheckboxDef): boolean => {
    if (def.dependsOn === 'hasRequestRewrite') return !hasRequestRewrite
    if (def.dependsOn === 'hasResponseRewrite') return !hasResponseRewrite
    return false
  }

  const toggleRecord = (key: keyof NonNullable<LogOutputNodeData['recordContent']>) => {
    setRecordContent((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="w-52 rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      {/* Target handles */}
      {sourceIds.map((src, i) => (
        <Handle
          key={src}
          type="target"
          position={Position.Left}
          id={src}
          className="!size-3 !rounded-full !border-2 !border-border !bg-background"
          style={{
            top: `calc(50% + ${start + i * (segH + gap)}px)`,
            height: segH,
            transform: 'translate(-50%, 0)',
          }}
        />
      ))}

      {/* Source handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!size-3 !rounded-full !border-2 !border-border !bg-background"
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{label}</span>
        <Switch checked={enabled} onCheckedChange={setEnabled} className="scale-75" />
      </div>

      {/* Body */}
      <div className="p-3">
        {enabled ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              {/* Log Target */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">输出目标</span>
                <Select value={logTarget} onValueChange={(v) => setLogTarget(v as typeof logTarget)}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOG_TARGET_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Log Level */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">日志级别</span>
                <Select value={logLevel} onValueChange={(v) => setLogLevel(v as typeof logLevel)}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOG_LEVEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Log Path */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">存储路径</span>
              <Input
                className="h-7 rounded border border-input bg-background px-2 py-1 text-[10px] font-mono text-foreground"
                value={logPath}
                onChange={(e) => setLogPath(e.target.value)}
                placeholder="/var/log/hapiy/"
              />
            </div>

            {/* Record Content Checkboxes */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground">记录内容</span>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {RECORD_CHECKBOXES.map((def) => {
                  const disabled = isCheckboxDisabled(def)
                  return (
                    <label
                      key={def.key}
                      className={`flex items-center gap-1.5 ${
                        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                      }`}
                      title={disabled ? def.disabledTooltip : undefined}
                    >
                      <Checkbox
                        checked={recordContent[def.key] ?? false}
                        onCheckedChange={() => toggleRecord(def.key)}
                        disabled={disabled}
                      />
                      <span className="text-[10px] leading-none text-foreground">
                        {def.label}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">已关闭</div>
        )}
      </div>
    </div>
  )
}
