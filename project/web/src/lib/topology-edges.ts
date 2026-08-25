import type { Edge } from '@xyflow/react'
import type { Provider } from '@/lib/dashboard-api'
import { SLOT_ORDER, type SlotType } from '@/components/node/slot/items/types'
import type { Workflow, WorkflowEntry } from '@/lib/topology-document'
import { topologyConfig } from '@/config/topology-config'

// ── The visual wiring layer (连线层) ──
//
// This module mirrors the backend semantics in
// backend/internal/topology/topology.go. The edge document is recursive JSON:
//
//	EdgeDocument := [ Unit* ]
//	Unit          := Chain | Cluster
//	Chain         := [ Ref* ]                    // first ref starts a chain
//	Cluster       := [ Unit*, Tail ]             // participants share the tail
//	Tail          := Chain (starts with a slot ref) | Cluster
//	Ref           := "pv-<key>" | "slot-<key>-<slotType>"
//
// We keep the JSON-preserving representation (arrays of strings = chains,
// arrays of arrays = clusters) so `JSON.stringify` round-trips byte-for-byte
// with the backend's RawMessage format. A chain is `string[]`, a cluster is
// `TopologyEdgeUnit[]` — the runtime distinguishes them via `isChainUnit`.

/** One unit of the edge document. A chain is an array of refs; a cluster is
 * an array of units whose LAST element is the shared tail. */
export type TopologyEdgeUnit = string[] | TopologyEdgeUnit[]

/** The full wire payload shared by GET/PUT `/topology` and the save queue. */
export interface TopologyPayload {
  readonly document: Workflow[]
  readonly edges: TopologyEdgeUnit[]
}

export class TopologyEdgesError extends Error {
  readonly name = 'TopologyEdgesError'
}

/** True when the unit is a Chain (all elements are ref strings). */
export function isChainUnit(unit: TopologyEdgeUnit): unit is string[] {
  return unit.length === 0 || typeof unit[0] === 'string'
}

/** Derives the valid workflow keys from the canonical document. Keys are
 * numbered per provider_id in document order, exactly like the frontend's
 * `makeWorkflowKey` ("w-{providerId}-{index}"). */
export function workflowRefsFromDocument(workflows: readonly Workflow[]): ReadonlyMap<string, boolean> {
  const refs = new Map<string, boolean>()
  const seen = new Map<string, number>()
  for (const workflow of workflows) {
    const providerNode = workflow[0]
    if (!providerNode || providerNode.type !== 'provider') continue
    const providerId = providerNode.provider_id ?? providerNode.name
    const idx = seen.get(providerId) ?? 0
    seen.set(providerId, idx + 1)
    refs.set(`w-${providerId}-${idx}`, true)
  }
  return refs
}

/** Validates "slot-{key}-{slotType}" against the workflow keys and the fixed
 * slot-type order. Like the backend, it does NOT require the slot to exist in
 * the document — the canvas renders every slot type per workflow, so a
 * connection may target a slot that currently has no rule bound. */
function validSlotRef(ref: string, providerKeys: ReadonlyMap<string, boolean>): boolean {
  if (!ref.startsWith('slot-')) return false
  const rest = ref.slice(5)
  const lastDash = rest.lastIndexOf('-')
  if (lastDash < 0) return false
  if (!providerKeys.has(rest.slice(0, lastDash))) return false
  const slotType = rest.slice(lastDash + 1)
  return (SLOT_ORDER as readonly string[]).includes(slotType)
}

/** Parses one unit (mirrors Go `parseChainNode`): an array of strings is a
 * chain; otherwise every element must itself be a unit and the cluster must
 * contain a participant and a shared tail. */
function parseEdgeUnit(value: unknown, position: string): TopologyEdgeUnit {
  if (!Array.isArray(value)) {
    throw new TopologyEdgesError(`连线单元 ${position} 必须是数组`)
  }
  if (value.length === 0) {
    throw new TopologyEdgesError(`连线单元 ${position} 不能为空`)
  }
  const allStrings = value.every((item) => typeof item === 'string')
  if (allStrings) return value.slice() as string[]
  const children = value.map((item, i) => parseEdgeUnit(item, `${position} 的第 ${i + 1} 个子单元`))
  if (children.length < 2) {
    throw new TopologyEdgesError(`连线聚合单元 ${position} 必须至少包含一个参与链和一个共享尾`)
  }
  return children
}

/** Parses the edges half of the wire payload, mirroring the backend's
 * structural checks. Throws `TopologyEdgesError` with a Chinese message on
 * malformed input. */
export function parseTopologyEdges(value: unknown): TopologyEdgeUnit[] {
  if (!Array.isArray(value)) throw new TopologyEdgesError('连线文档必须是数组')
  return value.map((unit, i) => parseEdgeUnit(unit, `第 ${i + 1} 个`))
}

// ── Expand: flatten clusters into full chains (mirrors Go `Expand`) ──
//
// Cluster semantics: every participant chain is continued by the shared tail.
// A slot-headed participant is a flow reference — it continues every chain in
// the pool whose last ref equals that slot. Continuation consumes the source
// chain so it is not referenced twice.

export function expandTopologyEdges(units: readonly TopologyEdgeUnit[]): string[][] {
  const pool: string[][] = []
  for (const unit of units) expandNode(unit, pool)
  return pool
}

function expandNode(node: TopologyEdgeUnit, pool: string[][]): void {
  if (isChainUnit(node)) {
    pool.push(node.slice())
    return
  }
  expandCluster(node, pool)
}

function expandCluster(cluster: readonly TopologyEdgeUnit[], pool: string[][]): void {
  if (cluster.length < 2) {
    throw new TopologyEdgesError('连线聚合单元必须至少包含一个参与链和一个共享尾')
  }
  const participants = cluster.slice(0, cluster.length - 1)
  const tail = cluster[cluster.length - 1]

  const tails = continuationOf(tail)

  const newChains: string[][] = []
  const flowRefs: string[] = []
  for (const p of participants) {
    if (isChainUnit(p)) {
      if (p[0].startsWith('pv-')) {
        newChains.push(p.slice())
      } else {
        flowRefs.push(p[0])
      }
      continue
    }
    // Nested cluster participant: expand it in isolation so its chains do not
    // leak into the shared pool as standalone chains (a provider must appear
    // in exactly one final chain) and its internal flow refs only match chains
    // inside itself — mirroring the backend's `expandCluster` local pool.
    const local: string[][] = []
    expandCluster(p, local)
    newChains.push(...local)
  }

  const matched: string[][] = []
  const kept: string[][] = []
  const flowSet = new Set(flowRefs)
  for (const c of pool) {
    if (c.length > 0 && flowSet.has(c[c.length - 1])) matched.push(c)
    else kept.push(c)
  }

  const continued: string[][] = []
  for (const c of newChains) {
    for (const t of tails) continued.push([...c, ...t])
  }
  for (const c of matched) {
    for (const t of tails) continued.push([...c, ...t])
  }
  pool.splice(0, pool.length, ...kept, ...continued)
}

/** Resolves a Tail into slot-headed chain continuations. */
function continuationOf(tail: TopologyEdgeUnit): string[][] {
  if (isChainUnit(tail)) {
    if (tail.length === 0) throw new TopologyEdgesError('连线共享尾不能为空')
    if (tail[0].startsWith('pv-')) {
      throw new TopologyEdgesError(`连线共享尾必须以槽位引用开头，实际为 ${tail[0]}`)
    }
    return [tail.slice()]
  }
  const pool: string[][] = []
  expandCluster(tail, pool)
  if (pool.length === 0) throw new TopologyEdgesError('连线共享尾聚合展开为空')
  return pool
}

// ── Defaults (mirrors Go `DefaultEdges`) ──

/** Builds the fully-connected chain for every workflow (provider → all six
 * slot types in fixed order). Keys are sorted for deterministic output,
 * matching the backend. */
export function defaultTopologyEdges(workflows: readonly Workflow[]): TopologyEdgeUnit[] {
  const providerKeys = workflowRefsFromDocument(workflows)
  const keys = [...providerKeys.keys()].sort()
  return keys.map((key) => ['pv-' + key, ...SLOT_ORDER.map((slotType) => `slot-${key}-${slotType}`)])
}

// ── Validation (mirrors Go `ValidateEdges`) ──

export function validateTopologyEdges(units: readonly TopologyEdgeUnit[], workflows: readonly Workflow[]): void {
  const providerKeys = workflowRefsFromDocument(workflows)
  const expanded = expandTopologyEdges(units)
  const seenProvider = new Set<string>()
  for (const chain of expanded) {
    if (chain.length === 0) throw new TopologyEdgesError('连线链不能为空')
    if (!chain[0].startsWith('pv-') && !chain[0].startsWith('slot-')) {
      throw new TopologyEdgesError(`连线链 ${JSON.stringify(chain)}: 引用 ${chain[0]} 必须以 pv- 或 slot- 开头`)
    }
    if (chain[0].startsWith('slot-')) {
      for (const ref of chain) {
        if (!validSlotRef(ref, providerKeys)) {
          throw new TopologyEdgesError(`连线链 ${JSON.stringify(chain)}: 未知的槽位引用 ${ref}`)
        }
      }
      continue
    }
    const key = chain[0].slice(3)
    if (!providerKeys.has(key)) {
      throw new TopologyEdgesError(`连线链 ${JSON.stringify(chain)}: 未知的 provider 引用 ${chain[0]}`)
    }
    if (seenProvider.has(key)) {
      throw new TopologyEdgesError(`provider ${key} 出现在多条连线链中`)
    }
    seenProvider.add(key)
    const slots = new Set<string>()
    for (const ref of chain.slice(1)) {
      if (!ref.startsWith('slot-')) {
        throw new TopologyEdgesError(`连线链 ${JSON.stringify(chain)}: provider 之后出现非槽位引用 ${ref}`)
      }
      if (!validSlotRef(ref, providerKeys)) {
        throw new TopologyEdgesError(`连线链 ${JSON.stringify(chain)}: 未知的槽位引用 ${ref}`)
      }
      if (slots.has(ref)) {
        throw new TopologyEdgesError(`连线链 ${JSON.stringify(chain)}: 槽位 ${ref} 在链中出现多次`)
      }
      slots.add(ref)
    }
  }
}

// ── Resolve (mirrors Go `ResolveEdges`) ──

/** Validates the wiring layer; empty or invalid edges (legacy data, a
 * corrupted store) fall back to the default fully-connected chains. */
export function resolveTopologyEdges(
  units: readonly TopologyEdgeUnit[] | null | undefined,
  workflows: readonly Workflow[],
): TopologyEdgeUnit[] {
  if (units !== undefined && units !== null && units.length > 0) {
    try {
      validateTopologyEdges(units, workflows)
      return units.map((unit) => unit)
    } catch {
      // fall through to default
    }
  }
  return defaultTopologyEdges(workflows)
}

// ── Reachability (mirrors Go `ReachableSlotTypes`) ──

/** Returns the set of slot types that the given provider's workflow
 * instance(s) connect to in the wiring layer. Only the provider's own slots
 * in its own chains count; shared slots owned by other workflows are
 * ignored. */
export function reachableSlotTypes(
  units: readonly TopologyEdgeUnit[],
  workflows: readonly Workflow[],
  providerId: string,
): Set<SlotType> {
  const providerKeys = workflowRefsFromDocument(workflows)
  const prefix = `w-${providerId}-`
  const instanceKeys = new Set<string>()
  for (const key of providerKeys.keys()) {
    if (key.startsWith(prefix)) instanceKeys.add(key)
  }
  const expanded = expandTopologyEdges(units)
  const reachable = new Set<SlotType>()
  for (const chain of expanded) {
    if (chain.length === 0 || !chain[0].startsWith('pv-')) continue
    const key = chain[0].slice(3)
    if (!instanceKeys.has(key)) continue
    const slotPrefix = `slot-${key}-`
    for (const ref of chain.slice(1)) {
      if (!ref.startsWith(slotPrefix)) continue
      const slotType = ref.slice(slotPrefix.length) as SlotType
      reachable.add(slotType)
    }
  }
  return reachable
}

// ── ReactFlow helpers ──

/** Extracts the workflow key from a slot ref ("slot-w-p-0-0-logOutput" → "w-p-0-0"). */
export function workflowKeyFromSlotRef(ref: string): string | null {
  if (!ref.startsWith('slot-')) return null
  const rest = ref.slice(5)
  const lastDash = rest.lastIndexOf('-')
  return lastDash >= 0 ? rest.slice(0, lastDash) : rest
}

/** Convenience id used for wiring edges, following the existing
 * "{source}→{target}" convention. */
export function wiringEdgeId(source: string, target: string): string {
  return `${source}→${target}`
}

/** True for edges that belong to the user-editable wiring layer (model →
 * provider edges are fixed and never part of the edge document). */
export function isWiringEdge(edge: Pick<Edge, 'source'>): boolean {
  return !edge.source.startsWith('model-')
}

/**
 * Renders ReactFlow edges from the ACTUAL edge document: model→provider edges
 * are rebuilt unchanged from the workflows map, and the wiring edges come from
 * the expanded chains only (never the default chains when edges are custom).
 */
export function buildEdgesFromTopology(
  units: readonly TopologyEdgeUnit[],
  workflows: ReadonlyMap<string, WorkflowEntry>,
  providers: readonly Provider[],
  modelNodeIds: Record<string, string>,
): Edge[] {
  const edges: Edge[] = []
  const seenIds = new Set<string>()

  // model→provider edges (not user-editable; unchanged behavior).
  for (const [workflowKey, entry] of workflows) {
    const provider = providers.find((p) => p.id === entry.providerId)
    if (!provider) continue
    const baseStyle = {
      strokeWidth: topologyConfig.edge.strokeWidth,
      opacity: entry.enabled ? 1 : 0.35,
    }
    for (const model of provider.models) {
      const modelNodeId = modelNodeIds[model.model]
      if (!modelNodeId) continue
      const id = `${modelNodeId}→pv-${workflowKey}-${model.model}`
      seenIds.add(id)
      edges.push({
        id,
        source: modelNodeId,
        sourceHandle: model.model,
        target: `pv-${workflowKey}`,
        targetHandle: model.model,
        animated: topologyConfig.edge.animated,
        style: baseStyle,
      })
    }
  }

  // wiring edges from the expanded chains (dedupe: shared tails emit the same
  // source→target pair from multiple chains).
  const opacityByKey = new Map<string, number>()
  for (const [workflowKey, entry] of workflows) {
    opacityByKey.set(workflowKey, entry.enabled ? 1 : 0.35)
  }
  const expanded = expandTopologyEdges(units)
  for (const chain of expanded) {
    let chainOpacity = 1
    if (chain.length > 0) {
      const key = chain[0].startsWith('pv-') ? chain[0].slice(3) : workflowKeyFromSlotRef(chain[0])
      chainOpacity = key !== null ? (opacityByKey.get(key) ?? 1) : 1
    }
    for (let i = 0; i < chain.length - 1; i++) {
      const source = chain[i]
      const target = chain[i + 1]
      const id = wiringEdgeId(source, target)
      if (seenIds.has(id)) continue
      seenIds.add(id)
      edges.push({
        id,
        source,
        target,
        animated: topologyConfig.edge.animated,
        style: { strokeWidth: topologyConfig.edge.strokeWidth, opacity: chainOpacity },
      })
    }
  }

  return edges
}

/**
 * Serializes a set of wiring edges (source→target pairs) back into the edge
 * document. The wiring graph has out-degree ≤ 1 per node, so it decomposes
 * into disjoint paths; each path becomes a flat chain (provider-headed or a
 * slot-headed draft). Isolated providers emit a lone "[pv-{key}]" chain so the
 * document is never empty (an empty document means "use the default").
 *
 * Flat chains are used deliberately: the backend validates each chain
 * independently (no cross-chain slot check) and both Expand and the relay's
 * ReachableSlotTypes treat flat chains with shared slots identically to
 * clusters. Flat chains are also the only representation that can express a
 * shared tail whose head is also a draft chain head — clusters cannot encode
 * that case (a slot-headed participant becomes a flow reference, which only
 * continues chains already in the expansion pool).
 */
export function serializeTopologyEdges(
  wiringEdges: ReadonlyArray<{ source: string; target: string }>,
  providerKeys: readonly string[],
): TopologyEdgeUnit[] {
  const out = new Map<string, string>()
  const indegree = new Map<string, number>()
  for (const e of wiringEdges) {
    out.set(e.source, e.target)
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
    if (!indegree.has(e.source)) indegree.set(e.source, 0)
  }

  const heads: string[] = []
  for (const node of out.keys()) {
    if ((indegree.get(node) ?? 0) === 0) heads.push(node)
  }
  heads.sort()

  const chains: string[][] = []
  for (const head of heads) {
    const chain: string[] = [head]
    const visited = new Set<string>([head])
    let current = head
    while (out.has(current)) {
      const next = out.get(current)!
      if (visited.has(next)) break // defensive: cycle — should not happen
      visited.add(next)
      chain.push(next)
      current = next
    }
    chains.push(chain)
  }

  // Isolated providers: keep a lone chain so their workflow still exists in
  // the wiring layer.
  const sortedKeys = [...providerKeys].sort()
  for (const key of sortedKeys) {
    const pv = `pv-${key}`
    if (!out.has(pv) && !indegree.has(pv)) chains.push([pv])
  }

  chains.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return chains
}
