import { DialogCodeEditor } from '@/components/dialog/code-editor'
import { dashboardApi } from '@/lib/dashboard-api'
import type { AgentConfigFile } from '@/lib/dashboard-api'
import { toast } from '@/components/ui/toast'
import { i18n } from '@/i18n/i18n'

interface AgentConfigEditorDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly record: AgentConfigFile
}

export function AgentConfigEditorDialog({ open, onOpenChange, record }: AgentConfigEditorDialogProps) {
  return (
    <DialogCodeEditor
      mode="editable"
      open={open}
      onOpenChange={onOpenChange}
      title={record.record_name}
      subtitle={record.path}
      loadContent={() => dashboardApi.getAgentConfigFileContent(record.id)}
      onSave={(content) => dashboardApi.saveAgentConfigFileContent(record.id, content)}
      onSaved={() => toast(i18n.t('agentConfig:toast.saved'))}
    />
  )
}
