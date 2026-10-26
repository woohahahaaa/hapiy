import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { cn } from '@/lib/utils'
import type { ChatSendMode } from '@/lib/dashboard-api'

export type AgentModeToggleProps = {
  readonly mode: ChatSendMode
  readonly onChange: (next: ChatSendMode) => void
}

// AgentModeToggle is the chat/execute switch in the composer. 「聊天」 is
// read-only: the turn may look things up and answer, but the backend withholds
// every write tool. 「执行」 keeps the full console agent, which can carry out
// changes through the UI.
export function AgentModeToggle({ mode, onChange }: AgentModeToggleProps) {
  const { t } = useTranslation('agentPanel')
  const options: readonly { value: ChatSendMode; icon: string; label: string; hint: string }[] = [
    { value: 'chat', icon: 'chat', label: t('modeChat'), hint: t('modeChatHint') },
    { value: 'execute', icon: 'bolt', label: t('modeExecute'), hint: t('modeExecuteHint') },
  ]

  return (
    <div
      className="inline-flex items-center rounded-lg bg-muted p-0.5 text-[11px]"
      role="group"
      aria-label={t('modeLabel')}
    >
      {options.map((option) => {
        const active = mode === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={option.hint}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 transition-colors',
              active
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <AppIcon name={option.icon} size={12} />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
