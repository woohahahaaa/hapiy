import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { formatDisableCountsSummary } from '@/lib/provider-availability'
import type { ChatModelOption } from '@/lib/dashboard-api'

export type AgentModelSelection = {
  readonly model: string
  readonly providerId: string
}

export type AgentModelPickerProps = {
  readonly models: readonly ChatModelOption[]
  readonly model: string
  /** Empty string means 自动 (dispatch through the topology). */
  readonly providerId: string
  /** The selected model is no longer offered by the current topology. */
  readonly unavailable?: boolean
  /** Called when the list opens, so the picker can refetch first. */
  readonly onRefresh?: () => void
  readonly onChange: (next: AgentModelSelection) => void
}

// AgentModelPicker is a two-column cascader: the trigger opens the model list,
// choosing a model widens the panel with that model's providers, and the
// trigger then reads "model-provider". Mirrors the Ant Design province/city
// interaction instead of two independent selects.
export function AgentModelPicker({ models, model, providerId, unavailable = false, onRefresh, onChange }: AgentModelPickerProps) {
  const { t } = useTranslation('agentPanel')
  const [open, setOpen] = useState(false)
  const [draftModel, setDraftModel] = useState(model)

  const providers = useMemo(
    () => models.find((entry) => entry.model === draftModel)?.providers ?? [],
    [models, draftModel],
  )

  const providerLabel = providerId
    ? (models
        .find((entry) => entry.model === model)
        ?.providers.find((provider) => provider.id === providerId)?.name ?? providerId)
    : t('providerAutoShort')

  const triggerLabel = model ? `${model}-${providerLabel}` : t('modelPlaceholder')

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      // The available list follows the topology; refresh before the operator
      // picks so a just-dropped model cannot be chosen from a stale list.
      onRefresh?.()
      setDraftModel(model)
    }
  }

  const handleModel = (nextModel: string) => {
    setDraftModel(nextModel)
    if (nextModel !== model) {
      // Commit the model immediately with 自动; picking a provider below
      // replaces that second half.
      onChange({ model: nextModel, providerId: '' })
    }
  }

  const commitProvider = (nextProviderId: string) => {
    onChange({ model: draftModel, providerId: nextProviderId })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 max-w-[220px] items-center gap-1 rounded-lg bg-muted px-2 text-xs whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50"
          aria-label={triggerLabel}
        >
          <AppIcon name="setting" size={14} className="shrink-0" />
          <span className={cn('truncate', !model && 'text-muted-foreground')}>{triggerLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex">
          <div className="w-52 shrink-0 p-1">
            <div className="px-2 py-1 text-[11px] text-muted-foreground">{t('modelLabel')}</div>
            <div className="max-h-72 overflow-y-auto">
              {models.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">{t('modelPlaceholder')}</div>
              )}
              {models.map((entry) => (
                <button
                  key={entry.model}
                  type="button"
                  onClick={() => handleModel(entry.model)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                    entry.model === draftModel && 'bg-muted font-medium',
                  )}
                >
                  <span className="truncate">{entry.model}</span>
                  {entry.model === draftModel && (
                    <AppIcon name="chevron_right" size={14} className="shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {draftModel && (
            <div className="w-56 shrink-0 border-s border-border p-1">
              <div className="px-2 py-1 text-[11px] text-muted-foreground">{t('providerLabel')}</div>
              <div className="max-h-72 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => commitProvider('')}
                  className={cn(
                    'flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                    providerId === '' && 'bg-muted font-medium',
                  )}
                >
                  {t('providerAuto')}
                </button>
                {providers.length === 0 && (
                  <div className="px-2 py-2 text-xs text-muted-foreground">{t('noProviders')}</div>
                )}
                {providers.map((provider) => {
                  const disableNote = formatDisableCountsSummary(provider)
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      disabled={provider.autoDisabled}
                      onClick={() => commitProvider(provider.id)}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
                        providerId === provider.id && 'bg-muted font-medium',
                      )}
                    >
                      <span className="truncate">{provider.name}</span>
                      {disableNote && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">{disableNote}</span>
                      )}
                      {!provider.workflowEnabled && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {t('providerNoTopologySuffix')}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
