import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { createDebouncedCommit, type DebouncedCommit } from './debounce'
import type { ConcurrencySlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import { parseConcurrencyNodeConfig, type ConcurrencyNodeConfig } from '@/lib/dashboard-api'

export interface NodeExecutorConcurrencyProps extends SlotItemDragProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  entry: ConcurrencySlotEntry
  onChange: (next: ConcurrencySlotEntry) => void
  onDelete: () => void
}

const CONCURRENCY_DEBOUNCE_MS = 400

interface ConcurrencyNumberProps {
  value: number
  onCommit: (next: number) => void
  'aria-label'?: string
}

// 内嵌在文本流里的迷你数字输入：防抖 + 失焦提交，非法输入时还原（同权重输入）。
function ConcurrencyNumber({ value, onCommit, ...rest }: ConcurrencyNumberProps) {
  const [text, setText] = useState(() => String(value))
  const debouncerRef = useRef<DebouncedCommit<number> | null>(null)
  const onCommitRef = useRef(onCommit)
  useEffect(() => {
    onCommitRef.current = onCommit
  })
  useEffect(() => {
    debouncerRef.current = createDebouncedCommit<number>(CONCURRENCY_DEBOUNCE_MS, (v) => {
      onCommitRef.current(v)
    })
    return () => {
      debouncerRef.current?.dispose()
      debouncerRef.current = null
    }
  }, [])

  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setText(String(value))
  }

  const parsed = Number(text)
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= 1

  return (
    <Input
      type="number"
      size="sm"
      min={1}
      step={1}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        if (valid) debouncerRef.current?.schedule(Math.max(1, Math.floor(parsed)))
      }}
      onBlur={() => {
        debouncerRef.current?.flush()
        if (!valid) setText(String(value))
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="nodrag nopan w-12 px-1 py-0 text-center"
      {...rest}
    />
  )
}

// 并发控制业务节点：槽位内的一条并行控制条目。配置文件直接在节点框上编辑
// （「每 X 分钟内最多 N 条」的数字内嵌为输入框），不区分供应商，不再弹窗。
export function NodeExecutorConcurrency({ entry, onChange, onDelete, token, picked, onPickToken, ...drag }: NodeExecutorConcurrencyProps) {
  const config = parseConcurrencyNodeConfig(entry.config)

  const commit = (patch: Partial<ConcurrencyNodeConfig>) =>
    onChange({ ...entry, config: { ...config, ...patch } })

  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
      token={token}
      picked={picked}
      onPickToken={onPickToken}
      {...drag}
    >
      <div className="min-w-0 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <span>每</span>
          <ConcurrencyNumber aria-label="时间窗口（分钟）" value={config.windowMinutes} onCommit={(v) => commit({ windowMinutes: v })} />
          <span>分钟内最多</span>
          <ConcurrencyNumber aria-label="并发上限（条）" value={config.maxCount} onCommit={(v) => commit({ maxCount: v })} />
          <span>条</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">所有请求共用一个滑动窗口</div>
      </div>
    </SlotItemCard>
  )
}