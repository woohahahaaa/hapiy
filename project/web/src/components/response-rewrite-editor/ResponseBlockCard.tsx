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
        'rounded-md border border-border bg-card transition-colors',
        isDragging && 'opacity-40',
        isDragOver && 'border-primary border-dashed',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
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
              className="nodrag nopan flex h-6 w-6 cursor-grab items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
              aria-label="拖动排序"
              title="拖动调整顺序"
            >
              <AppIcon name="drag_handle" size={16} />
            </button>
          )}
          <span className="text-xs font-medium text-foreground">规则 {ruleNumber(block.id, index)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {block.actions.length} 执行
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="nodrag nopan flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="删除规则"
          title="删除规则"
        >
          <AppIcon name="delete" size={14} />
        </button>
      </div>

      <div className="space-y-3 p-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              条件
            </span>
            <div className="flex items-center gap-1.5">
              <Select
                value={block.conditionLogic ?? 'AND'}
                onValueChange={(v) => onChange({ ...block, conditionLogic: v as 'AND' | 'OR' })}
              >
                <SelectTrigger className="h-6 w-[84px]" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="AND">AND（都满足）</SelectItem>
                    <SelectItem value="OR">OR（任一满足）</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => onChange({ ...block, conditions: [...(block.conditions ?? []), emptyCondition()] })}
                className="nodrag nopan flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-700"
                aria-label="添加条件"
                title="添加条件"
              >
                <AppIcon name="add" size={14} />
              </button>
            </div>
          </div>
          {!block.conditions || block.conditions.length === 0 ? (
            <div className="rounded border border-dashed border-amber-500/30 bg-amber-500/5 px-3 py-2 text-center text-xs text-muted-foreground">
              暂无条件，留空表示无条件执行
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
            <span className="inline-flex items-center rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
              执行（按顺序串行）
            </span>
            <button
              type="button"
              onClick={addAction}
              className="nodrag nopan flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sky-500/10 hover:text-sky-700"
              aria-label="添加执行"
              title="添加执行"
            >
              <AppIcon name="add" size={14} />
            </button>
          </div>
          {block.actions.length === 0 ? (
            <div className="rounded border border-dashed border-sky-500/30 bg-sky-500/5 px-3 py-2 text-center text-xs text-muted-foreground">
              至少需要一条执行
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