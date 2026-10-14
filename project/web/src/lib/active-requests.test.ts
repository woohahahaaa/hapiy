import { describe, expect, it } from 'vitest'
import type { ActiveRequest } from './dashboard-api'
import { sortActiveRequests } from './active-requests'

function request(requestId: string, startTime: string, endTime: string | null): ActiveRequest {
  return {
    requestId,
    model: 'deepseek-v4-flash',
    tokenName: 'token',
    userId: 'user',
    provider: 'provider',
    providerId: 'provider-id',
    source: '',
    stream: true,
    startTime,
    elapsedMs: 0,
    firstByteMs: null,
    endTime,
    outcome: endTime === null ? '' : 'completed',
    stage: endTime === null ? 'receiving_stream' : '',
    chunkCount: 0,
    bytesReceived: 0,
    pathNodeIds: [],
    affinityReuse: '',
  }
}

describe('sortActiveRequests', () => {
  it('keeps active requests on top even when finished ones are newer', () => {
    const rows = [
      request('finished-new', '2026-10-14T10:00:03Z', '2026-10-14T10:00:04Z'),
      request('active-old', '2026-10-14T10:00:01Z', null),
      request('active-new', '2026-10-14T10:00:02Z', null),
      request('finished-old', '2026-10-14T10:00:00Z', '2026-10-14T10:00:01Z'),
    ]
    expect(sortActiveRequests(rows).map((r) => r.requestId)).toEqual([
      'active-new',
      'active-old',
      'finished-new',
      'finished-old',
    ])
  })

  it('puts the newest request of each group first', () => {
    const rows = [
      request('active-b', '2026-10-14T10:00:01Z', null),
      request('active-a', '2026-10-14T10:00:05Z', null),
      request('finished-b', '2026-10-14T10:00:02Z', '2026-10-14T10:00:03Z'),
      request('finished-a', '2026-10-14T10:00:06Z', '2026-10-14T10:00:07Z'),
    ]
    expect(sortActiveRequests(rows).map((r) => r.requestId)).toEqual([
      'active-a',
      'active-b',
      'finished-a',
      'finished-b',
    ])
  })

  it('keeps equal start times in their given order', () => {
    const rows = [
      request('first', '2026-10-14T10:00:00Z', null),
      request('second', '2026-10-14T10:00:00Z', null),
    ]
    expect(sortActiveRequests(rows).map((r) => r.requestId)).toEqual(['first', 'second'])
  })

  it('does not mutate the incoming list', () => {
    const rows = [
      request('finished', '2026-10-14T10:00:01Z', '2026-10-14T10:00:02Z'),
      request('active', '2026-10-14T10:00:00Z', null),
    ]
    sortActiveRequests(rows)
    expect(rows.map((r) => r.requestId)).toEqual(['finished', 'active'])
  })
})
