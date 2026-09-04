import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AppIcon } from '@/components/AppIcon'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/dialog'
import { ConditionList } from '@/components/rewrite-rule-editor/ConditionList'
import { GjsonPathHelp } from '@/components/rewrite-rule-editor/GjsonPathHelp'
import { emptyCondition } from '@/components/rewrite-rule-editor/serializer'
import { topologyConfig } from '@/config/topology-config'
import type { Condition } from '@/components/rewrite-rule-editor/serializer'

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
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set(['p1', 'p2']))
  const [conditions, setConditions] = useState<Condition[]>(() => [emptyCondition()])

  const toggleProvider = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAll = (on: boolean) => {
    setSelected(on ? new Set(PROVIDERS.map((p) => p.id)) : new Set())
  }
  const filteredProviders = PROVIDERS.filter((p) => p.name.includes(search))

  const providerSummary = selected.size === 0 ? '全部供应商' : `已选 ${selected.size} 个`

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-background px-6 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">条件开关节点 · 真实组件预览</span>
        <span>左侧画布节点（点击打开弹窗），右侧为弹窗内容</span>
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
            style={{ minWidth: topologyConfig.render.node.minWidth, paddingRight: 56 }}
          >
            {/* 左侧连线 pill（HandlesRail 简化） */}
            <span
              aria-hidden
              className="pointer-events-none absolute left-0 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-[4px] border-2 border-border"
              style={{ width: 12, height: 20, background: 'linear-gradient(90deg, transparent 0 50%, var(--color-card) 50% 100%)' }}
            />

            {/* 头部：状态点 + 名称 + 开关（对齐入口节点） */}
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn('size-2 shrink-0 rounded-full', enabled ? 'bg-[var(--color-success)]' : 'bg-muted-foreground/50')}
                />
                <span className="truncate text-sm font-medium">条件开关</span>
              </span>
              <Switch
                className="nodrag nopan"
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label={enabled ? '已启用' : '已停用'}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>

            {/* 节点体：条件摘要 */}
            <div className="flex flex-col gap-2 p-3">
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
              <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                同时满足才从「是」输出
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>

            {/* 右侧：是 / 否 输出终端 + 标签 */}
            <div
              className="pointer-events-none absolute right-2 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-[18px] text-[10px] font-medium"
              aria-hidden
            >
              <span style={{ color: 'var(--color-success)' }}>是</span>
              <span style={{ color: 'var(--color-destructive)' }}>否</span>
            </div>
            <div className="absolute right-0 top-1/2 z-10 flex -translate-y-1/2 translate-x-1/2 flex-col gap-5" aria-hidden>
              <span className="size-2 rounded-full border-2 bg-card" style={{ borderColor: 'var(--color-success)' }} />
              <span className="size-2 rounded-full border-2 bg-card" style={{ borderColor: 'var(--color-destructive)' }} />
            </div>
          </div>

          <span className="absolute left-4 top-3 text-[11px] text-muted-foreground">仿画布背景 · 点击节点打开弹窗</span>
        </div>

        {/* ── 右：弹窗（真实组件） ── */}
        <div className="flex w-full max-w-[720px] flex-1 items-start justify-center border-l border-border bg-muted/40 px-8 py-10">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent width="sm" showCloseButton={false} className="!w-[680px]">
              <DialogHeader>
                <DialogTitle>配置条件开关</DialogTitle>
                <DialogDescription>
                  同时满足下方两组条件时，请求从「是」输出；否则从「否」输出。
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                {/* ── 条件一：供应商筛选 ── */}
                <section className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-medium">供应商筛选</h3>
                    <span className="text-[10px] text-muted-foreground">未勾选时对全部供应商生效</span>
                  </div>
                  <div className="rounded-md border border-border bg-popover">
                    <div className="flex items-center gap-2 border-b border-border p-2">
                      <div className="relative flex-1">
                        <Input
                          className="h-7 pl-7"
                          placeholder="搜索供应商名称…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <AppIcon
                          name="tune"
                          size={14}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                      </div>
                      <Button variant="ghost" size="xs" onClick={() => selectAll(true)}>
                        全选
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => selectAll(false)}>
                        清空
                      </Button>
                    </div>
                    <div className="max-h-44 space-y-0.5 overflow-y-auto p-1.5">
                      {filteredProviders.map((p) => {
                        const checked = selected.has(p.id)
                        return (
                          <label
                            key={p.id}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted',
                              checked && 'bg-muted/60',
                            )}
                          >
                            <Checkbox
                              className="nodrag nopan"
                              checked={checked}
                              onCheckedChange={() => toggleProvider(p.id)}
                              aria-label={`选择供应商 ${p.name}`}
                            />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              {p.keys} keys · {p.models} models
                            </span>
                          </label>
                        )
                      })}
                      {filteredProviders.length === 0 && (
                        <p className="py-4 text-center text-xs text-muted-foreground">没有匹配的供应商</p>
                      )}
                    </div>
                    <div className="border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
                      已选 {selected.size} / {PROVIDERS.length} 个供应商
                    </div>
                  </div>
                </section>

                {/* ── 条件二：请求体筛选（复用「请求改写」条件编辑器）── */}
                <section className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-medium">请求体筛选</h3>
                    <GjsonPathHelp />
                  </div>
                  <div className="rounded-md border border-border bg-background p-1.5">
                    <ConditionList conditions={conditions} onChange={setConditions} />
                  </div>
                  {conditions.length === 0 && (
                    <p className="pl-1 text-[10px] text-muted-foreground">
                      未配置任何条件时，该组视为恒真（不影响「是」判断）。
                    </p>
                  )}
                </section>

                {/* ── 合并语义说明 ── */}
                <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary">AND</span>
                  供应商筛选 与 请求体筛选必须
                  <b className="font-medium text-foreground">同时命中</b>
                  才从「是」输出，任一项不满足则从「否」输出。
                </div>
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