import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogScrollBody, DialogTitle } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AppIcon } from '@/components/AppIcon'

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
    throw new Error('JSON 顶层必须是数组')
  }

  const ids = new Set<number>()
  for (const item of data) {
    if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id < 1) {
      throw new Error('每条记录的 ID 必须是大于 0 的整数')
    }
    if (ids.has(item.id)) {
      throw new Error(`ID ${item.id} 重复`)
    }
    ids.add(item.id)
  }

  return data as readonly (Omit<T, 'id'> & JsonEditorItem)[]
}

export function JsonEditModal<T extends { readonly id: string }>({ data, onSave, onClose }: JsonEditModalProps<T>) {
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
      setError(e instanceof Error ? e.message : '格式化失败：JSON 无效')
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent width="md" height="auto" scrollFooter className="flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>编辑 JSON</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
              <Button variant="outline" onClick={handleFormat} disabled={saving}>
                <AppIcon name="auto_fix_high" data-icon="inline-start" />
                格式化
              </Button>
              <Button onClick={() => setShowConfirm(true)} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
            </>
          }>
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
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
            <DialogTitle>保存 JSON</DialogTitle>
            <DialogDescription>
              你修改了 JSON 内容,确认保存到后端吗?JSON 里的 ID 字段与使用记录、历史记录等按 ID 关联的数据强绑定,修改任意一条 ID 都可能导致这些数据匹配失败。请确认你已了解此风险。
            </DialogDescription>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={saving}>我再想想</Button>
              <Button onClick={() => { setShowConfirm(false); void handleSave() }} disabled={saving}>确认保存</Button>
            </>
          } />
        </DialogContent>
      </Dialog>
    </>
  )
}
