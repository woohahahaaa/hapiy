import type { AgentProtocol } from '@/lib/dashboard-api'

// matchEndpointTag mirrors the backend's endpoint_tags matching
// (handler/agent_managed.go): a tag containing "*" is a case-insensitive
// glob where "*" matches any run of characters ("*completion*" hits both
// "/chat/completions" and "/v1/chat/completions"); a tag without "*" must
// equal the whole endpoint.
export function matchEndpointTag(endpoint: string, tag: string): boolean {
  const trimmed = tag.trim()
  if (trimmed === '') return false
  const ep = endpoint.trim().toLowerCase()
  const lower = trimmed.toLowerCase()
  if (!lower.includes('*')) return ep === lower
  const parts = lower.split('*')
  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === '') continue
    if (i === 0) {
      if (!ep.startsWith(part)) return false
      pos += part.length
      continue
    }
    const j = ep.indexOf(part, pos)
    if (j < 0) return false
    pos = j + part.length
  }
  return parts[parts.length - 1] === '' || ep.endsWith(parts[parts.length - 1])
}

// matchProtocolIndexByEndpoint returns the index of the first protocol whose
// endpoint_tags hit the endpoint, or -1 when none does (order is priority).
export function matchProtocolIndexByEndpoint(
  endpoint: string,
  protocols: readonly AgentProtocol[],
): number {
  for (let i = 0; i < protocols.length; i++) {
    for (const tag of protocols[i].endpoint_tags) {
      if (matchEndpointTag(endpoint, tag)) return i
    }
  }
  return -1
}

// matchedTagOf returns the first tag of the protocol that hits the endpoint
// (used to show the rule itself, e.g. "*completion*").
export function matchedTagOf(endpoint: string, protocol: AgentProtocol): string | null {
  for (const tag of protocol.endpoint_tags) {
    if (matchEndpointTag(endpoint, tag)) return tag
  }
  return null
}
