// Collects every locale bundle under `locales/<lng>/<namespace>.json` at build
// time. Namespaces are per-feature files so contributors (and parallel agents)
// only ever touch their own file.
const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default?: Record<string, unknown> } | Record<string, unknown>
>

export type ResourceTree = Record<string, Record<string, unknown>>

function unwrap(mod: { default?: Record<string, unknown> } | Record<string, unknown>) {
  const candidate = (mod as { default?: Record<string, unknown> }).default
  return candidate ?? (mod as Record<string, unknown>)
}

export const resources: Record<string, ResourceTree> = {}
export const namespaces: string[] = []

for (const [path, mod] of Object.entries(modules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (!match) continue
  const [, lng, ns] = match
  resources[lng] ??= {}
  resources[lng][ns] = unwrap(mod)
  if (!namespaces.includes(ns)) namespaces.push(ns)
}
