import { cn } from '@/lib/utils'
import { REQUEST_REWRITE_SLOT_TYPES, type RewriteSlotType } from '@/lib/flat-topology'

const REWRITE_SLOT_LABELS: Record<RewriteSlotType, string> = {
  requestModify: '请求改写',
  responseModify: '响应改写',
  autoReply: '心跳回复',
  concurrency: '并发控制',
  autoSwitch: '故障转移',
  logOutput: '日志抓取',
}

interface FlatCanvasMenuProps {
  x: number
  y: number
  mode: 'corner' | 'cursor'
  onAddFullWorkflow: () => void
  onAddEntry: () => void
  onAddProviderSlot: () => void
  onAddSlot: (slotType: RewriteSlotType) => void
  onClose: () => void
}

export function FlatCanvasMenu({
  x,
  y,
  mode,
  onAddFullWorkflow,
  onAddEntry,
  onAddProviderSlot,
  onAddSlot,
  onClose,
}: FlatCanvasMenuProps) {
  const positionStyle = mode === 'corner' ? { right: x, bottom: y } : { left: x, top: y }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-transparent"
        onMouseDown={(e) => {
          if (e.button === 0) onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
        aria-hidden="true"
      />
      <div
        className={cn(
          'fixed z-50 w-56 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg',
        )}
        style={positionStyle}
        role="menu"
      >
        <button
          type="button"
          onClick={() => {
            onAddFullWorkflow()
            onClose()
          }}
          className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          <span>添加完整工作流</span>
        </button>
        <div className="mt-1 border-t border-border" />
        <button
          type="button"
          onClick={() => {
            onAddEntry()
            onClose()
          }}
          className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          <span>添加请求入口</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onAddProviderSlot()
            onClose()
          }}
          className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          <span>添加 provider 插槽</span>
        </button>
        {REQUEST_REWRITE_SLOT_TYPES.map((slotType) => (
          <button
            key={slotType}
            type="button"
            onClick={() => {
              onAddSlot(slotType)
              onClose()
            }}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            <span>添加 {REWRITE_SLOT_LABELS[slotType]} 插槽</span>
          </button>
        ))}
      </div>
    </>
  )
}
