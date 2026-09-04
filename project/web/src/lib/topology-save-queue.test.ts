import { describe, expect, it, vi } from 'vitest'
import { DashboardApiError } from './dashboard-api'
import type { Workflow } from './topology-document'
import { TopologySaveQueue } from './topology-save-queue'

function workflow(id: string): Workflow[] {
  return [[
    { type: 'provider', name: id, provider_id: id },
  ]]
}

describe('TopologySaveQueue', () => {
  it('coalesces rapid A/B/C edits to C with at most one request in flight', async () => {
    const resolvers: Array<(saved: Workflow[]) => void> = []
    const requests: Workflow[][] = []
    let inFlight = 0
    let maximumInFlight = 0
    const queue = new TopologySaveQueue((candidate) => {
      requests.push(candidate)
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      return new Promise<Workflow[]>((resolve) => {
        resolvers.push((saved) => {
          inFlight -= 1
          resolve(saved)
        })
      })
    })

    const savedA = queue.enqueue(workflow('A'))
    const savedB = queue.enqueue(workflow('B'))
    const savedC = queue.enqueue(workflow('C'))
    resolvers[0]?.(workflow('A'))
    await savedA
    await Promise.resolve()
    await Promise.resolve()
    resolvers[1]?.(workflow('C'))
    await Promise.all([savedB, savedC])

    expect(requests.map((r) => r[0]?.[0]?.name)).toEqual(['A', 'C'])
    expect(maximumInFlight).toBe(1)
    expect(queue.latestWorkflows?.[0]?.[0]?.name).toBe('C')
  })

  it('keeps the latest failed snapshot dirty for retry', async () => {
    let shouldFail = true
    const requests: Workflow[][] = []
    const queue = new TopologySaveQueue(async (candidate) => {
      requests.push(candidate)
      if (shouldFail) throw new Error('offline')
      return candidate
    })

    await expect(queue.enqueue(workflow('dirty'))).rejects.toThrow('offline')
    shouldFail = false
    await queue.retry()

    expect(requests).toHaveLength(2)
    expect(requests[1]?.[0]?.[0]?.name).toBe('dirty')
  })

  it('stops the queue and invokes the conflict callback on a 409', async () => {
    const conflict = new DashboardApiError('冲突', 409)
    const save = vi.fn().mockRejectedValue(conflict)
    const onConflict = vi.fn()
    const queue = new TopologySaveQueue(save, onConflict)

    await expect(queue.enqueue(workflow('latest'))).rejects.toBe(conflict)
    await expect(queue.enqueue(workflow('ignored'))).rejects.toBe(conflict)

    expect(save).toHaveBeenCalledTimes(1)
    expect(onConflict).toHaveBeenCalledWith(conflict)
  })

  it('saveNow waits for the queued latest snapshot to persist', async () => {
    const save = vi.fn(async (candidate: Workflow[]) => candidate)
    const queue = new TopologySaveQueue(save)

    const saved = await queue.saveNow(workflow('B'))

    expect(save).toHaveBeenCalledTimes(1)
    expect(saved[0]?.[0]?.name).toBe('B')
  })
})
