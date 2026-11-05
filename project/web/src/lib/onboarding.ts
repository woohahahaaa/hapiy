// 首次引导的显示规则集中在这里：没有手动跳过、且一个供应商都没有时显示。
export const ONBOARDING_SKIPPED_SETTING_KEY = 'onboarding_skipped'

type SettingLike = { readonly key: string; readonly value: string }

export function shouldShowOnboarding(
  providersTotal: number,
  settings: readonly SettingLike[]
): boolean {
  if (providersTotal > 0) return false
  return !settings.some(
    (setting) =>
      setting.key === ONBOARDING_SKIPPED_SETTING_KEY && setting.value === 'true'
  )
}
