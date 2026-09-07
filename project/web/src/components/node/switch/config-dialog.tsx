import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { AppIcon } from '@/components/AppIcon'
import { Checkbox } from '@/components/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RemovableTag } from '@/components/tag'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { ConditionList } from '@/components/rewrite-rule-editor/ConditionList'
import { emptyCondition, type Condition } from '@/components/rewrite-rule-editor/serializer'
import type { SwitchConditionNode, SwitchFilterMode, SwitchNodeConfig } from '@/lib/dashboard-api'

export interface SwitchConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 节点当前规则名称（打开弹窗时作为草稿初值；留空节点显示「条件开关」）。 */
  name?: string
  /** 节点当前配置（打开弹窗时作为草稿初值）。 */
  config: SwitchNodeConfig
  /** 系统里可勾选的供应商（id = 真实供应商记录 ID，models = 该供应商的模型名）。 */
  providers: readonly { id: string; name: string; models?: readonly string[] }[]
  /** 保存：把草稿回传给节点；由调用方负责写入拓扑并持久化。 */
  onSave: (name: string, config: SwitchNodeConfig) => void
}

// Switch 的条件结构与请求改写同形，直接互转复用 ConditionList。
type RwCondition = Condition

const toRw = (c: SwitchConditionNode): RwCondition =>
  'logic' in c
    ? { logic: c.logic, children: c.children.map(toRw) }
    : { path: c.path, op: c.op, value: c.value, invert: c.invert, scope: c.scope as 'all' | 'header' | 'body' }

const fromRw = (c: RwCondition): SwitchConditionNode =>
  'logic' in c
    ? { logic: c.logic, children: c.children.map(fromRw) }
    : { path: c.path, op: c.op, value: c.value, invert: c.invert, scope: c.scope }

// 条件开关节点配置弹窗（系统 Dialog 组件）：规则名称 + 筛选维度二选一
// （供应商/模型）+ 多选下拉 + 请求头/请求体条件块（照搬请求改写编辑器）。
export function SwitchConfigDialog({ open, onOpenChange, name, config, providers, onSave }: SwitchConfigDialogProps) {
  const [draftName, setDraftName] = useState(name ?? '')
  const [mode, setMode] = useState<SwitchFilterMode>(config.mode ?? 'provider')
  const [selectedProviders, setSelectedProviders] = useState<ReadonlySet<string>>(new Set(config.providers ?? []))
  const [selectedModels, setSelectedModels] = useState<ReadonlySet<string>>(new Set(config.models ?? []))
  const [conditionLogic, setConditionLogic] = useState<'AND' | 'OR'>(config.conditionLogic ?? 'AND')
  const [conditions, setConditions] = useState<RwCondition[]>(() => (config.conditions ?? []).map(toRw))

  // 每次打开时以节点当前配置重置草稿。
  useEffect(() => {
    if (!open) return
    setDraftName(name ?? '')
    setMode(config.mode ?? 'provider')
    setSelectedProviders(new Set(config.providers ?? []))
    setSelectedModels(new Set(config.models ?? []))
    setConditionLogic(config.conditionLogic ?? 'AND')
    setConditions((config.conditions ?? []).map(toRw))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const modelOptions = (() => {
    const seen = new Set<string>()
    const list: { id: string; name: string }[] = []
    for (const p of providers) {
      for (const m of p.models ?? []) {
        if (seen.has(m)) continue
        seen.add(m)
        list.push({ id: m, name: m })
      }
    }
    return list
  })()

  const options = mode === 'provider'
    ? providers.map((p) => ({ id: p.id, name: p.name }))
    : modelOptions
  const selected = mode === 'provider' ? selectedProviders : selectedModels
  const selectedOptions = options.filter((o) => selected.has(o.id))

  const toggleOption = (id: string) => {
    const setter = mode === 'provider' ? setSelectedProviders : setSelectedModels
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addCondition = () => {
    setConditions((prev) => [...prev, emptyCondition()])
  }

  const handleSave = () => {
    // 二选一语义：只保留当前维度勾选的内容；切到另一维度后未填 → 对全部生效，
    // 之前另一维度填写的列表一并作废（不落库）。
    onSave(draftName.trim(), {
      mode,
      providers: mode === 'provider' ? [...selectedProviders] : [],
      models: mode === 'model' ? [...selectedModels] : [],
      conditionLogic,
      conditions: conditions.map(fromRw),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm" scrollFooter className="!w-[680px]">
        <DialogHeader>
          <DialogTitle>满足以下供应商和请求头、请求体条件时，生效</DialogTitle>
          <DialogDescription>
            供应商筛选与判断条件须同时命中才从「是」输出；否则从「否」输出。
          </DialogDescription>
        </DialogHeader>

        <DialogScrollBody className="flex flex-col gap-4" footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleSave}>保存</Button>
          </>
        }>
          {/* ── 规则名称：留空则节点显示「条件开关」 ── */}
          <Field>
            <FieldLabel>规则名称</FieldLabel>
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="条件开关"
            />
          </Field>

          {/* ── 筛选维度：供应商 / 模型 二选一 + 多选下拉 ── */}
          <div className="flex flex-col gap-1.5">
            <Select value={mode} onValueChange={(v) => setMode(v as SwitchFilterMode)}>
              <SelectTrigger className="h-7 w-fit self-start" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="provider">对选中供应商生效</SelectItem>
                  <SelectItem value="model">对选中模型生效</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="min-w-0">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex min-h-8 w-full items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-2 text-xs outline-none select-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 hover:bg-muted/40"
                  >
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      {selectedOptions.length === 0 ? (
                        <span className="text-muted-foreground">
                          {mode === 'provider' ? '选择供应商（不选时对全部生效）' : '选择模型（不选时对全部生效）'}
                        </span>
                      ) : (
                        selectedOptions.map((o) => (
                          <RemovableTag
                            key={o.id}
                            label={<span className="font-medium">{o.name}</span>}
                            onRemove={() => toggleOption(o.id)}
                            removeTitle={`移除 ${o.name}`}
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
                    {options.map((o) => {
                      const checked = selected.has(o.id)
                      return (
                        <li key={o.id}>
                          <button
                            type="button"
                            onClick={() => toggleOption(o.id)}
                            role="option"
                            aria-selected={checked}
                            className={cn(
                              'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs select-none',
                              checked ? 'bg-muted/60' : 'hover:bg-muted/40',
                            )}
                          >
                            <Checkbox checked={checked} aria-hidden tabIndex={-1} className="pointer-events-none" />
                            <span className="min-w-0 flex-1">
                              <span className={cn('truncate', checked && 'font-medium')}>{o.name}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                    {options.length === 0 && (
                      <li className="px-2.5 py-2 text-xs text-muted-foreground">
                        {mode === 'provider' ? '暂无供应商' : '暂无模型'}
                      </li>
                    )}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* ── 条件块：照搬请求改写编辑器的条件区（amber 徽标 + AND/OR + ConditionList） ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                条件
              </span>
              <div className="flex items-center gap-1.5">
                <Select value={conditionLogic} onValueChange={(v) => setConditionLogic(v as 'AND' | 'OR')}>
                  <SelectTrigger className="h-6 w-[140px]" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="AND">AND（都满足）</SelectItem>
                      <SelectItem value="OR">OR（任一满足）</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={addCondition}
                  className="nodrag nopan inline-flex h-6 items-center gap-1 rounded-xs border border-border bg-background px-1.5 text-xs text-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-700"
                  aria-label="添加条件"
                  title="添加条件"
                >
                  <AppIcon name="add" size={12} />
                  添加条件
                </button>
              </div>
            </div>
            {conditions.length === 0 ? (
              <div className="rounded border border-dashed border-amber-500/30 bg-amber-500/5 px-3 py-2 text-center text-xs text-muted-foreground">
                暂无条件，留空表示无条件执行
              </div>
            ) : (
              <ConditionList conditions={conditions} onChange={setConditions} />
            )}
          </div>
        </DialogScrollBody>
      </DialogContent>
    </Dialog>
  )
}