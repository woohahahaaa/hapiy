// Supported UI languages and helpers shared by the app, the language
// provider, and the LanguageToggle.
export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const

export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'zh'

// Backend setting key that stores the user's language choice.
export const LANGUAGE_SETTING_KEY = 'ui_language'

export function isLanguage(value: string): value is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

// Map an arbitrary locale tag ("zh-CN", "en-US", "en_GB") to a supported
// language, or null when it is outside our set.
export function normalizeLanguage(input: string | null | undefined): Language | null {
  if (!input) return null
  const value = input.trim().toLowerCase()
  if (value.startsWith('zh')) return 'zh'
  if (value.startsWith('en')) return 'en'
  return null
}

// First supported language advertised by the browser, else the default.
export function detectBrowserLanguage(): Language {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const candidate of candidates) {
    const language = normalizeLanguage(candidate)
    if (language) return language
  }
  return DEFAULT_LANGUAGE
}

// BCP-47 tag written to <html lang>.
export function htmlLang(language: Language): string {
  return language === 'zh' ? 'zh-CN' : 'en'
}
