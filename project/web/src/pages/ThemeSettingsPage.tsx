import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { toast } from '@/components/ui/toast'
import { i18n } from '@/i18n/i18n'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import {
  DEFAULT_THEME_ID,
  THEME_DARK_KEY,
  THEME_LIGHT_KEY,
  THEME_REGISTRY_KEY,
  fetchTheme,
  getThemeState,
  loadThemeState,
  removeTheme,
  setInstalledThemes,
  setThemeSelection,
  subscribeTheme,
  upsertTheme,
  type InstalledTheme,
} from '@/lib/theme-registry'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

type ThemeRow = {
  readonly id: string
  readonly name: string
  readonly theme: InstalledTheme | null
}

const PREVIEW_KEYS = ['--background', '--foreground', '--primary', '--accent'] as const

function toErrorMessage(err: unknown): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : i18n.t('settings:errors.operationFailed')
}

function ThemePreview({ theme }: { theme: InstalledTheme | null }) {
  if (!theme) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex overflow-hidden border border-border">
      {PREVIEW_KEYS.map((key) => (
        <span
          key={key}
          className="block size-4"
          style={{ backgroundColor: theme.light[key] ?? 'transparent' }}
        />
      ))}
    </span>
  )
}

export function ThemeSettingsPage() {
  const { t } = useTranslation('settings')
  const store = useSyncExternalStore(subscribeTheme, getThemeState, getThemeState)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [installOpen, setInstallOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<InstalledTheme | null>(null)
  const [deleting, setDeleting] = useState(false)

  const runLoad = useCallback(() => {
    return loadThemeState()
      .then(() => setState({ kind: 'ready' }))
      .catch((err) => setState({ kind: 'error', message: toErrorMessage(err) }))
  }, [])

  useEffect(() => {
    void runLoad()
  }, [runLoad])

  const handleRetry = () => {
    setState({ kind: 'loading' })
    void runLoad()
  }

  const rows: ThemeRow[] = [
    { id: DEFAULT_THEME_ID, name: t('theme.defaultName'), theme: null },
    ...store.themes.map((theme) => ({ id: theme.id, name: theme.name, theme })),
  ]

  const handleSelect = async (mode: 'dark' | 'light', id: string) => {
    const key = mode === 'dark' ? THEME_DARK_KEY : THEME_LIGHT_KEY
    try {
      await dashboardApi.updateSetting(key, id === DEFAULT_THEME_ID ? '' : id)
      setThemeSelection(mode, id)
    } catch (err) {
      toast.error(toErrorMessage(err))
    }
  }

  const handleInstall = async () => {
    const target = url.trim()
    if (target === '') return
    setInstalling(true)
    try {
      const theme = await fetchTheme(target)
      const next = upsertTheme(store.themes, theme)
      await dashboardApi.updateSetting(THEME_REGISTRY_KEY, JSON.stringify(next))
      setInstalledThemes(next)
      toast(t('theme.installed', { name: theme.name }))
      setInstallOpen(false)
      setUrl('')
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      toast.error(
        message === 'invalid' || message === 'no-vars'
          ? t('theme.invalidTheme')
          : t('theme.fetchFailed'),
      )
    } finally {
      setInstalling(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const next = removeTheme(store.themes, deleteTarget.id)
      await dashboardApi.updateSetting(THEME_REGISTRY_KEY, JSON.stringify(next))
      if (store.darkId === deleteTarget.id) {
        await dashboardApi.updateSetting(THEME_DARK_KEY, '')
      }
      if (store.lightId === deleteTarget.id) {
        await dashboardApi.updateSetting(THEME_LIGHT_KEY, '')
      }
      setInstalledThemes(next)
      toast(t('theme.deleted', { name: deleteTarget.name }))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader description={t('theme.pageDescription')} />
      <div className="flex-1 flex flex-col gap-6 p-6">
        {state.kind === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <AppIcon name="progress_activity" size={16} className="animate-spin" /> {t('loading')}
          </div>
        )}

        {state.kind === 'error' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AppIcon name="warning" size={32} className="text-destructive" />
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <AppIcon name="refresh" data-icon="inline-start" /> {t('common:action.retry')}
            </Button>
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AppIcon name="palette" size={16} /> {t('theme.modeTitle')}
                </CardTitle>
                <CardDescription>{t('theme.modeDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-medium">{t('theme.darkLabel')}</div>
                    <Select
                      value={store.darkId}
                      onValueChange={(v) => void handleSelect('dark', v)}
                    >
                      <SelectTrigger className="w-full" aria-label={t('theme.darkLabel')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {rows.map((row) => (
                            <SelectItem key={row.id} value={row.id}>
                              {row.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-medium">{t('theme.lightLabel')}</div>
                    <Select
                      value={store.lightId}
                      onValueChange={(v) => void handleSelect('light', v)}
                    >
                      <SelectTrigger className="w-full" aria-label={t('theme.lightLabel')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {rows.map((row) => (
                            <SelectItem key={row.id} value={row.id}>
                              {row.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <AppIcon name="settings" size={16} /> {t('theme.installedTitle')}
                    </CardTitle>
                    <CardDescription>{t('theme.installedDescription')}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setInstallOpen(true)}>
                    <AppIcon name="add" data-icon="inline-start" /> {t('theme.installButton')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">{t('theme.colName')}</th>
                      <th className="px-3 py-2 text-left font-medium">{t('theme.colPreview')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-2">
                            <span className="font-medium">{row.name}</span>
                            {row.theme === null && (
                              <Badge variant="outline">{t('theme.builtin')}</Badge>
                            )}
                            {store.darkId === row.id && (
                              <Badge variant="secondary">{t('theme.inUseDark')}</Badge>
                            )}
                            {store.lightId === row.id && (
                              <Badge variant="secondary">{t('theme.inUseLight')}</Badge>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <ThemePreview theme={row.theme} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {row.theme !== null && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleteTarget(row.theme)}
                            >
                              {t('theme.delete')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog
        open={installOpen}
        onOpenChange={(open) => {
          if (!open && !installing) {
            setInstallOpen(false)
            setUrl('')
          }
        }}
      >
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('theme.installDialogTitle')}</DialogTitle>
            <DialogDescription>{t('theme.installDialogDescription')}</DialogDescription>
          </DialogHeader>
          <DialogScrollBody
            footer={
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setInstallOpen(false)
                    setUrl('')
                  }}
                  disabled={installing}
                >
                  {t('common:action.cancel')}
                </Button>
                <Button onClick={() => void handleInstall()} disabled={installing || url.trim() === ''}>
                  {installing && (
                    <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />
                  )}
                  {installing ? t('theme.installing') : t('theme.install')}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="theme-url">
                {t('theme.urlLabel')}
              </label>
              <Input
                id="theme-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t('theme.urlPlaceholder')}
                autoFocus
              />
            </div>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('theme.confirmDeleteTitle')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody
            footer={
              <>
                <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                  {t('common:action.cancel')}
                </Button>
                <Button onClick={() => void handleDelete()} disabled={deleting}>
                  {deleting && (
                    <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />
                  )}
                  {t('theme.delete')}
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">
              {deleteTarget ? t('theme.confirmDeleteDescription', { name: deleteTarget.name }) : ''}
            </p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}
