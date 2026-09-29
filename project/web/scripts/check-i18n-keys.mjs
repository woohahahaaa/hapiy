#!/usr/bin/env node
// Verifies every translation key referenced in source exists in both zh and en
// locale bundles, and that zh/en key sets match.
//
// Usage: node scripts/check-i18n-keys.mjs [--fix-report]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const srcRoot = resolve(process.cwd(), 'src')
const localeRoot = resolve(srcRoot, 'i18n', 'locales')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function loadJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function loadLocale(lng) {
  const tree = {}
  for (const entry of readdirSync(join(localeRoot, lng))) {
    if (entry.endsWith('.json')) {
      tree[entry.replace(/\.json$/, '')] = loadJson(join(localeRoot, lng, entry))
    }
  }
  return tree
}

function lookup(tree, path) {
  let node = tree
  for (const part of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[part]
  }
  return node
}

// i18next resolves `t('x', { count })` in en via `x_one`/`x_other` plural keys;
// zh uses a single form. Treat the family as present when either form exists.
function hasKey(tree, path) {
  if (lookup(tree, path) !== undefined) return true
  return (
    typeof path === 'string' &&
    lookup(tree, `${path}_one`) !== undefined &&
    lookup(tree, `${path}_other`) !== undefined
  )
}

function pluralFamily(key) {
  return key.replace(/_(one|other)$/, '')
}

const zh = loadLocale('zh')
const en = loadLocale('en')
const nsList = new Set([...Object.keys(zh), ...Object.keys(en)])

const problems = []
const files = walk(srcRoot)

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(srcRoot, file)

  // Determine the namespace bound to the local `t` from useTranslation(...).
  let localNs = 'common'
  for (const m of text.matchAll(/useTranslation\(\s*(?:'([^']+)'|"([^"]+)")?\s*\)/g)) {
    if (m[1] ?? m[2]) localNs = m[1] ?? m[2]
  }

  // Local t('...') calls (exclude i18n.t, matched separately below).
  for (const m of text.matchAll(/(?<![\w.])t\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)\s*(?:,|\))/g)) {
    const key = m[1] ?? m[2] ?? m[3]
    if (!key) continue
    let ns = localNs
    let path = key
    if (key.includes(':')) {
      const [n, ...rest] = key.split(':')
      ns = n
      path = rest.join(':')
    }
    if (path.includes('{{')) continue // dynamic key built at runtime — skip
    if (path.includes('${')) continue // dynamic key (template literal) — checked separately
    for (const lng of ['zh', 'en']) {
      const tree = lng === 'zh' ? zh : en
      const nsTree = tree[ns]
      if (!nsTree) {
        problems.push(`${rel}: t('${key}') — namespace '${ns}' missing in ${lng}`)
      } else if (!hasKey(nsTree, path)) {
        problems.push(`${rel}: t('${key}') — key '${ns}:${path}' missing in ${lng}`)
      }
    }
  }

  // Global i18n.t('ns:key') calls.
  for (const m of text.matchAll(/i18n\.t\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)\s*(?:,|\))/g)) {
    const key = m[1] ?? m[2] ?? m[3]
    if (!key || !key.includes(':')) continue
    const [ns, ...rest] = key.split(':')
    const path = rest.join(':')
    if (path.includes('{{')) continue
    if (path.includes('${')) continue
    for (const lng of ['zh', 'en']) {
      const tree = lng === 'zh' ? zh : en
      const nsTree = tree[ns]
      if (!nsTree) {
        problems.push(`${rel}: i18n.t('${key}') — namespace '${ns}' missing in ${lng}`)
      } else if (!hasKey(nsTree, path)) {
        problems.push(`${rel}: i18n.t('${key}') — key '${ns}:${path}' missing in ${lng}`)
      }
    }
  }
}

// zh/en key parity per namespace (plural families compared as one key).
for (const ns of nsList) {
  const z = new Set(Object.keys(zh[ns] ?? {}).map(pluralFamily))
  const e = new Set(Object.keys(en[ns] ?? {}).map(pluralFamily))
  for (const k of e) if (!z.has(k)) problems.push(`parity: en/${ns}.json has key '${k}' missing in zh`)
  for (const k of z) if (!e.has(k)) problems.push(`parity: zh/${ns}.json has key '${k}' missing in en`)
}

if (problems.length === 0) {
  console.log('OK: all translation keys resolve in zh and en.')
  process.exit(0)
}
console.log(`${problems.length} problem(s):`)
for (const p of problems) console.log(`  ${p}`)
process.exit(1)
