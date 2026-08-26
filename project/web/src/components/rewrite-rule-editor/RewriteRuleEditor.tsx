import { useEffect, useRef, useState } from 'react'
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
 *
 * 回传时机是用户实际改动表单之后；挂载和 initialScript 重置都不回传。
 * 原因：parseRule 对嵌套 AND/OR 等高级结构是有损的，把「重新序列化的表单」
 * 静默回推会覆盖父级持有的原始 script，打开弹窗即破坏数据。
 */
export function RewriteRuleEditor({ initialScript, onScriptChange }: RewriteRuleEditorProps) {
  const [form, setForm] = useState<RuleForm>(() => parseRule(initialScript))
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  // 标记下一次 form 变化来自 initialScript 重置，跳过回传。
  const skipNextPush = useRef(false)

  useEffect(() => {
    skipNextPush.current = true
    setForm(parseRule(initialScript))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScript])

  useEffect(() => {
    if (skipNextPush.current) {
      skipNextPush.current = false
      return
    }
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