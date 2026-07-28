import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef } from 'react'

interface AutoReplyNodeData {
  label?: string
  rules?: Array<{ name: string; window?: number; minTokens?: number }>
  count?: number
  channelIds?: string[]
}

interface AutoReplyNodeProps {
  data: AutoReplyNodeData
  id: string
}

export function AutoReplyNode({ data, id }: AutoReplyNodeProps) {
  const { label = '心跳回复', rules = [], count, channelIds = [] } = data
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(channelIds.length)

  useEffect(() => {
    if (channelIds.length !== lenRef.current) {
      lenRef.current = channelIds.length
      updateNodeInternals(id)
    }
  }, [id, channelIds, updateNodeInternals])

  // Calculate handle positions
  const n = channelIds.length
  const segH = 20
  const gap = -2
  const total = n * segH + (n - 1) * gap
  const start = -(total / 2)

  return (
    <div className="w-48 rounded-lg border bg-card shadow-sm">
      {/* Target handles */}
      {channelIds.map((ch, i) => (
        <Handle
          key={ch}
          type="target"
          position={Position.Left}
          id={ch}
          className="!w-3 !h-3 !rounded-full !border-2 !bg-background"
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
        className="!w-3 !h-3 !rounded-full !border-2 !bg-background"
      />

      {/* Header */}
      <div className="border-b px-3 py-2">
        <span className="text-sm font-medium">{label}</span>
      </div>

      {/* Body */}
      <div className="space-y-1 p-3">
        {rules.length > 0 ? (
          rules.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span>{r.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {r.window}s / {r.minTokens}tk
              </span>
            </div>
          ))
        ) : (
          <div className="text-xs text-muted-foreground">No rules</div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        {count ?? rules.length ?? 0} rules
      </div>
    </div>
  )
}
