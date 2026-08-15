import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AppIcon } from '@/components/AppIcon'
import { MODES, MODE_BY_VALUE, SCOPE_OPTIONS, type ModeName } from './modes'
import type { Action } from './serializer'

interface ActionRowProps {
  index: number
  action: Action
  onChange: (next: Action) => void
  onRemove: () => void
  canRemove: boolean
}

// 第二排字段左对齐 scope 触发器（pl-[24px]：index w-4 + gap-2）。
const FIELDS_LEFT_OFFSET = 'pl-[24px]'

export function ActionRow({ index, action, onChange, onRemove, canRemove }: ActionRowProps) {
  const spec = action.mode && MODE_BY_VALUE.has(action.mode as ModeName)
    ? MODE_BY_VALUE.get(action.mode as ModeName)!
    : null

  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{index + 1}</span>
          <Select
            value={action.scope}
            onValueChange={(v) => onChange({ ...action, scope: v as typeof action.scope })}
          >
            <SelectTrigger className="h-7 w-[112px] shrink-0" size="sm">
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
            value={action.path}
            onChange={(e) => onChange({ ...action, path: e.target.value })}
            placeholder="gjson 路径"
          />
        </div>
        {spec && (
          <div className={`flex items-center gap-2 ${FIELDS_LEFT_OFFSET}`}>
            <Select
              value={action.mode}
              onValueChange={(v) => onChange({ ...action, mode: v as ModeName })}
            >
              <SelectTrigger className="h-7 w-[180px] shrink-0" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {spec.needs.length > 0 && spec.needs.map((field) => (
              <Input
                key={field}
                className="h-7 min-w-0 flex-1 font-mono text-xs"
                value={action[field]}
                onChange={(e) => onChange({ ...action, [field]: e.target.value } as Action)}
                placeholder={fieldPlaceholder(field)}
              />
            ))}
          </div>
        )}
        {!spec && (
          <div className={`flex items-center gap-2 ${FIELDS_LEFT_OFFSET}`}>
            <Select
              value={action.mode}
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

function fieldPlaceholder(field: 'value' | 'from' | 'to' | 'dst'): string {
  switch (field) {
    case 'value': return 'value'
    case 'from': return 'from'
    case 'to': return 'to'
    case 'dst': return 'dst 目标路径'
  }
}