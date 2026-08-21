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
  it('loops a run back to step 0 after the final step', async () => {
    vi.useFakeTimers()
    const fired: FlowStep[] = []
    const hub = new FlowHub({ onStep: (_id, step) => void fired.push(step), onRunEnd: () => {} })
    hub.startRun({ requestId: 'req-1', color: '#fff', steps: stepsOf(['model-kimi-k3', 'entry-1', 'requestModify-1']) })
    expect(fired).toEqual([{ kind: 'node', nodeId: 'model-kimi-k3' }])
    // 5 steps per pass: one pass then wrap back to the first step.
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS * 5)
    expect(fired).toHaveLength(6)
    expect(fired[5]).toEqual({ kind: 'node', nodeId: 'model-kimi-k3' })
  })

  it('stops after the current pass when the request disappears', async () => {
    vi.useFakeTimers()
    const fired: FlowStep[] = []
    const ended: number[] = []
    const hub = new FlowHub({ onStep: (_id, step) => void fired.push(step), onRunEnd: (id) => ended.push(id) })
    const runId = hub.startRun({
      requestId: 'req-1',
      color: '#fff',
      steps: stepsOf(['model-kimi-k3', 'entry-1', 'requestModify-1']),
    })
    // Advance partway into the first pass (2 steps), then request disappears.
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS * 2)
    hub.stopFinishedRequests(new Set())
    expect(ended).toEqual([])
    // Remaining steps of the current pass: 3 more (steps 2,3,4) then it ends.
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS * 3)
    expect(fired.map((s) => s.kind)).toEqual(['node', 'edge', 'node', 'edge', 'node'])
    expect(ended).toEqual([runId])
  })

  it('keeps looping while the request stays active', async () => {
    vi.useFakeTimers()
    const fired: FlowStep[] = []
    const hub = new FlowHub({ onStep: (_id, step) => void fired.push(step), onRunEnd: () => {} })
    hub.startRun({ requestId: 'req-1', color: '#fff', steps: stepsOf(['model-kimi-k3', 'entry-1', 'requestModify-1']) })
    hub.stopFinishedRequests(new Set(['req-1']))
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS * 5)
    expect(fired).toHaveLength(6)
  })

  it('stopRun halts a run immediately', async () => {
    vi.useFakeTimers()
    let steps = 0
    const hub = new FlowHub({ onStep: () => void (steps += 1), onRunEnd: () => {} })
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
