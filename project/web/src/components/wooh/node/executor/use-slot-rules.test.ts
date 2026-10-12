import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/dashboard-api', () => ({
  dashboardApi: {
    listRules: vi.fn(),
  },
}))

import { dashboardApi } from '@/lib/dashboard-api'
import { fetchSlotRuleType, loadAllSlotRules, SLOT_RULE_KEYS } from './use-slot-rules'

const listRules = vi.mocked(dashboardApi.listRules)

const API_TYPE_BY_SLOT: Record<(typeof SLOT_RULE_KEYS)[number], string> = {
  requestModify: 'rewrite',
  responseModify: 'rewrite-response',
  autoSwitch: 'failover',
}

describe('use-slot-rules 数据层', () => {
  beforeEach(() => {
    listRules.mockReset()
  })

  describe('fetchSlotRuleType', () => {
    it('成功时返回该类型规则，并按类型调用对应 API', async () => {
      listRules.mockResolvedValue({ rules: [{ id: 'r-1', name: '改写A' }], total: 1 })
      const result = await fetchSlotRuleType('requestModify')
      expect(result).toHaveLength(1)
      expect(listRules).toHaveBeenCalledWith('rewrite', { limit: 200, offset: 0 })
      expect(listRules).toHaveBeenCalledTimes(1)
    })

    it('请求失败时按类型抛出错误', async () => {
      listRules.mockRejectedValue(new Error('网络错误'))
      await expect(fetchSlotRuleType('requestModify')).rejects.toThrow('网络错误')
      expect(listRules).toHaveBeenCalledWith('rewrite', { limit: 200, offset: 0 })
    })
  })

  describe('loadAllSlotRules', () => {
    it('某类型请求失败时仅该类型记录 error，其它类型不受影响', async () => {
      listRules.mockImplementation(async (type: string) => {
        if (type === 'failover') throw new Error('boom')
        return { rules: [{ id: `${type}-1`, name: `${type}规则` }], total: 1 }
      })
      const { rules, status } = await loadAllSlotRules()

      // 失败的类型：列表为空 + error 置位
      expect(rules.autoSwitch).toHaveLength(0)
      expect(status.autoSwitch.error).toBe('加载失败')

      // 成功的类型：列表就位 + error 为空
      expect(rules.requestModify).toHaveLength(1)
      expect(status.requestModify.error).toBeNull()

      // 所有类型都结束 loading
      SLOT_RULE_KEYS.forEach((key) => {
        expect(status[key].loading).toBe(false)
        expect(listRules).toHaveBeenCalledWith(API_TYPE_BY_SLOT[key], { limit: 200, offset: 0 })
      })
      expect(listRules).toHaveBeenCalledTimes(3)
    })
  })
})