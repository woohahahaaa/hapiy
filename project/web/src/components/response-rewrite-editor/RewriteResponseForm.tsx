import { useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ResponseRewriteRule } from '@/lib/dashboard-api'
import { GjsonPathHelp } from '@/components/rewrite-rule-editor'
import { ResponseBlockCard } from './ResponseBlockCard'
import {
  emptyBlock,
  hasAnyCompleteBlock,
  isActionValid,
  parseRule,
  serializeRule,
  type Action,
  type Block,
  type RuleForm,
} from './serializer'

interface RewriteResponseFormProps {
  rule: ResponseRewriteRule | null
  onSave: (r: ResponseRewriteRule) => void
  onCancel: () => void
  saving: boolean
}

export function RewriteResponseForm({ rule, onSave, onCancel, saving }: RewriteResponseFormProps) {
  const [form, setForm] = useState<RuleForm>(() => parseRule(rule?.script ?? ''))
  const [name, setName] = useState(rule?.name ?? '')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const updateBlock = (i: number, next: Block) => {
    setForm((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b, bi) => (bi === i ? next : b)),
    }))
  }
  const removeBlock = (i: number) => {
    setForm((prev) => ({ ...prev, blocks: prev.blocks.filter((_, bi) => bi !== i) }))
  }
  const addBlock = () => {
    setForm((prev) => ({ ...prev, blocks: [...prev.blocks, emptyBlock(prev.blocks)] }))
  }
  const reorder = (from: number, to: number) => {
    if (from === to) return
    setForm((prev) => {
      const next = [...prev.blocks]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...prev, blocks: next }
    })
  }
  const clearDrag = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    const cleaned: RuleForm = {
      blocks: form.blocks
        .map((b) => ({ id: b.id, actions: b.actions.filter(isActionValid) }))
        .filter((b) => b.actions.length > 0),
    }
    onSave({
      ...(rule ?? { id: '', script: '', status: true }),
      name: trimmedName,
      script: serializeRule(cleaned),
    })
  }

  const disabled = saving || !name.trim() || !hasAnyCompleteBlock(form.blocks)

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="rr-name">名称</FieldLabel>
        <Input
          id="rr-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="规则名称"
        />
      </Field>

      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel>改写规则</FieldLabel>
          <GjsonPathHelp />
        </div>
        <div className="flex w-full flex-col gap-3">
          {form.blocks.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              暂无规则，点击下方「添加规则」开始配置
            </div>
          ) : (
            form.blocks.map((b, i) => (
              <ResponseBlockCard
                key={b.id}
                index={i}
                block={b}
                onChange={(next) => updateBlock(i, next)}
                onRemove={() => removeBlock(i)}
                canRemove={form.blocks.length > 1}
                onDragStart={() => setDragIndex(i)}
                onDragOver={() => { if (overIndex !== i) setOverIndex(i) }}
                onDrop={() => {
                  if (dragIndex !== null) reorder(dragIndex, i)
                  clearDrag()
                }}
                isDragging={dragIndex === i}
                isDragOver={overIndex === i && dragIndex !== null && dragIndex !== i}
              />
            ))
          )}
          <button
            type="button"
            onClick={addBlock}
            className="nodrag nopan inline-flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
            aria-label="添加规则"
            title="添加规则"
          >
            <AppIcon name="add" size={16} />
          </button>
        </div>
      </Field>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button disabled={disabled} onClick={handleSave}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>
    </FieldGroup>
  )
}

export type { Action, Block, RuleForm }