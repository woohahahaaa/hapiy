import { useEffect } from 'react'
import type { FlatNode, FlatTopology, Provider } from '@/lib/dashboard-api'
import type { FlatCanvas } from '@/lib/flat-topology'

export type ExecutorDebugTarget =
  | { kind: 'executor'; slotId: string; token: string }
  | { kind: 'node'; nodeId: string }

interface ExecutorDebugProps {
  topology: FlatTopology | null
  providers: readonly Provider[] | null
  canvas: FlatCanvas | null
  externallyDisabledSlotIds: ReadonlySet<string>
  target: ExecutorDebugTarget | null
}

interface Check {
  label: string
  detail: string
  ok: boolean
}

const nowMs = () => Date.now()

function entryCheck(entry: FlatNode | undefined): Check {
  if (!entry) return { label: 'entry', detail: '未找到入口', ok: false }
  const ok = entry.enabled === true && (entry.weight ?? 1) > 0
  return { label: 'entry', detail: `${entry.id} enabled=${entry.enabled === true} weight=${entry.weight ?? 1}`, ok }
}

function slotCheck(slot: FlatNode | undefined, externalDisabled: boolean): Check {
  if (!slot) return { label: 'slot', detail: '未找到插槽', ok: false }
  const enabled = slot.enabled !== false
  const deadline = slot.deadlineAt ?? null
  const deadlineOk = deadline === null || deadline > nowMs()
  const parts = [`${slot.id} enabled=${enabled}`, `deadline=${deadline === null ? '常开' : deadline > nowMs() ? '未到' : '已过期'}`]
  if (externalDisabled) parts.push('外部禁用')
  return {
    label: 'slot',
    detail: parts.join(' '),
    ok: enabled && deadlineOk && !externalDisabled,
  }
}

function selfCheck(child: FlatNode | undefined): Check {
  if (!child) return { label: '自身', detail: '无节点', ok: false }
  return { label: '自身', detail: `${child.id} enabled=${child.enabled === true}`, ok: child.enabled === true }
}

function ruleCheck(kind: string, child: FlatNode | undefined, providers: readonly Provider[] | null): Check {
  if (!child) return { label: '规则', detail: '无', ok: true }
  if (kind === 'provider') {
    const record = child.providerId
      ? providers?.find((p) => p.id === child.providerId)
      : providers?.find((p) => p.name === child.name)
    if (!record) return { label: '规则', detail: '未绑定供应商记录', ok: false }
    const ok = record.status === true && record.autoDisabled === false && record.workflowEnabled === true
    return {
      label: '规则',
      detail: `${record.name} status=${record.status === true} autoDisabled=${record.autoDisabled === true} workflow=${record.workflowEnabled === true}`,
      ok,
    }
  }
  return { label: '规则', detail: `${kind} 规则（status 由执行链校验）`, ok: true }
}

function entryOf(nodeId: string, topology: FlatTopology): FlatNode | undefined {
  const seen = new Set<string>()
  let cur = nodeId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const wire = topology.wires.find((w) => w.target === cur)
    if (!wire) break
    const source = topology.nodes.find((n) => n.id === wire.source)
    if (!source) break
    if (source.kind === 'requestEntry') return source
    cur = source.id
  }
  return undefined
}

function logChecks(indent: string, checks: Check[]) {
  for (const c of checks) {
    console.log(`${indent}${c.ok ? '✓' : '✗'} ${c.label}: ${c.detail}`)
  }
}

function logExecutorRow(name: string, kind: string, checks: Check[]) {
  logChecks('  ', checks)
  console.log(`  == 最终判定: ${checks.every((c) => c.ok) ? '启用' : '禁用'} (${kind})`)
}

export function ExecutorDebug({ topology, providers, canvas, externallyDisabledSlotIds, target }: ExecutorDebugProps) {
  useEffect(() => {
    if (!topology || !canvas || !target) return

    if (target.kind === 'executor') {
      const slot = topology.nodes.find((n) => n.id === target.slotId)
      if (!slot) return
      const entry = entryCheck(entryOf(target.slotId, topology))
      const slotC = slotCheck(slot, externallyDisabledSlotIds.has(slot.id))
      const child =
        slot.slotType === 'provider'
          ? canvas.providers.find((p) => p.id === target.token)
          : undefined
      const entryRow = (slot.entries ?? []).find((e) => e.id === target.token)

      console.group(`[ExecutorDebug] executor ${target.token} (${slot.slotType} @ ${target.slotId})`)
      logChecks('  ', [entry, slotC])
      if (child) {
        const self = selfCheck(child)
        const rule = ruleCheck('provider', child, providers)
        logExecutorRow(child.name ?? child.id, 'provider', [entry, slotC, self, rule])
      } else if (entryRow) {
        const self = { label: '自身', detail: `${entryRow.id} enabled=${entryRow.enabled === true}`, ok: entryRow.enabled === true }
        logExecutorRow(`${slot.slotType} #${entryRow.index ?? 1}`, String(slot.slotType), [entry, slotC, self])
      } else {
        console.log('  目标条目不存在（可能已删除）')
      }
      console.groupEnd()
      return
    }

    const node = topology.nodes.find((n) => n.id === target.nodeId)
    if (!node) return

    if (node.kind === 'requestEntry') {
      console.group(`[ExecutorDebug] entry ${node.id}`)
      logExecutorRow('请求入口', 'requestEntry', [entryCheck(node)])
      console.groupEnd()
      return
    }
    if (node.kind === 'modelHub') {
      console.group(`[ExecutorDebug] model ${node.id}`)
      console.log('  模型中心：无生效判定（仅请求入口/插槽参与判定）')
      console.groupEnd()
      return
    }
    if (node.kind !== 'slot') return

    const entry = entryCheck(entryOf(node.id, topology))
    const slotC = slotCheck(node, externallyDisabledSlotIds.has(node.id))
    const slotOk = entry.ok && slotC.ok

    console.group(`[ExecutorDebug] slot ${node.id} (${node.slotType ?? '?'})`)
    logChecks('  ', [entry, slotC])
    console.log(`  == slot 整体判定: ${slotOk ? '生效' : '不生效'}`)

    if (node.slotType === 'provider') {
      const children = canvas.providers.filter((p) => canvas.providerSlotOf.get(p.id) === node.id)
      if (children.length === 0) {
        console.log('  （插槽为空，无内部 executor）')
      } else {
        console.log('  ── 内部 executor ──')
        for (const child of children) {
          const self = selfCheck(child)
          const rule = ruleCheck('provider', child, providers)
          const ok = [entry, slotC, self, rule].every((c) => c.ok)
          console.log(`  [${ok ? '启用' : '禁用'}] ${child.name ?? child.id} (provider): entry${entry.ok ? '✓' : '✗'} slot${slotC.ok ? '✓' : '✗'} 自身${self.ok ? '✓' : '✗'} 规则${rule.ok ? '✓' : '✗'}`)
        }
      }
    } else {
      const entries = node.entries ?? []
      if (entries.length === 0) {
        console.log('  （插槽为空，无内部 executor）')
      } else {
        console.log('  ── 内部 executor ──')
        for (const e of entries) {
          const selfOk = e.enabled === true
          console.log(`  [${selfOk && slotOk ? '启用' : '禁用'}] ${node.slotType} #${e.index ?? 1}: entry${entry.ok ? '✓' : '✗'} slot${slotC.ok ? '✓' : '✗'} 自身${selfOk ? '✓' : '✗'}`)
        }
      }
    }
    console.groupEnd()
  }, [topology, providers, canvas, externallyDisabledSlotIds, target])
  return null
}