import type { FlatNode, FlatTopology, FlatWire } from './dashboard-api'
import {
  canvasFromFlat,
  flatWiresFromCanvas,
  isEmergencyEntry,
  isProviderSlot,
  isRequestEntry,
} from './flat-topology'

export type AttachProviderResult =
  | { readonly kind: 'exists' }
  | { readonly kind: 'attached'; readonly topology: FlatTopology }
  | {
      readonly kind: 'workflowCreated'
      readonly topology: FlatTopology
      readonly entryId: string
      readonly slotId: string
    }

function reaches(wires: readonly FlatWire[], from: string, to: string): boolean {
  const queue = [from]
  const seen = new Set<string>([from])
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === to) return true
    for (const w of wires) {
      if (w.source === cur && !seen.has(w.target)) {
        seen.add(w.target)
        queue.push(w.target)
      }
    }
  }
  return false
}

/**
 * 供应商页保存后「添加到转发拓扑」：把新供应商作为一张供应商卡挂进拓扑。
 *
 * - 优先加入第一个「普通启用入口可达」的供应商插槽（追加在现有卡片之后，
 *   即作为后顺位备选）；
 * - 没有任何可用工作流时，新建一条最小链路：请求入口 → 供应商插槽 → 供应商卡；
 * - 拓扑里已有该供应商的卡片时不做改动，返回 exists。
 */
export function attachProviderToTopology(
  tp: FlatTopology,
  provider: { readonly id: string; readonly name: string },
  entryName: string,
): AttachProviderResult {
  const hasCard = tp.nodes.some(
    (n) => n.kind === 'provider' && (n.providerId === provider.id || (!n.providerId && n.name === provider.name)),
  )
  if (hasCard) return { kind: 'exists' }

  const suffix = crypto.randomUUID().slice(0, 8)
  const card: FlatNode = {
    id: `prov-${suffix}`,
    kind: 'provider',
    name: provider.name,
    providerId: provider.id,
    enabled: true,
  }

  const enabledEntries = tp.nodes.filter(
    (n) => isRequestEntry(n) && n.enabled && !isEmergencyEntry(n) && (n.weight ?? 1) > 0,
  )
  const targetSlot = tp.nodes.find(
    (n) => isProviderSlot(n) && enabledEntries.some((entry) => reaches(tp.wires, entry.id, n.id)),
  )

  if (targetSlot) {
    const slotIndex = tp.nodes.findIndex((n) => n.id === targetSlot.id)
    // 插到该插槽现有的供应商子卡之后（子卡按相邻关系归属上方插槽）。
    let insertAt = slotIndex + 1
    while (insertAt < tp.nodes.length && tp.nodes[insertAt].kind === 'provider') insertAt++
    const nodes = [...tp.nodes.slice(0, insertAt), card, ...tp.nodes.slice(insertAt)]
    const collapsed = canvasFromFlat(nodes, tp.wires)
    const wires = flatWiresFromCanvas({
      topLevel: collapsed.topLevel,
      providers: collapsed.providers,
      providerSlotOf: collapsed.providerSlotOf,
      canvasWires: collapsed.canvasWires,
    })
    return { kind: 'attached', topology: { nodes, wires } }
  }

  const entryId = `entry-${suffix}`
  const slotId = `pslot-${suffix}`
  const nodes: FlatNode[] = [
    ...tp.nodes,
    { id: entryId, kind: 'requestEntry', name: entryName, enabled: true, weight: 1 },
    { id: slotId, kind: 'slot', slotType: 'provider', enabled: true },
    card,
  ]
  const wires: FlatWire[] = [
    ...tp.wires,
    { source: entryId, target: slotId },
    { source: slotId, target: card.id },
  ]
  return { kind: 'workflowCreated', topology: { nodes, wires }, entryId, slotId }
}
