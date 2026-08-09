import { describe, expect, it } from 'vitest'
import { emptySlotEntryMap } from '@/components/topology/slot-items/types'
import {
  parseTopologyDocument,
  slotMapsFromWorkflows,
  workflowsFromSlotMaps,
  preserveNullRuleDrafts,
  type WorkflowEntry,
} from './topology-document'

describe('parseTopologyDocument', () => {
  it('parses a bare array of workflows', () => {
    const raw = [[
      { type: 'provider', name: 'OpenAI', provider_id: 'p-001' },
      { type: 'requestModify', name: '改写', rule_id: 'r-101', order: 1, enabled: true },
      { type: 'logOutput', name: 'log', enabled: true, config: { prefix: '/logs/a', record_request: true, record_response: true, record_system: true, auto_close_minutes: 5 } },
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
      { type: 'logOutput', name: 'log', enabled: true, config: { prefix: '', record_request: true, record_response: true, record_system: true, auto_close_minutes: 5 } },
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
      { type: 'logOutput', name: 'log', enabled: false, config: { prefix: '/logs/b', record_request: false, record_response: false, record_system: true, auto_close_minutes: 10 } },
    ]])

    const maps = slotMapsFromWorkflows(workflows)

    const entry = [...maps.values()][0]
    expect(entry?.providerId).toBe('p-1')
    expect(entry?.slots.requestModify).toHaveLength(2)
    expect(entry?.slots.requestModify[0]).toMatchObject({ ruleId: 'r-1' })
    expect(entry?.slots.requestModify[1]).toMatchObject({ ruleId: 'r-2' })
    expect(entry?.slots.logOutput[0]).toMatchObject({ enabled: false, prefix: '/logs/b' })
  })
})

describe('workflowsFromSlotMaps', () => {
  it('filters null-rule drafts and emits only real assignments', () => {
    const providerSlots = emptySlotEntryMap()
    providerSlots.requestModify.push(
      { id: 'draft', slotType: 'requestModify', index: 1, enabled: true, ruleId: null, config: {} },
      { id: 'saved', slotType: 'requestModify', index: 2, enabled: false, ruleId: 'rule-a', config: {} },
    )
    const maps = new Map<string, WorkflowEntry>([
      ['w-p-1-0', { providerId: 'p-1', enabled: true, slots: providerSlots }],
    ])
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
      prefix: '/logs/hapiy',
      recordRequest: false, recordResponse: false,
      recordSystem: true, autoCloseMinutes: 5,
      deadlineAt: null,
      config: {},
    })
    const maps = new Map<string, WorkflowEntry>([
      ['w-p-1-0', { providerId: 'p-1', enabled: true, slots: providerSlots }],
    ])
    const providerNames = new Map([['p-1', 'P']])

    const workflows = workflowsFromSlotMaps(maps, providerNames, new Map())
    const logNode = workflows[0][1] as any

    expect(logNode.type).toBe('logOutput')
    expect(logNode.name).toBe('log-output-1')
    expect(logNode.config.prefix).toBe('/logs/hapiy')
    expect(logNode.config.record_request).toBe(false)
    expect(logNode.config.record_response).toBe(false)
    expect(logNode.config.record_system).toBe(true)
    expect(logNode.config.auto_close_minutes).toBe(5)
  })
})

describe('preserveNullRuleDrafts', () => {
  it('re-applies unsaved null-rule drafts onto the saved snapshot', () => {
    const localSlots = emptySlotEntryMap()
    localSlots.requestModify.push(
      { id: 'draft', slotType: 'requestModify', index: 1, enabled: true, ruleId: null, config: {} },
      { id: 'saved', slotType: 'requestModify', index: 2, enabled: false, ruleId: 'rule-a', config: {} },
    )
    const local = new Map<string, WorkflowEntry>([
      ['w-p-1-0', { providerId: 'p-1', enabled: true, slots: localSlots }],
    ])

    const savedSlots = emptySlotEntryMap()
    savedSlots.requestModify.push(
      { id: 'saved', slotType: 'requestModify', index: 1, enabled: false, ruleId: 'rule-a', config: {} },
    )
    const saved = new Map<string, WorkflowEntry>([
      ['w-p-1-0', { providerId: 'p-1', enabled: true, slots: savedSlots }],
    ])

    const merged = preserveNullRuleDrafts(saved, local)
    const entries = merged.get('w-p-1-0')!.slots.requestModify
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.id).sort()).toEqual(['draft', 'saved'])
    expect(entries.find((e) => e.id === 'draft')).toMatchObject({ ruleId: null })
  })

  it('returns the saved entry unchanged when there are no drafts', () => {
    const slots = emptySlotEntryMap()
    slots.requestModify.push(
      { id: 'saved', slotType: 'requestModify', index: 1, enabled: true, ruleId: 'rule-a', config: {} },
    )
    const entry = { providerId: 'p-1', enabled: true, slots }
    const saved = new Map<string, WorkflowEntry>([['w-p-1-0', entry]])
    const local = new Map<string, WorkflowEntry>([['w-p-1-0', entry]])

    const merged = preserveNullRuleDrafts(saved, local)
    expect(merged.get('w-p-1-0')).toBe(entry)
  })
})
