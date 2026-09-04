import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/checkbox'
import { Button } from '@/components/ui/button'
import { AppIcon } from '@/components/AppIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RemovableTag } from '@/components/tag'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/dialog'
import { ConditionRow } from '@/components/rewrite-rule-editor/ConditionRow'
import { emptyCondition } from '@/components/rewrite-rule-editor/serializer'
import type { LeafCondition } from '@/components/rewrite-rule-editor/serializer'
import { topologyConfig } from '@/config/topology-config'

interface PreviewProvider {
  id: string
  name: string
  keys: number
  models: number
}

const PROVIDERS: readonly PreviewProvider[] = [
  { id: 'p1', name: 'OpenAI 直连', keys: 3, models: 12 },
  { id: 'p2', name: 'Anthropic 直连', keys: 2, models: 8 },
  { id: 'p3', name: 'DeepSeek 官方', keys: 1, models: 4 },
  { id: 'p4', name: '硅基流动', keys: 1, models: 38 },
  { id: 'p5', name: '本地 Ollama', keys: 0, models: 6 },
]

export function SwitchNodePreviewPage() {
  const [enabled, setEnabled] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set(['p1']))
  const [conditions, setConditions] = useState<LeafCondition[]>(() => [emptyCondition()])

  const toggleProvider = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectedProviders = PROVIDERS.filter((p) => selected.has(p.id))
  const providerSummary = selected.size === 0 ? '全部供应商' : `已选 ${selected.size} 个`

  const updateCondition = (i: number, next: LeafCondition) => {
    setConditions((prev) => prev.map((c, ci) => (ci === i ? next : c)))
  }
  const removeCondition = (i: number) => {
    setConditions((prev) => prev.filter((_, ci) => ci !== i))
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-background px-6 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">条件开关节点 · 真实组件预览</span>
        <span className="hidden md:inline">左侧画布节点（点击打开弹窗），右侧为弹窗内容</span>
        <Button variant="outline" size="xs" className="ml-auto" onClick={() => setDialogOpen(true)}>
          打开弹窗
        </Button>
      </header>

      <div className="flex flex-1">
        {/* ── 左：仿画布 + 节点 ── */}
        <div
          className="relative flex flex-1 items-center justify-center overflow-hidden"
          style={{
            backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDialogOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setDialogOpen(true)
            }}
            className={cn(
              'relative w-fit cursor-pointer rounded-lg border-2 border-border bg-card text-card-foreground transition-all hover:shadow-md',
              !enabled && 'opacity-60',
            )}
            style={{ minWidth: topologyConfig.render.node.minWidth }}
          >
            {/* 左侧连线 pill（HandlesRail 简化） */}
            <span
              aria-hidden
              className="pointer-events-none absolute left-0 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-[4px] border-2 border-border"
              style={{
                width: 12,
                height: 20,
                background: 'linear-gradient(90deg, transparent 0 50%, var(--color-card) 50% 100%)',
              }}
            />

            {/* 头部：状态点 + 名称 + 开关（底部分隔线贯通整卡） */}
            <div className="flex items-center justify-between gap-2 border-b border-border py-2 pl-3 pr-14">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    enabled ? 'bg-[var(--color-success)]' : 'bg-muted-foreground/50',
                  )}
                />
                <span className="truncate text-sm font-medium">条件开关</span>
              </span>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label={enabled ? '已启用' : '已停用'}
              />
            </div>

            {/* 节点体：条件摘要 */}
            <div className="flex flex-col gap-2 p-3 pr-14">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>供应商</span>
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-card-foreground">
                  {providerSummary}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>请求条件</span>
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-card-foreground">
                  {conditions.length} 条
                </span>
              </div>
            </div>

            {/* 底部说明行（顶部细线贯通整卡） */}
            <div className="border-t border-border px-3 py-1.5 pr-14 text-[10px]">
              满足条件 → <span className="font-medium text-foreground">是</span>　·　否则 →{' '}
              <span className="font-medium text-foreground">否</span>
            </div>

            {/* 右侧输出端：是 / 否 标签 + Handle（贴上右缘） */}
            <div className="absolute right-1.5 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-4">
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-[10px] font-medium leading-none">是</span>
                <span className="size-2.5 rounded-full border-2 border-border bg-background" />
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-[10px] font-medium leading-none">否</span>
                <span className="size-2.5 rounded-full border-2 border-border bg-background" />
              </div>
            </div>
          </div>

          <span className="absolute left-4 top-3 text-[11px] text-muted-foreground">
            仿画布背景 · 点击节点打开弹窗
          </span>
        </div>

        {/* ── 右：弹窗（真实组件） ── */}
        <div className="flex w-full max-w-[720px] flex-1 items-start justify-center border-l border-border bg-muted/40 px-8 py-10">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent width="sm" showCloseButton={false} className="!w-[680px]">
              <DialogTitle className="px-4 pt-4">满足以下供应商和请求头、请求体条件时，生效</DialogTitle>

              <div className="flex flex-col gap-4 p-4">
                {/* ── 供应商：多选下拉（对齐「托管供应商」，选中即出 tag） ── */}
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs font-medium">供应商：</span>
                  <div className="min-w-0 flex-1">
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
                          {PROVIDERS.map((p) => {
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
                                  <span className="shrink-0 text-muted-foreground">
                                    {p.keys} keys · {p.models} models
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* ── 判断条件：扁平条件行（请求改写同款，不嵌套条件组） ── */}
                <section className="flex flex-col gap-1.5">
                  <h3 className="text-xs font-medium">判断条件</h3>
                  <div className="space-y-1.5 rounded-md border border-border bg-background p-1.5">
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
                        onClick={() => setConditions((prev) => [...prev, emptyCondition()])}
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
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button onClick={() => setDialogOpen(false)}>保存</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}