import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { AppIcon } from '@/components/AppIcon'
import { DEFAULT_TOKEN_USAGE_FIELDS, type TokenUsageFields } from '@/lib/token-usage-fields'

const FIELD_GROUPS: readonly { key: keyof TokenUsageFields; label: string; hint: string }[] = [
  { key: 'prompt_tokens', label: '输入', hint: '输入 tokens（prompt tokens）' },
  { key: 'cache_write_tokens', label: '缓存写入', hint: '写入缓存的 tokens' },
  { key: 'cache_read_tokens', label: '缓存读取', hint: '命中缓存的 tokens' },
  { key: 'completion_tokens', label: '输出', hint: '输出 tokens（completion tokens）' },
]

export function TokenUsageFieldsDialog({ open, onOpenChange, initial, onSave }: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly initial: TokenUsageFields
  readonly onSave: (fields: TokenUsageFields) => Promise<void>
}) {
  const [draft, setDraft] = useState<TokenUsageFields>(initial)
  const [saving, setSaving] = useState(false)

  /* eslint-disable react-hooks/set-state-in-effect -- syncing the draft to the
     freshly-loaded config on open is the intentional imperative pattern; the
     dialog is otherwise uncontrolled and this runs before any user input. */
  useEffect(() => {
    if (open) setDraft(initial)
  }, [open, initial])
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateGroup = (group: keyof TokenUsageFields, paths: readonly string[]) => {
    setDraft((prev) => ({ ...prev, [group]: paths }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="md" className="!w-[640px] !max-w-2xl">
        <DialogHeader>
          <DialogTitle>Token 用量字段配置</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto pr-1">
          {FIELD_GROUPS.map((group) => {
            const paths = draft[group.key]
            return (
              <div key={group.key} className="flex flex-col gap-2">
                <div>
                  <div className="text-sm font-medium">{group.label}</div>
                  <div className="text-xs text-muted-foreground">{group.hint}：按顺序尝试，命中第一个存在的字段即停止</div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {paths.map((path, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={path}
                        onChange={(e) => {
                          const next = [...paths]
                          next[i] = e.target.value
                          updateGroup(group.key, next)
                        }}
                        placeholder="gjson 路径，如 usage.prompt_tokens"
                        className="font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateGroup(group.key, paths.filter((_, idx) => idx !== i))}
                        title="删除此路径"
                      >
                        <AppIcon name="trash" size={14} />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateGroup(group.key, [...paths, ''])}
                  >
                    + 添加路径
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setDraft(DEFAULT_TOKEN_USAGE_FIELDS)}>
            恢复默认
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
