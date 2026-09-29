import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

// Scan source for t('...') / i18n.t('ns:...') and ensure every key resolves in
// both languages. Dynamic keys (containing ${ or {{) are skipped.
describe('i18n key usage', () => {
  const srcRoot = resolve(process.cwd(), 'src')

  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...walk(full))
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full)
    }
    return out
  }

  function lookup(tree: Record<string, unknown>, path: string): unknown {
    let node: unknown = tree
    for (const part of path.split('.')) {
      if (node == null || typeof node !== 'object') return undefined
      node = (node as Record<string, unknown>)[part]
    }
    return node
  }

  function hasKey(tree: Record<string, unknown>, path: string): boolean {
    if (lookup(tree, path) !== undefined) return true
    return (
      lookup(tree, `${path}_one`) !== undefined && lookup(tree, `${path}_other`) !== undefined
    )
  }

  it('every referenced key resolves in both zh and en', () => {
    const missing: string[] = []
    const keyPattern = /(?<![\w.])t\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)\s*(?:,|\))/g
    const globalPattern = /i18n\.t\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)\s*(?:,|\))/g

    for (const file of walk(srcRoot)) {
      const text = readFileSync(file, 'utf8')
      let localNs = 'common'
      for (const m of text.matchAll(/useTranslation\(\s*(?:'([^']+)'|"([^"]+)")?\s*\)/g)) {
        if (m[1] ?? m[2]) localNs = m[1] ?? m[2]
      }
      const check = (ns: string, path: string, display: string) => {
        if (path.includes('${') || path.includes('{{')) return
        for (const lng of ['zh', 'en']) {
          const tree = resources[lng]?.[ns]
          if (!tree) missing.push(`${display} — ns '${ns}' missing in ${lng}`)
          else if (!hasKey(tree, path)) missing.push(`${display} — '${ns}:${path}' missing in ${lng}`)
        }
      }
      for (const m of text.matchAll(keyPattern)) {
        const key = m[1] ?? m[2] ?? m[3]
        if (!key) continue
        if (key.includes(':')) {
          const [ns, ...rest] = key.split(':')
          check(ns, rest.join(':'), key)
        } else {
          check(localNs, key, key)
        }
      }
      for (const m of text.matchAll(globalPattern)) {
        const key = m[1] ?? m[2] ?? m[3]
        if (!key || !key.includes(':')) continue
        const [ns, ...rest] = key.split(':')
        check(ns, rest.join(':'), key)
      }
    }

    expect(missing).toEqual([])
  })
})
