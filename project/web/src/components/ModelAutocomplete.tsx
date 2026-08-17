import { useEffect, useMemo, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  loadModelsDevModels,
  searchModelsDevModels,
  type ModelsDevModel,
} from '@/lib/models-dev'

type ModelAutocompleteProps = {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onPick: (model: ModelsDevModel) => void
}

export function ModelAutocomplete({ value, onChange, onPick }: ModelAutocompleteProps) {
  const [draft, setDraft] = useState(value)
  const [all, setAll] = useState<readonly ModelsDevModel[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTyped = useRef('')

  const retry = () => {
    setLoading(true)
    setLoadError(false)
    loadModelsDevModels()
      .then((models) => setAll(models))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    loadModelsDevModels()
      .then((models) => {
        if (!cancelled) setAll(models)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      if (openTimer.current) clearTimeout(openTimer.current)
    }
  }, [])

  const suggestions = useMemo(() => {
    const trimmed = draft.trim()
    if (trimmed.length === 0) return [] as readonly ModelsDevModel[]
    return searchModelsDevModels(all, trimmed)
  }, [all, draft])

  const maybeOpen = (next: string) => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (next.trim().length === 0) {
      setOpen(false)
      return
    }
    openTimer.current = setTimeout(() => {
      setOpen(true)
      setActive(0)
    }, 200)
  }

  const handleInput = (next: string) => {
    setDraft(next)
    onChange(next)
    lastTyped.current = next
    maybeOpen(next)
  }

  const pick = (model: ModelsDevModel) => {
    setDraft(model.id)
    onChange(model.id)
    onPick(model)
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (current + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (current - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(suggestions[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const anchorRef = useRef<HTMLDivElement | null>(null)

  return (
    <div ref={anchorRef} className="relative">
      <Input
        id="price-model"
        value={draft}
        onChange={(event) => handleInput(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof Node) || !anchorRef.current?.contains(next)) {
            setOpen(false)
          }
        }}
        placeholder="输入模型名称"
        autoComplete="off"
      />
      {open && !loading && !loadError && suggestions.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
          未找到匹配的模型
        </div>
      )}
      {open && loadError && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-popover px-3 py-2 shadow-md">
          <p role="alert" className="text-xs text-destructive">models.dev 数据加载失败，请检查网络</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retry}>
            重试
          </Button>
        </div>
      )}
      {open && !loadError && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <ScrollArea className="max-h-72">
            <ul className="py-1">
              {suggestions.map((model, index) => (
                <li key={`${model.providerId}:${model.id}`}>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      pick(model)
                    }}
                    onMouseEnter={() => setActive(index)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs',
                      index === active ? 'bg-accent text-accent-foreground' : 'text-foreground',
                    )}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate">{model.id}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{model.providerName}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatContext(model)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

function formatContext(model: ModelsDevModel): string {
  const parts: string[] = []
  if (model.contextLength > 0) parts.push(`${(model.contextLength / 1000).toFixed(0)}k`)
  if (model.inputPrice > 0) parts.push(`$${model.inputPrice}`)
  return parts.join(' · ')
}