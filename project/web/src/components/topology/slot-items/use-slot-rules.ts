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
      const settled = await Promise.allSettled([
        dashboardApi.listRules<RewriteRule>('rewrite'),
        dashboardApi.listRules<ResponseRewriteRule>('rewrite-response'),
        dashboardApi.listRules<HeartbeatRule>('heartbeat'),
        dashboardApi.listRules<ConcurrencyRule>('concurrency'),
        dashboardApi.listRules<FailoverRule>('failover'),
      ])
      if (cancelled) return
      setRules({
        requestModify: settled[0].status === 'fulfilled' ? settled[0].value : [],
        responseModify: settled[1].status === 'fulfilled' ? settled[1].value : [],
        autoReply: settled[2].status === 'fulfilled' ? settled[2].value : [],
        concurrency: settled[3].status === 'fulfilled' ? settled[3].value : [],
        autoSwitch: settled[4].status === 'fulfilled' ? settled[4].value : [],
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