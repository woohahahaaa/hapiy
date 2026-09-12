import type { Edge, Node } from '@xyflow/react'
import { fallbackNodeSize } from '../config/topology-config'
import type { NodeSize } from './use-reactflow-node-sizes'
import { isRequestEntry, isSwitchNode } from './flat-topology'
import type { FlatCanvas } from './flat-topology'
import type { FlatNode, FlatWire } from './dashboard-api'

export type { NodeSize }

const SLOT_RANK: Record<string, number> = {
  requestModify: 0,
  responseModify: 1,
  concurrency: 2,
  autoSwitch: 3,
  logOutput: 4,
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
 *      provider + slots, vertically centered within the row. Rows stack vertically.
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

  // Lay out each workflow row: left-to-right, vertically centered within the row
  type PlacedNode = { node: Node; x: number; y: number; height: number }
  type WorkflowRow = { providerId: string; width: number; height: number; nodes: PlacedNode[] }

  const workflowRows: WorkflowRow[] = []
  for (const [providerId, list] of byWorkflow) {
    let cursorX = 0
    let maxH = 0
    const placed: PlacedNode[] = []
    for (let i = 0; i < list.length; i++) {
      const node = list[i]
      const d = sizeOf(node)
      placed.push({ node, x: cursorX, y: 0, height: d.height })
      cursorX += d.width + (i < list.length - 1 ? nodeGap : 0)
      if (d.height > maxH) maxH = d.height
    }
    for (const p of placed) {
      p.y = (maxH - p.height) / 2
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
      positions.set(p.node.id, { x: workflowX + p.x, y: rowCursorY + p.y })
    }
    rowCursorY += row.height + rowGap
  }

  return nodes.map((node) => {
    const pos = positions.get(node.id)
    if (!pos) return node
    return { ...node, position: { x: pos.x, y: pos.y } }
  })
}

export interface FlatLayoutOptions extends LayoutOptions {
  readonly freeSlotRowWidthFactor: number
  readonly slotBaseWidth: number
}

export type LayoutPosition = { x: number; y: number }
export type LayoutPositionMap = Record<string, LayoutPosition>

/**
 * Two-group auto-layout for the FLAT canvas (magic wand):
 *   1. Model group (left): modelHub nodes stacked vertically, right-aligned.
 *   2. Workflow group (right): one row per request entry — the entry node
 *      followed by the slots reachable from it (wire chain order), left-to-right,
 *      vertically centered within the row. Rows stack vertically with rowGap.
 *   3. Switch branches: a 条件开关 ends its row; its two outgoing arms (是/否)
 *      are treated as two extra workflow rows hanging directly below the switch
 *      row, left-aligned to the switch node's left edge. A switch inside a
 *      branch hangs its own sub-branches the same way. A node with multiple
 *      incoming wires belongs to the row of its FIRST incoming wire (canvasWires
 *      order) — that source is its horizontal alignment reference.
 *   4. Free-floating region (below both groups): slots NOT reachable from any
 *      request entry (nor claimed by a switch branch), grouped by connectivity.
 *      Slots connected via canvasWires form one group (ordered in wire-chain
 *      order, chain head first); isolated slots are singleton groups. Each group
 *      is placed as a single unit (members left-to-right with nodeGap, vertically
 *      centered); groups are sorted by first member id, and a row wraps when the
 *      next group's left edge would exceed freeSlotRowWidthFactor × slotBaseWidth.
 *
 * Every modelHub, requestEntry and slot id present in `nodes`/`canvas` receives
 * a position. Gaps are literal edge-to-edge distances; sizes come from the
 * NodeSizeMap with a fallback to `fallbackNodeSize`.
 */
export function layoutFlatCanvas(
  canvas: FlatCanvas,
  nodes: Node[],
  options: FlatLayoutOptions,
  sizes?: NodeSizeMap,
): LayoutPositionMap {
  const { nodeGap, rowGap, modelHubGap, groupGap, marginX, marginY } = options
  const freeRowWidthCap = options.freeSlotRowWidthFactor * options.slotBaseWidth

  const sizeOf = (id: string): NodeSize => {
    const measured = sizes?.get(id)
    if (measured && measured.width > 0 && measured.height > 0) return measured
    return { width: fallbackNodeSize.width, height: fallbackNodeSize.height }
  }

  const topLevelById = new Map<string, FlatNode>()
  for (const n of canvas.topLevel) topLevelById.set(n.id, n)

  // A node's horizontal reference: the source of its FIRST incoming wire
  // (canvasWires order). Rows follow only incoming wires that match this
  // reference, so a node with multiple inputs belongs to its first input's row.
  const parentOf = new Map<string, string>()
  const outgoingOf = new Map<string, FlatWire[]>()
  for (const w of canvas.canvasWires) {
    if (!parentOf.has(w.target)) parentOf.set(w.target, w.source)
    const list = outgoingOf.get(w.source) ?? []
    list.push(w)
    outgoingOf.set(w.source, list)
  }

  const entries = canvas.topLevel
    .filter(isRequestEntry)
    .sort((a, b) => {
      const laneA = a.emergency === true ? 1 : 0
      const laneB = b.emergency === true ? 1 : 0
      return laneA - laneB || a.id.localeCompare(b.id)
    })

  // ── Flow tree per entry ──
  // A row is a linear left-to-right chain. The chain ends at a switch, whose
  // outgoing arms each spawn a child row hanging below. Nodes are claimed by
  // the walker that owns their first incoming wire, so a convergence node stays
  // on its first source's row and nothing is placed twice.
  interface LayoutRow {
    readonly id: string
    readonly chain: string[]
    readonly branches: LayoutRow[]
  }

  const claimed = new Set<string>()
  const entryRows: LayoutRow[] = []

  const buildRow = (startId: string, row: LayoutRow): void => {
    let cur: string | undefined = startId
    while (cur !== undefined) {
      if (claimed.has(cur)) break
      const node = topLevelById.get(cur)
      if (!node) break
      claimed.add(cur)
      if (cur !== startId && isRequestEntry(node)) break
      row.chain.push(cur)
      const outs: FlatWire[] = outgoingOf.get(cur) ?? []
      if (outs.length === 0) break
      if (isSwitchNode(node)) {
        for (const w of outs) {
          if (w.target === undefined) continue
          if (claimed.has(w.target) || parentOf.get(w.target) !== cur) continue
          const child: LayoutRow = { id: `${row.id}→${w.target}`, chain: [], branches: [] }
          buildRow(w.target, child)
          row.branches.push(child)
        }
        break
      }
      const w: FlatWire = outs[0]
      if (claimed.has(w.target) || parentOf.get(w.target) !== w.source) break
      cur = w.target
    }
  }

  for (const entry of entries) {
    const row: LayoutRow = { id: entry.id, chain: [], branches: [] }
    buildRow(entry.id, row)
    entryRows.push(row)
  }

  const sortedModels = nodes
    .filter((n) => n.type === 'modelHub')
    .sort((a, b) => a.id.localeCompare(b.id))
  const modelSizes = sortedModels.map((n) => sizeOf(n.id))
  const modelTotalHeight = modelSizes.reduce((acc, s, i) => acc + s.height + (i > 0 ? modelHubGap : 0), 0)
  const modelMaxWidth = modelSizes.reduce((max, s) => Math.max(max, s.width), 0)

  // ── Measurement ──
  // A row's block height = its own row height plus (rowGap + child block
  // height) per hanging branch, so the vertical stack below stays coherent.
  type PlacedNode = { id: string; x: number; y: number; height: number }

  const rowHeightOf = (row: LayoutRow): number =>
    row.chain.reduce((max, id) => Math.max(max, sizeOf(id).height), 0)

  const blockHeightOf = (row: LayoutRow): number => {
    let h = rowHeightOf(row)
    for (const child of row.branches) {
      h += rowGap + blockHeightOf(child)
    }
    return h
  }

  const entryRowsHeight = entryRows.reduce(
    (acc, r, i) => acc + blockHeightOf(r) + (i > 0 ? rowGap : 0),
    0,
  )

  const groupCenterY = Math.max(entryRowsHeight, modelTotalHeight) / 2
  const workflowStartY = marginY + (groupCenterY - entryRowsHeight / 2)
  const modelStartY = marginY + (groupCenterY - modelTotalHeight / 2)

  const positions: LayoutPositionMap = {}

  let modelCursorY = modelStartY
  for (let i = 0; i < sortedModels.length; i++) {
    const s = modelSizes[i]
    positions[sortedModels[i].id] = { x: marginX + modelMaxWidth - s.width, y: modelCursorY }
    modelCursorY += s.height + modelHubGap
  }

  const modelGroupRightEdge = modelMaxWidth > 0 ? marginX + modelMaxWidth + groupGap : marginX
  const workflowX = modelGroupRightEdge

  // ── Placement ──
  // Places a row (left-aligned at x) and returns its block height. Child rows
  // hang directly below, left-aligned to the x of the switch that spawned them
  // (the row's last node).
  const placeRow = (row: LayoutRow, x: number, yTop: number): number => {
    const rowIds = row.chain
    let cursorX = x
    let maxH = 0
    const xOf = new Map<string, number>()
    const placed: PlacedNode[] = []
    for (let i = 0; i < rowIds.length; i++) {
      const id = rowIds[i]
      const d = sizeOf(id)
      xOf.set(id, cursorX)
      placed.push({ id, x: cursorX, y: 0, height: d.height })
      cursorX += d.width + (i < rowIds.length - 1 ? nodeGap : 0)
      if (d.height > maxH) maxH = d.height
    }
    for (const p of placed) positions[p.id] = { x: p.x, y: yTop + (maxH - p.height) / 2 }

    const switchId = rowIds.length > 0 ? rowIds[rowIds.length - 1] : null
    const switchX = switchId !== null ? (xOf.get(switchId) ?? x) : x
    let childY = yTop + maxH
    let blockH = maxH
    for (const child of row.branches) {
      childY += rowGap
      blockH += rowGap
      const childH = placeRow(child, switchX, childY)
      blockH += childH
      childY += childH
    }
    return blockH
  }

  let rowCursorY = workflowStartY
  for (let i = 0; i < entryRows.length; i++) {
    placeRow(entryRows[i], workflowX, rowCursorY)
    rowCursorY += blockHeightOf(entryRows[i]) + (i < entryRows.length - 1 ? rowGap : 0)
  }

  // Free-floating region: top-level slots NOT reachable from any request entry
  // (nor claimed by a switch branch). Connected slots (via canvasWires) form
  // one group, placed as a single unit; isolated slots are singleton groups.
  const freeIds = canvas.topLevel
    .filter((n) => !isRequestEntry(n) && !claimed.has(n.id))
    .map((n) => n.id)

  const memberSet = new Set(freeIds)
  const adjacency = new Map<string, string[]>()
  for (const w of canvas.canvasWires) {
    if (!memberSet.has(w.source) || !memberSet.has(w.target)) continue
    const out = adjacency.get(w.source) ?? []
    out.push(w.target)
    adjacency.set(w.source, out)
    const back = adjacency.get(w.target) ?? []
    back.push(w.source)
    adjacency.set(w.target, back)
  }

  // Connected components (undirected connectivity over canvasWires).
  const components: string[][] = []
  const grouped = new Set<string>()
  for (const id of [...freeIds].sort()) {
    if (grouped.has(id)) continue
    const comp: string[] = []
    const stack = [id]
    grouped.add(id)
    while (stack.length > 0) {
      const cur = stack.pop()!
      comp.push(cur)
      for (const nb of adjacency.get(cur) ?? []) {
        if (!grouped.has(nb)) {
          grouped.add(nb)
          stack.push(nb)
        }
      }
    }
    components.push(comp)
  }

  // Order each group's members in wire-chain order (chain head first), then
  // sort groups by first member id for a deterministic placement.
  const freeGroups = components
    .map((comp) => orderFreeGroup(comp, canvas.canvasWires))
    .sort((a, b) => a[0].localeCompare(b[0]))

  const groupBottom = Math.max(workflowStartY + entryRowsHeight, modelStartY + modelTotalHeight)
  let freeCursorX = workflowX
  let freeRowY = groupBottom + rowGap
  let freeRowMaxH = 0
  let rowHasElement = false
  for (const group of freeGroups) {
    const widths = group.map((id) => sizeOf(id).width)
    const heights = group.map((id) => sizeOf(id).height)
    const groupWidth = widths.reduce((acc, w, i) => acc + w + (i > 0 ? nodeGap : 0), 0)
    const groupHeight = heights.reduce((max, h) => Math.max(max, h), 0)
    if (rowHasElement && freeCursorX - workflowX > freeRowWidthCap) {
      freeRowY += freeRowMaxH + rowGap
      freeCursorX = workflowX
      freeRowMaxH = 0
      rowHasElement = false
    }
    let cursorX = 0
    for (let i = 0; i < group.length; i++) {
      const id = group[i]
      const d = sizeOf(id)
      positions[id] = { x: freeCursorX + cursorX, y: freeRowY + (groupHeight - d.height) / 2 }
      cursorX += d.width + (i < group.length - 1 ? nodeGap : 0)
    }
    freeCursorX += groupWidth + nodeGap
    freeRowMaxH = Math.max(freeRowMaxH, groupHeight)
    rowHasElement = true
  }

  return positions
}

/**
 * Order a connected group's members in wire-chain order: chain heads (members
 * with no incoming wire from another member) first, each followed by the member
 * its outgoing wire points to; heads are processed in id order; any member not
 * reached by following from a head (e.g. a pure cycle) is appended in id order.
 * Deterministic; no member appears twice.
 */
function orderFreeGroup(members: string[], wires: readonly FlatWire[]): string[] {
  const memberSet = new Set(members)
  const outMap = new Map<string, string>()
  const inDegree = new Map<string, number>()
  for (const id of members) inDegree.set(id, 0)
  for (const w of wires) {
    if (!memberSet.has(w.source) || !memberSet.has(w.target)) continue
    if (!outMap.has(w.source)) outMap.set(w.source, w.target)
    inDegree.set(w.target, (inDegree.get(w.target) ?? 0) + 1)
  }

  const ordered: string[] = []
  const visited = new Set<string>()
  const heads = members.filter((m) => inDegree.get(m) === 0).sort()
  for (const head of heads) {
    if (visited.has(head)) continue
    let cur: string | undefined = head
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur)
      ordered.push(cur)
      cur = outMap.get(cur)
    }
  }
  for (const m of [...members].sort()) {
    if (!visited.has(m)) ordered.push(m)
  }
  return ordered
}
