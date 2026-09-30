import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/checkbox'
import { AppIcon } from '@/components/AppIcon'
import { COND_OPS, SCOPE_OPTIONS } from './modes'
import type { LeafCondition } from './serializer'
import { ConventionValueInput } from './ConventionValueInput'

interface ConditionRowProps {
  index: number
  condition: LeafCondition
  onChange: (next: LeafCondition) => void
  onRemove: () => void
  canRemove: boolean
}

// 第二排字段左对齐 scope 触发器（pl-[24px]：index w-4 + gap-2）。
const FIELDS_LEFT_OFFSET = 'pl-[24px]'

export function ConditionRow({ index, condition, onChange, onRemove, canRemove }: ConditionRowProps) {
  const { t } = useTranslation('rewrite')
  return (
    <div className="flex items-start gap-2 rounded-xs border border-border bg-background px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{index + 1}</span>
          <Select
            value={condition.scope}
            onValueChange={(v) => onChange({ ...condition, scope: v as typeof condition.scope })}
          >
            <SelectTrigger className="h-7 w-[130px] shrink-0" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SCOPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            className="h-7 min-w-0 flex-1 font-mono text-xs"
            value={condition.path}
            onChange={(e) => onChange({ ...condition, path: e.target.value })}
            placeholder={condition.scope === 'header' ? t('path.headerPlaceholder') : t('path.gjsonPlaceholder')}
          />
          <Select
            value={condition.op}
            onValueChange={(v) => onChange({ ...condition, op: v })}
          >
            <SelectTrigger className="h-7 w-[130px] shrink-0" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {COND_OPS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className={`flex items-center gap-2 ${FIELDS_LEFT_OFFSET}`}>
          <ConventionValueInput
            text={condition.value}
            onChange={(value) => onChange({ ...condition, value })}
            placeholder="value"
            active
          />
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              className="size-[18px] bg-background !opacity-100"
              checked={condition.invert}
              onCheckedChange={(v) => onChange({ ...condition, invert: v === true })}
              aria-label={t('invert.ariaLabel')}
            />
            {t('invert.label')}
          </label>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="nodrag nopan mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={t('section.deleteCondition', { count: index + 1 })}
      >
        <AppIcon name="close" size={14} />
      </button>
    </div>
  )
}