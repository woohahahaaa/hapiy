import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AppIcon } from '@/components/AppIcon'
import { MODES, MODE_BY_VALUE, type ModeName } from './modes'
import type { Action } from './serializer'

interface ResponseActionRowProps {
  index: number
  action: Action
  onChange: (next: Action) => void
  onRemove: () => void
  canRemove: boolean
}

const FIELDS_LEFT_OFFSET = 'pl-[24px]'

export function ResponseActionRow({ index, action, onChange, onRemove, canRemove }: ResponseActionRowProps) {
  const { t } = useTranslation('rewrite')
  const spec = action.mode && MODE_BY_VALUE.has(action.mode as ModeName)
    ? MODE_BY_VALUE.get(action.mode as ModeName)!
    : null
  const typedMode = (spec ? action.mode : '') as ModeName | ''
  // delete 不需要字段：操作符跟在路径后面，只有 move / 前后缀才落第二排。
  const fields = spec?.needs ?? []

  return (
    <div className="flex items-start gap-2 rounded-none border border-border bg-background px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{index + 1}</span>
          <Input
            className="h-7 min-w-0 flex-1 font-mono text-xs"
            value={action.path}
            onChange={(e) => onChange({ ...action, path: e.target.value })}
            placeholder={t('path.gjsonPlaceholder')}
          />
          <Select
            value={typedMode}
            onValueChange={(v) => onChange({ ...action, mode: v as ModeName })}
          >
            <SelectTrigger className="h-7 w-[180px] shrink-0" size="sm">
              <SelectValue placeholder={t('selectModePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {fields.length > 0 && (
          <div className={`flex items-center gap-2 ${FIELDS_LEFT_OFFSET}`}>
            <Input
              className="h-7 min-w-0 flex-1 font-mono text-xs"
              value={action.value}
              onChange={(e) => onChange({ ...action, value: e.target.value })}
              placeholder={valuePlaceholder(t, typedMode)}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="nodrag nopan mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={t('section.deleteAction', { count: index + 1 })}
      >
        <AppIcon name="close" size={14} />
      </button>
    </div>
  )
}

function valuePlaceholder(t: TFunction, mode: ModeName | ''): string {
  switch (mode) {
    case 'move': return t('respValue.movePlaceholder')
    case 'first_prepend': return t('respValue.firstPrependPlaceholder')
    case 'last_append': return t('respValue.lastAppendPlaceholder')
    default: return 'value'
  }
}
