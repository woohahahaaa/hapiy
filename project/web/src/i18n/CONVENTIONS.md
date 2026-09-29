# i18n conventions

Stack: `i18next` + `react-i18next`. English source-of-truth keys, `zh` is the
fallback language.

## Where things live

- Runtime: `src/i18n/i18n.ts` (initialized once, imported by `main.tsx` and the
  test setup).
- Locale bundles: `src/i18n/locales/<lng>/<namespace>.json`.
- Namespaces are auto-discovered by `src/i18n/resources.ts` via
  `import.meta.glob`. Create a file and it is loaded — no registry to edit.
- Shared chrome strings live in `common.json` (owned by the i18n foundation).
  **Do not edit `common.json` unless it is explicitly in your assignment.**

## Using translations in a component

```tsx
import { useTranslation } from 'react-i18next'

export function Widget() {
  const { t } = useTranslation('provider') // your assigned namespace
  return <button title={t('actions.refresh')}>{t('title')}</button>
}
```

## Using translations outside React (lib helpers, serializers)

```ts
import { i18n } from '@/i18n'
i18n.t('provider:title')
// with interpolation:
i18n.t('api:invalidResponse', { field: 'provider' })
```

Note the `namespace:key` form when using the global `i18n` instance.

## Keys

- Nested objects, camelCase segments: `dialog.title`, `form.nameLabel`.
- Never use the Chinese sentence as the key.
- Interpolation: `{{name}}` / `{{count}}`. Pass values from the caller.
- Plurals (English): use `_one` / `_other`
  (`items_one: "{{count}} item"`, `items_other: "{{count}} items"`) and call
  `t('items', { count })`. Chinese has a single form (`items`).
- Always add the **same key** to both `zh` and `en` files. Chinese must keep the
  exact original wording so existing behaviour and tests do not change.

## What to translate — and what NOT to

Translate only strings a user can see:

- JSX text, button/label/title/placeholder/`aria-label`/`alt`, toasts, dialog
  titles, empty states, validation messages surfaced in the UI.

Do NOT translate:

- Code comments (leave Chinese comments alone).
- `console.*`, `flow-debug`/diagnostics, thrown errors that never reach the UI.
- Identifiers, enum values, protocol/field names, CSS classes, URLs, keys.
- Model names, provider names, user data, and other dynamic values.
- Test files (`*.test.ts`, `*.test.tsx`) — leave them untouched.
- Chinese inside `lib/*.ts` that is used as a machine-readable value (e.g. a
  discriminator) rather than displayed text.

If a string is shown to the user, it must be translated. If unsure, translate it.

## Don't touch

- Do not edit files outside your assigned file list.
- Do not edit `common.json` or any namespace file that is not yours.
- Do not reformat unrelated code, reorder imports, or change behaviour.
- Keep diffs surgical: only the string literals and the imports/hooks needed.
