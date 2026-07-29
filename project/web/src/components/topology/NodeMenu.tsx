import type { ReactNode } from 'react'
import { ScrollText, Wand2, Plus, FileEdit } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SlotTypeForMenu =
  | 'requestModify'
  | 'responseModify'
  | 'autoReply'
  | 'concurrency'
  | 'autoSwitch'
  | 'logOutput'

interface NodeMenuProps {
  x: number
  y: number
  onSelect: (slotType: SlotTypeForMenu) => void
  onClose: () => void
}

interface MenuItem {
  slotType: SlotTypeForMenu
  label: string
  icon: ReactNode
}

interface MenuCategory {
  title: string
  items: MenuItem[]
}

const CATEGORIES: MenuCategory[] = [
  {
    title: '请求处理',
    items: [
      { slotType: 'requestModify', label: '请求改写', icon: <FileEdit className="size-4" /> },
    ],
  },
  {
    title: '响应处理',
    items: [
      { slotType: 'responseModify', label: '响应改写', icon: <FileEdit className="size-4" /> },
    ],
  },
  {
    title: '流程控制',
    items: [
      { slotType: 'autoReply', label: '心跳回复', icon: <Wand2 className="size-4" /> },
      { slotType: 'concurrency', label: '并发控制', icon: <ScrollText className="size-4" /> },
      { slotType: 'autoSwitch', label: '故障转移', icon: <Wand2 className="size-4" /> },
    ],
  },
  {
    title: '监控',
    items: [
      { slotType: 'logOutput', label: '日志输出', icon: <Plus className="size-4" /> },
    ],
  },
]

export function NodeMenu({ x, y, onSelect, onClose }: NodeMenuProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'fixed z-50 w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg',
          'p-2 max-h-80 overflow-y-auto',
        )}
        style={{ left: x, top: y }}
        role="menu"
      >
        {CATEGORIES.map((cat) => (
          <div key={cat.title} className="mb-1">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {cat.title}
            </div>
            {cat.items.map((item) => (
              <button
                key={item.slotType}
                type="button"
                onClick={() => onSelect(item.slotType)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted hover:text-foreground transition-colors"
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
