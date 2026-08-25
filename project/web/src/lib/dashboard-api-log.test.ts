import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from './dashboard-api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function baseLog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'log-1',
    request_id: 'r-1',
    created_at: '2026-01-01T00:00:00Z',
    user_id: 'u-1',
    token_name: 'token-1',
    provider_name: 'openai',
    model_name: 'gpt-4o',
    prompt_tokens: 10,
    completion_tokens: 20,
    is_stream: true,
    quota: 0.01,
    use_time: 1234,
    status: 'success',
    error_message: '',
    ...overrides,
  }
}

describe('dashboardApi.listLogs stage timings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses numeric stage timing fields as milliseconds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [
        baseLog({
          connect_ms: 120,
          first_byte_ms: 890,
          request_rewrite_ms: 15,
          response_rewrite_ms: 30,
          stream_rewrite_ms: 45,
          queue_wait_ms: 500,
        }),
      ],
      total: 1,
    })))

    const result = await dashboardApi.listLogs({ limit: 20, offset: 0 })
    const log = result.logs[0]

    expect(log.connectMs).toBe(120)
    expect(log.firstByteMs).toBe(890)
    expect(log.requestRewriteMs).toBe(15)
    expect(log.responseRewriteMs).toBe(30)
    expect(log.streamRewriteMs).toBe(45)
    expect(log.queueWaitMs).toBe(500)
  })

  it('normalizes missing stage timing fields to -1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [baseLog()],
      total: 1,
    })))

    const result = await dashboardApi.listLogs({ limit: 20, offset: 0 })
    const log = result.logs[0]

    expect(log.connectMs).toBe(-1)
    expect(log.firstByteMs).toBe(-1)
    expect(log.requestRewriteMs).toBe(-1)
    expect(log.responseRewriteMs).toBe(-1)
    expect(log.streamRewriteMs).toBe(-1)
    expect(log.queueWaitMs).toBe(-1)
  })

  it('normalizes null, string, and explicit -1 stage timing values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [
        baseLog({
          connect_ms: -1,
          first_byte_ms: null,
          request_rewrite_ms: '42',
          response_rewrite_ms: 'not-a-number',
          stream_rewrite_ms: null,
          queue_wait_ms: null,
        }),
      ],
      total: 1,
    })))

    const result = await dashboardApi.listLogs({ limit: 20, offset: 0 })
    const log = result.logs[0]

    expect(log.connectMs).toBe(-1)
    expect(log.firstByteMs).toBe(-1)
    expect(log.requestRewriteMs).toBe(42)
    expect(log.responseRewriteMs).toBe(-1)
    expect(log.streamRewriteMs).toBe(-1)
    expect(log.queueWaitMs).toBe(-1)
  })
})

describe('dashboardApi.readLogCapturePair timing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses numeric timing fields from the pair response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        request_id: 'r1',
        prefix: '',
        source: '',
        provider_id: 'p1',
        created_at: '2026-01-01T00:00:00Z',
        responses: [],
        timing: {
          connect_ms: 120,
          first_byte_ms: 890,
          request_rewrite_ms: 15,
          response_rewrite_ms: 30,
          stream_rewrite_ms: 45,
          queue_wait_ms: 500,
        },
      },
    })))

    const pair = await dashboardApi.readLogCapturePair('r1')
    expect(pair.timing).toEqual({
      connectMs: 120,
      firstByteMs: 890,
      requestRewriteMs: 15,
      responseRewriteMs: 30,
      streamRewriteMs: 45,
      queueWaitMs: 500,
    })
  })

  it('returns undefined timing when the pair has no timing field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        request_id: 'r1',
        prefix: '',
        source: '',
        provider_id: 'p1',
        created_at: '2026-01-01T00:00:00Z',
        responses: [],
      },
    })))

    const pair = await dashboardApi.readLogCapturePair('r1')
    expect(pair.timing).toBeUndefined()
  })
})
