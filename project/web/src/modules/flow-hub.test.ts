import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFlowSteps, FlowHub, FLOW_STEP_MS, type FlowStep } from './flow-hub'

afterEach(() => {
  vi.useRealTimers()
})

const canvas = {
  topLevel: [
    { id: 'model-kimi-k3', kind: 'modelHub' },
    { id: 'entry-1', kind: 'requestEntry' },
    { id: 'pslot-1', kind: 'slot', slotType: 'provider' },
    { id: 'requestModify-1', kind: 'slot', slotType: 'requestModify' },
    { id: 'logOutput-1', kind: 'slot', slotType: 'logOutput' },
  ],
  providers: [{ id: 'prov-a' }, { id: 'prov-b' }],
  providerSlotOf: new Map([
    ['prov-a', 'pslot-1'],
    ['prov-b', 'pslot-1'],
  ]),
} as never

function stepsOf(path: string[]): FlowStep[] {
  return buildFlowSteps(path, canvas)
}

describe('buildFlowSteps', () => {
  it('interleaves node and edge steps, folding provider children for edges', () => {
    const steps = stepsOf(['model-kimi-k3', 'entry-1', 'pslot-1', 'prov-a', 'requestModify-1', 'logOutput-1'])
    expect(steps).toEqual([
      { kind: 'node', nodeId: 'model-kimi-k3' },
      { kind: 'edge', edgeId: 'model-kimi-k3→entry-1' },
      { kind: 'node', nodeId: 'entry-1' },
      { kind: 'edge', edgeId: 'entry-1→pslot-1' },
      { kind: 'node', nodeId: 'pslot-1' },
      { kind: 'node', nodeId: 'prov-a' },
      { kind: 'edge', edgeId: 'pslot-1→requestModify-1' },
      { kind: 'node', nodeId: 'requestModify-1' },
      { kind: 'edge', edgeId: 'requestModify-1→logOutput-1' },
      { kind: 'node', nodeId: 'logOutput-1' },
    ])
  })

  it('returns empty for short paths', () => {
    expect(stepsOf(['model-kimi-k3'])).toEqual([])
  })
})

describe('FlowHub', () => {
  it('plays steps strictly in order with one step per FLOW_STEP_MS', async () => {
    vi.useFakeTimers()
    const fired: FlowStep[] = []
    const hub = new FlowHub({ onStep: (_id, step) => void fired.push(step), onRunEnd: () => {} })
    hub.startRun({ requestId: 'req-1', color: '#fff', steps: stepsOf(['model-kimi-k3', 'entry-1', 'requestModify-1']) })
    expect(fired).toEqual([{ kind: 'node', nodeId: 'model-kimi-k3' }])
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS)
    expect(fired[1]).toEqual({ kind: 'edge', edgeId: 'model-kimi-k3→entry-1' })
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS)
    expect(fired[2]).toEqual({ kind: 'node', nodeId: 'entry-1' })
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS * 4)
    expect(fired.map((s) => s.kind)).toEqual(['node', 'edge', 'node', 'edge', 'node'])
  })

  it('removes a run after its final step', async () => {
    vi.useFakeTimers()
    const ended: number[] = []
    const hub = new FlowHub({ onStep: () => {}, onRunEnd: (id) => ended.push(id) })
    const runId = hub.startRun({
      requestId: 'req-1',
      color: '#fff',
      steps: stepsOf(['model-kimi-k3', 'entry-1', 'requestModify-1']),
    })
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS * 5)
    expect(ended).toEqual([runId])
  })

  it('runs from the same request overlap independently', async () => {
    vi.useFakeTimers()
    const fired: Array<{ runId: number; step: FlowStep }> = []
    const hub = new FlowHub({
      onStep: (runId, step) => void fired.push({ runId, step }),
      onRunEnd: () => {},
    })
    const steps = stepsOf(['model-kimi-k3', 'entry-1', 'requestModify-1'])
    const a = hub.startRun({ requestId: 'req-1', color: '#f00', steps })
    const b = hub.startRun({ requestId: 'req-1', color: '#0f0', steps })
    expect(hub.activeRunCount('req-1')).toBe(2)
    expect(
      fired.filter((f) => f.step.kind === 'node' && f.step.nodeId === 'model-kimi-k3').length,
    ).toBe(2)
    expect(a).not.toBe(b)
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS)
    expect(fired.filter((f) => f.step.kind === 'edge').length).toBe(2)
  })

  it('stopRun halts the run and does not fire further steps', async () => {
    vi.useFakeTimers()
    let steps = 0
    const hub = new FlowHub({
      onStep: () => void (steps += 1),
      onRunEnd: () => {},
    })
    const runId = hub.startRun({
      requestId: 'req-1',
      color: '#fff',
      steps: stepsOf(['model-kimi-k3', 'entry-1', 'requestModify-1']),
    })
    expect(hub.activeRunCount('req-1')).toBe(1)
    hub.stopRun(runId)
    expect(hub.activeRunCount('req-1')).toBe(0)
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS * 3)
    expect(steps).toBe(1)
  })
})
