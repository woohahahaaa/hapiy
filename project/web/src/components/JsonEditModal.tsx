import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(text)
      await onSave(parsed, idMap)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑 JSON</DialogTitle>
        </DialogHeader>
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
            {error}
          </div>
        )}
        <Textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null) }}
          className="font-mono text-xs"
          style={{ minHeight: 340 }}
          spellCheck={false}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
