import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  // When false (default) this is a plain input: no models.dev fetch, no
  // candidate dropdown, and typing only updates the local draft. When true the
  // first candidate is the bare model name (no provider); the rest carry the
  // models.dev provider they were found under and call onPickProvider.
  readonly searchable?: boolean
  readonly onPickProvider?: (providerName: string) => void
}

// Candidate rows: the first is always the bare committed model name, the rest
// are models.dev matches rendered with their upstream provider.
export function ModelAutocomplete({ value, onChange, searchable = false, onPickProvider }: ModelAutocompleteProps) {
  const { t } = useTranslation('provider')
  const [draft, setDraft] = useState(value)
  const [all, setAll] = useState<readonly ModelsDevModel[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)

  // Reflect external value changes (pick, blur validation, form reset).
  useEffect(() => {
    setDraft(value)
  }, [value])

  const retry = () => {
    setLoading(true)
    setLoadError(false)
    loadModelsDevModels()
      .then((models) => setAll(models))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!searchable) return
    let cancelled = false
    loadModelsDevModels()
      .then((models) => {
        if (!cancelled) {
          setAll(models)
          setLoadError(false)
        }
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
  }, [searchable])

  const suggestions = useMemo(() => {
    if (!searchable) return [] as readonly ModelsDevModel[]
    const trimmed = draft.trim()
    if (trimmed.length === 0) return [] as readonly ModelsDevModel[]
    // One row per logical model: dedupe by lowercase id so a model published
    // under multiple providers (or with casing drift across providers) shows
    // up only once per provider variant.
    const seen = new Set<string>()
    const result: ModelsDevModel[] = []
    for (const model of searchModelsDevModels(all, trimmed)) {
      const key = `${model.id.toLowerCase()}|${model.providerName.toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push(model)
      }
    }
    return result
  }, [all, draft, searchable])

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

  // The only path that notifies the parent; typing never does.
  const commit = (next: string) => {
    setDraft(next)
    onChange(next)
  }

  const handleInput = (next: string) => {
    setDraft(next)
    if (searchable) maybeOpen(next)
  }

  const handleBlur = () => {
    commit(draft.trim())
    setOpen(false)
  }

  const pick = (model: ModelsDevModel) => {
    commit(model.id)
    setOpen(false)
  }

  const pickWithProvider = (model: ModelsDevModel) => {
    commit(model.id)
    onPickProvider?.(model.providerName)
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchable || !open || suggestions.length === 0) return
    const maxActive = suggestions.length // 0 = bare name, 1..n = providers
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (current + 1) % (maxActive + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (current - 1 + maxActive + 1) % (maxActive + 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (active === 0) {
        commit(draft.trim())
        setOpen(false)
      } else {
        pick(suggestions[active - 1])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={anchorRef} className="relative">
      <Input
        id="price-model"
        value={draft}
        onChange={(event) => handleInput(event.target.value)}
        onPointerDown={() => {
          if (searchable && draft.trim().length > 0) {
            setOpen(true)
            setActive(0)
          }
        }}
        onFocus={() => {
          if (searchable && draft.trim().length > 0) {
            setOpen(true)
            setActive(0)
          }
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof Node) || !anchorRef.current?.contains(next)) {
            handleBlur()
          }
        }}
        placeholder={t('autocomplete.placeholder')}
        autoComplete="off"
      />
      {searchable && open && loading && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xs border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
          {t('autocomplete.loading')}
        </div>
      )}
      {searchable && open && !loading && !loadError && suggestions.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xs border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
          {t('autocomplete.noMatch')}
        </div>
      )}
      {searchable && open && loadError && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xs border border-border bg-popover px-3 py-2 shadow-md">
          <p role="alert" className="text-xs text-destructive">{t('errors.modelsDevLoad')}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retry}>
            {t('common:action.retry')}
          </Button>
        </div>
      )}
      {searchable && open && !loadError && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xs border border-border bg-popover shadow-md">
          <ScrollArea className="h-72">
            <ul className="py-1">
              <li>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    commit(draft.trim())
                    setOpen(false)
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-primary/10"
                >
                  <span className="truncate">{draft.trim()}</span>
                </button>
              </li>
              {suggestions.map((model, index) => {
                const displayId = model.id.toLowerCase()
                return (
                  <li key={`${displayId}|${model.providerName.toLowerCase()}`}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        pickWithProvider(model)
                      }}
                      onMouseEnter={() => setActive(index + 1)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs',
                        active === index + 1 ? 'bg-primary text-primary-foreground' : 'text-foreground',
                      )}
                    >
                      <span className="truncate">{displayId}</span>
                      <span className={cn('shrink-0', active === index + 1 ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                        {model.providerName}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}