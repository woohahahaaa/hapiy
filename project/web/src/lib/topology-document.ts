import {
  SLOT_ORDER,
  emptySlotEntryMap,
  type LogLevel,
  type LogTarget,
  type SlotEntry,
  type SlotEntryMap,
  type SlotType,
} from '@/components/topology/slot-items/types'
import type { Workflow, WorkflowNode } from '@/components/topology/node-types/node-data'

// ── Wire format types ──
//
// The topology JSON is a bare array of workflows. Each workflow is an array of
// nodes. The first node is always a provider; subsequent nodes are operations.
//
// User-authored JSON may omit id fields (rule_id / provider_id), writing only
// `name`. On save, the backend matches name → id and backfills. On reload both
// are present.
//
// Execution order = slot-type major order (SLOT_ORDER) → order field minor order.
// Array position within a workflow does NOT affect execution.

export type { Workflow, WorkflowNode } from '@/components/topology/node-types/node-data'

export interface WorkflowEntry {
  readonly providerId: string
  readonly enabled: boolean
  readonly slots: SlotEntryMap
}

export function providerIdFromKey(key: string): string {
  // key format: "w-{providerId}-{instanceIndex}"
  const lastDash = key.lastIndexOf('-')
  if (lastDash < 2) return key
  return key.slice(2, lastDash)
}

export function makeWorkflowKey(workflows: readonly { providerId: string }[], providerId: string): string {
  let maxIdx = -1
  const prefix = `w-${providerId}-`
  for (const w of workflows) {
    if (w.providerId === providerId) maxIdx++
  }
  return `${prefix}${maxIdx + 1}`
}

export class TopologyDocumentError extends Error {
  readonly name = 'TopologyDocumentError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TopologyDocumentError(`${field} 必须是非空字符串`)
  }
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new TopologyDocumentError(`${field} 必须是非空字符串`)
  }
  return value
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TopologyDocumentError(`${field} 必须是布尔值`)
  return value
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TopologyDocumentError(`${field} 必须是非负整数`)
  }
  return value
}

const VALID_NODE_TYPES = new Set(['provider', 'requestModify', 'responseModify', 'autoReply', 'concurrency', 'autoSwitch', 'logOutput'])
const VALID_LOG_TARGETS = new Set(['file', 'console', 'both'])
const VALID_LOG_LEVELS = new Set(['info', 'warn', 'error'])

function parseNode(value: unknown): WorkflowNode {
  if (!isRecord(value)) throw new TopologyDocumentError('节点必须是对象')
  const type = requiredString(value.type, 'type')
  if (!VALID_NODE_TYPES.has(type)) throw new TopologyDocumentError(`未知的节点类型: ${type}`)
  const name = requiredString(value.name, 'name')

  switch (type) {
    case 'provider':
      return {
        type: 'provider',
        name,
        provider_id: optionalString(value.provider_id, 'provider_id'),
        enabled: value.enabled !== undefined ? requiredBoolean(value.enabled, 'enabled') : true,
      }
    case 'logOutput': {
      const cfg = isRecord(value.config) ? value.config : {}
      return {
        type: 'logOutput',
        name,
        enabled: value.enabled !== undefined ? requiredBoolean(value.enabled, 'enabled') : true,
        config: {
          log_target: VALID_LOG_TARGETS.has(cfg.log_target as string) ? (cfg.log_target as 'file' | 'console' | 'both') : 'file',
          log_level: VALID_LOG_LEVELS.has(cfg.log_level as string) ? (cfg.log_level as 'info' | 'warn' | 'error') : 'info',
          log_path: typeof cfg.log_path === 'string' ? cfg.log_path : '',
          record_request_before: typeof cfg.record_request_before === 'boolean' ? cfg.record_request_before : true,
          record_request_after: typeof cfg.record_request_after === 'boolean' ? cfg.record_request_after : true,
          record_response_before: typeof cfg.record_response_before === 'boolean' ? cfg.record_response_before : true,
          record_response_after: typeof cfg.record_response_after === 'boolean' ? cfg.record_response_after : true,
        },
      }
    }
    default: {
      const node: WorkflowNode = {
        type: type as 'requestModify' | 'responseModify' | 'autoReply' | 'concurrency' | 'autoSwitch',
        name,
        order: requiredInteger(value.order, 'order'),
        enabled: value.enabled !== undefined ? requiredBoolean(value.enabled, 'enabled') : true,
      }
      const rid = optionalString(value.rule_id, 'rule_id')
      if (rid !== undefined) (node as { rule_id?: string }).rule_id = rid
      return node
    }
  }
}

// Parse a bare array of workflows (array of arrays of nodes).
export function parseTopologyDocument(value: unknown): Workflow[] {
  if (!Array.isArray(value)) throw new TopologyDocumentError('拓扑文档必须是数组')
  return value.map((workflow, i) => {
    if (!Array.isArray(workflow)) throw new TopologyDocumentError(`第 ${i + 1} 条 workflow 必须是数组`)
    if (workflow.length === 0) throw new TopologyDocumentError(`第 ${i + 1} 条 workflow 不能为空`)
    const nodes = workflow.map(parseNode)
    if (nodes[0].type !== 'provider') {
      throw new TopologyDocumentError(`第 ${i + 1} 条 workflow 的第一个节点必须是 provider`)
    }
    return nodes
  })
}

// ── Conversion to/from SlotEntryMap (for the existing visual components) ──

function nodeToEntry(node: WorkflowNode, index: number): SlotEntry {
  const base = { id: '', index, enabled: node.type === 'provider' ? true : (node as { enabled: boolean }).enabled, config: {} }
  switch (node.type) {
    case 'requestModify':
    case 'responseModify':
    case 'autoReply':
    case 'concurrency':
    case 'autoSwitch': {
      const rn = node as Extract<WorkflowNode, { order: number }>
      return { ...base, slotType: node.type, ruleId: rn.rule_id ?? null } as SlotEntry
    }
    case 'logOutput': {
      const ln = node as Extract<WorkflowNode, { config: { log_target: string } }>
      return {
        ...base,
        slotType: 'logOutput',
        logTarget: ln.config.log_target as LogTarget,
        logLevel: ln.config.log_level as LogLevel,
        logPath: ln.config.log_path,
        recordRequestBefore: ln.config.record_request_before,
        recordRequestAfter: ln.config.record_request_after,
        recordResponseBefore: ln.config.record_response_before,
        recordResponseAfter: ln.config.record_response_after,
      } as SlotEntry
    }
    default:
      throw new TopologyDocumentError(`无法转换节点类型: ${node.type}`)
  }
}

// Convert workflows JSON → Map<workflowKey, WorkflowEntry>.
// Each workflow (even duplicate providers) gets a unique key "w-{providerId}-{idx}".
// Nodes are grouped by slot type (major order = SLOT_ORDER), then by order field (minor).
export function slotMapsFromWorkflows(workflows: readonly Workflow[]): Map<string, WorkflowEntry> {
  const maps = new Map<string, WorkflowEntry>()
  const ranks = new Map<string, number>(SLOT_ORDER.map((type, index) => [type, index]))

  workflows.forEach((workflow) => {
    const providerNode = workflow[0]
    if (providerNode.type !== 'provider') return
    const providerId = providerNode.provider_id ?? providerNode.name
    const key = makeWorkflowKey([...maps.values()], providerId)
    const slots = emptySlotEntryMap()

    const nonProviderNodes = workflow.slice(1)
    const sorted = [...nonProviderNodes].sort((a, b) => {
      const ta = a.type
      const tb = b.type
      const rankA = ranks.has(ta) ? ranks.get(ta)! : 99
      const rankB = ranks.has(tb) ? ranks.get(tb)! : 99
      if (rankA !== rankB) return rankA - rankB
      const oa = (a as { order?: number }).order ?? 0
      const ob = (b as { order?: number }).order ?? 0
      return oa - ob
    })

    for (const node of sorted) {
      if (node.type === 'provider') continue
      const slotType = node.type as SlotType
      const list = slots[slotType] as SlotEntry[]
      const entry = nodeToEntry(node, list.length + 1)
      list.push({ ...entry, id: `${key}-${slotType}-${entry.index}` } as SlotEntry)
    }

    maps.set(key, { providerId, enabled: providerNode.enabled !== false, slots })
  })

  return maps
}

function entryToNode(entry: SlotEntry, _providerName: string): WorkflowNode | null {
  switch (entry.slotType) {
    case 'requestModify':
    case 'responseModify':
    case 'autoReply':
    case 'concurrency':
    case 'autoSwitch':
      if (entry.ruleId === null) return null
      return {
        type: entry.slotType,
        name: '', // name is filled by the caller from rule lookup
        rule_id: entry.ruleId,
        order: entry.index,
        enabled: entry.enabled,
      }
    case 'logOutput':
      return {
        type: 'logOutput',
        name: `log-output-${entry.index}`,
        enabled: entry.enabled,
        config: {
          log_target: entry.logTarget,
          log_level: entry.logLevel,
          log_path: entry.logPath,
          record_request_before: entry.recordRequestBefore,
          record_request_after: entry.recordRequestAfter,
          record_response_before: entry.recordResponseBefore,
          record_response_after: entry.recordResponseAfter,
        },
      }
  }
}

export function preserveNullRuleDrafts(
  saved: ReadonlyMap<string, WorkflowEntry>,
  local: ReadonlyMap<string, WorkflowEntry>,
): Map<string, WorkflowEntry> {
  const out = new Map<string, WorkflowEntry>()
  for (const [key, savedEntry] of saved) {
    const localEntry = local.get(key)
    if (!localEntry) {
      out.set(key, savedEntry)
      continue
    }
    const slots = emptySlotEntryMap()
    let changed = false
    for (const slotType of SLOT_ORDER) {
      const savedList = savedEntry.slots[slotType] as SlotEntry[]
      if (slotType === 'logOutput') {
        ;(slots[slotType] as SlotEntry[]) = savedList
        continue
      }
      const localList = localEntry.slots[slotType] as SlotEntry[]
      const drafts = localList.filter(
        (e) => 'ruleId' in e && (e as { ruleId: string | null }).ruleId === null,
      )
      if (drafts.length === 0) {
        ;(slots[slotType] as SlotEntry[]) = savedList
        continue
      }
      const savedIds = new Set(savedList.map((e) => e.id))
      const keptDrafts = drafts.filter((d) => !savedIds.has(d.id))
      if (keptDrafts.length === 0) {
        ;(slots[slotType] as SlotEntry[]) = savedList
        continue
      }
      changed = true
      const combined = [...savedList, ...keptDrafts].sort((a, b) => a.index - b.index)
      ;(slots[slotType] as SlotEntry[]) = combined.map((e, i) => ({ ...e, index: i + 1 }))
    }
    out.set(key, changed
      ? { providerId: savedEntry.providerId, enabled: savedEntry.enabled, slots }
      : savedEntry)
  }
  return out
}

// Convert Map<workflowKey, WorkflowEntry> → workflows JSON.
// providerNames maps provider_id → provider name for the provider node.
// ruleNames maps slotType+ruleId → rule name for rule-bound nodes.
export function workflowsFromSlotMaps(
  maps: ReadonlyMap<string, WorkflowEntry>,
  providerNames: ReadonlyMap<string, string>,
  ruleNames: ReadonlyMap<string, string>,
): Workflow[] {
  const workflows: Workflow[] = []
  for (const [, entry] of maps) {
    const providerId = entry.providerId
    const providerName = providerNames.get(providerId) ?? providerId
    const providerNode: WorkflowNode = {
      type: 'provider',
      name: providerName,
      provider_id: providerId,
      enabled: entry.enabled,
    }
    const nodes: WorkflowNode[] = [providerNode]
    for (const slotType of SLOT_ORDER) {
      for (const slotEntry of entry.slots[slotType]) {
        const node = entryToNode(slotEntry, providerName)
        if (node === null) continue
        if ('rule_id' in node && node.rule_id) {
          const lookupKey = `${slotEntry.slotType}:${node.rule_id}`
          ;(node as { name: string }).name = ruleNames.get(lookupKey) ?? ''
        }
        nodes.push(node)
      }
    }
    workflows.push(nodes)
  }
  return workflows
}