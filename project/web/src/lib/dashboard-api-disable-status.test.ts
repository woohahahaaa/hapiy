import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from './dashboard-api'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('dashboardApi provider disable statuses', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses statuses keyed by the actual base URL and key values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [{
        provider_id: 'provider-1',
        provider: false,
        base_urls: { 'https://api.example.com/v1': true },
        keys: { 'sk-example': false },
      }],
    })))

    await expect(dashboardApi.listProviderDisableStatuses()).resolves.toEqual([{
      providerId: 'provider-1',
      provider: false,
      baseUrls: { 'https://api.example.com/v1': true },
      keys: { 'sk-example': false },
    }])
  })

  it('posts the requested dimension and value when resetting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await dashboardApi.resetProviderDisableStatus('provider-1', {
      dimension: 'base_url',
      value: 'https://api.example.com/v1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/dashboard/providers/provider-1/disable-status/reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ dimension: 'base_url', value: 'https://api.example.com/v1' }),
      }),
    )
  })
})
