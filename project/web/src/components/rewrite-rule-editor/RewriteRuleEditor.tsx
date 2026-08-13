import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { BlockCard } from './BlockCard'
import {
  emptyBlock,
  parseRule,
  serializeRule,
  type RuleForm,
} from './serializer'

interface RewriteRuleEditorProps {
  /** 初始 script（来自后端的 JSON 数组字符串）；组件挂载时一次性反序列化为表单状态。 */
  initialScript: string
  /** 表单任意改动都会以新的序列化 script 字符串回传。 */
  onScriptChange: (next: string) => void
}

/**
 * 改写规则结构化编辑器。
 * 表单状态内部持有；外部只通过 initialScript 喂初值、通过 onScriptChange 接收变更。
 * 通过 key={rule.id} 强制重挂载可在父级切换编辑不同规则时重置表单。
 */
export function RewriteRuleEditor({ initialScript, onScriptChange }: RewriteRuleEditorProps) {
  const [form, setForm] = useState<RuleForm>(() => parseRule(initialScript))
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // 监听初始值变化（编辑不同规则时父级通过 key 重挂载，这里兜底处理同实例内替换）。
  useEffect(() => {
    setForm(parseRule(initialScript))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScript])

  // 表单状态变化时把序列化结果推出去。
  useEffect(() => {
    onScriptChange(serializeRule(form))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  const updateBlock = (i: number, next: RuleForm['blocks'][number]) => {
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

  return (
    <div className="flex w-full flex-col gap-3">
      {form.blocks.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          暂无规则，点击下方「添加规则」开始配置
        </div>
      ) : (
        form.blocks.map((b, i) => (
          <BlockCard
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
  )
}