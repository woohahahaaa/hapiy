// 用量数字的紧凑格式：单位随当前语言本地化——en 出 K/M/B，zh 出 万/亿
// （Intl compact 按 CLDR 选单位，如 18900000000 → "18.9B" / "189亿"）。
// 「Token」这类固定词汇保持英文，变化的只是数字单位。
export function formatCompactNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}
