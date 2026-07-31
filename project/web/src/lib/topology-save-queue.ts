import type { TopologyDocument } from './topology-document'
import { DashboardApiError } from './dashboard-api'

export type TopologySaveFn = (document: TopologyDocument) => Promise<TopologyDocument>

type PendingState = {
  readonly document: TopologyDocument
  readonly waiters: Waiter[]
}

type Waiter = {
  readonly resolve: (document: TopologyDocument) => void
  readonly reject: (error: unknown) => void
}

export class TopologySaveQueue {
  private readonly save: TopologySaveFn
  private readonly onConflict: (error: DashboardApiError) => void
  private revisionRef: number
  private inflight: Promise<TopologyDocument> | null = null
  private pending: PendingState | null = null
  private latest: TopologyDocument | null
  private stopped: DashboardApiError | null = null

  constructor(initialRevision: number, save: TopologySaveFn, onConflict: (error: DashboardApiError) => void = () => {}) {
    this.revisionRef = initialRevision
    this.save = save
    this.onConflict = onConflict
    this.latest = null
  }

  get latestDocument(): TopologyDocument | null {
    return this.latest
  }

  get revision(): number {
    return this.revisionRef
  }

  enqueue(document: TopologyDocument): Promise<TopologyDocument> {
    return new Promise<TopologyDocument>((resolve, reject) => {
      if (this.stopped) {
        reject(this.stopped)
        return
      }
      if (this.pending) {
        this.pending = { document, waiters: [...this.pending.waiters, { resolve, reject }] }
      } else {
        this.pending = { document, waiters: [{ resolve, reject }] }
      }
      this.pump()
    })
  }

  retry(): Promise<TopologyDocument> {
    if (this.stopped) return Promise.reject(this.stopped)
    if (!this.pending) return Promise.resolve(this.latest ?? { schema_version: 1, revision: this.revisionRef, slots: [] })
    return this.enqueue(this.pending.document)
  }

  async saveNow(document: TopologyDocument): Promise<TopologyDocument> {
    return this.enqueue(document)
  }

  private pump(): void {
    if (this.inflight) return
    const pending = this.pending
    if (!pending) return
    this.pending = null
    const candidate: TopologyDocument = { ...pending.document, revision: this.revisionRef }
    this.inflight = this.save(candidate)
      .then((saved) => {
        this.revisionRef = saved.revision
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
          return { schema_version: 1, revision: this.revisionRef, slots: [] }
        }
        if (!this.pending) {
          this.pending = { document: pending.document, waiters: [] }
        }
        return { schema_version: 1, revision: this.revisionRef, slots: [] }
      })
  }
}
