// joinModelListUrl builds the model-list URL from a provider Base URL and
// the path configured in the "fetch models" dialog.
//
// dedupeV1Suffix is an explicit per-provider choice: when enabled it removes
// only a duplicated /v1 (Base URL path ends with /v1 and the configured path
// starts with /v1/). It deliberately does not do arbitrary segment overlap:
// prefixes such as /v4 are left untouched.
export function joinModelListUrl(baseUrl: string, endpoint: string, dedupeV1Suffix: boolean): string {
  const base = baseUrl.trim()
  const path = endpoint.trim()
  const baseWithoutTrailingSlash = base.replace(/\/+$/, '')
  if (!dedupeV1Suffix || path === '') {
    return `${baseWithoutTrailingSlash}${path}`
  }
  try {
    const url = new URL(base)
    const basePath = url.pathname.replace(/\/+$/, '')
    if (basePath.endsWith('/v1') && (path === '/v1' || path.startsWith('/v1/'))) {
      url.pathname = `${basePath}${path.slice(3)}`
      return url.toString()
    }
  } catch {
    // Relative / malformed base URLs fall back to the verbatim join; the
    // backend rejects them with a clear "must be http(s)" error.
  }
  return `${baseWithoutTrailingSlash}${path}`
}

// pickFetchModelKey returns the key to send with a model-list request. The
// first non-empty key that is not marked disabled wins; when every key is
// disabled (or the disable map is unavailable) it falls back to the first
// non-empty key, preserving the old behavior as a last resort.
export function pickFetchModelKey(
  keys: readonly string[],
  disabled: Readonly<Record<string, boolean>> | undefined,
): string | undefined {
  const normalized = keys.map((key) => key.trim()).filter((key) => key !== '')
  return normalized.find((key) => disabled?.[key] !== true) ?? normalized[0]
}
