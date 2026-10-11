import type { ProviderEndpoint, ProviderModel } from './dashboard-api'

// collectDeclaredEndpoints returns the distinct endpoint paths a provider
// declares. Model-level lists are the new source of truth; the provider-level
// (legacy) list still counts for rows that were never re-saved.
export function collectDeclaredEndpoints(provider: {
  readonly endpoints: readonly ProviderEndpoint[]
  readonly models: readonly ProviderModel[]
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (raw: string) => {
    const path = raw.trim()
    if (path === '' || seen.has(path)) return
    seen.add(path)
    out.push(path)
  }
  for (const endpoint of provider.endpoints) push(endpoint.pathSuffix)
  for (const model of provider.models) {
    for (const endpoint of model.endpoints) push(endpoint)
  }
  return out
}

// seedModelEndpointsFromProvider distributes a legacy provider-level endpoint
// list onto the model rows that declare none. The old whitelist applied to
// every model of the provider, so copying it onto each empty-endpoint model
// keeps behaviour identical while moving the data to the per-model field.
// Models with their own list are left untouched — that list is intentional.
export function seedModelEndpointsFromProvider(
  endpoints: readonly ProviderEndpoint[],
  models: readonly ProviderModel[],
): readonly ProviderModel[] {
  const paths = endpoints
    .map((endpoint) => endpoint.pathSuffix.trim())
    .filter((path) => path !== '')
  if (paths.length === 0) return models
  return models.map((model) =>
    model.endpoints.length === 0 ? { ...model, endpoints: paths } : model,
  )
}
