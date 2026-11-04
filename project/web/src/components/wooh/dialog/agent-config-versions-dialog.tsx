import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { DiffView } from '@/components/wooh/DiffView'
import { JsonTokens } from '@/components/wooh/JsonHighlight'
import {
  dashboardApi,
  type AgentConfigFile,
  type AgentConfigVersionList,
} from '@/lib/dashboard-api'
import {
  VersionsModal,
  type VersionPreviewTarget,
  type VersionsModalList,
} from '@/components/wooh/dialog/versions-modal'

interface AgentConfigVersionsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly record: AgentConfigFile
  readonly onRestored: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 配置文件版本预览：JSON 高亮，或与当前文件做差异对比。 */
function AgentConfigVersionPreview({
  target,
  value,
  current,
}: {
  readonly target: VersionPreviewTarget
  readonly value: string
  readonly current: string | null
}) {
  const { t } = useTranslation('agentConfig')
  const [compare, setCompare] = useState(false)
  const compareReady = current !== null && current !== value

  return (
    <>
      {target.kind === 'version' && (
        <Button
          variant={compare ? 'default' : 'outline'}
          size="sm"
          className="absolute top-2 left-2 z-10"
          onClick={() => setCompare((v) => !v)}
          disabled={!compareReady}
        >
          <AppIcon name="call_split" data-icon="inline-start" />
          {t('versions.compareCurrent')}
        </Button>
      )}
      {compare && compareReady ? (
        <div className="absolute inset-0 overflow-auto p-3 pt-12">
          <DiffView before={current} after={value} />
        </div>
      ) : (
        <pre className="absolute inset-0 m-0 overflow-auto p-3 pt-12 font-mono text-xs leading-relaxed whitespace-pre">
          <JsonTokens text={value} />
        </pre>
      )}
    </>
  )
}

export function AgentConfigVersionsDialog({
  open,
  onOpenChange,
  record,
  onRestored,
}: AgentConfigVersionsDialogProps) {
  const { t } = useTranslation('agentConfig')

  const summary = (lines: number, size: number) =>
    t('versions.summary', { lines, size: formatSize(size) })

  const toList = (data: AgentConfigVersionList): VersionsModalList => ({
    current: data.current
      ? {
          archived: data.current.archived,
          summary: summary(data.current.lines, data.current.size),
          updatedAt: data.current.updatedAt,
        }
      : null,
    versions: data.versions.map((version) => ({
      id: version.id,
      createdAt: version.createdAt,
      summary: summary(version.lines, version.size),
    })),
  })

  return (
    <VersionsModal<string>
      open={open}
      onClose={() => onOpenChange(false)}
      messages={{
        title: t('versions.title'),
        current: t('versions.current'),
        archived: t('versions.archived'),
        archive: t('versions.archive'),
        restore: t('versions.restore'),
        empty: t('versions.empty'),
        loading: t('common:state.loading'),
        previewHint: t('versions.previewHint'),
        restoreTitle: t('versions.restoreDialogTitle'),
        restoreBody: t('versions.restoreDialogBody'),
        restoreConfirm: t('versions.restoreConfirm'),
        archivedToast: t('versions.archivedToast'),
        restoredToast: t('versions.restored'),
        loadFailed: t('errors.loadFailed'),
        previewFailed: t('errors.readFailed'),
        archiveFailed: t('versions.archiveFailed'),
        restoreFailed: t('versions.restoreFailed'),
      }}
      source={{
        list: async () =>
          toList(await dashboardApi.listAgentConfigFileVersions(record.id)),
        currentPreview: () => dashboardApi.getAgentConfigFileContent(record.id),
        versionPreview: (id) =>
          dashboardApi.getAgentConfigFileVersion(record.id, id),
        archive: async () =>
          toList(await dashboardApi.archiveAgentConfigFileVersion(record.id)),
        restore: async (id) =>
          toList(
            await dashboardApi.restoreAgentConfigFileVersion(record.id, id)
          ),
        onRestored,
      }}
      renderPreview={({ target, value, current }) => (
        <AgentConfigVersionPreview
          key={target.kind === 'current' ? 'current' : target.id}
          target={target}
          value={value}
          current={current}
        />
      )}
    />
  )
}
