import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { AppIcon } from '@/components/AppIcon'
import { DEFAULT_TOKEN_USAGE_FIELDS, type TokenUsageFields } from '@/lib/token-usage-fields'

const FIELD_GROUPS: readonly { key: keyof TokenUsageFields; labelKey: string; hintKey: string }[] = [
  { key: 'prompt_tokens', labelKey: 'tokenUsage.promptLabel', hintKey: 'tokenUsage.promptHint' },
  { key: 'cache_write_tokens', labelKey: 'tokenUsage.cacheWriteLabel', hintKey: 'tokenUsage.cacheWriteHint' },
  { key: 'cache_read_tokens', labelKey: 'tokenUsage.cacheReadLabel', hintKey: 'tokenUsage.cacheReadHint' },
  { key: 'completion_tokens', labelKey: 'tokenUsage.completionLabel', hintKey: 'tokenUsage.completionHint' },
]

export function TokenUsageFieldsDialog({ open, onOpenChange, initial, onSave }: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly initial: TokenUsageFields
  readonly onSave: (fields: TokenUsageFields) => Promise<void>
}) {
  const { t } = useTranslation('settings')
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
      <DialogContent width="sm" scrollFooter>
        <DialogHeader>
          <DialogTitle>{t('tokenUsage.dialogTitle')}</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDraft(DEFAULT_TOKEN_USAGE_FIELDS)}>
              {t('restoreDefaults')}
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
              {t('common:action.save')}
            </Button>
          </>
        }>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto pr-1">
          {FIELD_GROUPS.map((group) => {
            const paths = draft[group.key]
            return (
              <div key={group.key} className="flex flex-col gap-2">
                <div>
                  <div className="text-sm font-medium">{t(group.labelKey)}</div>
                  <div className="text-xs text-muted-foreground">{t(group.hintKey)}{t('tokenUsage.fieldSuffix')}</div>
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
                        placeholder={t('tokenUsage.pathPlaceholder')}
                        className="font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateGroup(group.key, paths.filter((_, idx) => idx !== i))}
                        title={t('tokenUsage.removePathTitle')}
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
                    {t('tokenUsage.addPath')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        </DialogScrollBody>
      </DialogContent>
    </Dialog>
  )
}
