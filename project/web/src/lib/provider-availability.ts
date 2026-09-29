// 供应商整体可用性计算。输入来自 providers/disable-status 接口的
// `ProviderDisableStatus`：provider 维度是布尔，base_url / key 维度是
// 「条目 -> 是否禁用」的映射。
//
// 语义（用户约定）：
// - provider 维度禁用 → 整体不可用；
// - base URL 维度：只要不是「全部禁用」→ 可用；
// - key 维度：只要不是「全部禁用」→ 可用；
// - 任一维度「完全禁用」→ 整体不可用，否则整体可用。

export type ProviderAvailabilityDimension = 'provider' | 'base_url' | 'key'

export interface ProviderAvailability {
  /** 完全禁用的维度，按 供应商 → base URL → key 排序；不包含未完全禁用的维度 */
  readonly dimensions: readonly ProviderAvailabilityDimension[]
  /** 各维度「完全禁用」的条目数（provider 维恒为 1，未禁用的维度为 0） */
  readonly counts: Readonly<Record<ProviderAvailabilityDimension, number>>
  /** 整体可用性：任一维度完全禁用 → false（整体不可用），否则 true（整体可用） */
  readonly overall: boolean
}

/** 完全禁用条目的数量：维度无条目或存在未禁用条目 → 0，全部禁用 → 条目数。 */
export function fullyDisabledEntries(flags: Readonly<Record<string, boolean>>): number {
  const entries = Object.entries(flags)
  if (entries.length === 0) return 0
  return entries.every(([, disabled]) => disabled) ? entries.length : 0
}

export function computeProviderAvailability(input: {
  readonly providerDisabled: boolean
  readonly baseUrlsDisabled: Readonly<Record<string, boolean>>
  readonly keysDisabled: Readonly<Record<string, boolean>>
  readonly baseURLCount?: number
  readonly keyCount?: number
}): ProviderAvailability {
  const disabledBaseURLCount = Object.values(input.baseUrlsDisabled).filter(Boolean).length
  const disabledKeyCount = Object.values(input.keysDisabled).filter(Boolean).length
  const baseURLCount = input.baseURLCount ?? Object.keys(input.baseUrlsDisabled).length
  const keyCount = input.keyCount ?? Object.keys(input.keysDisabled).length
  const counts: Record<ProviderAvailabilityDimension, number> = {
    provider: input.providerDisabled ? 1 : 0,
    base_url: baseURLCount > 0 && disabledBaseURLCount === baseURLCount ? disabledBaseURLCount : 0,
    key: keyCount > 0 && disabledKeyCount === keyCount ? disabledKeyCount : 0,
  }
  const dimensions = (['provider', 'base_url', 'key'] as const).filter((dim) => counts[dim] > 0)
  return { dimensions, counts, overall: dimensions.length === 0 }
}

// 摘要统一用分数形式展示各维度禁用情况，只列出存在禁用的维度：
// 供应商 1/1、base URL 2/3、key 0/3。
import { i18n } from '@/i18n/i18n'

export function formatAutoDisableSummary(input: {
  readonly providerDisabled: boolean
  readonly baseUrlsDisabled: Readonly<Record<string, boolean>>
  readonly keysDisabled: Readonly<Record<string, boolean>>
  readonly baseURLCount: number
  readonly keyCount: number
}): string | null {
  const disabledBaseURLCount = Object.values(input.baseUrlsDisabled).filter(Boolean).length
  const disabledKeyCount = Object.values(input.keysDisabled).filter(Boolean).length
  const items = [
    input.providerDisabled ? i18n.t('lib:availability.providerItem', { count: 1, total: 1 }) : null,
    disabledBaseURLCount > 0 ? i18n.t('lib:availability.baseUrlItem', { count: disabledBaseURLCount, total: input.baseURLCount }) : null,
    disabledKeyCount > 0 ? i18n.t('lib:availability.keyItem', { count: disabledKeyCount, total: input.keyCount }) : null,
  ].filter((item): item is string => item !== null)

  return items.length > 0 ? i18n.t('lib:availability.summary', { items: items.join(i18n.t('lib:availability.join')) }) : null
}
