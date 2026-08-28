import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AppIcon } from '@/components/AppIcon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'

type FlowColorsPanelProps = {
  readonly colors: readonly string[]
  readonly onChange: (colors: string[]) => void
}

/**
 * Bottom-right toolbar button that opens the model-node colour palette dialog.
 * Colours are assigned to model nodes round-robin; each model lamp and its
 * light beam use the assigned colour. With an empty table the theme colour is
 * used. Changes persist through the caller (backend setting).
 */
export function FlowColorsPanel({ colors, onChange }: FlowColorsPanelProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const add = () => {
    const tokens = draft.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return
    const existing = new Set(colors)
    const valid = tokens
      .filter((t) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(t))
      .filter((t) => !existing.has(t))
    if (valid.length === 0) return
    onChange([...colors, ...valid])
    setDraft('')
  }

  const remove = (index: number) => {
    onChange(colors.filter((_, i) => i !== index))
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
        title="模型节点色值"
        aria-label="模型节点色值"
      >
        <AppIcon name="palette" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>模型节点色值</DialogTitle>
            <DialogDescription>
              为模型节点分配流光颜色，按顺序循环使用；未配置时使用主题色
            </DialogDescription>
          </DialogHeader>
          {colors.length === 0 && (
            <div className="mb-1 text-xs">未配置，使用主题色</div>
          )}
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {colors.map((c, i) => (
              <div key={`${i}-${c}`} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted">
                <span className="size-3.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: c }} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-card-foreground">{c}</span>
                <button
                  type="button"
                  className="hover:text-destructive"
                  onClick={() => remove(i)}
                  aria-label="删除色值"
                >
                  <AppIcon name="close" className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add()
              }}
              placeholder="HEX 色值，空格分隔多个，如 #4ade80 #38bdf8"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-ring"
            />
            <Button variant="outline" size="sm" onClick={add}>
              添加
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
