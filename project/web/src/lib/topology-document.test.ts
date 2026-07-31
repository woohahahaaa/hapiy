import { describe, expect, it } from 'vitest'
import { emptySlotEntryMap } from '@/components/topology/slot-items/types'
import {
  parseTopologyDocument,
  slotMapsFromWorkflows,
  workflowsFromSlotMaps,
} from './topology-document'

describe('parseTopologyDocument', () => {
  it('parses a bare array of workflows', () => {
    const raw = [[
      { type: 'provider', name: 'OpenAI', provider_id: 'p-001' },
      { type: 'requestModify', name: '改写', rule_id: 'r-101', order: 1, enabled: true },
      { type: 'logOutput', name: 'log', enabled: true, log_target: 'file', log_level: 'info', log_path: '/tmp/a.log', record_request_before: true, record_request_after: true, record_response_before: true, record_response_after: true },
    ]]

    const workflows = parseTopologyDocument(raw)

    expect(workflows).toHaveLength(1)
    expect(workflows[0]).toHaveLength(3)
    expect(workflows[0][0].type).toBe('provider')
    expect(workflows[0][1].type).toBe('requestModify')
  })

  it('rejects workflow without provider as first node', () => {
    const raw = [[
      { type: 'requestModify', name: 'x', rule_id: 'r-1', order: 1, enabled: true },
    ]]
    expect(() => parseTopologyDocument(raw)).toThrow('第一个节点必须是 provider')
  })

  it('rejects empty workflow', () => {
    expect(() => parseTopologyDocument([[]])).toThrow('不能为空')
  })

  it('rejects non-array input', () => {
    expect(() => parseTopologyDocument({})).toThrow('必须是数组')
  })

  it('allows omitting rule_id (user writes only name)', () => {
    const raw = [[
      { type: 'provider', name: 'P' },
      { type: 'requestModify', name: 'rule-a', order: 1, enabled: true },
    ]]
    const workflows = parseTopologyDocument(raw)
    expect(workflows[0][1]).not.toHaveProperty('rule_id')
  })

  it('allows omitting order for non-logOutput when user lets backend auto-assign', () => {
    const raw = [[
      { type: 'provider', name: 'P' },
      { type: 'requestModify', name: 'rule-a', enabled: true },
    ]]
    expect(() => parseTopologyDocument(raw)).toThrow('order')
  })

  it('logOutput has no order field', () => {
    const raw = [[
      { type: 'provider', name: 'P' },
      { type: 'logOutput', name: 'log', enabled: true, log_target: 'file', log_level: 'info', log_path: '', record_request_before: true, record_request_after: true, record_response_before: true, record_response_after: true },
    ]]
    const workflows = parseTopologyDocument(raw)
    expect(workflows[0][1]).not.toHaveProperty('order')
  })
})

describe('slotMapsFromWorkflows', () => {
  it('groups nodes by slot type and sorts by order within slot', () => {
    const workflows = parseTopologyDocument([[
      { type: 'provider', name: 'P', provider_id: 'p-1' },
      { type: 'requestModify', name: 'b', rule_id: 'r-2', order: 2, enabled: true },
      { type: 'requestModify', name: 'a', rule_id: 'r-1', order: 1, enabled: true },
      { type: 'logOutput', name: 'log', enabled: false, log_target: 'both', log_level: 'warn', log_path: '/tmp/a.log', record_request_before: false, record_request_after: true, record_response_before: false, record_response_after: true },
    ]])

    const maps = slotMapsFromWorkflows(workflows)

    const providerSlots = maps.get('p-1')
    expect(providerSlots?.requestModify).toHaveLength(2)
    expect(providerSlots?.requestModify[0]).toMatchObject({ ruleId: 'r-1' })
    expect(providerSlots?.requestModify[1]).toMatchObject({ ruleId: 'r-2' })
    expect(providerSlots?.logOutput[0]).toMatchObject({ enabled: false, logTarget: 'both' })
  })
})

describe('workflowsFromSlotMaps', () => {
  it('filters null-rule drafts and emits only real assignments', () => {
    const providerSlots = emptySlotEntryMap()
    providerSlots.requestModify.push(
      { id: 'draft', slotType: 'requestModify', index: 1, enabled: true, ruleId: null, config: {} },
      { id: 'saved', slotType: 'requestModify', index: 2, enabled: false, ruleId: 'rule-a', config: {} },
    )
    const maps = new Map([['p-1', providerSlots]])
    const providerNames = new Map([['p-1', 'P']])
    const ruleNames = new Map([['requestModify:rule-a', 'rule-a']])

    const workflows = workflowsFromSlotMaps(maps, providerNames, ruleNames)

    expect(workflows).toHaveLength(1)
    expect(workflows[0][0].type).toBe('provider')
    expect(workflows[0][1].type).toBe('requestModify')
    expect(workflows[0][1].name).toBe('rule-a')
  })

  it('serializes logOutput with snake_case config keys', () => {
    const providerSlots = emptySlotEntryMap()
    providerSlots.logOutput.push({
      id: 'log-1', slotType: 'logOutput', index: 1, enabled: false,
      logTarget: 'console', logLevel: 'error', logPath: '/var/log/hapiy.log',
      recordRequestBefore: false, recordRequestAfter: true,
      recordResponseBefore: false, recordResponseAfter: true,
      config: {},
    })
    const maps = new Map([['p-1', providerSlots]])
    const providerNames = new Map([['p-1', 'P']])

    const workflows = workflowsFromSlotMaps(maps, providerNames, new Map())
    const logNode = workflows[0][1] as any

    expect(logNode.type).toBe('logOutput')
    expect(logNode.log_target).toBe('console')
    expect(logNode.log_level).toBe('error')
    expect(logNode.log_path).toBe('/var/log/hapiy.log')
    expect(logNode.record_request_after).toBe(true)
  })
})
