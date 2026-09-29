import { useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { DialogCodeEditor } from '@/components/dialog/code-editor'
import { AgentConfigVersionsDialog } from '@/components/dialog/agent-config-versions-dialog'
import { dashboardApi } from '@/lib/dashboard-api'
import type { AgentConfigFile } from '@/lib/dashboard-api'
import { toast } from '@/components/ui/toast'
import { i18n } from '@/i18n/i18n'

interface AgentConfigEditorDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly record: AgentConfigFile
  readonly onRestored?: () => void
}

export function AgentConfigEditorDialog({ open, onOpenChange, record, onRestored }: AgentConfigEditorDialogProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  // Bumping the key remounts the editor so it reloads the file after a restore.
  const [reloadKey, setReloadKey] = useState(0)
  return (
    <>
      <DialogCodeEditor
        key={reloadKey}
        mode="editable"
        open={open}
        onOpenChange={onOpenChange}
        title={record.record_name}
        subtitle={record.path}
        loadContent={() => dashboardApi.getAgentConfigFileContent(record.id)}
        onSave={(content) => dashboardApi.saveAgentConfigFileContent(record.id, content)}
        onSaved={() => toast(i18n.t('agentConfig:toast.saved'))}
        headerActions={
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
            <AppIcon name="history" data-icon="inline-start" />
            {i18n.t('agentConfig:versions.entry')}
          </Button>
        }
      />
      <AgentConfigVersionsDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        record={record}
        onRestored={() => {
          setReloadKey((key) => key + 1)
          onRestored?.()
        }}
      />
    </>
  )
}
