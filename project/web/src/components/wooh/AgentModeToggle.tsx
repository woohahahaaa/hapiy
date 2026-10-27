import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import type { ChatSendMode } from '@/lib/dashboard-api'

export type AgentModeToggleProps = {
  readonly mode: ChatSendMode
  readonly onChange: (next: ChatSendMode) => void
}

// AgentModeToggle is the write-access switch in the composer. Off is read-only:
// the turn may look things up and answer, but the backend withholds every write
// tool. On keeps the full console agent, which can carry out changes through
// the UI.
export function AgentModeToggle({ mode, onChange }: AgentModeToggleProps) {
  const { t } = useTranslation('agentPanel')
  const execute = mode === 'execute'

  return (
    <label className="flex cursor-pointer items-center gap-2 pl-1">
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {t('modeLabel')}
      </span>
      <Switch
        size="sm"
        checked={execute}
        onCheckedChange={(checked) => onChange(checked ? 'execute' : 'chat')}
        title={execute ? t('modeExecuteHint') : t('modeChatHint')}
        aria-label={t('modeLabel')}
      />
    </label>
  )
}
