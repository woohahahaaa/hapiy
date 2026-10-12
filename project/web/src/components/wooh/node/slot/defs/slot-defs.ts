import { i18n } from '@/i18n/i18n'
import type {
  RewriteRule,
  ResponseRewriteRule,
  FailoverRule,
} from '@/lib/dashboard-api'

// ── Node types ──

export type NodeType =
  | 'provider'
  | 'requestModify'
  | 'responseModify'
  | 'concurrency'
  | 'autoSwitch'
  | 'logOutput'

export type RuleKind = 'rewrite' | 'rewrite-response' | 'concurrency' | 'failover'

export type AnyRule = RewriteRule | ResponseRewriteRule | FailoverRule

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
  readonly renderer: 'script' | 'rewriteRule' | 'concurrency' | 'failover' | 'provider'
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
    label: i18n.t('node:slotDefs.provider'),
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
    label: i18n.t('node:slotDefs.requestModify'),
    slotOrder: 1,
    headerSlot: { enabled: true, showOrder: true },
    ruleBindingSlot: { enabled: true, ruleKind: 'rewrite', placeholder: i18n.t('node:slotDefs.placeholderRequestModify') },
    orderSlot: { enabled: true },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'rewriteRule' },
    errorSlot: { enabled: true },
  },

  responseModify: {
    label: i18n.t('node:slotDefs.responseModify'),
    slotOrder: 2,
    headerSlot: { enabled: true, showOrder: true },
    ruleBindingSlot: { enabled: true, ruleKind: 'rewrite-response', placeholder: i18n.t('node:slotDefs.placeholderResponseModify') },
    orderSlot: { enabled: true },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'script' },
    errorSlot: { enabled: true },
  },


  concurrency: {
    label: i18n.t('node:slotDefs.concurrency'),
    slotOrder: 4,
    headerSlot: { enabled: true, showOrder: true },
    ruleBindingSlot: { enabled: true, ruleKind: 'concurrency', placeholder: i18n.t('node:slotDefs.placeholderConcurrency') },
    orderSlot: { enabled: true },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'concurrency' },
    errorSlot: { enabled: true },
  },

  autoSwitch: {
    label: i18n.t('node:slotDefs.autoSwitch'),
    slotOrder: 5,
    headerSlot: { enabled: true, showOrder: true },
    ruleBindingSlot: { enabled: true, ruleKind: 'failover', placeholder: i18n.t('node:slotDefs.placeholderAutoSwitch') },
    orderSlot: { enabled: true },
    logConfigSlot: { enabled: false },
    recordConfigSlot: { enabled: false },
    previewSlot: { enabled: true, renderer: 'failover' },
    errorSlot: { enabled: true },
  },

  logOutput: {
    label: i18n.t('node:slotDefs.logOutput'),
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
  'concurrency',
  'autoSwitch',
  'logOutput',
]
