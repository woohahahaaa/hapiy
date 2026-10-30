import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { AgentDirectDialog } from '@/components/wooh/AgentDirectDialog'
import type { AgentDirectChannel } from '@/components/wooh/AgentDirectDialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ChatModelOption } from '@/lib/dashboard-api'

export type AgentModelSelection = {
  readonly model: string
  /** When set, the turn talks to this channel and skips topology routing. */
  readonly direct?: AgentDirectChannel | null
}

export type AgentModelPickerProps = {
  readonly models: readonly ChatModelOption[]
  readonly model: string
  /** Manual channel currently selected, if any. */
  readonly direct?: AgentDirectChannel | null
  /** The selected model is no longer offered by the current topology. */
  readonly unavailable?: boolean
  /** Called when the list opens, so the picker can refetch first. */
  readonly onRefresh?: () => void
  readonly onChange: (next: AgentModelSelection) => void
}

// AgentModelPicker picks the model only. How the request reaches a provider is
// the gateway's decision (topology + failover), exactly like an external client
// calling /v1/chat/completions — there is no per-chat provider pin. 直连 is the
// only channel that skips the gateway, and its dialog says so.
export function AgentModelPicker({ models, model, direct = null, unavailable = false, onRefresh, onChange }: AgentModelPickerProps) {
  const { t } = useTranslation('agentPanel')
  const [open, setOpen] = useState(false)
  const [directOpen, setDirectOpen] = useState(false)

  const triggerLabel = direct
    ? `${t('directPrefix')}${model}-${direct.providerName}`
    : model || t('modelPlaceholder')

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      // The available list follows the topology; refresh before the operator
      // picks so a just-dropped model cannot be chosen from a stale list.
      onRefresh?.()
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 max-w-[220px] items-center gap-1 rounded-lg px-2 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring/50',
            unavailable
              ? 'bg-warning/10 text-warning hover:bg-warning/15'
              : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
          )}
          aria-label={unavailable ? `${triggerLabel}，${t('modelUnavailable')}` : triggerLabel}
          title={unavailable ? t('modelUnavailableHint') : undefined}
        >
          <AppIcon name={unavailable ? 'caution' : 'setting'} size={14} className="shrink-0" />
          <span className={cn('truncate', !model && 'text-muted-foreground')}>{triggerLabel}</span>
          {unavailable && <span className="shrink-0 text-[10px]">{t('modelUnavailable')}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="px-2 py-1 text-[11px] text-muted-foreground">{t('modelLabel')}</div>
        <div className="max-h-72 overflow-y-auto">
          {models.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">{t('modelPlaceholder')}</div>
          )}
          {models.map((entry) => {
            const stale = unavailable && entry.model === model
            return (
              <button
                key={entry.model}
                type="button"
                onClick={() => {
                  onChange({ model: entry.model })
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                  entry.model === model && 'bg-muted font-medium',
                )}
              >
                <span className={cn('truncate', stale && 'text-warning')}>{entry.model}</span>
                {stale ? (
                  <span className="shrink-0 text-[10px] text-warning">{t('modelUnavailable')}</span>
                ) : entry.model === model ? (
                  <AppIcon name="check" size={14} className="shrink-0 text-muted-foreground" />
                ) : null}
              </button>
            )
          })}
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setDirectOpen(true)
              }}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                direct && 'bg-muted font-medium',
              )}
            >
              <AppIcon name="link" size={14} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{t('direct')}</span>
            </button>
          </div>
        </div>
      </PopoverContent>
      </Popover>
      <AgentDirectDialog
        open={directOpen}
        onOpenChange={setDirectOpen}
        initial={direct}
        initialModel={model}
        onConfirm={(channel, nextModel) => {
          onChange({ model: nextModel, direct: channel })
        }}
      />
    </>
  )
}
