import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { namespaces, resources } from './resources'
import { DEFAULT_LANGUAGE, htmlLang, isLanguage } from './languages'

// `initImmediate: false` keeps init synchronous so that plain modules
// (`i18n.t(...)`) and SSR/snapshot tests can translate right after import.
void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  ns: namespaces,
  defaultNS: 'common',
  supportedLngs: ['zh', 'en'],
  interpolation: { escapeValue: false },
  returnNull: false,
  initImmediate: false,
})

i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined' && isLanguage(lng)) {
    document.documentElement.lang = htmlLang(lng)
  }
})

export { i18n }
export default i18n
