// Vitest setup: initialize the i18n singleton so component tests that render
// translated UI resolve keys synchronously. Defaults to Chinese, which matches
// the original hardcoded copy the existing assertions were written against.
import '@/i18n/i18n'
