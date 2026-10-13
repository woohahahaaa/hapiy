import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { namespaces, resources } from './resources'
import {
  DEFAULT_LANGUAGE,
  htmlLang,
  isLanguage,
  readCachedLanguage,
  writeCachedLanguage,
} from './languages'

// `initAsync: false` keeps init synchronous so that plain modules
// (`i18n.t(...)`) and SSR/snapshot tests can translate right after import.
//
// Start from the cached choice when we have one: the authenticated app persists
// the user's language there, and the help page opens in its own tab — outside
// the LanguageProvider — yet still has to start in the user's language.
void i18n.use(initReactI18next).init({
  resources,
  lng: readCachedLanguage() ?? DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  ns: namespaces,
  defaultNS: 'common',
  supportedLngs: ['zh', 'en'],
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
})

i18n.on('languageChanged', (lng) => {
  if (isLanguage(lng)) writeCachedLanguage(lng)
  if (typeof document !== 'undefined' && isLanguage(lng)) {
    document.documentElement.lang = htmlLang(lng)
  }
})

export { i18n }
export default i18n
