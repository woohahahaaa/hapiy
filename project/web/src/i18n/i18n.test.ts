import { describe, expect, it } from 'vitest'

import { resources } from './resources'

function flatten(node: unknown, prefix = '', out: string[] = []): string[] {
  if (node == null || typeof node !== 'object') {
    out.push(prefix)
    return out
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    flatten(value, prefix ? `${prefix}.${key}` : key, out)
  }
  return out
}

// Treat i18next plural suffixes (_one/_other) as one family.
function family(key: string) {
  return key.replace(/_(one|other)$/, '')
}

function keySets(lng: string) {
  const sets = new Map<string, Set<string>>()
  for (const [ns, tree] of Object.entries(resources[lng] ?? {})) {
    sets.set(ns, new Set(flatten(tree).filter((k) => k !== '').map(family)))
  }
  return sets
}

const zhSets = keySets('zh')
const enSets = keySets('en')

describe('i18n locale parity', () => {
  it('zh and en expose the same namespaces and keys', () => {
    const allNs = new Set([...zhSets.keys(), ...enSets.keys()])
    for (const ns of allNs) {
      const zhKeys = zhSets.get(ns)
      const enKeys = enSets.get(ns)
      expect(enKeys, `namespace ${ns} missing in en`).toBeDefined()
      expect(zhKeys, `namespace ${ns} missing in zh`).toBeDefined()
      expect([...zhKeys!].sort()).toEqual([...enKeys!].sort())
    }
  })
})
