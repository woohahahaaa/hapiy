import { useTranslation, type TFunction } from 'react-i18next'
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
    <div className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{index + 1}</span>
          <Input
            className="h-7 min-w-0 flex-1 font-mono text-xs"
            value={action.path}
            onChange={(e) => onChange({ ...action, path: e.target.value })}
            placeholder="gjson 路径"
          />
          <Select
            value={typedMode}
            onValueChange={(v) => onChange({ ...action, mode: v as ModeName })}
          >
            <SelectTrigger className="h-7 w-[180px] shrink-0" size="sm">
              <SelectValue placeholder="选择操作" />
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
              placeholder={valuePlaceholder(typedMode)}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="nodrag nopan mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={`删除执行 ${index + 1}`}
      >
        <AppIcon name="close" size={14} />
      </button>
    </div>
  )
}

function valuePlaceholder(mode: ModeName | ''): string {
  switch (mode) {
    case 'move': return '新字段路径（如 messages.0.text）'
    case 'first_prepend': return '要加的前缀（如 \n<think>）'
    case 'last_append': return '要加的后缀（如 \n</think>）'
    default: return 'value'
  }
}
