import { describe, expect, it, vi } from 'vitest'
import { DashboardApiError } from './dashboard-api'
import type { TopologyDocument } from './topology-document'
import { TopologySaveQueue } from './topology-save-queue'

function document(id: string, revision = 1): TopologyDocument {
  return {
    schema_version: 1,
    revision,
    slots: [{
      id,
      channel_id: 'channel-a',
      slot_type: 'requestModify',
      order: 1,
      enabled: true,
      rule_id: 'rule-a',
      config: {},
    }],
  }
}

describe('TopologySaveQueue', () => {
  it('coalesces rapid A/B/C edits to C with at most one request in flight', async () => {
    // Given
    const resolvers: Array<(saved: TopologyDocument) => void> = []
    const requests: TopologyDocument[] = []
    let inFlight = 0
    let maximumInFlight = 0
    const queue = new TopologySaveQueue(1, (candidate) => {
      requests.push(candidate)
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      return new Promise<TopologyDocument>((resolve) => {
        resolvers.push((saved) => {
          inFlight -= 1
          resolve(saved)
        })
      })
    })

    // When
    const savedA = queue.enqueue(document('A'))
    const savedB = queue.enqueue(document('B'))
    const savedC = queue.enqueue(document('C'))
    resolvers[0]?.(document('A', 2))
    await savedA
    await Promise.resolve()
    await Promise.resolve()
    resolvers[1]?.(document('C', 3))
    await Promise.all([savedB, savedC])

    // Then
    expect(requests.map((request) => [request.slots[0]?.id, request.revision])).toEqual([
      ['A', 1],
      ['C', 2],
    ])
    expect(maximumInFlight).toBe(1)
    expect(queue.latestDocument?.slots[0]?.id).toBe('C')
  })

  it('keeps the latest failed snapshot dirty for retry', async () => {
    // Given
    let shouldFail = true
    const requests: TopologyDocument[] = []
    const queue = new TopologySaveQueue(4, async (candidate) => {
      requests.push(candidate)
      if (shouldFail) throw new Error('offline')
      return document(candidate.slots[0]?.id ?? 'missing', 5)
    })

    // When
    await expect(queue.enqueue(document('dirty', 4))).rejects.toThrow('offline')
    shouldFail = false
    await queue.retry()

    // Then
    expect(requests).toHaveLength(2)
    expect(requests[1]?.slots[0]?.id).toBe('dirty')
    expect(queue.latestDocument?.revision).toBe(5)
  })

  it('stops the queue and invokes the conflict callback on a 409', async () => {
    // Given
    const conflict = new DashboardApiError('冲突', 409)
    const save = vi.fn().mockRejectedValue(conflict)
    const onConflict = vi.fn()
    const queue = new TopologySaveQueue(7, save, onConflict)

    // When
    await expect(queue.enqueue(document('latest', 7))).rejects.toBe(conflict)
    await expect(queue.enqueue(document('ignored', 7))).rejects.toBe(conflict)

    // Then
    expect(save).toHaveBeenCalledTimes(1)
    expect(onConflict).toHaveBeenCalledWith(conflict)
  })

  it('saveNow waits for the queued latest snapshot to persist', async () => {
    // Given
    const save = vi.fn(async (candidate: TopologyDocument) => document(candidate.slots[0]?.id ?? 'missing', candidate.revision + 1))
    const queue = new TopologySaveQueue(1, save)

    // When
    const saved = await queue.saveNow(document('B'))

    // Then
    expect(save).toHaveBeenCalledTimes(1)
    expect(saved.slots[0]?.id).toBe('B')
    expect(queue.revision).toBe(2)
  })
})
