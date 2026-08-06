import type {
  RewriteRule,
  ResponseRewriteRule,
  HeartbeatRule,
  ConcurrencyRule,
  FailoverRule,
} from '@/lib/dashboard-api'

export type SlotType =
  | 'requestModify'
  | 'responseModify'
  | 'autoReply'
  | 'concurrency'
  | 'autoSwitch'
  | 'logOutput'

// Each slot type carries its own per-item config (selected rule, overrides, etc).
// LogOutput has no upstream rule — its config is self-contained.
export type RequestModifySlotEntry = {
  readonly id: string
  readonly slotType: 'requestModify'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
  readonly config: Readonly<Record<string, unknown>>
}

export type ResponseModifySlotEntry = {
  readonly id: string
  readonly slotType: 'responseModify'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
  readonly config: Readonly<Record<string, unknown>>
}

export type AutoReplySlotEntry = {
  readonly id: string
  readonly slotType: 'autoReply'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
  readonly config: Readonly<Record<string, unknown>>
}

export type ConcurrencySlotEntry = {
  readonly id: string
  readonly slotType: 'concurrency'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
  readonly config: Readonly<Record<string, unknown>>
}

export type AutoSwitchSlotEntry = {
  readonly id: string
  readonly slotType: 'autoSwitch'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
  readonly config: Readonly<Record<string, unknown>>
}

export type LogOutputSlotEntry = {
  readonly id: string
  readonly slotType: 'logOutput'
  readonly index: number
  readonly enabled: boolean
  readonly prefix: string
  readonly recordRequest: boolean
  readonly recordModifiedRequest: boolean
  readonly recordResponse: boolean
  readonly recordModifiedResponse: boolean
  readonly recordSystem: boolean
  readonly mergeStream: boolean
  readonly autoCloseMinutes: number
  readonly config: Readonly<Record<string, unknown>>
}

export type SlotEntry =
  | RequestModifySlotEntry
  | ResponseModifySlotEntry
  | AutoReplySlotEntry
  | ConcurrencySlotEntry
  | AutoSwitchSlotEntry
  | LogOutputSlotEntry

export type SlotEntryMap = {
  requestModify: RequestModifySlotEntry[]
  responseModify: ResponseModifySlotEntry[]
  autoReply: AutoReplySlotEntry[]
  concurrency: ConcurrencySlotEntry[]
  autoSwitch: AutoSwitchSlotEntry[]
  logOutput: LogOutputSlotEntry[]
}

export const SLOT_ORDER: readonly SlotType[] = [
  'requestModify',
  'responseModify',
  'autoReply',
  'concurrency',
  'autoSwitch',
  'logOutput',
] as const

export const SLOT_LABELS: Record<SlotType, string> = {
  requestModify: '请求改写',
  responseModify: '响应改写',
  autoReply: '心跳回复',
  concurrency: '并发控制',
  autoSwitch: '故障转移',
  logOutput: '日志输出',
}

// Drag-reorder props passed from the slot node down to each item card.
export type SlotItemDragProps = {
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: () => void
  onDragOver?: () => void
  onDrop?: () => void
}

// Rule sources keyed by slotType (everything except logOutput binds to a rule).
export type SlotRuleMap = {
  requestModify: readonly RewriteRule[]
  responseModify: readonly ResponseRewriteRule[]
  autoReply: readonly HeartbeatRule[]
  concurrency: readonly ConcurrencyRule[]
  autoSwitch: readonly FailoverRule[]
}

export function emptySlotEntryMap(): SlotEntryMap {
  return {
    requestModify: [],
    responseModify: [],
    autoReply: [],
    concurrency: [],
    autoSwitch: [],
    logOutput: [],
  }
}

export function makeEmptyEntry(slotType: SlotType, index: number, idFactory: () => string = () => crypto.randomUUID()): SlotEntry {
  const id = idFactory()
  switch (slotType) {
    case 'requestModify':
      return { id, slotType, index, ruleId: null, enabled: true, config: {} }
    case 'responseModify':
      return { id, slotType, index, ruleId: null, enabled: true, config: {} }
    case 'autoReply':
      return { id, slotType, index, ruleId: null, enabled: true, config: {} }
    case 'concurrency':
      return { id, slotType, index, ruleId: null, enabled: true, config: {} }
    case 'autoSwitch':
      return { id, slotType, index, ruleId: null, enabled: true, config: {} }
    case 'logOutput':
      return {
        id,
        slotType,
        index,
        enabled: true,
        prefix: '',
        recordRequest: true,
        recordModifiedRequest: true,
        recordResponse: true,
        recordModifiedResponse: true,
        recordSystem: true,
        mergeStream: true,
        autoCloseMinutes: 5,
        config: {},
      }
  }
}
