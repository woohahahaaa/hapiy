import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogScrollBody, DialogTitle } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AppIcon } from '@/components/AppIcon'
import { i18n } from '@/i18n/i18n'

export type JsonEditorIdMap = ReadonlyMap<number, string>

export type JsonEditorItem = {
  readonly id: number
}

interface JsonEditModalProps<T extends { readonly id: string }> {
  readonly data: readonly T[]
  readonly onSave: (data: unknown, idMap: JsonEditorIdMap) => Promise<void> | void
  readonly onClose: () => void
}

export function parseJsonEditorArray<T>(data: unknown): readonly (Omit<T, 'id'> & JsonEditorItem)[] {
  if (!Array.isArray(data)) {
    throw new Error(i18n.t('topology:jsonEdit.topLevelArray'))
  }

  const ids = new Set<number>()
  for (const item of data) {
    if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id < 1) {
      throw new Error(i18n.t('topology:jsonEdit.invalidId'))
    }
    if (ids.has(item.id)) {
      throw new Error(i18n.t('topology:jsonEdit.duplicateId', { id: item.id }))
    }
    ids.add(item.id)
  }

  return data as readonly (Omit<T, 'id'> & JsonEditorItem)[]
}

export function JsonEditModal<T extends { readonly id: string }>({ data, onSave, onClose }: JsonEditModalProps<T>) {
  const { t } = useTranslation('topology')
  const { editorData, idMap } = useMemo(() => {
    const ids = new Map<number, string>()
    const items = data.map((item, index) => {
      const id = index + 1
      ids.set(id, item.id)
      return { ...item, id }
    })
    return { editorData: items, idMap: ids }
  }, [data])
  const [text, setText] = useState(() => JSON.stringify(editorData, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const parsed = JSON.parse(text)
      await onSave(parsed, idMap)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleFormat = () => {
    try {
      setText(JSON.stringify(JSON.parse(text), null, 2))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('jsonEdit.formatFailed'))
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent width="md" height="auto" scrollFooter className="flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('jsonEdit.title')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="outline" onClick={handleFormat} disabled={saving}>
                <AppIcon name="auto_fix_high" data-icon="inline-start" />
                {t('jsonEdit.format')}
              </Button>
              <Button onClick={() => setShowConfirm(true)} disabled={saving}>{saving ? t('jsonEdit.saving') : t('common:action.save')}</Button>
            </>
          }>
            {error && (
              <div className="rounded-xs border border-destructive/50 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
                {error}
              </div>
            )}
            <Textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setError(null) }}
              className="min-h-0 flex-1 overflow-auto font-mono text-xs"
              spellCheck={false}
            />
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
      <Dialog open={showConfirm} onOpenChange={(open) => { if (!open) setShowConfirm(false) }}>
        <DialogContent scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('jsonEdit.saveConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('jsonEdit.saveConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={saving}>{t('jsonEdit.reconsider')}</Button>
              <Button onClick={() => { setShowConfirm(false); void handleSave() }} disabled={saving}>{t('jsonEdit.confirmSave')}</Button>
            </>
          } />
        </DialogContent>
      </Dialog>
    </>
  )
}
