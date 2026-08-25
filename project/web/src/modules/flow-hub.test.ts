import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFlowSteps, FlowHub, FLOW_STEP_MS, type FlowStep, type FlowFlashState } from './flow-hub'

afterEach(() => {
  vi.useRealTimers()
})

const canvas = {
  topLevel: [
    { id: 'model-kimi-k3', kind: 'modelHub' },
    { id: 'entry-1', kind: 'requestEntry' },
    { id: 'pslot-1', kind: 'slot', slotType: 'provider' },
    { id: 'requestModify-1', kind: 'slot', slotType: 'requestModify' },
    { id: 'logOutput-1', kind: 'slot', slotType: 'logOutput', enabled: true, logDeadlineAt: Date.now() + 60_000 },
  ],
  providers: [{ id: 'prov-a' }, { id: 'prov-b' }],
  providerSlotOf: new Map([
    ['prov-a', 'pslot-1'],
    ['prov-b', 'pslot-1'],
  ]),
} as never

function stepsOf(path: string[]): readonly FlowStep[] {
  return buildFlowSteps(path, canvas)
}

const enabledState: FlowFlashState = {
  providersById: new Map(),
  externallyDisabledSlotIds: new Set(),
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

  it('keeps the incoming edge while skipping a disabled logOutput slot', () => {
    const inactiveCanvas = {
      topLevel: [
        { id: 'model-kimi-k3', kind: 'modelHub' },
        { id: 'entry-1', kind: 'requestEntry' },
        { id: 'logOutput-1', kind: 'slot', slotType: 'logOutput', enabled: false, logDeadlineAt: null },
      ],
      providers: [],
      providerSlotOf: new Map(),
    } as never
    const steps = buildFlowSteps(['model-kimi-k3', 'entry-1', 'logOutput-1'], inactiveCanvas)
    expect(steps).toEqual([
      { kind: 'node', nodeId: 'model-kimi-k3' },
      { kind: 'edge', edgeId: 'model-kimi-k3→entry-1' },
      { kind: 'node', nodeId: 'entry-1' },
    ])
  })

  it('skips a logOutput slot that is enabled but has no capture deadline', () => {
    // The master switch is on but the log hook never started capturing: under
    // the global rule the slot is inactive, so it must not light up.
    const openButIdleCanvas = {
      topLevel: [
        { id: 'model-kimi-k3', kind: 'modelHub' },
        { id: 'entry-1', kind: 'requestEntry' },
        { id: 'logOutput-1', kind: 'slot', slotType: 'logOutput', enabled: true, logDeadlineAt: null },
      ],
      providers: [],
      providerSlotOf: new Map(),
    } as never
    const steps = buildFlowSteps(['model-kimi-k3', 'entry-1', 'logOutput-1'], openButIdleCanvas)
    expect(steps).toEqual([
      { kind: 'node', nodeId: 'model-kimi-k3' },
      { kind: 'edge', edgeId: 'model-kimi-k3→entry-1' },
      { kind: 'node', nodeId: 'entry-1' },
    ])
  })

  it('skips a logOutput slot whose capture deadline has expired', () => {
    const expiredCanvas = {
      topLevel: [
        { id: 'model-kimi-k3', kind: 'modelHub' },
        { id: 'entry-1', kind: 'requestEntry' },
        { id: 'logOutput-1', kind: 'slot', slotType: 'logOutput', enabled: true, logDeadlineAt: 0 },
      ],
      providers: [],
      providerSlotOf: new Map(),
    } as never
    const steps = buildFlowSteps(['model-kimi-k3', 'entry-1', 'logOutput-1'], expiredCanvas)
    expect(steps).toEqual([
      { kind: 'node', nodeId: 'model-kimi-k3' },
      { kind: 'edge', edgeId: 'model-kimi-k3→entry-1' },
      { kind: 'node', nodeId: 'entry-1' },
    ])
  })

  it('lights up a logOutput slot currently capturing (enabled with a future deadline)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const activeCanvas = {
      topLevel: [
        { id: 'model-kimi-k3', kind: 'modelHub' },
        { id: 'entry-1', kind: 'requestEntry' },
        { id: 'logOutput-1', kind: 'slot', slotType: 'logOutput', enabled: true, logDeadlineAt: 2_000_000 },
      ],
      providers: [],
      providerSlotOf: new Map(),
    } as never
    const steps = buildFlowSteps(['model-kimi-k3', 'entry-1', 'logOutput-1'], activeCanvas)
    expect(steps).toEqual([
      { kind: 'node', nodeId: 'model-kimi-k3' },
      { kind: 'edge', edgeId: 'model-kimi-k3→entry-1' },
      { kind: 'node', nodeId: 'entry-1' },
      { kind: 'edge', edgeId: 'entry-1→logOutput-1' },
      { kind: 'node', nodeId: 'logOutput-1' },
    ])
  })

  it('keeps the stable provider child target after provider reorder', () => {
    const reorderedCanvas = {
      topLevel: [
        { id: 'model-kimi-k3', kind: 'modelHub' },
        { id: 'entry-1', kind: 'requestEntry' },
        { id: 'pslot-1', kind: 'slot', slotType: 'provider' },
      ],
      providers: [{ id: 'prov-b' }, { id: 'prov-a' }],
      providerSlotOf: new Map([
        ['prov-a', 'pslot-1'],
        ['prov-b', 'pslot-1'],
      ]),
    } as never
    expect(buildFlowSteps(['model-kimi-k3', 'entry-1', 'pslot-1', 'prov-a'], reorderedCanvas, enabledState))
      .toContainEqual({ kind: 'node', nodeId: 'prov-a' })
  })

  it('suppresses a provider child when its backing provider is auto-disabled', () => {
    const state: FlowFlashState = {
      providersById: new Map([['provider-record-a', { status: true, autoDisabled: true, workflowEnabled: true }]]),
      externallyDisabledSlotIds: new Set(),
    }
    const providerCanvas = {
      topLevel: [
        { id: 'model-kimi-k3', kind: 'modelHub' },
        { id: 'entry-1', kind: 'requestEntry' },
        { id: 'pslot-1', kind: 'slot', slotType: 'provider' },
      ],
      providers: [{ id: 'prov-a', providerId: 'provider-record-a' }],
      providerSlotOf: new Map([['prov-a', 'pslot-1']]),
    } as never
    expect(buildFlowSteps(['model-kimi-k3', 'entry-1', 'pslot-1', 'prov-a'], providerCanvas, state))
      .not.toContainEqual({ kind: 'node', nodeId: 'prov-a' })
  })

  it('suppresses locally disabled entries, slots, and provider children', () => {
    const localCanvas = {
      topLevel: [
        { id: 'model-kimi-k3', kind: 'modelHub' },
        { id: 'entry-1', kind: 'requestEntry', enabled: false },
        { id: 'pslot-1', kind: 'slot', slotType: 'provider', enabled: false },
        { id: 'requestModify-1', kind: 'slot', slotType: 'requestModify', enabled: true },
      ],
      providers: [{ id: 'prov-a', enabled: false }],
      providerSlotOf: new Map([['prov-a', 'pslot-1']]),
    } as never
    const state: FlowFlashState = {
      providersById: new Map(),
      externallyDisabledSlotIds: new Set(['requestModify-1']),
    }
    const steps = buildFlowSteps(
      ['model-kimi-k3', 'entry-1', 'pslot-1', 'prov-a', 'requestModify-1'],
      localCanvas,
      state,
    )
    expect(steps).toEqual([{ kind: 'node', nodeId: 'model-kimi-k3' }])
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

  it('reuses the existing run for the same request', () => {
    const hub = new FlowHub({ onStep: () => {}, onRunEnd: () => {} })
    const steps = stepsOf(['model-kimi-k3', 'entry-1'])
    const first = hub.startRun({ requestId: 'req-1', color: '#fff', steps })
    const second = hub.startRun({ requestId: 'req-1', color: '#f00', steps })
    expect(second).toBe(first)
    expect(hub.activeRunCount('req-1')).toBe(1)
    hub.stopRun(first)
  })

  it('stops every request immediately', async () => {
    vi.useFakeTimers()
    const fired: number[] = []
    const hub = new FlowHub({ onStep: (runId) => void fired.push(runId), onRunEnd: () => {} })
    hub.startRun({ requestId: 'req-1', color: '#fff', steps: stepsOf(['model-kimi-k3', 'entry-1']) })
    hub.startRun({ requestId: 'req-2', color: '#f00', steps: stepsOf(['model-kimi-k3', 'entry-1']) })
    hub.stopAll()
    await vi.advanceTimersByTimeAsync(FLOW_STEP_MS * 2)
    expect(hub.activeRunCount('req-1')).toBe(0)
    expect(hub.activeRunCount('req-2')).toBe(0)
    expect(fired).toEqual([1, 2])
    vi.useRealTimers()
  })

})
