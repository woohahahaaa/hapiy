import type {
  RewriteRule,
  ResponseRewriteRule,
  HeartbeatRule,
  ConcurrencyRule,
  FailoverRule,
} from '@/lib/dashboard-api'

// ── Node types ──

export type NodeType =
  | 'provider'
  | 'requestModify'
  | 'responseModify'
  | 'autoReply'
  | 'concurrency'
  | 'autoSwitch'
  | 'logOutput'

export type RuleKind = 'rewrite' | 'rewrite-response' | 'heartbeat' | 'concurrency' | 'failover'

export type AnyRule = RewriteRule | ResponseRewriteRule | HeartbeatRule | ConcurrencyRule | FailoverRule

// ── Slot defs: declarative description of what each node type activates ──

export interface HeaderSlotDef {
  readonly enabled: true
  readonly showOrder: boolean
}

export interface RuleBindingSlotDef {
  readonly enabled: true
  readonly ruleKind: RuleKind
  readonly placeholder: string
}

export interface OrderSlotDef {
  readonly enabled: true
}

export interface LogConfigSlotDef {
  readonly enabled: true
  readonly defaults: {
    readonly prefix: string
    readonly autoCloseMinutes: number
  }
}

export interface RecordConfigSlotDef {
  readonly enabled: true
  readonly defaults: {
    readonly recordRequest: boolean
    readonly recordResponse: boolean
  }
}

export interface PreviewSlotDef {
  readonly enabled: true
  readonly renderer: 'script' | 'rewriteRule' | 'heartbeat' | 'concurrency' | 'failover' | 'provider'
}

export interface ErrorSlotDef {
  readonly enabled: true
}

// Disabled slot marker — present on every NodeTypeSlotDefs so the type table is exhaustive
export type DisabledSlot = { readonly enabled: false }

// ── Per-node-type slot definitions ──

export interface NodeTypeSlotDefs {
  readonly headerSlot: HeaderSlotDef | DisabledSlot
  readonly ruleBindingSlot: RuleBindingSlotDef | DisabledSlot
  readonly orderSlot: OrderSlotDef | DisabledSlot
  readonly logConfigSlot: LogConfigSlotDef | DisabledSlot
  readonly recordConfigSlot: RecordConfigSlotDef | DisabledSlot
  readonly previewSlot: PreviewSlotDef | DisabledSlot
  readonly errorSlot: ErrorSlotDef | DisabledSlot
  readonly label: string
  readonly slotOrder: number
}

// ── The configuration table itself ──

export const NODE_TYPE_SLOT_DEFS: Record<NodeType, NodeTypeSlotDefs> = {
  provider: {
    label: '供应商',
    slotOrder: 0,
    headerSlot: { enabled: true, showOrder: false },
    ruleBindingSlot: { enabled: false },
    orderSlot: { enabled: false },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'provider' },
    errorSlot: { enabled: true },
  },

  requestModify: {
    label: '请求改写',
    slotOrder: 1,
    headerSlot: { enabled: true, showOrder: true },
    ruleBindingSlot: { enabled: true, ruleKind: 'rewrite', placeholder: '选择改写规则' },
    orderSlot: { enabled: true },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'rewriteRule' },
    errorSlot: { enabled: true },
  },

  responseModify: {
    label: '响应改写',
    slotOrder: 2,
    headerSlot: { enabled: true, showOrder: true },
    ruleBindingSlot: { enabled: true, ruleKind: 'rewrite-response', placeholder: '选择响应改写规则' },
    orderSlot: { enabled: true },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'script' },
    errorSlot: { enabled: true },
  },

  autoReply: {
    label: '心跳回复',
    slotOrder: 3,
    headerSlot: { enabled: true, showOrder: true },
    ruleBindingSlot: { enabled: true, ruleKind: 'heartbeat', placeholder: '选择心跳规则' },
    orderSlot: { enabled: true },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'heartbeat' },
    errorSlot: { enabled: true },
  },

  concurrency: {
    label: '并发控制',
    slotOrder: 4,
    headerSlot: { enabled: true, showOrder: true },
    ruleBindingSlot: { enabled: true, ruleKind: 'concurrency', placeholder: '选择并发规则' },
    orderSlot: { enabled: true },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'concurrency' },
    errorSlot: { enabled: true },
  },

  autoSwitch: {
    label: '故障转移',
    slotOrder: 5,
    headerSlot: { enabled: true, showOrder: true },
    ruleBindingSlot: { enabled: true, ruleKind: 'failover', placeholder: '选择故障转移规则' },
    orderSlot: { enabled: true },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'failover' },
    errorSlot: { enabled: true },
  },

  logOutput: {
    label: '日志抓取',
    slotOrder: 6,
    headerSlot: { enabled: true, showOrder: false },
    ruleBindingSlot: { enabled: false },
    orderSlot: { enabled: false },
    logConfigSlot: {
      enabled: true,
      defaults: { prefix: '', autoCloseMinutes: 5 },
    },
    recordConfigSlot: {
      enabled: true,
      defaults: {
        recordRequest: true,
        recordResponse: true,
      },
    },
    previewSlot: { enabled: false },
    errorSlot: { enabled: true },
  },
}

export const SLOT_ORDER: readonly NodeType[] = [
  'requestModify',
  'responseModify',
  'autoReply',
  'concurrency',
  'autoSwitch',
  'logOutput',
]
