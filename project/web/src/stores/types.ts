// 应用状态管理入口
// TODO: 根据原型中的 ProviderStore / RuleStore / PriceStore 迁移为后端驱动的状态
// 参考: prototype/app/src/store/*.jsx

export interface AppState {
  // 供应商 (channels/providers)
  providers: Provider[]
  providersVersion: number

  // 策略规则
  rules: PolicyRules

  // 价格配置
  prices: PriceConfig[]

  // 用户
  user: UserInfo | null
}

export interface Provider {
  id: string
  name: string
  baseUrls: string[]
  keys: string[]
  endpoints: Endpoint[]
  models: ModelBinding[]
  status: boolean
  weight?: number
}

export interface Endpoint {
  id: string
  name: string
  pathSuffix: string
}

export interface ModelBinding {
  model: string
  endpoints: string[]  // endpoint ids, empty = all
  discount?: number
}

export interface PolicyRules {
  heartbeat: HeartbeatRule[]
  rewrite: RewriteRule[]
  failover: FailoverRule[]
  concurrency: ConcurrencyRule[]
  responseRewrite: ResponseRewriteRule[]
}

export interface ResponseRewriteRule {
  id: string
  name: string
  script: string
  status: boolean
}

export interface HeartbeatRule {
  id: string
  name: string
  matchCondition: string
  replyContent: string
  timeout: number  // seconds
  status: boolean
}

export interface RewriteRule {
  id: string
  name: string
  field: string
  action: 'SET' | 'DELETE'
  value: string
  status: boolean
}

export interface FailoverRule {
  id: string
  name: string
  primaryChannel: string
  fallbackChannel: string
  condition: 'timeout' | 'error' | 'rate_limit'
  status: boolean
}

export interface ConcurrencyRule {
  id: string
  name: string
  scope: 'global' | 'per_user' | 'per_token'
  maxConcurrent: number
  queueEnabled: boolean
  status: boolean
}

export interface PriceConfig {
  model: string
  inputPrice: number   // per 1M tokens
  outputPrice: number
  cacheWritePrice?: number
  cacheReadPrice?: number
}

export interface UserInfo {
  id: string
  username: string
  role: string
}

// 节点图相关类型
export interface TopologyNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export type NodeType =
  | 'modelHub'
  | 'channel'
  | 'autoReply'
  | 'requestModify'
  | 'responseModify'
  | 'autoSwitch'
  | 'concurrency'
  | 'logOutput'
  | 'endpoint'

export interface TopologyEdge {
  id: string
  source: string
  target: string
  targetHandle?: string
  sourceHandle?: string
  animated?: boolean
  style?: Record<string, unknown>
}

// 插槽配置类型 — 持久化在 topology_configs.nodes JSON 中
export type SlotType =
  | 'requestModify'
  | 'responseModify'
  | 'autoReply'
  | 'concurrency'
  | 'autoSwitch'
  | 'logOutput'

export interface SlotNodeConfig {
  index: number
  ruleId: string
}

export interface SlotConfig {
  type: SlotType
  nodes: SlotNodeConfig[]
}

export interface ProviderSlotConfig {
  providerId: string
  slots: SlotConfig[]
}
