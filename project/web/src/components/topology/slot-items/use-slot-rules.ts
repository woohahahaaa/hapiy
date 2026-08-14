import { useEffect, useState } from 'react'
import {
  dashboardApi,
  type RewriteRule,
  type ResponseRewriteRule,
  type HeartbeatRule,
  type ConcurrencyRule,
  type FailoverRule,
} from '@/lib/dashboard-api'
import type { SlotRuleMap } from './types'

// Fetches live rule lists for each slot type. Until each rule type has at least
// one row, the slot UI still works — the dropdown just shows "未配置规则".
export function useSlotRules(): { rules: SlotRuleMap; loading: boolean } {
  const [rules, setRules] = useState<SlotRuleMap>({
    requestModify: [],
    responseModify: [],
    autoReply: [],
    concurrency: [],
    autoSwitch: [],
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      const params = { limit: 200, offset: 0 }
      const settled = await Promise.allSettled([
        dashboardApi.listRules<RewriteRule>('rewrite', params),
        dashboardApi.listRules<ResponseRewriteRule>('rewrite-response', params),
        dashboardApi.listRules<HeartbeatRule>('heartbeat', params),
        dashboardApi.listRules<ConcurrencyRule>('concurrency', params),
        dashboardApi.listRules<FailoverRule>('failover', params),
      ])
      if (cancelled) return
      const pick = <T,>(r: PromiseSettledResult<{ readonly rules: readonly T[]; readonly total: number }>): readonly T[] =>
        r.status === 'fulfilled' ? r.value.rules : []
      setRules({
        requestModify: pick(settled[0]),
        responseModify: pick(settled[1]),
        autoReply: pick(settled[2]),
        concurrency: pick(settled[3]),
        autoSwitch: pick(settled[4]),
      })
      setLoading(false)
    }
    loadAll()
    return () => {
      cancelled = true
    }
  }, [])

  return { rules, loading }
}