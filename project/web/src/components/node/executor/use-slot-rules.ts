import { useCallback, useEffect, useState } from 'react'
import {
  dashboardApi,
  type RewriteRule,
  type ResponseRewriteRule,
  type FailoverRule,
  type RuleType,
} from '@/lib/dashboard-api'
import type { SlotRuleMap } from '@/components/node/slot/items'

// 槽位规则下拉框按"插槽类型"独立管理加载/失败状态；并发控制使用内联配置，
// 不依赖规则表，故只包含 rewrite / rewrite-response / failover 三种。
export type SlotRuleKey = keyof SlotRuleMap

export interface RuleTypeStatus {
  loading: boolean
  error: string | null
}

export type SlotRuleStatusMap = Record<SlotRuleKey, RuleTypeStatus>

export const SLOT_RULE_KEYS: readonly SlotRuleKey[] = [
  'requestModify',
  'responseModify',
  'autoSwitch',
]

// 插槽类型 → 后端规则类型（返回结构不同，统一按 SlotRuleMap 的值类型收窄）。
const API_TYPE_BY_SLOT: Record<SlotRuleKey, RuleType> = {
  requestModify: 'rewrite',
  responseModify: 'rewrite-response',
  autoSwitch: 'failover',
}

function emptyRules(): SlotRuleMap {
  return {
    requestModify: [],
    responseModify: [],
    autoSwitch: [],
  }
}

// 初始状态：全部类型的规则都尚未加载完成。
function initialStatus(): SlotRuleStatusMap {
  return {
    requestModify: { loading: true, error: null },
    responseModify: { loading: true, error: null },
    autoSwitch: { loading: true, error: null },
  }
}

function settledStatus(): SlotRuleStatusMap {
  return {
    requestModify: { loading: false, error: null },
    responseModify: { loading: false, error: null },
    autoSwitch: { loading: false, error: null },
  }
}

// 拉取单个插槽类型的规则列表（参数保持与后端接口一致：limit:200, offset:0）。
// 初始全量加载与下拉打开时的单类型刷新共用此函数；单独导出便于单测直接
// mock dashboardApi.listRules 验证成功/失败分支。
export async function fetchSlotRuleType(key: SlotRuleKey): Promise<SlotRuleMap[SlotRuleKey]> {
  const params = { limit: 200, offset: 0 }
  switch (key) {
    case 'requestModify':
      return (await dashboardApi.listRules<RewriteRule>(API_TYPE_BY_SLOT.requestModify, params)).rules
    case 'responseModify':
      return (await dashboardApi.listRules<ResponseRewriteRule>(API_TYPE_BY_SLOT.responseModify, params)).rules
    case 'autoSwitch':
      return (await dashboardApi.listRules<FailoverRule>(API_TYPE_BY_SLOT.autoSwitch, params)).rules
  }
}

// 各类型规则的结构不同，allSettled 的联合结果无法直接赋给对应槽位键，
// 这里用显式 switch 做类型收窄（索引与 key 的对应关系由调用方保证）。
function assignRuleList(rules: SlotRuleMap, key: SlotRuleKey, list: SlotRuleMap[SlotRuleKey]): void {
  switch (key) {
    case 'requestModify':
      rules.requestModify = list as readonly RewriteRule[]
      return
    case 'responseModify':
      rules.responseModify = list as readonly ResponseRewriteRule[]
      return
    case 'autoSwitch':
      rules.autoSwitch = list as readonly FailoverRule[]
      return
  }
}

// 初始全量加载：Promise.allSettled 五种类型，成功类型拿到列表、失败类型记录
// error（保持空列表），互不影响。返回的 status 中所有类型都会结束 loading。
export async function loadAllSlotRules(): Promise<{ rules: SlotRuleMap; status: SlotRuleStatusMap }> {
  const settled = await Promise.allSettled(SLOT_RULE_KEYS.map((key) => fetchSlotRuleType(key)))
  const rules = emptyRules()
  const status = settledStatus()
  SLOT_RULE_KEYS.forEach((key, index) => {
    const result = settled[index]
    if (result.status === 'fulfilled') {
      assignRuleList(rules, key, result.value)
    } else {
      status[key] = { loading: false, error: '加载失败' }
    }
  })
  return { rules, status }
}

// Fetches live rule lists for each slot type. Until each rule type has at least
// one row, the slot UI still works — the dropdown just shows "暂无可用规则"。
export function useSlotRules(): {
  rules: SlotRuleMap
  loading: boolean
  status: SlotRuleStatusMap
  refreshRuleType: (key: SlotRuleKey) => void
} {
  const [rules, setRules] = useState<SlotRuleMap>(emptyRules)
  const [status, setStatus] = useState<SlotRuleStatusMap>(initialStatus)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      const next = await loadAllSlotRules()
      if (cancelled) return
      setRules(next.rules)
      setStatus(next.status)
      setLoading(false)
    }
    void loadAll()
    return () => {
      cancelled = true
    }
  }, [])

  // 打开某个类型的下拉时调用：仅刷新该类型的规则列表，不清空其它类型数据。
  // 成功写入最新列表并清空 error；失败仅将该类型标记为 加载失败。
  const refreshRuleType = useCallback((key: SlotRuleKey) => {
    setStatus((prev) => ({ ...prev, [key]: { loading: true, error: null } }))
    void fetchSlotRuleType(key)
      .then((list) => {
        setRules((prev) => ({ ...prev, [key]: list }))
        setStatus((prev) => ({ ...prev, [key]: { loading: false, error: null } }))
      })
      .catch(() => {
        setStatus((prev) => ({ ...prev, [key]: { loading: false, error: '加载失败' } }))
      })
  }, [])

  return { rules, loading, status, refreshRuleType }
}