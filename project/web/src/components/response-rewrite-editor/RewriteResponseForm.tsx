import { useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ResponseRewriteRule } from '@/lib/dashboard-api'
import { GjsonPathHelp } from '@/components/rewrite-rule-editor'
import {
  OP_TYPE_LABEL,
  SIMPLE_OP_TYPES,
  isOpComplete,
  newOp,
  parseRule,
  serializeRule,
  type Op,
  type RuleForm,
  type SimpleOpType,
} from './serializer'

interface RewriteResponseFormProps {
  rule: ResponseRewriteRule | null
  onSave: (r: ResponseRewriteRule) => void
  onCancel: () => void
  saving: boolean
}

export function RewriteResponseForm({ rule, onSave, onCancel, saving }: RewriteResponseFormProps) {
  const initialForm = parseRule(rule?.script ?? '')
  const [name, setName] = useState(rule?.name ?? '')
  const [form, setForm] = useState<RuleForm>(initialForm)
  const [addingType, setAddingType] = useState<SimpleOpType>('prefix')

  const updateOp = (id: string, patch: Partial<Op>) => {
    setForm((prev) => ({
      ops: prev.ops.map((op) => (op.id === id ? ({ ...op, ...patch } as Op) : op)),
    }))
  }

  const removeOp = (id: string) => {
    setForm((prev) => ({ ops: prev.ops.filter((op) => op.id !== id) }))
  }

  const addOp = () => {
    const op = newOp(addingType)
    setForm((prev) => ({ ops: [...prev.ops, op] }))
  }

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    const completeOps = form.ops.filter(isOpComplete)
    const next: RuleForm = { ops: completeOps }
    onSave({
      ...(rule ?? { id: '', script: '', status: true }),
      name: trimmedName,
      script: serializeRule(next),
    })
  }

  const noCompleteOps = !form.ops.some(isOpComplete)
  const disabled = saving || !name.trim() || noCompleteOps

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
          <FieldLabel>操作列表</FieldLabel>
          <GjsonPathHelp />
        </div>
        <OpList form={form} updateOp={updateOp} removeOp={removeOp} />
        <div className="flex items-center gap-2 pt-1">
          <Select value={addingType} onValueChange={(v) => setAddingType(v as SimpleOpType)}>
            <SelectTrigger className="h-8 w-[140px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SIMPLE_OP_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {OP_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={addOp}>
            <AppIcon name="add" size={14} data-icon="inline-start" />
            添加操作
          </Button>
        </div>
        {noCompleteOps && (
          <p className="pt-1 text-xs text-muted-foreground">
            至少添加一条填写完整的操作 (路径 + 必填字段)
          </p>
        )}
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

// ── List ──

interface OpListProps {
  form: RuleForm
  updateOp: (id: string, patch: Partial<Op>) => void
  removeOp: (id: string) => void
}

function OpList({ form, updateOp, removeOp }: OpListProps) {
  if (form.ops.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        暂无操作，选择下方类型后点击「添加操作」
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {form.ops.map((op, i) => (
        <OpCard key={op.id} index={i} op={op} onChange={(patch) => updateOp(op.id, patch)} onRemove={() => removeOp(op.id)} />
      ))}
    </div>
  )
}

// ── Card ──

interface OpCardProps {
  index: number
  op: Op
  onChange: (patch: Partial<Op>) => void
  onRemove: () => void
}

function OpCard({ index, op, onChange, onRemove }: OpCardProps) {
  const typeBadge = OP_TYPE_LABEL[op.type]
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
          <span className="inline-flex items-center rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
            {typeBadge}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label="删除操作"
          title="删除操作"
        >
          <AppIcon name="close" size={14} />
        </button>
      </div>
      <div className="space-y-2 p-3">
        <OpFields op={op} onChange={onChange} />
      </div>
    </div>
  )
}

// ── Fields per op type ──

function OpFields({ op, onChange }: { op: Op; onChange: (patch: Partial<Op>) => void }) {
  switch (op.type) {
    case 'rename':
      return (
        <>
          <FieldRow label="字段路径">
            <Input
              className="h-8 font-mono text-xs"
              value={op.path}
              onChange={(e) => onChange({ path: e.target.value })}
              placeholder="如 messages.0.content"
            />
          </FieldRow>
          <FieldRow label="新字段名">
            <Input
              className="h-8 font-mono text-xs"
              value={op.newName}
              onChange={(e) => onChange({ newName: e.target.value })}
              placeholder="如 text"
            />
          </FieldRow>
        </>
      )
    case 'prefix':
    case 'suffix':
      return (
        <>
          <FieldRow label="字段路径">
            <Input
              className="h-8 font-mono text-xs"
              value={op.path}
              onChange={(e) => onChange({ path: e.target.value })}
              placeholder="如 choices.0.message.content"
            />
          </FieldRow>
          <FieldRow label={op.type === 'prefix' ? '要加的前缀字符串' : '要加的后缀字符串'}>
            <Input
              className="h-8 font-mono text-xs"
              value={op.value}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder={op.type === 'prefix' ? '如 \n<think>' : '如 \n</think>'}
            />
          </FieldRow>
          <p className="text-[11px] text-muted-foreground">
            {op.type === 'prefix'
              ? '在流式响应中只作用于第一个包含该字段的 chunk (等价于 New API think 标签的注入逻辑)；非流式响应按完整 body 处理。'
              : '在流式响应中只作用于最后一个包含该字段的 chunk；非流式响应按完整 body 处理。'}
          </p>
        </>
      )
    case 'delete':
      return (
        <FieldRow label="字段路径">
          <Input
            className="h-8 font-mono text-xs"
            value={op.path}
            onChange={(e) => onChange({ path: e.target.value })}
            placeholder="如 choices.0.finish_reason"
          />
        </FieldRow>
      )
    case 'raw':
      return (
        <div className="rounded border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          该操作模式 ({op.mode}) 不在简化表单中，保存时会被跳过。如需保留，请删除此条后用其他操作重建。
        </div>
      )
  }
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('w-24 shrink-0 text-xs text-muted-foreground')}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}