import type { FlatNode, FlatTopology, FlatWire } from './dashboard-api'

export type AttachProviderResult =
  | { readonly kind: 'exists' }
  | {
      readonly kind: 'workflowCreated'
      readonly topology: FlatTopology
      readonly entryId: string
      readonly slotId: string
    }

/**
 * 供应商页保存后「添加到转发拓扑」：为新供应商建一条独立工作流。
 *
 * - 拓扑里已有该供应商的卡片时不做改动，返回 exists；
 * - 其余情况一律新建「请求入口 → 供应商插槽 → 供应商卡」这条最小链路，
 *   不塞进别的供应商插槽（那会把它变成别人工作流里的备选，位置也由别人的
 *   槽位决定，和操作员的预期不符）。
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
  const entryId = `entry-${suffix}`
  const slotId = `pslot-${suffix}`
  const card: FlatNode = {
    id: `prov-${suffix}`,
    kind: 'provider',
    name: provider.name,
    providerId: provider.id,
    enabled: true,
  }

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
