import type { CSSProperties } from 'react'
import type { Node } from '@xyflow/react'
import type { FlatNode, Provider, SwitchNodeConfig } from '@/lib/dashboard-api'
import {
  isEmergencyEntry,
  isProviderSlot,
  isRequestEntry,
  isSwitchNode,
  PROVIDER_SLOT_TYPE,
  type FlatCanvas,
} from '@/lib/flat-topology'
import { SLOT_LABELS, type SlotEntry } from '@/components/node/slot/items'
import { i18n } from '@/i18n/i18n'

// Default entry labels in both languages: an entry keeps a user-renamed name,
// and the built-in names are treated as "unnamed" when deriving the display
// label.
const ENTRY_DEFAULT_NAMES = new Set<string>([
  i18n.t('topology:node.entry', { lng: 'zh' }),
  i18n.t('topology:node.entry', { lng: 'en' }),
  i18n.t('topology:node.emergencyEntry', { lng: 'zh' }),
  i18n.t('topology:node.emergencyEntry', { lng: 'en' }),
])

const DEFAULT_ENTRY_POSITION = { x: 300, y: 20 }
const DEFAULT_SLOT_POSITION = { x: 560, y: 20 }

export interface CanvasEntryModel {
  readonly id: string
  readonly label: string
  readonly active: boolean
}

/**
 * Interactive behavior injected by the live canvas. The version preview omits
 * every handler (all callbacks become no-ops), so node construction stays in
 * one place while the preview stays read-only.
 */
export interface CanvasNodeHandlers {
  onEntryChangeEnabled: (id: string, enabled: boolean) => void
  onEntryChangeWeight: (id: string, weight: number) => void
  onAddProvider: (slotId: string) => void
  onSelectProvider: (slotId: string, providerId: string) => void
  onToggleProvider: (providerId: string, enabled: boolean) => void
  onDeleteProvider: (providerId: string) => void
  onReorderProvider: (slotId: string, from: number, to: number) => void
  onCycleStrategy: (slotId: string, strategy: string) => void
  onToggleSlotEnabled: (slotId: string, enabled: boolean) => void
  onSelectExecutor: (slotId: string, token: string | null) => void
  onSaveSwitchConfig: (slotId: string, name: string, config: SwitchNodeConfig) => void
  onChangeSlotEntry: (slotId: string, slotType: string, entry: SlotEntry) => void
  onDeleteSlotEntry: (slotId: string, slotType: string, index: number) => void
  onReorderSlotEntries: (slotId: string, slotType: string, from: number, to: number) => void
  onSetSlotDeadline: (slotId: string, deadlineAt: number | null) => void
  onStartSlotCapture: (slotId: string, deadlineAt: number) => void
  onAutoCloseEntry: () => void
}

export interface CanvasNodeContext {
  readonly providers: readonly Provider[]
  /** Saved canvas positions (live canvas); preview falls back to defaults. */
  readonly positionOf?: (id: string) => { x: number; y: number } | undefined
  /** Emergency-entry accent (live canvas only). */
  readonly accentStyleOf?: (id: string) => CSSProperties | undefined
  /** Per-entry model chips (live canvas only). */
  readonly entryModels?: ReadonlyMap<string, readonly CanvasEntryModel[]>
  readonly externallyDisabledIds?: ReadonlySet<string>
  readonly disableStatuses?: ReadonlyMap<string, unknown>
  readonly slotRules?: unknown
  readonly slotRuleStatus?: unknown
  readonly refreshRuleType?: unknown
  readonly litNodeLayers?: ReadonlyMap<string, unknown>
  readonly handlers?: Partial<CanvasNodeHandlers>
}

/**
 * Builds the top-level ReactFlow nodes for a collapsed flat canvas. This is the
 * single source of truth shared by the live canvas and the version preview —
 * duplicating it previously let the preview drift (e.g. condition-switch nodes
 * rendered as slots and their branch wires lost the yes/no handles).
 *
 * The live canvas passes positions, accent, disable state and interactive
 * handlers; the preview passes just `t` and `providers`, so it renders the same
 * node shapes read-only.
 */
export function buildCanvasNodes(canvas: FlatCanvas, ctx: CanvasNodeContext): Node[] {
  const providers = ctx.providers
  const handlers = ctx.handlers ?? {}

  const positionOf = (node: FlatNode) =>
    ctx.positionOf?.(node.id) ?? (isRequestEntry(node) ? DEFAULT_ENTRY_POSITION : DEFAULT_SLOT_POSITION)
  const accentStyleOf = ctx.accentStyleOf ?? (() => undefined)

  const providerById = new Map(providers.map((p) => [p.id, p]))
  const providerByName = new Map(providers.map((p) => [p.name, p]))
  const providerOptions = providers.map((p) => ({ id: p.id, name: p.name }))
  const providerOptionsWithModels = providers.map((p) => ({ id: p.id, name: p.name, models: p.models.map((m) => m.model) }))

  // Incoming-wire count per slot/switch, driving the left handlebar segments.
  const connectionCount = new Map<string, number>()
  for (const w of canvas.canvasWires) {
    const target = canvas.topLevel.find((n) => n.id === w.target)
    if (target?.kind === 'slot' || target?.kind === 'switch') {
      connectionCount.set(w.target, (connectionCount.get(w.target) ?? 0) + 1)
    }
  }

  const nodes: Node[] = []
  for (const node of canvas.topLevel) {
    if (isRequestEntry(node)) {
      nodes.push({
        id: node.id,
        type: 'requestEntry',
        position: positionOf(node),
        style: accentStyleOf(node.id),
        data: {
          label: !node.name || ENTRY_DEFAULT_NAMES.has(node.name)
            ? (isEmergencyEntry(node) ? i18n.t('topology:node.emergencyEntry') : i18n.t('topology:node.entry'))
            : node.name,
          enabled: node.enabled,
          weight: node.weight ?? 1,
          accentColor: isEmergencyEntry(node) ? 'var(--warning)' : undefined,
          models: ctx.entryModels?.get(node.id) ?? [],
          onChangeEnabled: (enabled: boolean) => handlers.onEntryChangeEnabled?.(node.id, enabled),
          onChangeWeight: (weight: number) => handlers.onEntryChangeWeight?.(node.id, weight),
        },
      })
    } else if (isProviderSlot(node)) {
      const children = canvas.providers
        .filter((p) => canvas.providerSlotOf.get(p.id) === node.id)
        .map((p) => {
          // ID 优先解析供应商；旧数据缺 providerId 时按名称兜底
          const provider = p.providerId ? providerById.get(p.providerId) : p.name ? providerByName.get(p.name) : undefined
          return {
            id: p.id,
            providerId: p.providerId ?? '',
            label: provider?.name ?? p.name ?? '',
            baseURLCount: provider?.baseUrls.length ?? 0,
            keyCount: provider?.keys.length ?? 0,
            modelCount: provider?.models.length ?? 0,
            endpointCount: provider?.endpoints.length ?? 0,
            enabled: p.enabled,
            providerStatus: provider?.status ?? false,
            autoDisabled: provider?.autoDisabled ?? false,
            disableStatus: p.providerId ? ctx.disableStatuses?.get(p.providerId) ?? null : null,
          }
        })
      nodes.push({
        id: node.id,
        type: 'slot',
        position: positionOf(node),
        style: accentStyleOf(node.id),
        data: {
          title: i18n.t('topology:node.providerSlot'),
          slotType: PROVIDER_SLOT_TYPE,
          isProviderSlot: true,
          connectionCount: connectionCount.get(node.id) ?? 1,
          externallyDisabled: ctx.externallyDisabledIds?.has(node.id) ?? false,
          children,
          providers: providerOptions,
          onAddProvider: () => handlers.onAddProvider?.(node.id),
          onSelectProvider: (nodeId: string, providerId: string) => handlers.onSelectProvider?.(nodeId, providerId),
          onToggleProvider: (providerId: string, enabled: boolean) => handlers.onToggleProvider?.(providerId, enabled),
          onDeleteProvider: (providerId: string) => handlers.onDeleteProvider?.(providerId),
          onReorderProvider: (from: number, to: number) => handlers.onReorderProvider?.(node.id, from, to),
          strategy: node.strategy ?? 'sequential',
          onCycleStrategy: () => handlers.onCycleStrategy?.(node.id, node.strategy ?? 'sequential'),
          enabled: node.enabled,
          onToggleEnabled: (nextEnabled: boolean) => handlers.onToggleSlotEnabled?.(node.id, nextEnabled),
          onSelectExecutor: (token: string | null) => handlers.onSelectExecutor?.(node.id, token),
        },
      })
    } else if (isSwitchNode(node)) {
      nodes.push({
        id: node.id,
        type: 'switch',
        position: positionOf(node),
        style: accentStyleOf(node.id),
        data: {
          title: i18n.t('topology:node.switch'),
          name: node.name,
          connectionCount: connectionCount.get(node.id) ?? 1,
          externallyDisabled: false,
          config: node.config ?? { providers: [], conditions: [] },
          providers: providerOptionsWithModels,
          flashLayers: ctx.litNodeLayers?.get(node.id),
          onSaveConfig: (name: string, config: SwitchNodeConfig) => handlers.onSaveSwitchConfig?.(node.id, name, config),
        },
      })
    } else {
      const slotType = node.slotType ?? ''
      nodes.push({
        id: node.id,
        type: 'slot',
        position: positionOf(node),
        style: accentStyleOf(node.id),
        data: {
          title: SLOT_LABELS[slotType as keyof typeof SLOT_LABELS] ?? node.slotType ?? i18n.t('topology:node.slotFallback'),
          slotType: node.slotType ?? '',
          enabled: node.enabled,
          isProviderSlot: false,
          connectionCount: connectionCount.get(node.id) ?? 1,
          externallyDisabled: ctx.externallyDisabledIds?.has(node.id) ?? false,
          entries: [...(node.entries ?? [])],
          rules: ctx.slotRules,
          providers: providerOptions,
          ruleStatus: ctx.slotRuleStatus,
          refreshRuleType: ctx.refreshRuleType,
          onChangeEntry: (next: SlotEntry) => handlers.onChangeSlotEntry?.(node.id, slotType, next),
          onDeleteEntry: (index: number) => handlers.onDeleteSlotEntry?.(node.id, slotType, index),
          onReorderEntries: (from: number, to: number) => handlers.onReorderSlotEntries?.(node.id, slotType, from, to),
          deadlineAt: node.deadlineAt ?? null,
          onToggleEnabled: (nextEnabled: boolean) => handlers.onToggleSlotEnabled?.(node.id, nextEnabled),
          onSetDeadline: (deadlineAt: number | null) => handlers.onSetSlotDeadline?.(node.id, deadlineAt),
          onStartCapture: (deadlineAt: number) => handlers.onStartSlotCapture?.(node.id, deadlineAt),
          onSelectExecutor: (token: string | null) => handlers.onSelectExecutor?.(node.id, token),
          onAutoCloseEntry: () => handlers.onAutoCloseEntry?.(),
        },
      })
    }
  }
  return nodes
}
