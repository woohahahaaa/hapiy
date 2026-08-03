/**
 * Hapiy rate-multiplier rule matching.
 * Pure functions only — no React, no DOM, no side effects.
 */

/** A rate-multiplier rule. Defined locally to keep this module standalone. */
export type PriceRule = {
  readonly pattern: string
  readonly multiplier: number
}

export type RuleHitResult = {
  /** Providers whose name matches `rules[index].pattern`. */
  readonly n: number
  /** Of those `n`, how many were ALSO matched by an earlier (higher-priority) rule. */
  readonly m: number
}

/**
 * Returns true when `pattern` equals `providerName` exactly, or when the
 * pattern (interpreted as a regular expression) matches the provider name.
 * Empty and invalid patterns never match and never throw.
 */
export function priceRuleMatches(pattern: string, providerName: string): boolean {
  if (pattern === '') return false
  if (pattern === providerName) return true
  try {
    return new RegExp(pattern).test(providerName)
  } catch {
    return false
  }
}

/**
 * First-match-wins accounting for the rule at `index`.
 * `n` = providers matching `rules[index]`; `m` = the subset of those `n`
 * that an earlier rule already claimed.
 */
export function computeRuleHits(
  rules: readonly PriceRule[],
  providerNames: readonly string[],
  index: number,
): RuleHitResult {
  const rule = rules[index]
  if (rule === undefined) return { n: 0, m: 0 }

  let n = 0
  let m = 0
  for (const name of providerNames) {
    if (!priceRuleMatches(rule.pattern, name)) continue
    n += 1
    for (let i = 0; i < index; i += 1) {
      if (priceRuleMatches(rules[i].pattern, name)) {
        m += 1
        break
      }
    }
  }
  return { n, m }
}
