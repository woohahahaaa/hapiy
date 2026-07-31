import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { confirmJsonSave } from '@/components/JsonEditModal'
import { parseTopologyDocument, type Workflow } from '@/lib/topology-document'

interface TopologyJsonEditModalProps {
  readonly workflows: Workflow[]
  readonly onSave: (workflows: Workflow[]) => Promise<void>
  readonly onClose: () => void
}

export function TopologyJsonEditModal({ workflows, onSave, onClose }: TopologyJsonEditModalProps) {
  const [text, setText] = useState(() => JSON.stringify(workflows, null, 2))
  const [error, setError] = useState<string | null>(null)

  const handleSave = async (): Promise<void> => {
    if (!confirmJsonSave()) return
    try {
      await onSave(parseTopologyDocument(JSON.parse(text) as unknown))
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
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
          onChange={(event) => { setText(event.target.value); setError(null) }}
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
