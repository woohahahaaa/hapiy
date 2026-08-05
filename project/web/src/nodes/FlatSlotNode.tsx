import { Handle, Position } from '@xyflow/react'
import { useState } from 'react'
import { CheckSmall } from '@icon-park/react'
import { cn } from '@/lib/utils'
import { SlotContainer } from '@/components/topology/SlotContainer'
import { topologyConfig } from '@/config/topology-config'

export interface FlatProviderChild {
  readonly id: string
  readonly label: string
  readonly modelCount: number
  readonly enabled: boolean
  readonly providerStatus: boolean
}

interface FlatSlotNodeData {
  title: string
  slotType: string
  isProviderSlot?: boolean
  children?: readonly FlatProviderChild[]
  onAddProvider?: () => void
  onToggleProvider?: (providerId: string, enabled: boolean) => void
  onReorderProvider?: (fromIndex: number, toIndex: number) => void
}

interface FlatSlotNodeProps {
  data: FlatSlotNodeData
}

export function FlatSlotNode({ data }: FlatSlotNodeProps) {
  const { title, isProviderSlot, children = [], onAddProvider, onToggleProvider, onReorderProvider } = data

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const handleDrop = (entryIndex: number) => {
    if (dragIndex !== null && dragIndex !== entryIndex) {
      onReorderProvider?.(dragIndex, entryIndex)
    }
    setDragIndex(null)
    setOverIndex(null)
  }

  const handleAdd = () => {
    if (isProviderSlot) onAddProvider?.()
  }

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!rounded-full !border-border !bg-background"
        style={{
          width: topologyConfig.handles.slot.target.width,
          height: topologyConfig.handles.slot.target.height,
          borderWidth: topologyConfig.handles.slot.target.borderWidth,
        }}
      />
      <SlotContainer
        title={
          <span className="flex items-baseline gap-1">
            <span>{title}</span>
            <span className="text-[10px] text-muted-foreground/50">
              · {isProviderSlot ? '择一执行' : '全部执行'}
            </span>
          </span>
        }
        onAddNode={isProviderSlot ? handleAdd : undefined}
        style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
      >
        {children.map((child, i) => (
          <ProviderCard
            key={child.id}
            child={child}
            isDragging={dragIndex === i}
            isDragOver={overIndex === i && dragIndex !== null && dragIndex !== i}
            onDragStart={() => setDragIndex(i)}
            onDragOver={() => setOverIndex(i)}
            onDrop={() => handleDrop(i)}
            onToggle={(enabled) => onToggleProvider?.(child.id, enabled)}
          />
        ))}
      </SlotContainer>
      <Handle
        type="source"
        position={Position.Right}
        className="!rounded-full !border-border !bg-background"
        style={{
          width: topologyConfig.handles.slot.source.width,
          height: topologyConfig.handles.slot.source.height,
          borderWidth: topologyConfig.handles.slot.source.borderWidth,
        }}
      />
    </>
  )
}

interface ProviderCardProps {
  child: FlatProviderChild
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onToggle: (enabled: boolean) => void
}

function ProviderCard({ child, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onToggle }: ProviderCardProps) {
  const dim = !child.enabled || !child.providerStatus
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        onDragStart()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDrop()
      }}
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 transition-opacity',
        isDragging && 'opacity-40',
        isDragOver && 'ring-2 ring-primary',
        dim && 'opacity-50',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={child.enabled}
        aria-label={child.enabled ? `${child.label} 已启用，点击关闭` : `${child.label} 已停用，点击启用`}
        data-no-drag="true"
        onClick={(e) => {
          e.stopPropagation()
          onToggle(!child.enabled)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'nodrag nopan relative h-4 w-4 shrink-0 cursor-pointer touch-manipulation rounded-[3px] border-2 transition-colors',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring',
          child.enabled ? 'border-primary bg-primary' : 'border-border bg-muted',
        )}
      >
        {child.enabled && (
          <CheckSmall
            theme="filled"
            size={10}
            strokeWidth={4}
            className="absolute inset-0 h-full w-full text-background"
          />
        )}
      </button>
      <span className="min-w-0 flex-1 truncate text-sm">{child.label}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{child.modelCount} 模型</span>
    </div>
  )
}
