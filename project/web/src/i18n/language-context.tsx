import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { dashboardApi } from '@/lib/dashboard-api'
import { i18n } from './i18n'
import {
  LANGUAGE_SETTING_KEY,
  detectBrowserLanguage,
  normalizeLanguage,
  type Language,
} from './languages'

interface LanguageContextValue {
  readonly language: Language
  readonly setLanguage: (language: Language) => void
}

const LanguageContext = createContext<LanguageContextValue>({
  language: detectBrowserLanguage(),
  setLanguage: () => {},
})

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext)
}

// LanguageProvider only runs for authenticated users (it is mounted inside
// AuthGate), so it can safely read/write the language setting on the backend.
// If the user never chose a language we fall back to the browser language and
// persist that choice.
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectBrowserLanguage)

  const applyLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    if (i18n.language !== next) void i18n.changeLanguage(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    void dashboardApi
      .getSettings()
      .then((settings) => {
        if (cancelled) return
        const stored = normalizeLanguage(settings.find((s) => s.key === LANGUAGE_SETTING_KEY)?.value)
        if (stored) {
          applyLanguage(stored)
          return
        }
        const detected = detectBrowserLanguage()
        applyLanguage(detected)
        void dashboardApi.updateSetting(LANGUAGE_SETTING_KEY, detected).catch(() => {})
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [applyLanguage])

  const setLanguage = useCallback(
    (next: Language) => {
      applyLanguage(next)
      void dashboardApi.updateSetting(LANGUAGE_SETTING_KEY, next).catch(() => {})
    },
    [applyLanguage],
  )

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>
  )
}
