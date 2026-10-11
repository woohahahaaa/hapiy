import Pinyin from 'tiny-pinyin'

// Sorting for list pages whose first column acts as a row title (provider name,
// token name, rule name, …). Mirrors the backend (internal/handler/name_sort.go):
// every name becomes a lowercase "alphabet" key — Latin letters as-is, Han
// characters as toneless pinyin — so English and Chinese interleave in one
// order (deepseek < 多元探索 duoyuan < opencode). On an equal key (an English
// spelling that matches a pinyin reading) the non-Han name sorts first.
//
// Only the channel affinity table sorts on the client; the other title tables
// are sorted by the backend, so this keys must stay in step with it.

const HAN = /\p{Script=Han}/u

let supported: boolean | null = null

function pinyinSupported(): boolean {
  if (supported === null) {
    try {
      supported = Pinyin.isSupported()
    } catch {
      supported = false
    }
  }
  return supported
}

function nameSortKey(name: string): string {
  if (!pinyinSupported()) return name.toLowerCase()
  try {
    return Pinyin.convertToPinyin(name, '', true).toLowerCase()
  } catch {
    return name.toLowerCase()
  }
}

function hasHan(name: string): boolean {
  return HAN.test(name)
}

/** compareTitle orders two display names the way the list pages expect. */
export function compareTitle(a: string, b: string): number {
  const ka = nameSortKey(a)
  const kb = nameSortKey(b)
  if (ka !== kb) return ka < kb ? -1 : 1
  // Same pinyin/letter key: English before Chinese.
  const ha = hasHan(a) ? 1 : 0
  const hb = hasHan(b) ? 1 : 0
  return ha - hb
}
