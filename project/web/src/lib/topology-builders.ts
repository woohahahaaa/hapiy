import type { Node, Edge } from '@xyflow/react'
import type { Provider } from '@/lib/dashboard-api'
import {
  SLOT_ORDER,
  SLOT_LABELS,
  type SlotEntry,
  type SlotEntryMap,
  type SlotRuleMap,
  type SlotType,
} from '@/components/topology/slot-items'
import type { WorkflowEntry } from '@/lib/topology-document'
import { topologyConfig } from '@/config/topology-config'

export type LayoutSnapshot = Record<string, { x: number; y: number }>

export function buildModelNodes(
  providers: readonly Provider[],
  modelNodeIds: Record<string, string>,
  layout: LayoutSnapshot,
): Node[] {
  const nodes: Node[] = []
  const uniqueModels = new Set<string>()
  for (const provider of providers) {
    for (const model of provider.models) uniqueModels.add(model.model)
  }
  const sortedModels = Array.from(uniqueModels).sort((a, b) => a.localeCompare(b))

  sortedModels.forEach((modelName, idx) => {
    const nodeId = modelNodeIds[modelName] ?? `model-${modelName}`
    nodes.push({
      id: nodeId,
      type: 'modelHub',
      position: layout[nodeId] ?? {
        x: topologyConfig.initialPositions.modelHub.x,
        y: topologyConfig.initialPositions.modelHub.y + idx * topologyConfig.initialPositions.modelHub.verticalOffset,
      },
      data: { models: [{ id: modelName, label: modelName, disabled: false }], simplified: true },
    })
  })

  return nodes
}

export function buildSlotNodes(
  workflowKey: string,
  slots: SlotEntryMap,
  rules: SlotRuleMap,
  layout: LayoutSnapshot,
  verticalOffset: number,
  workflowEnabled: boolean,
  onChangeEntry: (workflowKey: string, slotType: SlotType, next: SlotEntry) => void,
  onDeleteEntry: (workflowKey: string, slotType: SlotType, index: number) => void,
  onReorderEntries: (workflowKey: string, slotType: SlotType, fromIndex: number, toIndex: number) => void,
): Node[] {
  const nodes: Node[] = []
  SLOT_ORDER.forEach((slotType, i) => {
    const entries = slots[slotType] ?? []
    const slotId = `slot-${workflowKey}-${slotType}`
    nodes.push({
      id: slotId,
      type: 'slot',
      position: layout[slotId] ?? {
        x: topologyConfig.initialPositions.slot.x + i * topologyConfig.initialPositions.slot.horizontalOffset,
        y: topologyConfig.initialPositions.slot.y + verticalOffset * topologyConfig.initialPositions.slot.verticalOffset,
      },
      className: workflowEnabled ? undefined : 'dim',
      data: {
        slotType,
        providerId: workflowKey,
        title: SLOT_LABELS[slotType],
        entries,
        rules,
        enabled: workflowEnabled,
        onChangeEntry: (next: SlotEntry) => onChangeEntry(workflowKey, slotType, next),
        onDeleteEntry: (index: number) => onDeleteEntry(workflowKey, slotType, index),
        onReorderEntries: (fromIndex: number, toIndex: number) => onReorderEntries(workflowKey, slotType, fromIndex, toIndex),
      },
    })
  })
  return nodes
}

export function buildEdges(
  providers: readonly Provider[],
  workflows: ReadonlyMap<string, WorkflowEntry>,
  modelNodeIds: Record<string, string>,
): Edge[] {
  const edges: Edge[] = []

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
      edges.push({
        id: `${modelNodeId}→pv-${workflowKey}-${model.model}`,
        source: modelNodeId,
        sourceHandle: model.model,
        target: `pv-${workflowKey}`,
        targetHandle: model.model,
        animated: topologyConfig.edge.animated,
        style: baseStyle,
      })
    }
    for (let i = 0; i < SLOT_ORDER.length - 1; i++) {
      const fromType = SLOT_ORDER[i]
      const toType = SLOT_ORDER[i + 1]
      const fromId = `slot-${workflowKey}-${fromType}`
      const toId = `slot-${workflowKey}-${toType}`
      edges.push({
        id: `${fromId}→${toId}`,
        source: fromId,
        target: toId,
        animated: topologyConfig.edge.animated,
        style: baseStyle,
      })
    }

    const firstSlotId = `slot-${workflowKey}-${SLOT_ORDER[0]}`
    edges.push({
      id: `pv-${workflowKey}→${firstSlotId}`,
      source: `pv-${workflowKey}`,
      target: firstSlotId,
      animated: topologyConfig.edge.animated,
      style: baseStyle,
    })
  }

  return edges
}

export function buildProviderNode(
  workflowKey: string,
  entry: WorkflowEntry,
  provider: Provider,
  layout: LayoutSnapshot,
  verticalOffset: number,
  selectedNodeId: string | null,
  onToggle: () => void,
): Node {
  return {
    id: `pv-${workflowKey}`,
    type: 'provider',
    className: [
      `pv-${workflowKey}` === selectedNodeId ? 'selected' : undefined,
      entry.enabled ? undefined : 'dim',
    ].filter(Boolean).join(' ') || undefined,
    position: layout[`pv-${workflowKey}`] ?? {
      x: topologyConfig.initialPositions.provider.x,
      y: topologyConfig.initialPositions.provider.y + verticalOffset * topologyConfig.initialPositions.provider.verticalOffset,
    },
    data: {
      label: provider.name,
      baseURLCount: provider.baseUrls.length,
      keyCount: provider.keys.length,
      modelCount: provider.models.length,
      models: provider.models.map((m) => m.model),
      active: entry.enabled,
      autoDisabled: provider.autoDisabled,
      providerStatus: provider.status,
      providerId: workflowKey,
      onToggle,
    },
  }
}
