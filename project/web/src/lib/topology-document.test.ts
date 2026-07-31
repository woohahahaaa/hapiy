import { describe, expect, it } from 'vitest'
import { emptySlotEntryMap } from '@/components/topology/slot-items/types'
import {
  parseTopologyDocument,
  slotMapsFromDocument,
  topologyDocumentFromSlotMaps,
} from './topology-document'

describe('parseTopologyDocument', () => {
  it('preserves every valid wire field when the response is authoritative', () => {
    // Given
    const raw = {
      schema_version: 1,
      revision: 7,
      slots: [{
        id: 'assignment-real-id',
        channel_id: 'channel-real-id',
        slot_type: 'requestModify',
        order: 3,
        enabled: false,
        rule_id: 'rule-real-id',
        config: { custom: 'kept' },
      }],
    }

    // When
    const document = parseTopologyDocument(raw)

    // Then
    expect(document).toEqual(raw)
  })

  it('rejects duplicate assignment IDs', () => {
    // Given
    const raw = {
      schema_version: 1,
      revision: 0,
      slots: [
        { id: 'same', channel_id: 'a', slot_type: 'autoReply', order: 1, enabled: true, rule_id: 'r1', config: {} },
        { id: 'same', channel_id: 'b', slot_type: 'autoReply', order: 2, enabled: true, rule_id: 'r2', config: {} },
      ],
    }

    // When / Then
    expect(() => parseTopologyDocument(raw)).toThrow('拓扑槽位 ID same 重复')
  })
})

describe('topology slot transformations', () => {
  it('sorts assignments and restores immutable IDs, enabled state, and log config', () => {
    // Given
    const document = parseTopologyDocument({
      schema_version: 1,
      revision: 4,
      slots: [
        { id: 'log-b', channel_id: 'channel-a', slot_type: 'logOutput', order: 2, enabled: false, rule_id: null, config: { log_target: 'both', log_level: 'warn', log_path: '/tmp/a.log', record_request_before: false, record_request_after: true, record_response_before: false, record_response_after: true } },
        { id: 'request-a', channel_id: 'channel-a', slot_type: 'requestModify', order: 1, enabled: true, rule_id: 'rule-a', config: { custom: 1 } },
      ],
    })

    // When
    const maps = slotMapsFromDocument(document, ['channel-a'])

    // Then
    expect(maps.get('channel-a')?.requestModify[0]).toMatchObject({ id: 'request-a', enabled: true, ruleId: 'rule-a', config: { custom: 1 } })
    expect(maps.get('channel-a')?.logOutput[0]).toMatchObject({ id: 'log-b', enabled: false, logTarget: 'both', logLevel: 'warn', logPath: '/tmp/a.log', recordRequestBefore: false })
  })

  it('sorts two-digit wire order numerically instead of lexically', () => {
    // Given
    const document = parseTopologyDocument({
      schema_version: 1,
      revision: 1,
      slots: [
        { id: 'rule-ten', channel_id: 'channel-a', slot_type: 'requestModify', order: 10, enabled: true, rule_id: 'r10', config: {} },
        { id: 'rule-two', channel_id: 'channel-a', slot_type: 'requestModify', order: 2, enabled: true, rule_id: 'r2', config: {} },
      ],
    })

    // When
    const maps = slotMapsFromDocument(document, ['channel-a'])

    // Then
    expect(maps.get('channel-a')?.requestModify.map((entry) => entry.id)).toEqual(['rule-two', 'rule-ten'])
  })

  it('emits only real assignments and filters null-rule drafts without placeholder rows', () => {
    // Given
    const channelSlots = emptySlotEntryMap()
    channelSlots.requestModify.push(
      { id: 'draft', slotType: 'requestModify', index: 1, enabled: true, ruleId: null, config: {} },
      { id: 'saved', slotType: 'requestModify', index: 2, enabled: false, ruleId: 'rule-a', config: { custom: true } },
    )
    const maps = new Map([['channel-a', channelSlots]])

    // When
    const document = topologyDocumentFromSlotMaps(9, maps)

    // Then
    expect(document).toEqual({
      schema_version: 1,
      revision: 9,
      slots: [{ id: 'saved', channel_id: 'channel-a', slot_type: 'requestModify', order: 1, enabled: false, rule_id: 'rule-a', config: { custom: true } }],
    })
  })

  it('serializes log settings with backend snake_case keys and contiguous order', () => {
    // Given
    const channelSlots = emptySlotEntryMap()
    channelSlots.logOutput.push({
      id: 'log-real-id',
      slotType: 'logOutput',
      index: 8,
      enabled: false,
      logTarget: 'console',
      logLevel: 'error',
      logPath: '/var/log/hapiy.log',
      recordRequestBefore: false,
      recordRequestAfter: true,
      recordResponseBefore: false,
      recordResponseAfter: true,
      config: { custom: 'kept' },
    })

    // When
    const document = topologyDocumentFromSlotMaps(10, new Map([['channel-a', channelSlots]]))

    // Then
    expect(document.slots).toEqual([{
      id: 'log-real-id',
      channel_id: 'channel-a',
      slot_type: 'logOutput',
      order: 1,
      enabled: false,
      rule_id: null,
      config: {
        custom: 'kept',
        log_target: 'console',
        log_level: 'error',
        log_path: '/var/log/hapiy.log',
        record_request_before: false,
        record_request_after: true,
        record_response_before: false,
        record_response_after: true,
      },
    }])
  })
})
