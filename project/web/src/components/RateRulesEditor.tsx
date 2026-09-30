import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { PriceRule } from '@/lib/dashboard-api'
import { computeRuleHits } from '@/lib/model-rule'

export type RateRulesEditorProps = {
  readonly rate: readonly PriceRule[]
  readonly onChange: (rate: readonly PriceRule[]) => void
  readonly providerNames: readonly string[]
}

export function RateRulesEditor({ rate, onChange, providerNames }: RateRulesEditorProps) {
  const { t } = useTranslation('provider')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const hits = useMemo(
    () => rate.map((_, index) => computeRuleHits(rate, providerNames, index)),
    [rate, providerNames],
  )

  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = [...rate]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  const clearDrag = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t('rateRules.hint')}</p>

      {rate.length === 0 && (
        <p className="border border-dashed border-border-subtle px-3 py-4 text-center text-xs text-muted-foreground">
          {t('rateRules.empty')}
        </p>
      )}

      {rate.map((rule, index) => {
        const hit = hits[index]
        const patternEmpty = rule.pattern.trim() === ''
        return (
          <div
            key={index}
            data-rule-row
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (overIndex !== index) setOverIndex(index)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIndex !== null) reorder(dragIndex, index)
              clearDrag()
            }}
            className={cn(
              'flex flex-col gap-1.5 border border-border bg-card p-2 transition-colors',
              dragIndex === index && 'opacity-50',
              overIndex === index && dragIndex !== null && dragIndex !== index && 'border-ring bg-muted/40',
            )}
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                draggable
                variant="ghost"
                size="icon"
                tabIndex={-1}
                aria-label={t('rateRules.dragAria')}
                onDragStart={(e) => {
                  const row = e.currentTarget.closest('[data-rule-row]')
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(index))
                  if (row) e.dataTransfer.setDragImage(row, 16, 16)
                  setDragIndex(index)
                }}
                onDragEnd={clearDrag}
                className="cursor-grab text-muted-foreground active:cursor-grabbing"
              >
                <AppIcon name="drag_handle" />
              </Button>
              <Input
                value={rule.pattern}
                onChange={(e) =>
                  onChange(
                    rate.map((r, i) => (i === index ? { ...r, pattern: e.target.value } : r)),
                  )
                }
                placeholder={t('rateRules.patternPlaceholder')}
              />
              <Input
                type="number"
                step={0.1}
                value={rule.multiplier}
                onChange={(e) =>
                  onChange(
                    rate.map((r, i) =>
                      i === index ? { ...r, multiplier: Number(e.target.value) } : r,
                    ),
                  )
                }
                placeholder={t('rateRules.multiplierPlaceholder')}
                className="w-20"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('rateRules.deleteAria')}
                onClick={() => onChange(rate.filter((_, i) => i !== index))}
                className="text-muted-foreground"
              >
                <AppIcon name="close" />
              </Button>
            </div>

            <div className="flex flex-col gap-0.5 pl-8">
              {patternEmpty ? (
                <p className="text-xs text-muted-foreground">{t('rateRules.fillHint')}</p>
              ) : (
                <>
                  <p className="text-xs text-green-600">{t('rateRules.hit', { count: hit.n })}</p>
                  {hit.m > 0 && (
                    <p className="text-xs text-amber-600">{t('rateRules.hitBlocked', { n: hit.n, m: hit.m })}</p>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}

      <div className="mt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...rate, { pattern: '', multiplier: 1 }])}
        >
          <AppIcon name="add" data-icon="inline-start" />
          {t('rateRules.add')}
        </Button>
      </div>
    </div>
  )
}
