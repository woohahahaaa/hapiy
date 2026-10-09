import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('topology')
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
        title={t('colors.title')}
        aria-label={t('colors.title')}
      >
        <AppIcon name="palette" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('colors.title')}</DialogTitle>
            <DialogDescription>
              {t('colors.description')}
            </DialogDescription>
          </DialogHeader>
          {colors.length === 0 && (
            <div className="mb-1 text-xs">{t('colors.empty')}</div>
          )}
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {colors.map((c, i) => (
              <div key={`${i}-${c}`} className="flex items-center gap-2 rounded-none px-1.5 py-1 hover:bg-muted">
                <span className="size-3.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: c }} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-card-foreground">{c}</span>
                <button
                  type="button"
                  className="hover:text-destructive"
                  onClick={() => remove(i)}
                  aria-label={t('colors.removeAria')}
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
              placeholder={t('colors.placeholder')}
              className="min-w-0 flex-1 rounded-none border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-ring"
            />
            <Button variant="outline" size="sm" onClick={add}>
              {t('colors.add')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
