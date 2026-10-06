import { useCallback, useEffect, useState } from 'react'

import { dashboardApi, DashboardApiError, type UpdateStatus } from '@/lib/dashboard-api'

// useUpdateStatus polls the self-update endpoint so the sidebar's green dot and
// the version dialog stay in sync without a page reload. `refresh` re-reads the
// cached snapshot (used while waiting for a restarted backend), `check` forces
// a fresh check (the "检查更新" button), and `apply` starts the upgrade.
export function useUpdateStatus(intervalMs = 60_000) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  const refresh = useCallback(async (): Promise<UpdateStatus | null> => {
    try {
      const next = await dashboardApi.getUpdateStatus()
      setStatus(next)
      return next
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), intervalMs)
    return () => window.clearInterval(id)
  }, [refresh, intervalMs])

  const check = useCallback(async (): Promise<UpdateStatus | null> => {
    try {
      const next = await dashboardApi.checkUpdate()
      setStatus(next)
      return next
    } catch {
      return null
    }
  }, [])

  const apply = useCallback(async (): Promise<{ readonly ok: boolean; readonly message: string }> => {
    try {
      return await dashboardApi.applyUpdate()
    } catch (error) {
      const message = error instanceof DashboardApiError ? error.message : ''
      return { ok: false, message }
    }
  }, [])

  return { status, refresh, check, apply }
}
