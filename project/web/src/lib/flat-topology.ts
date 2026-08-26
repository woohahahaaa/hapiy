import type { FlatNode, FlatWire } from '@/lib/dashboard-api'

// ── Canvas vs flat topology ──
//
// The server stores a FLAT model: a node list (requestEntry / provider / slot)
// plus a flat wire list where every node has at most one outgoing wire. The
// canvas renders a richer, nested view:
//   - requestEntry nodes and slot nodes are top-level ReactFlow nodes;
//   - provider nodes are nested children INSIDE a "provider" slot;
//   - model-hub nodes sit to the LEFT of each request entry.
//
// A provider that is the active child of a provider slot appears in the flat
// wire chain as `slot → prov → nextSlot`. When collapsed for the canvas, that
// collapses to a single top-level edge `slot → nextSlot` and the provider is
// rendered as a child of the slot.
//
// Membership of a provider in a provider slot is stored by adjacency: a
// provider node is a child of the provider slot that immediately precedes it in
// the flat node array (until the next non-provider node). The flat wire
// `slot → prov` marks the slot's primary (wired) provider.

export const PROVIDER_SLOT_TYPE = 'provider'
export const REQUEST_REWRITE_SLOT_TYPES = [
  'requestModify',
  'responseModify',
  'autoReply',
  'concurrency',
  'autoSwitch',
  'logOutput',
] as const

/** Every slot type the system supports: the provider slot plus all rewrite slots. */
export const ALL_SLOT_TYPES = [PROVIDER_SLOT_TYPE, ...REQUEST_REWRITE_SLOT_TYPES] as const

export type RewriteSlotType = (typeof REQUEST_REWRITE_SLOT_TYPES)[number]

export function isProviderSlot(node: FlatNode): boolean {
  return node.kind === 'slot' && node.slotType === PROVIDER_SLOT_TYPE
}

export function isRequestEntry(node: FlatNode): boolean {
  return node.kind === 'requestEntry'
}

export function isProvider(node: FlatNode): boolean {
  return node.kind === 'provider'
}

/** Single outgoing target of a node (the output-single constraint). */
export function outgoing(wires: readonly FlatWire[], id: string): string | null {
  for (const w of wires) {
    if (w.source === id) return w.target
  }
  return null
}

export interface FlatCanvas {
  readonly topLevel: FlatNode[] // entries + slots (provider slots included)
  readonly providers: FlatNode[] // provider children
  readonly providerSlotOf: ReadonlyMap<string, string> // providerId -> slotId
  readonly primaryProvider: ReadonlyMap<string, string> // slotId -> primary providerId
  readonly canvasWires: FlatWire[] // top-level RF wires (slot/entry only)
}

/**
 * Collapse a flat topology into the nested canvas representation. Provider
 * children are grouped under their provider slot by adjacency. Top-level wires
 * are the flat wires between top-level nodes, with provider hops collapsed
 * (a provider slot's outgoing edge is its primary provider's downstream).
 */
export function canvasFromFlat(nodes: readonly FlatNode[], wires: readonly FlatWire[]): FlatCanvas {
  const topLevel: FlatNode[] = []
  const providers: FlatNode[] = []
  for (const n of nodes) {
    if (isProvider(n)) providers.push(n)
    else topLevel.push(n)
  }

  // Assign provider membership by adjacency: a provider belongs to the nearest
  // preceding provider slot in the flat array.
  const providerSlotOf = new Map<string, string>()
  let currentProviderSlot: string | null = null
  for (const n of nodes) {
    if (isProviderSlot(n)) currentProviderSlot = n.id
    else if (isRequestEntry(n)) currentProviderSlot = null
    else if (isProvider(n) && currentProviderSlot) providerSlotOf.set(n.id, currentProviderSlot)
  }

  // Primary provider per slot: the provider with a `slot → prov` flat wire.
  const primaryProvider = new Map<string, string>()
  for (const n of providers) {
    for (const w of wires) {
      if (w.target === n.id && isProviderSlotByNode(topLevel, w.source)) {
        primaryProvider.set(w.source, n.id)
        break
      }
    }
  }

  // Collapse provider hops in the wire list into top-level edges.
  const canvasWires: FlatWire[] = []
  const seen = new Set<string>()
  const addWire = (source: string, target: string) => {
    if (source === target) return
    const key = `${source}→${target}`
    if (seen.has(key)) return
    seen.add(key)
    canvasWires.push({ source, target })
  }

  for (const w of wires) {
    const isSourceTop = topLevel.some((n) => n.id === w.source)
    const isTargetTop = topLevel.some((n) => n.id === w.target)
    if (isSourceTop && isTargetTop) {
      addWire(w.source, w.target)
      continue
    }
    // provider → top-level: remap source to the provider's parent slot.
    if (isProviderNode(providers, w.source) && isTargetTop) {
      const parentSlot = providerSlotOf.get(w.source)
      if (parentSlot) addWire(parentSlot, w.target)
    }
    // top-level → provider is an internal nesting wire; ignored for canvas edges.
  }

  return { topLevel, providers, providerSlotOf, primaryProvider, canvasWires }
}

function isProviderSlotByNode(nodes: readonly FlatNode[], id: string): boolean {
  return nodes.some((n) => n.id === id && isProviderSlot(n))
}

function isProviderNode(nodes: readonly FlatNode[], id: string): boolean {
  return nodes.some((n) => n.id === id && isProvider(n))
}

export interface FlatSaveInput {
  readonly topLevel: readonly FlatNode[]
  readonly providers: readonly FlatNode[] // provider children, in display order per slot
  readonly providerSlotOf: ReadonlyMap<string, string> // providerId -> slotId
  readonly canvasWires: readonly FlatWire[] // top-level RF wires
}

/**
 * Reconstruct a flat wire list (valid under output-single) from the canvas
 * representation. Provider slots emit `slot → primary → downstream` so dispatch
 * can walk the chain. Non-primary provider children are emitted as dormant
 * nodes (no incoming wire) but kept in the node list.
 */
export function flatWiresFromCanvas(input: FlatSaveInput): FlatWire[] {
  const { topLevel, providers, providerSlotOf, canvasWires } = input
  const wires: FlatWire[] = []
  const seen = new Set<string>()
  const add = (s: string, t: string) => {
    if (s === t || s === '' || t === '') return
    const key = `${s}→${t}`
    if (seen.has(key)) return
    seen.add(key)
    wires.push({ source: s, target: t })
  }

  const bySlot = new Map<string, FlatNode[]>()
  for (const p of providers) {
    const slotId = providerSlotOf.get(p.id)
    if (!slotId) continue
    const list = bySlot.get(slotId) ?? []
    list.push(p)
    bySlot.set(slotId, list)
  }

  const slotIds = new Set(topLevel.map((n) => n.id))
  const providerSlotIds = new Set<string>()
  for (const n of topLevel) if (isProviderSlot(n)) providerSlotIds.add(n.id)

  for (const w of canvasWires) {
    // Provider-slot source: expand into slot → primary → downstream, with every
    // other child pointing to the same downstream as a dormant backup.
    if (providerSlotIds.has(w.source)) {
      const children = bySlot.get(w.source) ?? []
      // Empty provider slot: pass through the canvas wire directly so the
      // downstream chain stays intact (no provider to expand into).
      if (children.length === 0) {
        add(w.source, w.target)
        continue
      }
      const enabled = children.filter((p) => p.enabled)
      const primary = enabled.length > 0 ? enabled[0] : children[0]
      add(w.source, primary.id)
      if (slotIds.has(w.target)) {
        add(primary.id, w.target)
        for (const other of children) {
          if (other.id !== primary.id) add(other.id, w.target)
        }
      }
      continue
    }
    add(w.source, w.target)
  }

  return wires
}

/** A provider child is active if enabled and its configured provider is status-on. */
export function isActiveProvider(provider: FlatNode, providerStatus: boolean): boolean {
  return provider.enabled && providerStatus
}

/**
 * 返回在两个及以上激活工作流中同时启用的供应商（去重键 = 真实供应商 ID；
 * 旧数据缺 providerId 时按名称兜底，供应商重命名不会破坏去重）。每条链走到
 * 第一个 provider 节点即停止。只有"启用"的请求入口会引发激活传播。这是后端
 * `FindDuplicateActivations` 的前端镜像，并驱动"同一个 Provider 不能在多个
 * 工作流中被激活"规则。
 */
export function findDuplicateActivations(
  nodes: readonly FlatNode[],
  wires: readonly FlatWire[],
): string[] {
  const claimed = new Map<string, string>()
  const duplicated = new Set<string>()

  const walk = (entryId: string) => {
    let cur: string | null = entryId
    const seen = new Set<string>([entryId])
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const node = nodes.find((n) => n.id === cur)
      if (!node) break
      if (node.kind === 'provider') {
        const key = node.providerId ?? node.name ?? ''
        if (key) {
          const priorEntry = claimed.get(key)
          if (priorEntry !== undefined && priorEntry !== entryId) {
            duplicated.add(key)
          } else if (priorEntry === undefined) {
            claimed.set(key, entryId)
          }
        }
        break
      }
      cur = outgoing(wires, cur)
    }
  }

  for (const n of nodes) {
    if (n.kind === 'requestEntry' && n.enabled) walk(n.id)
  }
  return Array.from(duplicated)
}

/**
 * Recompute the wire list after removing a set of nodes, rerouting around the
 * gaps: when a removed node had a surviving predecessor S and, following the
 * single-output chain through removed nodes, a first surviving successor T, the
 * result connects S → T. Wires touching any removed node are dropped; unrelated
 * wires keep their relative order. Self-loops and duplicates are suppressed.
 */
export function rerouteWiresAroundRemoved(
  wires: readonly FlatWire[],
  removedIds: readonly string[],
): FlatWire[] {
  const removed = new Set(removedIds)
  if (removed.size === 0) return [...wires]

  const out = new Map<string, string>()
  for (const w of wires) out.set(w.source, w.target)

  const result: FlatWire[] = []
  const seen = new Set<string>()
  const add = (source: string, target: string) => {
    if (source === target) return
    const key = `${source}\u2192${target}`
    if (seen.has(key)) return
    seen.add(key)
    result.push({ source, target })
  }

  for (const w of wires) {
    const { source, target } = w
    if (removed.has(source)) continue

    // A wire into a removed node starts a reroute: walk the outgoing chain from
    // the removed target until the first surviving node.
    if (!removed.has(target)) {
      add(source, target)
      continue
    }
    let cur = target
    const guard = new Set<string>()
    let survivor: string | undefined
    while (cur !== undefined && !guard.has(cur)) {
      guard.add(cur)
      const next = out.get(cur)
      if (next === undefined) break
      if (!removed.has(next)) {
        survivor = next
        break
      }
      cur = next
    }
    if (survivor !== undefined) add(source, survivor)
  }

  return result
}
