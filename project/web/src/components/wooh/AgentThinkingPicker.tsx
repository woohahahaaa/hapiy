import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ChatReasoningEffort } from '@/lib/dashboard-api'

export type AgentThinkingPickerProps = {
  readonly effort: ChatReasoningEffort
  readonly onChange: (next: ChatReasoningEffort) => void
}

type ThinkingKey = 'thinkingDefault' | 'thinkingLow' | 'thinkingMedium' | 'thinkingHigh'

const LEVELS: readonly { value: ChatReasoningEffort; key: ThinkingKey }[] = [
  { value: '', key: 'thinkingDefault' },
  { value: 'low', key: 'thinkingLow' },
  { value: 'medium', key: 'thinkingMedium' },
  { value: 'high', key: 'thinkingHigh' },
]

// AgentThinkingPicker is the composer's thinking-level chip. '' means the
// provider default; a picked level is forwarded with the turn as
// reasoning.effort, so it only affects this conversation's next messages.
export function AgentThinkingPicker({ effort, onChange }: AgentThinkingPickerProps) {
  const { t } = useTranslation('agentPanel')
  const [open, setOpen] = useState(false)
  const active = LEVELS.find((level) => level.value === effort) ?? LEVELS[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('thinkingLabel')}
          title={t('thinkingHint')}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50"
        >
          <AppIcon name="magic" size={14} className="shrink-0" />
          <span>{t(active.key)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1">
        <div className="px-2 py-1 text-[11px] text-muted-foreground">{t('thinkingLabel')}</div>
        {LEVELS.map((level) => (
          <button
            key={level.value || 'default'}
            type="button"
            onClick={() => {
              onChange(level.value)
              setOpen(false)
            }}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
              effort === level.value && 'bg-muted font-medium',
            )}
          >
            <span>{t(level.key)}</span>
            {effort === level.value && <AppIcon name="check" size={14} className="shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
