import { describe, expect, it } from 'vitest'
import { matchEndpointTag, matchProtocolIndexByEndpoint, matchedTagOf } from './agent-endpoint-rules'
import type { AgentProtocol } from '@/lib/dashboard-api'

const protocols: readonly AgentProtocol[] = [
  { name: 'responses', conditions: [], endpoint_tags: ['*responses*'], recommendations: [] },
  { name: 'anthropic', conditions: [], endpoint_tags: ['*message*'], recommendations: [] },
  { name: 'completion', conditions: [], endpoint_tags: ['*completion*'], recommendations: [] },
]

describe('matchEndpointTag', () => {
  it('treats a tag without * as an exact, case-insensitive match', () => {
    expect(matchEndpointTag('responses', 'responses')).toBe(true)
    expect(matchEndpointTag('RESPONSES', 'responses')).toBe(true)
    expect(matchEndpointTag('/v1/responses', 'responses')).toBe(false)
  })

  it('treats * as a wildcard', () => {
    expect(matchEndpointTag('/v1/chat/completions', '*completion*')).toBe(true)
    expect(matchEndpointTag('/chat/completion', '*completion*')).toBe(true)
    expect(matchEndpointTag('/V1/Chat/Completions', '*completion*')).toBe(true)
    expect(matchEndpointTag('/v1/chat/completions', '*completion')).toBe(false) // trailing * anchors the end
    expect(matchEndpointTag('/v1/chat/completion', '*completion')).toBe(true)
    expect(matchEndpointTag('/v1/embeddings', '*completion*')).toBe(false)
  })
})

describe('matchProtocolIndexByEndpoint', () => {
  it('folds endpoints hitting the same rule', () => {
    expect(matchProtocolIndexByEndpoint('/chat/completions', protocols)).toBe(2)
    expect(matchProtocolIndexByEndpoint('/v1/chat/completions', protocols)).toBe(2)
    expect(matchProtocolIndexByEndpoint('/v1/messages', protocols)).toBe(1)
    expect(matchProtocolIndexByEndpoint('/v1/responses', protocols)).toBe(0)
    expect(matchProtocolIndexByEndpoint('/v1/embeddings', protocols)).toBe(-1)
  })

  it('exposes the matched tag for display', () => {
    expect(matchedTagOf('/v1/chat/completions', protocols[2])).toBe('*completion*')
  })
})
