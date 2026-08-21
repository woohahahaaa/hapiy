import { describe, expect, it } from 'vitest'
import { requestStartedAfterBoundary } from './flow-animation-isolation'

describe('requestStartedAfterBoundary', () => {
  it('accepts requests when no edit boundary exists', () => {
    expect(requestStartedAfterBoundary('2026-08-21T10:00:00Z', null)).toBe(true)
  })

  it('accepts a request started strictly after the edit', () => {
    expect(requestStartedAfterBoundary('2026-08-21T10:00:01Z', Date.parse('2026-08-21T10:00:00Z'))).toBe(true)
  })

  it('rejects requests started at or before the edit', () => {
    const boundary = Date.parse('2026-08-21T10:00:00Z')
    expect(requestStartedAfterBoundary('2026-08-21T10:00:00Z', boundary)).toBe(false)
    expect(requestStartedAfterBoundary('2026-08-21T09:59:59Z', boundary)).toBe(false)
  })

  it('rejects an invalid request timestamp after an edit', () => {
    expect(requestStartedAfterBoundary('not-a-date', Date.now())).toBe(false)
  })
})
