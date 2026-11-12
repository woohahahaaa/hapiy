import type { Provider, ProviderInput } from '@/lib/dashboard-api'

// providerCopyName picks the first free name for a duplicated provider:
// "<name> <suffix>", then "<name> <suffix> 2", 3, ... Names are unique
// backend-side, so the copy never collides with an existing provider.
export function providerCopyName(name: string, suffix: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = `${name} ${suffix}`
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

// providerCopyInput builds the create payload for a copy: the whole channel
// configuration moves over (addresses, keys, notes, endpoints, models, prices
// and strategies) while runtime state (auto-disable) starts clean.
export function providerCopyInput(provider: Provider, name: string): ProviderInput {
  return {
    name,
    baseUrls: provider.baseUrls,
    keys: provider.keys,
    keyNotes: provider.keyNotes,
    endpoints: provider.endpoints,
    models: provider.models,
    status: provider.status,
    autoDisabled: false,
    workflowEnabled: provider.workflowEnabled,
    dedupeV1Suffix: provider.dedupeV1Suffix,
    keyStrategy: provider.keyStrategy,
    baseUrlStrategy: provider.baseUrlStrategy,
  }
}
