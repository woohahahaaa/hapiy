import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'

const LOG_OPTIONS = ['请求体', '响应体', 'Headers', '延迟', 'Token消耗', '状态码']

interface DebugNodeData {
  label?: string
  enabled?: boolean
  selected?: string[]
  filePath?: string
  sourceIds?: string[]
}

interface DebugNodeProps {
  data: DebugNodeData
  id: string
}

export function DebugNode({ data, id }: DebugNodeProps) {
  const { label = '调试', sourceIds = [] } = data
  const [enabled, setEnabled] = useState(data.enabled !== false)
  const [selected, setSelected] = useState(data.selected || [])
  const [filePath, setFilePath] = useState(data.filePath || '')
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

  function toggleOption(opt: string) {
    setSelected((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
    )
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
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          className="scale-75"
        />
      </div>

      {/* Body */}
      <div className="p-3">
        {enabled ? (
          <>
            <div className="mb-2 text-[10px] text-muted-foreground">记录字段：</div>
            <div className="mb-3 flex flex-wrap gap-1">
              {LOG_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => toggleOption(opt)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                    selected.includes(opt)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
            <div className="mb-1 text-[10px] text-muted-foreground">存储路径：</div>
            <input
              className="w-full rounded border border-input bg-background px-2 py-1 text-[10px] font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="/var/log/hapiy/"
            />
          </>
        ) : (
          <div className="text-xs text-muted-foreground italic">已关闭</div>
        )}
      </div>
    </div>
  )
}
