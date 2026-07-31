import {
  SLOT_ORDER,
  emptySlotEntryMap,
  type LogLevel,
  type LogTarget,
  type SlotEntry,
  type SlotEntryMap,
  type SlotType,
} from '@/components/topology/slot-items/types'

export type TopologySlot = {
  readonly id: string
  readonly channel_id: string
  readonly slot_type: SlotType
  readonly order: number
  readonly enabled: boolean
  readonly rule_id: string | null
  readonly config: Readonly<Record<string, unknown>>
}

export type TopologyDocument = {
  readonly schema_version: 1
  readonly revision: number
  readonly slots: readonly TopologySlot[]
}

export class TopologyDocumentError extends Error {
  readonly name = 'TopologyDocumentError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireExactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedKeys = new Set(allowed)
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (unknownKey) throw new TopologyDocumentError(`${field} 包含未知字段 ${unknownKey}`)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TopologyDocumentError(`${field} 必须是非空字符串`)
  }
  return value
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TopologyDocumentError(`${field} 必须是非负整数`)
  }
  return value
}

function parseSlotType(value: unknown): SlotType {
  if (typeof value === 'string' && SLOT_ORDER.includes(value as SlotType)) return value as SlotType
  throw new TopologyDocumentError('slot_type 不合法')
}

function parseTopologySlot(value: unknown): TopologySlot {
  if (!isRecord(value)) throw new TopologyDocumentError('拓扑槽位必须是对象')
  requireExactKeys(value, ['id', 'channel_id', 'slot_type', 'order', 'enabled', 'rule_id', 'config'], '拓扑槽位')
  const ruleId = value.rule_id
  if (ruleId !== null && typeof ruleId !== 'string') {
    throw new TopologyDocumentError('rule_id 必须是字符串或 null')
  }
  if (typeof value.enabled !== 'boolean') throw new TopologyDocumentError('enabled 必须是布尔值')
  if (!isRecord(value.config)) throw new TopologyDocumentError('config 必须是对象')
  return {
    id: requiredString(value.id, 'id'),
    channel_id: requiredString(value.channel_id, 'channel_id'),
    slot_type: parseSlotType(value.slot_type),
    order: requiredInteger(value.order, 'order'),
    enabled: value.enabled,
    rule_id: ruleId,
    config: { ...value.config },
  }
}

export function parseTopologyDocument(value: unknown): TopologyDocument {
  if (!isRecord(value)) throw new TopologyDocumentError('拓扑文档必须是对象')
  requireExactKeys(value, ['schema_version', 'revision', 'slots'], '拓扑文档')
  if (value.schema_version !== 1) throw new TopologyDocumentError('schema_version 必须为 1')
  if (!Array.isArray(value.slots)) throw new TopologyDocumentError('slots 必须是数组')
  const slots = value.slots.map(parseTopologySlot)
  const ids = new Set<string>()
  for (const slot of slots) {
    if (ids.has(slot.id)) throw new TopologyDocumentError(`拓扑槽位 ID ${slot.id} 重复`)
    ids.add(slot.id)
  }
  return { schema_version: 1, revision: requiredInteger(value.revision, 'revision'), slots }
}

function configString<T extends string>(config: Readonly<Record<string, unknown>>, key: string, fallback: T, allowed: readonly T[]): T {
  const value = config[key]
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function configBoolean(config: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const value = config[key]
  return typeof value === 'boolean' ? value : fallback
}

function entryFromSlot(slot: TopologySlot, index: number): SlotEntry {
  const base = { id: slot.id, index, enabled: slot.enabled, config: slot.config }
  switch (slot.slot_type) {
    case 'requestModify': return { ...base, slotType: slot.slot_type, ruleId: slot.rule_id }
    case 'responseModify': return { ...base, slotType: slot.slot_type, ruleId: slot.rule_id }
    case 'autoReply': return { ...base, slotType: slot.slot_type, ruleId: slot.rule_id }
    case 'concurrency': return { ...base, slotType: slot.slot_type, ruleId: slot.rule_id }
    case 'autoSwitch': return { ...base, slotType: slot.slot_type, ruleId: slot.rule_id }
    case 'logOutput':
      return {
        ...base,
        slotType: slot.slot_type,
        logTarget: configString<LogTarget>(slot.config, 'log_target', 'file', ['file', 'console', 'both']),
        logLevel: configString<LogLevel>(slot.config, 'log_level', 'info', ['info', 'warn', 'error']),
        logPath: typeof slot.config.log_path === 'string' ? slot.config.log_path : '',
        recordRequestBefore: configBoolean(slot.config, 'record_request_before', true),
        recordRequestAfter: configBoolean(slot.config, 'record_request_after', true),
        recordResponseBefore: configBoolean(slot.config, 'record_response_before', true),
        recordResponseAfter: configBoolean(slot.config, 'record_response_after', true),
      }
  }
}

export function slotMapsFromDocument(document: TopologyDocument, channelIds: readonly string[]): Map<string, SlotEntryMap> {
  const maps = new Map(channelIds.map((id) => [id, emptySlotEntryMap()]))
  const ranks = new Map(SLOT_ORDER.map((type, index) => [type, index]))
  const sorted = [...document.slots].sort((left, right) =>
    (ranks.get(left.slot_type) ?? 99) - (ranks.get(right.slot_type) ?? 99)
      || left.order - right.order
      || left.id.localeCompare(right.id))
  for (const slot of sorted) {
    const map = maps.get(slot.channel_id) ?? emptySlotEntryMap()
    const list = map[slot.slot_type] as SlotEntry[]
    list.push(entryFromSlot(slot, list.length + 1))
    maps.set(slot.channel_id, map)
  }
  return maps
}

function configFromEntry(entry: SlotEntry): Readonly<Record<string, unknown>> {
  if (entry.slotType !== 'logOutput') return entry.config
  return {
    ...entry.config,
    log_target: entry.logTarget,
    log_level: entry.logLevel,
    log_path: entry.logPath,
    record_request_before: entry.recordRequestBefore,
    record_request_after: entry.recordRequestAfter,
    record_response_before: entry.recordResponseBefore,
    record_response_after: entry.recordResponseAfter,
  }
}

export function topologyDocumentFromSlotMaps(revision: number, maps: ReadonlyMap<string, SlotEntryMap>): TopologyDocument {
  const slots: TopologySlot[] = []
  for (const [channelId, map] of maps) {
    for (const slotType of SLOT_ORDER) {
      let order = 0
      for (const entry of map[slotType]) {
        const ruleId = 'ruleId' in entry ? entry.ruleId : null
        if (entry.slotType !== 'logOutput' && ruleId === null) continue
        order += 1
        slots.push({
          id: entry.id,
          channel_id: channelId,
          slot_type: entry.slotType,
          order,
          enabled: entry.enabled,
          rule_id: ruleId,
          config: configFromEntry(entry),
        })
      }
    }
  }
  return { schema_version: 1, revision, slots }
}
