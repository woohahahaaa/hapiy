import type { FlatCanvas } from '@/lib/flat-topology'

export type FlowProviderState = {
  readonly status: boolean
  readonly autoDisabled: boolean
  readonly workflowEnabled: boolean
}

export type FlowFlashState = {
  readonly providersById: ReadonlyMap<string, FlowProviderState>
  readonly externallyDisabledSlotIds: ReadonlySet<string>
  readonly providersByName?: ReadonlyMap<string, FlowProviderState>
}

export const FLOW_STEP_MS = 340

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export type FlowStep =
  | { readonly kind: 'node'; readonly nodeId: string }
  | { readonly kind: 'edge'; readonly edgeId: string }

// One stacked visual layer for a node or edge. Each active run contributes
// exactly one layer for its current step; overlapping runs on the same
// element stack naturally (DOM order = later on top). `loop` lets the DOM
// key change every pass so the beam/flash animation replays each round.
export type FlowLayerOverlay = {
  readonly runId: number
  readonly color: string
  readonly loop: number
}

export type FlowRunInput = {
  readonly requestId: string
  readonly color: string
  readonly steps: readonly FlowStep[]
}

// Build the ordered animation steps for one request. The node path comes from
// the backend (request.path_node_ids); provider children are folded into their
// parent slot for edge construction but still get their own node step.
export function buildFlowSteps(
  pathNodeIds: readonly string[],
  canvas: FlatCanvas | null,
  state?: FlowFlashState,
): readonly FlowStep[] {
  if (!canvas || pathNodeIds.length < 2) return []
  const providerIds = new Set(canvas.providers.map((provider) => provider.id))
  const isChild = (id: string | undefined): id is string => id !== undefined && providerIds.has(id)
  const topLevelById = new Map(canvas.topLevel.map((node) => [node.id, node]))
  const nodeActive = (nodeId: string): boolean => {
    const node = topLevelById.get(nodeId)
    if (!node) return true
    if (node.enabled === false) return false
    if (node.kind !== 'slot') return true
    if (state?.externallyDisabledSlotIds.has(nodeId)) return false
    // A logOutput slot is only ON when it is actually capturing: enabled AND a
    // future deadline. The master switch alone (enabled=true with no deadline,
    // or an expired one) means the hook is inactive — do not light it up,
    // mirroring LogOutputSlotHeader.capturing.
    if (node.slotType === 'logOutput') {
      return node.enabled === true &&
        node.logDeadlineAt !== null && node.logDeadlineAt !== undefined &&
        node.logDeadlineAt > Date.now()
    }
    return true
  }
  const providerActive = (nodeId: string): boolean => {
    const child = canvas.providers.find((provider) => provider.id === nodeId)
    if (!child || child.enabled === false) return false
    const provider = child.providerId
      ? state?.providersById.get(child.providerId)
      : child.name
        ? state?.providersByName?.get(child.name)
        : undefined
    return provider === undefined || (provider.status && !provider.autoDisabled && provider.workflowEnabled)
  }

  const steps: FlowStep[] = []
  let lastVisible: string | undefined
  for (let i = 0; i < pathNodeIds.length; i++) {
    const nodeId = pathNodeIds[i]
    if (nodeId === undefined) continue
    const active = isChild(nodeId) ? providerActive(nodeId) : nodeActive(nodeId)
    if (!active) {
      if (!isChild(nodeId)) lastVisible = undefined
      continue
    }
    if (lastVisible && !isChild(nodeId)) {
      steps.push({ kind: 'edge', edgeId: `${lastVisible}→${nodeId}` })
    }
    steps.push({ kind: 'node', nodeId })
    if (!isChild(nodeId)) lastVisible = nodeId
  }
  return steps
}

export type FlowStepMeta = {
  readonly requestId: string
  readonly loop: number
  readonly stepIndex: number
  readonly stepTotal: number
}

export type FlowHubOptions = {
  // Fired when a run activates a step. Run waits for the returned promise to
  // resolve before advancing to the next step, so one run plays its steps
  // strictly sequentially. runId is unique per run; the caller uses it to key
  // the visual so overlapping runs stack instead of cancelling each other.
  readonly onStep: (runId: number, step: FlowStep, color: string, meta: FlowStepMeta) => void | Promise<void>
  // Fired when a run has played its final step and is removed.
  readonly onRunEnd: (runId: number) => void
}
type FlowRun = {
  readonly requestId: string
  readonly color: string
  readonly steps: readonly FlowStep[]
  stepIndex: number
  loop: number
  stopped: boolean
  // When set, the run finishes its current full pass (the last step of the
  // step list) before ending, instead of wrapping back to step 0.
  gracefulStop: boolean
}

// Central animation scheduler. Each active request owns one looping run that
// starts at the model node and replays its steps in order: the next step
// begins only when the previous step's promise resolves. A run keeps looping
// until the request is gone; then it is flagged graceful and stops after the
// current pass finishes its final step.
export class FlowHub {
  private onStep: FlowHubOptions['onStep']
  private onRunEnd: FlowHubOptions['onRunEnd']
  private readonly runs = new Map<number, FlowRun>()
  private nextRunId = 0

  constructor(options: FlowHubOptions) {
    this.onStep = options.onStep
    this.onRunEnd = options.onRunEnd
  }

  // Replace the step/end callbacks without touching the run scheduler. Used by
  // the module singleton so a page that mounts, unmounts, and mounts again can
  // rebind its own handlers to the same run pool instead of creating a fresh
  // FlowHub (which would restart runId and double-schedule the same requests).
  setHandlers(options: FlowHubOptions): void {
    this.onStep = options.onStep
    this.onRunEnd = options.onRunEnd
  }

  startRun(input: FlowRunInput): number {
    if (input.steps.length === 0) return 0
    for (const [runId, run] of this.runs) {
      if (run.requestId === input.requestId) return runId
    }
    const runId = ++this.nextRunId
    const run: FlowRun = {
      requestId: input.requestId,
      color: input.color,
      steps: input.steps,
      stepIndex: 0,
      loop: 0,
      stopped: false,
      gracefulStop: false,
    }
    this.runs.set(runId, run)
    void this.play(run, runId)
    return runId
  }

  private async play(run: FlowRun, runId: number): Promise<void> {
    while (!run.stopped) {
      const step = run.steps[run.stepIndex]
      const result = this.onStep(runId, step, run.color, {
        requestId: run.requestId,
        loop: run.loop,
        stepIndex: run.stepIndex,
        stepTotal: run.steps.length,
      })
      if (result) await result
      if (run.stopped) return
      // Hold each step for its visual duration before the next one begins.
      await sleep(FLOW_STEP_MS)
      if (run.stopped) return
      const lastIndex = run.steps.length - 1
      if (run.gracefulStop && run.stepIndex === lastIndex) {
        break
      }
      run.stepIndex = (run.stepIndex + 1) % run.steps.length
      if (run.stepIndex === 0) run.loop += 1
    }
    if (run.stopped) return
    this.runs.delete(runId)
    this.onRunEnd(runId)
  }

  stopRun(runId: number): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.stopped = true
    this.runs.delete(runId)
  }

  // Flag every run of the given requests as graceful so it finishes the
  // current pass before onRunEnd. Requests still active stay untouched.
  // Returns the runIds that got flagged (empty when none) so the caller can
  // react (e.g. debug tracing) without holding a second bookkeeping copy.
  stopFinishedRequests(activeRequestIds: ReadonlySet<string>): readonly number[] {
    const flagged: number[] = []
    for (const [runId, run] of this.runs) {
      if (!activeRequestIds.has(run.requestId)) {
        run.gracefulStop = true
        flagged.push(runId)
      }
    }
    return flagged
  }

  stopAll(): void {
    for (const runId of [...this.runs.keys()]) this.stopRun(runId)
  }

  activeRunCount(requestId: string): number {
    let count = 0
    for (const run of this.runs.values()) if (run.requestId === requestId) count += 1
    return count
  }
}

// Module-level singleton so multiple mounts of TopologyPage (StrictMode
// double-invocation, route re-entry) share one run pool and one runId counter.
// Without it each mount creates its own FlowHub, restarting runId from 1 and
// scheduling duplicate runs for the same active request (observed in logs as
// one requestId appearing under several runIds at once).
let hubSingleton: FlowHub | null = null

export function getFlowHub(): FlowHub {
  if (!hubSingleton) hubSingleton = new FlowHub({ onStep: () => {}, onRunEnd: () => {} })
  return hubSingleton
}
