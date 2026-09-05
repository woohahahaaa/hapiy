import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { AppIcon } from '@/components/AppIcon'
import { Checkbox } from '@/components/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RemovableTag } from '@/components/tag'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { ConditionRow } from '@/components/rewrite-rule-editor/ConditionRow'
import { GjsonPathHelp } from '@/components/rewrite-rule-editor/GjsonPathHelp'
import { emptyCondition, type LeafCondition } from '@/components/rewrite-rule-editor/serializer'
import type { SwitchCondition, SwitchNodeConfig } from '@/lib/dashboard-api'

export interface SwitchConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 节点当前规则名称（打开弹窗时作为草稿初值；留空节点显示「条件开关」）。 */
  name?: string
  /** 节点当前配置（打开弹窗时作为草稿初值）。 */
  config: SwitchNodeConfig
  /** 系统里可勾选的供应商（id = 真实供应商记录 ID）。 */
  providers: readonly { id: string; name: string }[]
  /** 保存：把草稿回传给节点；由调用方负责写入拓扑并持久化。 */
  onSave: (name: string, config: SwitchNodeConfig) => void
}

// SwitchCondition 与改写编辑器的叶子条件同形，直接互转复用 ConditionRow。
const toLeaf = (c: SwitchCondition): LeafCondition => ({
  path: c.path,
  op: c.op,
  value: c.value,
  invert: c.invert,
  scope: c.scope as LeafCondition['scope'],
})

const fromLeaf = (c: LeafCondition): SwitchCondition => ({
  path: c.path,
  op: c.op,
  value: c.value,
  invert: c.invert,
  scope: c.scope,
})

// 条件开关节点配置弹窗（系统 Dialog 组件）：规则名称 + 供应商多选下拉 +
// 请求头/请求体扁平条件行（复用请求改写的 ConditionRow）。
// 大标题即合并语义：全部命中才走「是」，否则走「否」。
export function SwitchConfigDialog({ open, onOpenChange, name, config, providers, onSave }: SwitchConfigDialogProps) {
  const [draftName, setDraftName] = useState(name ?? '')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(config.providers))
  const [conditions, setConditions] = useState<LeafCondition[]>(() => config.conditions.map(toLeaf))

  // 每次打开时以节点当前配置重置草稿。
  useEffect(() => {
    if (!open) return
    setDraftName(name ?? '')
    setSelected(new Set(config.providers))
    setConditions(config.conditions.map(toLeaf))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggleProvider = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectedProviders = providers.filter((p) => selected.has(p.id))

  const updateCondition = (i: number, next: LeafCondition) => {
    setConditions((prev) => prev.map((c, ci) => (ci === i ? next : c)))
  }
  const removeCondition = (i: number) => {
    setConditions((prev) => prev.filter((_, ci) => ci !== i))
  }
  const addCondition = () => {
    setConditions((prev) => [...prev, emptyCondition()])
  }

  const handleSave = () => {
    onSave(draftName.trim(), {
      providers: [...selected],
      conditions: conditions.map(fromLeaf),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm" className="!w-[680px]">
        <DialogHeader>
          <DialogTitle>满足以下供应商和请求头、请求体条件时，生效</DialogTitle>
          <DialogDescription>
            供应商筛选与判断条件须同时命中才从「是」输出；否则从「否」输出。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* ── 规则名称：留空则节点显示「条件开关」 ── */}
          <Field>
            <FieldLabel>
              规则名称
              <span className="ml-1 font-normal text-muted-foreground">（可选）</span>
            </FieldLabel>
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="条件开关"
            />
            <FieldDescription>留空则节点显示「条件开关」</FieldDescription>
          </Field>

          {/* ── 供应商：标题一行、下拉框一行（对齐「托管供应商」多选） ── */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">供应商：</span>
            <div className="min-w-0">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex min-h-8 w-full items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-2 text-xs outline-none select-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 hover:bg-muted/40"
                  >
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      {selectedProviders.length === 0 ? (
                        <span className="text-muted-foreground">选择供应商（不选时对全部生效）</span>
                      ) : (
                        selectedProviders.map((p) => (
                          <RemovableTag
                            key={p.id}
                            label={<span className="font-medium">{p.name}</span>}
                            onRemove={() => toggleProvider(p.id)}
                            removeTitle={`移除 ${p.name}`}
                          />
                        ))
                      )}
                    </span>
                    <AppIcon name="expand_more" size={16} className="shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="max-h-[55vh] w-[--radix-popover-trigger-width] overflow-auto p-0"
                >
                  <ul role="listbox" aria-multiselectable="true">
                    {providers.map((p) => {
                      const checked = selected.has(p.id)
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => toggleProvider(p.id)}
                            role="option"
                            aria-selected={checked}
                            className={cn(
                              'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs select-none',
                              checked ? 'bg-muted/60' : 'hover:bg-muted/40',
                            )}
                          >
                            <Checkbox checked={checked} aria-hidden tabIndex={-1} className="pointer-events-none" />
                            <span className="min-w-0 flex-1">
                              <span className={cn('truncate', checked && 'font-medium')}>{p.name}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                    {providers.length === 0 && (
                      <li className="px-2.5 py-2 text-xs text-muted-foreground">暂无供应商</li>
                    )}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* ── 判断条件：请求头/请求体扁平条件行（复用请求改写 ConditionRow） ── */}
          <section className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium">判断条件</h3>
              <GjsonPathHelp />
            </div>
            <div className="space-y-1.5 rounded-md border border-border bg-card p-1.5">
              {conditions.length === 0 ? (
                <p className="px-1 py-2 text-center text-xs text-muted-foreground">
                  暂无条件，未配置时始终从「是」输出
                </p>
              ) : (
                conditions.map((c, i) => (
                  <ConditionRow
                    key={i}
                    index={i}
                    condition={c}
                    onChange={(next) => updateCondition(i, next)}
                    onRemove={() => removeCondition(i)}
                    canRemove={conditions.length > 1}
                  />
                ))
              )}
              <div className="flex items-center gap-1.5 pl-[24px] pt-0.5">
                <button
                  type="button"
                  onClick={addCondition}
                  className="nodrag nopan inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-700"
                  aria-label="添加条件"
                  title="添加条件"
                >
                  <AppIcon name="add" size={12} />
                  添加条件
                </button>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter showCloseButton={false}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}