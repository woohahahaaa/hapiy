// FLOW-DEBUG: standalone animation tracer. Keep this file in the repo; mount
// it from the page only while diagnosing, unmount when done — no need to delete.
// Every lifecycle event is written to the browser console AND appended to
// .debug/flow.log through the Vite middleware, so the user (DevTools) and the
// agent (file) see the same timeline.
const ENDPOINT = '/__flow-log'

type FlowStepInfo =
  | { readonly kind: 'node'; readonly id: string }
  | { readonly kind: 'edge'; readonly id: string }

export type FlowDebugEntry = {
  readonly at: string
  readonly requestId: string
  readonly model: string
  readonly provider: string | null
  readonly runId: number
  readonly loop: number
  readonly stepIndex: number
  readonly stepTotal: number
  readonly step?: FlowStepInfo
  readonly action: 'start' | 'step' | 'graceful' | 'end' | 'skip' | 'poll'
}

export const flowDebug = {
  enabled: false,

  mount(): void {
    this.enabled = true
  },
  unmount(): void {
    this.enabled = false
  },

  emit(entry: Omit<FlowDebugEntry, 'at'>): void {
    if (!this.enabled) return
    const pad = (n: number, w: number): string => String(n).padStart(w, '0')
    const at = new Date()
    const time = `${pad(at.getHours(), 2)}:${pad(at.getMinutes(), 2)}:${pad(at.getSeconds(), 2)}.${pad(at.getMilliseconds(), 3)}`
    const step = entry.step ? ` ${entry.step.kind}=${entry.step.id}` : ''
    const line =
      `[FLOW] ${time} ${entry.action} ` +
      `req=${entry.requestId} model=${entry.model} provider=${entry.provider ?? '-'} ` +
      `run=${entry.runId} loop=${entry.loop} ${entry.stepIndex}/${entry.stepTotal}${step}`
    console.log(line)
    try {
      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line }),
        keepalive: true,
      }).catch(() => {})
    } catch {
      // never break the app for a debug log
    }
  },
}