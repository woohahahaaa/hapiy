import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { AppIcon } from '@/components/AppIcon'
import { Checkbox } from '@/components/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
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
import type { ConcurrencyNodeConfig } from '@/lib/dashboard-api'

export interface ConcurrencyConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 节点当前配置（打开弹窗时作为草稿初值）。 */
  config: ConcurrencyNodeConfig
  /** 系统里可勾选的供应商（id = 真实供应商记录 ID）。 */
  providers: readonly { id: string; name: string }[]
  /** 保存：把草稿回传给节点；由调用方负责写入拓扑并持久化。 */
  onSave: (config: ConcurrencyNodeConfig) => void
}

// 并行控制配置弹窗：窗口（每 X 分钟内）+ 上限（最多 N 条）+
// 「按供应商分别计算」开关 + 命中的供应商多选。排队语义为"等到天荒地老"：
// 达到上限后请求会一直等待，直到窗口有位置（不主动 429）。
export function ConcurrencyConfigDialog({ open, onOpenChange, config, providers, onSave }: ConcurrencyConfigDialogProps) {
  const [windowMinutes, setWindowMinutes] = useState(config.windowMinutes)
  const [maxCount, setMaxCount] = useState(config.maxCount)
  const [perProvider, setPerProvider] = useState(config.perProvider)
  const [selectedProviders, setSelectedProviders] = useState<ReadonlySet<string>>(new Set(config.providers ?? []))

  useEffect(() => {
    if (!open) return
    setWindowMinutes(config.windowMinutes)
    setMaxCount(config.maxCount)
    setPerProvider(config.perProvider)
    setSelectedProviders(new Set(config.providers ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const selectedOptions = providers.filter((p) => selectedProviders.has(p.id))

  const toggleOption = (id: string) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = () => {
    onSave({
      windowMinutes: Math.max(1, Math.floor(Number(windowMinutes) || 1)),
      maxCount: Math.max(1, Math.floor(Number(maxCount) || 1)),
      perProvider,
      providers: [...selectedProviders],
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm" className="!w-[560px]">
        <DialogHeader>
          <DialogTitle>每 {windowMinutes || 1} 分钟内最多并发 {maxCount || 1} 条</DialogTitle>
          <DialogDescription>
            达到上限后请求会排队等待，直到窗口内有位置才放行（不超时、不拒绝）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* ── 窗口与上限 ── */}
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>时间窗口（分钟）</FieldLabel>
              <Input
                type="number"
                min={1}
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(e.target.value === '' ? NaN : Number(e.target.value))}
              />
              <FieldDescription>每 X 分钟内，滚动计时</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>并发上限（条）</FieldLabel>
              <Input
                type="number"
                min={1}
                value={maxCount}
                onChange={(e) => setMaxCount(e.target.value === '' ? NaN : Number(e.target.value))}
              />
              <FieldDescription>窗口内最多 N 条</FieldDescription>
            </Field>
          </div>

          {/* ── 按供应商分别计算 ── */}
          <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-xs font-medium">按供应商分别计算</div>
              <div className="text-xs text-muted-foreground">
                开启后每个供应商各自计算窗口；关闭后所有供应商统一计算。
              </div>
            </div>
            <Switch checked={perProvider} onCheckedChange={(v) => setPerProvider(v === true)} className="shrink-0" />
          </div>

          {/* ── 命中的供应商 ── */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs">命中的供应商</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex min-h-8 w-full items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-2 text-xs outline-none select-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 hover:bg-muted/40"
                >
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                    {selectedOptions.length === 0 ? (
                      <span className="text-muted-foreground">选择供应商（不选时对全部生效）</span>
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
                  {providers.map((o) => {
                    const checked = selectedProviders.has(o.id)
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
                  {providers.length === 0 && (
                    <li className="px-2.5 py-2 text-xs text-muted-foreground">暂无供应商</li>
                  )}
                </ul>
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">不选时对全部供应商生效。</span>
          </div>
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