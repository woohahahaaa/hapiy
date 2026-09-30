import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { ResponseActionRow } from './ResponseActionRow'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConditionList } from '../rewrite-rule-editor/ConditionList'
import { emptyAction, emptyCondition, type Block } from './serializer'
import { cn } from '@/lib/utils'

function ruleNumber(id: string, fallback: number): number {
  const m = /^rule-(\d+)$/.exec(id)
  return m ? Number(m[1]) : fallback + 1
}

interface ResponseBlockCardProps {
  index: number
  block: Block
  onChange: (next: Block) => void
  onRemove: () => void
  canRemove: boolean
  onDragStart?: () => void
  onDragOver?: () => void
  onDrop?: () => void
  isDragging?: boolean
  isDragOver?: boolean
}

export function ResponseBlockCard({
  index,
  block,
  onChange,
  onRemove,
  canRemove,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging = false,
  isDragOver = false,
}: ResponseBlockCardProps) {
  const { t } = useTranslation('rewrite')
  const updateAction = (i: number, next: Block['actions'][number]) => {
    onChange({
      ...block,
      actions: block.actions.map((a, ai) => (ai === i ? next : a)),
    })
  }
  const removeAction = (i: number) => {
    const next = block.actions.filter((_, ai) => ai !== i)
    onChange({ ...block, actions: next.length === 0 ? [emptyAction()] : next })
  }
  const addAction = () => {
    onChange({ ...block, actions: [...block.actions, emptyAction()] })
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onDragOver) return
    e.preventDefault()
    e.stopPropagation()
    onDragOver()
  }
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onDrop) return
    e.preventDefault()
    e.stopPropagation()
    onDrop()
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'rounded-xs border border-border bg-card transition-colors',
        isDragging && 'opacity-40',
        isDragOver && 'border-primary border-dashed',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-2 py-1.5">
        <div className="flex items-center gap-2">
          {onDragStart && (
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(index))
                onDragStart()
              }}
              className="nodrag nopan flex h-6 w-6 cursor-grab items-center justify-center rounded-xs text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
              aria-label={t('drag.sortLabel')}
              title={t('drag.sortTitle')}
            >
              <AppIcon name="drag_handle" size={16} />
            </button>
          )}
          <span className="text-xs font-medium text-foreground">{t('rule.number', { name: ruleNumber(block.id, index) })}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('rule.actions', { count: block.actions.length })}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="nodrag nopan flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={t('rule.deleteLabel')}
          title={t('rule.deleteTitle')}
        >
          <AppIcon name="delete" size={14} />
        </button>
      </div>

      <div className="space-y-3 p-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center rounded-xs bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              {t('section.conditions')}
            </span>
            <div className="flex items-center gap-1.5">
              <Select
                value={block.conditionLogic ?? 'AND'}
                onValueChange={(v) => onChange({ ...block, conditionLogic: v as 'AND' | 'OR' })}
              >
                <SelectTrigger className="h-6 w-[140px]" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="AND">{t('logic.and')}</SelectItem>
                    <SelectItem value="OR">{t('logic.or')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => onChange({ ...block, conditions: [...(block.conditions ?? []), emptyCondition()] })}
                className="nodrag nopan inline-flex h-6 items-center gap-1 rounded-xs border border-border bg-background px-1.5 text-xs text-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-700"
                aria-label={t('section.addCondition')}
                title={t('section.addCondition')}
              >
                <AppIcon name="add" size={12} />
                {t('section.addCondition')}
              </button>
            </div>
          </div>
          {!block.conditions || block.conditions.length === 0 ? (
            <div className="rounded-xs border border-dashed border-amber-500/30 bg-amber-500/5 px-3 py-2 text-center text-xs text-muted-foreground">
              {t('section.noConditions')}
            </div>
          ) : (
            <ConditionList
              conditions={block.conditions}
              onChange={(conditions) => onChange({ ...block, conditions })}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center rounded-xs bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
              {t('section.actions')}
            </span>
            <button
              type="button"
              onClick={addAction}
              className="nodrag nopan inline-flex h-6 items-center gap-1 rounded-xs border border-border bg-background px-1.5 text-xs text-foreground transition-colors hover:bg-sky-500/10 hover:text-sky-700"
              aria-label={t('section.addAction')}
              title={t('section.addAction')}
            >
              <AppIcon name="add" size={12} />
              {t('section.addAction')}
            </button>
          </div>
          {block.actions.length === 0 ? (
            <div className="rounded-xs border border-dashed border-sky-500/30 bg-sky-500/5 px-3 py-2 text-center text-xs text-muted-foreground">
              {t('section.atLeastOneAction')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {block.actions.map((a, i) => (
                <ResponseActionRow
                  key={i}
                  index={i}
                  action={a}
                  onChange={(next) => updateAction(i, next)}
                  onRemove={() => removeAction(i)}
                  canRemove={block.actions.length > 1}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}