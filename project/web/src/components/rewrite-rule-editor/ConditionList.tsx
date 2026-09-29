import { useTranslation } from 'react-i18next'
import { ConditionRow } from './ConditionRow'
import {
  isConditionLeaf,
  type Condition,
} from './serializer'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AppIcon } from '@/components/AppIcon'

interface ConditionListProps {
  conditions: Condition[]
  onChange: (next: Condition[]) => void
}

// 递归条件列表：叶子渲染 ConditionRow，组合节点渲染一个 AND/OR 组卡片，
// 组内再次递归。组卡片可切换 logic、可删组；新增入口由外层（BlockCard 等）
// 的「添加条件」按钮承担，这里只负责渲染与编辑。
export function ConditionList({ conditions, onChange }: ConditionListProps) {
  const { t } = useTranslation('rewrite')
  const update = (i: number, next: Condition) => {
    onChange(conditions.map((c, ci) => (ci === i ? next : c)))
  }
  const remove = (i: number) => {
    onChange(conditions.filter((_, ci) => ci !== i))
  }

  return (
    <div className="space-y-1.5">
      {conditions.map((c, i) =>
        isConditionLeaf(c) ? (
          <ConditionRow
            key={i}
            index={i}
            condition={c}
            onChange={(next) => update(i, next)}
            onRemove={() => remove(i)}
            canRemove={conditions.length > 1}
          />
        ) : (
          <ConditionGroupCard
            key={i}
            group={c}
            onChange={(next) => update(i, next)}
            onRemove={() => remove(i)}
            canRemove={conditions.length > 1}
          />
        ),
      )}
    </div>
  )
}

interface ConditionGroupCardProps {
  group: Extract<Condition, { logic: string }>
  onChange: (next: Extract<Condition, { logic: string }>) => void
  onRemove: () => void
  canRemove: boolean
}

function ConditionGroupCard({ group, onChange, onRemove, canRemove }: ConditionGroupCardProps) {
  const { t } = useTranslation('rewrite')
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('group.label')}</span>
        <Select
          value={group.logic}
          onValueChange={(v) => onChange({ ...group, logic: v as 'AND' | 'OR' })}
        >
          <SelectTrigger className="h-7 w-[76px]" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="AND">AND</SelectItem>
              <SelectItem value="OR">OR</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground tabular-nums">{t('group.count', { count: group.children.length })}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="nodrag nopan ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={t('group.deleteLabel')}
          title={t('group.deleteTitle')}
        >
          <AppIcon name="close" size={14} />
        </button>
      </div>
      <ConditionList
        conditions={group.children}
        onChange={(children) => onChange({ ...group, children })}
      />
    </div>
  )
}
