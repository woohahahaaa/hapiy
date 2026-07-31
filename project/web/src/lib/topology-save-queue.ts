import type { Workflow } from './topology-document'
import { DashboardApiError } from './dashboard-api'

export type TopologySaveFn = (workflows: Workflow[]) => Promise<Workflow[]>

type PendingState = {
  readonly workflows: Workflow[]
  readonly waiters: Waiter[]
}

type Waiter = {
  readonly resolve: (workflows: Workflow[]) => void
  readonly reject: (error: unknown) => void
}

export class TopologySaveQueue {
  private readonly save: TopologySaveFn
  private readonly onConflict: (error: DashboardApiError) => void
  private inflight: Promise<Workflow[]> | null = null
  private pending: PendingState | null = null
  private latest: Workflow[] | null = null
  private stopped: DashboardApiError | null = null

  constructor(save: TopologySaveFn, onConflict: (error: DashboardApiError) => void = () => {}) {
    this.save = save
    this.onConflict = onConflict
  }

  get latestWorkflows(): Workflow[] | null {
    return this.latest
  }

  enqueue(workflows: Workflow[]): Promise<Workflow[]> {
    return new Promise<Workflow[]>((resolve, reject) => {
      if (this.stopped) {
        reject(this.stopped)
        return
      }
      if (this.pending) {
        this.pending = { workflows, waiters: [...this.pending.waiters, { resolve, reject }] }
      } else {
        this.pending = { workflows, waiters: [{ resolve, reject }] }
      }
      this.pump()
    })
  }

  retry(): Promise<Workflow[]> {
    if (this.stopped) return Promise.reject(this.stopped)
    if (!this.pending) return Promise.resolve(this.latest ?? [])
    return this.enqueue(this.pending.workflows)
  }

  async saveNow(workflows: Workflow[]): Promise<Workflow[]> {
    return this.enqueue(workflows)
  }

  private pump(): void {
    if (this.inflight) return
    const pending = this.pending
    if (!pending) return
    this.pending = null
    this.inflight = this.save(pending.workflows)
      .then((saved) => {
        this.latest = saved
        this.inflight = null
        for (const waiter of pending.waiters) waiter.resolve(saved)
        this.pump()
        return saved
      })
      .catch((error: unknown) => {
        this.inflight = null
        for (const waiter of pending.waiters) waiter.reject(error)
        if (error instanceof DashboardApiError && error.status === 409) {
          this.stopped = error
          if (this.pending) {
            for (const waiter of this.pending.waiters) waiter.reject(error)
            this.pending = null
          }
          this.onConflict(error)
          return []
        }
        if (!this.pending) {
          this.pending = { workflows: pending.workflows, waiters: [] }
        }
        return []
      })
  }
}
