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

export type LogTarget = 'file' | 'console' | 'both'
export type LogLevel = 'info' | 'warn' | 'error'

// Each slot type carries its own per-item config (selected rule, overrides, etc).
// LogOutput has no upstream rule — its config is self-contained.
export type RequestModifySlotEntry = {
  readonly slotType: 'requestModify'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
}

export type ResponseModifySlotEntry = {
  readonly slotType: 'responseModify'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
}

export type AutoReplySlotEntry = {
  readonly slotType: 'autoReply'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
}

export type ConcurrencySlotEntry = {
  readonly slotType: 'concurrency'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
}

export type AutoSwitchSlotEntry = {
  readonly slotType: 'autoSwitch'
  readonly index: number
  readonly ruleId: string | null
  readonly enabled: boolean
}

export type LogOutputSlotEntry = {
  readonly slotType: 'logOutput'
  readonly index: number
  readonly enabled: boolean
  readonly logTarget: LogTarget
  readonly logLevel: LogLevel
  readonly logPath: string
  readonly recordRequestBefore: boolean
  readonly recordRequestAfter: boolean
  readonly recordResponseBefore: boolean
  readonly recordResponseAfter: boolean
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

export function makeEmptyEntry(slotType: SlotType, index: number): SlotEntry {
  switch (slotType) {
    case 'requestModify':
      return { slotType, index, ruleId: null, enabled: true }
    case 'responseModify':
      return { slotType, index, ruleId: null, enabled: true }
    case 'autoReply':
      return { slotType, index, ruleId: null, enabled: true }
    case 'concurrency':
      return { slotType, index, ruleId: null, enabled: true }
    case 'autoSwitch':
      return { slotType, index, ruleId: null, enabled: true }
    case 'logOutput':
      return {
        slotType,
        index,
        enabled: true,
        logTarget: 'file',
        logLevel: 'info',
        logPath: '',
        recordRequestBefore: true,
        recordRequestAfter: true,
        recordResponseBefore: true,
        recordResponseAfter: true,
      }
  }
}