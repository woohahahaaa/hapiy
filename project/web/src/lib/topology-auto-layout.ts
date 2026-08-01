import type { Edge, Node } from '@xyflow/react'
import { fallbackNodeSize } from '../config/topology-config'
import type { NodeSize } from './use-reactflow-node-sizes'

export type { NodeSize }

const SLOT_RANK: Record<string, number> = {
  requestModify: 0,
  responseModify: 1,
  autoReply: 2,
  concurrency: 3,
  autoSwitch: 4,
  logOutput: 5,
}

export function rankOfNode(node: Node): number {
  if (node.type === 'modelHub') return -1
  if (node.type === 'provider') return 0
  if (node.type === 'slot') {
    const rest = node.id.startsWith('slot-') ? node.id.slice(5) : node.id
    const lastDash = rest.lastIndexOf('-')
    const slotType = lastDash >= 0 ? rest.slice(lastDash + 1) : ''
    return (SLOT_RANK[slotType] ?? 99) + 1
  }
  return 99
}

function providerIdOfSlot(id: string): string | null {
  if (!id.startsWith('slot-')) return null
  const rest = id.slice(5)
  const lastDash = rest.lastIndexOf('-')
  return lastDash >= 0 ? rest.slice(0, lastDash) : rest
}

export interface LayoutOptions {
  readonly nodeGap: number
  readonly rowGap: number
  readonly modelHubGap: number
  readonly groupGap: number
  readonly marginX: number
  readonly marginY: number
}

export type NodeSizeMap = ReadonlyMap<string, NodeSize>

/**
 * Two-group edge-to-edge layout:
 *   1. Model group (left): modelHub nodes stacked vertically, right-aligned.
 *   2. Workflow group (right): each workflow is a left-to-right row of
 *      provider + slots, top-aligned. Rows stack vertically.
 *   3. Workflow group left edge = model group right edge + groupGap.
 *   4. Both groups are vertically centered relative to each other.
 *
 * All sizes come from the measured NodeSizeMap; nodes without a measurement
 * fall back to `fallbackNodeSize`. All gaps are literal edge-to-edge distances.
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions,
  sizes?: NodeSizeMap,
): Node[] {
  void edges
  const { nodeGap, rowGap, modelHubGap, groupGap, marginX, marginY } = options

  const sizeOf = (node: Node): NodeSize => {
    const measured = sizes?.get(node.id)
    if (measured && measured.width > 0 && measured.height > 0) return measured
    return { width: fallbackNodeSize.width, height: fallbackNodeSize.height }
  }

  const modelNodes = nodes.filter((n) => n.type === 'modelHub')
  const nonModel = nodes.filter((n) => n.type !== 'modelHub')

  // Group non-model nodes by workflow (provider + its slots)
  const byWorkflow = new Map<string, Node[]>()
  for (const n of nonModel) {
    const key = n.type === 'provider'
      ? n.id.replace(/^pv-/, '')
      : (providerIdOfSlot(n.id) ?? '_orphan_')
    const list = byWorkflow.get(key) ?? []
    list.push(n)
    byWorkflow.set(key, list)
  }
  for (const [, list] of byWorkflow) {
    list.sort((a, b) => rankOfNode(a) - rankOfNode(b) || a.id.localeCompare(b.id))
  }

  // Lay out each workflow row: left-to-right, top-aligned
  type PlacedNode = { node: Node; x: number; y: number }
  type WorkflowRow = { providerId: string; width: number; height: number; nodes: PlacedNode[] }

  const workflowRows: WorkflowRow[] = []
  for (const [providerId, list] of byWorkflow) {
    let cursorX = 0
    let maxH = 0
    const placed: PlacedNode[] = []
    for (let i = 0; i < list.length; i++) {
      const node = list[i]
      const d = sizeOf(node)
      placed.push({ node, x: cursorX, y: 0 })
      cursorX += d.width + (i < list.length - 1 ? nodeGap : 0)
      if (d.height > maxH) maxH = d.height
    }
    const rowWidth = cursorX
    workflowRows.push({ providerId, width: rowWidth, height: maxH, nodes: placed })
  }

  workflowRows.sort((a, b) => a.providerId.localeCompare(b.providerId))

  // Compute workflow group dimensions
  const workflowTotalHeight = workflowRows.reduce(
    (acc, r, i) => acc + r.height + (i > 0 ? rowGap : 0),
    0,
  )

  // Sort and lay out model nodes: vertical stack, right-aligned
  const sortedModels = [...modelNodes].sort((a, b) => a.id.localeCompare(b.id))
  const modelSizes = sortedModels.map(sizeOf)
  const modelTotalHeight = modelSizes.reduce(
    (acc, s, i) => acc + s.height + (i > 0 ? modelHubGap : 0),
    0,
  )
  const modelMaxWidth = modelSizes.reduce((max, s) => Math.max(max, s.width), 0)

  // Vertically center both groups
  const groupCenterY = Math.max(workflowTotalHeight, modelTotalHeight) / 2
  const workflowStartY = marginY + (groupCenterY - workflowTotalHeight / 2)
  const modelStartY = marginY + (groupCenterY - modelTotalHeight / 2)

  const positions = new Map<string, { x: number; y: number }>()

  // Model group: right-aligned at (marginX + modelMaxWidth)
  let modelCursorY = modelStartY
  for (let i = 0; i < sortedModels.length; i++) {
    const s = modelSizes[i]
    const x = marginX + modelMaxWidth - s.width
    positions.set(sortedModels[i].id, { x, y: modelCursorY })
    modelCursorY += s.height + modelHubGap
  }

  // Workflow group: left-aligned at (model group right edge + groupGap)
  const modelGroupRightEdge = modelMaxWidth > 0 ? marginX + modelMaxWidth + groupGap : marginX
  const workflowX = modelGroupRightEdge
  let rowCursorY = workflowStartY
  for (const row of workflowRows) {
    for (const p of row.nodes) {
      positions.set(p.node.id, { x: workflowX + p.x, y: rowCursorY })
    }
    rowCursorY += row.height + rowGap
  }

  return nodes.map((node) => {
    const pos = positions.get(node.id)
    if (!pos) return node
    return { ...node, position: { x: pos.x, y: pos.y } }
  })
}
