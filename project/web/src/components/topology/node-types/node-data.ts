import type { NodeType, RuleKind } from './slot-defs'

// ── Workflow node data shapes (matches the JSON wire format) ──
//
// User-facing JSON allows omitting id fields (only `name` is required).
// After save, backend backfills `rule_id` / `provider_id` by matching `name`.
// On reload, both id and name are present. The `id` fields are optional in the
// type because user-authored JSON may not have them yet.

export interface ProviderNodeData {
  readonly type: 'provider'
  readonly name: string
  readonly provider_id?: string
  readonly enabled?: boolean
}

export interface RuleBoundNodeData {
  readonly type: Exclude<NodeType, 'provider' | 'logOutput'>
  readonly name: string
  readonly rule_id?: string
  readonly order: number
  readonly enabled: boolean
}

export interface LogOutputNodeData {
  readonly type: 'logOutput'
  readonly name: string
  readonly enabled: boolean
  readonly config: {
    readonly prefix: string
    readonly record_request: boolean
    readonly record_response: boolean
  }
}

export type WorkflowNode = ProviderNodeData | RuleBoundNodeData | LogOutputNodeData

export type Workflow = readonly WorkflowNode[]

// Type guards
export function isProviderNode(n: WorkflowNode): n is ProviderNodeData {
  return n.type === 'provider'
}

export function isRuleBoundNode(n: WorkflowNode): n is RuleBoundNodeData {
  return n.type !== 'provider' && n.type !== 'logOutput'
}

export function isLogOutputNode(n: WorkflowNode): n is LogOutputNodeData {
  return n.type === 'logOutput'
}

// Maps node type to the rule kind it binds (for rule fetching)
export const NODE_TYPE_RULE_KIND: Partial<Record<NodeType, RuleKind>> = {
  requestModify: 'rewrite',
  responseModify: 'rewrite-response',
  autoReply: 'heartbeat',
  concurrency: 'concurrency',
  autoSwitch: 'failover',
}
